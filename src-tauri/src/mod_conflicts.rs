//! Reads what mods declare about each other and reports trouble before launching.
//!
//! Every loader already records incompatibilities in its own metadata file: Fabric and Quilt
//! in JSON, Forge and NeoForge in TOML. The game only acts on these once it is already
//! starting, which turns a knowable problem into a crash log. This reads the same
//! declarations up front.
//!
//! Only what the mods themselves declare is reported. No attempt is made to guess at
//! conflicts from bytecode or from what usually goes wrong together, because a warning that
//! is sometimes wrong is one players learn to click past.

use crate::instance_manager::get_instance_dir;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek};
use std::path::Path;

/// Provided by the loader or the game itself, so a mod depending on one of these is not
/// missing anything the launcher could install.
const ENVIRONMENT_IDS: &[&str] = &[
    "minecraft",
    "java",
    "fabricloader",
    "fabric-loader",
    "quilt_loader",
    "quilt_base",
    "forge",
    "neoforge",
    "fml",
    "mcp",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModConflict {
    /// "breaks" is a declared crash, "conflicts" a declared misbehaviour, "missing" an
    /// unsatisfied required dependency.
    pub kind: String,
    pub source_name: String,
    pub target_id: String,
    /// The other mod's display name when it is installed, otherwise just its id.
    pub target_name: String,
    pub file_name: String,
}

/// One declaration of the form "mod X, in versions matching this range".
#[derive(Debug, Clone)]
struct Requirement {
    id: String,
    range: serde_json::Value,
}

impl Requirement {
    fn any(id: &str) -> Self {
        Self {
            id: id.to_string(),
            range: serde_json::Value::String("*".to_string()),
        }
    }
}

#[derive(Debug, Clone)]
struct ModMetadata {
    id: String,
    name: String,
    file_name: String,
    /// Absent when the manifest leaves a build placeholder in place of a real version.
    version: Option<String>,
    breaks: Vec<Requirement>,
    conflicts: Vec<Requirement>,
    depends: Vec<Requirement>,
    /// Ids this jar satisfies besides its own: aliases it declares, plus every mod bundled
    /// inside it. Without these, a mod that ships its own libraries looks like it is
    /// missing them.
    provides: Vec<String>,
}

/// Splits a version into comparable numeric parts.
///
/// Everything from a "+" onwards is build metadata and is dropped, so "0.8.13+mc1.21.1"
/// becomes [0, 8, 13]: which Minecraft a jar was built against says nothing about ordering
/// between releases of the mod itself. A "-" is kept, because schemes like "1.21-4.5" put
/// meaningful numbers after it.
fn numeric_parts(version: &str) -> Vec<u64> {
    version
        .split('+')
        .next()
        .unwrap_or(version)
        .split(|c: char| !c.is_ascii_digit())
        .filter(|part| !part.is_empty())
        .filter_map(|part| part.parse::<u64>().ok())
        .collect()
}

fn compare_versions(left: &str, right: &str) -> std::cmp::Ordering {
    let (a, b) = (numeric_parts(left), numeric_parts(right));
    // A missing component counts as zero, so "5.2" and "5.2.0" compare equal.
    for index in 0..a.len().max(b.len()) {
        let ordering = a.get(index).unwrap_or(&0).cmp(b.get(index).unwrap_or(&0));
        if ordering != std::cmp::Ordering::Equal {
            return ordering;
        }
    }
    std::cmp::Ordering::Equal
}

/// Answers whether `version` falls inside `range`, or `None` when the range is in a form
/// this does not understand.
///
/// `None` matters: a declaration that cannot be evaluated is passed over rather than
/// guessed at, because a warning that fires on a working setup is one players learn to
/// ignore, and then the real ones go unread too.
fn version_satisfies(version: Option<&str>, range: &str) -> Option<bool> {
    let range = range.trim();
    if range.is_empty() || range == "*" {
        return Some(true);
    }

    // Without the other mod's version nothing narrower than "*" can be judged.
    let version = version?;

    if let Some(rest) = range.strip_prefix(">=") {
        return Some(compare_versions(version, rest.trim()).is_ge());
    }
    if let Some(rest) = range.strip_prefix("<=") {
        return Some(compare_versions(version, rest.trim()).is_le());
    }
    if let Some(rest) = range.strip_prefix('>') {
        return Some(compare_versions(version, rest.trim()).is_gt());
    }
    if let Some(rest) = range.strip_prefix('<') {
        return Some(compare_versions(version, rest.trim()).is_lt());
    }
    if let Some(rest) = range.strip_prefix('=') {
        return Some(compare_versions(version, rest.trim()).is_eq());
    }

    // Maven ranges, which is what Forge and NeoForge write: [1.0,2.0) and friends.
    if (range.starts_with('[') || range.starts_with('(')) && (range.ends_with(']') || range.ends_with(')')) {
        let inclusive_low = range.starts_with('[');
        let inclusive_high = range.ends_with(']');
        let inner = &range[1..range.len() - 1];
        let (low, high) = inner.split_once(',')?;
        let (low, high) = (low.trim(), high.trim());

        if !low.is_empty() {
            let ordering = compare_versions(version, low);
            if ordering.is_lt() || (!inclusive_low && ordering.is_eq()) {
                return Some(false);
            }
        }
        if !high.is_empty() {
            let ordering = compare_versions(version, high);
            if ordering.is_gt() || (!inclusive_high && ordering.is_eq()) {
                return Some(false);
            }
        }
        return Some(true);
    }

    // A bare version means exactly that version.
    if range.chars().next().is_some_and(|c| c.is_ascii_digit()) {
        return Some(compare_versions(version, range).is_eq());
    }

    // Caret, tilde, unions and anything else: not evaluated, so not reported.
    None
}

/// A range may be written as one string or as a list of alternatives, and a match against
/// any of them counts.
fn range_matches(version: Option<&str>, declared: &serde_json::Value) -> Option<bool> {
    match declared {
        serde_json::Value::String(range) => version_satisfies(version, range),
        serde_json::Value::Array(ranges) => {
            let mut any_understood = false;
            for entry in ranges {
                match range_matches(version, entry) {
                    Some(true) => return Some(true),
                    Some(false) => any_understood = true,
                    None => {}
                }
            }
            if any_understood {
                Some(false)
            } else {
                None
            }
        }
        _ => None,
    }
}

// ---------------------------------------------------------------------------------------
// Fabric and Quilt
// ---------------------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct FabricModJson {
    id: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    version: Option<String>,
    /// Both are objects of id -> version range, not lists.
    #[serde(default)]
    depends: HashMap<String, serde_json::Value>,
    #[serde(default)]
    breaks: HashMap<String, serde_json::Value>,
    #[serde(default)]
    conflicts: HashMap<String, serde_json::Value>,
    /// Ids this mod answers to besides its own.
    #[serde(default)]
    provides: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct QuiltModJson {
    quilt_loader: QuiltLoaderSection,
}

#[derive(Debug, Deserialize)]
struct QuiltLoaderSection {
    id: String,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    metadata: Option<QuiltMetadata>,
    #[serde(default)]
    depends: Vec<serde_json::Value>,
    #[serde(default)]
    breaks: Vec<serde_json::Value>,
    #[serde(default)]
    provides: Vec<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct QuiltMetadata {
    #[serde(default)]
    name: Option<String>,
}

/// Quilt writes its ranges under "versions" on the same object as the id.
fn quilt_requirements(entries: &[serde_json::Value]) -> Vec<Requirement> {
    entries
        .iter()
        .filter_map(|entry| match entry {
            serde_json::Value::String(id) => Some(Requirement::any(id)),
            serde_json::Value::Object(map) => map.get("id").and_then(|v| v.as_str()).map(|id| Requirement {
                id: id.to_string(),
                range: map
                    .get("versions")
                    .cloned()
                    .unwrap_or(serde_json::Value::String("*".to_string())),
            }),
            _ => None,
        })
        .collect()
}

/// Quilt allows either a bare id or an object carrying one.
fn quilt_ids(entries: &[serde_json::Value]) -> Vec<String> {
    entries
        .iter()
        .filter_map(|entry| match entry {
            serde_json::Value::String(id) => Some(id.clone()),
            serde_json::Value::Object(map) => {
                map.get("id").and_then(|v| v.as_str()).map(str::to_string)
            }
            _ => None,
        })
        .collect()
}

// ---------------------------------------------------------------------------------------
// Forge and NeoForge
// ---------------------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct ModsToml {
    #[serde(default)]
    mods: Vec<ForgeModEntry>,
    /// Keyed by the mod id the dependencies belong to.
    #[serde(default)]
    dependencies: HashMap<String, Vec<ForgeDependency>>,
}

#[derive(Debug, Deserialize)]
struct ForgeModEntry {
    #[serde(rename = "modId")]
    mod_id: String,
    #[serde(rename = "displayName", default)]
    display_name: Option<String>,
    #[serde(default)]
    version: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ForgeDependency {
    #[serde(rename = "modId")]
    mod_id: String,
    /// Current Forge and NeoForge use this; "incompatible" and "discouraged" are the two
    /// that matter here.
    #[serde(rename = "type", default)]
    dependency_type: Option<String>,
    /// What Forge used before `type` existed. Absent means optional.
    #[serde(default)]
    mandatory: Option<bool>,
    /// A maven range; empty or absent means any version.
    #[serde(rename = "versionRange", default)]
    version_range: Option<String>,
}

// ---------------------------------------------------------------------------------------

fn read_zip_entry<R: Read + Seek>(archive: &mut zip::ZipArchive<R>, name: &str) -> Option<String> {
    let mut file = archive.by_name(name).ok()?;
    let mut contents = String::new();
    file.read_to_string(&mut contents).ok()?;
    Some(contents)
}

fn parse_forge(raw: &str, file_name: &str) -> Option<ModMetadata> {
    let parsed: ModsToml = toml::from_str(raw).ok()?;
    let entry = parsed.mods.first()?;

    let mut breaks = Vec::new();
    let mut conflicts = Vec::new();
    let mut depends = Vec::new();

    // Dependencies are declared per mod id; a jar shipping several mods still only reports
    // under the first, which is the one named in the warning.
    for dependency in parsed.dependencies.values().flatten() {
        let requirement = Requirement {
            id: dependency.mod_id.clone(),
            range: serde_json::Value::String(
                dependency
                    .version_range
                    .clone()
                    .filter(|r| !r.trim().is_empty())
                    .unwrap_or_else(|| "*".to_string()),
            ),
        };
        match dependency.dependency_type.as_deref() {
            Some("incompatible") => breaks.push(requirement),
            Some("discouraged") => conflicts.push(requirement),
            Some("required") => depends.push(requirement),
            Some("optional") => {}
            // Pre-`type` files: mandatory=true meant required.
            _ => {
                if dependency.mandatory == Some(true) {
                    depends.push(requirement);
                }
            }
        }
    }

    Some(ModMetadata {
        id: entry.mod_id.clone(),
        name: entry
            .display_name
            .clone()
            .unwrap_or_else(|| entry.mod_id.clone()),
        file_name: file_name.to_string(),
        version: clean_version(entry.version.clone()),
        breaks,
        conflicts,
        depends,
        provides: Vec::new(),
    })
}

fn requirements(declared: HashMap<String, serde_json::Value>) -> Vec<Requirement> {
    declared
        .into_iter()
        .map(|(id, range)| Requirement { id, range })
        .collect()
}

fn parse_fabric(raw: &str, file_name: &str) -> Option<ModMetadata> {
    let parsed: FabricModJson = serde_json::from_str(raw).ok()?;
    Some(ModMetadata {
        name: parsed.name.clone().unwrap_or_else(|| parsed.id.clone()),
        id: parsed.id,
        file_name: file_name.to_string(),
        version: clean_version(parsed.version),
        breaks: requirements(parsed.breaks),
        conflicts: requirements(parsed.conflicts),
        depends: requirements(parsed.depends),
        provides: parsed.provides,
    })
}

/// Build systems leave placeholders like "${file.jarVersion}" behind when a jar is built
/// outside their pipeline. Those are not versions and must not be compared as if they were.
fn clean_version(version: Option<String>) -> Option<String> {
    version.filter(|v| !v.contains("${") && v.chars().any(|c| c.is_ascii_digit()))
}

fn parse_quilt(raw: &str, file_name: &str) -> Option<ModMetadata> {
    let parsed: QuiltModJson = serde_json::from_str(raw).ok()?;
    let loader = parsed.quilt_loader;
    Some(ModMetadata {
        name: loader
            .metadata
            .as_ref()
            .and_then(|m| m.name.clone())
            .unwrap_or_else(|| loader.id.clone()),
        id: loader.id,
        file_name: file_name.to_string(),
        version: clean_version(loader.version.clone()),
        breaks: quilt_requirements(&loader.breaks),
        conflicts: Vec::new(),
        depends: quilt_requirements(&loader.depends),
        provides: quilt_ids(&loader.provides),
    })
}

/// Mods routinely ship their libraries inside themselves — Fabric under `META-INF/jars/`,
/// Forge and NeoForge under `META-INF/jarjar/`. Those bundled mods load exactly like
/// separately installed ones, so their ids have to count as present or every mod that
/// bundles a dependency looks like it is missing one.
///
/// Bundled jars can bundle further jars, hence the depth limit rather than plain recursion
/// on trust.
const MAX_NESTING_DEPTH: u8 = 3;

fn collect_bundled_ids<R: Read + Seek>(archive: &mut zip::ZipArchive<R>, depth: u8) -> Vec<String> {
    if depth >= MAX_NESTING_DEPTH {
        return Vec::new();
    }

    let nested_paths: Vec<String> = archive
        .file_names()
        .filter(|name| {
            name.ends_with(".jar")
                && (name.starts_with("META-INF/jars/") || name.starts_with("META-INF/jarjar/"))
        })
        .map(str::to_string)
        .collect();

    let mut ids = Vec::new();
    for path in nested_paths {
        let mut bytes = Vec::new();
        {
            let Ok(mut entry) = archive.by_name(&path) else { continue };
            if entry.read_to_end(&mut bytes).is_err() {
                continue;
            }
        }
        let Ok(mut nested) = zip::ZipArchive::new(std::io::Cursor::new(bytes)) else { continue };
        if let Some(metadata) = read_archive(&mut nested, &path, depth + 1) {
            ids.push(metadata.id);
            ids.extend(metadata.provides);
        }
    }
    ids
}

fn read_archive<R: Read + Seek>(
    archive: &mut zip::ZipArchive<R>,
    file_name: &str,
    depth: u8,
) -> Option<ModMetadata> {
    // Order matters: a Quilt mod may ship a fabric.mod.json for compatibility, and its own
    // manifest is the more accurate one.
    let mut metadata = None;
    if let Some(raw) = read_zip_entry(archive, "quilt.mod.json") {
        metadata = parse_quilt(&raw, file_name);
    }
    if metadata.is_none() {
        if let Some(raw) = read_zip_entry(archive, "fabric.mod.json") {
            metadata = parse_fabric(&raw, file_name);
        }
    }
    if metadata.is_none() {
        for candidate in ["META-INF/neoforge.mods.toml", "META-INF/mods.toml"] {
            if let Some(raw) = read_zip_entry(archive, candidate) {
                metadata = parse_forge(&raw, file_name);
                if metadata.is_some() {
                    break;
                }
            }
        }
    }

    let mut metadata = metadata?;
    metadata.provides.extend(collect_bundled_ids(archive, depth));
    Some(metadata)
}

fn read_jar(path: &Path) -> Option<ModMetadata> {
    let file = File::open(path).ok()?;
    let mut archive = zip::ZipArchive::new(file).ok()?;
    let file_name = path.file_name()?.to_string_lossy().to_string();
    read_archive(&mut archive, &file_name, 0)
}

fn find_conflicts(mods: &[ModMetadata]) -> Vec<ModConflict> {
    let mut installed: HashMap<&str, &ModMetadata> = HashMap::new();
    for candidate in mods {
        installed.insert(candidate.id.as_str(), candidate);
        // Aliases and bundled mods load just like their own jar would, so anything
        // depending on them is satisfied.
        for provided in &candidate.provides {
            installed.entry(provided.as_str()).or_insert(candidate);
        }
    }
    let mut conflicts = Vec::new();

    for candidate in mods {
        let mut report = |kind: &str, target_id: &str| {
            conflicts.push(ModConflict {
                kind: kind.to_string(),
                source_name: candidate.name.clone(),
                target_id: target_id.to_string(),
                target_name: installed
                    .get(target_id)
                    .map(|m| m.name.clone())
                    .unwrap_or_else(|| target_id.to_string()),
                file_name: candidate.file_name.clone(),
            });
        };

        // An incompatibility usually names the versions it applies to. Reporting one that
        // does not apply to the installed version would be a warning about a setup that
        // works, so only a range that definitely matches is reported.
        for kind in ["breaks", "conflicts"] {
            let declared = if kind == "breaks" {
                &candidate.breaks
            } else {
                &candidate.conflicts
            };
            for requirement in declared {
                let Some(target) = installed.get(requirement.id.as_str()) else { continue };
                if range_matches(target.version.as_deref(), &requirement.range) == Some(true) {
                    report(kind, &requirement.id);
                }
            }
        }

        for requirement in &candidate.depends {
            // The loader and the game satisfy their own ids, and a version mismatch there is
            // the launcher's job to prevent, not this check's.
            if ENVIRONMENT_IDS.contains(&requirement.id.as_str()) {
                continue;
            }
            // Only an absent mod is reported. A present one at the wrong version is left
            // alone: the loader states that case far more precisely than this can.
            if !installed.contains_key(requirement.id.as_str()) {
                report("missing", &requirement.id);
            }
        }
    }

    // Hard breaks first: those are the ones that stop the game from starting at all.
    conflicts.sort_by_key(|c| match c.kind.as_str() {
        "breaks" => 0,
        "missing" => 1,
        _ => 2,
    });
    conflicts
}

pub fn check_instance(instance_id: &str) -> Vec<ModConflict> {
    let mods_dir = get_instance_dir(instance_id).join("mods");
    let Ok(entries) = std::fs::read_dir(&mods_dir) else {
        return Vec::new();
    };

    let mut metadata = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        // A ".jar.disabled" file is switched off, so it cannot conflict with anything.
        if path.extension().and_then(|e| e.to_str()) != Some("jar") {
            continue;
        }
        // A jar with no readable metadata is skipped rather than guessed at.
        if let Some(parsed) = read_jar(&path) {
            metadata.push(parsed);
        }
    }

    find_conflicts(&metadata)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(requirements: &[Requirement]) -> Vec<String> {
        requirements.iter().map(|r| r.id.clone()).collect()
    }

    fn meta(id: &str, breaks: &[&str], conflicts: &[&str], depends: &[&str]) -> ModMetadata {
        ModMetadata {
            id: id.to_string(),
            name: id.to_string(),
            file_name: format!("{}.jar", id),
            version: Some("1.0.0".to_string()),
            breaks: breaks.iter().map(|s| Requirement::any(s)).collect(),
            conflicts: conflicts.iter().map(|s| Requirement::any(s)).collect(),
            depends: depends.iter().map(|s| Requirement::any(s)).collect(),
            provides: Vec::new(),
        }
    }

    #[test]
    fn compares_versions_by_their_numeric_parts() {
        use std::cmp::Ordering;
        assert_eq!(compare_versions("5.3", "5.2.4"), Ordering::Greater);
        assert_eq!(compare_versions("5.2", "5.2.0"), Ordering::Equal);
        assert_eq!(compare_versions("1.3.0", "1.3.0"), Ordering::Equal);
        // A build suffix says nothing about ordering between releases
        assert_eq!(compare_versions("0.8.13+mc1.21.1", "0.8.13"), Ordering::Equal);
    }

    #[test]
    fn evaluates_the_range_forms_the_loaders_actually_write() {
        assert_eq!(version_satisfies(Some("1.0"), "*"), Some(true));
        assert_eq!(version_satisfies(Some("5.3"), "<5.2.4"), Some(false));
        assert_eq!(version_satisfies(Some("5.1"), "<5.2.4"), Some(true));
        assert_eq!(version_satisfies(Some("1.3.0"), "<=1.3.0"), Some(true));
        assert_eq!(version_satisfies(Some("0.16.0"), ">=0.15.0"), Some(true));
        // Maven ranges, which is what Forge and NeoForge write
        assert_eq!(version_satisfies(Some("47.1"), "[47,)"), Some(true));
        assert_eq!(version_satisfies(Some("46.9"), "[47,)"), Some(false));
        assert_eq!(version_satisfies(Some("2.0"), "[1.0,2.0)"), Some(false));
        assert_eq!(version_satisfies(Some("1.9"), "[1.0,2.0)"), Some(true));
    }

    #[test]
    fn refuses_to_judge_what_it_cannot_parse() {
        // Caret and tilde ranges are not evaluated rather than guessed at
        assert_eq!(version_satisfies(Some("1.0"), "^1.0"), None);
        assert_eq!(version_satisfies(Some("1.0"), "~1.0"), None);
        // A narrower range than "*" cannot be judged without the other mod's version
        assert_eq!(version_satisfies(None, "<2.0"), None);
        // But "*" applies whatever the version turns out to be
        assert_eq!(version_satisfies(None, "*"), Some(true));
    }

    #[test]
    fn stays_silent_about_an_incompatibility_the_installed_version_escapes() {
        // Sodium declares it breaks Bobby below 5.2.4; Bobby 5.3 is fine.
        let sodium = ModMetadata {
            id: "sodium".to_string(),
            name: "Sodium".to_string(),
            file_name: "sodium.jar".to_string(),
            version: Some("0.8.13".to_string()),
            breaks: vec![Requirement {
                id: "bobby".to_string(),
                range: serde_json::Value::String("<5.2.4".to_string()),
            }],
            conflicts: Vec::new(),
            depends: Vec::new(),
            provides: Vec::new(),
        };
        let mut bobby = meta("bobby", &[], &[], &[]);
        bobby.version = Some("5.3".to_string());
        assert!(find_conflicts(&[sodium.clone(), bobby]).is_empty());

        let mut old_bobby = meta("bobby", &[], &[], &[]);
        old_bobby.version = Some("5.2.0".to_string());
        let found = find_conflicts(&[sodium, old_bobby]);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].kind, "breaks");
    }

    #[test]
    fn counts_a_bundled_mod_as_installed() {
        let mut create = meta("create", &[], &[], &["flywheel"]);
        // Create ships flywheel inside its own jar
        create.provides = vec!["flywheel".to_string()];
        assert!(find_conflicts(&[create]).is_empty());
    }

    #[test]
    fn ignores_build_placeholders_left_in_place_of_a_version() {
        assert_eq!(clean_version(Some("${file.jarVersion}".to_string())), None);
        assert_eq!(clean_version(Some("1.2.3".to_string())), Some("1.2.3".to_string()));
    }

    #[test]
    fn reports_a_declared_break_only_when_the_other_mod_is_installed() {
        let both = vec![meta("sodium", &["optifabric"], &[], &[]), meta("optifabric", &[], &[], &[])];
        let found = find_conflicts(&both);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].kind, "breaks");
        assert_eq!(found[0].target_id, "optifabric");

        let alone = vec![meta("sodium", &["optifabric"], &[], &[])];
        assert!(find_conflicts(&alone).is_empty());
    }

    #[test]
    fn reports_missing_dependencies_but_not_the_loader_itself() {
        let mods = vec![meta("create", &[], &[], &["minecraft", "fabricloader", "flywheel"])];
        let found = find_conflicts(&mods);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].kind, "missing");
        assert_eq!(found[0].target_id, "flywheel");
    }

    #[test]
    fn puts_hard_breaks_before_softer_findings() {
        let mods = vec![
            meta("a", &[], &[], &["nowhere"]),
            meta("b", &["c"], &[], &[]),
            meta("c", &[], &[], &[]),
        ];
        let found = find_conflicts(&mods);
        assert_eq!(found[0].kind, "breaks");
    }

    #[test]
    fn reads_a_fabric_manifest() {
        let raw = r#"{
            "schemaVersion": 1,
            "id": "sodium",
            "name": "Sodium",
            "depends": { "minecraft": "~1.21", "fabricloader": ">=0.15.0" },
            "breaks": { "optifabric": "*" }
        }"#;
        let parsed = parse_fabric(raw, "sodium.jar").unwrap();
        assert_eq!(parsed.id, "sodium");
        assert_eq!(parsed.name, "Sodium");
        assert_eq!(ids(&parsed.breaks), vec!["optifabric"]);
        assert_eq!(parsed.depends.len(), 2);
    }

    #[test]
    fn reads_a_forge_manifest_including_the_pre_type_form() {
        let raw = r#"
modLoader="javafml"
loaderVersion="[47,)"

[[mods]]
modId="examplemod"
displayName="Example Mod"

[[dependencies.examplemod]]
modId="neoforge"
type="required"

[[dependencies.examplemod]]
modId="badmod"
type="incompatible"

[[dependencies.examplemod]]
modId="slowmod"
type="discouraged"

[[dependencies.examplemod]]
modId="legacylib"
mandatory=true
"#;
        let parsed = parse_forge(raw, "example.jar").unwrap();
        assert_eq!(parsed.id, "examplemod");
        assert_eq!(parsed.name, "Example Mod");
        assert_eq!(ids(&parsed.breaks), vec!["badmod"]);
        assert_eq!(ids(&parsed.conflicts), vec!["slowmod"]);
        assert!(ids(&parsed.depends).contains(&"neoforge".to_string()));
        assert!(ids(&parsed.depends).contains(&"legacylib".to_string()));
    }

    #[test]
    fn reads_a_quilt_manifest_in_both_shapes() {
        let raw = r#"{
            "schema_version": 1,
            "quilt_loader": {
                "id": "example",
                "metadata": { "name": "Example" },
                "depends": ["quilt_base", { "id": "somelib", "versions": "*" }],
                "breaks": [{ "id": "oldmod" }]
            }
        }"#;
        let parsed = parse_quilt(raw, "example.jar").unwrap();
        assert_eq!(parsed.id, "example");
        assert_eq!(parsed.name, "Example");
        assert_eq!(ids(&parsed.depends), vec!["quilt_base", "somelib"]);
        assert_eq!(ids(&parsed.breaks), vec!["oldmod"]);
    }

    #[test]
    fn returns_nothing_for_metadata_it_cannot_parse() {
        assert!(parse_fabric("{not json", "x.jar").is_none());
        assert!(parse_forge("not = [toml", "x.jar").is_none());
        // A well-formed TOML file with no [[mods]] block names no mod to warn about.
        assert!(parse_forge("modLoader=\"javafml\"", "x.jar").is_none());
    }
}

