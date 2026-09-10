use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::Read;
use std::path::Path;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;
use zip::ZipArchive;

use crate::instance_manager::{get_launcher_dir, load_instances, safe_join, save_instances};
use crate::minecraft_core::downloader::{
    download_files_concurrently, DownloadProgressPayload, DownloadTask,
};
use crate::models::GameInstance;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MrpackIndex {
    #[serde(rename = "formatVersion")]
    pub format_version: u32,
    pub game: String,
    #[serde(rename = "versionId")]
    pub version_id: Option<String>,
    pub name: String,
    pub summary: Option<String>,
    pub files: Vec<MrpackFile>,
    pub dependencies: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MrpackFile {
    pub path: String,
    pub hashes: HashMap<String, String>,
    pub env: Option<MrpackEnv>,
    pub downloads: Vec<String>,
    #[serde(rename = "fileSize")]
    pub file_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MrpackEnv {
    pub client: Option<String>,
    pub server: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MrpackManifestSummary {
    pub name: String,
    pub summary: String,
    pub game_version: String,
    pub loader: String,
    pub loader_version: Option<String>,
    pub total_files: usize,
    pub total_size_bytes: u64,
    pub file_path: String,
}

/// Reads the metadata of a `.mrpack` file without installing it
pub fn inspect_mrpack_file(path_str: &str) -> Result<MrpackManifestSummary, String> {
    let path = Path::new(path_str);
    if !path.exists() {
        return Err(format!("File does not exist: {}", path_str));
    }

    let file = File::open(path).map_err(|e| format!("Cannot open the .mrpack file: {}", e))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|e| format!("The .mrpack file is not a valid ZIP archive: {}", e))?;

    let index_data = {
        let mut index_file = archive
            .by_name("modrinth.index.json")
            .map_err(|_| "'modrinth.index.json' was not found inside the .mrpack".to_string())?;
        let mut content = String::new();
        index_file
            .read_to_string(&mut content)
            .map_err(|e| format!("Failed to read the modpack manifest: {}", e))?;
        content
    };

    let index: MrpackIndex = serde_json::from_str(&index_data)
        .map_err(|e| format!("Invalid modrinth.index.json format: {}", e))?;

    let game_version = index
        .dependencies
        .get("minecraft")
        .cloned()
        .unwrap_or_else(|| "1.21.4".to_string());

    let (loader, loader_version) = if let Some(v) = index.dependencies.get("fabric-loader") {
        ("fabric".to_string(), Some(v.clone()))
    } else if let Some(v) = index.dependencies.get("neoforge") {
        ("neoforge".to_string(), Some(v.clone()))
    } else if let Some(v) = index.dependencies.get("forge") {
        ("forge".to_string(), Some(v.clone()))
    } else if let Some(v) = index.dependencies.get("quilt-loader") {
        ("quilt".to_string(), Some(v.clone()))
    } else {
        ("vanilla".to_string(), None)
    };

    let client_files: Vec<&MrpackFile> = index
        .files
        .iter()
        .filter(|f| {
            if let Some(ref env) = f.env {
                if let Some(ref client) = env.client {
                    return client != "unsupported";
                }
            }
            true
        })
        .collect();

    let total_size_bytes: u64 = client_files.iter().map(|f| f.file_size).sum();

    Ok(MrpackManifestSummary {
        name: index.name,
        summary: index.summary.unwrap_or_default(),
        game_version,
        loader,
        loader_version,
        total_files: client_files.len(),
        total_size_bytes,
        file_path: path_str.to_string(),
    })
}

/// Extracts the overrides and downloads the mods into a new instance
pub async fn install_mrpack(
    app_handle: &AppHandle,
    mrpack_path_str: &str,
    custom_name: Option<String>,
) -> Result<GameInstance, String> {
    let path = Path::new(mrpack_path_str);
    if !path.exists() {
        return Err(format!("File does not exist: {}", mrpack_path_str));
    }

    let _ = app_handle.emit(
        "download-progress",
        DownloadProgressPayload {
            stage: "preparing".to_string(),
            percentage: 2,
            current_file: "Reading modrinth.index.json...".to_string(),
            downloaded_bytes: 0,
            total_bytes: 0,
            speed_bps: 0,
        },
    );

    let file = File::open(path).map_err(|e| format!("Cannot open the .mrpack file: {}", e))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|e| format!("The .mrpack file is not a valid ZIP archive: {}", e))?;

    let index: MrpackIndex = {
        let mut index_file = archive
            .by_name("modrinth.index.json")
            .map_err(|_| "modrinth.index.json was not found inside the .mrpack".to_string())?;
        let mut content = String::new();
        index_file
            .read_to_string(&mut content)
            .map_err(|e| e.to_string())?;
        serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse modrinth.index.json: {}", e))?
    };

    let game_version = index
        .dependencies
        .get("minecraft")
        .cloned()
        .unwrap_or_else(|| "1.21.4".to_string());

    let (loader, loader_version) = if let Some(v) = index.dependencies.get("fabric-loader") {
        ("fabric".to_string(), Some(v.clone()))
    } else if let Some(v) = index.dependencies.get("neoforge") {
        ("neoforge".to_string(), Some(v.clone()))
    } else if let Some(v) = index.dependencies.get("forge") {
        ("forge".to_string(), Some(v.clone()))
    } else if let Some(v) = index.dependencies.get("quilt-loader") {
        ("quilt".to_string(), Some(v.clone()))
    } else {
        ("vanilla".to_string(), None)
    };

    let final_name = match custom_name {
        Some(name) if !name.trim().is_empty() => name.trim().to_string(),
        _ => index.name.clone(),
    };

    let instance_id = format!(
        "modpack-{}",
        Uuid::new_v4().to_string()[..8].to_string()
    );

    let instance_dir = get_launcher_dir().join("instances").join(&instance_id);
    fs::create_dir_all(&instance_dir)
        .map_err(|e| format!("Cannot create the instance directory: {}", e))?;

    // 1. Extract overrides/ and client-overrides/
    let _ = app_handle.emit(
        "download-progress",
        DownloadProgressPayload {
            stage: "extracting".to_string(),
            percentage: 5,
            current_file: "Extracting override files...".to_string(),
            downloaded_bytes: 0,
            total_bytes: 0,
            speed_bps: 0,
        },
    );

    let archive_len = archive.len();
    for i in 0..archive_len {
        let mut file_entry = archive
            .by_index(i)
            .map_err(|e| format!("Failed to extract a zip entry: {}", e))?;
        let entry_name = file_entry.name().to_string();

        let relative_path = if let Some(rel) = entry_name.strip_prefix("overrides/") {
            rel
        } else if let Some(rel) = entry_name.strip_prefix("client-overrides/") {
            rel
        } else {
            continue;
        };

        if relative_path.is_empty() || relative_path.ends_with('/') {
            continue;
        }

        let out_path = match safe_join(&instance_dir, relative_path) {
            Some(path) => path,
            None => {
                log::warn!("Skipped modpack entry with unsafe path: {}", entry_name);
                continue;
            }
        };
        if let Some(parent) = out_path.parent() {
            let _ = fs::create_dir_all(parent);
        }

        if let Ok(mut outfile) = File::create(&out_path) {
            let _ = std::io::copy(&mut file_entry, &mut outfile);
        }
    }

    // 2. Build the download task list for the mods
    let mut download_tasks = Vec::new();
    for item in index.files {
        if let Some(ref env) = item.env {
            if let Some(ref client) = env.client {
                if client == "unsupported" {
                    continue; // Skip server-only mod
                }
            }
        }

        if item.downloads.is_empty() {
            continue;
        }

        let dest = match safe_join(&instance_dir, &item.path) {
            Some(path) => path,
            None => {
                log::warn!("Skipped modpack file with unsafe path: {}", item.path);
                continue;
            }
        };
        let sha1 = item.hashes.get("sha1").cloned();

        download_tasks.push(DownloadTask {
            url: item.downloads[0].clone(),
            destination: dest,
            size: item.file_size,
            sha1,
        });
    }

    // 3. Download all mods concurrently
    let _ = app_handle.emit(
        "mc-log",
        format!(
            "[{}] [MCL/Modpack] Downloading {} mod file(s) for modpack '{}'...",
            chrono::Local::now().format("%H:%M:%S"),
            download_tasks.len(),
            final_name
        ),
    );

    download_files_concurrently(
        app_handle,
        "downloading",
        download_tasks,
        10,
        10,
        95,
    )
    .await?;

    // 4. Create the GameInstance and persist it
    let new_instance = GameInstance {
        id: instance_id.clone(),
        name: final_name,
        game_version,
        loader,
        loader_version,
        java_path: None,
        min_ram: 2048,
        max_ram: 4096,
        jvm_args: Some("-XX:+UseG1GC -XX:+ParallelRefProcEnabled".to_string()),
        icon: "package".to_string(),
        server_ip: None,
        server_port: None,
        custom_skin_path: None,
        java_version: None,
        window_width: None,
        window_height: None,
        fullscreen: None,
        skin_model: Some("classic".to_string()),
        enable_skin_in_game: true,
        custom_dir: None,
        last_played: Some("Just created".to_string()),
        total_play_time: Some(0),
    };

    let mut instances = load_instances();
    instances.insert(0, new_instance.clone());
    save_instances(&instances)?;

    let _ = app_handle.emit(
        "download-progress",
        DownloadProgressPayload {
            stage: "done".to_string(),
            percentage: 100,
            current_file: "The modpack is ready to launch.".to_string(),
            downloaded_bytes: 0,
            total_bytes: 0,
            speed_bps: 0,
        },
    );

    let _ = app_handle.emit(
        "mc-log",
        format!(
            "[{}] [MCL/Modpack] Modpack installed: ID={}",
            chrono::Local::now().format("%H:%M:%S"),
            instance_id
        ),
    );

    Ok(new_instance)
}
