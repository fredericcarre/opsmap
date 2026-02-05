//! Agent configuration module

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

/// Main agent configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    pub agent: AgentSettings,
    pub gateway: GatewaySettings,
    pub tls: TlsSettings,
    pub scheduler: SchedulerSettings,
    pub buffer: BufferSettings,
    #[serde(default)]
    pub labels: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSettings {
    #[serde(default = "default_agent_id")]
    pub id: String,
    #[serde(default)]
    pub hostname: Option<String>,
}

fn default_agent_id() -> String {
    "auto".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewaySettings {
    pub url: String,
    #[serde(default = "default_reconnect_interval")]
    pub reconnect_interval_secs: u64,
    #[serde(default = "default_heartbeat_interval")]
    pub heartbeat_interval_secs: u64,
    #[serde(default = "default_timeout")]
    pub timeout_secs: u64,
}

fn default_reconnect_interval() -> u64 {
    10
}

fn default_heartbeat_interval() -> u64 {
    30
}

fn default_timeout() -> u64 {
    60
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TlsSettings {
    #[serde(default = "default_tls_enabled")]
    pub enabled: bool,
    pub cert_file: Option<String>,
    pub key_file: Option<String>,
    pub ca_file: Option<String>,
    #[serde(default)]
    pub verify_server: bool,
}

fn default_tls_enabled() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchedulerSettings {
    #[serde(default = "default_check_interval")]
    pub default_check_interval_secs: u64,
    #[serde(default = "default_batch_interval")]
    pub batch_send_interval_secs: u64,
    #[serde(default = "default_max_concurrent")]
    pub max_concurrent_checks: usize,
}

fn default_check_interval() -> u64 {
    30
}

fn default_batch_interval() -> u64 {
    60
}

fn default_max_concurrent() -> usize {
    10
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BufferSettings {
    #[serde(default = "default_buffer_size")]
    pub max_size: usize,
    pub file_path: Option<String>,
}

fn default_buffer_size() -> usize {
    10000
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            agent: AgentSettings {
                id: "auto".to_string(),
                hostname: None,
            },
            gateway: GatewaySettings {
                url: "wss://gateway.opsmap.local:443".to_string(),
                reconnect_interval_secs: 10,
                heartbeat_interval_secs: 30,
                timeout_secs: 60,
            },
            tls: TlsSettings {
                enabled: true,
                cert_file: Some("/etc/opsmap/certs/agent.crt".to_string()),
                key_file: Some("/etc/opsmap/certs/agent.key".to_string()),
                ca_file: Some("/etc/opsmap/certs/ca.crt".to_string()),
                verify_server: true,
            },
            scheduler: SchedulerSettings {
                default_check_interval_secs: 30,
                batch_send_interval_secs: 60,
                max_concurrent_checks: 10,
            },
            buffer: BufferSettings {
                max_size: 10000,
                file_path: Some("/var/lib/opsmap/buffer.json".to_string()),
            },
            labels: HashMap::new(),
        }
    }
}

/// Load configuration from file
pub fn load_config(path: &Path) -> Result<AgentConfig> {
    if path.exists() {
        let content = std::fs::read_to_string(path)
            .with_context(|| format!("Failed to read config file: {}", path.display()))?;

        let config: AgentConfig = serde_yaml::from_str(&content)
            .with_context(|| "Failed to parse config file")?;

        Ok(config)
    } else {
        // Return default config if file doesn't exist
        tracing::warn!(
            path = %path.display(),
            "Config file not found, using defaults"
        );
        Ok(AgentConfig::default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = AgentConfig::default();
        assert_eq!(config.agent.id, "auto");
        assert!(config.tls.enabled);
    }

    #[test]
    fn test_parse_yaml() {
        let yaml = r#"
agent:
  id: test-agent

gateway:
  url: wss://gateway.example.com:443

tls:
  enabled: true
  cert_file: /path/to/cert
  key_file: /path/to/key
  ca_file: /path/to/ca

labels:
  role: database
  env: production
"#;

        let config: AgentConfig = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(config.agent.id, "test-agent");
        assert_eq!(config.labels.get("role"), Some(&"database".to_string()));
    }
}
