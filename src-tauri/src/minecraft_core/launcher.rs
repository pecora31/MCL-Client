use super::assets::download_assets;
use super::downloader::{download_files_concurrently, DownloadProgressPayload, DownloadTask};
use super::fabric::{get_loader_meta, loader_endpoints, parse_maven_coord};
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

/// Copies the client jar to the location a loader's own version id expects it at, if it
/// is not already there. Returns the path to put on the classpath.
///
/// Split out from the launch flow so this can be tested against a temp directory rather
/// than requiring a full instance and a real download.
fn ensure_loader_client_jar(
    vanilla_client_jar: &Path,
    common_dir: &Path,
    loader_version_id: &str,
) -> Result<PathBuf, String> {
    let target = common_dir
        .join("versions")
        .join(loader_version_id)
        .join(format!("{}.jar", loader_version_id));

    if !target.exists() {
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::copy(vanilla_client_jar, &target).map_err(|e| e.to_string())?;
    }

    Ok(target)
}

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
            "[{}] [MCL] Preparing resources for profile: {} (Minecraft {})",
            chrono::Local::now().format("%H:%M:%S"),
            instance.name,
            instance.game_version
        ),
    );

    // 1. Fetch Version Details from Mojang
    let _ = app_handle.emit(
        "mc-log",
        format!("[{}] [MCL] Fetching the version manifest from the Mojang CDN...", chrono::Local::now().format("%H:%M:%S")),
    );
    let _ = app_handle.emit(
        "download-progress",
        DownloadProgressPayload {
            stage: "preparing".to_string(),
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
    // Overridden for Forge/NeoForge below, since they need the jar under their own
    // version id rather than the plain game version.
    let mut game_client_jar_path = client_jar_path.clone();

    let client_task = DownloadTask {
        url: version_details.downloads.client.url.clone(),
        destination: client_jar_path.clone(),
        size: version_details.downloads.client.size,
        sha1: Some(version_details.downloads.client.sha1.clone()),
    };
    download_files_concurrently(app_handle, "downloading", vec![client_task], 1, 5, 25).await?;

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
            "[{}] [MCL] Downloading dependencies (libraries, LWJGL, Fastutil)...",
            chrono::Local::now().format("%H:%M:%S")
        ),
    );
    let has_fabric = instance.loader == "fabric";
    let lib_target = if has_fabric { 60 } else { 70 };
    download_files_concurrently(app_handle, "downloading", library_download_tasks, 12, 25, lib_target).await?;

    // 4. Mod Loader: Fabric handling
    let mut main_class = version_details.main_class.clone();

    let mut extra_jvm_args: Vec<String> = Vec::new();
    let mut extra_game_args: Vec<String> = Vec::new();

    if let Some(endpoints) = loader_endpoints(&instance.loader) {
        let loader_ver = instance
            .loader_version
            .clone()
            .ok_or_else(|| format!("This profile has no {} version selected.", endpoints.display_name))?;

        let _ = app_handle.emit(
            "mc-log",
            format!(
                "[{}] [MCL] Setting up {} Loader v{}...",
                chrono::Local::now().format("%H:%M:%S"),
                endpoints.display_name,
                loader_ver
            ),
        );

        let meta = get_loader_meta(&endpoints, &instance.game_version, &loader_ver)
            .await
            .map_err(|e| {
                format!(
                    "Could not set up {} {} for Minecraft {}: {}",
                    endpoints.display_name, loader_ver, instance.game_version, e
                )
            })?;

        main_class = meta.launcher_meta.main_class.client;

        let mut loader_tasks = Vec::new();
        let mut queue_maven = |coord: &str, base: &str, tasks: &mut Vec<DownloadTask>, cp: &mut Vec<PathBuf>| {
            if let Some((dest, url)) = parse_maven_coord(base, &libraries_dir, coord) {
                cp.push(dest.clone());
                tasks.push(DownloadTask {
                    url,
                    destination: dest,
                    size: 0,
                    sha1: None,
                });
            }
        };

        queue_maven(&meta.intermediary.maven, endpoints.maven_root, &mut loader_tasks, &mut classpath_entries);
        queue_maven(&meta.loader.maven, endpoints.maven_root, &mut loader_tasks, &mut classpath_entries);
        for lib in meta.launcher_meta.libraries.common {
            queue_maven(&lib.name, &lib.url, &mut loader_tasks, &mut classpath_entries);
        }

        download_files_concurrently(app_handle, "downloading", loader_tasks, 6, 60, 72).await?;
    } else if instance.loader == "forge" || instance.loader == "neoforge" {
        let loader_ver = instance
            .loader_version
            .clone()
            .ok_or_else(|| "This profile has no loader version selected.".to_string())?;

        let installed = super::forge::install_and_resolve(
            app_handle,
            &instance.loader,
            &instance.game_version,
            &loader_ver,
            &common_dir,
            &libraries_dir,
        )
        .await?;

        main_class = installed.main_class;
        // Forge's own libraries have to precede the vanilla ones: several of them are
        // patched replacements and the first match on the classpath wins.
        let mut merged = installed.classpath;
        merged.append(&mut classpath_entries);
        classpath_entries = merged;
        extra_jvm_args = installed.jvm_args;
        extra_game_args = installed.game_args;

        // Modern Forge/NeoForge transform Minecraft's classes in memory rather than
        // patching the jar on disk, but their profile's JVM args still name the client jar
        // it expects by the loader's own version id (an "-DignoreList=...,${version_name}.jar"
        // entry) rather than the plain game version — this is the same "inheritsFrom" jar
        // convention the official launcher and every other third-party launcher follow.
        // Putting the plain vanilla-named jar on the classpath instead leaves it
        // unrecognised, so the module system sees it as a second, separately-named copy of
        // the same classes the loader already merged into its own "minecraft" module and
        // refuses to start (a "Modules ... export package ... to module ..." crash).
        let forge_version_id = super::forge::version_id(&instance.loader, &instance.game_version, &loader_ver);
        game_client_jar_path = ensure_loader_client_jar(&client_jar_path, &common_dir, &forge_version_id)
            .map_err(|e| format!("Could not prepare the client jar for {}: {}", instance.loader, e))?;
    }

    // 5. Assets download (70%/72% -> 94%)
    let _ = app_handle.emit(
        "mc-log",
        format!(
            "[{}] [MCL] Checking and downloading assets (audio and textures)...",
            chrono::Local::now().format("%H:%M:%S")
        ),
    );
    let assets_start = if has_fabric { 72 } else { 70 };
    let _ = download_assets(app_handle, &common_dir, &version_details.asset_index, assets_start, 94).await;

    // 6. In-Game Skin Feature
    if instance.enable_skin_in_game {
        if instance.loader == "vanilla" {
            let _ = app_handle.emit(
                "mc-log",
                format!(
                    "[{}] [CustomSkinLoader] Skipped: in-game skins need a mod loader, and this profile is vanilla.",
                    chrono::Local::now().format("%H:%M:%S")
                ),
            );
        } else {
            let _ = setup_in_game_skin_support(&instance_dir);
            match ensure_custom_skin_loader(&instance_dir, &instance.game_version, &instance.loader).await
            {
                Ok(file_name) => {
                    let _ = app_handle.emit(
                        "mc-log",
                        format!(
                            "[{}] [CustomSkinLoader] Ready for '{}' using {}",
                            chrono::Local::now().format("%H:%M:%S"),
                            username,
                            file_name
                        ),
                    );
                }
                Err(err) => {
                    // Skins are optional, so a failure here must never block the launch
                    let _ = app_handle.emit(
                        "mc-log",
                        format!(
                            "[{}] [CustomSkinLoader/WARN] Could not install the skin mod: {}. The game will start without in-game skins.",
                            chrono::Local::now().format("%H:%M:%S"),
                            err
                        ),
                    );
                }
            }
        }
    }

    // Add client.jar to classpath
    classpath_entries.push(game_client_jar_path);

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
            "[{}] [MCL] Extracting native libraries (LWJGL, OpenAL)...",
            chrono::Local::now().format("%H:%M:%S")
        ),
    );
    extract_natives_from_libraries(app_handle, &libraries_dir, &natives_dir);

    // 8. Smart Java Auto-Matching based on Minecraft version
    let (java_bin, java_major, java_reason) = if let Some(custom_path) = &instance.java_path {
        if !custom_path.is_empty() && Path::new(custom_path).exists() {
            (custom_path.clone(), 0u32, format!("Using custom Java: {}", custom_path))
        } else {
            crate::java_detector::find_best_java_for_version(&instance.game_version)
        }
    } else {
        crate::java_detector::find_best_java_for_version(&instance.game_version)
    };

    let _ = app_handle.emit(
        "mc-log",
        format!(
            "[{}] [MCL/Java] {}",
            chrono::Local::now().format("%H:%M:%S"),
            java_reason
        ),
    );

    // Refuse to start on a Java too old for this Minecraft build. Launching anyway only
    // produces an UnsupportedClassVersionError that is hard for players to interpret.
    let required_java = crate::java_detector::required_java_major(&instance.game_version);
    if java_major > 0 && java_major < required_java {
        return Err(format!(
            "Minecraft {} requires Java {}, but only Java {} was found on this computer. \
             Install Java {} (Adoptium Temurin {} LTS, 64-bit), then reopen the launcher. \
             You can also pick a Java runtime manually in the profile settings.",
            instance.game_version, required_java, java_major, required_java, required_java
        ));
    }
    if java_major == 0 && !Path::new(&java_bin).exists() {
        return Err(format!(
            "No Java runtime was found on this computer. Minecraft {} requires Java {}. \
             Install Java {} (Adoptium Temurin {} LTS, 64-bit), then reopen the launcher.",
            instance.game_version, required_java, required_java, required_java
        ));
    }
    let _ = app_handle.emit(
        "mc-log",
        format!(
            "[{}] [MCL] Starting Minecraft with Java: {} (v{})",
            chrono::Local::now().format("%H:%M:%S"),
            java_bin,
            if java_major > 0 { java_major.to_string() } else { "custom".to_string() }
        ),
    );
    let _ = app_handle.emit(
        "download-progress",
        DownloadProgressPayload {
            stage: "launching".to_string(),
            percentage: 95,
            current_file: "Starting the Java virtual machine and loading Minecraft...".to_string(),
            downloaded_bytes: 0,
            total_bytes: 0,
            speed_bps: 0,
        },
    );

    // A heap larger than the machine has stops the JVM before Minecraft ever loads
    {
        let mut sys = sysinfo::System::new();
        sys.refresh_memory();
        let total_ram_mb = (sys.total_memory() / 1024 / 1024) as u32;
        if total_ram_mb > 0 && instance.max_ram >= total_ram_mb {
            return Err(format!(
                "This profile is set to use {} MB of RAM, but the computer only has {} MB in total. \
                 Lower the maximum RAM in the profile settings to about {} MB.",
                instance.max_ram,
                total_ram_mb,
                (total_ram_mb / 2).max(1024)
            ));
        }
    }

    // javaw.exe reports fatal startup errors in a Windows dialog and never writes them to
    // stderr, so java.exe is used instead and its console is suppressed below.
    let console_java_bin = {
        let path = Path::new(&java_bin);
        let sibling = path.with_file_name("java.exe");
        if sibling.exists() {
            sibling.to_string_lossy().to_string()
        } else {
            java_bin.clone()
        }
    };

    let mut cmd = Command::new(&console_java_bin);

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    // Memory arguments
    cmd.arg(format!("-Xms{}M", instance.min_ram));
    cmd.arg(format!("-Xmx{}M", instance.max_ram));

    // Custom JVM Flags
    if let Some(jvm_args) = &instance.jvm_args {
        for flag in jvm_args.split_whitespace() {
            cmd.arg(flag);
        }
    }

    // Forge and NeoForge need their own module-path and --add-opens flags, taken from the
    // version profile the installer produced
    for arg in &extra_jvm_args {
        cmd.arg(arg);
    }

    // Standard JVM settings
    cmd.arg("-Dfile.encoding=UTF-8");
    cmd.arg(format!("-Djava.library.path={}", natives_dir.display()));
    cmd.arg(format!("-Dminecraft.applet.TargetDirectory={}", instance_dir.display()));
    cmd.arg(format!("-Dminecraft.launcher.brand=MCL Client"));
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
    cmd.arg("--versionType").arg("MCL Client");

    // Forge identifies its own launch through these (--launchTarget, --fml.* and friends)
    for arg in &extra_game_args {
        cmd.arg(arg);
    }

    // Window size, so players do not have to fix it inside the game every time
    if instance.fullscreen.unwrap_or(false) {
        cmd.arg("--fullscreen");
    } else {
        if let Some(width) = instance.window_width {
            if width >= 320 {
                cmd.arg("--width").arg(width.to_string());
            }
        }
        if let Some(height) = instance.window_height {
            if height >= 240 {
                cmd.arg("--height").arg(height.to_string());
            }
        }
    }

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

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Cannot start Java ({}): {}", console_java_bin, e))?;
    let pid = child.id();
    CURRENT_GAME_PID.store(pid, Ordering::SeqCst);
    let session_start = std::time::Instant::now();

    crate::discord_rpc::show_playing(crate::discord_rpc::PlayingInfo {
        instance_name: instance.name.clone(),
        game_version: instance.game_version.clone(),
        loader: instance.loader.clone(),
        // Mirrors the auto-connect above: an empty address means no server was set.
        server: instance
            .server_ip
            .as_ref()
            .filter(|ip| !ip.is_empty())
            .cloned(),
        started_at: crate::discord_rpc::now_unix_seconds(),
    });

    let _ = app_handle.emit("game-started", pid);

    let _ = app_handle.emit(
        "mc-log",
        format!(
            "[{}] [MCL/INFO] Minecraft process started (PID: {}).",
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
    let instance_dir_for_exit = instance_dir.clone();
    let instance_id_for_exit = instance.id.clone();
    std::thread::spawn(move || {
        let status = child.wait();
        CURRENT_GAME_PID.store(0, Ordering::SeqCst);

        // Counted however the game ended: a session that crashed after an hour was still
        // an hour of play. Minutes are truncated, so sessions under one are worth nothing.
        crate::discord_rpc::show_idle();

        let played_minutes = session_start.elapsed().as_secs() / 60;
        if played_minutes > 0 {
            if let Err(e) =
                crate::instance_manager::record_play_session(&instance_id_for_exit, played_minutes)
            {
                let _ = app_exit.emit(
                    "mc-log",
                    format!(
                        "[{}] [MCL/WARN] Could not record playtime: {}",
                        chrono::Local::now().format("%H:%M:%S"),
                        e
                    ),
                );
            }
        }

        match &status {
            Ok(exit_status) => {
                let code = exit_status.code().unwrap_or(-1);
                if code == 0 {
                    // Normal exit
                    let _ = app_exit.emit(
                        "mc-log",
                        format!(
                            "[{}] [MCL/INFO] Minecraft '{}' (MC {}) exited normally.",
                            chrono::Local::now().format("%H:%M:%S"),
                            instance_name_for_exit,
                            game_version_for_exit
                        ),
                    );
                } else {
                    // Crash detected
                    let crash_hint = match code {
                        -1 => "The process was killed or hit a system error.".to_string(),
                        1 => "The game stopped during startup. The lines above this one carry the real cause."
                            .to_string(),
                        -805306369 => "Out of memory. Increase the maximum RAM in the profile settings.".to_string(),
                        _ => format!("Exit code: {}. Check the console log for details.", code),
                    };
                    let _ = app_exit.emit(
                        "mc-log",
                        format!(
                            "[{}] [MCL/ERROR] ⚠ Minecraft crashed. Exit code: {}. {}",
                            chrono::Local::now().format("%H:%M:%S"),
                            code,
                            crash_hint
                        ),
                    );

                    // The game's own logs name the real cause far more precisely than the
                    // exit code ever can, so translate them into something readable
                    if let Some(diagnosis) = diagnose_crash(&instance_dir_for_exit) {
                        let _ = app_exit.emit(
                            "mc-log",
                            format!(
                                "[{}] [MCL/DIAGNOSIS] {}",
                                chrono::Local::now().format("%H:%M:%S"),
                                diagnosis
                            ),
                        );
                    }

                    // Notify frontend to auto-open console on crash
                    let _ = app_exit.emit("game-crash", code);
                }
            }
            Err(e) => {
                let _ = app_exit.emit(
                    "mc-log",
                    format!(
                        "[{}] [MCL/ERROR] Error while waiting for the Minecraft process: {}",
                        chrono::Local::now().format("%H:%M:%S"),
                        e
                    ),
                );
            }
        }
        // Carries the delta so the running UI can add it without re-reading the file it
        // may be about to overwrite with its own copy of the profile list.
        let _ = app_exit.emit(
            "game-session-ended",
            serde_json::json!({ "instanceId": instance_id_for_exit, "minutes": played_minutes }),
        );
        let _ = app_exit.emit("game-exit", ());
    });

    Ok(())
}

/// Reads the game's own logs after a crash and turns the known failure signatures into
/// something a player can act on. Returns None when nothing recognisable is found.
fn diagnose_crash(instance_dir: &Path) -> Option<String> {
    let mut haystack = String::new();

    if let Ok(text) = fs::read_to_string(instance_dir.join("logs").join("latest.log")) {
        // Only the tail matters; the rest is startup noise
        let start = text.len().saturating_sub(60_000);
        haystack.push_str(&text[start..]);
    }

    if let Ok(entries) = fs::read_dir(instance_dir.join("crash-reports")) {
        let mut reports: Vec<_> = entries
            .filter_map(|e| e.ok())
            .filter(|e| e.path().is_file())
            .collect();
        reports.sort_by_key(|e| e.metadata().and_then(|m| m.modified()).ok());
        if let Some(newest) = reports.last() {
            if let Ok(text) = fs::read_to_string(newest.path()) {
                let start = text.len().saturating_sub(40_000);
                haystack.push_str(&text[start..]);
            }
        }
    }

    explain_crash_text(&haystack)
}

/// Matches known failure signatures in game log text. Split out from file reading so the
/// rules can be tested directly.
fn explain_crash_text(haystack: &str) -> Option<String> {
    if haystack.is_empty() {
        return None;
    }

    let lower = haystack.to_ascii_lowercase();

    // Ordered from most specific to most general
    let rules: [(&str, &str); 9] = [
        (
            "unsupportedclassversionerror",
            "The Java version is too old for this Minecraft build. Pick a newer Java in the profile settings, or install the version the profile asks for.",
        ),
        (
            "duplicate mod",
            "Two copies of the same mod are installed. Open Mods & Shaders and remove the older file.",
        ),
        (
            "outofmemoryerror",
            "The game ran out of memory. Raise the maximum RAM in the profile settings, or use fewer mods.",
        ),
        (
            "could not reserve enough space for object heap",
            "The requested RAM is more than this computer can provide. Lower the maximum RAM in the profile settings.",
        ),
        (
            "requires the mod",
            "A mod is missing a library it depends on. Reinstall it from Mods & Shaders so the required dependencies come with it.",
        ),
        (
            "missing or unsupported mandatory dependencies",
            "A mod is missing a library it depends on. Reinstall it from Mods & Shaders so the required dependencies come with it.",
        ),
        (
            "incompatible mods found",
            "Some installed mods do not work with this Minecraft version or loader. Remove the ones the lines above name.",
        ),
        (
            "mixin apply failed",
            "Two mods are patching the same part of the game and clash. Remove the mod named in the lines above and try again.",
        ),
        (
            "unsatisfiedlinkerror",
            "The graphics or native libraries failed to load. Update the graphics driver, then relaunch.",
        ),
    ];

    for (needle, explanation) in rules {
        if lower.contains(needle) {
            return Some(explanation.to_string());
        }
    }

    None
}

#[cfg(test)]
mod loader_client_jar_tests {
    use super::ensure_loader_client_jar;
    use std::fs;

    fn temp_dir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("mcl-loaderjar-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn copies_the_vanilla_jar_under_the_loaders_own_version_id() {
        let common = temp_dir();
        let vanilla = common.join("versions").join("1.20.1").join("1.20.1.jar");
        fs::create_dir_all(vanilla.parent().unwrap()).unwrap();
        fs::write(&vanilla, b"pretend class bytes").unwrap();

        let result = ensure_loader_client_jar(&vanilla, &common, "1.20.1-forge-47.4.23").unwrap();

        assert_eq!(
            result,
            common.join("versions").join("1.20.1-forge-47.4.23").join("1.20.1-forge-47.4.23.jar")
        );
        assert_eq!(fs::read(&result).unwrap(), b"pretend class bytes");
        fs::remove_dir_all(&common).ok();
    }

    #[test]
    fn does_not_re_copy_once_the_loader_jar_already_exists() {
        let common = temp_dir();
        let vanilla = common.join("versions").join("1.20.1").join("1.20.1.jar");
        fs::create_dir_all(vanilla.parent().unwrap()).unwrap();
        fs::write(&vanilla, b"current vanilla bytes").unwrap();

        let target = common.join("versions").join("1.20.1-forge-47.4.23").join("1.20.1-forge-47.4.23.jar");
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        // Stands in for a jar Forge itself has already written there; a real one would not
        // just be re-derivable from the plain vanilla jar the way this test fixture is.
        fs::write(&target, b"already prepared").unwrap();

        let result = ensure_loader_client_jar(&vanilla, &common, "1.20.1-forge-47.4.23").unwrap();

        assert_eq!(fs::read(&result).unwrap(), b"already prepared");
        fs::remove_dir_all(&common).ok();
    }

    #[test]
    fn fails_clearly_when_the_vanilla_jar_is_missing() {
        let common = temp_dir();
        let missing = common.join("versions").join("1.20.1").join("1.20.1.jar");
        assert!(ensure_loader_client_jar(&missing, &common, "1.20.1-forge-47.4.23").is_err());
        fs::remove_dir_all(&common).ok();
    }
}

#[cfg(test)]
mod crash_diagnosis_tests {
    use super::explain_crash_text;

    #[test]
    fn recognises_known_failures() {
        let java = explain_crash_text(
            "Exception in thread \"main\" java.lang.UnsupportedClassVersionError: net/minecraft/client/main/Main",
        )
        .expect("java mismatch should be recognised");
        assert!(java.contains("Java version is too old"));

        let memory = explain_crash_text("java.lang.OutOfMemoryError: Java heap space")
            .expect("out of memory should be recognised");
        assert!(memory.contains("ran out of memory"));

        assert!(explain_crash_text("Duplicate mod sodium found").is_some());
        assert!(explain_crash_text("Mixin apply failed for someMod.mixins.json").is_some());
    }

    #[test]
    fn stays_quiet_when_nothing_matches() {
        assert_eq!(explain_crash_text(""), None);
        assert_eq!(explain_crash_text("[Render thread/INFO]: Stopping worker threads"), None);
    }
}

/// Modrinth project id for CustomSkinLoader, the mod that renders everyone's skin on
/// servers running in offline mode.
const CUSTOM_SKIN_LOADER_PROJECT: &str = "idMHQ4n2";

/// Makes sure the instance has a CustomSkinLoader build matching its loader and game
/// version. Returns the jar name in use.
async fn ensure_custom_skin_loader(
    instance_dir: &Path,
    game_version: &str,
    loader: &str,
) -> Result<String, String> {
    let mods_dir = instance_dir.join("mods");
    fs::create_dir_all(&mods_dir).map_err(|e| e.to_string())?;

    if let Ok(entries) = fs::read_dir(&mods_dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
            if name.contains("customskinloader") && name.ends_with(".jar") {
                return Ok(entry.file_name().to_string_lossy().to_string());
            }
        }
    }

    let client = reqwest::Client::builder()
        .user_agent("MCLClient-Launcher/1.0 (https://github.com/pecora31/MCL-Client)")
        .build()
        .map_err(|e| e.to_string())?;

    let versions: Vec<serde_json::Value> = client
        .get(format!(
            "https://api.modrinth.com/v2/project/{}/version",
            CUSTOM_SKIN_LOADER_PROJECT
        ))
        .send()
        .await
        .map_err(|e| format!("Modrinth is unreachable: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Unexpected response from Modrinth: {}", e))?;

    let matching = versions
        .iter()
        .find(|v| {
            let versions_ok = v["game_versions"]
                .as_array()
                .map(|a| a.iter().any(|g| g.as_str() == Some(game_version)))
                .unwrap_or(false);
            let loader_ok = v["loaders"]
                .as_array()
                .map(|a| a.iter().any(|l| l.as_str() == Some(loader)))
                .unwrap_or(false);
            versions_ok && loader_ok
        })
        .ok_or_else(|| {
            format!(
                "no CustomSkinLoader build for {} on {}",
                game_version, loader
            )
        })?;

    let files = matching["files"].as_array().ok_or("no files listed")?;
    let file = files
        .iter()
        .find(|f| f["primary"].as_bool().unwrap_or(false))
        .or_else(|| files.first())
        .ok_or("no downloadable file")?;

    let url = file["url"].as_str().ok_or("file has no url")?;
    let file_name = file["filename"].as_str().ok_or("file has no name")?;
    let expected_sha1 = file["hashes"]["sha1"].as_str();

    let bytes = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("download failed: {}", e))?
        .bytes()
        .await
        .map_err(|e| format!("download failed: {}", e))?;

    if let Some(expected) = expected_sha1 {
        use sha1::{Digest, Sha1};
        let mut hasher = Sha1::new();
        hasher.update(&bytes);
        let actual = format!("{:x}", hasher.finalize());
        if !actual.eq_ignore_ascii_case(expected) {
            return Err("the downloaded file failed its checksum".to_string());
        }
    }

    fs::write(mods_dir.join(file_name), &bytes)
        .map_err(|e| format!("cannot save the mod: {}", e))?;
    Ok(file_name.to_string())
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

                                let dest = match crate::instance_manager::safe_join(
                                    natives_dir,
                                    &file_name,
                                ) {
                                    Some(path) => path,
                                    None => continue,
                                };
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
                "[{}] [MCL] Extracted {} native file(s) (DLL/SO) into natives/",
                chrono::Local::now().format("%H:%M:%S"),
                extracted_count
            ),
        );
    }
}

