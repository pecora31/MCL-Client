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

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub name: String,
    pub size_bytes: u64,
    pub created_at: u64,
}

#[tauri::command]
pub async fn remote_agent_list_backups(host: RemoteHostConfig) -> Result<Vec<BackupInfo>, String> {
    get_json(&host, "/v1/backups").await
}

#[tauri::command]
pub async fn remote_agent_backup_now(host: RemoteHostConfig) -> Result<BackupInfo, String> {
    let client = client_for(&host)?;
    let resp = client
        .post(format!("{}/v1/backups", base_url(&host)))
        .bearer_auth(&host.token)
        .send()
        .await
        .map_err(|e| format!("Could not reach the agent: {}", e))?;
    if !resp.status().is_success() {
        return Err(error_message(resp).await);
    }
    resp.json::<BackupInfo>().await.map_err(|e| e.to_string())
}

/// Downloads one backup straight to `save_path` (chosen by the frontend via `rfd`'s native
/// save dialog) rather than returning the bytes through Tauri's IPC, so a large world backup
/// never has to round-trip through the webview's own memory.
#[tauri::command]
pub async fn remote_agent_download_backup(host: RemoteHostConfig, name: String, save_path: String) -> Result<(), String> {
    let client = client_for(&host)?;
    let resp = client
        .get(format!("{}/v1/backups/{}", base_url(&host), name))
        .bearer_auth(&host.token)
        .send()
        .await
        .map_err(|e| format!("Could not reach the agent: {}", e))?;
    if !resp.status().is_success() {
        return Err(error_message(resp).await);
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    tokio::fs::write(&save_path, &bytes).await.map_err(|e| format!("Could not save the backup: {}", e))
}

#[tauri::command]
pub async fn remote_agent_delete_backup(host: RemoteHostConfig, name: String) -> Result<(), String> {
    let client = client_for(&host)?;
    let resp = client
        .delete(format!("{}/v1/backups/{}", base_url(&host), name))
        .bearer_auth(&host.token)
        .send()
        .await
        .map_err(|e| format!("Could not reach the agent: {}", e))?;
    if !resp.status().is_success() {
        return Err(error_message(resp).await);
    }
    Ok(())
}

#[derive(Serialize)]
struct RestoreBody {
    name: String,
}

#[tauri::command]
pub async fn remote_agent_restore_backup(host: RemoteHostConfig, name: String) -> Result<(), String> {
    post_no_content(&host, "/v1/restore", &RestoreBody { name }).await
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteFileEntry {
    pub name: String,
    pub is_dir: bool,
    pub size_bytes: u64,
    pub modified_at: u64,
}

#[tauri::command]
pub async fn remote_agent_list_files(host: RemoteHostConfig, path: String) -> Result<Vec<RemoteFileEntry>, String> {
    let client = client_for(&host)?;
    let resp = client
        .get(format!("{}/v1/files", base_url(&host)))
        .query(&[("path", &path)])
        .bearer_auth(&host.token)
        .send()
        .await
        .map_err(|e| format!("Could not reach the agent: {}", e))?;
    if !resp.status().is_success() {
        return Err(error_message(resp).await);
    }
    resp.json::<Vec<RemoteFileEntry>>().await.map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MkdirBody {
    path: String,
}

#[tauri::command]
pub async fn remote_agent_mkdir(host: RemoteHostConfig, path: String) -> Result<(), String> {
    post_no_content(&host, "/v1/files/mkdir", &MkdirBody { path }).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RenameBody {
    from: String,
    to: String,
}

#[tauri::command]
pub async fn remote_agent_rename(host: RemoteHostConfig, from: String, to: String) -> Result<(), String> {
    post_no_content(&host, "/v1/files/rename", &RenameBody { from, to }).await
}

#[tauri::command]
pub async fn remote_agent_delete_file(host: RemoteHostConfig, path: String) -> Result<(), String> {
    let client = client_for(&host)?;
    let resp = client
        .delete(format!("{}/v1/files", base_url(&host)))
        .query(&[("path", &path)])
        .bearer_auth(&host.token)
        .send()
        .await
        .map_err(|e| format!("Could not reach the agent: {}", e))?;
    if !resp.status().is_success() {
        return Err(error_message(resp).await);
    }
    Ok(())
}

/// For the built-in text editor only — rejects anything that isn't valid UTF-8 here rather
/// than in the frontend, since Tauri's IPC needs a `String` either way. The frontend already
/// knows to fall back to download-only when this command errors.
#[tauri::command]
pub async fn remote_agent_read_text_file(host: RemoteHostConfig, path: String) -> Result<String, String> {
    let client = client_for(&host)?;
    let resp = client
        .get(format!("{}/v1/files/content", base_url(&host)))
        .query(&[("path", &path)])
        .bearer_auth(&host.token)
        .send()
        .await
        .map_err(|e| format!("Could not reach the agent: {}", e))?;
    if !resp.status().is_success() {
        return Err(error_message(resp).await);
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    String::from_utf8(bytes.to_vec()).map_err(|_| "This file isn't plain text.".to_string())
}

#[tauri::command]
pub async fn remote_agent_write_text_file(host: RemoteHostConfig, path: String, content: String) -> Result<(), String> {
    let client = client_for(&host)?;
    let resp = client
        .put(format!("{}/v1/files/content", base_url(&host)))
        .query(&[("path", &path)])
        .bearer_auth(&host.token)
        .body(content)
        .send()
        .await
        .map_err(|e| format!("Could not reach the agent: {}", e))?;
    if !resp.status().is_success() {
        return Err(error_message(resp).await);
    }
    Ok(())
}

/// Reads `local_path` off disk directly and streams its raw bytes to the agent — never through
/// a JavaScript `string`, so an arbitrary binary upload (a plugin jar, a datapack zip) can't be
/// corrupted the way it would be if it had to survive a UTF-8 round trip.
#[tauri::command]
pub async fn remote_agent_upload_file(host: RemoteHostConfig, local_path: String, remote_path: String) -> Result<(), String> {
    let bytes = tokio::fs::read(&local_path).await.map_err(|e| format!("Could not read {}: {}", local_path, e))?;
    let client = client_for(&host)?;
    let resp = client
        .put(format!("{}/v1/files/content", base_url(&host)))
        .query(&[("path", &remote_path)])
        .bearer_auth(&host.token)
        .body(bytes)
        .send()
        .await
        .map_err(|e| format!("Could not reach the agent: {}", e))?;
    if !resp.status().is_success() {
        return Err(error_message(resp).await);
    }
    Ok(())
}

/// The download counterpart to `remote_agent_upload_file` — writes straight to
/// `local_save_path` rather than returning bytes through Tauri's IPC, same reasoning as
/// `remote_agent_download_backup`.
#[tauri::command]
pub async fn remote_agent_download_file(host: RemoteHostConfig, remote_path: String, local_save_path: String) -> Result<(), String> {
    let client = client_for(&host)?;
    let resp = client
        .get(format!("{}/v1/files/content", base_url(&host)))
        .query(&[("path", &remote_path)])
        .bearer_auth(&host.token)
        .send()
        .await
        .map_err(|e| format!("Could not reach the agent: {}", e))?;
    if !resp.status().is_success() {
        return Err(error_message(resp).await);
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    tokio::fs::write(&local_save_path, &bytes).await.map_err(|e| format!("Could not save the file: {}", e))
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
        let mut retry_count = 0;
        const MAX_RETRIES: u32 = 8;

        loop {
            let response = match client.get(&url).bearer_auth(&token).send().await {
                Ok(r) if r.status().is_success() => {
                    if retry_count > 0 {
                        let _ = app_handle.emit(
                            "remote-server-log",
                            RemoteLogEvent { stream_id: sid.clone(), line: "[MCL] Connection restored to remote agent.".to_string() },
                        );
                        retry_count = 0;
                    }
                    r
                }
                Ok(r) => {
                    let _ = app_handle.emit(
                        "remote-server-log",
                        RemoteLogEvent { stream_id: sid.clone(), line: format!("[MCL] Log stream disconnected (HTTP {}). Retrying...", r.status()) },
                    );
                    retry_count += 1;
                    if retry_count > MAX_RETRIES {
                        break;
                    }
                    let delay = std::cmp::min(1000 * (1 << retry_count.min(4)), 8000);
                    tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
                    continue;
                }
                Err(e) => {
                    let _ = app_handle.emit(
                        "remote-server-log",
                        RemoteLogEvent { stream_id: sid.clone(), line: format!("[MCL] Cannot reach agent: {}. Reconnecting...", e) },
                    );
                    retry_count += 1;
                    if retry_count > MAX_RETRIES {
                        let _ = app_handle.emit(
                            "remote-server-log",
                            RemoteLogEvent { stream_id: sid.clone(), line: "[MCL] Max reconnection attempts reached. Check host status.".to_string() },
                        );
                        break;
                    }
                    let delay = std::cmp::min(1000 * (1 << retry_count.min(4)), 8000);
                    tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
                    continue;
                }
            };

            use futures_util::StreamExt;
            let mut stream = response.bytes_stream();
            let mut buffer = String::new();
            let mut stream_died = false;

            while let Some(chunk) = stream.next().await {
                let Ok(bytes) = chunk else {
                    stream_died = true;
                    break;
                };
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

            // Stream reached EOF or encountered an error while connected
            if stream_died || buffer.is_empty() {
                retry_count += 1;
                if retry_count > MAX_RETRIES {
                    let _ = app_handle.emit(
                        "remote-server-log",
                        RemoteLogEvent { stream_id: sid.clone(), line: "[MCL] Remote agent closed the log connection.".to_string() },
                    );
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
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
