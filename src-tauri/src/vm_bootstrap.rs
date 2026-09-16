//! Bootstraps a blank Linux VM into a running `mcl-agent` host over SSH — the one place SSH is
//! still the right tool, since before the agent exists there is nothing else on the VM to talk
//! to (see the design spec, Part A). Every step streams its progress to the frontend as a
//! `"vm-bootstrap-progress"` event so the wizard can show a live checklist.

use russh::client::{self, Handle};
use russh::keys::{load_secret_key, PrivateKeyWithHashAlg, PublicKeyOrCertificate};
use russh::ChannelMsg;
use std::sync::Arc;
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

async fn connect(host: &str, port: u16, username: &str, private_key_path: &str) -> Result<Handle<AcceptAnyHostKey>, String> {
    let key_pair = load_secret_key(private_key_path, None)
        .map_err(|e| format!("Could not read the private key at {}: {}", private_key_path, e))?;
    let config = Arc::new(client::Config::default());
    let mut session = client::connect(config, (host, port), AcceptAnyHostKey)
        .await
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

/// Opens one exec channel, sends `command`, and collects its combined stdout+stderr and exit
/// code. One command per call rather than a persistent shell — every step in this module only
/// ever needs to run one command and see whether it succeeded.
async fn run_remote_command(session: &mut Handle<AcceptAnyHostKey>, command: &str) -> Result<(String, u32), String> {
    let mut channel = session.channel_open_session().await.map_err(|e| e.to_string())?;
    channel.exec(true, command).await.map_err(|e| e.to_string())?;

    let mut output = String::new();
    let mut exit_code: Option<u32> = None;
    // Read until the channel closes, not just until EOF: OpenSSH sends the exit status after
    // EOF, so stopping at EOF would lose it.
    loop {
        let Some(msg) = channel.wait().await else { break };
        match msg {
            ChannelMsg::Data { data } => output.push_str(&String::from_utf8_lossy(&data)),
            ChannelMsg::ExtendedData { data, .. } => output.push_str(&String::from_utf8_lossy(&data)),
            ChannelMsg::ExitStatus { exit_status } => exit_code = Some(exit_status),
            ChannelMsg::Close => break,
            _ => {}
        }
    }
    // No exit status at all (e.g. the command was killed by a signal) is never a success.
    Ok((output, exit_code.unwrap_or(u32::MAX)))
}

pub async fn run_bootstrap(app: AppHandle, stream_id: String, req: BootstrapRequest) -> Result<BootstrapOutcome, String> {
    let agent_port = if req.agent_port == 0 { DEFAULT_AGENT_PORT } else { req.agent_port };

    emit_progress(&app, &stream_id, "Connecting over SSH...");
    let mut session = connect(&req.host, req.port, &req.username, &req.private_key_path).await?;
    emit_progress(&app, &stream_id, "Connected.");

    emit_progress(&app, &stream_id, "Checking for Java...");
    let (_, java_check_code) = run_remote_command(&mut session, "command -v java").await?;
    if java_check_code != 0 {
        emit_progress(&app, &stream_id, "Java not found, installing OpenJDK 21 (this can take a minute)...");
        let (install_output, install_code) =
            run_remote_command(&mut session, "sudo apt-get update && sudo apt-get install -y openjdk-21-jre-headless").await?;
        emit_progress(&app, &stream_id, install_output);
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
    let (ufw_status, _) = run_remote_command(&mut session, "sudo ufw status").await?;
    if ufw_status.contains("Status: active") {
        let _ = run_remote_command(&mut session, &format!("sudo ufw allow {}/tcp", agent_port)).await;
        let _ = run_remote_command(&mut session, "sudo ufw allow 25565/tcp").await;
        emit_progress(&app, &stream_id, "Opened the agent and Minecraft ports in ufw.");
    } else {
        emit_progress(&app, &stream_id, "ufw isn't active on this VM, skipping (nothing to open at the OS level).");
    }

    emit_progress(&app, &stream_id, "Installing mcl-agent...");
    let install_agent_cmd = format!(
        "curl -fsSL https://raw.githubusercontent.com/pecora31/MCL-Client/main/scripts/install-agent.sh | sudo MCL_AGENT_PORT={} bash",
        agent_port
    );
    let (agent_install_output, agent_install_code) = run_remote_command(&mut session, &install_agent_cmd).await?;
    emit_progress(&app, &stream_id, agent_install_output);
    if agent_install_code != 0 {
        return Err("mcl-agent installation script failed — see the log above for details.".to_string());
    }
    emit_progress(&app, &stream_id, "mcl-agent installed.");

    emit_progress(&app, &stream_id, "Reading the agent's token and certificate...");
    let (token_raw, token_code) = run_remote_command(&mut session, &format!("cat {}/agent-token.txt", AGENT_DATA_DIR)).await?;
    if token_code != 0 || token_raw.trim().is_empty() {
        return Err("Could not read the agent's token file after installation.".to_string());
    }
    let (cert_raw, cert_code) = run_remote_command(&mut session, &format!("cat {}/agent-cert.pem", AGENT_DATA_DIR)).await?;
    if cert_code != 0 || cert_raw.trim().is_empty() {
        return Err("Could not read the agent's certificate file after installation.".to_string());
    }

    let outcome = BootstrapOutcome {
        url: format!("https://{}:{}", req.host, agent_port),
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
    emit_progress(&app, &stream_id, "Done — the agent is reachable.");

    Ok(outcome)
}
