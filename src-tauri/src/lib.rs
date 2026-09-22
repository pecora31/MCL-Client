mod addon_registry;
pub mod backup;
mod discord_rpc;
mod game_stats;
pub mod hidden_process;
mod instance_manager;
pub mod java_detector;
mod java_runtime;
mod minecraft_core;
mod modpack_installer;
mod mod_conflicts;
pub mod models;
mod remote_agent;
pub mod remote_files;
pub mod server_config;
pub mod server_host;
pub(crate) mod server_ping;

// Peer-to-peer rooms pull in iroh and its ~190 transitive crates, which only the desktop app
// ever uses — the agent binary builds with the feature off and gets a matching stub instead,
// so lib.rs below is written against one API either way.
#[cfg(feature = "p2p")]
pub mod p2p_tunnel;
#[cfg(not(feature = "p2p"))]
#[path = "p2p_tunnel_stub.rs"]
pub mod p2p_tunnel;

// The VM bootstrap wizard's SSH client (russh) is desktop-only — mcl-agent never SSHes
// anywhere, so the agent binary builds with the `remote-setup` feature off and gets a
// matching stub instead, same reasoning and same pattern as p2p_tunnel above.
#[cfg(feature = "remote-setup")]
pub mod vm_bootstrap;
#[cfg(not(feature = "remote-setup"))]
#[path = "vm_bootstrap_stub.rs"]
pub mod vm_bootstrap;

use models::{
    GameInstance, JavaInstallation, LocalMod, ServerPropertiesSummary, ServerStatus,
    StorageCleanupReport, StorageCleanupScanResult, SystemInfo,
};
use server_host::HostedServerStatus;
use base64::Engine as _;
use tauri::Manager;
use tauri::tray::TrayIconBuilder;
use tauri::menu::{Menu, MenuItem};
use std::sync::{Mutex, OnceLock};

static CACHED_JAVAS: OnceLock<Mutex<Vec<JavaInstallation>>> = OnceLock::new();

fn get_cached_javas() -> &'static Mutex<Vec<JavaInstallation>> {
    CACHED_JAVAS.get_or_init(|| Mutex::new(Vec::new()))
}

/// Drops the detected-Java cache, so a runtime the launcher just downloaded shows up in the
/// profile forms without restarting the app.
pub(crate) fn forget_detected_javas() {
    get_cached_javas()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clear();
}

/// Whether the close button hides the window instead of quitting — mirrors the frontend's own
/// `minimizeToTrayOnClose` setting (localStorage-backed, so Rust cannot read it directly), kept
/// in sync by `set_minimize_to_tray_on_close`, called once at startup and again on every change.
/// Defaults to on: closing the window used to be the one action in the whole app that could
/// silently end a P2P room someone else is mid-session in, with no undo.
static MINIMIZE_TO_TRAY_ON_CLOSE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(true);

#[tauri::command]
fn set_minimize_to_tray_on_close(enabled: bool) {
    MINIMIZE_TO_TRAY_ON_CLOSE.store(enabled, std::sync::atomic::Ordering::Relaxed);
}

#[tauri::command]
fn get_instances() -> Vec<GameInstance> {
    instance_manager::load_instances()
}

#[tauri::command]
fn save_instances(instances: Vec<GameInstance>) -> Result<(), String> {
    instance_manager::save_instances(&instances)
}

#[tauri::command]
fn delete_instance(instance_id: String, delete_version_files: bool) -> Result<u64, String> {
    instance_manager::delete_instance_and_data(&instance_id, delete_version_files)
}

#[tauri::command]
fn scan_storage_cleanup() -> StorageCleanupScanResult {
    instance_manager::scan_storage_cleanup()
}

#[tauri::command]
fn execute_storage_cleanup(
    clean_versions: bool,
    clean_cache: bool,
    clean_orphaned_instances: bool,
    clean_java_runtimes: bool,
) -> Result<StorageCleanupReport, String> {
    instance_manager::execute_storage_cleanup(
        clean_versions,
        clean_cache,
        clean_orphaned_instances,
        clean_java_runtimes,
    )
}

#[tauri::command]
fn read_server_properties(dir: String) -> Result<ServerPropertiesSummary, String> {
    server_config::read_server_properties(&dir)
}

#[tauri::command]
fn write_server_properties(dir: String, summary: ServerPropertiesSummary) -> Result<(), String> {
    server_config::write_server_properties(&dir, &summary)
}

#[tauri::command]
fn get_whitelist(dir: String) -> Vec<server_config::WhitelistEntry> {
    server_config::read_whitelist(&dir)
}

#[tauri::command]
fn add_whitelist_player(dir: String, name: String) -> Result<Vec<server_config::WhitelistEntry>, String> {
    let entries = server_config::add_to_whitelist(&dir, &name)?;
    // Best-effort: makes an already-running server pick the new entry up immediately, the same
    // as typing `whitelist reload` yourself. A stopped server just reads the file fresh at its
    // next start, so a failure here (nothing running to reload) is not itself an error.
    let _ = server_host::send_command(std::path::Path::new(&dir), "whitelist reload");
    Ok(entries)
}

#[tauri::command]
fn remove_whitelist_player(dir: String, name: String) -> Result<Vec<server_config::WhitelistEntry>, String> {
    let entries = server_config::remove_from_whitelist(&dir, &name)?;
    let _ = server_host::send_command(std::path::Path::new(&dir), "whitelist reload");
    Ok(entries)
}

fn require_instance(instance_id: &str) -> Result<GameInstance, String> {
    instance_manager::get_instance(instance_id)
        .ok_or_else(|| format!("No profile found with id {}", instance_id))
}

/// Where a profile's self-hosted server lives — inside the profile's own folder, not
/// somewhere new MCL has to remember separately, so every other feature that already knows
/// where a profile lives (Server Config among them) keeps working here unchanged.
fn server_dir_for(instance: &GameInstance) -> std::path::PathBuf {
    instance_manager::get_instance_dir(&instance.id).join("server")
}

#[tauri::command]
fn get_hosted_server_status(instance_id: String) -> Result<HostedServerStatus, String> {
    let instance = require_instance(&instance_id)?;
    Ok(server_host::get_status(
        &server_dir_for(&instance),
        &instance.loader,
        &instance.game_version,
        instance.loader_version.as_deref(),
    ))
}

#[tauri::command]
async fn prepare_hosted_server(instance_id: String, accept_eula: bool) -> Result<HostedServerStatus, String> {
    let instance = require_instance(&instance_id)?;
    if !accept_eula {
        return Err("Hosting a server means accepting Mojang's EULA first.".to_string());
    }
    let instance_dir = instance_manager::get_instance_dir(&instance_id);
    let server_dir = server_dir_for(&instance);
    let common_dir = instance_manager::get_launcher_dir().join("common");

    server_host::prepare_server_jar(
        &instance.loader,
        &instance.game_version,
        instance.loader_version.as_deref(),
        &common_dir,
        &server_dir,
    )
    .await?;
    server_host::accept_eula(&server_dir)?;
    server_host::sync_mods_to_server(&instance_dir, &server_dir)?;

    Ok(server_host::get_status(
        &server_dir,
        &instance.loader,
        &instance.game_version,
        instance.loader_version.as_deref(),
    ))
}

#[tauri::command]
fn start_hosted_server(
    app_handle: tauri::AppHandle,
    instance_id: String,
    java_bin: String,
    min_ram: u32,
    max_ram: u32,
    use_aikar_flags: Option<bool>,
    gc_engine: Option<String>,
    auto_restart: Option<bool>,
) -> Result<(), String> {
    use tauri::Emitter;
    let instance = require_instance(&instance_id)?;
    let server_dir = server_dir_for(&instance);
    server_host::start_server(
        &server_dir,
        &instance.loader,
        &instance.game_version,
        instance.loader_version.as_deref(),
        &java_bin,
        min_ram,
        max_ram,
        use_aikar_flags.unwrap_or(false),
        gc_engine.as_deref(),
        auto_restart.unwrap_or(false),
        move |line| {
            let _ = app_handle.emit("server-log", line);
        },
    )
}

#[tauri::command]
fn stop_hosted_server(instance_id: String) -> Result<bool, String> {
    let instance = require_instance(&instance_id)?;
    server_host::stop_server(&server_dir_for(&instance))
}

#[tauri::command]
fn send_hosted_server_command(instance_id: String, command: String) -> Result<(), String> {
    let instance = require_instance(&instance_id)?;
    server_host::send_command(&server_dir_for(&instance), &command)
}

#[tauri::command]
fn get_game_data_dir() -> String {
    instance_manager::get_launcher_dir().to_string_lossy().to_string()
}

#[tauri::command]
fn set_game_data_dir(path: String) -> Result<(), String> {
    instance_manager::set_launcher_dir(&path)
}

#[tauri::command]
fn select_folder(default_path: Option<String>) -> Option<String> {
    let mut dialog = rfd::FileDialog::new();
    if let Some(ref path) = default_path {
        if !path.trim().is_empty() {
            dialog = dialog.set_directory(path);
        }
    }
    dialog.pick_folder().map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn select_save_path(default_name: String) -> Option<String> {
    rfd::FileDialog::new()
        .set_file_name(&default_name)
        .save_file()
        .map(|p| p.to_string_lossy().to_string())
}

/// Just the picked path, nothing else — unlike `select_file` (below), which reads small files
/// into a data URI for previewing things like background images. Callers that need an actual
/// filesystem path to hand to something else (an SSH private key file, for instance) must use
/// this one instead, or they will get a `data:...;base64,...` string where a path was expected.
#[tauri::command]
fn select_file_path(filter_name: Option<String>, filter_extensions: Option<Vec<String>>) -> Option<String> {
    let extensions = filter_extensions.unwrap_or_default();
    let mut dialog = rfd::FileDialog::new();
    if !extensions.is_empty() {
        dialog = dialog.add_filter(filter_name.unwrap_or_else(|| "Files".to_string()), &extensions);
    }
    dialog.pick_file().map(|p| p.to_string_lossy().to_string())
}

const MAX_INLINE_FILE_BYTES: u64 = 3 * 1024 * 1024;

fn mime_from_extension(path: &std::path::Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        Some("bmp") => "image/bmp",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        _ => "application/octet-stream",
    }
}

#[tauri::command]
fn select_file(
    filter_name: Option<String>,
    filter_extensions: Option<Vec<String>>,
) -> Result<Option<String>, String> {
    let extensions = filter_extensions.unwrap_or_default();
    let mut dialog = rfd::FileDialog::new();
    if !extensions.is_empty() {
        dialog = dialog.add_filter(filter_name.unwrap_or_else(|| "Files".to_string()), &extensions);
    }

    let path = match dialog.pick_file() {
        Some(path) => path,
        None => return Ok(None),
    };

    let size = std::fs::metadata(&path)
        .map_err(|e| format!("Cannot read file metadata: {}", e))?
        .len();
    if size > MAX_INLINE_FILE_BYTES {
        return Err(format!(
            "File is too large ({:.1} MB). Maximum allowed is {} MB.",
            size as f64 / (1024.0 * 1024.0),
            MAX_INLINE_FILE_BYTES / (1024 * 1024)
        ));
    }

    let bytes = std::fs::read(&path).map_err(|e| format!("Cannot read file: {}", e))?;

    // The webview cannot load file:// paths from the app origin, so the file is inlined instead
    Ok(Some(format!(
        "data:{};base64,{}",
        mime_from_extension(&path),
        base64::engine::general_purpose::STANDARD.encode(&bytes)
    )))
}

/// Opens a web page in the default browser. Only https links, so a crafted value can't be
/// used to start a local program or open a file.
#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err("only https links can be opened".into());
    }

    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer")
        .arg(&url)
        .spawn()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(&url)
        .spawn()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open")
        .arg(&url)
        .spawn()
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn open_instance_dir(instance_id: String) -> Result<(), String> {
    let dir = if instance_id.is_empty() {
        instance_manager::get_launcher_dir().join("instances")
    } else {
        instance_manager::get_instance_dir(&instance_id)
    };
    if !dir.exists() {
        let _ = std::fs::create_dir_all(&dir);
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
fn detect_java() -> Vec<JavaInstallation> {
    let mut lock = get_cached_javas().lock().unwrap_or_else(|e| e.into_inner());
    if !lock.is_empty() {
        return lock.clone();
    }
    let javas = java_detector::detect_installed_javas();
    *lock = javas.clone();
    javas
}

#[tauri::command]
async fn install_local_skin(
    instance_id: String,
    username: String,
    skin: String,
    publish: bool,
) -> Result<instance_manager::SkinInstallResult, String> {
    instance_manager::install_local_skin(&instance_id, &username, &skin, publish).await
}

#[tauri::command]
async fn check_username_claim(
    username: String,
) -> Result<instance_manager::UsernameClaimCheck, String> {
    instance_manager::check_username_claim(&username).await
}

#[tauri::command]
async fn delete_published_skin(username: String) -> Result<(), String> {
    instance_manager::delete_published_skin(&username).await
}

#[tauri::command]
fn backup_worlds(instance_id: String) -> Result<String, String> {
    instance_manager::backup_worlds(&instance_id)
}

#[tauri::command]
fn export_log(instance_id: String, contents: String) -> Result<String, String> {
    instance_manager::export_log(&instance_id, &contents)
}

#[tauri::command]
fn get_system_info() -> SystemInfo {
    use sysinfo::System;
    let mut sys = System::new();
    sys.refresh_memory();
    sys.refresh_cpu_usage();

    let total_ram_mb = (sys.total_memory() / 1024 / 1024) as u32;
    let available_ram_mb = (sys.available_memory() / 1024 / 1024) as u32;
    let cpu_count = sys.cpus().len().max(1) as u32;

    // Windows and background apps need headroom, and the JVM reserves memory beyond the heap
    let reserved_mb = (total_ram_mb / 4).clamp(2048, 8192);
    let recommended_max_ram_mb = total_ram_mb.saturating_sub(reserved_mb).max(1024);
    // Minecraft rarely benefits past 8 GB, and oversized heaps make garbage collection worse
    let recommended_ram_mb = recommended_max_ram_mb.min(4096).max(1024);

    SystemInfo {
        total_ram_mb,
        available_ram_mb,
        cpu_count,
        recommended_max_ram_mb,
        recommended_ram_mb,
    }
}

/// The LAN address other devices on the same network would use to reach this computer —
/// `localhost` only ever resolves to whichever machine typed it, so a server hosted here and
/// joined from a different device needs this instead. `connect` on a UDP socket never actually
/// sends a packet, it only asks the OS to pick the local interface it would use to reach that
/// address, which is enough to read back this machine's own LAN IP without any real traffic.
#[tauri::command]
fn get_lan_ip() -> Option<String> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    socket.local_addr().ok().map(|addr| addr.ip().to_string())
}

#[tauri::command]
fn find_best_java(game_version: String) -> (String, u32, String) {
    java_detector::find_best_java_for_version(&game_version)
}

/// `find_best_java`, but for hosting: when this machine has no fitting Java at all (major
/// version 0), it downloads one instead of handing back a placeholder path like `javaw.exe`
/// with nothing behind it — the exact mistake that used to make Start fail with a raw OS error
/// ("No such file or directory") instead of ever explaining what was actually missing.
#[tauri::command]
async fn find_or_download_java_for_hosting(
    app_handle: tauri::AppHandle,
    game_version: String,
    auto_download_java: bool,
) -> Result<(String, u32, String), String> {
    use tauri::Emitter;
    let found = java_detector::find_best_java_for_version(&game_version);
    if found.1 != 0 {
        return Ok(found);
    }
    if !auto_download_java {
        return Err(found.2);
    }

    let required = java_detector::required_java_major(&game_version);
    let _ = app_handle.emit(
        "server-log",
        format!(
            "[MCL] Java {} is not on this computer yet. Downloading Eclipse Temurin {} (about 40-55 MB)...",
            required, required
        ),
    );
    let exe = java_runtime::download_java(&app_handle, required)
        .await
        .map_err(|e| format!("Could not download Java {}: {}", required, e))?;
    forget_detected_javas();
    Ok((
        exe.to_string_lossy().to_string(),
        required,
        format!("Using Java {} (Eclipse Temurin, downloaded by the launcher)", required),
    ))
}

#[tauri::command]
async fn ping_minecraft_server(host: String, port: u16) -> ServerStatus {
    server_ping::ping_server(&host, port).await
}

#[tauri::command]
fn get_local_mods(instance_id: String) -> Vec<LocalMod> {
    instance_manager::get_local_mods(&instance_id)
}

#[tauri::command]
fn get_installed_addons(instance_id: String, addon_type: String) -> Vec<LocalMod> {
    instance_manager::get_installed_addons(&instance_id, &addon_type)
}

#[tauri::command]
fn toggle_addon(instance_id: String, addon_type: String, file_name: String, enable: bool) -> Result<(), String> {
    instance_manager::toggle_addon(&instance_id, &addon_type, &file_name, enable)
}

#[tauri::command]
fn delete_addon(instance_id: String, addon_type: String, file_name: String) -> Result<(), String> {
    instance_manager::delete_addon(&instance_id, &addon_type, &file_name)
}

#[tauri::command]
async fn download_and_install_addon(
    instance_id: String,
    url: String,
    file_name: String,
    addon_type: String,
    sha1: Option<String>,
    project_id: Option<String>,
    source: Option<String>,
    version_id: Option<String>,
) -> Result<LocalMod, String> {
    instance_manager::download_and_install_addon(
        &instance_id,
        &url,
        &file_name,
        &addon_type,
        sha1.as_deref(),
        project_id.as_deref(),
        source.as_deref(),
        version_id.as_deref(),
    )
    .await
}

/// Builds the manifest for sharing a profile. Returns it alongside the files that cannot
/// be shared, so the UI can say which ones the recipient will have to install themselves
/// rather than letting them find out when a mod is simply missing.
#[tauri::command]
fn build_share_manifest(
    instance_id: String,
) -> Result<(addon_registry::ShareManifest, Vec<String>), String> {
    let instances = instance_manager::load_instances();
    let instance = instances
        .iter()
        .find(|i| i.id == instance_id)
        .ok_or_else(|| format!("No profile with id '{}'", instance_id))?;
    let dir = instance_manager::get_instance_dir(&instance_id);
    Ok(addon_registry::build_manifest(instance, &dir))
}

#[tauri::command]
fn check_mod_conflicts(instance_id: String) -> Vec<mod_conflicts::ModConflict> {
    mod_conflicts::check_instance(&instance_id)
}

#[tauri::command]
fn set_discord_rpc_enabled(enabled: bool) {
    discord_rpc::set_enabled(enabled);
}

#[tauri::command]
fn get_instance_stats(instance_id: String) -> game_stats::InstanceStats {
    // The launcher's own tally lives on the profile, the rest comes off the game's files
    let tracked = instance_manager::load_instances()
        .iter()
        .find(|i| i.id == instance_id)
        .and_then(|i| i.total_play_time)
        .unwrap_or(0) as u64;
    game_stats::read_instance_stats(&instance_id, tracked)
}

#[tauri::command]
async fn launch_instance(
    app: tauri::AppHandle,
    instance_id: String,
    username: String,
    instance_data: Option<GameInstance>,
    auto_download_java: Option<bool>,
) -> Result<String, String> {
    use tauri::Emitter;
    let auto_download_java = auto_download_java.unwrap_or(true);

    // Resolve target instance (prefer direct instance_data from frontend if supplied)
    let target_instance = if let Some(data) = instance_data {
        // Save to instances.json to ensure disk persistence
        let mut list = instance_manager::load_instances();
        if let Some(pos) = list.iter().position(|i| i.id == data.id) {
            list[pos] = data.clone();
        } else {
            list.push(data.clone());
        }
        let _ = instance_manager::save_instances(&list);
        Some(data)
    } else {
        let instances = instance_manager::load_instances();
        instances.into_iter().find(|i| i.id == instance_id)
    };

    if let Some(inst) = target_instance {
        let app_handle = app.clone();
        tokio::spawn(async move {
            if let Err(e) = minecraft_core::launcher::prepare_and_launch(&app_handle, &inst, &username, auto_download_java).await {
                log::error!("Failed to launch the game: {}", e);
                let _ = app_handle.emit("mc-log", format!("[MCL/ERROR] {}", e));
                let _ = app_handle.emit(
                    "download-progress",
                    minecraft_core::downloader::DownloadProgressPayload {
                        stage: "error".to_string(),
                        percentage: 0,
                        current_file: e,
                        downloaded_bytes: 0,
                        total_bytes: 0,
                        speed_bps: 0,
                    },
                );
            }
        });
        Ok(format!("Preparing resources for profile: {}", instance_id))
    } else {
        Err(format!("No profile found with ID: {}", instance_id))
    }
}

#[tauri::command]
fn select_mrpack_file() -> Option<String> {
    rfd::FileDialog::new()
        .add_filter("Modrinth Modpack (*.mrpack)", &["mrpack"])
        .pick_file()
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn inspect_mrpack(mrpack_path: String) -> Result<modpack_installer::MrpackManifestSummary, String> {
    modpack_installer::inspect_mrpack_file(&mrpack_path)
}

#[tauri::command]
async fn install_mrpack(
    app_handle: tauri::AppHandle,
    mrpack_path: String,
    custom_name: Option<String>,
) -> Result<GameInstance, String> {
    modpack_installer::install_mrpack(&app_handle, &mrpack_path, custom_name).await
}

#[tauri::command]
fn app_minimize(window: tauri::Window) {
    let _ = window.minimize();
}

#[tauri::command]
fn app_hide(window: tauri::Window) {
    let _ = window.hide();
}

#[tauri::command]
fn app_close(window: tauri::Window) {
    let _ = window.close();
}

#[tauri::command]
fn set_window_size(window: tauri::Window, width: f64, height: f64) {
    let monitor = window.current_monitor().ok().flatten();
    let (width, height) = clamp_size_to_monitor(monitor.as_ref(), width, height);
    let _ = window.set_resizable(true);
    let _ = window.set_size(tauri::LogicalSize::new(width, height));
    let _ = window.center();
    let _ = window.set_resizable(false);
}

/// A saved or default window size is chosen in logical pixels, but a screen's logical work area
/// shrinks as Windows display scaling goes up — a 1920x1080 monitor at 175% scaling only offers
/// about 1097x617 logical pixels. A size that's perfectly DPI-correct can still be bigger than
/// that, so clamp to whatever the current monitor can actually show (minus a little headroom for
/// the taskbar) instead of requesting a size Windows has to squeeze the window to fit, which is
/// what made the window spill off-screen on a scaled-up laptop display.
fn clamp_size_to_monitor(monitor: Option<&tauri::window::Monitor>, width: f64, height: f64) -> (f64, f64) {
    let Some(monitor) = monitor else {
        return (width, height);
    };
    let scale = monitor.scale_factor();
    let logical: tauri::LogicalSize<f64> = monitor.size().to_logical(scale);
    let max_width = (logical.width - 40.0).max(640.0);
    let max_height = (logical.height - 80.0).max(480.0);
    (width.min(max_width), height.min(max_height))
}

#[tauri::command]
fn cancel_download() -> Result<bool, String> {
    minecraft_core::downloader::request_cancel();
    Ok(true)
}

#[tauri::command]
fn kill_game() -> Result<bool, String> {
    minecraft_core::launcher::kill_current_game()
}

#[tauri::command]
async fn p2p_start_host(
    room_name: Option<String>,
    host_username: Option<String>,
    password: Option<String>,
    target_port: Option<u16>,
) -> Result<p2p_tunnel::P2PHostStatus, String> {
    p2p_tunnel::start_p2p_host(
        room_name.unwrap_or_else(|| "MCL Room".to_string()),
        host_username.unwrap_or_else(|| "Host".to_string()),
        password,
        target_port.unwrap_or(25565),
    )
    .await
}

#[tauri::command]
async fn p2p_stop_host() -> Result<bool, String> {
    p2p_tunnel::stop_p2p_host().await
}

#[tauri::command]
fn p2p_get_host_status() -> p2p_tunnel::P2PHostStatus {
    p2p_tunnel::get_p2p_host_status()
}

#[tauri::command]
fn p2p_kick_peer(peer_node_id: String) -> Result<bool, String> {
    Ok(p2p_tunnel::p2p_host_kick_peer(&peer_node_id))
}

#[tauri::command]
fn p2p_toggle_lock() -> Result<bool, String> {
    Ok(p2p_tunnel::p2p_host_toggle_lock())
}

#[tauri::command]
async fn p2p_start_client(
    ticket: String,
    username: Option<String>,
    password: Option<String>,
) -> Result<p2p_tunnel::P2PClientStatus, String> {
    p2p_tunnel::start_p2p_client(
        ticket,
        username.unwrap_or_else(|| "Player".to_string()),
        password,
    )
    .await
}

#[tauri::command]
async fn p2p_stop_client() -> Result<bool, String> {
    p2p_tunnel::stop_p2p_client().await
}

#[tauri::command]
fn p2p_get_client_status() -> p2p_tunnel::P2PClientStatus {
    p2p_tunnel::get_p2p_client_status()
}

#[tauri::command]
async fn vm_bootstrap_start(app: tauri::AppHandle, stream_id: String, req: vm_bootstrap::BootstrapRequest) -> Result<vm_bootstrap::BootstrapOutcome, String> {
    vm_bootstrap::run_bootstrap(app, stream_id, req).await
}

#[tauri::command]
async fn vm_bootstrap_retry_verify(host: remote_agent::RemoteHostConfig) -> Result<(), String> {
    remote_agent::remote_agent_status(host).await.map(|_| ())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Needed so the launcher can restart itself once an update is installed
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Logging: In debug, log to stdout/file. In release, log to rotating files so users can report bugs.
            let log_targets = [
                tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir { file_name: Some("mcl-client".to_string()) }),
                #[cfg(debug_assertions)]
                tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                #[cfg(debug_assertions)]
                tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
            ];

            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .targets(log_targets)
                    .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne)
                    .max_file_size(5 * 1024 * 1024) // 5 MB max per log file
                    .level(if cfg!(debug_assertions) { log::LevelFilter::Debug } else { log::LevelFilter::Info })
                    .build(),
            )?;
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_shadow(false);
                let monitor = window.current_monitor().ok().flatten();
                let (w, h) = clamp_size_to_monitor(monitor.as_ref(), 1600.0, 900.0);
                let _ = window.set_size(tauri::LogicalSize::new(w, h));
                let _ = window.set_resizable(false);
                let _ = window.center();

                #[cfg(target_os = "windows")]
                if let Ok(hwnd) = window.hwnd() {
                    use std::ffi::c_void;
                    #[link(name = "dwmapi")]
                    extern "system" {
                        fn DwmSetWindowAttribute(
                            hwnd: isize,
                            dwAttribute: u32,
                            pvAttribute: *const c_void,
                            cbAttribute: u32,
                        ) -> i32;
                    }
                    // DWMWA_BORDER_COLOR = 34. 0xFFFFFFFE = DWMWA_COLOR_NONE (no border drawn by Windows DWM)
                    let border_color: u32 = 0xFFFFFFFE;
                    unsafe {
                        let _ = DwmSetWindowAttribute(
                            hwnd.0 as isize,
                            34,
                            &border_color as *const _ as *const c_void,
                            std::mem::size_of::<u32>() as u32,
                        );
                    }
                }
            }

            // Pre-warm Java detection in background OS thread on launch
            std::thread::spawn(|| {
                let javas = java_detector::detect_installed_javas();
                let mut lock = get_cached_javas().lock().unwrap_or_else(|e| e.into_inner());
                *lock = javas;
            });

            // A tray icon so closing the window (see the CloseRequested handler below) has
            // somewhere to go besides quitting outright, and a way back — this is what makes
            // that behavior "minimize to tray" instead of just silently eating the close
            // button. Without it, a P2P room or a hosted server the player forgot about would
            // keep running invisibly with no way to reach the window again short of relaunching.
            let show_item = MenuItem::with_id(app, "show", "Show MCL Client", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit MCL Client", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show_item, &quit_item])?;
            let mut tray_builder = TrayIconBuilder::new().menu(&tray_menu).tooltip("MCL Client");
            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }
            tray_builder
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => app.exit(0),
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main"
                    && MINIMIZE_TO_TRAY_ON_CLOSE.load(std::sync::atomic::Ordering::Relaxed)
                {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_instances,
            save_instances,
            delete_instance,
            open_instance_dir,
            open_external_url,
            get_game_data_dir,
            set_game_data_dir,
            select_folder,
            select_save_path,
            select_file,
            select_file_path,
            scan_storage_cleanup,
            execute_storage_cleanup,
            read_server_properties,
            write_server_properties,
            get_whitelist,
            add_whitelist_player,
            remove_whitelist_player,
            get_hosted_server_status,
            prepare_hosted_server,
            start_hosted_server,
            stop_hosted_server,
            send_hosted_server_command,
            remote_agent::remote_agent_status,
            remote_agent::remote_agent_prepare,
            remote_agent::remote_agent_start,
            remote_agent::remote_agent_stop,
            remote_agent::remote_agent_get_properties,
            remote_agent::remote_agent_set_properties,
            remote_agent::remote_agent_get_whitelist,
            remote_agent::remote_agent_add_whitelist_player,
            remote_agent::remote_agent_remove_whitelist_player,
            remote_agent::remote_agent_sync_mods,
            remote_agent::remote_agent_send_command,
            remote_agent::remote_agent_start_log_stream,
            remote_agent::remote_agent_stop_log_stream,
            remote_agent::remote_agent_list_backups,
            remote_agent::remote_agent_backup_now,
            remote_agent::remote_agent_download_backup,
            remote_agent::remote_agent_delete_backup,
            remote_agent::remote_agent_restore_backup,
            remote_agent::remote_agent_list_files,
            remote_agent::remote_agent_mkdir,
            remote_agent::remote_agent_rename,
            remote_agent::remote_agent_delete_file,
            remote_agent::remote_agent_read_text_file,
            remote_agent::remote_agent_write_text_file,
            remote_agent::remote_agent_upload_file,
            remote_agent::remote_agent_download_file,
            detect_java,
            find_best_java,
            find_or_download_java_for_hosting,
            get_system_info,
            get_lan_ip,
            install_local_skin,
            delete_published_skin,
            check_username_claim,
            backup_worlds,
            export_log,
            ping_minecraft_server,
            get_instance_stats,
            set_discord_rpc_enabled,
            check_mod_conflicts,
            build_share_manifest,
            get_local_mods,
            get_installed_addons,
            toggle_addon,
            delete_addon,
            download_and_install_addon,
            launch_instance,
            cancel_download,
            kill_game,
            select_mrpack_file,
            inspect_mrpack,
            install_mrpack,
            app_minimize,
            app_hide,
            app_close,
            set_minimize_to_tray_on_close,
            set_window_size,
            p2p_start_host,
            p2p_stop_host,
            p2p_get_host_status,
            p2p_kick_peer,
            p2p_toggle_lock,
            p2p_start_client,
            p2p_stop_client,
            p2p_get_client_status,
            vm_bootstrap_start,
            vm_bootstrap_retry_verify,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
