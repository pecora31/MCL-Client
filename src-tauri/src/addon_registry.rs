//! Records which file each installed addon came from.
//!
//! Two things need this. Replacing a mod has to delete the previous jar, or the game loads
//! both and crashes on a duplicate mod id. And sharing a profile needs to say where each
//! mod came from, which a file name alone cannot.
//!
//! The first version of this file was a flat map of project id to file name, written only
//! for Modrinth installs. That shape is still read and converted, so upgrading does not
//! lose what an existing profile already tracked.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

const CURRENT_VERSION: u32 = 2;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AddonRecord {
    /// "modrinth" or "curseforge".
    pub source: String,
    pub project_id: String,
    /// The exact file chosen. Absent for records carried over from the first format, and
    /// for sources that do not expose one.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub version_id: Option<String>,
    pub file_name: String,
    /// mods, resourcepacks, shaderpacks, datapacks...
    pub addon_type: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AddonRegistry {
    /// Keyed by "source:projectId" so the same id on two platforms stays distinct.
    #[serde(default)]
    pub addons: BTreeMap<String, AddonRecord>,
}

pub fn registry_key(source: &str, project_id: &str) -> String {
    format!("{}:{}", source, project_id)
}

fn registry_path(instance_dir: &std::path::Path) -> PathBuf {
    instance_dir.join(".mcl-addons.json")
}

/// Reads either format. An unreadable or corrupt file yields an empty registry rather than
/// an error: losing the record costs a duplicate jar, while failing the install costs the
/// mod entirely.
pub fn read(instance_dir: &std::path::Path) -> AddonRegistry {
    let Ok(raw) = fs::read_to_string(registry_path(instance_dir)) else {
        return AddonRegistry::default();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return AddonRegistry::default();
    };

    if value.get("addons").is_some() {
        return serde_json::from_value(value).unwrap_or_default();
    }

    // First format: { "<projectId>": "<fileName>" }, only ever written for Modrinth.
    let mut registry = AddonRegistry::default();
    if let Some(map) = value.as_object() {
        for (project_id, file_name) in map {
            let Some(file_name) = file_name.as_str() else { continue };
            registry.addons.insert(
                registry_key("modrinth", project_id),
                AddonRecord {
                    source: "modrinth".to_string(),
                    project_id: project_id.clone(),
                    version_id: None,
                    file_name: file_name.to_string(),
                    // Everything the old format tracked was installed as a mod.
                    addon_type: "mods".to_string(),
                },
            );
        }
    }
    registry
}

pub fn write(instance_dir: &std::path::Path, registry: &AddonRegistry) -> Result<(), String> {
    let mut document = serde_json::to_value(registry).map_err(|e| e.to_string())?;
    if let Some(object) = document.as_object_mut() {
        object.insert("version".to_string(), serde_json::json!(CURRENT_VERSION));
    }
    let serialized = serde_json::to_string_pretty(&document).map_err(|e| e.to_string())?;
    fs::write(registry_path(instance_dir), serialized).map_err(|e| e.to_string())
}

/// What a profile hands to the share service. Only references — which mod, from which
/// platform, at which version — never the files themselves: the importing launcher fetches
/// those the same way a manual install would, so nothing is ever redistributed here.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareManifest {
    pub name: String,
    pub game_version: String,
    pub loader: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub loader_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_ram: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_ram: Option<u32>,
    pub addons: Vec<SharedAddon>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedAddon {
    pub source: String,
    pub project_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version_id: Option<String>,
    pub addon_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_name: Option<String>,
}

/// Builds the manifest for a profile.
///
/// Only addons the registry knows the origin of are included. A jar dropped into the folder
/// by hand has no project behind it, so the importing launcher would have nowhere to fetch
/// it from; those are reported separately rather than silently dropped.
pub fn build_manifest(
    instance: &crate::models::GameInstance,
    instance_dir: &std::path::Path,
) -> (ShareManifest, Vec<String>) {
    let registry = read(instance_dir);

    let mut addons = Vec::new();
    let mut tracked_files = std::collections::HashSet::new();
    for record in registry.addons.values() {
        tracked_files.insert(record.file_name.clone());
        addons.push(SharedAddon {
            source: record.source.clone(),
            project_id: record.project_id.clone(),
            version_id: record.version_id.clone(),
            addon_type: record.addon_type.clone(),
            file_name: Some(record.file_name.clone()),
        });
    }

    let mut untracked = Vec::new();
    for folder in ["mods", "resourcepacks", "shaderpacks", "datapacks"] {
        let Ok(entries) = fs::read_dir(instance_dir.join(folder)) else { continue };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            // A disabled file is not part of what the profile actually runs.
            if name.ends_with(".disabled") {
                continue;
            }
            if !tracked_files.contains(&name) {
                untracked.push(name);
            }
        }
    }
    untracked.sort();

    let manifest = ShareManifest {
        name: instance.name.clone(),
        game_version: instance.game_version.clone(),
        loader: instance.loader.clone(),
        loader_version: instance.loader_version.clone(),
        min_ram: Some(instance.min_ram),
        max_ram: Some(instance.max_ram),
        addons,
    };
    (manifest, untracked)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mcl-registry-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn reads_back_what_it_wrote() {
        let dir = temp_dir();
        let mut registry = AddonRegistry::default();
        registry.addons.insert(
            registry_key("curseforge", "238222"),
            AddonRecord {
                source: "curseforge".to_string(),
                project_id: "238222".to_string(),
                version_id: Some("5678".to_string()),
                file_name: "jei.jar".to_string(),
                addon_type: "mods".to_string(),
            },
        );
        write(&dir, &registry).unwrap();

        let loaded = read(&dir);
        assert_eq!(loaded.addons.len(), 1);
        assert_eq!(
            loaded.addons.get("curseforge:238222").unwrap().version_id,
            Some("5678".to_string())
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn converts_the_first_format_instead_of_discarding_it() {
        let dir = temp_dir();
        fs::write(
            registry_path(&dir),
            r#"{"AANobbMI":"sodium-0.6.9.jar","P7dR8mSH":"fabric-api.jar"}"#,
        )
        .unwrap();

        let loaded = read(&dir);
        assert_eq!(loaded.addons.len(), 2);
        let record = loaded.addons.get("modrinth:AANobbMI").unwrap();
        assert_eq!(record.source, "modrinth");
        assert_eq!(record.file_name, "sodium-0.6.9.jar");
        assert_eq!(record.addon_type, "mods");
        assert_eq!(record.version_id, None);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn keeps_the_same_project_id_from_two_platforms_apart() {
        let mut registry = AddonRegistry::default();
        for source in ["modrinth", "curseforge"] {
            registry.addons.insert(
                registry_key(source, "12345"),
                AddonRecord {
                    source: source.to_string(),
                    project_id: "12345".to_string(),
                    version_id: None,
                    file_name: format!("{}.jar", source),
                    addon_type: "mods".to_string(),
                },
            );
        }
        assert_eq!(registry.addons.len(), 2);
    }

    #[test]
    fn treats_a_corrupt_file_as_empty_rather_than_failing() {
        let dir = temp_dir();
        fs::write(registry_path(&dir), "{not json").unwrap();
        assert!(read(&dir).addons.is_empty());
        fs::remove_dir_all(&dir).ok();
    }
}
