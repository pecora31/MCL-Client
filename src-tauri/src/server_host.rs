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
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{ChildStdin, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ServerState {
    Stopped,
    Starting,
    Running,
    Crashed,
}

struct RunningEntry {
    pid: u32,
    state: ServerState,
    /// Set right before a stop is requested (gracefully or by force), so the wait thread can
    /// tell an intentional shutdown apart from the process dying on its own.
    expected_stop: bool,
}

/// One entry per server directory (as a string) rather than an instance id, so the same map
/// works whether the caller is the desktop app (one entry per profile) or the agent (a single
/// entry for the one server it manages).
static RUNNING_SERVERS: Mutex<Option<HashMap<String, RunningEntry>>> = Mutex::new(None);

/// The running process's stdin, kept separately since `ChildStdin` cannot be cloned or copied
/// into `RunningEntry` alongside the plain state fields above.
static STDIN_HANDLES: Mutex<Option<HashMap<String, ChildStdin>>> = Mutex::new(None);

fn with_running<T>(f: impl FnOnce(&mut HashMap<String, RunningEntry>) -> T) -> T {
    let mut guard = RUNNING_SERVERS.lock().unwrap_or_else(|e| e.into_inner());
    let map = guard.get_or_insert_with(HashMap::new);
    f(map)
}

fn with_stdin<T>(f: impl FnOnce(&mut HashMap<String, ChildStdin>) -> T) -> T {
    let mut guard = STDIN_HANDLES.lock().unwrap_or_else(|e| e.into_inner());
    let map = guard.get_or_insert_with(HashMap::new);
    f(map)
}

fn dir_key(server_dir: &Path) -> String {
    server_dir.to_string_lossy().to_string()
}

/// Where the running process's PID is mirrored to disk, so a restarted MCL app or a restarted
/// `mcl-agent` (its own process, entirely separate from the child java process it spawned) can
/// tell a server is still alive instead of forgetting about it the moment the in-memory map
/// that tracked it is gone. This is the only thing that survives a restart — the actual stdin
/// pipe to the child does not, so a reconciled server loses live console control (see
/// `send_command`) until it is stopped and started again from the current process.
fn pid_file_path(server_dir: &Path) -> std::path::PathBuf {
    server_dir.join(".mcl-server.pid")
}

#[cfg(target_os = "windows")]
fn is_process_alive(pid: u32) -> bool {
    let output = crate::hidden_process::hidden_command("tasklist")
        .args(["/FI", &format!("PID eq {}", pid), "/NH"])
        .output();
    match output {
        Ok(out) => {
            let text = String::from_utf8_lossy(&out.stdout);
            text.contains(&pid.to_string())
        }
        Err(_) => false,
    }
}

#[cfg(not(target_os = "windows"))]
fn is_process_alive(pid: u32) -> bool {
    Path::new(&format!("/proc/{}", pid)).exists()
}

/// Called when a status check finds nothing in the in-memory map, meaning either this server
/// was never started from the current process, or it was, but the process (MCL, or the agent)
/// has since restarted. Adopts a still-alive process back into the map so its status reports
/// correctly, and clears a stale PID file left by one that is no longer running.
fn reconcile_from_disk(server_dir: &Path, key: &str) -> ServerState {
    let pid_path = pid_file_path(server_dir);
    let Ok(contents) = std::fs::read_to_string(&pid_path) else {
        return ServerState::Stopped;
    };
    let Ok(pid) = contents.trim().parse::<u32>() else {
        let _ = std::fs::remove_file(&pid_path);
        return ServerState::Stopped;
    };
    if pid != 0 && is_process_alive(pid) {
        with_running(|m| {
            m.insert(key.to_string(), RunningEntry { pid, state: ServerState::Running, expected_stop: false });
        });
        ServerState::Running
    } else {
        let _ = std::fs::remove_file(&pid_path);
        ServerState::Stopped
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostedServerStatus {
    pub state: ServerState,
    pub has_jar: bool,
    pub server_dir: String,
}

pub fn get_status(
    server_dir: &Path,
    loader: &str,
    game_version: &str,
    loader_version: Option<&str>,
) -> HostedServerStatus {
    let key = dir_key(server_dir);
    let state = match with_running(|m| m.get(&key).map(|e| e.state)) {
        Some(state) => state,
        None => reconcile_from_disk(server_dir, &key),
    };
    HostedServerStatus {
        state,
        has_jar: is_prepared(server_dir, loader, game_version, loader_version),
        server_dir: key,
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

/// Every current loader (Vanilla, Fabric, Forge, NeoForge, Quilt, and the forks built on top
/// of them) prints this exact line, unmodified from vanilla's own `MinecraftServer` class,
/// once the world has finished loading and the server is ready to accept players.
fn looks_like_ready_line(line: &str) -> bool {
    line.contains("Done (")
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
    if with_running(|m| m.get(&key).map(|e| e.pid != 0).unwrap_or(false)) {
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
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Could not start the server ({}): {}", java_bin, e))?;
    let pid = child.id();

    if let Some(stdin) = child.stdin.take() {
        with_stdin(|m| {
            m.insert(key.clone(), stdin);
        });
    }
    with_running(|m| {
        m.insert(key.clone(), RunningEntry { pid, state: ServerState::Starting, expected_stop: false });
    });
    let _ = std::fs::write(pid_file_path(server_dir), pid.to_string());

    let on_log = std::sync::Arc::new(on_log);
    for (pipe, watch_for_ready) in [
        (child.stdout.take().map(|s| Box::new(s) as Box<dyn std::io::Read + Send>), true),
        (child.stderr.take().map(|s| Box::new(s) as Box<dyn std::io::Read + Send>), false),
    ] {
        let Some(pipe) = pipe else { continue };
        let on_log = on_log.clone();
        let key = key.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                if watch_for_ready && looks_like_ready_line(&line) {
                    with_running(|m| {
                        if let Some(entry) = m.get_mut(&key) {
                            if entry.state == ServerState::Starting {
                                entry.state = ServerState::Running;
                            }
                        }
                    });
                }
                on_log(line);
            }
        });
    }

    let pid_path = pid_file_path(server_dir);
    std::thread::spawn(move || {
        let exit = child.wait();
        let _ = std::fs::remove_file(&pid_path);
        with_stdin(|m| {
            m.remove(&key);
        });
        with_running(|m| {
            let expected = m.get(&key).map(|e| e.expected_stop).unwrap_or(false);
            let crashed = !expected && !matches!(exit, Ok(status) if status.success());
            m.insert(
                key.clone(),
                RunningEntry {
                    pid: 0,
                    state: if crashed { ServerState::Crashed } else { ServerState::Stopped },
                    expected_stop: false,
                },
            );
        });
    });

    Ok(())
}

/// Writes a line to the running server's console, exactly as if it had been typed at the
/// server's own terminal, one of "op <player>", "whitelist add <player>", "say hello", and so
/// on. Recognizing "stop" here (rather than requiring callers to also flag it) means a player
/// typing it directly into the console box still gets marked as an intentional shutdown.
pub fn send_command(server_dir: &Path, command: &str) -> Result<(), String> {
    let key = dir_key(server_dir);
    if command.trim().eq_ignore_ascii_case("stop") {
        with_running(|m| {
            if let Some(entry) = m.get_mut(&key) {
                entry.expected_stop = true;
            }
        });
    }
    let has_stdin = with_stdin(|m| m.contains_key(&key));
    if !has_stdin {
        // Might still be alive, just started before the current process (MCL or the agent)
        // last restarted — there is no OS-level way to regain a stdin pipe to a process this
        // one did not itself spawn, so this is a real limitation, not a bug to route around.
        let alive = with_running(|m| m.get(&key).map(|e| e.pid != 0)).unwrap_or(false);
        return Err(if alive {
            "This server is running, but MCL lost its console connection to it (probably restarted since starting it). Stop it and start it again to regain console control.".to_string()
        } else {
            "This server is not running.".to_string()
        });
    }
    with_stdin(|m| {
        let stdin = m.get_mut(&key).ok_or_else(|| "This server is not running.".to_string())?;
        stdin
            .write_all(format!("{}\n", command).as_bytes())
            .and_then(|_| stdin.flush())
            .map_err(|e| format!("Could not send the command: {}", e))
    })
}

/// Stops the server gracefully with the same "stop" command a player would type, giving it up
/// to 10 seconds to save the world and exit on its own before force-killing it. A forced kill
/// mid-save risks corrupting whatever the server hadn't finished writing yet, so this is worth
/// the wait whenever the process is still responsive enough to accept the command at all.
pub fn stop_server(server_dir: &Path) -> Result<bool, String> {
    let key = dir_key(server_dir);
    let mut pid = with_running(|m| m.get(&key).map(|e| e.pid).unwrap_or(0));
    if pid == 0 {
        // Not in memory, might still be a server this process hasn't reconciled yet (a fresh
        // MCL or agent restart) — check disk before concluding there is nothing to stop.
        reconcile_from_disk(server_dir, &key);
        pid = with_running(|m| m.get(&key).map(|e| e.pid).unwrap_or(0));
    }
    if pid == 0 {
        return Ok(false);
    }

    with_running(|m| {
        if let Some(entry) = m.get_mut(&key) {
            entry.expected_stop = true;
        }
    });

    if send_command(server_dir, "stop").is_ok() {
        let deadline = Instant::now() + Duration::from_secs(10);
        while Instant::now() < deadline {
            let still_running = with_running(|m| m.get(&key).map(|e| e.pid != 0).unwrap_or(false));
            if !still_running {
                return Ok(true);
            }
            std::thread::sleep(Duration::from_millis(300));
        }
    }

    // Either stdin was already gone or it did not exit in time; force-kill as a fallback.
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

    // A server adopted via `reconcile_from_disk` has no `Child` in this process, so nothing
    // else will ever flip its state or clean up its PID file the way the wait thread in
    // `start_server` does for one this process spawned itself — that has to happen here.
    let _ = std::fs::remove_file(pid_file_path(server_dir));
    with_running(|m| {
        m.insert(key, RunningEntry { pid: 0, state: ServerState::Stopped, expected_stop: false });
    });

    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_fresh_server_dir_reports_not_running_and_no_jar() {
        let map_before = with_running(|m| m.iter().map(|(k, _)| k.clone()).collect::<Vec<_>>());
        assert!(!map_before.contains(&"never-started".to_string()));
    }

    #[test]
    fn stopping_a_server_that_was_never_started_reports_nothing_to_stop() {
        assert_eq!(stop_server(Path::new("Z:\\nonexistent-server-dir")), Ok(false));
    }

    #[test]
    fn sending_a_command_to_a_server_that_is_not_running_fails_clearly() {
        let err = send_command(Path::new("Z:\\nonexistent-server-dir-2"), "say hi").unwrap_err();
        assert!(err.contains("not running"));
    }

    #[test]
    fn a_directory_with_no_entry_reports_stopped() {
        let dir = Path::new("Z:\\never-touched-server-dir");
        let status = get_status(dir, "vanilla", "1.21.1", None);
        assert_eq!(status.state, ServerState::Stopped);
    }

    #[test]
    fn the_current_process_is_reported_alive() {
        assert!(is_process_alive(std::process::id()));
    }

    #[test]
    fn a_pid_that_does_not_exist_is_reported_not_alive() {
        // Not a guaranteed-unused PID on every possible system, but far enough into the
        // unlikely range that a real process holding it during a test run is not realistic.
        assert!(!is_process_alive(999_999));
    }

    fn temp_test_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("mcl-server-host-test-{}", name));
        let _ = std::fs::create_dir_all(&dir);
        dir
    }

    #[test]
    fn a_stale_pid_file_is_cleared_and_reports_stopped() {
        let dir = temp_test_dir("stale-pid");
        std::fs::write(pid_file_path(&dir), "999999").unwrap();

        let status = get_status(&dir, "vanilla", "1.21.1", None);

        assert_eq!(status.state, ServerState::Stopped);
        assert!(!pid_file_path(&dir).exists(), "a stale PID file should be cleaned up");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_pid_file_for_a_live_process_is_adopted_as_running() {
        let dir = temp_test_dir("live-pid");
        std::fs::write(pid_file_path(&dir), std::process::id().to_string()).unwrap();

        let status = get_status(&dir, "vanilla", "1.21.1", None);

        assert_eq!(status.state, ServerState::Running);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
