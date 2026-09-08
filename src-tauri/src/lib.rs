mod instance_manager;
mod java_detector;
mod launcher_engine;
mod minecraft_core;
mod modpack_installer;
mod models;
mod server_ping;

use models::{
    GameInstance, JavaInstallation, LocalMod, ServerStatus, StorageCleanupReport,
    StorageCleanupScanResult,
};
use tauri::Manager;
use std::sync::{Mutex, OnceLock};

static CACHED_JAVAS: OnceLock<Mutex<Vec<JavaInstallation>>> = OnceLock::new();

fn get_cached_javas() -> &'static Mutex<Vec<JavaInstallation>> {
    CACHED_JAVAS.get_or_init(|| Mutex::new(Vec::new()))
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
) -> Result<StorageCleanupReport, String> {
    instance_manager::execute_storage_cleanup(clean_versions, clean_cache, clean_orphaned_instances)
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
    let mut lock = get_cached_javas().lock().unwrap();
    if !lock.is_empty() {
        return lock.clone();
    }
    let javas = java_detector::detect_installed_javas();
    *lock = javas.clone();
    javas
}

#[tauri::command]
fn find_best_java(game_version: String) -> (String, u32, String) {
    java_detector::find_best_java_for_version(&game_version)
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
) -> Result<LocalMod, String> {
    instance_manager::download_and_install_addon(&instance_id, &url, &file_name, &addon_type).await
}

#[tauri::command]
async fn launch_instance(
    app: tauri::AppHandle,
    instance_id: String,
    username: String,
    instance_data: Option<GameInstance>,
) -> Result<String, String> {
    use tauri::Emitter;

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
            if let Err(e) = minecraft_core::launcher::prepare_and_launch(&app_handle, &inst, &username).await {
                log::error!("Lỗi khởi chạy game: {}", e);
                let _ = app_handle.emit("mc-log", format!("[MCLv2/ERROR] {}", e));
                let _ = app_handle.emit(
                    "download-progress",
                    minecraft_core::downloader::DownloadProgressPayload {
                        stage: "Lỗi".to_string(),
                        percentage: 0,
                        current_file: e,
                        downloaded_bytes: 0,
                        total_bytes: 0,
                        speed_bps: 0,
                    },
                );
            }
        });
        Ok(format!("Bắt đầu chuẩn bị tài nguyên cho profile: {}", instance_id))
    } else {
        Err(format!("Không tìm thấy profile với ID: {}", instance_id))
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
fn app_close(window: tauri::Window) {
    let _ = window.close();
}

#[tauri::command]
fn set_window_size(window: tauri::Window, width: f64, height: f64) {
    let _ = window.set_resizable(true);
    let _ = window.set_size(tauri::LogicalSize::new(width, height));
    let _ = window.center();
    let _ = window.set_resizable(false);
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_shadow(false);
                let _ = window.set_size(tauri::LogicalSize::new(1600.0, 900.0));
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
                let mut lock = get_cached_javas().lock().unwrap();
                *lock = javas;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_instances,
            save_instances,
            delete_instance,
            open_instance_dir,
            get_game_data_dir,
            set_game_data_dir,
            select_folder,
            scan_storage_cleanup,
            execute_storage_cleanup,
            detect_java,
            find_best_java,
            ping_minecraft_server,
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
            app_close,
            set_window_size
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
