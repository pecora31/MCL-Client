//! Forge and NeoForge support.
//!
//! Unlike Fabric, these have no meta API that hands back a ready launch profile: modern
//! versions ship an installer that patches the client jar through a chain of processors.
//! Reimplementing that chain means tracking their build tooling forever, so the official
//! installer is run once per profile in its headless client mode and the version profile
//! it leaves behind is read back.

use super::downloader::{download_files_concurrently, DownloadTask};
use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};

pub struct InstalledLoader {
    pub main_class: String,
    pub classpath: Vec<PathBuf>,
    pub jvm_args: Vec<String>,
    pub game_args: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct VersionProfile {
    #[serde(rename = "mainClass")]
    main_class: String,
    #[serde(default)]
    libraries: Vec<ProfileLibrary>,
    #[serde(default)]
    arguments: Option<ProfileArguments>,
}

#[derive(Debug, Deserialize)]
struct ProfileLibrary {
    name: String,
    #[serde(default)]
    downloads: Option<LibraryDownloads>,
}

#[derive(Debug, Deserialize)]
struct LibraryDownloads {
    #[serde(default)]
    artifact: Option<LibraryArtifact>,
}

#[derive(Debug, Deserialize)]
struct LibraryArtifact {
    #[serde(default)]
    path: Option<String>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    sha1: Option<String>,
    #[serde(default)]
    size: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct ProfileArguments {
    #[serde(default)]
    jvm: Vec<serde_json::Value>,
    #[serde(default)]
    game: Vec<serde_json::Value>,
}

/// The id the installer writes under `versions/`, which is how an already-installed
/// profile is detected without running the installer again.
pub fn version_id(loader: &str, game_version: &str, loader_version: &str) -> String {
    match loader {
        // 1.20.1 NeoForge ran through the classic Forge installer it forked from, which
        // writes the profile under Forge's own naming; only later versions use NeoForge's
        // own "neoforge-<version>" scheme. Verified against a real installer run: it
        // produced "1.20.1-forge-47.1.106", not "neoforge-47.1.106".
        "neoforge" if game_version != "1.20.1" => format!("neoforge-{}", loader_version),
        _ => format!("{}-forge-{}", game_version, loader_version),
    }
}

fn installer_url(loader: &str, game_version: &str, loader_version: &str) -> String {
    match loader {
        // 1.20.1 is the one Minecraft version NeoForge shipped before switching to its own
        // "neoforge" artifact and versioning: it started as a fork of Forge 47.x, published
        // under Forge's own coordinate and naming, and never moved once the split settled.
        "neoforge" if game_version == "1.20.1" => format!(
            "https://maven.neoforged.net/releases/net/neoforged/forge/{mc}-{v}/forge-{mc}-{v}-installer.jar",
            mc = game_version,
            v = loader_version
        ),
        "neoforge" => format!(
            "https://maven.neoforged.net/releases/net/neoforged/neoforge/{v}/neoforge-{v}-installer.jar",
            v = loader_version
        ),
        _ => format!(
            "https://maven.minecraftforge.net/net/minecraftforge/forge/{mc}-{v}/forge-{mc}-{v}-installer.jar",
            mc = game_version,
            v = loader_version
        ),
    }
}

/// Turns "group:artifact:version[:classifier]" into the path maven would store it at.
fn maven_coord_to_path(coord: &str) -> Option<PathBuf> {
    let parts: Vec<&str> = coord.split(':').collect();
    if parts.len() < 3 {
        return None;
    }
    let group = parts[0].replace('.', "/");
    let artifact = parts[1];
    // A version may carry an "@ext" suffix, e.g. "net.minecraftforge:forge:1.0:universal@zip"
    let (version, extension) = match parts[2].split_once('@') {
        Some((v, ext)) => (v, ext),
        None => (parts[2], "jar"),
    };
    let classifier = if parts.len() >= 4 {
        format!("-{}", parts[3].split('@').next().unwrap_or(parts[3]))
    } else {
        String::new()
    };

    // Maven orders this as artifact-version-classifier, which is also the layout the
    // Forge profile's own `path` fields use
    Some(
        PathBuf::from(group)
            .join(artifact)
            .join(version)
            .join(format!("{}-{}{}.{}", artifact, version, classifier, extension)),
    )
}

/// Replaces the placeholders the profile leaves in its arguments. Anything unknown is
/// left untouched so a missing substitution is visible in the log rather than silent.
fn substitute(argument: &str, libraries_dir: &Path, version_id: &str) -> String {
    let separator = if cfg!(target_os = "windows") { ";" } else { ":" };
    argument
        .replace("${library_directory}", &libraries_dir.to_string_lossy())
        .replace("${classpath_separator}", separator)
        .replace("${version_name}", version_id)
}

fn plain_strings(values: &[serde_json::Value]) -> Vec<&str> {
    // Conditional entries are objects carrying rules; those are for platforms and
    // features this launcher does not set, so only plain strings are taken.
    values.iter().filter_map(|v| v.as_str()).collect()
}

pub async fn install_and_resolve(
    app_handle: &AppHandle,
    loader: &str,
    game_version: &str,
    loader_version: &str,
    common_dir: &Path,
    libraries_dir: &Path,
) -> Result<InstalledLoader, String> {
    let id = version_id(loader, game_version, loader_version);
    let profile_path = common_dir.join("versions").join(&id).join(format!("{}.json", id));
    let display = if loader == "neoforge" { "NeoForge" } else { "Forge" };

    if !profile_path.exists() {
        run_installer(
            app_handle,
            loader,
            display,
            game_version,
            loader_version,
            common_dir,
        )
        .await?;
    }

    if !profile_path.exists() {
        return Err(format!(
            "The {} installer finished but left no profile for {} {}. \
             The version may not exist for Minecraft {}.",
            display, display, loader_version, game_version
        ));
    }

    let raw = fs::read_to_string(&profile_path)
        .map_err(|e| format!("Cannot read the {} profile: {}", display, e))?;
    let profile: VersionProfile = serde_json::from_str(&raw)
        .map_err(|e| format!("The {} profile could not be parsed: {}", display, e))?;

    // The installer already places most libraries; anything still missing that carries a
    // URL is fetched, and the rest is assumed to have been produced on disk by it.
    let mut classpath = Vec::new();
    let mut missing = Vec::new();
    for library in &profile.libraries {
        let relative = library
            .downloads
            .as_ref()
            .and_then(|d| d.artifact.as_ref())
            .and_then(|a| a.path.as_ref())
            .map(PathBuf::from)
            .or_else(|| maven_coord_to_path(&library.name));

        let Some(relative) = relative else { continue };
        let destination = libraries_dir.join(&relative);

        if !destination.exists() {
            if let Some(artifact) = library.downloads.as_ref().and_then(|d| d.artifact.as_ref()) {
                if let Some(url) = artifact.url.as_ref().filter(|u| !u.is_empty()) {
                    missing.push(DownloadTask {
                        url: url.clone(),
                        destination: destination.clone(),
                        size: artifact.size.unwrap_or(0),
                        sha1: artifact.sha1.clone(),
                    });
                }
            }
        }
        classpath.push(destination);
    }

    if !missing.is_empty() {
        download_files_concurrently(app_handle, "downloading", missing, 8, 60, 72).await?;
    }

    let (jvm_args, game_args) = match &profile.arguments {
        Some(arguments) => (
            plain_strings(&arguments.jvm)
                .iter()
                .map(|a| substitute(a, libraries_dir, &id))
                .collect(),
            plain_strings(&arguments.game)
                .iter()
                .map(|a| substitute(a, libraries_dir, &id))
                .collect(),
        ),
        None => (Vec::new(), Vec::new()),
    };

    Ok(InstalledLoader {
        main_class: profile.main_class,
        classpath,
        jvm_args,
        game_args,
    })
}

async fn run_installer(
    app_handle: &AppHandle,
    loader: &str,
    display: &str,
    game_version: &str,
    loader_version: &str,
    common_dir: &Path,
) -> Result<(), String> {
    let _ = app_handle.emit(
        "mc-log",
        format!(
            "[{}] [MCL] Running the {} installer for {} (first launch of this profile only)...",
            chrono::Local::now().format("%H:%M:%S"),
            display,
            loader_version
        ),
    );

    let url = installer_url(loader, game_version, loader_version);
    let installer_path = common_dir.join("installers").join(format!(
        "{}-{}-installer.jar",
        loader, loader_version
    ));
    fs::create_dir_all(installer_path.parent().unwrap()).map_err(|e| e.to_string())?;

    if !installer_path.exists() {
        let client = reqwest::Client::builder()
            .user_agent("MCLClient-Launcher/1.0")
            .build()
            .map_err(|e| e.to_string())?;
        let response = client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Cannot download the {} installer: {}", display, e))?;
        if !response.status().is_success() {
            return Err(format!(
                "{} {} is not available for Minecraft {} (server said HTTP {}).",
                display,
                loader_version,
                game_version,
                response.status().as_u16()
            ));
        }
        let bytes = response
            .bytes()
            .await
            .map_err(|e| format!("Cannot download the {} installer: {}", display, e))?;
        fs::write(&installer_path, &bytes)
            .map_err(|e| format!("Cannot save the {} installer: {}", display, e))?;
    }

    // The installer refuses to run without this file, even though this launcher never
    // reads it, so a stub is enough.
    let profiles_file = common_dir.join("launcher_profiles.json");
    if !profiles_file.exists() {
        fs::create_dir_all(common_dir).map_err(|e| e.to_string())?;
        fs::write(&profiles_file, r#"{"profiles":{},"version":3}"#)
            .map_err(|e| e.to_string())?;
    }

    let (java_bin, _, _) = crate::java_detector::find_best_java_for_version(game_version);
    let mut command = crate::hidden_process::hidden_command(&java_bin);
    command
        .arg("-jar")
        .arg(&installer_path)
        .arg("--installClient")
        .arg(common_dir);

    let output = command
        .output()
        .map_err(|e| format!("Cannot run the {} installer with {}: {}", display, java_bin, e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let tail: String = stderr.chars().rev().take(600).collect::<Vec<_>>().into_iter().rev().collect();
        return Err(format!(
            "The {} installer failed. {}",
            display,
            tail.trim()
        ));
    }

    let _ = app_handle.emit(
        "mc-log",
        format!(
            "[{}] [MCL] {} {} installed.",
            chrono::Local::now().format("%H:%M:%S"),
            display,
            loader_version
        ),
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn neoforge_1_20_1_uses_the_legacy_forge_coordinate_it_forked_from() {
        // NeoForge only ever published 1.20.1 under Forge's own "forge" artifact and
        // naming, inherited unchanged from the fork; verified against a real, currently
        // resolvable file at this exact URL.
        assert_eq!(
            installer_url("neoforge", "1.20.1", "47.1.106"),
            "https://maven.neoforged.net/releases/net/neoforged/forge/1.20.1-47.1.106/forge-1.20.1-47.1.106-installer.jar"
        );
    }

    #[test]
    fn neoforge_after_1_20_1_uses_its_own_artifact() {
        assert_eq!(
            installer_url("neoforge", "1.21.1", "21.1.250"),
            "https://maven.neoforged.net/releases/net/neoforged/neoforge/21.1.250/neoforge-21.1.250-installer.jar"
        );
    }

    #[test]
    fn neoforge_1_20_1_produces_the_id_the_real_installer_writes() {
        // Confirmed against a real installer run for this exact version: it wrote
        // "versions/1.20.1-forge-47.1.106/", not "versions/neoforge-47.1.106/".
        assert_eq!(version_id("neoforge", "1.20.1", "47.1.106"), "1.20.1-forge-47.1.106");
    }

    #[test]
    fn builds_version_ids_each_loader_uses() {
        assert_eq!(version_id("forge", "1.21.1", "52.1.0"), "1.21.1-forge-52.1.0");
        assert_eq!(version_id("neoforge", "1.21.1", "21.1.250"), "neoforge-21.1.250");
    }

    #[test]
    fn maps_maven_coordinates_to_paths() {
        assert_eq!(
            maven_coord_to_path("net.minecraftforge:forge:1.21.1-52.1.0").unwrap(),
            PathBuf::from("net/minecraftforge/forge/1.21.1-52.1.0/forge-1.21.1-52.1.0.jar")
        );
        // Checked against the path a real Forge 52.1.0 profile lists for this same
        // coordinate, which is where the original ordering here proved wrong
        assert_eq!(
            maven_coord_to_path("net.minecraftforge:forge:1.21.1-52.1.0:universal").unwrap(),
            PathBuf::from("net/minecraftforge/forge/1.21.1-52.1.0/forge-1.21.1-52.1.0-universal.jar")
        );
        assert_eq!(
            maven_coord_to_path("de.oceanlabs.mcp:mcp_config:1.21.1@zip").unwrap(),
            PathBuf::from("de/oceanlabs/mcp/mcp_config/1.21.1/mcp_config-1.21.1.zip")
        );
        assert!(maven_coord_to_path("not-a-coordinate").is_none());
    }

    #[test]
    fn substitutes_the_placeholders_forge_leaves_behind() {
        let libraries = Path::new("C:\\games\\libraries");
        let expanded = substitute("-DlibraryDirectory=${library_directory}", libraries, "1.21.1-forge-52.1.0");
        assert!(expanded.ends_with("libraries"));
        assert!(!expanded.contains("${"));

        let separator = substitute("a${classpath_separator}b", libraries, "x");
        assert_eq!(separator, if cfg!(target_os = "windows") { "a;b" } else { "a:b" });

        assert_eq!(
            substitute("--fml.forgeVersion=${version_name}", libraries, "neoforge-21.1.250"),
            "--fml.forgeVersion=neoforge-21.1.250"
        );
    }

    #[test]
    fn skips_conditional_argument_objects() {
        let values = vec![
            serde_json::json!("-Dfoo=bar"),
            serde_json::json!({ "rules": [], "value": "-Dconditional=1" }),
        ];
        assert_eq!(plain_strings(&values), vec!["-Dfoo=bar"]);
    }
}
