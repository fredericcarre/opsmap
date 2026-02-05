//! Native commands module
//!
//! Built-in commands that don't require shell execution.
//! These are fast and secure alternatives to shell commands.

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::Path;
use sysinfo::{CpuExt, DiskExt, NetworkExt, ProcessExt, System, SystemExt};
use tracing::debug;

/// Native command result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NativeResult {
    pub status: String,  // ok, warning, error
    pub message: Option<String>,
    pub metrics: serde_json::Value,
}

/// Execute a native command
pub fn execute_native(command: &str, config: &serde_json::Value) -> Result<NativeResult> {
    match command {
        "disk_space" => check_disk_space(config),
        "memory" => check_memory(config),
        "cpu" => check_cpu(config),
        "process" => check_process(config),
        "tcp_port" => check_tcp_port(config),
        "file_exists" => check_file_exists(config),
        "http" => check_http(config),
        "load_average" => check_load_average(config),
        "network" => check_network(config),
        _ => Err(anyhow!("Unknown native command: {}", command)),
    }
}

/// Check disk space
fn check_disk_space(config: &serde_json::Value) -> Result<NativeResult> {
    let path = config
        .get("path")
        .and_then(|v| v.as_str())
        .unwrap_or("/");

    let warning_threshold = config
        .get("warning_percent")
        .and_then(|v| v.as_f64())
        .unwrap_or(80.0);

    let critical_threshold = config
        .get("critical_percent")
        .and_then(|v| v.as_f64())
        .unwrap_or(90.0);

    let mut sys = System::new();
    sys.refresh_disks_list();
    sys.refresh_disks();

    // Find the disk that contains the given path
    let disk = sys
        .disks()
        .iter()
        .filter(|d| path.starts_with(d.mount_point().to_str().unwrap_or("")))
        .max_by_key(|d| d.mount_point().to_str().unwrap_or("").len());

    match disk {
        Some(d) => {
            let total = d.total_space();
            let available = d.available_space();
            let used = total - available;
            let used_percent = (used as f64 / total as f64) * 100.0;

            let status = if used_percent >= critical_threshold {
                "error"
            } else if used_percent >= warning_threshold {
                "warning"
            } else {
                "ok"
            };

            Ok(NativeResult {
                status: status.to_string(),
                message: Some(format!(
                    "Disk usage: {:.1}% ({} / {})",
                    used_percent,
                    format_bytes(used),
                    format_bytes(total)
                )),
                metrics: json!({
                    "path": path,
                    "total_bytes": total,
                    "used_bytes": used,
                    "available_bytes": available,
                    "used_percent": used_percent,
                }),
            })
        }
        None => Err(anyhow!("Disk not found for path: {}", path)),
    }
}

/// Check memory usage
fn check_memory(config: &serde_json::Value) -> Result<NativeResult> {
    let warning_threshold = config
        .get("warning_percent")
        .and_then(|v| v.as_f64())
        .unwrap_or(80.0);

    let critical_threshold = config
        .get("critical_percent")
        .and_then(|v| v.as_f64())
        .unwrap_or(90.0);

    let mut sys = System::new();
    sys.refresh_memory();

    let total = sys.total_memory();
    let used = sys.used_memory();
    let available = sys.available_memory();
    let used_percent = (used as f64 / total as f64) * 100.0;

    let swap_total = sys.total_swap();
    let swap_used = sys.used_swap();

    let status = if used_percent >= critical_threshold {
        "error"
    } else if used_percent >= warning_threshold {
        "warning"
    } else {
        "ok"
    };

    Ok(NativeResult {
        status: status.to_string(),
        message: Some(format!(
            "Memory usage: {:.1}% ({} / {})",
            used_percent,
            format_bytes(used),
            format_bytes(total)
        )),
        metrics: json!({
            "total_bytes": total,
            "used_bytes": used,
            "available_bytes": available,
            "used_percent": used_percent,
            "swap_total_bytes": swap_total,
            "swap_used_bytes": swap_used,
        }),
    })
}

/// Check CPU usage
fn check_cpu(config: &serde_json::Value) -> Result<NativeResult> {
    let warning_threshold = config
        .get("warning_percent")
        .and_then(|v| v.as_f64())
        .unwrap_or(80.0);

    let critical_threshold = config
        .get("critical_percent")
        .and_then(|v| v.as_f64())
        .unwrap_or(90.0);

    let mut sys = System::new();
    sys.refresh_cpu();

    // Wait a bit for accurate measurement
    std::thread::sleep(std::time::Duration::from_millis(200));
    sys.refresh_cpu();

    let global_cpu = sys.global_cpu_info();
    let cpu_usage = global_cpu.cpu_usage() as f64;

    let per_cpu: Vec<f64> = sys.cpus().iter().map(|c| c.cpu_usage() as f64).collect();

    let status = if cpu_usage >= critical_threshold {
        "error"
    } else if cpu_usage >= warning_threshold {
        "warning"
    } else {
        "ok"
    };

    Ok(NativeResult {
        status: status.to_string(),
        message: Some(format!("CPU usage: {:.1}%", cpu_usage)),
        metrics: json!({
            "cpu_percent": cpu_usage,
            "cpu_count": per_cpu.len(),
            "per_cpu_percent": per_cpu,
        }),
    })
}

/// Check if a process is running
fn check_process(config: &serde_json::Value) -> Result<NativeResult> {
    let process_name = config
        .get("name")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow!("Missing 'name' in process check config"))?;

    let mut sys = System::new();
    sys.refresh_processes();

    let matching_processes: Vec<_> = sys
        .processes()
        .values()
        .filter(|p| p.name().contains(process_name))
        .collect();

    let count = matching_processes.len();
    let min_count = config
        .get("min_count")
        .and_then(|v| v.as_u64())
        .unwrap_or(1) as usize;

    let status = if count >= min_count { "ok" } else { "error" };

    let process_info: Vec<_> = matching_processes
        .iter()
        .take(10)
        .map(|p| {
            json!({
                "pid": p.pid().as_u32(),
                "name": p.name(),
                "cpu_percent": p.cpu_usage(),
                "memory_bytes": p.memory(),
            })
        })
        .collect();

    Ok(NativeResult {
        status: status.to_string(),
        message: Some(format!("Found {} process(es) matching '{}'", count, process_name)),
        metrics: json!({
            "process_name": process_name,
            "count": count,
            "min_count": min_count,
            "processes": process_info,
        }),
    })
}

/// Check if a TCP port is listening
fn check_tcp_port(config: &serde_json::Value) -> Result<NativeResult> {
    let port = config
        .get("port")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| anyhow!("Missing 'port' in tcp_port check config"))? as u16;

    let host = config
        .get("host")
        .and_then(|v| v.as_str())
        .unwrap_or("127.0.0.1");

    let timeout_ms = config
        .get("timeout_ms")
        .and_then(|v| v.as_u64())
        .unwrap_or(5000);

    let addr = format!("{}:{}", host, port);

    let start = std::time::Instant::now();
    let result = std::net::TcpStream::connect_timeout(
        &addr.parse().unwrap(),
        std::time::Duration::from_millis(timeout_ms),
    );
    let duration_ms = start.elapsed().as_millis() as u64;

    match result {
        Ok(_) => Ok(NativeResult {
            status: "ok".to_string(),
            message: Some(format!("Port {} is open ({}ms)", port, duration_ms)),
            metrics: json!({
                "host": host,
                "port": port,
                "open": true,
                "response_time_ms": duration_ms,
            }),
        }),
        Err(e) => Ok(NativeResult {
            status: "error".to_string(),
            message: Some(format!("Port {} is closed: {}", port, e)),
            metrics: json!({
                "host": host,
                "port": port,
                "open": false,
                "error": e.to_string(),
            }),
        }),
    }
}

/// Check if a file exists
fn check_file_exists(config: &serde_json::Value) -> Result<NativeResult> {
    let path = config
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow!("Missing 'path' in file_exists check config"))?;

    let path = Path::new(path);
    let exists = path.exists();
    let is_file = path.is_file();
    let is_dir = path.is_dir();

    let metadata = std::fs::metadata(path).ok();
    let size = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
    let modified = metadata
        .and_then(|m| m.modified().ok())
        .map(|t| {
            chrono::DateTime::<chrono::Utc>::from(t)
                .format("%Y-%m-%dT%H:%M:%SZ")
                .to_string()
        });

    let should_exist = config.get("should_exist").and_then(|v| v.as_bool()).unwrap_or(true);

    let status = if exists == should_exist { "ok" } else { "error" };

    Ok(NativeResult {
        status: status.to_string(),
        message: Some(format!(
            "File '{}' {}",
            path.display(),
            if exists { "exists" } else { "does not exist" }
        )),
        metrics: json!({
            "path": path.display().to_string(),
            "exists": exists,
            "is_file": is_file,
            "is_directory": is_dir,
            "size_bytes": size,
            "modified_at": modified,
        }),
    })
}

/// Check HTTP endpoint
fn check_http(config: &serde_json::Value) -> Result<NativeResult> {
    let url = config
        .get("url")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow!("Missing 'url' in http check config"))?;

    let timeout_secs = config
        .get("timeout_secs")
        .and_then(|v| v.as_u64())
        .unwrap_or(10);

    let expected_status = config
        .get("expected_status")
        .and_then(|v| v.as_u64())
        .map(|s| s as u16);

    // Use a blocking client since this runs in a sync context
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .danger_accept_invalid_certs(true)
        .build()?;

    let start = std::time::Instant::now();
    let response = client.get(url).send();
    let duration_ms = start.elapsed().as_millis() as u64;

    match response {
        Ok(resp) => {
            let status_code = resp.status().as_u16();
            let is_success = if let Some(expected) = expected_status {
                status_code == expected
            } else {
                resp.status().is_success()
            };

            Ok(NativeResult {
                status: if is_success { "ok" } else { "error" }.to_string(),
                message: Some(format!(
                    "HTTP {} - {} ({}ms)",
                    status_code,
                    resp.status().canonical_reason().unwrap_or("Unknown"),
                    duration_ms
                )),
                metrics: json!({
                    "url": url,
                    "status_code": status_code,
                    "response_time_ms": duration_ms,
                    "success": is_success,
                }),
            })
        }
        Err(e) => Ok(NativeResult {
            status: "error".to_string(),
            message: Some(format!("HTTP request failed: {}", e)),
            metrics: json!({
                "url": url,
                "error": e.to_string(),
                "response_time_ms": duration_ms,
            }),
        }),
    }
}

/// Check system load average
fn check_load_average(config: &serde_json::Value) -> Result<NativeResult> {
    let sys = System::new();
    let load = sys.load_average();

    let cpu_count = sys.cpus().len() as f64;
    let warning_per_cpu = config
        .get("warning_per_cpu")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.7);
    let critical_per_cpu = config
        .get("critical_per_cpu")
        .and_then(|v| v.as_f64())
        .unwrap_or(1.0);

    let load_per_cpu = load.one / cpu_count;

    let status = if load_per_cpu >= critical_per_cpu {
        "error"
    } else if load_per_cpu >= warning_per_cpu {
        "warning"
    } else {
        "ok"
    };

    Ok(NativeResult {
        status: status.to_string(),
        message: Some(format!(
            "Load average: {:.2} {:.2} {:.2} ({:.2} per CPU)",
            load.one, load.five, load.fifteen, load_per_cpu
        )),
        metrics: json!({
            "load_1min": load.one,
            "load_5min": load.five,
            "load_15min": load.fifteen,
            "cpu_count": cpu_count as usize,
            "load_per_cpu": load_per_cpu,
        }),
    })
}

/// Check network interface stats
fn check_network(config: &serde_json::Value) -> Result<NativeResult> {
    let interface = config
        .get("interface")
        .and_then(|v| v.as_str());

    let mut sys = System::new();
    sys.refresh_networks_list();
    sys.refresh_networks();

    let networks: Vec<_> = sys
        .networks()
        .iter()
        .filter(|(name, _)| {
            interface.map_or(true, |i| *name == i)
        })
        .map(|(name, data)| {
            json!({
                "name": name,
                "received_bytes": data.total_received(),
                "transmitted_bytes": data.total_transmitted(),
                "received_packets": data.total_packets_received(),
                "transmitted_packets": data.total_packets_transmitted(),
                "errors_received": data.total_errors_on_received(),
                "errors_transmitted": data.total_errors_on_transmitted(),
            })
        })
        .collect();

    if networks.is_empty() && interface.is_some() {
        return Err(anyhow!("Network interface not found: {}", interface.unwrap()));
    }

    Ok(NativeResult {
        status: "ok".to_string(),
        message: Some(format!("Found {} network interface(s)", networks.len())),
        metrics: json!({
            "interfaces": networks,
        }),
    })
}

/// Format bytes to human readable
fn format_bytes(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;
    const GB: u64 = MB * 1024;
    const TB: u64 = GB * 1024;

    if bytes >= TB {
        format!("{:.2} TB", bytes as f64 / TB as f64)
    } else if bytes >= GB {
        format!("{:.2} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.2} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.2} KB", bytes as f64 / KB as f64)
    } else {
        format!("{} B", bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_disk_space() {
        let result = check_disk_space(&json!({ "path": "/" })).unwrap();
        assert!(!result.status.is_empty());
    }

    #[test]
    fn test_memory() {
        let result = check_memory(&json!({})).unwrap();
        assert!(!result.status.is_empty());
    }

    #[test]
    fn test_cpu() {
        let result = check_cpu(&json!({})).unwrap();
        assert!(!result.status.is_empty());
    }

    #[test]
    fn test_load_average() {
        let result = check_load_average(&json!({})).unwrap();
        assert!(!result.status.is_empty());
    }
}
