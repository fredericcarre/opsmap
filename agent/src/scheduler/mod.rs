//! Check scheduler module
//!
//! Executes checks locally on a schedule and sends deltas to the Gateway.
//! Only sends data when status changes or periodically for metrics.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio::time::{interval, Duration, Instant};
use tracing::{debug, error, info, warn};

use crate::connection::{CheckDefinition, ComponentSnapshot, Snapshot, StatusDelta};
use crate::native_commands::{execute_native, NativeResult};
use crate::AgentState;

/// Check scheduler
pub struct CheckScheduler {
    snapshot: Option<Snapshot>,
    last_status: HashMap<String, String>, // component_id:check_name -> status
    last_sent: HashMap<String, Instant>,  // component_id:check_name -> last sent time
}

impl CheckScheduler {
    pub fn new() -> Self {
        Self {
            snapshot: None,
            last_status: HashMap::new(),
            last_sent: HashMap::new(),
        }
    }

    /// Update the snapshot of components to manage
    pub fn update_snapshot(&mut self, snapshot: Snapshot) {
        info!(
            version = snapshot.version,
            components = snapshot.components.len(),
            "Updated snapshot"
        );
        self.snapshot = Some(snapshot);
    }

    /// Run the scheduler
    pub async fn run(&self, state: Arc<RwLock<AgentState>>) {
        let mut ticker = interval(Duration::from_secs(1));
        let mut batch_ticker = interval(Duration::from_secs(60));
        let mut pending_deltas: Vec<StatusDelta> = Vec::new();

        loop {
            tokio::select! {
                _ = ticker.tick() => {
                    // Check which checks need to run
                    let checks_to_run = self.get_due_checks().await;

                    for (component, check) in checks_to_run {
                        let result = self.execute_check(&check).await;

                        if let Some(delta) = self.process_result(&component, &check, result).await {
                            // Check if status changed
                            let key = format!("{}:{}", component.id, check.name);
                            let status_changed = self.last_status.get(&key)
                                .map(|s| s != &delta.status)
                                .unwrap_or(true);

                            if status_changed {
                                // Send immediately on status change
                                let mut state = state.write().await;
                                if let Some(ref mut conn) = state.connection {
                                    if let Err(e) = conn.send_status_delta(delta.clone()).await {
                                        warn!(error = %e, "Failed to send delta, buffering");
                                        state.buffer.push(serde_json::to_value(&delta).unwrap());
                                    }
                                } else {
                                    state.buffer.push(serde_json::to_value(&delta).unwrap());
                                }
                            } else {
                                // Buffer for batch sending
                                pending_deltas.push(delta);
                            }
                        }
                    }
                }
                _ = batch_ticker.tick() => {
                    // Send batched deltas
                    if !pending_deltas.is_empty() {
                        let deltas = std::mem::take(&mut pending_deltas);

                        let mut state = state.write().await;
                        if let Some(ref mut conn) = state.connection {
                            if let Err(e) = conn.send_status_batch(deltas.clone()).await {
                                warn!(error = %e, "Failed to send batch, buffering");
                                for delta in deltas {
                                    state.buffer.push(serde_json::to_value(&delta).unwrap());
                                }
                            }
                        } else {
                            for delta in deltas {
                                state.buffer.push(serde_json::to_value(&delta).unwrap());
                            }
                        }
                    }
                }
            }
        }
    }

    /// Get checks that are due to run
    async fn get_due_checks(&self) -> Vec<(ComponentSnapshot, CheckDefinition)> {
        let mut due = Vec::new();

        if let Some(ref snapshot) = self.snapshot {
            let now = Instant::now();

            for component in &snapshot.components {
                for check in &component.checks {
                    let key = format!("{}:{}", component.id, check.name);
                    let last_run = self.last_sent.get(&key).copied();

                    let should_run = match last_run {
                        None => true,
                        Some(last) => now.duration_since(last).as_secs() >= check.interval_secs,
                    };

                    if should_run {
                        due.push((component.clone(), check.clone()));
                    }
                }
            }
        }

        due
    }

    /// Execute a single check
    async fn execute_check(&self, check: &CheckDefinition) -> Result<NativeResult, String> {
        debug!(check = %check.name, check_type = %check.check_type, "Executing check");

        // For native checks, use the native_commands module
        if check.check_type.starts_with("native:") || !check.check_type.contains(':') {
            let native_type = check.check_type.strip_prefix("native:").unwrap_or(&check.check_type);
            match execute_native(native_type, &check.config) {
                Ok(result) => Ok(result),
                Err(e) => Err(e.to_string()),
            }
        } else {
            // For shell checks, execute via shell
            match self.execute_shell_check(check).await {
                Ok(result) => Ok(result),
                Err(e) => Err(e.to_string()),
            }
        }
    }

    /// Execute a shell-based check
    async fn execute_shell_check(&self, check: &CheckDefinition) -> anyhow::Result<NativeResult> {
        use tokio::process::Command;
        use tokio::time::timeout;

        let command = check.config
            .get("command")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing command in check config"))?;

        let start = std::time::Instant::now();

        let result = timeout(
            Duration::from_secs(check.timeout_secs),
            Command::new("sh")
                .arg("-c")
                .arg(command)
                .output()
        ).await;

        let duration_ms = start.elapsed().as_millis() as u64;

        match result {
            Ok(Ok(output)) => {
                let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                let exit_code = output.status.code().unwrap_or(-1);

                let status = if output.status.success() {
                    "ok"
                } else {
                    "error"
                };

                Ok(NativeResult {
                    status: status.to_string(),
                    message: Some(if stdout.is_empty() { stderr } else { stdout }),
                    metrics: serde_json::json!({
                        "exit_code": exit_code,
                        "duration_ms": duration_ms,
                    }),
                })
            }
            Ok(Err(e)) => Ok(NativeResult {
                status: "error".to_string(),
                message: Some(format!("Failed to execute: {}", e)),
                metrics: serde_json::json!({
                    "error": e.to_string(),
                    "duration_ms": duration_ms,
                }),
            }),
            Err(_) => Ok(NativeResult {
                status: "error".to_string(),
                message: Some(format!("Check timed out after {}s", check.timeout_secs)),
                metrics: serde_json::json!({
                    "timeout": true,
                    "duration_ms": duration_ms,
                }),
            }),
        }
    }

    /// Process a check result and create a delta if needed
    async fn process_result(
        &self,
        component: &ComponentSnapshot,
        check: &CheckDefinition,
        result: Result<NativeResult, String>,
    ) -> Option<StatusDelta> {
        let (status, message, metrics) = match result {
            Ok(native_result) => (
                native_result.status,
                native_result.message,
                Some(native_result.metrics),
            ),
            Err(e) => (
                "error".to_string(),
                Some(format!("Check failed: {}", e)),
                None,
            ),
        };

        Some(StatusDelta {
            component_id: component.id.clone(),
            check_name: check.name.clone(),
            status,
            message,
            metrics: metrics.unwrap_or(serde_json::Value::Null),
            timestamp: chrono::Utc::now(),
        })
    }
}

impl Default for CheckScheduler {
    fn default() -> Self {
        Self::new()
    }
}
