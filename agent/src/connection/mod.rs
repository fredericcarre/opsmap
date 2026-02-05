//! Gateway connection module
//!
//! Handles WebSocket connection to the Gateway with automatic reconnection
//! and fallback to HTTPS polling.

use anyhow::{anyhow, Context, Result};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::net::TcpStream;
use tokio_tungstenite::{
    connect_async_tls_with_config,
    tungstenite::protocol::Message,
    MaybeTlsStream, WebSocketStream,
};
use tracing::{debug, error, info, warn};

use crate::config::AgentConfig;

/// Message types from the Gateway
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum GatewayMessage {
    #[serde(rename = "snapshot")]
    Snapshot(Snapshot),
    #[serde(rename = "command")]
    Command(Command),
    #[serde(rename = "ping")]
    Ping,
    #[serde(rename = "config_update")]
    ConfigUpdate(ConfigUpdate),
}

/// Snapshot of components this agent should manage
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snapshot {
    pub version: u64,
    pub components: Vec<ComponentSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComponentSnapshot {
    pub id: String,
    pub name: String,
    pub component_type: String,
    pub checks: Vec<CheckDefinition>,
    pub actions: Vec<ActionDefinition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckDefinition {
    pub name: String,
    pub check_type: String,
    pub config: serde_json::Value,
    pub interval_secs: u64,
    pub timeout_secs: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionDefinition {
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub run_as_user: Option<String>,
    #[serde(default)]
    pub is_async: bool,
    #[serde(default)]
    pub confirmation_required: bool,
}

/// Command to execute
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Command {
    pub id: String,
    pub command_type: String,
    pub component_id: String,
    pub action_name: Option<String>,
    pub params: serde_json::Value,
    pub timeout_secs: u64,
}

/// Configuration update from Gateway
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigUpdate {
    pub check_interval_secs: Option<u64>,
}

/// Messages sent to the Gateway
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum AgentMessage {
    #[serde(rename = "register")]
    Register(RegisterPayload),
    #[serde(rename = "status_delta")]
    StatusDelta(StatusDelta),
    #[serde(rename = "status_batch")]
    StatusBatch(StatusBatch),
    #[serde(rename = "command_response")]
    CommandResponse(CommandResponse),
    #[serde(rename = "pong")]
    Pong,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegisterPayload {
    pub agent_id: String,
    pub hostname: String,
    pub labels: std::collections::HashMap<String, String>,
    pub version: String,
    pub os: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatusDelta {
    pub component_id: String,
    pub check_name: String,
    pub status: String,
    pub message: Option<String>,
    pub metrics: Option<serde_json::Value>,
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatusBatch {
    pub deltas: Vec<StatusDelta>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandResponse {
    pub command_id: String,
    pub success: bool,
    pub result: Option<CommandResult>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u64,
    pub job_id: Option<String>,
}

/// Gateway connection
pub struct GatewayConnection {
    ws: WebSocketStream<MaybeTlsStream<TcpStream>>,
    agent_id: String,
}

impl GatewayConnection {
    /// Connect to the Gateway
    pub async fn connect(config: &AgentConfig) -> Result<Self> {
        let url = &config.gateway.url;
        info!(url = %url, "Connecting to Gateway");

        // Connect with TLS if configured
        let (ws, response) = if config.tls.enabled {
            let connector = build_tls_connector(config)?;
            connect_async_tls_with_config(url, None, false, Some(connector))
                .await
                .context("Failed to connect to Gateway")?
        } else {
            tokio_tungstenite::connect_async(url)
                .await
                .context("Failed to connect to Gateway")?
        };

        debug!(
            status = %response.status(),
            "WebSocket connection established"
        );

        let mut connection = Self {
            ws,
            agent_id: config.agent.id.clone(),
        };

        // Register with Gateway
        connection.register(config).await?;

        Ok(connection)
    }

    /// Register this agent with the Gateway
    async fn register(&mut self, config: &AgentConfig) -> Result<()> {
        let hostname = config
            .agent
            .hostname
            .clone()
            .or_else(|| hostname::get().ok().map(|h| h.to_string_lossy().to_string()))
            .unwrap_or_else(|| "unknown".to_string());

        let os = std::env::consts::OS.to_string();

        let payload = RegisterPayload {
            agent_id: config.agent.id.clone(),
            hostname,
            labels: config.labels.clone(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            os,
        };

        let msg = AgentMessage::Register(payload);
        self.send_message(&msg).await?;

        info!(agent_id = %config.agent.id, "Registered with Gateway");
        Ok(())
    }

    /// Send a message to the Gateway
    pub async fn send_message<T: Serialize>(&mut self, message: &T) -> Result<()> {
        let json = serde_json::to_string(message)?;
        self.ws.send(Message::Text(json)).await?;
        Ok(())
    }

    /// Receive a message from the Gateway
    pub async fn receive_message(&mut self) -> Result<Option<GatewayMessage>> {
        match self.ws.next().await {
            Some(Ok(Message::Text(text))) => {
                let msg: GatewayMessage = serde_json::from_str(&text)
                    .context("Failed to parse Gateway message")?;
                Ok(Some(msg))
            }
            Some(Ok(Message::Binary(data))) => {
                let msg: GatewayMessage = serde_json::from_slice(&data)
                    .context("Failed to parse Gateway message")?;
                Ok(Some(msg))
            }
            Some(Ok(Message::Ping(_))) => {
                // Respond to ping
                self.ws.send(Message::Pong(vec![])).await?;
                Ok(None)
            }
            Some(Ok(Message::Pong(_))) => Ok(None),
            Some(Ok(Message::Close(_))) => {
                info!("Gateway closed connection");
                Ok(None)
            }
            Some(Ok(Message::Frame(_))) => Ok(None),
            Some(Err(e)) => Err(anyhow!("WebSocket error: {}", e)),
            None => {
                info!("WebSocket stream ended");
                Ok(None)
            }
        }
    }

    /// Send a status delta
    pub async fn send_status_delta(&mut self, delta: StatusDelta) -> Result<()> {
        let msg = AgentMessage::StatusDelta(delta);
        self.send_message(&msg).await
    }

    /// Send a batch of status updates
    pub async fn send_status_batch(&mut self, deltas: Vec<StatusDelta>) -> Result<()> {
        let msg = AgentMessage::StatusBatch(StatusBatch { deltas });
        self.send_message(&msg).await
    }

    /// Send a command response
    pub async fn send_command_response(&mut self, response: CommandResponse) -> Result<()> {
        let msg = AgentMessage::CommandResponse(response);
        self.send_message(&msg).await
    }

    /// Send pong
    pub async fn send_pong(&mut self) -> Result<()> {
        let msg = AgentMessage::Pong;
        self.send_message(&msg).await
    }
}

/// Build TLS connector with mTLS support
fn build_tls_connector(config: &AgentConfig) -> Result<tokio_tungstenite::Connector> {
    use native_tls::{Identity, TlsConnector};

    let mut builder = TlsConnector::builder();

    // Load client certificate for mTLS
    if let (Some(cert_file), Some(key_file)) = (&config.tls.cert_file, &config.tls.key_file) {
        let cert_pem = std::fs::read(cert_file)
            .with_context(|| format!("Failed to read certificate: {}", cert_file))?;
        let key_pem = std::fs::read(key_file)
            .with_context(|| format!("Failed to read key: {}", key_file))?;

        // Combine cert and key for PKCS12
        let identity = Identity::from_pkcs8(&cert_pem, &key_pem)
            .context("Failed to create identity from cert/key")?;
        builder.identity(identity);
    }

    // Load CA certificate
    if let Some(ca_file) = &config.tls.ca_file {
        let ca_pem = std::fs::read(ca_file)
            .with_context(|| format!("Failed to read CA certificate: {}", ca_file))?;
        let ca_cert = native_tls::Certificate::from_pem(&ca_pem)
            .context("Failed to parse CA certificate")?;
        builder.add_root_certificate(ca_cert);
    }

    // Disable server verification if configured (NOT recommended for production)
    if !config.tls.verify_server {
        warn!("TLS server verification is disabled - NOT recommended for production");
        builder.danger_accept_invalid_certs(true);
    }

    let connector = builder.build().context("Failed to build TLS connector")?;

    Ok(tokio_tungstenite::Connector::NativeTls(connector))
}
