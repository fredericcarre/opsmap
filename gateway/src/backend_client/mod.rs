//! Backend client module
//!
//! Maintains WebSocket connection to the backend.

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::time::{interval, Duration};
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};
use tracing::{debug, error, info, warn};

use crate::{BackendMessage, GatewayState};

/// Messages from backend
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum BackendToGatewayMessage {
    #[serde(rename = "command")]
    Command(CommandPayload),
    #[serde(rename = "snapshot")]
    Snapshot(SnapshotPayload),
    #[serde(rename = "ping")]
    Ping,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandPayload {
    pub agent_id: Option<String>,
    pub labels: Option<std::collections::HashMap<String, String>>,
    pub command: crate::registry::AgentCommand,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotPayload {
    pub agent_id: String,
    pub snapshot: serde_json::Value,
}

/// Messages to backend
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum GatewayToBackendMessage {
    #[serde(rename = "register")]
    Register(RegisterPayload),
    #[serde(rename = "agent_connected")]
    AgentConnected(crate::registry::AgentInfo),
    #[serde(rename = "agent_disconnected")]
    AgentDisconnected { agent_id: String },
    #[serde(rename = "status_update")]
    StatusUpdate(serde_json::Value),
    #[serde(rename = "command_response")]
    CommandResponse(serde_json::Value),
    #[serde(rename = "pong")]
    Pong,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegisterPayload {
    pub gateway_id: String,
    pub zone: String,
    pub version: String,
    pub agents: Vec<crate::registry::AgentInfo>,
}

/// Run the backend client
pub async fn run(state: Arc<GatewayState>) {
    let mut rx = state.backend_tx.subscribe();

    loop {
        match connect_to_backend(&state).await {
            Ok((mut ws_sender, mut ws_receiver)) => {
                info!(url = %state.config.backend.url, "Connected to backend");

                // Register with backend
                let register_msg = GatewayToBackendMessage::Register(RegisterPayload {
                    gateway_id: state.config.gateway.id.clone(),
                    zone: state.config.gateway.zone.clone(),
                    version: env!("CARGO_PKG_VERSION").to_string(),
                    agents: state.registry.list(),
                });

                if let Ok(json) = serde_json::to_string(&register_msg) {
                    if ws_sender.send(Message::Text(json)).await.is_err() {
                        error!("Failed to send registration to backend");
                        continue;
                    }
                }

                // Heartbeat ticker
                let mut heartbeat = interval(Duration::from_secs(30));

                loop {
                    tokio::select! {
                        // Receive from backend
                        msg = ws_receiver.next() => {
                            match msg {
                                Some(Ok(Message::Text(text))) => {
                                    if let Err(e) = handle_backend_message(&text, &state).await {
                                        error!(error = %e, "Failed to handle backend message");
                                    }
                                }
                                Some(Ok(Message::Ping(data))) => {
                                    if ws_sender.send(Message::Pong(data)).await.is_err() {
                                        break;
                                    }
                                }
                                Some(Ok(Message::Close(_))) => {
                                    info!("Backend closed connection");
                                    break;
                                }
                                Some(Err(e)) => {
                                    error!(error = %e, "Backend WebSocket error");
                                    break;
                                }
                                None => break,
                                _ => {}
                            }
                        }

                        // Forward messages to backend
                        result = rx.recv() => {
                            if let Ok(msg) = result {
                                let backend_msg = match msg {
                                    BackendMessage::AgentConnected(info) => {
                                        GatewayToBackendMessage::AgentConnected(info)
                                    }
                                    BackendMessage::AgentDisconnected(agent_id) => {
                                        GatewayToBackendMessage::AgentDisconnected { agent_id }
                                    }
                                    BackendMessage::StatusUpdate(data) => {
                                        GatewayToBackendMessage::StatusUpdate(data)
                                    }
                                    BackendMessage::CommandResponse(data) => {
                                        GatewayToBackendMessage::CommandResponse(data)
                                    }
                                };

                                if let Ok(json) = serde_json::to_string(&backend_msg) {
                                    if ws_sender.send(Message::Text(json)).await.is_err() {
                                        break;
                                    }
                                }
                            }
                        }

                        // Send heartbeat
                        _ = heartbeat.tick() => {
                            let msg = GatewayToBackendMessage::Pong;
                            if let Ok(json) = serde_json::to_string(&msg) {
                                if ws_sender.send(Message::Text(json)).await.is_err() {
                                    break;
                                }
                            }
                        }
                    }
                }
            }
            Err(e) => {
                error!(error = %e, "Failed to connect to backend");
            }
        }

        // Wait before reconnecting
        let wait_secs = state.config.backend.reconnect_interval_secs;
        warn!(
            wait_secs = wait_secs,
            "Reconnecting to backend..."
        );
        tokio::time::sleep(Duration::from_secs(wait_secs)).await;
    }
}

/// Connect to the backend
async fn connect_to_backend(
    state: &GatewayState,
) -> anyhow::Result<(
    futures_util::stream::SplitSink<
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
        Message,
    >,
    futures_util::stream::SplitStream<
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
    >,
)> {
    let (ws_stream, _) = connect_async(&state.config.backend.url).await?;
    Ok(ws_stream.split())
}

/// Handle a message from the backend
async fn handle_backend_message(text: &str, state: &GatewayState) -> anyhow::Result<()> {
    let msg: BackendToGatewayMessage = serde_json::from_str(text)?;

    match msg {
        BackendToGatewayMessage::Command(payload) => {
            debug!("Received command from backend");

            // Route to specific agent or by labels
            if let Some(agent_id) = payload.agent_id {
                if let Err(e) = state.registry.send_command(&agent_id, payload.command).await {
                    error!(error = %e, "Failed to send command to agent");
                }
            } else if let Some(labels) = payload.labels {
                let results = state
                    .registry
                    .send_command_to_labels(&labels, payload.command)
                    .await;

                for (agent_id, result) in results {
                    if let Err(e) = result {
                        error!(agent_id = %agent_id, error = %e, "Failed to send command");
                    }
                }
            }
        }
        BackendToGatewayMessage::Snapshot(payload) => {
            debug!(agent_id = %payload.agent_id, "Received snapshot for agent");

            // Forward snapshot to agent
            // TODO: Implement snapshot forwarding
        }
        BackendToGatewayMessage::Ping => {
            debug!("Received ping from backend");
        }
    }

    Ok(())
}
