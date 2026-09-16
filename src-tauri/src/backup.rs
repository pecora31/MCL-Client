//! Backup logic for an agent-hosted Minecraft server: what counts as "the data" (never the
//! loader jar or logs, always the world and player-list files — see the design spec, Part B
//! §5.1), and how it's zipped, listed, rotated, and restored. Pure filesystem functions with
//! no knowledge of HTTP or `AppState`, so `mcl_agent.rs`'s handlers and background scheduler
//! both just call into this.

use crate::server_config;
use serde::Serialize;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub name: String,
    pub size_bytes: u64,
    pub created_at: u64,
}

/// The files and folders, relative to `server_dir`, that make up one backup — irreplaceable
/// player data only, never anything `/v1/prepare` can redownload or regenerate.
pub fn backup_source_paths(server_dir: &Path) -> Vec<PathBuf> {
    let level_name = server_config::read_level_name(server_dir);
    let mut paths = Vec::new();
    for suffix in ["", "_nether", "_the_end"] {
        let world_dir = server_dir.join(format!("{}{}", level_name, suffix));
        if world_dir.is_dir() {
            paths.push(world_dir);
        }
    }
    for file in [
        "server.properties",
        "whitelist.json",
        "ops.json",
        "banned-players.json",
        "banned-ips.json",
        "usercache.json",
    ] {
        let path = server_dir.join(file);
        if path.is_file() {
            paths.push(path);
        }
    }
    paths
}

fn add_file_to_zip(
    writer: &mut zip::ZipWriter<File>,
    path: &Path,
    zip_path: &str,
    options: zip::write::SimpleFileOptions,
) -> Result<(), String> {
    writer.start_file(zip_path, options).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    File::open(path).map_err(|e| e.to_string())?.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    writer.write_all(&buf).map_err(|e| e.to_string())
}

fn add_dir_to_zip(
    writer: &mut zip::ZipWriter<File>,
    dir: &Path,
    zip_prefix: &str,
    options: zip::write::SimpleFileOptions,
) -> Result<(), String> {
    for entry in walkdir::WalkDir::new(dir).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        let relative = path.strip_prefix(dir).map_err(|e| e.to_string())?;
        if relative.as_os_str().is_empty() {
            continue;
        }
        let zip_path = format!("{}/{}", zip_prefix, relative.to_string_lossy().replace('\\', "/"));
        if entry.file_type().is_dir() {
            writer.add_directory(format!("{}/", zip_path), options).map_err(|e| e.to_string())?;
        } else {
            add_file_to_zip(writer, path, &zip_path, options)?;
        }
    }
    Ok(())
}

/// Zips `backup_source_paths(server_dir)` into a new file under `backups_dir`, named after the
/// current unix timestamp so `list_backups` can sort/parse without extra metadata. Creates
/// `backups_dir` if it doesn't exist yet.
pub fn create_backup(server_dir: &Path, backups_dir: &Path) -> Result<BackupInfo, String> {
    fs::create_dir_all(backups_dir).map_err(|e| e.to_string())?;
    let created_at = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_secs();
    let name = format!("{}.zip", created_at);
    let path = backups_dir.join(&name);

    let file = File::create(&path).map_err(|e| e.to_string())?;
    let mut writer = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    for source in backup_source_paths(server_dir) {
        let Some(source_name) = source.file_name().and_then(|n| n.to_str()) else { continue };
        if source.is_dir() {
            add_dir_to_zip(&mut writer, &source, source_name, options)?;
        } else {
            add_file_to_zip(&mut writer, &source, source_name, options)?;
        }
    }

    writer.finish().map_err(|e| e.to_string())?;
    let size_bytes = fs::metadata(&path).map_err(|e| e.to_string())?.len();
    Ok(BackupInfo { name, size_bytes, created_at })
}

/// Lists `backups_dir`'s `.zip` files, newest first.
pub fn list_backups(backups_dir: &Path) -> Vec<BackupInfo> {
    let Ok(entries) = fs::read_dir(backups_dir) else { return Vec::new() };
    let mut backups: Vec<BackupInfo> = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("zip") {
                return None;
            }
            let name = path.file_name()?.to_str()?.to_string();
            let created_at = name.strip_suffix(".zip")?.parse::<u64>().ok()?;
            let size_bytes = entry.metadata().ok()?.len();
            Some(BackupInfo { name, size_bytes, created_at })
        })
        .collect();
    backups.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    backups
}

/// Deletes the oldest backups beyond `retention_count`, returning how many were removed.
pub fn rotate_backups(backups_dir: &Path, retention_count: usize) -> usize {
    list_backups(backups_dir)
        .into_iter()
        .skip(retention_count)
        .filter(|old| fs::remove_file(backups_dir.join(&old.name)).is_ok())
        .count()
}

/// Extracts `backup_name` back over `server_dir`, overwriting whatever's already there.
/// `enclosed_name()` is the `zip` crate's own zip-slip defense — an entry whose path would
/// resolve outside the extraction root comes back `None` and aborts the restore instead of
/// being written somewhere unintended.
pub fn restore_backup(server_dir: &Path, backups_dir: &Path, backup_name: &str) -> Result<(), String> {
    let backup_path = backups_dir.join(backup_name);
    let file = File::open(&backup_path).map_err(|e| format!("Could not open backup {}: {}", backup_name, e))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Backup {} is not a valid archive: {}", backup_name, e))?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let Some(enclosed) = entry.enclosed_name() else {
            return Err(format!("Backup {} contains an unsafe path.", backup_name));
        };
        let out_path = server_dir.join(enclosed);
        if entry.is_dir() {
            fs::create_dir_all(&out_path).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut out_file = File::create(&out_path).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut out_file).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_test_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("mcl-backup-test-{}", name));
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::create_dir_all(&dir);
        dir
    }

    #[test]
    fn backup_scope_includes_the_named_world_and_its_nether_and_end_but_not_libraries_or_logs() {
        let server_dir = temp_test_dir("scope");
        fs::write(server_dir.join("server.properties"), "level-name=survival_smp\n").unwrap();
        for name in ["survival_smp", "survival_smp_nether", "survival_smp_the_end", "libraries", "logs"] {
            fs::create_dir_all(server_dir.join(name)).unwrap();
        }
        fs::write(server_dir.join("whitelist.json"), "[]").unwrap();
        fs::write(server_dir.join("server.jar"), "not a real jar").unwrap();

        let sources = backup_source_paths(&server_dir);
        let names: Vec<String> = sources
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().to_string())
            .collect();

        assert!(names.contains(&"survival_smp".to_string()));
        assert!(names.contains(&"survival_smp_nether".to_string()));
        assert!(names.contains(&"survival_smp_the_end".to_string()));
        assert!(names.contains(&"whitelist.json".to_string()));
        assert!(!names.contains(&"libraries".to_string()));
        assert!(!names.contains(&"logs".to_string()));
        assert!(!names.contains(&"server.jar".to_string()));

        let _ = fs::remove_dir_all(&server_dir);
    }

    #[test]
    fn a_created_backup_can_be_listed_and_restored() {
        let server_dir = temp_test_dir("roundtrip-server");
        let backups_dir = temp_test_dir("roundtrip-backups");
        fs::write(server_dir.join("server.properties"), "level-name=world\n").unwrap();
        fs::create_dir_all(server_dir.join("world")).unwrap();
        fs::write(server_dir.join("world/level.dat"), "fake level data").unwrap();

        let info = create_backup(&server_dir, &backups_dir).unwrap();
        assert!(info.name.ends_with(".zip"));
        assert!(info.size_bytes > 0);

        let listed = list_backups(&backups_dir);
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, info.name);

        // Prove restore actually overwrites: mutate the source, then restore from the backup.
        fs::write(server_dir.join("world/level.dat"), "corrupted!!").unwrap();
        restore_backup(&server_dir, &backups_dir, &info.name).unwrap();
        let restored = fs::read_to_string(server_dir.join("world/level.dat")).unwrap();
        assert_eq!(restored, "fake level data");

        let _ = fs::remove_dir_all(&server_dir);
        let _ = fs::remove_dir_all(&backups_dir);
    }

    #[test]
    fn rotation_keeps_only_the_newest_n_and_deletes_the_rest() {
        let backups_dir = temp_test_dir("rotation");
        for (name, created_at) in [("1000.zip", 1000u64), ("2000.zip", 2000), ("3000.zip", 3000)] {
            fs::write(backups_dir.join(name), format!("backup at {}", created_at)).unwrap();
        }

        let removed = rotate_backups(&backups_dir, 2);

        assert_eq!(removed, 1);
        let remaining: Vec<String> = list_backups(&backups_dir).into_iter().map(|b| b.name).collect();
        assert!(remaining.contains(&"3000.zip".to_string()));
        assert!(remaining.contains(&"2000.zip".to_string()));
        assert!(!remaining.contains(&"1000.zip".to_string()), "the oldest backup must be the one removed");

        let _ = fs::remove_dir_all(&backups_dir);
    }
}
