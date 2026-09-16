//! Path confinement and directory listing for the remote file browser. Every request from
//! `mcl_agent.rs`'s `/v1/files*` routes is relative to the agent's `server_dir()`, and every
//! function here refuses to resolve anywhere outside it — see the design spec, Part C §6.1:
//! a bearer token here implies read/write/delete over a directory tree, where every other
//! agent endpoint only ever implied one fixed operation, so this is the one place that needed
//! a real defense rather than just the existing token check.

use serde::Serialize;
use std::fs;
use std::path::{Component, Path, PathBuf};

fn reject_traversal(relative: &str) -> Result<(), String> {
    for component in Path::new(relative).components() {
        if !matches!(component, Component::Normal(_)) {
            return Err("Invalid path.".to_string());
        }
    }
    Ok(())
}

/// Resolves `relative` (or the root itself, for an empty `relative`) to a path that must
/// already exist — used for listing, downloading, and deleting. The resolved path is
/// canonicalized and rejected unless it still starts with the canonical root, which is what
/// catches a symlink planted somewhere in the tree that a purely textual `..`-check alone
/// would miss.
pub fn resolve_existing(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let canonical_root = fs::canonicalize(root).map_err(|e| e.to_string())?;
    if relative.trim().is_empty() {
        return Ok(canonical_root);
    }
    reject_traversal(relative)?;
    let joined = root.join(relative);
    let canonical = fs::canonicalize(&joined).map_err(|_| "No such file or folder.".to_string())?;
    if !canonical.starts_with(&canonical_root) {
        return Err("Path escapes the server directory.".to_string());
    }
    Ok(canonical)
}

/// Resolves `relative` for something that doesn't need to exist yet — a new folder, a file
/// about to be written, a rename's destination. The parent directory is created if missing (so
/// uploading into a not-yet-existing subfolder just works), then canonicalized and checked
/// against the root the same way `resolve_existing` does, before the final path component
/// (which itself need not exist) is joined back on.
pub fn resolve_for_write(root: &Path, relative: &str) -> Result<PathBuf, String> {
    if relative.trim().is_empty() {
        return Err("Invalid path.".to_string());
    }
    reject_traversal(relative)?;
    let rel_path = Path::new(relative);
    let file_name = rel_path.file_name().ok_or_else(|| "Invalid path.".to_string())?;
    let parent_relative = rel_path.parent().unwrap_or_else(|| Path::new(""));

    let canonical_root = fs::canonicalize(root).map_err(|e| e.to_string())?;
    let parent_dir = canonical_root.join(parent_relative);
    fs::create_dir_all(&parent_dir).map_err(|e| e.to_string())?;
    let canonical_parent = fs::canonicalize(&parent_dir).map_err(|e| e.to_string())?;
    if !canonical_parent.starts_with(&canonical_root) {
        return Err("Path escapes the server directory.".to_string());
    }
    Ok(canonical_parent.join(file_name))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteFileEntry {
    pub name: String,
    pub is_dir: bool,
    pub size_bytes: u64,
    pub modified_at: u64,
}

/// One directory level — never recursive. A world folder's region files alone can number in
/// the thousands, so the frontend tree lazy-loads a directory's children only when expanded,
/// and this only ever needs to answer for one level at a time (design spec §6.2).
pub fn list_dir(dir: &Path) -> Result<Vec<RemoteFileEntry>, String> {
    let mut entries = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())?.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        let Some(name) = entry.file_name().to_str().map(|s| s.to_string()) else { continue };
        let modified_at = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        entries.push(RemoteFileEntry { name, is_dir: meta.is_dir(), size_bytes: meta.len(), modified_at });
    }
    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_test_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("mcl-remote-files-test-{}", name));
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::create_dir_all(&dir);
        dir
    }

    #[test]
    fn a_plain_nested_path_resolves_inside_the_root() {
        let root = temp_test_dir("nested");
        fs::create_dir_all(root.join("plugins/myplugin")).unwrap();
        fs::write(root.join("plugins/myplugin/config.yml"), "key: value").unwrap();

        let resolved = resolve_existing(&root, "plugins/myplugin/config.yml").unwrap();
        let canonical_root = fs::canonicalize(&root).unwrap();
        assert!(resolved.starts_with(&canonical_root));
        assert!(resolved.ends_with("config.yml"));

        // An empty path means "the root itself" — what the browser opens on first load.
        let root_resolved = resolve_existing(&root, "").unwrap();
        assert_eq!(root_resolved, canonical_root);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_traversal_attempt_is_rejected() {
        let root = temp_test_dir("traversal");
        assert!(resolve_existing(&root, "../../etc/passwd").is_err());
        assert!(resolve_existing(&root, "a/../../b").is_err());
        assert!(resolve_for_write(&root, "../escape.txt").is_err());
        let _ = fs::remove_dir_all(&root);
    }

    // Symlink escapes only matter for `resolve_existing`/`resolve_for_write` on the platform
    // this agent actually ships on (Linux — see the design spec §2's out-of-scope note on
    // non-apt distros, which implies apt-based Linux is the only target). Gated to `cfg(unix)`
    // rather than run everywhere: creating a symlink on Windows needs elevated privileges or
    // Developer Mode, which would make this test flaky in CI/dev rather than prove anything
    // about the environment the agent binary is actually exposed on.
    #[cfg(unix)]
    #[test]
    fn a_symlink_pointing_outside_the_root_is_rejected() {
        let root = temp_test_dir("symlink-root");
        let outside = temp_test_dir("symlink-outside");
        fs::write(outside.join("secret.txt"), "should not be reachable").unwrap();

        std::os::unix::fs::symlink(&outside, root.join("escape")).unwrap();

        let result = resolve_existing(&root, "escape/secret.txt");
        assert!(result.is_err(), "a symlink escaping the root must be rejected, not followed");

        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&outside);
    }

    #[test]
    fn listing_a_directory_returns_folders_before_files_alphabetically() {
        let dir = temp_test_dir("listing");
        fs::write(dir.join("b.txt"), "b").unwrap();
        fs::write(dir.join("a.txt"), "a").unwrap();
        fs::create_dir_all(dir.join("z_folder")).unwrap();

        let entries = list_dir(&dir).unwrap();
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["z_folder", "a.txt", "b.txt"]);
        assert!(entries[0].is_dir);
        assert!(!entries[1].is_dir);

        let _ = fs::remove_dir_all(&dir);
    }
}
