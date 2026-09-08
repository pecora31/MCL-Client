use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;
use tokio::sync::Semaphore;

pub static CANCEL_DOWNLOAD: AtomicBool = AtomicBool::new(false);

pub fn request_cancel() {
    CANCEL_DOWNLOAD.store(true, Ordering::Relaxed);
}

pub fn reset_cancel() {
    CANCEL_DOWNLOAD.store(false, Ordering::Relaxed);
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgressPayload {
    pub stage: String,
    pub percentage: u32,
    pub current_file: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub speed_bps: u64,
}

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct DownloadTask {
    pub url: String,
    pub destination: PathBuf,
    pub size: u64,
    pub sha1: Option<String>,
}

/// Verifies the SHA1 checksum of a local file
fn verify_file_sha1(path: &Path, expected_hex: &str) -> bool {
    let mut file = match fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return false,
    };
    let mut hasher = Sha1::new();
    let mut buffer = [0u8; 65536]; // 64KB buffer for high throughput
    loop {
        match std::io::Read::read(&mut file, &mut buffer) {
            Ok(0) => break,
            Ok(n) => hasher.update(&buffer[..n]),
            Err(_) => return false,
        }
    }
    let result = hasher.finalize();
    let computed = format!("{:x}", result);
    computed.eq_ignore_ascii_case(expected_hex.trim())
}

pub async fn download_files_concurrently(
    app_handle: &AppHandle,
    stage_name: &str,
    tasks: Vec<DownloadTask>,
    max_concurrent: usize,
    base_percent: u32,
    target_percent: u32,
) -> Result<(), String> {
    if tasks.is_empty() {
        return Ok(());
    }

    // HTTP Client with network timeouts
    let client = reqwest::Client::builder()
        .user_agent("MCLv2-Downloader/1.0")
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;

    // Filter tasks with smart SHA1 checksum & size caching
    let mut tasks_to_download = Vec::new();
    for task in tasks {
        if task.destination.exists() {
            if let Ok(metadata) = fs::metadata(&task.destination) {
                if let Some(expected_sha1) = &task.sha1 {
                    if verify_file_sha1(&task.destination, expected_sha1) {
                        continue; // Valid cached file
                    }
                    let _ = fs::remove_file(&task.destination); // Corrupted cache, remove to re-download
                } else if task.size > 0 {
                    if metadata.len() == task.size {
                        continue; // No SHA1, valid size match
                    }
                } else if metadata.len() > 0 {
                    // Fabric maven artifacts carry no size/sha1 metadata. Files only appear at the
                    // destination after an atomic rename, so any non-empty file here is complete.
                    continue;
                }
            }
        }
        tasks_to_download.push(task);
    }

    let total_files = tasks_to_download.len();
    if total_files == 0 {
        let _ = app_handle.emit(
            "download-progress",
            DownloadProgressPayload {
                stage: stage_name.to_string(),
                percentage: target_percent,
                current_file: "All files are already cached".to_string(),
                downloaded_bytes: 0,
                total_bytes: 0,
                speed_bps: 0,
            },
        );
        return Ok(());
    }

    let completed_count = Arc::new(AtomicU64::new(0));
    let downloaded_bytes = Arc::new(AtomicU64::new(0));
    let failed_count = Arc::new(AtomicU64::new(0));
    let total_bytes: u64 = tasks_to_download.iter().map(|t| t.size).sum();

    let semaphore = Arc::new(Semaphore::new(max_concurrent));
    let start_time = Instant::now();
    let stage_span = if target_percent > base_percent {
        (target_percent - base_percent) as f64
    } else {
        1.0
    };

    let mut handles = Vec::new();

    for task in tasks_to_download {
        if CANCEL_DOWNLOAD.load(Ordering::Relaxed) {
            return Err("Download cancelled by the user".to_string());
        }

        let permit = semaphore.clone().acquire_owned().await.unwrap();
        let client = client.clone();
        let app = app_handle.clone();
        let stage = stage_name.to_string();
        let completed = completed_count.clone();
        let downloaded = downloaded_bytes.clone();
        let failed = failed_count.clone();

        let handle = tokio::spawn(async move {
            let _permit = permit; // holds permit until task finishes

            if CANCEL_DOWNLOAD.load(Ordering::Relaxed) {
                return;
            }

            if let Some(parent) = task.destination.parent() {
                let _ = fs::create_dir_all(parent);
            }

            let file_name = task
                .destination
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("file")
                .to_string();

            // Temporary file path (.mclpart) for atomic write
            let part_path = PathBuf::from(format!("{}.mclpart", task.destination.display()));

            // Retry loop up to 3 attempts with backoff
            let mut download_succeeded = false;
            for attempt in 1..=3 {
                if CANCEL_DOWNLOAD.load(Ordering::Relaxed) {
                    break;
                }

                // If previous attempt left a part file, remove it
                if part_path.exists() {
                    let _ = tokio::fs::remove_file(&part_path).await;
                }

                let req = client.get(&task.url).send().await;
                match req {
                    Ok(mut response) if response.status().is_success() => {
                        let mut part_file = match tokio::fs::File::create(&part_path).await {
                            Ok(f) => f,
                            Err(_) => {
                                tokio::time::sleep(Duration::from_millis(300 * attempt)).await;
                                continue;
                            }
                        };

                        let mut stream_ok = true;
                        let mut task_bytes = 0u64;

                        while let Some(chunk_res) = response.chunk().await.ok().flatten() {
                            if CANCEL_DOWNLOAD.load(Ordering::Relaxed) {
                                stream_ok = false;
                                break;
                            }
                            if let Err(_) = part_file.write_all(&chunk_res).await {
                                stream_ok = false;
                                break;
                            }
                            let chunk_len = chunk_res.len() as u64;
                            task_bytes += chunk_len;
                            downloaded.fetch_add(chunk_len, Ordering::Relaxed);
                        }

                        let _ = part_file.flush().await;
                        drop(part_file);

                        if stream_ok && !CANCEL_DOWNLOAD.load(Ordering::Relaxed) {
                            // Check SHA1 if required
                            let sha1_valid = if let Some(expected_sha1) = &task.sha1 {
                                verify_file_sha1(&part_path, expected_sha1)
                            } else {
                                true
                            };

                            if sha1_valid {
                                // Atomic move part file to final destination
                                if tokio::fs::rename(&part_path, &task.destination).await.is_ok() {
                                    download_succeeded = true;
                                    break;
                                }
                            } else {
                                // SHA1 mismatch: rollback downloaded bytes count for this attempt
                                downloaded.fetch_sub(task_bytes, Ordering::Relaxed);
                                let _ = tokio::fs::remove_file(&part_path).await;
                            }
                        } else {
                            downloaded.fetch_sub(task_bytes, Ordering::Relaxed);
                        }
                    }
                    _ => {
                        // Network/HTTP error: wait before retry
                        tokio::time::sleep(Duration::from_millis(400 * attempt)).await;
                    }
                }
            }

            // Cleanup leftover part file if download failed
            if !download_succeeded {
                failed.fetch_add(1, Ordering::Relaxed);
                if part_path.exists() {
                    let _ = tokio::fs::remove_file(&part_path).await;
                }
            }

            let done = completed.fetch_add(1, Ordering::Relaxed) + 1;
            let ratio = (done as f64 / total_files as f64).min(1.0);
            let percent = (base_percent as f64 + ratio * stage_span).min(target_percent as f64) as u32;

            let elapsed_sec = start_time.elapsed().as_secs_f64().max(0.1);
            let current_downloaded = downloaded.load(Ordering::Relaxed);
            let speed = (current_downloaded as f64 / elapsed_sec) as u64;

            if !CANCEL_DOWNLOAD.load(Ordering::Relaxed) {
                let _ = app.emit(
                    "download-progress",
                    DownloadProgressPayload {
                        stage,
                        percentage: percent,
                        current_file: file_name,
                        downloaded_bytes: current_downloaded,
                        total_bytes,
                        speed_bps: speed,
                    },
                );
            }
        });

        handles.push(handle);
    }

    for handle in handles {
        let _ = handle.await;
    }

    if CANCEL_DOWNLOAD.load(Ordering::Relaxed) {
        return Err("Download cancelled".to_string());
    }

    let total_failed = failed_count.load(Ordering::Relaxed);
    if total_failed > 0 {
        // If critical percentage of files failed, notify or log
        let _ = app_handle.emit(
            "mc-log",
            format!(
                "[{}] [MCLv2/WARN] {} file(s) failed to download after 3 retries.",
                chrono::Local::now().format("%H:%M:%S"),
                total_failed
            ),
        );
    }

    Ok(())
}
