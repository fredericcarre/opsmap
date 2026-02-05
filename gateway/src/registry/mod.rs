//! Agent registry module
//!
//! Maintains a registry of connected agents and their metadata.

use chrono::{DateTime, Utc};
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::mpsc;
use tracing::{debug, info, warn};

/// Information about a connected agent
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentInfo {
    pub id: String,
    pub hostname: String,
    pub labels: HashMap<String, String>,
    pub version: String,
    pub os: String,
    pub connected_at: DateTime<Utc>,
    pub last_heartbeat: DateTime<Utc>,
    #[serde(skip)]
    pub tx: Option<mpsc::Sender<AgentCommand>>,
}

/// Command to send to an agent
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentCommand {
    pub id: String,
    pub command_type: String,
    pub component_id: String,
    pub action_name: Option<String>,
    pub params: serde_json::Value,
    pub timeout_secs: u64,
}

/// Agent registry
pub struct AgentRegistry {
    agents: DashMap<String, AgentInfo>,
}

impl AgentRegistry {
    pub fn new() -> Self {
        Self {
            agents: DashMap::new(),
        }
    }

    /// Register a new agent
    pub fn register(&self, mut info: AgentInfo, tx: mpsc::Sender<AgentCommand>) {
        info.tx = Some(tx);
        info!(
            agent_id = %info.id,
            hostname = %info.hostname,
            version = %info.version,
            "Agent registered"
        );
        self.agents.insert(info.id.clone(), info);
    }

    /// Unregister an agent
    pub fn unregister(&self, agent_id: &str) {
        if let Some((_, info)) = self.agents.remove(agent_id) {
            info!(
                agent_id = %agent_id,
                hostname = %info.hostname,
                "Agent unregistered"
            );
        }
    }

    /// Get agent info
    pub fn get(&self, agent_id: &str) -> Option<AgentInfo> {
        self.agents.get(agent_id).map(|r| r.clone())
    }

    /// Update agent heartbeat
    pub fn heartbeat(&self, agent_id: &str) {
        if let Some(mut agent) = self.agents.get_mut(agent_id) {
            agent.last_heartbeat = Utc::now();
            debug!(agent_id = %agent_id, "Agent heartbeat");
        }
    }

    /// List all agents
    pub fn list(&self) -> Vec<AgentInfo> {
        self.agents.iter().map(|r| r.clone()).collect()
    }

    /// Count connected agents
    pub fn count(&self) -> usize {
        self.agents.len()
    }

    /// Find agents matching labels
    pub fn find_by_labels(&self, labels: &HashMap<String, String>) -> Vec<AgentInfo> {
        self.agents
            .iter()
            .filter(|agent| {
                labels.iter().all(|(k, v)| {
                    agent.labels.get(k).map_or(false, |av| av == v)
                })
            })
            .map(|r| r.clone())
            .collect()
    }

    /// Find agent by hostname
    pub fn find_by_hostname(&self, hostname: &str) -> Option<AgentInfo> {
        self.agents
            .iter()
            .find(|agent| agent.hostname == hostname)
            .map(|r| r.clone())
    }

    /// Send command to specific agent
    pub async fn send_command(&self, agent_id: &str, command: AgentCommand) -> Result<(), String> {
        if let Some(agent) = self.agents.get(agent_id) {
            if let Some(ref tx) = agent.tx {
                tx.send(command)
                    .await
                    .map_err(|e| format!("Failed to send command: {}", e))?;
                Ok(())
            } else {
                Err("Agent has no command channel".to_string())
            }
        } else {
            Err(format!("Agent not found: {}", agent_id))
        }
    }

    /// Send command to agents matching labels
    pub async fn send_command_to_labels(
        &self,
        labels: &HashMap<String, String>,
        command: AgentCommand,
    ) -> Vec<(String, Result<(), String>)> {
        let agents = self.find_by_labels(labels);
        let mut results = Vec::new();

        for agent in agents {
            let result = self.send_command(&agent.id, command.clone()).await;
            results.push((agent.id, result));
        }

        results
    }

    /// Remove stale agents (no heartbeat for given duration)
    pub fn cleanup_stale(&self, max_age_secs: u64) {
        let cutoff = Utc::now() - chrono::Duration::seconds(max_age_secs as i64);
        let stale: Vec<String> = self
            .agents
            .iter()
            .filter(|agent| agent.last_heartbeat < cutoff)
            .map(|agent| agent.id.clone())
            .collect();

        for agent_id in stale {
            warn!(agent_id = %agent_id, "Removing stale agent");
            self.unregister(&agent_id);
        }
    }
}

impl Default for AgentRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_register_unregister() {
        let registry = AgentRegistry::new();
        let (tx, _rx) = mpsc::channel(10);

        let info = AgentInfo {
            id: "agent-1".to_string(),
            hostname: "host-1".to_string(),
            labels: HashMap::new(),
            version: "1.0".to_string(),
            os: "linux".to_string(),
            connected_at: Utc::now(),
            last_heartbeat: Utc::now(),
            tx: None,
        };

        registry.register(info, tx);
        assert_eq!(registry.count(), 1);

        registry.unregister("agent-1");
        assert_eq!(registry.count(), 0);
    }

    #[test]
    fn test_find_by_labels() {
        let registry = AgentRegistry::new();
        let (tx, _rx) = mpsc::channel(10);

        let mut labels = HashMap::new();
        labels.insert("role".to_string(), "database".to_string());

        let info = AgentInfo {
            id: "agent-1".to_string(),
            hostname: "host-1".to_string(),
            labels: labels.clone(),
            version: "1.0".to_string(),
            os: "linux".to_string(),
            connected_at: Utc::now(),
            last_heartbeat: Utc::now(),
            tx: None,
        };

        registry.register(info, tx);

        let found = registry.find_by_labels(&labels);
        assert_eq!(found.len(), 1);

        let mut other_labels = HashMap::new();
        other_labels.insert("role".to_string(), "web".to_string());
        let not_found = registry.find_by_labels(&other_labels);
        assert_eq!(not_found.len(), 0);
    }
}
