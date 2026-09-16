//! Bootstraps a blank Linux VM into a running `mcl-agent` host over SSH — the one place SSH is
//! still the right tool, since before the agent exists there is nothing else on the VM to talk
//! to (see the design spec, Part A). Every step streams its progress to the frontend as a
//! `"vm-bootstrap-progress"` event so the wizard can show a live checklist.

use russh::client::{self, Handle};
use russh::keys::{load_secret_key, PrivateKeyWithHashAlg, PublicKeyOrCertificate};
use russh::ChannelMsg;
use std::sync::Arc;

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
