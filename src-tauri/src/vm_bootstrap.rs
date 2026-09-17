//! Bootstraps a blank Linux VM into a running `mcl-agent` host over SSH — the one place SSH is
//! still the right tool, since before the agent exists there is nothing else on the VM to talk
//! to (see the design spec, Part A). Every step streams its progress to the frontend as a
//! `"vm-bootstrap-progress"` event so the wizard can show a live checklist.

use russh::client::{self, Handle};
use russh::keys::{load_secret_key, PrivateKeyWithHashAlg, PublicKeyOrCertificate};
use russh::ChannelMsg;
use std::net::Ipv6Addr;
use std::sync::Arc;
use std::time::Duration;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

const DEFAULT_AGENT_PORT: u16 = 8642;
const AGENT_DATA_DIR: &str = "/var/lib/mcl-agent";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapRequest {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub private_key_path: String,
    pub agent_port: u16,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapOutcome {
    pub url: String,
    pub token: String,
    pub cert_pem: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BootstrapProgressEvent {
    stream_id: String,
    line: String,
}

fn emit_progress(app: &AppHandle, stream_id: &str, line: impl Into<String>) {
    let _ = app.emit("vm-bootstrap-progress", BootstrapProgressEvent { stream_id: stream_id.to_string(), line: line.into() });
}

/// Emitted once credentials are read back off the VM, *before* the final reachability check —
/// which is the one step most likely to fail on the first attempt (the operator hasn't opened
/// their cloud provider's firewall yet). Capturing this separately from `run_bootstrap`'s own
/// return value is what lets the frontend's Retry action re-check reachability with these same
/// credentials without re-running the whole install.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BootstrapCredentialsEvent {
    stream_id: String,
    url: String,
    token: String,
    cert_pem: String,
}

/// Accepts whatever host key the VM presents — trust-on-first-use, the same model a manual
/// `ssh` client uses the first time it connects to a new host (the "are you sure you want to
/// continue connecting?" prompt). There is no previously pinned key to compare against: this
/// wizard's entire job is the *first* connection to a VM the operator just told MCL the address
/// and key for.
pub struct AcceptAnyHostKey;

impl client::Handler for AcceptAnyHostKey {
    type Error = russh::Error;

    async fn check_server_key(&mut self, _server_public_key: &PublicKeyOrCertificate) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

/// How long to wait for the TCP connection and SSH handshake to start before giving up.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
/// For quick commands that only read something back (`command -v java`, `cat`, `ufw status`).
const SHORT_COMMAND_TIMEOUT: Duration = Duration::from_secs(60);
/// For apt and the agent installer, which download packages and can legitimately take minutes.
const LONG_COMMAND_TIMEOUT: Duration = Duration::from_secs(15 * 60);
/// Longest single output line forwarded to the wizard as a progress event.
const MAX_PROGRESS_LINE_CHARS: usize = 500;
/// Longest unterminated line buffered before it is flushed as a (truncated) line anyway.
const MAX_PENDING_LINE_BYTES: usize = 8 * 1024;
/// How much of a command's output is kept for the caller to inspect.
const MAX_CAPTURED_OUTPUT_BYTES: usize = 64 * 1024;

/// Formats a host for use in a URL or a `host:port` message: trims whitespace and wraps IPv6
/// literals in brackets.
fn display_host(host: &str) -> String {
    let host = host.trim();
    if host.parse::<Ipv6Addr>().is_ok() {
        format!("[{}]", host)
    } else {
        host.to_string()
    }
}

async fn connect(host: &str, port: u16, username: &str, private_key_path: &str) -> Result<Handle<AcceptAnyHostKey>, String> {
    let host = host.trim();
    let key_pair = load_secret_key(private_key_path, None)
        .map_err(|e| format!("Could not read the private key at {}: {}", private_key_path, e))?;
    let config = Arc::new(client::Config {
        // Keepalives notice a silently dropped connection; the inactivity timeout then ends the
        // session instead of letting a command wait forever.
        keepalive_interval: Some(Duration::from_secs(15)),
        inactivity_timeout: Some(Duration::from_secs(120)),
        ..Default::default()
    });
    let mut session = tokio::time::timeout(CONNECT_TIMEOUT, client::connect(config, (host, port), AcceptAnyHostKey))
        .await
        .map_err(|_| format!("Timed out connecting to {}:{}", display_host(host), port))?
        .map_err(|e| format!("Host unreachable: {}", e))?;
    // RSA keys must sign with a hash the server accepts (rsa-sha2-256/512); modern OpenSSH
    // rejects the legacy SHA-1 default, so ask the server which one it supports.
    let rsa_hash = session
        .best_supported_rsa_hash()
        .await
        .map_err(|e| format!("SSH handshake failed: {}", e))?
        .flatten();
    let auth_result = session
        .authenticate_publickey(username, PrivateKeyWithHashAlg::new(Arc::new(key_pair), rsa_hash))
        .await
        .map_err(|e| format!("SSH handshake failed: {}", e))?;
    if !auth_result.success() {
        return Err("The VM rejected this key for this username.".to_string());
    }
    Ok(session)
}

/// Splits a byte stream into lines as chunks arrive. Both `\n` and `\r` end a line (apt and curl
/// redraw progress with `\r`), empty lines are dropped, and each line is capped at
/// `MAX_PROGRESS_LINE_CHARS`.
#[derive(Default)]
struct LineSplitter {
    pending: Vec<u8>,
}

impl LineSplitter {
    fn push(&mut self, chunk: &[u8], on_line: &mut dyn FnMut(&str)) {
        for &byte in chunk {
            if byte == b'\n' || byte == b'\r' {
                self.emit_pending(on_line);
            } else {
                self.pending.push(byte);
                if self.pending.len() >= MAX_PENDING_LINE_BYTES {
                    self.emit_pending(on_line);
                }
            }
        }
    }

    fn finish(&mut self, on_line: &mut dyn FnMut(&str)) {
        self.emit_pending(on_line);
    }

    fn emit_pending(&mut self, on_line: &mut dyn FnMut(&str)) {
        if self.pending.is_empty() {
            return;
        }
        let line = String::from_utf8_lossy(&self.pending);
        let line = line.trim_end();
        if !line.is_empty() {
            if line.chars().count() > MAX_PROGRESS_LINE_CHARS {
                let truncated: String = line.chars().take(MAX_PROGRESS_LINE_CHARS).collect();
                on_line(&format!("{}...", truncated));
            } else {
                on_line(line);
            }
        }
        self.pending.clear();
    }
}

/// Keeps agent credentials out of the installer's streamed log. `install-agent.sh` ends by
/// printing the token and certificate under a "Paste these into MCL" header; MCL reads those
/// files directly instead, so nothing from that header on is forwarded, and any line that looks
/// like a credential is dropped wherever it appears.
#[derive(Default)]
struct CredentialLineFilter {
    past_credentials_header: bool,
}

const CREDENTIALS_NOTICE: &str = "Agent credentials were generated; MCL will read them directly.";

impl CredentialLineFilter {
    /// Returns the line to show in the UI, or `None` to drop it.
    fn filter<'a>(&mut self, line: &'a str) -> Option<&'a str> {
        if self.past_credentials_header {
            return None;
        }
        let trimmed = line.trim();
        if trimmed.starts_with("Paste these into MCL") {
            self.past_credentials_header = true;
            return Some(CREDENTIALS_NOTICE);
        }
        if trimmed.starts_with("Token:") || line.contains("BEGIN CERTIFICATE") || line.contains("PRIVATE KEY") {
            return None;
        }
        Some(line)
    }
}

/// Appends `chunk` to `buffer`, keeping only the last `MAX_CAPTURED_OUTPUT_BYTES` bytes.
fn append_bounded(buffer: &mut Vec<u8>, chunk: &[u8]) {
    buffer.extend_from_slice(chunk);
    if buffer.len() > MAX_CAPTURED_OUTPUT_BYTES {
        let excess = buffer.len() - MAX_CAPTURED_OUTPUT_BYTES;
        buffer.drain(..excess);
    }
}

/// Opens one exec channel, sends `command`, and collects its combined stdout+stderr (the last
/// `MAX_CAPTURED_OUTPUT_BYTES` of it) and exit code. One command per call rather than a
/// persistent shell, since every step in this module only ever needs to run one command and see
/// whether it succeeded.
///
/// `label` describes the step in error messages ("Lost the SSH connection while <label>").
/// `on_line` receives each output line as it arrives; pass a no-op for commands whose output
/// must not reach the UI (the token file, for one).
async fn run_remote_command(
    session: &mut Handle<AcceptAnyHostKey>,
    command: &str,
    label: &str,
    timeout: Duration,
    on_line: &mut (dyn FnMut(&str) + Send),
) -> Result<(String, u32), String> {
    let run = async {
        let mut channel = session
            .channel_open_session()
            .await
            .map_err(|e| format!("Lost the SSH connection while {}: {}", label, e))?;
        channel
            .exec(true, command)
            .await
            .map_err(|e| format!("Lost the SSH connection while {}: {}", label, e))?;
        // Close our side of stdin so a command that tries to read it gets EOF instead of waiting.
        channel
            .eof()
            .await
            .map_err(|e| format!("Lost the SSH connection while {}: {}", label, e))?;

        let mut captured = Vec::new();
        let mut splitter = LineSplitter::default();
        let mut exit_code: Option<u32> = None;
        // Read until the channel closes, not just until EOF: OpenSSH sends the exit status after
        // EOF, so stopping at EOF would lose it.
        while let Some(msg) = channel.wait().await {
            match msg {
                ChannelMsg::Data { data } | ChannelMsg::ExtendedData { data, .. } => {
                    append_bounded(&mut captured, &data);
                    splitter.push(&data, on_line);
                }
                ChannelMsg::ExitStatus { exit_status } => exit_code = Some(exit_status),
                ChannelMsg::Close => break,
                _ => {}
            }
        }
        splitter.finish(on_line);

        match exit_code {
            Some(code) => Ok((String::from_utf8_lossy(&captured).into_owned(), code)),
            None => Err(format!("Lost the SSH connection while {} (no exit status received).", label)),
        }
    };

    tokio::time::timeout(timeout, run)
        .await
        .map_err(|_| format!("Timed out after {} seconds while {}.", timeout.as_secs(), label))?
}

pub async fn run_bootstrap(app: AppHandle, stream_id: String, req: BootstrapRequest) -> Result<BootstrapOutcome, String> {
    let agent_port = if req.agent_port == 0 { DEFAULT_AGENT_PORT } else { req.agent_port };
    let host = display_host(&req.host);
    let mut silent = |_: &str| {};

    emit_progress(&app, &stream_id, format!("Connecting over SSH to {}:{}...", host, req.port));
    let mut session = connect(&req.host, req.port, &req.username, &req.private_key_path).await?;
    emit_progress(&app, &stream_id, "Connected.");

    emit_progress(&app, &stream_id, "Checking for Java...");
    let (_, java_check_code) =
        run_remote_command(&mut session, "command -v java", "checking for Java", SHORT_COMMAND_TIMEOUT, &mut silent).await?;
    if java_check_code != 0 {
        emit_progress(&app, &stream_id, "Java not found, installing OpenJDK 21 (this can take a minute)...");
        let (_, install_code) = run_remote_command(
            &mut session,
            "sudo apt-get -o DPkg::Lock::Timeout=300 update && sudo apt-get -o DPkg::Lock::Timeout=300 install -y openjdk-21-jre-headless",
            "installing Java",
            LONG_COMMAND_TIMEOUT,
            &mut |line| emit_progress(&app, &stream_id, line),
        )
        .await?;
        if install_code != 0 {
            return Err(
                "Could not install Java. If `sudo` needs a password for this user, either grant \
                 passwordless sudo or install Java manually first, then retry."
                    .to_string(),
            );
        }
        emit_progress(&app, &stream_id, "Java installed.");
    } else {
        emit_progress(&app, &stream_id, "Java already installed.");
    }

    emit_progress(&app, &stream_id, "Checking the firewall...");
    let (ufw_status, ufw_status_code) =
        run_remote_command(&mut session, "sudo ufw status", "checking the firewall", SHORT_COMMAND_TIMEOUT, &mut silent).await?;
    if ufw_status_code != 0 {
        emit_progress(&app, &stream_id, "Warning: Could not check ufw status, skipping firewall step.");
    } else if ufw_status.contains("Status: active") {
        for port in [agent_port, 25565] {
            let result = run_remote_command(
                &mut session,
                &format!("sudo ufw allow {}/tcp", port),
                "opening a firewall port",
                SHORT_COMMAND_TIMEOUT,
                &mut silent,
            )
            .await;
            match result {
                Ok((_, 0)) => emit_progress(&app, &stream_id, format!("Opened port {}/tcp in ufw.", port)),
                Ok((_, code)) => emit_progress(
                    &app,
                    &stream_id,
                    format!("Warning: Could not open port {}/tcp in ufw (exit code {}). Open it manually.", port, code),
                ),
                Err(e) => emit_progress(
                    &app,
                    &stream_id,
                    format!("Warning: Could not open port {}/tcp in ufw ({}). Open it manually.", port, e),
                ),
            }
        }
    } else {
        emit_progress(&app, &stream_id, "ufw isn't active on this VM, skipping (nothing to open at the OS level).");
    }

    emit_progress(&app, &stream_id, "Installing mcl-agent...");
    let mut credential_filter = CredentialLineFilter::default();
    let install_agent_cmd = format!(
        "curl -fsSL https://raw.githubusercontent.com/pecora31/MCL-Client/main/scripts/install-agent.sh | sudo MCL_AGENT_PORT={} bash",
        agent_port
    );
    let (_, agent_install_code) = run_remote_command(
        &mut session,
        &install_agent_cmd,
        "installing mcl-agent",
        LONG_COMMAND_TIMEOUT,
        &mut |line| {
            if let Some(shown) = credential_filter.filter(line) {
                emit_progress(&app, &stream_id, shown);
            }
        },
    )
    .await?;
    if agent_install_code != 0 {
        return Err("mcl-agent installation script failed. See the log above for details.".to_string());
    }
    emit_progress(&app, &stream_id, "mcl-agent installed.");

    emit_progress(&app, &stream_id, "Reading the agent's token and certificate...");
    let (token_raw, token_code) = run_remote_command(
        &mut session,
        &format!("cat {}/agent-token.txt", AGENT_DATA_DIR),
        "reading the agent's token",
        SHORT_COMMAND_TIMEOUT,
        &mut silent,
    )
    .await?;
    if token_code != 0 || token_raw.trim().is_empty() {
        return Err("Could not read the agent's token file after installation.".to_string());
    }
    let (cert_raw, cert_code) = run_remote_command(
        &mut session,
        &format!("cat {}/agent-cert.pem", AGENT_DATA_DIR),
        "reading the agent's certificate",
        SHORT_COMMAND_TIMEOUT,
        &mut silent,
    )
    .await?;
    if cert_code != 0 || cert_raw.trim().is_empty() {
        return Err("Could not read the agent's certificate file after installation.".to_string());
    }

    let outcome = BootstrapOutcome {
        url: format!("https://{}:{}", host, agent_port),
        token: token_raw.trim().to_string(),
        cert_pem: cert_raw.trim().to_string(),
    };

    let _ = app.emit(
        "vm-bootstrap-credentials",
        BootstrapCredentialsEvent {
            stream_id: stream_id.clone(),
            url: outcome.url.clone(),
            token: outcome.token.clone(),
            cert_pem: outcome.cert_pem.clone(),
        },
    );

    emit_progress(&app, &stream_id, "Verifying MCL can reach the agent from outside the VM...");
    let host_config = crate::remote_agent::RemoteHostConfig {
        url: outcome.url.clone(),
        token: outcome.token.clone(),
        cert_pem: outcome.cert_pem.clone(),
    };
    crate::remote_agent::remote_agent_status(host_config).await.map_err(|e| {
        format!(
            "Agent installed, but MCL can't reach it from outside the VM ({}). Open port {} (and \
             25565 for players) in your cloud provider's firewall/Security List, then click Retry.",
            e, agent_port
        )
    })?;
    emit_progress(&app, &stream_id, "Done. The agent is reachable.");

    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn split_all(chunks: &[&[u8]]) -> Vec<String> {
        let mut lines = Vec::new();
        let mut splitter = LineSplitter::default();
        let mut collect = |line: &str| lines.push(line.to_string());
        for chunk in chunks {
            splitter.push(chunk, &mut collect);
        }
        splitter.finish(&mut collect);
        lines
    }

    #[test]
    fn splits_lines_across_chunks_and_carriage_returns() {
        let lines = split_all(&[b"Get:1 ht", b"tp://a\r\n\nProgress 10%\rProgress 20%", b"\ndone"]);
        assert_eq!(lines, vec!["Get:1 http://a", "Progress 10%", "Progress 20%", "done"]);
    }

    #[test]
    fn caps_long_lines() {
        let long = "x".repeat(MAX_PROGRESS_LINE_CHARS + 50);
        let lines = split_all(&[long.as_bytes()]);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].chars().count(), MAX_PROGRESS_LINE_CHARS + 3);
    }

    #[test]
    fn bounded_buffer_keeps_the_tail() {
        let mut buffer = Vec::new();
        append_bounded(&mut buffer, &vec![b'a'; MAX_CAPTURED_OUTPUT_BYTES]);
        append_bounded(&mut buffer, b"tail");
        assert_eq!(buffer.len(), MAX_CAPTURED_OUTPUT_BYTES);
        assert!(buffer.ends_with(b"tail"));
    }

    #[test]
    fn flushes_overlong_unterminated_lines() {
        let long = vec![b'y'; MAX_PENDING_LINE_BYTES + 10];
        let lines = split_all(&[&long]);
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].chars().count(), MAX_PROGRESS_LINE_CHARS + 3);
        assert_eq!(lines[1], "y".repeat(10));
    }

    #[test]
    fn credential_filter_hides_token_and_everything_after_header() {
        let mut filter = CredentialLineFilter::default();
        assert_eq!(filter.filter("Setting up mcl-agent..."), Some("Setting up mcl-agent..."));
        assert_eq!(filter.filter("Token: abc"), None);
        assert_eq!(filter.filter("-----BEGIN CERTIFICATE-----"), None);
        assert_eq!(filter.filter("still running"), Some("still running"));
        assert_eq!(filter.filter("  Paste these into MCL when adding this host:"), Some(CREDENTIALS_NOTICE));
        assert_eq!(filter.filter("URL:   https://1.2.3.4:8642"), None);
        assert_eq!(filter.filter("MIIBszCCAVmgAwIBAgIU"), None);
        assert_eq!(filter.filter("Open port 8642 in this server's firewall"), None);
    }

    #[test]
    fn display_host_trims_and_brackets_ipv6() {
        assert_eq!(display_host(" 140.245.125.66 "), "140.245.125.66");
        assert_eq!(display_host("vm.example.com"), "vm.example.com");
        assert_eq!(display_host(" 2001:db8::1 "), "[2001:db8::1]");
    }
}
