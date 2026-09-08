use super::assets::download_assets;
use super::downloader::{download_files_concurrently, DownloadProgressPayload, DownloadTask};
use super::fabric::{get_fabric_meta, parse_maven_coord};
use super::version::{get_version_details, is_library_allowed_on_windows};
use crate::instance_manager::{get_instance_dir, get_launcher_dir, setup_in_game_skin_support};
use crate::models::GameInstance;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use tauri::{AppHandle, Emitter};

static CURRENT_GAME_PID: AtomicU32 = AtomicU32::new(0);

pub async fn prepare_and_launch(
    app_handle: &AppHandle,
    instance: &GameInstance,
    username: &str,
) -> Result<(), String> {
    super::downloader::reset_cancel();
    let launcher_dir = get_launcher_dir();
    let common_dir = launcher_dir.join("common");
    let libraries_dir = common_dir.join("libraries");
    let instance_dir = get_instance_dir(&instance.id);
    let natives_dir = instance_dir.join("natives");

    fs::create_dir_all(&libraries_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&natives_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(instance_dir.join("mods")).map_err(|e| e.to_string())?;

    // Log initialization
    let _ = app_handle.emit(
        "mc-log",
        format!(
            "[{}] [MCLv2] Bắt đầu chuẩn bị tài nguyên cho profile: {} (Minecraft {})",
            chrono::Local::now().format("%H:%M:%S"),
            instance.name,
            instance.game_version
        ),
    );

    // 1. Fetch Version Details from Mojang
    let _ = app_handle.emit(
        "mc-log",
        format!("[{}] [MCLv2] Đang tải danh mục phiên bản từ Mojang CDN...", chrono::Local::now().format("%H:%M:%S")),
    );
    let _ = app_handle.emit(
        "download-progress",
        DownloadProgressPayload {
            stage: "Kiểm tra phiên bản".to_string(),
            percentage: 5,
            current_file: format!("Mojang Version Manifest ({})", instance.game_version),
            downloaded_bytes: 0,
            total_bytes: 0,
            speed_bps: 0,
        },
    );
    let version_details = get_version_details(&common_dir, &instance.game_version).await?;

    // 2. Download Client.jar (5% -> 25%)
    let client_jar_path = common_dir
        .join("versions")
        .join(&instance.game_version)
        .join(format!("{}.jar", instance.game_version));

    let client_task = DownloadTask {
        url: version_details.downloads.client.url.clone(),
        destination: client_jar_path.clone(),
        size: version_details.downloads.client.size,
        sha1: Some(version_details.downloads.client.sha1.clone()),
    };
    download_files_concurrently(app_handle, "Đang tải Client JAR gốc", vec![client_task], 1, 5, 25).await?;

    // 3. Download Libraries & Collect Classpaths (25% -> 60% / 70%)
    let mut classpath_entries: Vec<PathBuf> = Vec::new();
    let mut library_download_tasks: Vec<DownloadTask> = Vec::new();

    for lib in &version_details.libraries {
        if !is_library_allowed_on_windows(lib) {
            continue;
        }

        if let Some(downloads) = &lib.downloads {
            // Main artifact
            if let Some(artifact) = &downloads.artifact {
                let dest = libraries_dir.join(get_library_path_from_name(&lib.name));
                classpath_entries.push(dest.clone());
                library_download_tasks.push(DownloadTask {
                    url: artifact.url.clone(),
                    destination: dest,
                    size: artifact.size,
                    sha1: Some(artifact.sha1.clone()),
                });
            }

            // Windows native classifier
            if let Some(classifiers) = &downloads.classifiers {
                if let Some(native_item) = classifiers.get("natives-windows") {
                    let native_dest = libraries_dir.join(format!("natives/{}.jar", lib.name.replace(':', "_")));
                    library_download_tasks.push(DownloadTask {
                        url: native_item.url.clone(),
                        destination: native_dest,
                        size: native_item.size,
                        sha1: Some(native_item.sha1.clone()),
                    });
                }
            }
        }
    }

    let _ = app_handle.emit(
        "mc-log",
        format!(
            "[{}] [MCLv2] Đang tải các thư viện phụ thuộc (Libraries, LWJGL, Fastutil)...",
            chrono::Local::now().format("%H:%M:%S")
        ),
    );
    let has_fabric = instance.loader == "fabric";
    let lib_target = if has_fabric { 60 } else { 70 };
    download_files_concurrently(app_handle, "Đang tải thư viện Libraries", library_download_tasks, 12, 25, lib_target).await?;

    // 4. Mod Loader: Fabric handling
    let mut main_class = version_details.main_class.clone();

    if instance.loader == "fabric" {
        let loader_ver = instance
            .loader_version
            .clone()
            .unwrap_or_else(|| "0.16.10".to_string());

        let _ = app_handle.emit(
            "mc-log",
            format!(
                "[{}] [MCLv2] Đang thiết lập Fabric Loader v{}...",
                chrono::Local::now().format("%H:%M:%S"),
                loader_ver
            ),
        );

        if let Ok(fabric_meta) = get_fabric_meta(&instance.game_version, &loader_ver).await {
            main_class = fabric_meta.launcher_meta.main_class.client;

            let mut fabric_tasks = Vec::new();

            // Intermediary maven
            if let Some((dest, url)) = parse_maven_coord(
                "https://maven.fabricmc.net",
                &libraries_dir,
                &fabric_meta.intermediary.maven,
            ) {
                classpath_entries.push(dest.clone());
                fabric_tasks.push(DownloadTask {
                    url,
                    destination: dest,
                    size: 0,
                    sha1: None,
                });
            }

            // Loader maven
            if let Some((dest, url)) = parse_maven_coord(
                "https://maven.fabricmc.net",
                &libraries_dir,
                &fabric_meta.loader.maven,
            ) {
                classpath_entries.push(dest.clone());
                fabric_tasks.push(DownloadTask {
                    url,
                    destination: dest,
                    size: 0,
                    sha1: None,
                });
            }

            // Common libraries
            for lib in fabric_meta.launcher_meta.libraries.common {
                if let Some((dest, url)) = parse_maven_coord(&lib.url, &libraries_dir, &lib.name) {
                    classpath_entries.push(dest.clone());
                    fabric_tasks.push(DownloadTask {
                        url,
                        destination: dest,
                        size: 0,
                        sha1: None,
                    });
                }
            }

            download_files_concurrently(app_handle, "Đang tải Fabric Libraries", fabric_tasks, 6, 60, 72).await?;
        }
    }

    // 5. Assets download (70%/72% -> 94%)
    let _ = app_handle.emit(
        "mc-log",
        format!(
            "[{}] [MCLv2] Đang kiểm tra và tải tài nguyên âm thanh/hình ảnh (Assets)...",
            chrono::Local::now().format("%H:%M:%S")
        ),
    );
    let assets_start = if has_fabric { 72 } else { 70 };
    let _ = download_assets(app_handle, &common_dir, &version_details.asset_index, assets_start, 94).await;

    // 6. In-Game Skin Feature
    if instance.enable_skin_in_game {
        let _ = setup_in_game_skin_support(&instance_dir, username);
        let _ = app_handle.emit(
            "mc-log",
            format!(
                "[{}] [CustomSkinLoader] Đã cấu hình nạp Skin Đồng Đội cho '{}'",
                chrono::Local::now().format("%H:%M:%S"),
                username
            ),
        );
    }

    // Add client.jar to classpath
    classpath_entries.push(client_jar_path);

    // Build Classpath String (Windows uses semicolon ';')
    let classpath_str = classpath_entries
        .into_iter()
        .filter(|p| p.exists())
        .map(|p| p.to_string_lossy().to_string())
        .collect::<Vec<String>>()
        .join(";");

    // 7. Extract Natives (.dll) to natives directory
    let _ = app_handle.emit(
        "mc-log",
        format!(
            "[{}] [MCLv2] Đang giải nén thư viện native (LWJGL, OpenAL)...",
            chrono::Local::now().format("%H:%M:%S")
        ),
    );
    extract_natives_from_libraries(app_handle, &libraries_dir, &natives_dir);

    // 8. Smart Java Auto-Matching based on Minecraft version
    let (java_bin, java_major, java_reason) = if let Some(custom_path) = &instance.java_path {
        if !custom_path.is_empty() && Path::new(custom_path).exists() {
            (custom_path.clone(), 0u32, format!("Sử dụng Java tùy chỉnh: {}", custom_path))
        } else {
            crate::java_detector::find_best_java_for_version(&instance.game_version)
        }
    } else {
        crate::java_detector::find_best_java_for_version(&instance.game_version)
    };

    let _ = app_handle.emit(
        "mc-log",
        format!(
            "[{}] [MCLv2/Java] {}",
            chrono::Local::now().format("%H:%M:%S"),
            java_reason
        ),
    );
    let _ = app_handle.emit(
        "mc-log",
        format!(
            "[{}] [MCLv2] Khởi chạy tiến trình Minecraft với Java: {} (v{})",
            chrono::Local::now().format("%H:%M:%S"),
            java_bin,
            if java_major > 0 { java_major.to_string() } else { "custom".to_string() }
        ),
    );
    let _ = app_handle.emit(
        "download-progress",
        DownloadProgressPayload {
            stage: "Khởi động JVM".to_string(),
            percentage: 95,
            current_file: "Đang khởi tạo máy ảo Java và nạp Minecraft...".to_string(),
            downloaded_bytes: 0,
            total_bytes: 0,
            speed_bps: 0,
        },
    );

    let mut cmd = Command::new(&java_bin);

    // Memory arguments
    cmd.arg(format!("-Xms{}M", instance.min_ram));
    cmd.arg(format!("-Xmx{}M", instance.max_ram));

    // Custom JVM Flags
    if let Some(jvm_args) = &instance.jvm_args {
        for flag in jvm_args.split_whitespace() {
            cmd.arg(flag);
        }
    }

    // Standard JVM settings
    cmd.arg("-Dfile.encoding=UTF-8");
    cmd.arg(format!("-Djava.library.path={}", natives_dir.display()));
    cmd.arg(format!("-Dminecraft.applet.TargetDirectory={}", instance_dir.display()));
    cmd.arg(format!("-Dminecraft.launcher.brand=MCLv2"));
    cmd.arg(format!("-Dminecraft.launcher.version=2.0.0"));

    // Classpath
    cmd.arg("-cp");
    cmd.arg(&classpath_str);

    // Main Class
    cmd.arg(&main_class);

    // Minecraft Game Arguments
    let uuid = uuid::Uuid::new_v4().to_string();
    cmd.arg("--username").arg(username);
    cmd.arg("--version").arg(&instance.game_version);
    cmd.arg("--gameDir").arg(instance_dir.to_string_lossy().to_string());
    cmd.arg("--assetsDir").arg(common_dir.join("assets").to_string_lossy().to_string());
    cmd.arg("--assetIndex").arg(&version_details.asset_index.id);
    cmd.arg("--uuid").arg(&uuid);
    cmd.arg("--accessToken").arg("0");
    cmd.arg("--userType").arg("mojang");
    cmd.arg("--versionType").arg("MCLv2");

    // Auto-connect to server if configured
    if let Some(server_ip) = &instance.server_ip {
        if !server_ip.is_empty() {
            let port = instance.server_port.unwrap_or(25565);
            cmd.arg("--server").arg(server_ip);
            cmd.arg("--port").arg(port.to_string());
            cmd.arg("--quickPlayMultiplayer").arg(format!("{}:{}", server_ip, port));
        }
    }

    cmd.current_dir(&instance_dir);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("Không thể khởi chạy Java ({}): {}", java_bin, e))?;
    let pid = child.id();
    CURRENT_GAME_PID.store(pid, Ordering::SeqCst);

    let _ = app_handle.emit("game-started", pid);

    let _ = app_handle.emit(
        "mc-log",
        format!(
            "[{}] [MCLv2/INFO] Đã khởi chạy tiến trình Minecraft (PID: {})!",
            chrono::Local::now().format("%H:%M:%S"),
            pid
        ),
    );

    // Stream logs to console
    if let Some(stdout) = child.stdout.take() {
        let app = app_handle.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().flatten() {
                let _ = app.emit("mc-log", line);
            }
        });
    }

    if let Some(stderr) = child.stderr.take() {
        let app = app_handle.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().flatten() {
                let _ = app.emit("mc-log", line);
            }
        });
    }

    // Watch for game exit to notify frontend immediately — with crash detection
    let app_exit = app_handle.clone();
    let game_version_for_exit = instance.game_version.clone();
    let instance_name_for_exit = instance.name.clone();
    std::thread::spawn(move || {
        let status = child.wait();
        CURRENT_GAME_PID.store(0, Ordering::SeqCst);

        match &status {
            Ok(exit_status) => {
                let code = exit_status.code().unwrap_or(-1);
                if code == 0 {
                    // Normal exit
                    let _ = app_exit.emit(
                        "mc-log",
                        format!(
                            "[{}] [MCLv2/INFO] Minecraft '{}' (MC {}) đã thoát bình thường.",
                            chrono::Local::now().format("%H:%M:%S"),
                            instance_name_for_exit,
                            game_version_for_exit
                        ),
                    );
                } else {
                    // Crash detected
                    let crash_hint = match code {
                        -1 => "Tiến trình bị kill hoặc lỗi hệ thống.".to_string(),
                        1 => "Lỗi chung — có thể do mod xung đột hoặc file game bị hỏng.".to_string(),
                        -805306369 => "Out of Memory! Hãy tăng RAM tối đa trong cài đặt profile.".to_string(),
                        _ => format!("Mã lỗi: {}. Kiểm tra log console để biết chi tiết.", code),
                    };
                    let _ = app_exit.emit(
                        "mc-log",
                        format!(
                            "[{}] [MCLv2/ERROR] ⚠ Minecraft đã CRASH! Exit code: {}. {}",
                            chrono::Local::now().format("%H:%M:%S"),
                            code,
                            crash_hint
                        ),
                    );
                    // Notify frontend to auto-open console on crash
                    let _ = app_exit.emit("game-crash", code);
                }
            }
            Err(e) => {
                let _ = app_exit.emit(
                    "mc-log",
                    format!(
                        "[{}] [MCLv2/ERROR] Lỗi khi chờ tiến trình Minecraft: {}",
                        chrono::Local::now().format("%H:%M:%S"),
                        e
                    ),
                );
            }
        }
        let _ = app_exit.emit("game-exit", ());
    });

    Ok(())
}

pub fn kill_current_game() -> Result<bool, String> {
    let pid = CURRENT_GAME_PID.load(Ordering::SeqCst);
    if pid == 0 {
        return Ok(false);
    }

    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .output();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = Command::new("kill")
            .args(["-9", &pid.to_string()])
            .output();
    }

    CURRENT_GAME_PID.store(0, Ordering::SeqCst);
    Ok(true)
}

fn get_library_path_from_name(name: &str) -> PathBuf {
    let parts: Vec<&str> = name.split(':').collect();
    if parts.len() < 3 {
        return PathBuf::from(name.replace(':', "_"));
    }

    let group = parts[0].replace('.', "/");
    let artifact = parts[1];
    let version = parts[2];
    let classifier = if parts.len() >= 4 { format!("-{}", parts[3]) } else { "".to_string() };

    let file_name = format!("{}{}-{}.jar", artifact, classifier, version);
    PathBuf::from(group).join(artifact).join(version).join(file_name)
}

fn extract_natives_from_libraries(app_handle: &AppHandle, libraries_dir: &Path, natives_dir: &Path) {
    let natives_jars_dir = libraries_dir.join("natives");
    if !natives_jars_dir.exists() {
        return;
    }

    // Clean old native files to avoid stale/locked DLLs from previous sessions
    if let Ok(entries) = fs::read_dir(natives_dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.is_file() {
                let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
                if ext == "dll" || ext == "so" || ext == "dylib" {
                    let _ = fs::remove_file(&path);
                }
            }
        }
    }

    let mut extracted_count = 0u32;

    if let Ok(entries) = fs::read_dir(&natives_jars_dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("jar") {
                if let Ok(file) = fs::File::open(&path) {
                    if let Ok(mut archive) = zip::ZipArchive::new(file) {
                        for i in 0..archive.len() {
                            if let Ok(mut file_in_zip) = archive.by_index(i) {
                                let name = file_in_zip.name().to_string();

                                // Skip META-INF and directories
                                if name.starts_with("META-INF") || name.ends_with('/') {
                                    continue;
                                }

                                // Only extract native library files
                                let is_native = name.ends_with(".dll")
                                    || name.ends_with(".so")
                                    || name.ends_with(".dylib");
                                if !is_native {
                                    continue;
                                }

                                // Flatten nested paths: "org/lwjgl/glfw.dll" → "glfw.dll"
                                let file_name = name
                                    .rsplit('/')
                                    .next()
                                    .unwrap_or(&name)
                                    .to_string();

                                let dest = natives_dir.join(&file_name);
                                if let Ok(mut outfile) = fs::File::create(&dest) {
                                    let _ = std::io::copy(&mut file_in_zip, &mut outfile);
                                    extracted_count += 1;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if extracted_count > 0 {
        let _ = app_handle.emit(
            "mc-log",
            format!(
                "[{}] [MCLv2] Đã giải nén {} file native (DLL/SO) vào thư mục natives/",
                chrono::Local::now().format("%H:%M:%S"),
                extracted_count
            ),
        );
    }
}
