//! Downloads the Java runtime a Minecraft version needs into the launcher's own folder, so a
//! player never has to find and install Java themselves.
//!
//! Builds come from Eclipse Temurin (Adoptium): one zip per version with a published SHA-256,
//! free to download and redistribute. Each lands in `<data dir>/runtime/java-<major>`, which
//! the Java detector scans alongside the system's own installs.

use crate::instance_manager::get_launcher_dir;
use crate::java_detector::required_java_major;
use crate::minecraft_core::downloader::{DownloadProgressPayload, CANCEL_DOWNLOAD};
use crate::models::GameInstance;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;

pub fn runtime_root() -> PathBuf {
    get_launcher_dir().join("runtime")
}

fn runtime_dir(major: u32) -> PathBuf {
    runtime_root().join(format!("java-{}", major))
}

/// Runtime folders no profile would run on: a version no profile pins, needs for its Minecraft,
/// or points at by path — plus unpacks an interrupted download left half-finished. Removing one
/// is harmless: if it is ever needed again, the launcher downloads it again.
pub fn unused_runtime_dirs(instances: &[GameInstance]) -> Vec<PathBuf> {
    let needed: HashSet<u32> = instances
        .iter()
        .flat_map(|instance| [instance.java_version, Some(required_java_major(&instance.game_version))])
        .flatten()
        .collect();
    let Ok(entries) = fs::read_dir(runtime_root()) else {
        return Vec::new();
    };
    entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|dir| dir.is_dir())
        .filter(|dir| {
            let name = dir.file_name().and_then(|n| n.to_str()).unwrap_or("");
            let pointed_at = instances.iter().any(|instance| {
                instance
                    .java_path
                    .as_deref()
                    .is_some_and(|path| Path::new(path).starts_with(dir))
            });
            is_unused_runtime(name, &needed) && !pointed_at
        })
        .collect()
}

fn is_unused_runtime(folder: &str, needed: &HashSet<u32>) -> bool {
    match folder.strip_prefix("java-").and_then(|major| major.parse::<u32>().ok()) {
        Some(major) => !needed.contains(&major),
        None => folder.ends_with(".partial"),
    }
}

fn adoptium_platform() -> (&'static str, &'static str) {
    let os = if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "mac"
    } else {
        "linux"
    };
    let arch = if cfg!(target_arch = "aarch64") { "aarch64" } else { "x64" };
    (os, arch)
}

/// Downloads, verifies and unpacks Temurin `major`, returning the Java program to launch with.
pub async fn download_java(app: &AppHandle, major: u32) -> Result<PathBuf, String> {
    let client = reqwest::Client::builder()
        .user_agent("MCLClient-Launcher/1.0")
        .build()
        .map_err(|e| e.to_string())?;

    let (os, arch) = adoptium_platform();
    let assets: serde_json::Value = client
        .get(format!(
            "https://api.adoptium.net/v3/assets/latest/{}/hotspot?architecture={}&image_type=jre&os={}&vendor=eclipse",
            major, arch, os
        ))
        .send()
        .await
        .map_err(|e| format!("cannot reach Adoptium: {}", e))?
        .error_for_status()
        .map_err(|e| format!("Adoptium refused the request: {}", e))?
        .json()
        .await
        .map_err(|e| format!("unexpected answer from Adoptium: {}", e))?;

    // Only zip archives are unpacked here, which is what Adoptium ships for Windows
    let package = assets
        .as_array()
        .into_iter()
        .flatten()
        .map(|asset| &asset["binary"]["package"])
        .find(|package| package["name"].as_str().is_some_and(|name| name.ends_with(".zip")))
        .ok_or_else(|| format!("Adoptium has no Java {} package for this computer", major))?;
    let link = package["link"]
        .as_str()
        .ok_or("Adoptium listed the package without a download link")?;
    let checksum = package["checksum"]
        .as_str()
        .ok_or("Adoptium listed the package without a checksum")?;

    fs::create_dir_all(runtime_root()).map_err(|e| e.to_string())?;
    let archive = runtime_root().join(format!("java-{}.zip.part", major));

    let mut response = client
        .get(link)
        .send()
        .await
        .map_err(|e| format!("download failed: {}", e))?
        .error_for_status()
        .map_err(|e| format!("download failed: {}", e))?;
    let total = response
        .content_length()
        .or_else(|| package["size"].as_u64())
        .unwrap_or(0);

    let mut file = tokio::fs::File::create(&archive)
        .await
        .map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut downloaded = 0u64;
    let started = Instant::now();
    let mut last_report = Instant::now();

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("download interrupted: {}", e))?
    {
        if CANCEL_DOWNLOAD.load(Ordering::Relaxed) {
            drop(file);
            let _ = fs::remove_file(&archive);
            return Err("download cancelled".to_string());
        }
        hasher.update(&chunk);
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        if last_report.elapsed() >= Duration::from_millis(250) {
            last_report = Instant::now();
            report_progress(app, major, downloaded, total, started);
        }
    }
    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);

    if !format!("{:x}", hasher.finalize()).eq_ignore_ascii_case(checksum) {
        let _ = fs::remove_file(&archive);
        return Err("the download was damaged on the way (checksum mismatch), try again".to_string());
    }

    let target = runtime_dir(major);
    let unpack_from = archive.clone();
    let unpack_into = target.clone();
    tokio::task::spawn_blocking(move || unpack_runtime(&unpack_from, &unpack_into))
        .await
        .map_err(|e| e.to_string())??;
    let _ = fs::remove_file(&archive);

    let exe = target
        .join("bin")
        .join(if cfg!(windows) { "javaw.exe" } else { "java" });
    if exe.exists() {
        Ok(exe)
    } else {
        Err("the download did not contain a Java program".to_string())
    }
}

fn report_progress(app: &AppHandle, major: u32, downloaded: u64, total: u64, started: Instant) {
    let seconds = started.elapsed().as_secs_f64().max(0.001);
    let _ = app.emit(
        "download-progress",
        DownloadProgressPayload {
            stage: "downloading".to_string(),
            // Java is settled before any game file, so its download gets the first stretch of
            // the bar (5-20%); the game's own downloads carry on from there.
            percentage: 5 + (15 * downloaded / total.max(1)).min(15) as u32,
            current_file: format!(
                "Java {} ({} / {} MB)",
                major,
                downloaded / 1_048_576,
                total / 1_048_576
            ),
            downloaded_bytes: downloaded,
            total_bytes: total,
            speed_bps: (downloaded as f64 / seconds) as u64,
        },
    );
}

/// Temurin archives hold one top-level folder (e.g. `jdk-21.0.12+1-jre`). It is unpacked beside
/// the target and renamed into place, so a half-finished unpack never looks like a usable
/// runtime to the Java detector.
fn unpack_runtime(archive: &Path, target: &Path) -> Result<(), String> {
    let staging = target.with_extension("partial");
    let _ = fs::remove_dir_all(&staging);
    fs::create_dir_all(&staging).map_err(|e| e.to_string())?;

    let file = fs::File::open(archive).map_err(|e| e.to_string())?;
    zip::ZipArchive::new(file)
        .and_then(|mut zip| zip.extract(&staging))
        .map_err(|e| format!("could not unpack Java: {}", e))?;

    let home = fs::read_dir(&staging)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .find(|path| path.join("bin").is_dir())
        .ok_or("the archive has no Java folder in it")?;

    let _ = fs::remove_dir_all(target);
    fs::rename(&home, target).map_err(|e| e.to_string())?;
    let _ = fs::remove_dir_all(&staging);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{is_unused_runtime, unpack_runtime};
    use std::collections::HashSet;
    use std::io::Write;

    #[test]
    fn keeps_runtimes_a_profile_needs_and_flags_the_rest() {
        let needed: HashSet<u32> = [8, 21].into_iter().collect();
        assert!(!is_unused_runtime("java-21", &needed));
        assert!(!is_unused_runtime("java-8", &needed));
        assert!(is_unused_runtime("java-25", &needed));
        assert!(is_unused_runtime("java-21.partial", &needed), "an unfinished unpack is never used");
        assert!(!is_unused_runtime("something-else", &needed), "folders the launcher did not make are left alone");
    }

    #[test]
    fn unpacks_the_archive_folder_into_place() {
        let dir = std::env::temp_dir().join(format!("mcl-java-unpack-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let archive = dir.join("jre.zip");
        {
            let mut zip = zip::ZipWriter::new(std::fs::File::create(&archive).unwrap());
            let options = zip::write::SimpleFileOptions::default();
            zip.start_file("jdk-21.0.12+1-jre/bin/javaw.exe", options).unwrap();
            zip.write_all(b"not really java").unwrap();
            zip.start_file("jdk-21.0.12+1-jre/release", options).unwrap();
            zip.write_all(b"JAVA_VERSION=\"21\"").unwrap();
            zip.finish().unwrap();
        }

        let target = dir.join("java-21");
        unpack_runtime(&archive, &target).unwrap();

        assert!(target.join("bin").join("javaw.exe").is_file());
        assert!(target.join("release").is_file());
        assert!(!dir.join("java-21.partial").exists(), "the staging folder must not be left behind");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
