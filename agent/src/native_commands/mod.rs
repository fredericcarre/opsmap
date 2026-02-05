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
        "service" => check_service(config),
        "docker_container" => check_docker_container(config),
        "file_content" => check_file_content(config),
        "os_info" => get_os_info(config),
        "uptime" => check_uptime(config),
        "dns" => check_dns(config),
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

/// Check systemd service status
fn check_service(config: &serde_json::Value) -> Result<NativeResult> {
    let service_name = config
        .get("name")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow!("Missing 'name' in service check config"))?;

    // Use systemctl to check service status
    let output = std::process::Command::new("systemctl")
        .args(["is-active", service_name])
        .output();

    match output {
        Ok(out) => {
            let status_str = String::from_utf8_lossy(&out.stdout).trim().to_string();
            let is_active = status_str == "active";

            // Get more details
            let show_output = std::process::Command::new("systemctl")
                .args(["show", service_name, "--property=ActiveState,SubState,MainPID,LoadState"])
                .output()
                .ok();

            let mut properties = std::collections::HashMap::new();
            if let Some(show) = show_output {
                let props = String::from_utf8_lossy(&show.stdout);
                for line in props.lines() {
                    if let Some((key, value)) = line.split_once('=') {
                        properties.insert(key.to_string(), value.to_string());
                    }
                }
            }

            let status = if is_active { "ok" } else { "error" };

            Ok(NativeResult {
                status: status.to_string(),
                message: Some(format!("Service '{}' is {}", service_name, status_str)),
                metrics: json!({
                    "service": service_name,
                    "active": is_active,
                    "state": status_str,
                    "active_state": properties.get("ActiveState"),
                    "sub_state": properties.get("SubState"),
                    "main_pid": properties.get("MainPID"),
                    "load_state": properties.get("LoadState"),
                }),
            })
        }
        Err(e) => Ok(NativeResult {
            status: "error".to_string(),
            message: Some(format!("Failed to check service: {}", e)),
            metrics: json!({
                "service": service_name,
                "error": e.to_string(),
            }),
        }),
    }
}

/// Check Docker container status
fn check_docker_container(config: &serde_json::Value) -> Result<NativeResult> {
    let container = config
        .get("name")
        .or_else(|| config.get("id"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow!("Missing 'name' or 'id' in docker_container check config"))?;

    // Use docker inspect to get container status
    let output = std::process::Command::new("docker")
        .args(["inspect", "--format", "{{json .State}}", container])
        .output();

    match output {
        Ok(out) => {
            if !out.status.success() {
                let stderr = String::from_utf8_lossy(&out.stderr);
                return Ok(NativeResult {
                    status: "error".to_string(),
                    message: Some(format!("Container '{}' not found: {}", container, stderr.trim())),
                    metrics: json!({
                        "container": container,
                        "exists": false,
                    }),
                });
            }

            let state: serde_json::Value = serde_json::from_slice(&out.stdout)
                .unwrap_or_else(|_| json!({}));

            let is_running = state.get("Running").and_then(|v| v.as_bool()).unwrap_or(false);
            let status_str = state.get("Status").and_then(|v| v.as_str()).unwrap_or("unknown");

            let status = if is_running { "ok" } else { "error" };

            Ok(NativeResult {
                status: status.to_string(),
                message: Some(format!("Container '{}' is {}", container, status_str)),
                metrics: json!({
                    "container": container,
                    "exists": true,
                    "running": is_running,
                    "status": status_str,
                    "pid": state.get("Pid"),
                    "started_at": state.get("StartedAt"),
                    "health": state.get("Health"),
                }),
            })
        }
        Err(e) => Ok(NativeResult {
            status: "error".to_string(),
            message: Some(format!("Failed to check container (docker not available?): {}", e)),
            metrics: json!({
                "container": container,
                "error": e.to_string(),
            }),
        }),
    }
}

/// Check file content (read file and optionally match pattern)
fn check_file_content(config: &serde_json::Value) -> Result<NativeResult> {
    let path = config
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow!("Missing 'path' in file_content check config"))?;

    let max_lines = config
        .get("max_lines")
        .and_then(|v| v.as_u64())
        .unwrap_or(100) as usize;

    let pattern = config.get("pattern").and_then(|v| v.as_str());

    match std::fs::read_to_string(path) {
        Ok(content) => {
            let lines: Vec<&str> = content.lines().take(max_lines).collect();
            let line_count = content.lines().count();

            let (status, message) = if let Some(pat) = pattern {
                let matches = content.contains(pat);
                let should_match = config
                    .get("should_match")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true);

                if matches == should_match {
                    ("ok", format!("Pattern '{}' {} in file", pat, if matches { "found" } else { "not found as expected" }))
                } else {
                    ("error", format!("Pattern '{}' {} (expected {})", pat, if matches { "found" } else { "not found" }, if should_match { "match" } else { "no match" }))
                }
            } else {
                ("ok", format!("File read successfully ({} lines)", line_count))
            };

            Ok(NativeResult {
                status: status.to_string(),
                message: Some(message),
                metrics: json!({
                    "path": path,
                    "line_count": line_count,
                    "size_bytes": content.len(),
                    "content_preview": lines.join("\n"),
                    "pattern": pattern,
                }),
            })
        }
        Err(e) => Ok(NativeResult {
            status: "error".to_string(),
            message: Some(format!("Failed to read file: {}", e)),
            metrics: json!({
                "path": path,
                "error": e.to_string(),
            }),
        }),
    }
}

/// Get OS information
fn get_os_info(_config: &serde_json::Value) -> Result<NativeResult> {
    let sys = System::new_all();

    let hostname = hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "unknown".to_string());

    Ok(NativeResult {
        status: "ok".to_string(),
        message: Some(format!(
            "{} {} ({})",
            System::name().unwrap_or_default(),
            System::os_version().unwrap_or_default(),
            System::kernel_version().unwrap_or_default()
        )),
        metrics: json!({
            "hostname": hostname,
            "os_name": System::name(),
            "os_version": System::os_version(),
            "kernel_version": System::kernel_version(),
            "arch": std::env::consts::ARCH,
            "cpu_count": sys.cpus().len(),
            "total_memory_bytes": sys.total_memory(),
        }),
    })
}

/// Check system uptime
fn check_uptime(config: &serde_json::Value) -> Result<NativeResult> {
    let sys = System::new();
    let uptime_secs = System::uptime();

    let min_uptime_secs = config
        .get("min_uptime_secs")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    let status = if uptime_secs >= min_uptime_secs { "ok" } else { "warning" };

    // Format uptime human readable
    let days = uptime_secs / 86400;
    let hours = (uptime_secs % 86400) / 3600;
    let minutes = (uptime_secs % 3600) / 60;

    let uptime_str = if days > 0 {
        format!("{}d {}h {}m", days, hours, minutes)
    } else if hours > 0 {
        format!("{}h {}m", hours, minutes)
    } else {
        format!("{}m", minutes)
    };

    Ok(NativeResult {
        status: status.to_string(),
        message: Some(format!("System uptime: {}", uptime_str)),
        metrics: json!({
            "uptime_seconds": uptime_secs,
            "uptime_human": uptime_str,
            "days": days,
            "hours": hours,
            "minutes": minutes,
        }),
    })
}

/// Check DNS resolution
fn check_dns(config: &serde_json::Value) -> Result<NativeResult> {
    let hostname = config
        .get("hostname")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow!("Missing 'hostname' in dns check config"))?;

    let expected_ip = config.get("expected_ip").and_then(|v| v.as_str());

    let start = std::time::Instant::now();
    let result = std::net::ToSocketAddrs::to_socket_addrs(&format!("{}:80", hostname));
    let duration_ms = start.elapsed().as_millis() as u64;

    match result {
        Ok(addrs) => {
            let ips: Vec<String> = addrs.map(|a| a.ip().to_string()).collect();

            let (status, message) = if let Some(expected) = expected_ip {
                if ips.contains(&expected.to_string()) {
                    ("ok", format!("DNS resolved {} to {} ({}ms)", hostname, expected, duration_ms))
                } else {
                    ("error", format!("DNS resolved {} but {} not found in {:?}", hostname, expected, ips))
                }
            } else if ips.is_empty() {
                ("error", format!("DNS resolution returned no results for {}", hostname))
            } else {
                ("ok", format!("DNS resolved {} to {:?} ({}ms)", hostname, ips, duration_ms))
            };

            Ok(NativeResult {
                status: status.to_string(),
                message: Some(message),
                metrics: json!({
                    "hostname": hostname,
                    "resolved_ips": ips,
                    "resolution_time_ms": duration_ms,
                    "expected_ip": expected_ip,
                }),
            })
        }
        Err(e) => Ok(NativeResult {
            status: "error".to_string(),
            message: Some(format!("DNS resolution failed for {}: {}", hostname, e)),
            metrics: json!({
                "hostname": hostname,
                "error": e.to_string(),
                "resolution_time_ms": duration_ms,
            }),
        }),
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
