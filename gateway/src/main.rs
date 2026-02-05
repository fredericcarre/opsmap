//! OpsMap Gateway - Zone relay between agents and backend
//!
//! The Gateway:
//! - Accepts WebSocket connections from Agents
//! - Maintains a registry of connected agents
//! - Connects to the Backend via WebSocket
//! - Routes commands from Backend to appropriate Agents
//! - Aggregates and forwards agent status updates to Backend

mod agent_server;
mod backend_client;
mod registry;
mod router;

use anyhow::Result;
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    routing::get,
    Router,
};
use clap::Parser;
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};
use tracing::{error, info, warn};

use registry::{AgentInfo, AgentRegistry};

/// Gateway configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayConfig {
    pub gateway: GatewaySettings,
    pub backend: BackendSettings,
    pub tls: TlsSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewaySettings {
    pub id: String,
    pub zone: String,
    pub listen_addr: String,
    #[serde(default = "default_listen_port")]
    pub listen_port: u16,
}

fn default_listen_port() -> u16 {
    8443
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackendSettings {
    pub url: String,
    #[serde(default = "default_reconnect_interval")]
    pub reconnect_interval_secs: u64,
}

fn default_reconnect_interval() -> u64 {
    5
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TlsSettings {
    pub enabled: bool,
    pub cert_file: Option<String>,
    pub key_file: Option<String>,
    pub ca_file: Option<String>,
    #[serde(default = "default_verify_clients")]
    pub verify_clients: bool,
}

fn default_verify_clients() -> bool {
    true
}

impl Default for GatewayConfig {
    fn default() -> Self {
        Self {
            gateway: GatewaySettings {
                id: "gateway-1".to_string(),
                zone: "default".to_string(),
                listen_addr: "0.0.0.0".to_string(),
                listen_port: 8443,
            },
            backend: BackendSettings {
                url: "wss://backend.opsmap.local:443/gateway".to_string(),
                reconnect_interval_secs: 5,
            },
            tls: TlsSettings {
                enabled: true,
                cert_file: Some("/etc/opsmap/certs/gateway.crt".to_string()),
                key_file: Some("/etc/opsmap/certs/gateway.key".to_string()),
                ca_file: Some("/etc/opsmap/certs/ca.crt".to_string()),
                verify_clients: true,
            },
        }
    }
}

/// Gateway CLI
#[derive(Parser, Debug)]
#[command(name = "opsmap-gateway")]
#[command(about = "OpsMap Gateway - Zone relay")]
#[command(version)]
struct Args {
    /// Path to configuration file
    #[arg(short, long, default_value = "/etc/opsmap/gateway.yaml")]
    config: PathBuf,

    /// Override zone name
    #[arg(long)]
    zone: Option<String>,

    /// Log level
    #[arg(long, default_value = "info")]
    log_level: String,
}

/// Shared gateway state
pub struct GatewayState {
    pub config: GatewayConfig,
    pub registry: AgentRegistry,
    pub backend_tx: broadcast::Sender<BackendMessage>,
}

/// Message types for internal communication
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum BackendMessage {
    AgentConnected(AgentInfo),
    AgentDisconnected(String),
    StatusUpdate(serde_json::Value),
    CommandResponse(serde_json::Value),
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();

    // Initialize logging
    init_logging(&args.log_level)?;

    info!(
        version = env!("CARGO_PKG_VERSION"),
        config_path = %args.config.display(),
        "Starting OpsMap Gateway"
    );

    // Load configuration
    let mut config = load_config(&args.config)?;

    if let Some(zone) = args.zone {
        config.gateway.zone = zone;
    }

    info!(
        gateway_id = %config.gateway.id,
        zone = %config.gateway.zone,
        "Gateway configured"
    );

    // Create shared state
    let (backend_tx, _) = broadcast::channel(1000);
    let state = Arc::new(GatewayState {
        config: config.clone(),
        registry: AgentRegistry::new(),
        backend_tx,
    });

    // Start backend connection
    let backend_state = state.clone();
    tokio::spawn(async move {
        backend_client::run(backend_state).await;
    });

    // Build HTTP/WebSocket router
    let app = Router::new()
        .route("/ws", get(agent_ws_handler))
        .route("/health", get(health_handler))
        .route("/metrics", get(metrics_handler))
        .route("/agents", get(agents_handler))
        .with_state(state.clone());

    // Start server
    let addr: SocketAddr = format!(
        "{}:{}",
        config.gateway.listen_addr, config.gateway.listen_port
    )
    .parse()?;

    info!(addr = %addr, "Starting Gateway server");

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

/// WebSocket handler for agent connections
async fn agent_ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<GatewayState>>,
) -> impl axum::response::IntoResponse {
    ws.on_upgrade(move |socket| agent_server::handle_agent(socket, state))
}

/// Health check endpoint
async fn health_handler() -> &'static str {
    "ok"
}

/// Metrics endpoint (Prometheus format)
async fn metrics_handler(State(state): State<Arc<GatewayState>>) -> String {
    let agents = state.registry.count();

    format!(
        "# HELP opsmap_gateway_connected_agents Number of connected agents\n\
         # TYPE opsmap_gateway_connected_agents gauge\n\
         opsmap_gateway_connected_agents {}\n",
        agents
    )
}

/// List connected agents
async fn agents_handler(State(state): State<Arc<GatewayState>>) -> axum::Json<Vec<AgentInfo>> {
    let agents = state.registry.list();
    axum::Json(agents)
}

/// Initialize logging
fn init_logging(level: &str) -> Result<()> {
    use tracing_subscriber::{fmt, EnvFilter};

    let filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(level));

    fmt()
        .with_env_filter(filter)
        .with_target(true)
        .json()
        .init();

    Ok(())
}

/// Load configuration from file
fn load_config(path: &PathBuf) -> Result<GatewayConfig> {
    if path.exists() {
        let content = std::fs::read_to_string(path)?;
        let config: GatewayConfig = serde_yaml::from_str(&content)?;
        Ok(config)
    } else {
        warn!(path = %path.display(), "Config file not found, using defaults");
        Ok(GatewayConfig::default())
    }
}
