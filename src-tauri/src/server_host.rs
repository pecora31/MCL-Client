// Self-hosting: run a dedicated server for a profile's own loader/version, on this machine,
// so its owner can host and join from the same computer without touching a terminal.
//
// The server lives at `<instance_dir>/server/` — inside the profile's own folder, not
// somewhere new MCL has to remember separately, so every other feature that already knows
// where a profile lives (Server Config among them) keeps working here unchanged.

use crate::models::GameInstance;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

/// One running server's PID, keyed by instance id. A plain `u32` (0 = not running) per
/// instance, the same shape `launcher.rs` uses for the foreground game process.
static RUNNING_SERVERS: Mutex<Option<HashMap<String, u32>>> = Mutex::new(None);

fn with_running<T>(f: impl FnOnce(&mut HashMap<String, u32>) -> T) -> T {
    let mut guard = RUNNING_SERVERS.lock().unwrap_or_else(|e| e.into_inner());
    let map = guard.get_or_insert_with(HashMap::new);
    f(map)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostedServerStatus {
    pub running: bool,
    pub has_jar: bool,
    pub server_dir: String,
}

pub fn server_dir_for(instance: &GameInstance) -> PathBuf {
    crate::instance_manager::get_instance_dir(&instance.id).join("server")
}

pub fn get_status(instance: &GameInstance) -> HostedServerStatus {
    let dir = server_dir_for(instance);
    let running = with_running(|m| m.get(&instance.id).copied().unwrap_or(0) != 0);
    HostedServerStatus {
        running,
        has_jar: dir.join("server.jar").exists(),
        server_dir: dir.to_string_lossy().to_string(),
    }
}

/// Downloads a ready-to-run server jar for the profile's loader into `<server_dir>/server.jar`.
/// Vanilla and Fabric/Quilt each publish one directly; Forge/NeoForge instead ship an
/// installer that has to be run as its own process to produce a server — not built yet, so
/// hosting is only offered for the loaders this can actually prepare.
pub async fn prepare_server_jar(
    loader: &str,
    game_version: &str,
    loader_version: Option<&str>,
    common_dir: &Path,
    server_dir: &Path,
) -> Result<PathBuf, String> {
    std::fs::create_dir_all(server_dir).map_err(|e| e.to_string())?;
    let dest = server_dir.join("server.jar");

    let url = match loader {
        "vanilla" => {
            let details = crate::minecraft_core::version::get_version_details(common_dir, game_version).await?;
            details
                .downloads
                .server
                .ok_or_else(|| format!("Minecraft {} has no server download listed.", game_version))?
                .url
        }
        "fabric" | "quilt" => {
            let endpoints = crate::minecraft_core::fabric::loader_endpoints(loader)
                .ok_or_else(|| format!("Unknown loader: {}", loader))?;
            let loader_ver = loader_version
                .ok_or_else(|| format!("This profile has no {} version selected.", endpoints.display_name))?;
            let installer_ver = latest_installer_version(endpoints.meta_root).await?;
            format!(
                "{}/versions/loader/{}/{}/{}/server/jar",
                endpoints.meta_root, game_version, loader_ver, installer_ver
            )
        }
        "forge" | "neoforge" => {
            return Err(format!(
                "Hosting a {} server isn't supported yet — only Vanilla, Fabric and Quilt can be hosted right now.",
                loader
            ));
        }
        other => return Err(format!("Unknown loader: {}", other)),
    };

    download_to_file(&url, &dest).await?;
    Ok(dest)
}

#[derive(Deserialize)]
struct InstallerVersion {
    version: String,
    stable: bool,
}

/// Fabric and Quilt's server-jar endpoint takes their own installer's version, separate from
/// the loader version — always just "whatever the newest stable installer is", the same
/// choice their own official installer makes by default.
async fn latest_installer_version(meta_root: &str) -> Result<String, String> {
    let client = reqwest::Client::new();
    let versions: Vec<InstallerVersion> = client
        .get(format!("{}/versions/installer", meta_root))
        .send()
        .await
        .map_err(|e| format!("Could not reach {}: {}", meta_root, e))?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    versions
        .into_iter()
        .find(|v| v.stable)
        .map(|v| v.version)
        .ok_or_else(|| "No stable installer version was published.".to_string())
}

async fn download_to_file(url: &str, dest: &Path) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .user_agent("MCLClient-Launcher/1.0")
        .build()
        .map_err(|e| e.to_string())?;
    let bytes = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {}", e))?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;
    std::fs::write(dest, &bytes).map_err(|e| e.to_string())
}

/// Mojang requires this file exist and say `eula=true` before the server jar will run at
/// all — only ever written after the player has actually agreed to it in MCL's own UI.
pub fn accept_eula(server_dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(server_dir).map_err(|e| e.to_string())?;
    std::fs::write(server_dir.join("eula.txt"), "eula=true\n").map_err(|e| e.to_string())
}

/// Copies the profile's own mods into the server's mods folder so both sides match without
/// the player keeping two folders in sync by hand. Client-only mods are not a problem here:
/// every current loader already skips a mod declared client-only when running as a server.
pub fn sync_mods_to_server(instance_dir: &Path, server_dir: &Path) -> Result<(), String> {
    let src = instance_dir.join("mods");
    if !src.exists() {
        return Ok(());
    }
    let dst = server_dir.join("mods");
    std::fs::create_dir_all(&dst).map_err(|e| e.to_string())?;
    for entry in std::fs::read_dir(&src).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("jar") {
            if let Some(name) = path.file_name() {
                let _ = std::fs::copy(&path, dst.join(name));
            }
        }
    }
    Ok(())
}

/// Starts the server jar already prepared in `<instance_dir>/server/`, streaming its console
/// output to the frontend as `server-log` events the same way `launcher.rs` streams the
/// game's own output as `mc-log`.
pub fn start_server(
    app_handle: &AppHandle,
    instance: &GameInstance,
    java_bin: &str,
    min_ram_mb: u32,
    max_ram_mb: u32,
) -> Result<(), String> {
    let server_dir = server_dir_for(instance);
    if !server_dir.join("server.jar").exists() {
        return Err("No server.jar prepared for this profile yet.".to_string());
    }
    if with_running(|m| m.get(&instance.id).copied().unwrap_or(0) != 0) {
        return Err("This profile's server is already running.".to_string());
    }

    let mut cmd = crate::hidden_process::hidden_command(java_bin);
    cmd.arg(format!("-Xms{}M", min_ram_mb));
    cmd.arg(format!("-Xmx{}M", max_ram_mb));
    cmd.arg("-jar").arg("server.jar").arg("--nogui");
    cmd.current_dir(&server_dir);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Could not start the server ({}): {}", java_bin, e))?;
    let pid = child.id();
    with_running(|m| {
        m.insert(instance.id.clone(), pid);
    });

    for pipe in [child.stdout.take().map(|s| Box::new(s) as Box<dyn std::io::Read + Send>), child.stderr.take().map(|s| Box::new(s) as Box<dyn std::io::Read + Send>)]
        .into_iter()
        .flatten()
    {
        let app = app_handle.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                let _ = app.emit("server-log", line);
            }
        });
    }

    let instance_id = instance.id.clone();
    std::thread::spawn(move || {
        let _ = child.wait();
        with_running(|m| {
            m.insert(instance_id.clone(), 0);
        });
    });

    Ok(())
}

pub fn stop_server(instance_id: &str) -> Result<bool, String> {
    let pid = with_running(|m| m.get(instance_id).copied().unwrap_or(0));
    if pid == 0 {
        return Ok(false);
    }

    #[cfg(target_os = "windows")]
    {
        let _ = crate::hidden_process::hidden_command("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .output();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = crate::hidden_process::hidden_command("kill")
            .args(["-9", &pid.to_string()])
            .output();
    }

    with_running(|m| {
        m.insert(instance_id.to_string(), 0);
    });
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_fresh_instance_reports_not_running_and_no_jar() {
        let map_before = with_running(|m| m.clone());
        assert!(!map_before.contains_key("never-started"));
    }

    #[test]
    fn stopping_a_server_that_was_never_started_reports_nothing_to_stop() {
        assert_eq!(stop_server("nonexistent-instance-id"), Ok(false));
    }
}
