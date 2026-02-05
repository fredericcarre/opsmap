//! OpsMap Agent - Lightweight monitoring and control agent
//!
//! The agent connects to a Gateway via WebSocket and:
//! - Receives snapshots of components to manage
//! - Executes checks locally on a schedule
//! - Sends status deltas to the Gateway
//! - Executes commands (start/stop/restart) with process detachment

mod config;
mod connection;
mod executor;
mod scheduler;
mod native_commands;
mod buffer;

use anyhow::Result;
use clap::Parser;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{info, error, warn};

use crate::config::AgentConfig;
use crate::connection::GatewayConnection;
use crate::scheduler::CheckScheduler;
use crate::buffer::OfflineBuffer;

/// OpsMap Agent CLI
#[derive(Parser, Debug)]
#[command(name = "opsmap-agent")]
#[command(about = "OpsMap Agent - Monitoring and control agent")]
#[command(version)]
struct Args {
    /// Path to configuration file
    #[arg(short, long, default_value = "/etc/opsmap/agent.yaml")]
    config: PathBuf,

    /// Override gateway URL
    #[arg(long)]
    gateway_url: Option<String>,

    /// Override agent ID
    #[arg(long)]
    agent_id: Option<String>,

    /// Run in foreground (don't daemonize)
    #[arg(short, long)]
    foreground: bool,

    /// Log level (trace, debug, info, warn, error)
    #[arg(long, default_value = "info")]
    log_level: String,
}

/// Agent state shared across components
pub struct AgentState {
    pub config: AgentConfig,
    pub connection: Option<GatewayConnection>,
    pub buffer: OfflineBuffer,
    pub is_connected: bool,
}

impl AgentState {
    pub fn new(config: AgentConfig) -> Self {
        Self {
            buffer: OfflineBuffer::new(config.buffer.max_size),
            config,
            connection: None,
            is_connected: false,
        }
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();

    // Initialize logging
    init_logging(&args.log_level)?;

    info!(
        version = env!("CARGO_PKG_VERSION"),
        config_path = %args.config.display(),
        "Starting OpsMap Agent"
    );

    // Load configuration
    let mut config = config::load_config(&args.config)?;

    // Apply CLI overrides
    if let Some(url) = args.gateway_url {
        config.gateway.url = url;
    }
    if let Some(id) = args.agent_id {
        config.agent.id = id;
    }

    // Auto-generate agent ID if not set
    if config.agent.id.is_empty() || config.agent.id == "auto" {
        config.agent.id = generate_agent_id();
        info!(agent_id = %config.agent.id, "Generated agent ID");
    }

    // Create shared state
    let state = Arc::new(RwLock::new(AgentState::new(config)));

    // Create scheduler (separate from state since it has its own internal mutex)
    let scheduler = Arc::new(CheckScheduler::new());

    // Start main loop
    run_agent(state, scheduler).await
}

/// Main agent loop
async fn run_agent(state: Arc<RwLock<AgentState>>, scheduler: Arc<CheckScheduler>) -> Result<()> {
    loop {
        // Try to connect to Gateway
        match connect_to_gateway(state.clone()).await {
            Ok(()) => {
                info!("Connected to Gateway");

                // Run while connected
                if let Err(e) = run_connected(state.clone(), scheduler.clone()).await {
                    error!(error = %e, "Connection error");
                }
            }
            Err(e) => {
                warn!(error = %e, "Failed to connect to Gateway");
            }
        }

        // Update connection status
        {
            let mut state = state.write().await;
            state.is_connected = false;
        }

        // Wait before reconnecting
        let reconnect_interval = {
            let state = state.read().await;
            state.config.gateway.reconnect_interval_secs
        };

        info!(
            interval_secs = reconnect_interval,
            "Waiting before reconnection attempt"
        );
        tokio::time::sleep(tokio::time::Duration::from_secs(reconnect_interval)).await;
    }
}

/// Connect to the Gateway
async fn connect_to_gateway(state: Arc<RwLock<AgentState>>) -> Result<()> {
    let config = {
        let state = state.read().await;
        state.config.clone()
    };

    let connection = GatewayConnection::connect(&config).await?;

    {
        let mut state = state.write().await;
        state.connection = Some(connection);
        state.is_connected = true;
    }

    Ok(())
}

/// Run while connected to Gateway
async fn run_connected(state: Arc<RwLock<AgentState>>, scheduler: Arc<CheckScheduler>) -> Result<()> {
    // Start scheduler
    let scheduler_state = state.clone();
    let scheduler_ref = scheduler.clone();
    let scheduler_handle = tokio::spawn(async move {
        scheduler_ref.run(scheduler_state).await
    });

    // Handle messages from Gateway
    let message_state = state.clone();
    let message_scheduler = scheduler.clone();
    let message_handle = tokio::spawn(async move {
        loop {
            let result = {
                let mut state = message_state.write().await;
                if let Some(ref mut conn) = state.connection {
                    conn.receive_message().await
                } else {
                    break;
                }
            };

            match result {
                Ok(Some(msg)) => {
                    if let Err(e) = handle_gateway_message(message_state.clone(), message_scheduler.clone(), msg).await {
                        error!(error = %e, "Failed to handle message");
                    }
                }
                Ok(None) => {
                    // Connection closed
                    break;
                }
                Err(e) => {
                    error!(error = %e, "Error receiving message");
                    break;
                }
            }
        }
    });

    // Send buffered data
    let buffer_state = state.clone();
    let buffer_handle = tokio::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;

            // Pop data from buffer first, then send
            loop {
                let data = {
                    let mut state = buffer_state.write().await;
                    if !state.is_connected {
                        break;
                    }
                    state.buffer.pop()
                };

                let Some(data) = data else { break };

                let mut state = buffer_state.write().await;
                if let Some(ref mut conn) = state.connection {
                    if let Err(e) = conn.send_message(&data).await {
                        // Put back in buffer and break
                        state.buffer.push(data);
                        error!(error = %e, "Failed to send buffered data");
                        break;
                    }
                } else {
                    // No connection, put data back
                    state.buffer.push(data);
                    break;
                }
            }
        }
    });

    // Wait for any task to complete (indicates disconnection)
    tokio::select! {
        _ = scheduler_handle => {},
        _ = message_handle => {},
        _ = buffer_handle => {},
    }

    Ok(())
}

/// Handle a message from the Gateway
async fn handle_gateway_message(
    state: Arc<RwLock<AgentState>>,
    scheduler: Arc<CheckScheduler>,
    message: connection::GatewayMessage,
) -> Result<()> {
    use connection::GatewayMessage;

    match message {
        GatewayMessage::Snapshot(snapshot) => {
            info!(
                components = snapshot.components.len(),
                "Received snapshot"
            );

            scheduler.update_snapshot(snapshot).await;
        }
        GatewayMessage::Command(cmd) => {
            info!(
                command_id = %cmd.id,
                command_type = %cmd.command_type,
                "Received command"
            );

            // Get agent_id for response
            let agent_id = {
                let s = state.read().await;
                s.config.agent.id.clone()
            };

            // Send "started" response immediately for async commands
            if matches!(cmd.command_type.as_str(), "start" | "stop" | "restart" | "action") {
                let mut s = state.write().await;
                if let Some(ref mut conn) = s.connection {
                    let started_response = connection::CommandResponse {
                        job_id: cmd.id.clone(),
                        agent_id: agent_id.clone(),
                        status: "started".to_string(),
                        result: None,
                        error: None,
                        timestamp: chrono::Utc::now(),
                    };
                    conn.send_command_response(started_response).await?;
                }
            }

            // Execute command
            let exec_result = executor::execute_command(&cmd).await;

            // Build response based on result
            let (status, result, error) = match exec_result {
                Ok(cmd_result) => {
                    let result = connection::CommandResult {
                        exit_code: cmd_result.exit_code,
                        stdout: cmd_result.stdout,
                        stderr: cmd_result.stderr,
                        duration_ms: cmd_result.duration_ms,
                        timed_out: false,
                    };
                    let status = if cmd_result.exit_code == 0 { "completed" } else { "failed" };
                    (status.to_string(), Some(result), None)
                }
                Err(e) => {
                    let error_msg = e.to_string();
                    let timed_out = error_msg.contains("timed out");
                    let status = if timed_out { "timeout" } else { "failed" };
                    (status.to_string(), None, Some(error_msg))
                }
            };

            // Send final result
            let mut s = state.write().await;
            let response = connection::CommandResponse {
                job_id: cmd.id,
                agent_id,
                status,
                result,
                error,
                timestamp: chrono::Utc::now(),
            };

            if let Some(ref mut conn) = s.connection {
                conn.send_command_response(response).await?;
            }
        }
        GatewayMessage::Ping => {
            let mut state = state.write().await;
            if let Some(ref mut conn) = state.connection {
                conn.send_pong().await?;
            }
        }
        GatewayMessage::ConfigUpdate(new_config) => {
            info!("Received configuration update");
            let mut state = state.write().await;
            // Apply relevant config updates
            if let Some(interval) = new_config.check_interval_secs {
                state.config.scheduler.default_check_interval_secs = interval;
            }
        }
    }

    Ok(())
}

/// Initialize logging
fn init_logging(level: &str) -> Result<()> {
    use tracing_subscriber::{fmt, EnvFilter};

    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(level));

    fmt()
        .with_env_filter(filter)
        .with_target(true)
        .with_thread_ids(false)
        .with_file(true)
        .with_line_number(true)
        .json()
        .init();

    Ok(())
}

/// Generate a unique agent ID based on hostname and random suffix
fn generate_agent_id() -> String {
    let hostname = hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "unknown".to_string());

    let suffix = uuid::Uuid::new_v4().to_string()[..8].to_string();

    format!("{}-{}", hostname, suffix)
}
