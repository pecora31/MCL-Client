//! Backup logic for an agent-hosted Minecraft server: what counts as "the data" (never the
//! loader jar or logs, always the world and player-list files — see the design spec, Part B
//! §5.1), and how it's zipped, listed, rotated, and restored. Pure filesystem functions with
//! no knowledge of HTTP or `AppState`, so `mcl_agent.rs`'s handlers and background scheduler
//! both just call into this.

use crate::server_config;
use serde::Serialize;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub name: String,
    pub size_bytes: u64,
    pub created_at: u64,
}

/// `level-name` from `server.properties`, but only if it is exactly one plain path segment.
/// The agent runs as root, so a value like `/root` or `../../etc` would otherwise make a backup
/// read (and a restore write) outside `server_dir`; anything like that falls back to `world`.
fn safe_level_name(server_dir: &Path) -> String {
    let name = server_config::read_level_name(server_dir);
    if name.contains('/') || name.contains('\\') {
        return "world".to_string();
    }
    let mut components = Path::new(&name).components();
    match (components.next(), components.next()) {
        (Some(Component::Normal(_)), None) => name,
        _ => "world".to_string(),
    }
}

/// The files and folders, relative to `server_dir`, that make up one backup — irreplaceable
/// player data only, never anything `/v1/prepare` can redownload or regenerate.
pub fn backup_source_paths(server_dir: &Path) -> Vec<PathBuf> {
    let level_name = safe_level_name(server_dir);
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
    let created_at = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_secs();
    create_backup_at(server_dir, backups_dir, created_at)
}

/// `create_backup` with the timestamp supplied, so tests can force a name collision. The
/// archive is written to `<ts>.zip.tmp` and only renamed to `<ts>.zip` once complete, so a
/// failure never leaves a truncated backup that gets listed or counts toward retention.
fn create_backup_at(server_dir: &Path, backups_dir: &Path, created_at: u64) -> Result<BackupInfo, String> {
    fs::create_dir_all(backups_dir).map_err(|e| e.to_string())?;
    let name = format!("{}.zip", created_at);
    let path = backups_dir.join(&name);
    if path.exists() {
        return Err(format!("A backup named {} already exists; try again in a moment.", name));
    }
    let tmp_path = backups_dir.join(format!("{}.tmp", name));

    let result = write_backup_archive(server_dir, &tmp_path).and_then(|_| fs::rename(&tmp_path, &path).map_err(|e| e.to_string()));
    if let Err(e) = result {
        let _ = fs::remove_file(&tmp_path);
        return Err(e);
    }
    let size_bytes = fs::metadata(&path).map_err(|e| e.to_string())?.len();
    Ok(BackupInfo { name, size_bytes, created_at })
}

fn write_backup_archive(server_dir: &Path, out_path: &Path) -> Result<(), String> {
    let file = File::create(out_path).map_err(|e| e.to_string())?;
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
    Ok(())
}

/// Lists `backups_dir`'s `.zip` files, newest first. In-progress `<ts>.zip.tmp` files have
/// extension `tmp`, so they are skipped.
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

/// Removes a file or a whole directory tree, treating "already gone" as success.
fn remove_path(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.is_dir() => fs::remove_dir_all(path).map_err(|e| e.to_string()),
        Ok(_) => fs::remove_file(path).map_err(|e| e.to_string()),
        Err(_) => Ok(()),
    }
}

fn pre_restore_path(server_dir: &Path, top_name: &str) -> PathBuf {
    server_dir.join(format!("{}.pre-restore", top_name))
}

/// Replaces the world and player-list files in `server_dir` with `backup_name`'s contents.
///
/// All-or-nothing: every entry's path is validated before anything on disk changes
/// (`enclosed_name()` is the `zip` crate's zip-slip defense), then each top-level name the
/// archive contains is moved aside to `<name>.pre-restore` so the restored world never mixes
/// with files newer than the backup. A leftover `<name>.pre-restore` aborts the restore rather
/// than being deleted. If extraction fails part way, the partial output is removed and the
/// moved-aside copies are put back; on success they are deleted. A live original that was not
/// moved aside is never removed.
pub fn restore_backup(server_dir: &Path, backups_dir: &Path, backup_name: &str) -> Result<(), String> {
    let backup_path = backups_dir.join(backup_name);
    let file = File::open(&backup_path).map_err(|e| format!("Could not open backup {}: {}", backup_name, e))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Backup {} is not a valid archive: {}", backup_name, e))?;

    // (a) Validate every entry and collect the top-level names this restore will replace.
    let mut top_names: Vec<String> = Vec::new();
    for i in 0..archive.len() {
        let entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let unsafe_path = || format!("Backup {} contains an unsafe path.", backup_name);
        let enclosed = entry.enclosed_name().ok_or_else(unsafe_path)?;
        let top = match enclosed.components().next() {
            Some(Component::Normal(part)) => part.to_str().ok_or_else(unsafe_path)?.to_string(),
            _ => return Err(unsafe_path()),
        };
        if !top_names.contains(&top) {
            top_names.push(top);
        }
    }

    // (b) Move the current copies aside. On any failure here nothing has been extracted yet, so
    // only the entries already moved are put back and nothing is deleted.
    let mut moved_aside: Vec<String> = Vec::new();
    let mut absent_before: Vec<String> = Vec::new();
    for top in &top_names {
        let current = server_dir.join(top);
        let aside = pre_restore_path(server_dir, top);
        let aside_state = match fs::symlink_metadata(&aside) {
            Ok(_) => Some(format!(
                // Never delete it: an earlier interrupted restore may have left the only good copy.
                "{}.pre-restore is already in the server folder, left by a previous restore that failed or whose cleanup failed. Inspect it (it may be the only copy of {}) and move or delete it before restoring again.",
                top, top
            )),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => Some(format!("Could not check {}.pre-restore before restoring: {}", top, e)),
        };
        let failure = if aside_state.is_some() {
            aside_state
        } else {
            match fs::symlink_metadata(&current) {
                Ok(_) => match fs::rename(&current, &aside) {
                    Ok(()) => {
                        moved_aside.push(top.clone());
                        None
                    }
                    Err(e) => Some(format!("Could not move {} aside before restoring: {}", top, e)),
                },
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    absent_before.push(top.clone());
                    None
                }
                Err(e) => Some(format!("Could not check {} before restoring: {}", top, e)),
            }
        };
        if let Some(message) = failure {
            return Err(append_rollback_errors(message, put_back_aside(server_dir, &moved_aside)));
        }
    }

    // (c) Extract.
    match extract_archive(&mut archive, server_dir) {
        Ok(()) => {
            // (d) Success: the moved-aside copies are no longer needed.
            // A copy that can't be deleted doesn't undo the restore, but say so: the next restore
            // will refuse to run until it is removed.
            for top in &moved_aside {
                if let Err(e) = remove_path(&pre_restore_path(server_dir, top)) {
                    eprintln!(
                        "Warning: restore succeeded but {}.pre-restore could not be deleted ({}); remove it before the next restore.",
                        top, e
                    );
                }
            }
            Ok(())
        }
        Err(e) => {
            // (d) Failure: remove partial output only where the original is safe in its
            // `.pre-restore` copy or never existed, then put the originals back.
            for top in moved_aside.iter().chain(absent_before.iter()) {
                let _ = remove_path(&server_dir.join(top));
            }
            Err(append_rollback_errors(e, put_back_aside(server_dir, &moved_aside)))
        }
    }
}

/// Renames each `<name>.pre-restore` back to `<name>`, returning a message for every one that
/// could not be put back so the operator knows where the original still is.
fn put_back_aside(server_dir: &Path, moved_aside: &[String]) -> Vec<String> {
    moved_aside
        .iter()
        .filter_map(|top| {
            fs::rename(pre_restore_path(server_dir, top), server_dir.join(top)).err().map(|e| {
                format!("Could not put {} back ({}); the original is preserved at {}.pre-restore.", top, e, top)
            })
        })
        .collect()
}

fn append_rollback_errors(message: String, rollback_errors: Vec<String>) -> String {
    if rollback_errors.is_empty() {
        message
    } else {
        format!("{} {}", message, rollback_errors.join(" "))
    }
}

fn extract_archive(archive: &mut zip::ZipArchive<File>, server_dir: &Path) -> Result<(), String> {
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let enclosed = entry.enclosed_name().ok_or_else(|| "Backup contains an unsafe path.".to_string())?;
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
        // A file that did not exist when the backup was taken must not survive the restore.
        fs::write(server_dir.join("world/newer_region.mca"), "created after backup").unwrap();
        restore_backup(&server_dir, &backups_dir, &info.name).unwrap();
        let restored = fs::read_to_string(server_dir.join("world/level.dat")).unwrap();
        assert_eq!(restored, "fake level data");
        assert!(!server_dir.join("world/newer_region.mca").exists(), "restore must not leave a mixed-state world");
        assert!(!server_dir.join("world.pre-restore").exists(), "pre-restore copies must be cleaned up on success");
        assert!(!server_dir.join("server.properties.pre-restore").exists());

        let _ = fs::remove_dir_all(&server_dir);
        let _ = fs::remove_dir_all(&backups_dir);
    }

    #[test]
    fn an_unsafe_level_name_falls_back_to_world_and_never_escapes_server_dir() {
        for (case, level_name) in [("abs", "/root"), ("dotdot", "../../etc"), ("nested", "a/b"), ("dot", ".")] {
            let base = temp_test_dir(&format!("level-name-{}", case));
            let server_dir = base.join("server");
            fs::create_dir_all(server_dir.join("world")).unwrap();
            fs::write(server_dir.join("server.properties"), format!("level-name={}\n", level_name)).unwrap();
            // Something an escaping level-name could otherwise reach.
            fs::create_dir_all(base.join("etc")).unwrap();

            let sources = backup_source_paths(&server_dir);
            for source in &sources {
                assert!(source.starts_with(&server_dir), "{:?} escaped server_dir for level-name {}", source, level_name);
            }
            assert!(sources.contains(&server_dir.join("world")), "level-name {} must fall back to world", level_name);

            let _ = fs::remove_dir_all(&base);
        }
    }

    #[test]
    fn a_corrupt_archive_leaves_the_current_world_untouched() {
        let server_dir = temp_test_dir("corrupt-server");
        let backups_dir = temp_test_dir("corrupt-backups");
        fs::write(server_dir.join("server.properties"), "level-name=world\n").unwrap();
        fs::create_dir_all(server_dir.join("world")).unwrap();
        fs::write(server_dir.join("world/level.dat"), "current world").unwrap();
        fs::write(backups_dir.join("1000.zip"), "this is not a zip archive").unwrap();

        assert!(restore_backup(&server_dir, &backups_dir, "1000.zip").is_err());
        assert_eq!(fs::read_to_string(server_dir.join("world/level.dat")).unwrap(), "current world");
        assert_eq!(fs::read_to_string(server_dir.join("server.properties")).unwrap(), "level-name=world\n");
        assert!(!server_dir.join("world.pre-restore").exists());

        // A structurally valid archive whose second entry fails its CRC check part way through
        // extraction: the first entry has already been written by then, so this exercises the
        // rollback path rather than the up-front open failure above.
        {
            let file = File::create(backups_dir.join("2000.zip")).unwrap();
            let mut writer = zip::ZipWriter::new(file);
            let stored = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
            writer.start_file("server.properties", stored).unwrap();
            writer.write_all(b"level-name=from_backup\n").unwrap();
            writer.start_file("world/level.dat", stored).unwrap();
            writer.write_all(b"BACKUP_PAYLOAD_BACKUP_PAYLOAD").unwrap();
            writer.finish().unwrap();
        }
        let mut bytes = fs::read(backups_dir.join("2000.zip")).unwrap();
        let needle = b"BACKUP_PAYLOAD_BACKUP_PAYLOAD";
        let at = bytes.windows(needle.len()).position(|w| w == needle).unwrap();
        bytes[at] = b'X';
        fs::write(backups_dir.join("2000.zip"), bytes).unwrap();
        fs::write(server_dir.join("world/extra.dat"), "current extra").unwrap();

        assert!(restore_backup(&server_dir, &backups_dir, "2000.zip").is_err());
        assert_eq!(fs::read_to_string(server_dir.join("world/level.dat")).unwrap(), "current world");
        assert_eq!(fs::read_to_string(server_dir.join("world/extra.dat")).unwrap(), "current extra");
        assert_eq!(fs::read_to_string(server_dir.join("server.properties")).unwrap(), "level-name=world\n");
        assert!(!server_dir.join("world.pre-restore").exists());
        assert!(!server_dir.join("server.properties.pre-restore").exists());

        let _ = fs::remove_dir_all(&server_dir);
        let _ = fs::remove_dir_all(&backups_dir);
    }

    #[test]
    fn a_leftover_pre_restore_copy_aborts_the_restore_without_touching_anything() {
        let server_dir = temp_test_dir("leftover-server");
        let backups_dir = temp_test_dir("leftover-backups");
        {
            let file = File::create(backups_dir.join("3000.zip")).unwrap();
            let mut writer = zip::ZipWriter::new(file);
            let options = zip::write::SimpleFileOptions::default();
            // server.properties comes first so it is moved aside before the world check fails,
            // which exercises putting an already moved entry back.
            writer.start_file("server.properties", options).unwrap();
            writer.write_all(b"level-name=from_backup\n").unwrap();
            writer.start_file("world/level.dat", options).unwrap();
            writer.write_all(b"backup world").unwrap();
            writer.start_file("whitelist.json", options).unwrap();
            writer.write_all(b"[\"from_backup\"]").unwrap();
            writer.finish().unwrap();
        }
        fs::write(server_dir.join("server.properties"), "level-name=world\n").unwrap();
        fs::create_dir_all(server_dir.join("world")).unwrap();
        fs::write(server_dir.join("world/level.dat"), "current world").unwrap();
        fs::write(server_dir.join("world/extra.dat"), "current extra").unwrap();
        // A previous restore left this behind; it may be the only good copy.
        fs::create_dir_all(server_dir.join("world.pre-restore")).unwrap();
        fs::write(server_dir.join("world.pre-restore/level.dat"), "left by an earlier restore").unwrap();

        let err = restore_backup(&server_dir, &backups_dir, "3000.zip").unwrap_err();
        assert!(err.contains("world.pre-restore"), "error must name the leftover copy: {}", err);

        assert_eq!(fs::read_to_string(server_dir.join("world/level.dat")).unwrap(), "current world");
        assert_eq!(fs::read_to_string(server_dir.join("world/extra.dat")).unwrap(), "current extra");
        assert_eq!(fs::read_to_string(server_dir.join("server.properties")).unwrap(), "level-name=world\n");
        assert_eq!(
            fs::read_to_string(server_dir.join("world.pre-restore/level.dat")).unwrap(),
            "left by an earlier restore"
        );
        assert!(!server_dir.join("server.properties.pre-restore").exists());
        assert!(!server_dir.join("whitelist.json").exists(), "nothing may be extracted");

        let _ = fs::remove_dir_all(&server_dir);
        let _ = fs::remove_dir_all(&backups_dir);
    }

    #[test]
    fn a_same_second_backup_collision_errors_instead_of_overwriting() {
        let server_dir = temp_test_dir("collision-server");
        let backups_dir = temp_test_dir("collision-backups");
        fs::create_dir_all(server_dir.join("world")).unwrap();
        fs::write(server_dir.join("world/level.dat"), "data").unwrap();
        fs::write(backups_dir.join("5000.zip"), "existing backup").unwrap();

        assert!(create_backup_at(&server_dir, &backups_dir, 5000).is_err());
        assert_eq!(fs::read_to_string(backups_dir.join("5000.zip")).unwrap(), "existing backup");
        assert!(!backups_dir.join("5000.zip.tmp").exists(), "no temp file may be left behind");

        let info = create_backup_at(&server_dir, &backups_dir, 6000).unwrap();
        assert_eq!(info.name, "6000.zip");
        assert!(backups_dir.join("6000.zip").is_file());
        assert!(!backups_dir.join("6000.zip.tmp").exists(), "the temp file must be renamed into place");

        let _ = fs::remove_dir_all(&server_dir);
        let _ = fs::remove_dir_all(&backups_dir);
    }

    #[test]
    fn listing_ignores_in_progress_temp_files() {
        let backups_dir = temp_test_dir("list-tmp");
        fs::write(backups_dir.join("1000.zip"), "done").unwrap();
        fs::write(backups_dir.join("2000.zip.tmp"), "half written").unwrap();

        let names: Vec<String> = list_backups(&backups_dir).into_iter().map(|b| b.name).collect();
        assert_eq!(names, vec!["1000.zip".to_string()]);

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
