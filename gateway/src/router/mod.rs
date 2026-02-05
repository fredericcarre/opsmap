//! Command router module
//!
//! Routes commands from backend to appropriate agents.

use std::collections::HashMap;
use tracing::{debug, info};

use crate::registry::{AgentCommand, AgentInfo, AgentRegistry};

/// Route a command to agents
pub async fn route_command(
    registry: &AgentRegistry,
    agent_id: Option<&str>,
    labels: Option<&HashMap<String, String>>,
    command: AgentCommand,
) -> Vec<RouteResult> {
    let mut results = Vec::new();

    if let Some(id) = agent_id {
        // Route to specific agent
        let result = registry.send_command(id, command).await;
        results.push(RouteResult {
            agent_id: id.to_string(),
            success: result.is_ok(),
            error: result.err(),
        });
    } else if let Some(labels) = labels {
        // Route to agents matching labels
        let send_results = registry.send_command_to_labels(labels, command).await;
        for (agent_id, result) in send_results {
            results.push(RouteResult {
                agent_id,
                success: result.is_ok(),
                error: result.err(),
            });
        }
    }

    results
}

/// Result of routing a command
#[derive(Debug)]
pub struct RouteResult {
    pub agent_id: String,
    pub success: bool,
    pub error: Option<String>,
}

/// Find the best agent for a component
pub fn find_agent_for_component(
    registry: &AgentRegistry,
    component_agent_selector: &AgentSelector,
) -> Option<AgentInfo> {
    // If specific agent ID is specified
    if let Some(ref agent_id) = component_agent_selector.agent_id {
        return registry.get(agent_id);
    }

    // Find by labels
    if let Some(ref labels) = component_agent_selector.labels {
        let agents = registry.find_by_labels(labels);
        // Return first matching agent (could implement load balancing here)
        return agents.into_iter().next();
    }

    None
}

/// Agent selector from component config
#[derive(Debug, Clone)]
pub struct AgentSelector {
    pub agent_id: Option<String>,
    pub labels: Option<HashMap<String, String>>,
}

impl AgentSelector {
    pub fn from_json(value: &serde_json::Value) -> Self {
        Self {
            agent_id: value.get("agent_id").and_then(|v| v.as_str().map(String::from)),
            labels: value.get("labels").and_then(|v| {
                serde_json::from_value(v.clone()).ok()
            }),
        }
    }
}
