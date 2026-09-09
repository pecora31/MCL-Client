use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionManifest {
    pub latest: LatestVersion,
    pub versions: Vec<VersionEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LatestVersion {
    pub release: String,
    pub snapshot: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionEntry {
    pub id: String,
    #[serde(rename = "type")]
    pub version_type: String,
    pub url: String,
    pub time: String,
    pub release_time: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionDetails {
    pub id: String,
    pub downloads: Downloads,
    pub libraries: Vec<Library>,
    #[serde(rename = "assetIndex")]
    pub asset_index: AssetIndexInfo,
    #[serde(rename = "mainClass")]
    pub main_class: String,
    #[serde(default)]
    pub arguments: Option<Arguments>,
    #[serde(rename = "minecraftArguments")]
    pub minecraft_arguments: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Downloads {
    pub client: DownloadItem,
    #[serde(default)]
    pub server: Option<DownloadItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadItem {
    pub sha1: String,
    pub size: u64,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Library {
    pub name: String,
    #[serde(default)]
    pub downloads: Option<LibraryDownloads>,
    #[serde(default)]
    pub rules: Option<Vec<Rule>>,
    #[serde(default)]
    pub natives: Option<std::collections::HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryDownloads {
    #[serde(default)]
    pub artifact: Option<DownloadItem>,
    #[serde(default)]
    pub classifiers: Option<std::collections::HashMap<String, DownloadItem>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Rule {
    pub action: String, // "allow" or "disallow"
    #[serde(default)]
    pub os: Option<OsRule>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OsRule {
    pub name: Option<String>, // "windows", "linux", "osx"
    pub arch: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetIndexInfo {
    pub id: String,
    pub sha1: String,
    pub size: u64,
    pub total_size: Option<u64>,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Arguments {
    #[serde(default)]
    pub game: Vec<serde_json::Value>,
    #[serde(default)]
    pub jvm: Vec<serde_json::Value>,
}

pub async fn get_version_details(
    common_dir: &Path,
    game_version: &str,
) -> Result<VersionDetails, String> {
    let client = reqwest::Client::builder()
        .user_agent("MCLClient/1.0")
        .build()
        .map_err(|e| e.to_string())?;

    let version_dir = common_dir.join("versions").join(game_version);
    fs::create_dir_all(&version_dir).map_err(|e| e.to_string())?;

    let cached_file = version_dir.join(format!("{}.json", game_version));

    // If cached, return immediately
    if cached_file.exists() {
        if let Ok(content) = fs::read_to_string(&cached_file) {
            if let Ok(details) = serde_json::from_str::<VersionDetails>(&content) {
                return Ok(details);
            }
        }
    }

    // Fetch version manifest to get version URL
    let manifest_url = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
    let manifest: VersionManifest = client
        .get(manifest_url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch version manifest: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Failed to parse version manifest: {}", e))?;

    let entry = manifest
        .versions
        .into_iter()
        .find(|v| v.id == game_version)
        .ok_or_else(|| format!("Minecraft version {} was not found on the Mojang CDN", game_version))?;

    // Fetch version details JSON
    let details: VersionDetails = client
        .get(&entry.url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch version details: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Failed to parse version details: {}", e))?;

    // Save to cache
    if let Ok(json_str) = serde_json::to_string_pretty(&details) {
        let _ = fs::write(&cached_file, json_str);
    }

    Ok(details)
}

// Checks if library is allowed on current OS (Windows)
pub fn is_library_allowed_on_windows(lib: &Library) -> bool {
    if let Some(rules) = &lib.rules {
        let mut allowed = false;
        for rule in rules {
            let is_windows = rule
                .os
                .as_ref()
                .and_then(|os| os.name.as_deref())
                .map(|name| name == "windows")
                .unwrap_or(true);

            if is_windows {
                if rule.action == "allow" {
                    allowed = true;
                } else if rule.action == "disallow" {
                    allowed = false;
                }
            }
        }
        allowed
    } else {
        true
    }
}
