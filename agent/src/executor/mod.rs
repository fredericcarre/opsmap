//! Command executor module
//!
//! CRITICAL: This module implements process detachment using double-fork.
//! A crash of the agent MUST NOT affect running processes.

use anyhow::{anyhow, Context, Result};
use nix::sys::signal::{self, Signal};
use nix::sys::wait::waitpid;
use nix::unistd::{self, ForkResult, Pid};
use std::ffi::CString;
use std::os::unix::io::RawFd;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command as TokioCommand;
use tokio::time::{timeout, Duration};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use crate::connection::{Command, CommandResult};

/// Execute a command
///
/// For sync commands: execute and wait for result
/// For async commands: detach process and return job_id immediately
pub async fn execute_command(cmd: &Command) -> Result<CommandResult> {
    match cmd.command_type.as_str() {
        "start" | "stop" | "restart" | "action" => {
            // Async commands - detach the process
            execute_async_command(cmd).await
        }
        "check" | "native" => {
            // Sync commands - wait for result
            execute_sync_command(cmd).await
        }
        _ => Err(anyhow!("Unknown command type: {}", cmd.command_type)),
    }
}

/// Execute a synchronous command (blocks until completion)
async fn execute_sync_command(cmd: &Command) -> Result<CommandResult> {
    let action_name = cmd
        .action_name
        .as_ref()
        .ok_or_else(|| anyhow!("Missing action name"))?;

    let command_str = cmd
        .params
        .get("command")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow!("Missing command in params"))?;

    let args: Vec<&str> = cmd
        .params
        .get("args")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str()).collect())
        .unwrap_or_default();

    info!(
        command_id = %cmd.id,
        command = %command_str,
        "Executing sync command"
    );

    let start = std::time::Instant::now();

    // Execute with timeout
    let result = timeout(
        Duration::from_secs(cmd.timeout_secs),
        execute_with_output(command_str, &args),
    )
    .await;

    let duration_ms = start.elapsed().as_millis() as u64;

    match result {
        Ok(Ok((exit_code, stdout, stderr))) => {
            info!(
                command_id = %cmd.id,
                exit_code = exit_code,
                duration_ms = duration_ms,
                "Command completed"
            );

            Ok(CommandResult {
                exit_code,
                stdout,
                stderr,
                duration_ms,
                job_id: None,
            })
        }
        Ok(Err(e)) => {
            error!(command_id = %cmd.id, error = %e, "Command failed");
            Err(e)
        }
        Err(_) => {
            error!(command_id = %cmd.id, "Command timed out");
            Err(anyhow!("Command timed out after {} seconds", cmd.timeout_secs))
        }
    }
}

/// Execute an asynchronous command (detaches process)
///
/// CRITICAL: Uses double-fork to completely detach the process.
/// The process will survive agent crash/restart.
async fn execute_async_command(cmd: &Command) -> Result<CommandResult> {
    let command_str = cmd
        .params
        .get("command")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow!("Missing command in params"))?;

    let args: Vec<String> = cmd
        .params
        .get("args")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    let run_as_user = cmd
        .params
        .get("run_as_user")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let job_id = Uuid::new_v4().to_string();

    info!(
        command_id = %cmd.id,
        job_id = %job_id,
        command = %command_str,
        "Starting detached async command"
    );

    // Execute detached process using double-fork
    spawn_detached(command_str, &args, run_as_user.as_deref(), &job_id)?;

    // Return immediately with job_id
    Ok(CommandResult {
        exit_code: 0,
        stdout: String::new(),
        stderr: String::new(),
        duration_ms: 0,
        job_id: Some(job_id),
    })
}

/// Execute a command and capture output
async fn execute_with_output(command: &str, args: &[&str]) -> Result<(i32, String, String)> {
    let mut child = TokioCommand::new("sh")
        .arg("-c")
        .arg(if args.is_empty() {
            command.to_string()
        } else {
            format!("{} {}", command, args.join(" "))
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .context("Failed to spawn command")?;

    let stdout = child.stdout.take().expect("stdout not captured");
    let stderr = child.stderr.take().expect("stderr not captured");

    let mut stdout_lines = Vec::new();
    let mut stderr_lines = Vec::new();

    let mut stdout_reader = BufReader::new(stdout).lines();
    let mut stderr_reader = BufReader::new(stderr).lines();

    // Read stdout and stderr concurrently
    loop {
        tokio::select! {
            line = stdout_reader.next_line() => {
                match line {
                    Ok(Some(l)) => stdout_lines.push(l),
                    Ok(None) => break,
                    Err(e) => {
                        warn!(error = %e, "Error reading stdout");
                        break;
                    }
                }
            }
            line = stderr_reader.next_line() => {
                match line {
                    Ok(Some(l)) => stderr_lines.push(l),
                    Ok(None) => {},
                    Err(e) => {
                        warn!(error = %e, "Error reading stderr");
                    }
                }
            }
        }
    }

    // Drain remaining stderr
    while let Ok(Some(line)) = stderr_reader.next_line().await {
        stderr_lines.push(line);
    }

    let status = child.wait().await.context("Failed to wait for command")?;
    let exit_code = status.code().unwrap_or(-1);

    Ok((
        exit_code,
        stdout_lines.join("\n"),
        stderr_lines.join("\n"),
    ))
}

/// Spawn a completely detached process using double-fork
///
/// This is the CRITICAL function for process detachment.
/// The spawned process will:
/// 1. First fork -> intermediate child
/// 2. setsid() -> new session (detach from terminal)
/// 3. Second fork -> grandchild becomes orphan
/// 4. Intermediate child exits -> grandchild reparented to init/systemd
/// 5. Close ALL file descriptors
/// 6. Redirect stdin/stdout/stderr to /dev/null or log file
fn spawn_detached(
    command: &str,
    args: &[String],
    run_as_user: Option<&str>,
    job_id: &str,
) -> Result<()> {
    // Log file for the detached process
    let log_dir = "/var/log/opsmap/jobs";
    std::fs::create_dir_all(log_dir).ok();
    let log_file = format!("{}/{}.log", log_dir, job_id);

    // FIRST FORK
    match unsafe { unistd::fork() } {
        Ok(ForkResult::Parent { child }) => {
            // Parent: wait for intermediate child to exit
            debug!(pid = child.as_raw(), "First fork - waiting for intermediate child");
            let _ = waitpid(child, None);
            return Ok(());
        }
        Ok(ForkResult::Child) => {
            // Intermediate child: continue to second fork
        }
        Err(e) => {
            return Err(anyhow!("First fork failed: {}", e));
        }
    }

    // INTERMEDIATE CHILD
    // Create new session - detach from terminal
    if let Err(e) = unistd::setsid() {
        error!(error = %e, "setsid failed");
        std::process::exit(1);
    }

    // Ignore SIGHUP so the grandchild isn't killed when session leader exits
    unsafe {
        signal::signal(Signal::SIGHUP, signal::SigHandler::SigIgn).ok();
    }

    // SECOND FORK
    match unsafe { unistd::fork() } {
        Ok(ForkResult::Parent { .. }) => {
            // Intermediate child: exit immediately
            // This orphans the grandchild, which gets reparented to init
            std::process::exit(0);
        }
        Ok(ForkResult::Child) => {
            // Grandchild: this is the actual detached process
        }
        Err(e) => {
            error!(error = %e, "Second fork failed");
            std::process::exit(1);
        }
    }

    // GRANDCHILD (detached process)

    // Close all file descriptors
    close_all_fds();

    // Redirect stdin/stdout/stderr
    redirect_std_streams(&log_file);

    // Change to root directory to avoid holding mount points
    let _ = unistd::chdir("/");

    // Clear umask
    let _ = nix::sys::stat::umask(nix::sys::stat::Mode::empty());

    // Change user if specified
    if let Some(user) = run_as_user {
        if let Err(e) = switch_user(user) {
            eprintln!("Failed to switch user to {}: {}", user, e);
            std::process::exit(1);
        }
    }

    // Execute the command
    let c_command = CString::new(command).expect("CString::new failed");

    // Build args with command as first element
    let mut c_args: Vec<CString> = vec![c_command.clone()];
    for arg in args {
        c_args.push(CString::new(arg.as_str()).expect("CString::new failed"));
    }

    // Execute via sh -c for better compatibility
    let sh = CString::new("/bin/sh").unwrap();
    let sh_c = CString::new("-c").unwrap();
    let full_command = if args.is_empty() {
        command.to_string()
    } else {
        format!("{} {}", command, args.join(" "))
    };
    let c_full_command = CString::new(full_command).unwrap();

    // Log start
    eprintln!("[{}] Starting command: {}", chrono::Utc::now(), command);

    // execvp replaces the current process
    let _ = unistd::execvp(&sh, &[sh.clone(), sh_c, c_full_command]);

    // If we get here, exec failed
    eprintln!("exec failed");
    std::process::exit(1);
}

/// Close all file descriptors except stdin/stdout/stderr
fn close_all_fds() {
    // Get max fd from /proc/self/fd or use a reasonable default
    let max_fd = std::fs::read_dir("/proc/self/fd")
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .filter_map(|e| e.file_name().to_str().and_then(|s| s.parse::<RawFd>().ok()))
                .max()
                .unwrap_or(1024)
        })
        .unwrap_or(1024);

    // Close all fds above stderr
    for fd in 3..=max_fd {
        unsafe {
            libc::close(fd);
        }
    }
}

/// Redirect stdin/stdout/stderr to log file
fn redirect_std_streams(log_file: &str) {
    use std::os::unix::io::AsRawFd;

    // Open /dev/null for stdin
    let dev_null = std::fs::File::open("/dev/null").ok();
    if let Some(f) = dev_null {
        unsafe {
            libc::dup2(f.as_raw_fd(), 0);
        }
    }

    // Open log file for stdout/stderr
    let log = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_file)
        .ok();

    if let Some(f) = log {
        let fd = f.as_raw_fd();
        unsafe {
            libc::dup2(fd, 1); // stdout
            libc::dup2(fd, 2); // stderr
        }
    }
}

/// Switch to a different user
fn switch_user(username: &str) -> Result<()> {
    use nix::unistd::{setgid, setuid, Gid, Uid};

    // Get user info
    let user = nix::unistd::User::from_name(username)
        .context("Failed to lookup user")?
        .ok_or_else(|| anyhow!("User not found: {}", username))?;

    // Set group first (must be done before dropping root)
    setgid(Gid::from_raw(user.gid.as_raw())).context("Failed to set GID")?;

    // Set user
    setuid(Uid::from_raw(user.uid.as_raw())).context("Failed to set UID")?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_execute_with_output() {
        let (exit_code, stdout, _) = execute_with_output("echo", &["hello"]).await.unwrap();
        assert_eq!(exit_code, 0);
        assert_eq!(stdout.trim(), "hello");
    }

    #[tokio::test]
    async fn test_execute_with_output_error() {
        let (exit_code, _, _) = execute_with_output("false", &[]).await.unwrap();
        assert_ne!(exit_code, 0);
    }
}
