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
use std::path::{Path, PathBuf};
use std::process::{ChildStdin, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ServerState {
    Stopped,
    Starting,
    Running,
    Crashed,
}

/// Long on purpose: the scan walks every region file in the world, so it has to stay far rarer
/// than the status poll that triggers it.
const WORLD_SIZE_TTL: Duration = Duration::from_secs(300);

/// How long a reported overload still counts as "currently lagging".
const LAG_REPORT_TTL: Duration = Duration::from_secs(60);

/// Restarting past this many crashes in a row would just be a loop around a broken jar or mod.
const MAX_CONSECUTIVE_CRASHES: u32 = 3;
const RESTART_DELAY: Duration = Duration::from_secs(10);

#[derive(Clone)]
struct RunningEntry {
    pid: u32,
    state: ServerState,
    /// Set right before a stop is requested (gracefully or by force), so the wait thread can
    /// tell an intentional shutdown apart from the process dying on its own.
    expected_stop: bool,
    /// Set when a stop is requested while no process is alive, which is the window a pending
    /// auto-restart sleeps in. `expected_stop` cannot carry this: the crash handler clears it,
    /// and `stop_server` returns early on a dead process before it would ever be set.
    restart_cancelled: bool,
    started_at: Option<Instant>,
    max_ram_mb: u32,
    consecutive_crashes: u32,
    last_crash_time: Option<Instant>,
    cached_world_size_bytes: Option<u64>,
    world_size_cached_at: Option<Instant>,
    cached_online_players: Option<u32>,
    cached_max_players: Option<u32>,
    cached_player_list: Option<Vec<String>>,
    cached_ping_ms: Option<u64>,
    slp_cached_at: Option<Instant>,
    cached_process_memory_mb: Option<u32>,
    process_memory_cached_at: Option<Instant>,
    /// How far behind the server reported itself the last time it logged "Can't keep up!", and
    /// when that was. This is the only lag signal vanilla actually emits — a status ping cannot
    /// measure tick rate, so nothing here is inferred from one.
    last_lag_behind_ms: Option<u64>,
    last_lag_at: Option<Instant>,
}

impl RunningEntry {
    fn new(pid: u32, state: ServerState, max_ram_mb: u32) -> Self {
        Self {
            pid,
            state,
            expected_stop: false,
            restart_cancelled: false,
            started_at: if state == ServerState::Running { Some(Instant::now()) } else { None },
            max_ram_mb,
            consecutive_crashes: 0,
            last_crash_time: None,
            cached_world_size_bytes: None,
            world_size_cached_at: None,
            cached_online_players: None,
            cached_max_players: None,
            cached_player_list: None,
            cached_ping_ms: None,
            slp_cached_at: None,
            cached_process_memory_mb: None,
            process_memory_cached_at: None,
            last_lag_behind_ms: None,
            last_lag_at: None,
        }
    }

    /// Wipes everything measured about a previous run, so a restarted server never shows the
    /// old run's uptime, player list or world size while the new one is still coming up.
    fn reset_run_metrics(&mut self) {
        self.started_at = None;
        self.cached_world_size_bytes = None;
        self.world_size_cached_at = None;
        self.cached_online_players = None;
        self.cached_max_players = None;
        self.cached_player_list = None;
        self.cached_ping_ms = None;
        self.slp_cached_at = None;
        self.cached_process_memory_mb = None;
        self.process_memory_cached_at = None;
        self.last_lag_behind_ms = None;
        self.last_lag_at = None;
    }
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
            // A server adopted from a pid file was started by some earlier process, so its
            // `-Xmx` is not knowable here — 0 reports it as unknown rather than inventing one.
            m.insert(key.to_string(), RunningEntry::new(pid, ServerState::Running, 0));
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uptime_seconds: Option<u64>,
    /// Resident memory of the java process, which is the whole process (heap + metaspace +
    /// thread stacks + GC overhead), not the heap alone — so it can legitimately read higher
    /// than the configured `-Xmx`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub process_memory_mb: Option<u32>,
    /// The `-Xmx` this server was started with.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_ram_mb: Option<u32>,
    /// Milliseconds the server last reported itself running behind, from its own "Can't keep
    /// up!" warning, and how long ago that was. Absent means it has not complained recently.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lag_behind_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lag_reported_seconds_ago: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub online_players: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_players: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub player_list: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub world_size_bytes: Option<u64>,
}

impl HostedServerStatus {
    pub fn stopped(server_dir: String) -> Self {
        Self {
            state: ServerState::Stopped,
            has_jar: false,
            server_dir,
            uptime_seconds: None,
            process_memory_mb: None,
            max_ram_mb: None,
            lag_behind_ms: None,
            lag_reported_seconds_ago: None,
            online_players: None,
            max_players: None,
            player_list: None,
            world_size_bytes: None,
        }
    }
}

/// Pulls the milliseconds out of the server's own overload warning, which vanilla logs as
/// "Can't keep up! Is the server overloaded? Running 2145ms or 42 ticks behind" (older builds
/// word the tail as "Running 2145ms behind, skipping 42 tick(s)"). Returning `None` for every
/// other line is what keeps this the only source of the lag figure — the status ping carries
/// no tick-rate information, so none is invented from it.
fn parse_lag_behind_ms(line: &str) -> Option<u64> {
    if !line.contains("Can't keep up") {
        return None;
    }
    let rest = line.split("Running ").nth(1)?;
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() || !rest[digits.len()..].starts_with("ms") {
        return None;
    }
    digits.parse().ok()
}

fn get_process_memory_mb(pid: u32) -> Option<u32> {
    let mut sys = sysinfo::System::new();
    let sysinfo_pid = sysinfo::Pid::from(pid as usize);
    sys.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[sysinfo_pid]), true);
    sys.process(sysinfo_pid).map(|p| (p.memory() / (1024 * 1024)) as u32)
}

fn calculate_folder_size(dir: &Path) -> u64 {
    walkdir::WalkDir::new(dir)
        .into_iter()
        .filter_map(Result::ok)
        .filter_map(|e| e.metadata().ok())
        .filter(|m| m.is_file())
        .map(|m| m.len())
        .sum()
}

fn refresh_world_size(key: String, world_dir: PathBuf) {
    std::thread::spawn(move || {
        let size = calculate_folder_size(&world_dir);
        with_running(|m| {
            if let Some(entry) = m.get_mut(&key) {
                entry.cached_world_size_bytes = Some(size);
                entry.world_size_cached_at = Some(Instant::now());
            }
        });
    });
}

fn refresh_slp_metrics(key: String, port: u16) {
    let task = async move {
        let status = crate::server_ping::ping_server("127.0.0.1", port).await;
        with_running(|m| {
            if let Some(entry) = m.get_mut(&key) {
                if entry.state == ServerState::Running {
                    entry.cached_online_players = status.players_online;
                    entry.cached_max_players = status.players_max;
                    entry.cached_player_list = status.player_sample;
                    entry.cached_ping_ms = status.ping_ms;
                    entry.slp_cached_at = Some(Instant::now());
                }
            }
        });
    };

    if let Ok(handle) = tokio::runtime::Handle::try_current() {
        handle.spawn(task);
    } else {
        std::thread::spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build();
            if let Ok(rt) = rt {
                rt.block_on(task);
            }
        });
    }
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

    if state != ServerState::Running {
        return HostedServerStatus {
            state,
            has_jar: is_prepared(server_dir, loader, game_version, loader_version),
            server_dir: key,
            uptime_seconds: None,
            process_memory_mb: None,
            max_ram_mb: None,
            lag_behind_ms: None,
            lag_reported_seconds_ago: None,
            online_players: None,
            max_players: None,
            player_list: None,
            world_size_bytes: None,
        };
    }

    let mut needs_world_size_refresh = false;
    let mut needs_slp_refresh = false;

    #[derive(Default)]
    struct Metrics {
        uptime_seconds: Option<u64>,
        process_memory_mb: Option<u32>,
        max_ram_mb: Option<u32>,
        lag_behind_ms: Option<u64>,
        lag_reported_seconds_ago: Option<u64>,
        world_size_bytes: Option<u64>,
        online_players: Option<u32>,
        max_players: Option<u32>,
        player_list: Option<Vec<String>>,
    }

    let metrics = with_running(|m| {
        let Some(entry) = m.get_mut(&key) else {
            return Metrics::default();
        };
        let pid = entry.pid;
        if pid == 0 {
            return Metrics::default();
        }

        let now = Instant::now();

        // Resident memory of the java process, refreshed at most every 3s.
        if entry
            .process_memory_cached_at
            .map(|t| now.duration_since(t) > Duration::from_secs(3))
            .unwrap_or(true)
        {
            if let Some(mem) = get_process_memory_mb(pid) {
                entry.cached_process_memory_mb = Some(mem);
            }
            entry.process_memory_cached_at = Some(now);
        }

        // Walking a multi-gigabyte world competes with the server for the same disk, so this
        // stays rare — the figure moves slowly enough that a stale one costs nothing.
        if entry
            .world_size_cached_at
            .map(|t| now.duration_since(t) > WORLD_SIZE_TTL)
            .unwrap_or(true)
        {
            entry.world_size_cached_at = Some(now); // also the in-flight guard
            needs_world_size_refresh = true;
        }

        if entry
            .slp_cached_at
            .map(|t| now.duration_since(t) > Duration::from_secs(10))
            .unwrap_or(true)
        {
            entry.slp_cached_at = Some(now); // also the in-flight guard
            needs_slp_refresh = true;
        }

        // A complaint from an hour ago says nothing about how the server is running now.
        let lag = entry
            .last_lag_at
            .filter(|t| now.duration_since(*t) <= LAG_REPORT_TTL)
            .map(|t| now.duration_since(t).as_secs());

        Metrics {
            uptime_seconds: entry.started_at.map(|t| t.elapsed().as_secs()),
            process_memory_mb: entry.cached_process_memory_mb,
            max_ram_mb: (entry.max_ram_mb > 0).then_some(entry.max_ram_mb),
            lag_behind_ms: lag.and(entry.last_lag_behind_ms),
            lag_reported_seconds_ago: lag,
            world_size_bytes: entry.cached_world_size_bytes,
            online_players: entry.cached_online_players,
            max_players: entry.cached_max_players,
            player_list: entry.cached_player_list.clone(),
        }
    });

    // Run background metric refreshes completely outside the lock
    if needs_world_size_refresh {
        let world_dir = server_dir.join(crate::server_config::read_level_name(server_dir));
        refresh_world_size(key.clone(), world_dir);
    }
    if needs_slp_refresh {
        let port = crate::server_config::read_server_properties(&key)
            .map(|p| p.server_port)
            .unwrap_or(25565);
        refresh_slp_metrics(key.clone(), port);
    }

    HostedServerStatus {
        state,
        has_jar: is_prepared(server_dir, loader, game_version, loader_version),
        server_dir: key,
        uptime_seconds: metrics.uptime_seconds,
        process_memory_mb: metrics.process_memory_mb,
        max_ram_mb: metrics.max_ram_mb,
        lag_behind_ms: metrics.lag_behind_ms,
        lag_reported_seconds_ago: metrics.lag_reported_seconds_ago,
        online_players: metrics.online_players,
        max_players: metrics.max_players,
        player_list: metrics.player_list,
        world_size_bytes: metrics.world_size_bytes,
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

pub fn build_server_jvm_args(
    min_ram_mb: u32,
    max_ram_mb: u32,
    use_aikar_flags: bool,
    gc_engine: Option<&str>,
) -> Vec<String> {
    let mut args = Vec::new();
    args.push(format!("-Xms{}M", min_ram_mb));
    args.push(format!("-Xmx{}M", max_ram_mb));

    let engine = gc_engine.unwrap_or("G1GC").trim();
    if engine.eq_ignore_ascii_case("ZGC") {
        args.push("-XX:+UseZGC".to_string());
        args.push("-XX:+UnlockExperimentalVMOptions".to_string());
        args.push("-XX:+AlwaysPreTouch".to_string());
    } else if use_aikar_flags {
        args.extend([
            "-XX:+UseG1GC".to_string(),
            "-XX:+ParallelRefProcEnabled".to_string(),
            "-XX:MaxGCPauseMillis=200".to_string(),
            "-XX:+UnlockExperimentalVMOptions".to_string(),
            "-XX:+DisableExplicitGC".to_string(),
            "-XX:+AlwaysPreTouch".to_string(),
            "-XX:G1NewSizePercent=30".to_string(),
            "-XX:G1MaxNewSizePercent=40".to_string(),
            "-XX:G1ReservePercent=20".to_string(),
            "-XX:G1HeapWastePercent=5".to_string(),
            "-XX:G1MixedGCCountTarget=4".to_string(),
            "-XX:InitiatingHeapOccupancyPercent=15".to_string(),
            "-XX:G1MixedGCLiveThresholdPercent=90".to_string(),
            "-XX:G1RSetUpdatingPauseTimePercent=5".to_string(),
            "-XX:SurvivorRatio=32".to_string(),
            "-XX:+PerfDisableSharedMem".to_string(),
            "-XX:MaxTenuringThreshold=1".to_string(),
        ]);
    }

    args
}

#[derive(Clone)]
struct ServerLaunchSpec {
    server_dir: PathBuf,
    loader: String,
    game_version: String,
    loader_version: Option<String>,
    java_bin: String,
    min_ram_mb: u32,
    max_ram_mb: u32,
    use_aikar_flags: bool,
    gc_engine: Option<String>,
    auto_restart: bool,
}

fn start_server_internal(
    spec: ServerLaunchSpec,
    on_log: Arc<dyn Fn(String) + Send + Sync + 'static>,
) -> Result<(), String> {
    let server_dir = &spec.server_dir;
    let loader = &spec.loader;
    let game_version = &spec.game_version;
    let loader_version = spec.loader_version.as_deref();
    let java_bin = &spec.java_bin;

    if !is_prepared(server_dir, loader, game_version, loader_version) {
        return Err("No server prepared for this profile yet.".to_string());
    }
    let key = dir_key(server_dir);
    if with_running(|m| m.get(&key).map(|e| e.pid != 0).unwrap_or(false)) {
        return Err("This server is already running.".to_string());
    }

    let mut cmd = crate::hidden_process::hidden_command(java_bin);
    let jvm_args = build_server_jvm_args(
        spec.min_ram_mb,
        spec.max_ram_mb,
        spec.use_aikar_flags,
        spec.gc_engine.as_deref(),
    );
    cmd.args(&jvm_args);

    match loader.as_str() {
        "forge" | "neoforge" => {
            let loader_version = loader_version
                .ok_or_else(|| "This profile has no loader version selected.".to_string())?;
            let args_file = crate::minecraft_core::forge::server_args_file(
                loader,
                game_version,
                loader_version,
                &server_dir.join("libraries"),
            );
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
        let entry = m.entry(key.clone()).or_insert_with(|| RunningEntry::new(pid, ServerState::Starting, spec.max_ram_mb));
        entry.pid = pid;
        entry.state = ServerState::Starting;
        entry.expected_stop = false;
        entry.restart_cancelled = false;
        entry.max_ram_mb = spec.max_ram_mb;
        entry.reset_run_metrics();
    });
    let _ = std::fs::write(pid_file_path(server_dir), pid.to_string());

    let on_log_filter = on_log.clone();
    for (pipe, watch_for_ready) in [
        (child.stdout.take().map(|s| Box::new(s) as Box<dyn std::io::Read + Send>), true),
        (child.stderr.take().map(|s| Box::new(s) as Box<dyn std::io::Read + Send>), false),
    ] {
        let Some(pipe) = pipe else { continue };
        let on_log = on_log_filter.clone();
        let key = key.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                if watch_for_ready && looks_like_ready_line(&line) {
                    with_running(|m| {
                        if let Some(entry) = m.get_mut(&key) {
                            if entry.state == ServerState::Starting {
                                entry.state = ServerState::Running;
                                entry.started_at = Some(Instant::now());
                            }
                        }
                    });
                }
                if let Some(behind_ms) = parse_lag_behind_ms(&line) {
                    with_running(|m| {
                        if let Some(entry) = m.get_mut(&key) {
                            entry.last_lag_behind_ms = Some(behind_ms);
                            entry.last_lag_at = Some(Instant::now());
                        }
                    });
                }
                on_log(line);
            }
        });
    }

    let pid_path = pid_file_path(server_dir);
    let spec_clone = spec.clone();
    let on_log_wait = on_log.clone();
    let key_wait = key.clone();
    std::thread::spawn(move || {
        let exit = child.wait();
        let _ = std::fs::remove_file(&pid_path);
        with_stdin(|m| {
            m.remove(&key_wait);
        });

        enum Action {
            Stopped,
            CrashNoRestart,
            CrashRestart { attempt: u32 },
            CrashMaxExceeded,
        }

        let action = with_running(|m| {
            let entry = match m.get_mut(&key_wait) {
                Some(e) => e,
                None => return Action::Stopped,
            };
            let expected = entry.expected_stop;
            let crashed = !expected && !matches!(exit, Ok(status) if status.success());
            entry.pid = 0;
            entry.expected_stop = false;
            entry.restart_cancelled = false;

            if !crashed {
                entry.state = ServerState::Stopped;
                entry.consecutive_crashes = 0;
                return Action::Stopped;
            }

            entry.state = ServerState::Crashed;
            if !spec_clone.auto_restart {
                return Action::CrashNoRestart;
            }

            let now = Instant::now();
            if let Some(last_time) = entry.last_crash_time {
                if now.duration_since(last_time) > Duration::from_secs(60) {
                    entry.consecutive_crashes = 0;
                }
            }
            entry.last_crash_time = Some(now);
            entry.consecutive_crashes += 1;

            if entry.consecutive_crashes <= MAX_CONSECUTIVE_CRASHES {
                Action::CrashRestart { attempt: entry.consecutive_crashes }
            } else {
                Action::CrashMaxExceeded
            }
        });

        match action {
            Action::CrashRestart { attempt } => {
                on_log_wait(format!(
                    "[MCL] Server stopped unexpectedly. Restarting in {}s (attempt {}/{}). Press Stop to cancel.",
                    RESTART_DELAY.as_secs(),
                    attempt,
                    MAX_CONSECUTIVE_CRASHES
                ));
                // Polled rather than slept through in one go, so a Stop pressed during the
                // countdown takes effect within a second instead of being noticed too late.
                let deadline = Instant::now() + RESTART_DELAY;
                let mut cancelled = false;
                while Instant::now() < deadline {
                    std::thread::sleep(Duration::from_millis(500));
                    cancelled = with_running(|m| {
                        m.get(&key_wait)
                            .map(|e| e.restart_cancelled || e.expected_stop || e.pid != 0)
                            .unwrap_or(true)
                    });
                    if cancelled {
                        break;
                    }
                }
                if cancelled {
                    on_log_wait("[MCL] Automatic restart cancelled.".to_string());
                } else {
                    let _ = start_server_internal(spec_clone, on_log_wait);
                }
            }
            Action::CrashMaxExceeded => {
                on_log_wait(format!(
                    "[MCL] Server crashed {} times in a row. Automatic restart is off until you start it again — check the crash report or a misbehaving mod.",
                    MAX_CONSECUTIVE_CRASHES
                ));
            }
            Action::CrashNoRestart | Action::Stopped => {}
        }
    });

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
    use_aikar_flags: bool,
    gc_engine: Option<&str>,
    auto_restart: bool,
    on_log: impl Fn(String) + Send + Sync + 'static,
) -> Result<(), String> {
    let spec = ServerLaunchSpec {
        server_dir: server_dir.to_path_buf(),
        loader: loader.to_string(),
        game_version: game_version.to_string(),
        loader_version: loader_version.map(|s| s.to_string()),
        java_bin: java_bin.to_string(),
        min_ram_mb,
        max_ram_mb,
        use_aikar_flags,
        gc_engine: gc_engine.map(|s| s.to_string()),
        auto_restart,
    };
    start_server_internal(spec, Arc::new(on_log))
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
        // No process to signal, but a crashed server may be counting down to an automatic
        // restart right now, and Stop has to call that off — otherwise it comes back anyway.
        let cancelled = with_running(|m| match m.get_mut(&key) {
            Some(entry) => {
                entry.restart_cancelled = true;
                entry.state == ServerState::Crashed
            }
            None => false,
        });
        return Ok(cancelled);
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
        if let Some(entry) = m.get_mut(&key) {
            entry.pid = 0;
            entry.state = ServerState::Stopped;
            entry.expected_stop = false;
        } else {
            m.insert(key, RunningEntry::new(0, ServerState::Stopped, 0));
        }
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

    #[test]
    fn lag_is_read_only_from_the_servers_own_overload_warning() {
        assert_eq!(
            parse_lag_behind_ms(
                "[12:34:56] [Server thread/WARN]: Can't keep up! Is the server overloaded? Running 2145ms or 42 ticks behind"
            ),
            Some(2145)
        );
        // The older wording the same warning used to have.
        assert_eq!(
            parse_lag_behind_ms(
                "Can't keep up! Did the system time change, or is the server overloaded? Running 5000ms behind, skipping 100 tick(s)"
            ),
            Some(5000)
        );
        // An ordinary line carries no tick-rate information, and none may be invented for it.
        assert_eq!(parse_lag_behind_ms("[12:34:56] [Server thread/INFO]: Done (21.5s)! For help, type \"help\""), None);
        assert_eq!(parse_lag_behind_ms("Running 2145ms behind"), None);
    }

    #[test]
    fn stopping_a_crashed_server_cancels_a_pending_restart() {
        let dir = std::env::temp_dir().join("mcl-server-host-test-cancel-restart");
        let _ = std::fs::create_dir_all(&dir);
        let key = dir_key(&dir);
        with_running(|m| {
            let mut entry = RunningEntry::new(0, ServerState::Crashed, 2048);
            entry.state = ServerState::Crashed;
            m.insert(key.clone(), entry);
        });

        assert_eq!(stop_server(&dir), Ok(true));
        assert!(with_running(|m| m.get(&key).map(|e| e.restart_cancelled).unwrap_or(false)));

        with_running(|m| {
            m.remove(&key);
        });
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_build_server_jvm_args_default() {
        let args = build_server_jvm_args(1024, 2048, false, None);
        assert_eq!(args, vec!["-Xms1024M", "-Xmx2048M"]);
    }

    #[test]
    fn test_build_server_jvm_args_aikar_flags() {
        let args = build_server_jvm_args(2048, 4096, true, Some("G1GC"));
        assert!(args.contains(&"-Xms2048M".to_string()));
        assert!(args.contains(&"-Xmx4096M".to_string()));
        assert!(args.contains(&"-XX:+UseG1GC".to_string()));
        assert!(args.contains(&"-XX:MaxGCPauseMillis=200".to_string()));
        assert!(args.contains(&"-XX:G1NewSizePercent=30".to_string()));
        assert!(args.contains(&"-XX:+AlwaysPreTouch".to_string()));
    }

    #[test]
    fn test_build_server_jvm_args_zgc() {
        let args = build_server_jvm_args(4096, 8192, true, Some("ZGC"));
        assert!(args.contains(&"-Xms4096M".to_string()));
        assert!(args.contains(&"-Xmx8192M".to_string()));
        assert!(args.contains(&"-XX:+UseZGC".to_string()));
        assert!(args.contains(&"-XX:+AlwaysPreTouch".to_string()));
        // ZGC should NOT contain G1GC specific flags
        assert!(!args.contains(&"-XX:+UseG1GC".to_string()));
        assert!(!args.contains(&"-XX:G1NewSizePercent=30".to_string()));
    }
}
