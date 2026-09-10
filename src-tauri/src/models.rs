use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameInstance {
    pub id: String,
    pub name: String,
    pub game_version: String,
    pub loader: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub loader_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub java_path: Option<String>,
    /// A Java major version picked in the profile; downloaded if this computer lacks it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub java_version: Option<u32>,
    pub min_ram: u32,
    pub max_ram: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jvm_args: Option<String>,
    pub icon: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_ip: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_skin_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skin_model: Option<String>,
    pub enable_skin_in_game: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_dir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window_width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window_height: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fullscreen: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_played: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_play_time: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub total_ram_mb: u32,
    pub available_ram_mb: u32,
    pub cpu_count: u32,
    /// Largest heap the launcher will offer, leaving room for the OS and the JVM itself
    pub recommended_max_ram_mb: u32,
    pub recommended_ram_mb: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaInstallation {
    pub path: String,
    pub major_version: u32,
    pub version_string: String,
    pub is_64_bit: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerStatus {
    pub ip: String,
    pub port: u16,
    pub online: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub players_online: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub players_max: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub motd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ping_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub favicon: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalMod {
    pub file_name: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    pub enabled: bool,
    pub size_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub addon_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionCleanupInfo {
    pub version: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaRuntimeCleanupInfo {
    /// Folder name under runtime/, e.g. "java-21", or "java-21.partial" for an unfinished unpack.
    pub name: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageCleanupScanResult {
    pub unused_versions: Vec<VersionCleanupInfo>,
    pub unused_java_runtimes: Vec<JavaRuntimeCleanupInfo>,
    pub orphaned_instances: Vec<String>,
    pub orphaned_instances_bytes: u64,
    pub temp_cache_bytes: u64,
    pub total_reclaimable_bytes: u64,
    pub storage_root: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageCleanupReport {
    pub bytes_freed: u64,
    pub versions_deleted: usize,
    pub cache_cleaned: bool,
    pub orphaned_instances_deleted: usize,
    pub java_runtimes_deleted: usize,
    pub message: String,
}

