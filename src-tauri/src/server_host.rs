// Self-hosting: run a dedicated server for a given loader/version on this machine, so its
// owner can host and join without touching a terminal.
//
// Every function here takes plain loader/version/directory values rather than a `GameInstance`
// or a Tauri `AppHandle`, so this module has no dependency on the desktop app's profile model
// or its UI runtime — the desktop app's Tauri commands resolve those from a profile and pass
// the raw values in, and the standalone `mcl-agent` binary (managing a server on a remote
// machine that has no concept of an MCL profile) calls the exact same functions directly.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::Stdio;
use std::sync::Mutex;

/// One running server's PID, keyed by its server directory (as a string) rather than an
/// instance id, so the same map works whether the caller is the desktop app (one entry per
/// profile) or the agent (a single entry for the one server it manages).
static RUNNING_SERVERS: Mutex<Option<HashMap<String, u32>>> = Mutex::new(None);

fn with_running<T>(f: impl FnOnce(&mut HashMap<String, u32>) -> T) -> T {
    let mut guard = RUNNING_SERVERS.lock().unwrap_or_else(|e| e.into_inner());
    let map = guard.get_or_insert_with(HashMap::new);
    f(map)
}

fn dir_key(server_dir: &Path) -> String {
    server_dir.to_string_lossy().to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostedServerStatus {
    pub running: bool,
    pub has_jar: bool,
    pub server_dir: String,
}

pub fn get_status(
    server_dir: &Path,
    loader: &str,
    game_version: &str,
    loader_version: Option<&str>,
) -> HostedServerStatus {
    let running = with_running(|m| m.get(&dir_key(server_dir)).copied().unwrap_or(0) != 0);
    HostedServerStatus {
        running,
        has_jar: is_prepared(server_dir, loader, game_version, loader_version),
        server_dir: dir_key(server_dir),
    }
}

/// Whether a server has already been prepared in this directory. Vanilla/Fabric/Quilt drop a
/// single runnable `server.jar`; Forge/NeoForge's installer instead leaves a `libraries/`
/// tree plus a `win_args.txt`/`unix_args.txt` argfile that `start_server` launches java with.
fn is_prepared(server_dir: &Path, loader: &str, game_version: &str, loader_version: Option<&str>) -> bool {
    match loader {
        "forge" | "neoforge" => match loader_version {
            Some(loader_version) => crate::minecraft_core::forge::server_args_file(
                loader,
                game_version,
                loader_version,
                &server_dir.join("libraries"),
            )
            .exists(),
            None => false,
        },
        _ => server_dir.join("server.jar").exists(),
    }
}

/// Prepares a ready-to-run server for the given loader inside `server_dir`. Vanilla and
/// Fabric/Quilt each publish a single jar directly; Forge/NeoForge instead run their own
/// installer in `--installServer` mode, the same official tool `install_and_resolve` runs
/// for the client side.
pub async fn prepare_server_jar(
    loader: &str,
    game_version: &str,
    loader_version: Option<&str>,
    common_dir: &Path,
    server_dir: &Path,
) -> Result<(), String> {
    std::fs::create_dir_all(server_dir).map_err(|e| e.to_string())?;

    match loader {
        "vanilla" => {
            let details = crate::minecraft_core::version::get_version_details(common_dir, game_version).await?;
            let url = details
                .downloads
                .server
                .ok_or_else(|| format!("Minecraft {} has no server download listed.", game_version))?
                .url;
            download_to_file(&url, &server_dir.join("server.jar")).await?;
        }
        "fabric" | "quilt" => {
            let endpoints = crate::minecraft_core::fabric::loader_endpoints(loader)
                .ok_or_else(|| format!("Unknown loader: {}", loader))?;
            let loader_ver = loader_version
                .ok_or_else(|| format!("This profile has no {} version selected.", endpoints.display_name))?;
            let installer_ver = latest_installer_version(endpoints.meta_root).await?;
            let url = format!(
                "{}/versions/loader/{}/{}/{}/server/jar",
                endpoints.meta_root, game_version, loader_ver, installer_ver
            );
            download_to_file(&url, &server_dir.join("server.jar")).await?;
        }
        "forge" | "neoforge" => {
            let loader_ver = loader_version
                .ok_or_else(|| "This profile has no loader version selected.".to_string())?;
            crate::minecraft_core::forge::install_server(loader, game_version, loader_ver, common_dir, server_dir)
                .await?;
        }
        other => return Err(format!("Unknown loader: {}", other)),
    }

    Ok(())
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

/// Copies mods from `instance_dir/mods` into the server's mods folder so both sides match
/// without the player keeping two folders in sync by hand. Client-only mods are not a problem
/// here: every current loader already skips a mod declared client-only when running as a
/// server. Only meaningful for the desktop app — the agent has no such source folder to copy
/// from, since a remote server manages its own mods directly.
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

/// Starts the server already prepared in `server_dir`, calling `on_log` with each console
/// line as it's produced. The desktop app forwards those as `server-log` Tauri events; the
/// agent fans them out to whichever HTTP clients are currently watching its log stream.
pub fn start_server(
    server_dir: &Path,
    loader: &str,
    game_version: &str,
    loader_version: Option<&str>,
    java_bin: &str,
    min_ram_mb: u32,
    max_ram_mb: u32,
    on_log: impl Fn(String) + Send + Sync + 'static,
) -> Result<(), String> {
    if !is_prepared(server_dir, loader, game_version, loader_version) {
        return Err("No server prepared for this profile yet.".to_string());
    }
    let key = dir_key(server_dir);
    if with_running(|m| m.get(&key).copied().unwrap_or(0) != 0) {
        return Err("This server is already running.".to_string());
    }

    let mut cmd = crate::hidden_process::hidden_command(java_bin);
    cmd.arg(format!("-Xms{}M", min_ram_mb));
    cmd.arg(format!("-Xmx{}M", max_ram_mb));
    match loader {
        "forge" | "neoforge" => {
            // Mirrors the run.bat/run.sh the installer itself generates: java expanded
            // with the installer's own argfile, which already carries the main class,
            // classpath and mod-loader arguments.
            let loader_version = loader_version
                .ok_or_else(|| "This profile has no loader version selected.".to_string())?;
            let args_file =
                crate::minecraft_core::forge::server_args_file(loader, game_version, loader_version, &server_dir.join("libraries"));
            cmd.arg(format!("@{}", args_file.to_string_lossy()));
            cmd.arg("--nogui");
        }
        _ => {
            cmd.arg("-jar").arg("server.jar").arg("--nogui");
        }
    }
    cmd.current_dir(server_dir);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Could not start the server ({}): {}", java_bin, e))?;
    let pid = child.id();
    with_running(|m| {
        m.insert(key.clone(), pid);
    });

    let on_log = std::sync::Arc::new(on_log);
    for pipe in [
        child.stdout.take().map(|s| Box::new(s) as Box<dyn std::io::Read + Send>),
        child.stderr.take().map(|s| Box::new(s) as Box<dyn std::io::Read + Send>),
    ]
    .into_iter()
    .flatten()
    {
        let on_log = on_log.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                on_log(line);
            }
        });
    }

    std::thread::spawn(move || {
        let _ = child.wait();
        with_running(|m| {
            m.insert(key.clone(), 0);
        });
    });

    Ok(())
}

pub fn stop_server(server_dir: &Path) -> Result<bool, String> {
    let key = dir_key(server_dir);
    let pid = with_running(|m| m.get(&key).copied().unwrap_or(0));
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
        m.insert(key, 0);
    });
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_fresh_server_dir_reports_not_running_and_no_jar() {
        let map_before = with_running(|m| m.clone());
        assert!(!map_before.contains_key("never-started"));
    }

    #[test]
    fn stopping_a_server_that_was_never_started_reports_nothing_to_stop() {
        assert_eq!(stop_server(Path::new("Z:\\nonexistent-server-dir")), Ok(false));
    }
}
