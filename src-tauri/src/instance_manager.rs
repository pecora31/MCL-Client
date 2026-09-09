use crate::models::{
    GameInstance, LocalMod, StorageCleanupReport, StorageCleanupScanResult, VersionCleanupInfo,
};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
pub struct LauncherConfig {
    pub game_data_dir: Option<String>,
}

#[cfg(test)]
mod safe_join_tests {
    use super::safe_join;
    use std::path::Path;

    #[test]
    fn accepts_contained_paths() {
        let base = Path::new("C:\\mcl\\instance");
        assert_eq!(safe_join(base, "mods/sodium.jar"), Some(base.join("mods").join("sodium.jar")));
        assert_eq!(safe_join(base, "./config/a.toml"), Some(base.join("config").join("a.toml")));
    }

    #[test]
    fn rejects_escaping_paths() {
        let base = Path::new("C:\\mcl\\instance");
        assert_eq!(safe_join(base, "../evil.bat"), None);
        assert_eq!(safe_join(base, "mods/../../../evil.bat"), None);
        assert_eq!(safe_join(base, "..\\..\\evil.bat"), None);
        assert_eq!(safe_join(base, "C:\\Windows\\System32\\evil.dll"), None);
        assert_eq!(safe_join(base, "/etc/passwd"), None);
        assert_eq!(safe_join(base, ""), None);
    }
}

/// Joins an untrusted relative path (zip entry name, modpack manifest path) onto `base`.
/// Returns None if the result would escape `base`, so callers can skip hostile entries.
pub fn safe_join(base: &Path, relative: &str) -> Option<PathBuf> {
    let mut out = base.to_path_buf();
    for component in Path::new(relative).components() {
        match component {
            std::path::Component::Normal(part) => out.push(part),
            std::path::Component::CurDir => {}
            _ => return None,
        }
    }
    if out == base {
        return None;
    }
    Some(out)
}

pub fn get_app_config_dir() -> PathBuf {
    if let Some(app_data) = dirs::data_dir() {
        app_data.join("MCLv2")
    } else {
        PathBuf::from("MCLv2_Data")
    }
}

pub fn get_config_file() -> PathBuf {
    get_app_config_dir().join("config.json")
}

pub fn load_config() -> LauncherConfig {
    let file = get_config_file();
    if file.exists() {
        if let Ok(content) = fs::read_to_string(&file) {
            if let Ok(config) = serde_json::from_str::<LauncherConfig>(&content) {
                return config;
            }
        }
    }
    LauncherConfig::default()
}

pub fn save_config(config: &LauncherConfig) -> Result<(), String> {
    let dir = get_app_config_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = get_config_file();
    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(file, json).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_launcher_dir() -> PathBuf {
    let config = load_config();
    if let Some(ref dir) = config.game_data_dir {
        let trimmed = dir.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }
    get_app_config_dir()
}

pub fn set_launcher_dir(new_dir: &str) -> Result<(), String> {
    let path = PathBuf::from(new_dir);
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    let mut config = load_config();
    config.game_data_dir = Some(new_dir.to_string());
    save_config(&config)?;
    Ok(())
}

pub fn get_instances_file() -> PathBuf {
    let primary = get_app_config_dir().join("instances.json");
    if primary.exists() {
        return primary;
    }
    let secondary = get_launcher_dir().join("instances.json");
    if secondary.exists() {
        return secondary;
    }
    primary
}

pub fn get_instance_dir(instance_id: &str) -> PathBuf {
    let instances = load_instances();
    if let Some(inst) = instances.iter().find(|i| i.id == instance_id) {
        if let Some(ref custom) = inst.custom_dir {
            let trimmed = custom.trim();
            if !trimmed.is_empty() {
                return PathBuf::from(trimmed);
            }
        }
    }
    get_launcher_dir().join("instances").join(instance_id)
}

pub fn load_instances() -> Vec<GameInstance> {
    let file = get_instances_file();
    if file.exists() {
        if let Ok(content) = fs::read_to_string(&file) {
            if let Ok(instances) = serde_json::from_str::<Vec<GameInstance>>(&content) {
                return instances;
            }
        }
    }

    Vec::new()
}

pub fn save_instances(instances: &[GameInstance]) -> Result<(), String> {
    let launcher_dir = get_launcher_dir();
    fs::create_dir_all(&launcher_dir).map_err(|e| e.to_string())?;

    let file = get_instances_file();
    let json = serde_json::to_string_pretty(instances).map_err(|e| e.to_string())?;
    fs::write(file, json).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_installed_addons(instance_id: &str, addon_type: &str) -> Vec<LocalMod> {
    let folder_name = match addon_type {
        "shaderpacks" | "shaders" => "shaderpacks",
        "resourcepacks" | "resources" => "resourcepacks",
        "datapacks" => "datapacks",
        "modpacks" => "modpacks",
        _ => "mods",
    };
    let dir = get_instance_dir(instance_id).join(folder_name);
    let mut list = Vec::new();

    if !dir.exists() {
        return list;
    }

    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
                let (enabled, is_match) = if folder_name == "mods" {
                    (
                        file_name.ends_with(".jar"),
                        file_name.ends_with(".jar") || file_name.ends_with(".jar.disabled"),
                    )
                } else {
                    (
                        file_name.ends_with(".zip") || file_name.ends_with(".mrpack"),
                        file_name.ends_with(".zip") || file_name.ends_with(".zip.disabled") || file_name.ends_with(".mrpack") || file_name.ends_with(".mrpack.disabled"),
                    )
                };

                if is_match {
                    let clean_name = file_name
                        .trim_end_matches(".disabled")
                        .trim_end_matches(".jar")
                        .trim_end_matches(".zip")
                        .trim_end_matches(".mrpack")
                        .replace('-', " ")
                        .replace('_', " ");

                    let size_bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);

                    list.push(LocalMod {
                        file_name: file_name.to_string(),
                        name: clean_name,
                        version: None,
                        enabled,
                        size_bytes,
                        addon_type: Some(folder_name.to_string()),
                    });
                }
            }
        }
    }

    list
}

pub fn get_local_mods(instance_id: &str) -> Vec<LocalMod> {
    get_installed_addons(instance_id, "mods")
}

pub fn toggle_addon(instance_id: &str, addon_type: &str, file_name: &str, enable: bool) -> Result<(), String> {
    let folder_name = match addon_type {
        "shaderpacks" | "shaders" => "shaderpacks",
        "resourcepacks" | "resources" => "resourcepacks",
        "datapacks" => "datapacks",
        "modpacks" => "modpacks",
        _ => "mods",
    };
    let dir = get_instance_dir(instance_id).join(folder_name);
    let current_path = dir.join(file_name);

    if !current_path.exists() {
        return Err(format!("File '{}' does not exist", file_name));
    }

    let new_name = if enable {
        if file_name.ends_with(".disabled") {
            file_name.trim_end_matches(".disabled").to_string()
        } else {
            file_name.to_string()
        }
    } else {
        if !file_name.ends_with(".disabled") {
            format!("{}.disabled", file_name)
        } else {
            file_name.to_string()
        }
    };

    let new_path = dir.join(new_name);
    if current_path != new_path {
        fs::rename(&current_path, &new_path).map_err(|e| e.to_string())?;
    }

    Ok(())
}

pub fn delete_addon(instance_id: &str, addon_type: &str, file_name: &str) -> Result<(), String> {
    let folder_name = match addon_type {
        "shaderpacks" | "shaders" => "shaderpacks",
        "resourcepacks" | "resources" => "resourcepacks",
        "datapacks" => "datapacks",
        "modpacks" => "modpacks",
        _ => "mods",
    };
    let target = get_instance_dir(instance_id).join(folder_name).join(file_name);
    if target.exists() {
        fs::remove_file(&target).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Tracks which file each Modrinth/CurseForge project installed, so replacing a mod does
/// not leave the previous jar behind and crash the game with a duplicate mod id.
fn addon_registry_path(instance_id: &str) -> PathBuf {
    get_instance_dir(instance_id).join(".mcl-addons.json")
}

fn read_addon_registry(instance_id: &str) -> std::collections::HashMap<String, String> {
    fs::read_to_string(addon_registry_path(instance_id))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

pub async fn download_and_install_addon(
    instance_id: &str,
    url: &str,
    file_name: &str,
    addon_type: &str,
    expected_sha1: Option<&str>,
    project_id: Option<&str>,
) -> Result<LocalMod, String> {
    let folder_name = match addon_type {
        "shaderpacks" | "shaders" => "shaderpacks",
        "resourcepacks" | "resources" => "resourcepacks",
        "datapacks" => "datapacks",
        "modpacks" => "modpacks",
        _ => "mods",
    };
    let dir = get_instance_dir(instance_id).join(folder_name);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let clean_file_name = file_name
        .replace('/', "")
        .replace('\\', "")
        .replace("..", "");

    if clean_file_name.is_empty() {
        return Err("Invalid file name".to_string());
    }

    let target_path = dir.join(&clean_file_name);

    let client = reqwest::Client::builder()
        .user_agent("MCLv2-Launcher/1.0.0 (https://github.com/pecora31/MCLv2)")
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("Server error while downloading file: HTTP {}", resp.status()));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Cannot read file data: {}", e))?;

    // A truncated download produces a jar that fails at load time with a confusing error
    if let Some(expected) = expected_sha1 {
        use sha1::{Digest, Sha1};
        let mut hasher = Sha1::new();
        hasher.update(&bytes);
        let actual = format!("{:x}", hasher.finalize());
        if !actual.eq_ignore_ascii_case(expected.trim()) {
            return Err(
                "The downloaded file is corrupted (checksum mismatch). Please try again.".to_string(),
            );
        }
    }

    // Drop the previous file of this same project so both versions never load at once
    if let Some(project) = project_id {
        let mut registry = read_addon_registry(instance_id);
        if let Some(previous) = registry.get(project) {
            if previous != &clean_file_name {
                for candidate in [previous.clone(), format!("{}.disabled", previous)] {
                    let stale = dir.join(&candidate);
                    if stale.exists() {
                        let _ = fs::remove_file(stale);
                    }
                }
            }
        }
        registry.insert(project.to_string(), clean_file_name.clone());
        if let Ok(serialized) = serde_json::to_string_pretty(&registry) {
            let _ = fs::write(addon_registry_path(instance_id), serialized);
        }
    }

    fs::write(&target_path, &bytes).map_err(|e| format!("Cannot save file: {}", e))?;

    let clean_name = clean_file_name
        .trim_end_matches(".jar")
        .trim_end_matches(".zip")
        .replace('-', " ")
        .replace('_', " ");

    Ok(LocalMod {
        file_name: clean_file_name,
        name: clean_name,
        version: None,
        enabled: true,
        size_bytes: bytes.len() as u64,
        addon_type: Some(folder_name.to_string()),
    })
}

// Configures CustomSkinLoader so in-game offline & online skins are resolved
pub fn setup_in_game_skin_support(instance_dir: &Path, username: &str) -> Result<(), String> {
    let custom_skin_loader_dir = instance_dir.join("CustomSkinLoader");
    fs::create_dir_all(&custom_skin_loader_dir).map_err(|e| e.to_string())?;

    // CustomSkinLoader.json config file
    let config_content = format!(
        r#"{{
  "version": "14.21",
  "load_skin": true,
  "load_cape": true,
  "load_elytra": true,
  "enable_cache_auto_clean": true,
  "cache_expiry": 30,
  "skin_services": [
    {{
      "name": "LocalSkin",
      "type": "Legacy",
      "enable": true,
      "checkPNG": true,
      "skin": "LocalSkin/skins/{{USERNAME}}.png",
      "cape": "LocalSkin/capes/{{USERNAME}}.png",
      "model": "auto"
    }},
    {{
      "name": "Mojang",
      "type": "Mojang",
      "enable": true
    }},
    {{
      "name": "ElyBy",
      "type": "ElyBy",
      "enable": true
    }}
  ],
  "local_user": "{}"
}}"#,
        username
    );

    let config_file = custom_skin_loader_dir.join("CustomSkinLoader.json");
    fs::write(config_file, config_content).map_err(|e| e.to_string())?;

    // The Legacy service above reads from these folders, so they must exist even when empty
    fs::create_dir_all(custom_skin_loader_dir.join("LocalSkin").join("skins"))
        .map_err(|e| e.to_string())?;
    fs::create_dir_all(custom_skin_loader_dir.join("LocalSkin").join("capes"))
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Writes the skin chosen in the launcher into the instance so CustomSkinLoader's local
/// service can serve it. Accepts a `data:image/png;base64,...` URI or a plain file path.
pub fn install_local_skin(instance_id: &str, username: &str, skin: &str) -> Result<String, String> {
    use base64::Engine as _;

    let safe_username: String = username
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .collect();
    if safe_username.is_empty() {
        return Err("The player name has no characters usable as a file name".to_string());
    }

    let skins_dir = get_instance_dir(instance_id)
        .join("CustomSkinLoader")
        .join("LocalSkin")
        .join("skins");
    fs::create_dir_all(&skins_dir).map_err(|e| e.to_string())?;

    let bytes = if let Some(encoded) = skin.split("base64,").nth(1) {
        base64::engine::general_purpose::STANDARD
            .decode(encoded.trim())
            .map_err(|e| format!("The skin image could not be decoded: {}", e))?
    } else if Path::new(skin).exists() {
        fs::read(skin).map_err(|e| format!("Cannot read the skin file: {}", e))?
    } else {
        return Err("No skin image was provided".to_string());
    };

    // A Minecraft skin is a PNG; anything else would silently fail to load in game
    if bytes.len() < 8 || bytes[0..8] != [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] {
        return Err("The chosen skin is not a PNG image".to_string());
    }

    let target = skins_dir.join(format!("{}.png", safe_username));
    fs::write(&target, &bytes).map_err(|e| format!("Cannot save the skin: {}", e))?;
    Ok(target.to_string_lossy().to_string())
}

/// Zips the instance's saves folder into backups/ so a bad mod change cannot cost a world.
pub fn backup_worlds(instance_id: &str) -> Result<String, String> {
    use std::io::Write;

    let instance_dir = get_instance_dir(instance_id);
    let saves_dir = instance_dir.join("saves");
    if !saves_dir.exists() {
        return Err("This profile has no worlds to back up yet.".to_string());
    }

    let backups_dir = instance_dir.join("backups");
    fs::create_dir_all(&backups_dir).map_err(|e| e.to_string())?;

    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let archive_path = backups_dir.join(format!("saves-{}.zip", stamp));
    let file = fs::File::create(&archive_path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let options: zip::write::FileOptions<'_, ()> =
        zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    let mut files_added = 0u32;
    for entry in walkdir::WalkDir::new(&saves_dir).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        let relative = match path.strip_prefix(&saves_dir) {
            Ok(rel) => rel,
            Err(_) => continue,
        };
        if relative.as_os_str().is_empty() {
            continue;
        }
        let name = relative.to_string_lossy().replace('\\', "/");

        if path.is_dir() {
            let _ = zip.add_directory(format!("{}/", name), options);
        } else if path.is_file() {
            zip.start_file(name, options).map_err(|e| e.to_string())?;
            let bytes = fs::read(path).map_err(|e| e.to_string())?;
            zip.write_all(&bytes).map_err(|e| e.to_string())?;
            files_added += 1;
        }
    }

    zip.finish().map_err(|e| e.to_string())?;

    if files_added == 0 {
        let _ = fs::remove_file(&archive_path);
        return Err("This profile has no worlds to back up yet.".to_string());
    }

    Ok(archive_path.to_string_lossy().to_string())
}

/// Writes the launcher console to a file the player can attach to a bug report.
pub fn export_log(instance_id: &str, contents: &str) -> Result<String, String> {
    let dir = if instance_id.is_empty() {
        get_launcher_dir()
    } else {
        get_instance_dir(instance_id)
    };
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let path = dir.join(format!("mcl-log-{}.txt", stamp));
    fs::write(&path, contents).map_err(|e| format!("Cannot write the log file: {}", e))?;
    Ok(path.to_string_lossy().to_string())
}

/// Calculate total size in bytes of a file or directory recursively
pub fn dir_size(path: &Path) -> u64 {
    if !path.exists() {
        return 0;
    }
    if path.is_file() {
        return fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    }
    let mut total = 0;
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.filter_map(|e| e.ok()) {
            let p = entry.path();
            if p.is_dir() {
                total += dir_size(&p);
            } else if let Ok(meta) = p.metadata() {
                total += meta.len();
            }
        }
    }
    total
}

/// Delete an instance directory and remove it from instances.json.
/// Optionally thoroughly deletes the Minecraft client JAR/version files if no other profile uses it.
pub fn delete_instance_and_data(instance_id: &str, delete_version_files: bool) -> Result<u64, String> {
    let mut instances = load_instances();
    let target_pos = instances.iter().position(|i| i.id == instance_id);
    let target = match target_pos {
        Some(pos) => instances.remove(pos),
        None => return Err(format!("Profile '{}' does not exist", instance_id)),
    };

    let mut freed_bytes = 0u64;

    // 1. Delete isolated profile folder (instances/<id>)
    let instance_dir = get_instance_dir(instance_id);
    if instance_dir.exists() {
        freed_bytes += dir_size(&instance_dir);
        let _ = fs::remove_dir_all(&instance_dir);
    }

    // 2. Persist updated instances.json
    save_instances(&instances)?;

    // 3. If thorough delete requested: check if any remaining instance uses the same game_version
    if delete_version_files {
        let is_used_by_other = instances.iter().any(|i| i.game_version == target.game_version);
        if !is_used_by_other {
            let version_dir = get_launcher_dir()
                .join("common")
                .join("versions")
                .join(&target.game_version);
            if version_dir.exists() {
                freed_bytes += dir_size(&version_dir);
                let _ = fs::remove_dir_all(&version_dir);
            }
        }
    }

    Ok(freed_bytes)
}

fn scan_cache_files(dir: &Path, total_size: &mut u64) {
    if !dir.exists() {
        return;
    }
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.is_dir() {
                if let Some(dir_name) = path.file_name().and_then(|n| n.to_str()) {
                    if dir_name == "telemetry" {
                        *total_size += dir_size(&path);
                        continue;
                    }
                }
                scan_cache_files(&path, total_size);
            } else if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
                if file_name.ends_with(".tmp")
                    || file_name.ends_with(".part")
                    || file_name.ends_with(".download")
                    || file_name.ends_with(".log.gz")
                    || (file_name.starts_with("crash-") && file_name.ends_with(".txt"))
                {
                    if let Ok(meta) = entry.metadata() {
                        *total_size += meta.len();
                    }
                }
            }
        }
    }
}

fn clean_cache_files_recursive(dir: &Path, freed: &mut u64) {
    if !dir.exists() {
        return;
    }
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.is_dir() {
                if let Some(dir_name) = path.file_name().and_then(|n| n.to_str()) {
                    if dir_name == "telemetry" {
                        *freed += dir_size(&path);
                        let _ = fs::remove_dir_all(&path);
                        continue;
                    }
                }
                clean_cache_files_recursive(&path, freed);
            } else if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
                if file_name.ends_with(".tmp")
                    || file_name.ends_with(".part")
                    || file_name.ends_with(".download")
                    || file_name.ends_with(".log.gz")
                    || (file_name.starts_with("crash-") && file_name.ends_with(".txt"))
                {
                    if let Ok(meta) = entry.metadata() {
                        *freed += meta.len();
                    }
                    let _ = fs::remove_file(&path);
                }
            }
        }
    }
}

/// Scan for unused Minecraft versions, orphaned instances, and temporary cache
pub fn scan_storage_cleanup() -> StorageCleanupScanResult {
    let launcher_dir = get_launcher_dir();
    let instances = load_instances();
    let active_versions: HashSet<String> = instances.iter().map(|i| i.game_version.clone()).collect();
    let active_instance_ids: HashSet<String> = instances.iter().map(|i| i.id.clone()).collect();

    let mut unused_versions = Vec::new();
    let mut unused_versions_bytes = 0u64;

    let versions_dir = launcher_dir.join("common").join("versions");
    if versions_dir.exists() {
        if let Ok(entries) = fs::read_dir(&versions_dir) {
            for entry in entries.filter_map(|e| e.ok()) {
                if entry.path().is_dir() {
                    if let Some(ver_name) = entry.file_name().to_str() {
                        if !active_versions.contains(ver_name) {
                            let size = dir_size(&entry.path());
                            unused_versions_bytes += size;
                            unused_versions.push(VersionCleanupInfo {
                                version: ver_name.to_string(),
                                size_bytes: size,
                            });
                        }
                    }
                }
            }
        }
    }

    let mut orphaned_instances = Vec::new();
    let mut orphaned_instances_bytes = 0u64;
    let instances_dir = launcher_dir.join("instances");
    if instances_dir.exists() {
        if let Ok(entries) = fs::read_dir(&instances_dir) {
            for entry in entries.filter_map(|e| e.ok()) {
                if entry.path().is_dir() {
                    if let Some(id) = entry.file_name().to_str() {
                        if !active_instance_ids.contains(id) {
                            let size = dir_size(&entry.path());
                            orphaned_instances_bytes += size;
                            orphaned_instances.push(id.to_string());
                        }
                    }
                }
            }
        }
    }

    let mut temp_cache_bytes = 0u64;
    scan_cache_files(&launcher_dir, &mut temp_cache_bytes);

    let total_reclaimable_bytes = unused_versions_bytes + orphaned_instances_bytes + temp_cache_bytes;

    StorageCleanupScanResult {
        unused_versions,
        orphaned_instances,
        orphaned_instances_bytes,
        temp_cache_bytes,
        total_reclaimable_bytes,
        storage_root: launcher_dir.to_string_lossy().to_string(),
    }
}

/// Execute storage cleanup with granular selection
pub fn execute_storage_cleanup(
    clean_versions: bool,
    clean_cache: bool,
    clean_orphaned_instances: bool,
) -> Result<StorageCleanupReport, String> {
    let launcher_dir = get_launcher_dir();
    let instances = load_instances();
    let active_versions: HashSet<String> = instances.iter().map(|i| i.game_version.clone()).collect();
    let active_instance_ids: HashSet<String> = instances.iter().map(|i| i.id.clone()).collect();

    let mut bytes_freed = 0u64;
    let mut versions_deleted = 0usize;
    let mut orphaned_instances_deleted = 0usize;

    // 1. Clean unused versions
    if clean_versions {
        let versions_dir = launcher_dir.join("common").join("versions");
        if versions_dir.exists() {
            if let Ok(entries) = fs::read_dir(&versions_dir) {
                for entry in entries.filter_map(|e| e.ok()) {
                    if entry.path().is_dir() {
                        if let Some(ver_name) = entry.file_name().to_str() {
                            if !active_versions.contains(ver_name) {
                                let size = dir_size(&entry.path());
                                if fs::remove_dir_all(&entry.path()).is_ok() {
                                    bytes_freed += size;
                                    versions_deleted += 1;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. Clean orphaned instance folders
    if clean_orphaned_instances {
        let instances_dir = launcher_dir.join("instances");
        if instances_dir.exists() {
            if let Ok(entries) = fs::read_dir(&instances_dir) {
                for entry in entries.filter_map(|e| e.ok()) {
                    if entry.path().is_dir() {
                        if let Some(id) = entry.file_name().to_str() {
                            if !active_instance_ids.contains(id) {
                                let size = dir_size(&entry.path());
                                if fs::remove_dir_all(&entry.path()).is_ok() {
                                    bytes_freed += size;
                                    orphaned_instances_deleted += 1;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 3. Clean cache
    let mut cache_cleaned = false;
    if clean_cache {
        clean_cache_files_recursive(&launcher_dir, &mut bytes_freed);
        cache_cleaned = true;
    }

    let mb_freed = (bytes_freed as f64) / (1024.0 * 1024.0);
    let message = format!(
        "Cleanup complete. Freed {:.1} MB of disk space.",
        mb_freed
    );

    Ok(StorageCleanupReport {
        bytes_freed,
        versions_deleted,
        cache_cleaned,
        orphaned_instances_deleted,
        message,
    })
}

