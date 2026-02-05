//! Agent server module
//!
//! Handles WebSocket connections from agents.

use axum::extract::ws::{Message, WebSocket};
use chrono::Utc;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::mpsc;
use tracing::{debug, error, info, warn};

use crate::registry::{AgentCommand, AgentInfo};
use crate::{BackendMessage, GatewayState};

/// Messages from agents
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum AgentMessage {
    #[serde(rename = "register")]
    Register(RegisterPayload),
    #[serde(rename = "status_delta")]
    StatusDelta(serde_json::Value),
    #[serde(rename = "status_batch")]
    StatusBatch(StatusBatch),
    #[serde(rename = "command_response")]
    CommandResponse(serde_json::Value),
    #[serde(rename = "pong")]
    Pong,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegisterPayload {
    pub agent_id: String,
    pub hostname: String,
    pub labels: HashMap<String, String>,
    pub version: String,
    pub os: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatusBatch {
    pub deltas: Vec<serde_json::Value>,
}

/// Messages to agents
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum GatewayToAgentMessage {
    #[serde(rename = "snapshot")]
    Snapshot(serde_json::Value),
    #[serde(rename = "command")]
    Command(AgentCommand),
    #[serde(rename = "ping")]
    Ping,
    #[serde(rename = "config_update")]
    ConfigUpdate(serde_json::Value),
}

/// Handle an agent WebSocket connection
pub async fn handle_agent(socket: WebSocket, state: Arc<GatewayState>) {
    let (mut ws_sender, mut ws_receiver) = socket.split();

    // Wait for registration message
    let agent_info = match wait_for_registration(&mut ws_receiver).await {
        Some(info) => info,
        None => {
            warn!("Agent disconnected before registration");
            return;
        }
    };

    let agent_id = agent_info.id.clone();
    info!(agent_id = %agent_id, hostname = %agent_info.hostname, "Agent connected");

    // Create command channel
    let (cmd_tx, mut cmd_rx) = mpsc::channel::<AgentCommand>(100);

    // Register agent
    state.registry.register(agent_info.clone(), cmd_tx);

    // Notify backend
    let _ = state.backend_tx.send(BackendMessage::AgentConnected(agent_info.clone()));

    // Send initial snapshot (if available)
    // TODO: Get snapshot from backend for this agent

    // Handle messages
    loop {
        tokio::select! {
            // Receive from agent
            msg = ws_receiver.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        if let Err(e) = handle_agent_message(&text, &state, &agent_id).await {
                            error!(error = %e, agent_id = %agent_id, "Failed to handle agent message");
                        }
                    }
                    Some(Ok(Message::Binary(data))) => {
                        if let Ok(text) = String::from_utf8(data) {
                            if let Err(e) = handle_agent_message(&text, &state, &agent_id).await {
                                error!(error = %e, agent_id = %agent_id, "Failed to handle agent message");
                            }
                        }
                    }
                    Some(Ok(Message::Ping(data))) => {
                        if ws_sender.send(Message::Pong(data)).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(Message::Pong(_))) => {
                        state.registry.heartbeat(&agent_id);
                    }
                    Some(Ok(Message::Close(_))) => {
                        info!(agent_id = %agent_id, "Agent closed connection");
                        break;
                    }
                    Some(Err(e)) => {
                        error!(error = %e, agent_id = %agent_id, "WebSocket error");
                        break;
                    }
                    None => {
                        break;
                    }
                }
            }

            // Send command to agent
            cmd = cmd_rx.recv() => {
                if let Some(command) = cmd {
                    let msg = GatewayToAgentMessage::Command(command);
                    if let Ok(json) = serde_json::to_string(&msg) {
                        if ws_sender.send(Message::Text(json)).await.is_err() {
                            break;
                        }
                    }
                }
            }
        }
    }

    // Cleanup
    state.registry.unregister(&agent_id);
    let _ = state.backend_tx.send(BackendMessage::AgentDisconnected(agent_id.clone()));

    info!(agent_id = %agent_id, "Agent disconnected");
}

/// Wait for agent registration message
async fn wait_for_registration(
    receiver: &mut futures_util::stream::SplitStream<WebSocket>,
) -> Option<AgentInfo> {
    // Wait up to 30 seconds for registration
    let timeout = tokio::time::Duration::from_secs(30);

    match tokio::time::timeout(timeout, receiver.next()).await {
        Ok(Some(Ok(Message::Text(text)))) => {
            if let Ok(AgentMessage::Register(payload)) = serde_json::from_str(&text) {
                Some(AgentInfo {
                    id: payload.agent_id,
                    hostname: payload.hostname,
                    labels: payload.labels,
                    version: payload.version,
                    os: payload.os,
                    connected_at: Utc::now(),
                    last_heartbeat: Utc::now(),
                    tx: None,
                })
            } else {
                warn!("First message was not registration");
                None
            }
        }
        _ => None,
    }
}

/// Handle a message from an agent
async fn handle_agent_message(
    text: &str,
    state: &GatewayState,
    agent_id: &str,
) -> anyhow::Result<()> {
    let msg: AgentMessage = serde_json::from_str(text)?;

    match msg {
        AgentMessage::Register(_) => {
            // Already registered, ignore
            debug!(agent_id = %agent_id, "Duplicate registration ignored");
        }
        AgentMessage::StatusDelta(delta) => {
            debug!(agent_id = %agent_id, "Received status delta");
            let _ = state.backend_tx.send(BackendMessage::StatusUpdate(delta));
        }
        AgentMessage::StatusBatch(batch) => {
            debug!(
                agent_id = %agent_id,
                count = batch.deltas.len(),
                "Received status batch"
            );
            for delta in batch.deltas {
                let _ = state.backend_tx.send(BackendMessage::StatusUpdate(delta));
            }
        }
        AgentMessage::CommandResponse(response) => {
            debug!(agent_id = %agent_id, "Received command response");
            let _ = state.backend_tx.send(BackendMessage::CommandResponse(response));
        }
        AgentMessage::Pong => {
            state.registry.heartbeat(agent_id);
        }
    }

    Ok(())
}
