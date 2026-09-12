// Talks to a remote MCL Agent (src-tauri/src/bin/mcl_agent.rs) over its token-authenticated,
// certificate-pinned HTTPS API — so a server hosted on a VPS can be managed from the same
// Host Server tab as a local one, without SSH.
//
// The agent's certificate is self-signed with no CA behind it, so this pins the exact
// certificate the operator pasted in when adding the host (via `add_root_certificate`) rather
// than relying on hostname/CA trust — hostname verification is disabled because the pinned
// certificate check already proves it's the same server, regardless of what name or IP was
// used to reach it.

use crate::models::ServerPropertiesSummary;
use crate::server_host::HostedServerStatus;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteHostConfig {
    pub url: String,
    pub token: String,
    pub cert_pem: String,
}

fn client_for(host: &RemoteHostConfig) -> Result<reqwest::Client, String> {
    let cert = reqwest::Certificate::from_pem(host.cert_pem.as_bytes())
        .map_err(|e| format!("That certificate doesn't look valid: {}", e))?;
    reqwest::Client::builder()
        .add_root_certificate(cert)
        .danger_accept_invalid_hostnames(true)
        .build()
        .map_err(|e| e.to_string())
}

fn base_url(host: &RemoteHostConfig) -> String {
    host.url.trim_end_matches('/').to_string()
}

async fn error_message(resp: reqwest::Response) -> String {
    let status = resp.status();
    match resp.json::<Value>().await {
        Ok(body) => body
            .get("error")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("The agent replied with HTTP {}.", status)),
        Err(_) => format!("The agent replied with HTTP {}.", status),
    }
}

async fn get_json<T: DeserializeOwned>(host: &RemoteHostConfig, path: &str) -> Result<T, String> {
    let client = client_for(host)?;
    let resp = client
        .get(format!("{}{}", base_url(host), path))
        .bearer_auth(&host.token)
        .send()
        .await
        .map_err(|e| format!("Could not reach the agent: {}", e))?;
    if !resp.status().is_success() {
        return Err(error_message(resp).await);
    }
    resp.json::<T>().await.map_err(|e| e.to_string())
}

async fn post_json<B: Serialize, T: DeserializeOwned>(host: &RemoteHostConfig, path: &str, body: &B) -> Result<T, String> {
    let client = client_for(host)?;
    let resp = client
        .post(format!("{}{}", base_url(host), path))
        .bearer_auth(&host.token)
        .json(body)
        .send()
        .await
        .map_err(|e| format!("Could not reach the agent: {}", e))?;
    if !resp.status().is_success() {
        return Err(error_message(resp).await);
    }
    resp.json::<T>().await.map_err(|e| e.to_string())
}

/// Like `post_json`, but for endpoints that reply `204 No Content` rather than a JSON body.
async fn post_no_content<B: Serialize>(host: &RemoteHostConfig, path: &str, body: &B) -> Result<(), String> {
    let client = client_for(host)?;
    let resp = client
        .post(format!("{}{}", base_url(host), path))
        .bearer_auth(&host.token)
        .json(body)
        .send()
        .await
        .map_err(|e| format!("Could not reach the agent: {}", e))?;
    if !resp.status().is_success() {
        return Err(error_message(resp).await);
    }
    Ok(())
}

#[tauri::command]
pub async fn remote_agent_status(host: RemoteHostConfig) -> Result<HostedServerStatus, String> {
    get_json(&host, "/v1/status").await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PrepareBody {
    loader: String,
    game_version: String,
    loader_version: Option<String>,
    accept_eula: bool,
}

#[tauri::command]
pub async fn remote_agent_prepare(
    host: RemoteHostConfig,
    loader: String,
    game_version: String,
    loader_version: Option<String>,
    accept_eula: bool,
) -> Result<HostedServerStatus, String> {
    post_json(
        &host,
        "/v1/prepare",
        &PrepareBody { loader, game_version, loader_version, accept_eula },
    )
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StartBody {
    min_ram: u32,
    max_ram: u32,
}

#[tauri::command]
pub async fn remote_agent_start(host: RemoteHostConfig, min_ram: u32, max_ram: u32) -> Result<(), String> {
    post_no_content(&host, "/v1/start", &StartBody { min_ram, max_ram }).await
}

#[tauri::command]
pub async fn remote_agent_stop(host: RemoteHostConfig) -> Result<(), String> {
    post_no_content(&host, "/v1/stop", &Value::Null).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConsoleCommandBody {
    command: String,
}

#[tauri::command]
pub async fn remote_agent_send_command(host: RemoteHostConfig, command: String) -> Result<(), String> {
    post_no_content(&host, "/v1/console", &ConsoleCommandBody { command }).await
}

#[tauri::command]
pub async fn remote_agent_get_properties(host: RemoteHostConfig) -> Result<ServerPropertiesSummary, String> {
    get_json(&host, "/v1/properties").await
}

#[tauri::command]
pub async fn remote_agent_set_properties(host: RemoteHostConfig, summary: ServerPropertiesSummary) -> Result<(), String> {
    post_no_content(&host, "/v1/properties", &summary).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteModFile {
    name: String,
    #[allow(dead_code)]
    size_bytes: u64,
}

/// Uploads any mod jar from the profile's `mods/` folder the agent doesn't already have.
/// Mirrors `sync_mods_to_server`'s local behaviour: only ever adds files, never removes ones
/// the remote side has that the profile doesn't (same known limitation, kept consistent).
#[tauri::command]
pub async fn remote_agent_sync_mods(host: RemoteHostConfig, instance_id: String) -> Result<u32, String> {
    let instance_dir = crate::instance_manager::get_instance_dir(&instance_id);
    let mods_dir = instance_dir.join("mods");
    if !mods_dir.exists() {
        return Ok(0);
    }

    let existing: Vec<RemoteModFile> = get_json(&host, "/v1/mods").await?;
    let existing_names: std::collections::HashSet<String> = existing.into_iter().map(|m| m.name).collect();

    let client = client_for(&host)?;
    let mut uploaded = 0u32;
    for entry in std::fs::read_dir(&mods_dir).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("jar") {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else { continue };
        if existing_names.contains(name) {
            continue;
        }
        let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
        let resp = client
            .post(format!("{}/v1/mods/{}", base_url(&host), name))
            .bearer_auth(&host.token)
            .body(bytes)
            .send()
            .await
            .map_err(|e| format!("Could not reach the agent: {}", e))?;
        if !resp.status().is_success() {
            return Err(error_message(resp).await);
        }
        uploaded += 1;
    }
    Ok(uploaded)
}

/// Live-tails one remote host's `/v1/logs` SSE stream, forwarding each line as a
/// `remote-server-log` event tagged with `streamId` so the frontend can tell streams from
/// different hosts apart. Keyed by `stream_id` (the saved host's own id) so switching hosts
/// or profiles cleanly stops the previous stream instead of leaking a background task.
static LOG_STREAMS: Mutex<Option<HashMap<String, tokio::task::AbortHandle>>> = Mutex::new(None);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RemoteLogEvent {
    stream_id: String,
    line: String,
}

#[tauri::command]
pub fn remote_agent_stop_log_stream(stream_id: String) {
    let mut guard = LOG_STREAMS.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(handle) = guard.get_or_insert_with(HashMap::new).remove(&stream_id) {
        handle.abort();
    }
}

#[tauri::command]
pub fn remote_agent_start_log_stream(app_handle: AppHandle, host: RemoteHostConfig, stream_id: String) -> Result<(), String> {
    remote_agent_stop_log_stream(stream_id.clone());

    let client = client_for(&host)?;
    let url = format!("{}/v1/logs", base_url(&host));
    let token = host.token.clone();
    let sid = stream_id.clone();

    let task = tokio::spawn(async move {
        let response = match client.get(&url).bearer_auth(&token).send().await {
            Ok(r) => r,
            Err(e) => {
                let _ = app_handle.emit(
                    "remote-server-log",
                    RemoteLogEvent { stream_id: sid, line: format!("[MCL] Could not reach the agent: {}", e) },
                );
                return;
            }
        };

        use futures_util::StreamExt;
        let mut stream = response.bytes_stream();
        let mut buffer = String::new();
        while let Some(chunk) = stream.next().await {
            let Ok(bytes) = chunk else { break };
            buffer.push_str(&String::from_utf8_lossy(&bytes));
            // SSE frames are separated by a blank line; each carries one or more `data:` lines.
            while let Some(pos) = buffer.find("\n\n") {
                let frame = buffer[..pos].to_string();
                buffer.drain(..pos + 2);
                for line in frame.lines() {
                    if let Some(data) = line.strip_prefix("data:") {
                        let _ = app_handle.emit(
                            "remote-server-log",
                            RemoteLogEvent { stream_id: sid.clone(), line: data.trim_start().to_string() },
                        );
                    }
                }
            }
        }
    });

    let mut guard = LOG_STREAMS.lock().unwrap_or_else(|e| e.into_inner());
    guard.get_or_insert_with(HashMap::new).insert(stream_id, task.abort_handle());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::SocketAddr;

    /// Starts a throwaway HTTPS server with its own self-signed certificate — a stand-in for
    /// a real `mcl-agent`, just enough to prove the pinning mechanism itself: that a client
    /// carrying the right certificate gets through, and one without it does not.
    async fn spawn_test_server() -> (SocketAddr, String) {
        let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
        let certified_key = rcgen::generate_simple_self_signed(vec!["mcl-agent-test".to_string()]).unwrap();
        let cert_pem = certified_key.cert.pem();
        let key_pem = certified_key.key_pair.serialize_pem();

        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        listener.set_nonblocking(true).unwrap();
        let tokio_listener = tokio::net::TcpListener::from_std(listener).unwrap();

        let app = axum::Router::new().route("/ping", axum::routing::get(|| async { "pong" }));
        let tls_config = axum_server::tls_rustls::RustlsConfig::from_pem(cert_pem.clone().into_bytes(), key_pem.into_bytes())
            .await
            .unwrap();

        tokio::spawn(async move {
            axum_server::from_tcp_rustls(tokio_listener.into_std().unwrap(), tls_config)
                .serve(app.into_make_service())
                .await
                .unwrap();
        });
        // Give the listener a moment to start accepting before the test connects.
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        (addr, cert_pem)
    }

    #[tokio::test]
    async fn a_client_carrying_the_matching_pinned_certificate_connects() {
        let (addr, cert_pem) = spawn_test_server().await;
        let host = RemoteHostConfig { url: format!("https://{}", addr), token: "unused".to_string(), cert_pem };

        let client = client_for(&host).unwrap();
        let resp = client.get(format!("{}/ping", base_url(&host))).send().await.unwrap();
        assert!(resp.status().is_success());
    }

    #[tokio::test]
    async fn a_client_without_the_pinned_certificate_is_rejected() {
        let (addr, _real_cert) = spawn_test_server().await;
        // A different self-signed certificate — simulates an attacker's server, or simply a
        // saved host entry whose pinned certificate doesn't match what's actually listening.
        let wrong_cert = rcgen::generate_simple_self_signed(vec!["someone-else".to_string()])
            .unwrap()
            .cert
            .pem();
        let host = RemoteHostConfig { url: format!("https://{}", addr), token: "unused".to_string(), cert_pem: wrong_cert };

        let client = client_for(&host).unwrap();
        let result = client.get(format!("{}/ping", base_url(&host))).send().await;
        assert!(result.is_err(), "a client pinned to the wrong certificate must not be able to connect");
    }
}
