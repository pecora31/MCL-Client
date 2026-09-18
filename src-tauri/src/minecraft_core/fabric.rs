use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FabricLoaderResponse {
    pub loader: FabricLoaderInfo,
    pub intermediary: FabricIntermediaryInfo,
    #[serde(rename = "launcherMeta")]
    pub launcher_meta: FabricLauncherMeta,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FabricLoaderInfo {
    pub version: String,
    pub maven: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FabricIntermediaryInfo {
    pub maven: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FabricLauncherMeta {
    #[serde(rename = "mainClass")]
    pub main_class: FabricMainClass,
    pub libraries: FabricLibraries,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FabricMainClass {
    pub client: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FabricLibraries {
    pub client: Vec<FabricMavenLibrary>,
    pub common: Vec<FabricMavenLibrary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FabricMavenLibrary {
    pub name: String,
    pub url: String,
}

/// Quilt is a fork of Fabric and its meta API returns the same shape, so both loaders
/// share one code path and differ only in these addresses.
pub struct LoaderEndpoints {
    pub meta_root: &'static str,
    pub maven_root: &'static str,
    pub display_name: &'static str,
}

pub fn loader_endpoints(loader: &str) -> Option<LoaderEndpoints> {
    match loader {
        "fabric" => Some(LoaderEndpoints {
            meta_root: "https://meta.fabricmc.net/v2",
            maven_root: "https://maven.fabricmc.net",
            display_name: "Fabric",
        }),
        "quilt" => Some(LoaderEndpoints {
            meta_root: "https://meta.quiltmc.org/v3",
            maven_root: "https://maven.quiltmc.org/repository/release",
            display_name: "Quilt",
        }),
        _ => None,
    }
}

/// How many times a request-level failure (DNS hiccup, TLS reset, connection refused mid-handshake)
/// is retried before giving up. A single such blip used to fail the whole launch outright —
/// `reqwest::Client::new()` has no timeout at all by default, so a stalled connection could also
/// hang indefinitely instead of failing fast enough to retry.
const META_FETCH_ATTEMPTS: u32 = 3;
const META_FETCH_TIMEOUT: Duration = Duration::from_secs(15);

pub async fn get_loader_meta(
    endpoints: &LoaderEndpoints,
    game_version: &str,
    loader_version: &str,
) -> Result<FabricLoaderResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(META_FETCH_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!(
        "{}/versions/loader/{}/{}",
        endpoints.meta_root, game_version, loader_version
    );

    let mut last_err = String::new();
    for attempt in 1..=META_FETCH_ATTEMPTS {
        match client.get(&url).send().await {
            Ok(resp) => {
                // A non-2xx here almost always means the loader/game version pairing itself is
                // bad (most often a pre-release loader build the project has since pruned from
                // its meta service) rather than a network problem, so this is never retried —
                // the body is the exact reason, a plain JSON string like
                // `"no loader version found for 0.20.0-beta.9"`, and is worth surfacing over the
                // opaque "failed to parse" a struct-shaped deserialize would report instead.
                if !resp.status().is_success() {
                    let body = resp.text().await.unwrap_or_default();
                    let reason = serde_json::from_str::<String>(&body).unwrap_or(body);
                    return Err(format!(
                        "{} loader {} isn't available for Minecraft {} ({} said: {}). Pick a different loader version.",
                        endpoints.display_name, loader_version, game_version, endpoints.display_name, reason
                    ));
                }
                return resp
                    .json::<FabricLoaderResponse>()
                    .await
                    .map_err(|e| format!("Failed to parse {} meta: {}", endpoints.display_name, e));
            }
            Err(e) => {
                last_err = e.to_string();
                if attempt < META_FETCH_ATTEMPTS {
                    tokio::time::sleep(Duration::from_millis(500 * attempt as u64)).await;
                }
            }
        }
    }

    Err(format!(
        "{} meta API failed after {} attempts: {}",
        endpoints.display_name, META_FETCH_ATTEMPTS, last_err
    ))
}

// Converts maven coordinate "net.fabricmc:fabric-loader:0.16.10" into path and URL
pub fn parse_maven_coord(
    base_url: &str,
    libraries_dir: &Path,
    coord: &str,
) -> Option<(PathBuf, String)> {
    let parts: Vec<&str> = coord.split(':').collect();
    if parts.len() < 3 {
        return None;
    }

    let group = parts[0].replace('.', "/");
    let artifact = parts[1];
    let version = parts[2];
    let classifier = if parts.len() >= 4 { format!("-{}", parts[3]) } else { "".to_string() };

    let file_name = format!("{}{}-{}.jar", artifact, classifier, version);
    let rel_path = PathBuf::from(&group).join(artifact).join(version).join(&file_name);
    let dest = libraries_dir.join(&rel_path);

    let mut clean_base = base_url.to_string();
    if !clean_base.ends_with('/') {
        clean_base.push('/');
    }

    let url = format!("{}{}/{}/{}/{}", clean_base, group, artifact, version, file_name);
    Some((dest, url))
}
