use super::downloader::{download_files_concurrently, DownloadTask};
use super::version::AssetIndexInfo;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetIndex {
    pub objects: HashMap<String, AssetObject>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetObject {
    pub hash: String,
    pub size: u64,
}

pub async fn download_assets(
    app_handle: &AppHandle,
    common_dir: &Path,
    asset_info: &AssetIndexInfo,
    base_percent: u32,
    target_percent: u32,
) -> Result<(), String> {
    let assets_dir = common_dir.join("assets");
    let indexes_dir = assets_dir.join("indexes");
    let objects_dir = assets_dir.join("objects");

    fs::create_dir_all(&indexes_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&objects_dir).map_err(|e| e.to_string())?;

    let index_file = indexes_dir.join(format!("{}.json", asset_info.id));

    // Download asset index if not exists
    if !index_file.exists() {
        let client = reqwest::Client::new();
        let content = client
            .get(&asset_info.url)
            .send()
            .await
            .map_err(|e| format!("Failed to download asset index: {}", e))?
            .text()
            .await
            .map_err(|e| format!("Failed to read asset index text: {}", e))?;

        fs::write(&index_file, content).map_err(|e| e.to_string())?;
    }

    // Read asset index
    let index_json = fs::read_to_string(&index_file).map_err(|e| e.to_string())?;
    let asset_index: AssetIndex =
        serde_json::from_str(&index_json).map_err(|e| format!("Parse asset index error: {}", e))?;

    let mut essential_tasks = Vec::new();
    let mut other_tasks = Vec::new();
    let base_resource_url = "https://resources.download.minecraft.net";

    for (name, obj) in asset_index.objects {
        if obj.hash.len() >= 2 {
            let prefix = &obj.hash[..2];
            let dest = objects_dir.join(prefix).join(&obj.hash);

            let task = DownloadTask {
                url: format!("{}/{}/{}", base_resource_url, prefix, obj.hash),
                destination: dest,
                size: obj.size,
                sha1: Some(obj.hash),
            };

            if name.contains("icon") || name.contains("lang") || name.contains("font") || name.ends_with(".json") {
                essential_tasks.push(task);
            } else {
                other_tasks.push(task);
            }
        }
    }

    let span = if target_percent > base_percent {
        target_percent - base_percent
    } else {
        10
    };
    let mid_percent = base_percent + (span * 30 / 100);

    // 1. Download essential assets first (fast, few seconds)
    download_files_concurrently(
        app_handle,
        "downloading",
        essential_tasks,
        16,
        base_percent,
        mid_percent,
    ).await?;

    // 2. Download sound/gameplay assets with 24 parallel streams
    let _ = download_files_concurrently(
        app_handle,
        "downloading",
        other_tasks,
        24,
        mid_percent,
        target_percent,
    ).await;

    Ok(())
}
