//! Path confinement and directory listing for the remote file browser. Every request from
//! `mcl_agent.rs`'s `/v1/files*` routes is relative to the agent's `server_dir()`, and every
//! function here refuses to resolve anywhere outside it — see the design spec, Part C §6.1:
//! a bearer token here implies read/write/delete over a directory tree, where every other
//! agent endpoint only ever implied one fixed operation, so this is the one place that needed
//! a real defense rather than just the existing token check.

use serde::Serialize;
use std::fs;
use std::path::{Component, Path, PathBuf};

/// Rejects any component that isn't a plain path segment: `..`, a root/prefix (`/etc`, `C:\`),
/// and `.` are all refused. This alone stops textual traversal, but says nothing about
/// symlinks planted inside the tree — that's `walk_checked`'s job.
fn reject_traversal(relative: &str) -> Result<(), String> {
    for component in Path::new(relative).components() {
        if !matches!(component, Component::Normal(_)) {
            return Err("Invalid path.".to_string());
        }
    }
    Ok(())
}

/// Joins `relative`'s components onto `canonical_root` one at a time, refusing to go anywhere
/// near a symlink. No component of the requested path is ever resolved through a symlink: for
/// each partial path that already exists on disk, `symlink_metadata` (which does not follow
/// links) is checked and a symlink there is a hard error, not something to follow and validate
/// afterward. Once a component doesn't exist yet, nothing under it can exist either, so checking
/// stops there — the remaining components are still joined onto the returned path, they're just
/// not (and can't usefully be) checked against the filesystem.
///
/// This replaces validating the request by canonicalizing the whole joined path and checking it
/// still starts with the root: canonicalizing follows symlinks, so that check ran only after a
/// symlink had already been followed. Checking component by component, before touching disk,
/// means a symlink anywhere in the path is caught before it is ever used to resolve anything —
/// and, critically, before `resolve_for_write` creates any parent directory.
///
/// Returns the joined (non-canonicalized) path; callers decide what "resolved" means for their
/// case (must already exist vs. fine for the final component to be new).
fn walk_checked(canonical_root: &Path, relative: &str) -> Result<PathBuf, String> {
    reject_traversal(relative)?;
    let mut current = canonical_root.to_path_buf();
    let mut still_checking = true;
    for component in Path::new(relative).components() {
        if let Component::Normal(part) = component {
            current.push(part);
            if still_checking {
                match fs::symlink_metadata(&current) {
                    Ok(meta) => {
                        if meta.file_type().is_symlink() {
                            return Err("Symlinks are not supported.".to_string());
                        }
                    }
                    Err(_) => still_checking = false,
                }
            }
        }
    }
    Ok(current)
}

/// Resolves `relative` (or the root itself, for an empty `relative`) to a path that must
/// already exist — used for listing, downloading, and deleting.
pub fn resolve_existing(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let canonical_root = fs::canonicalize(root).map_err(|e| e.to_string())?;
    if relative.trim().is_empty() {
        return Ok(canonical_root);
    }
    let path = walk_checked(&canonical_root, relative)?;
    fs::symlink_metadata(&path).map_err(|_| "No such file or folder.".to_string())?;
    Ok(path)
}

/// Resolves `relative` for something that doesn't need to exist yet — a new folder, a file
/// about to be written, a rename's destination. Validation (traversal rejection, then the
/// symlink walk, which also refuses a final component that is itself an existing symlink) runs
/// to completion before anything touches disk; only once it succeeds is the parent directory
/// created.
pub fn resolve_for_write(root: &Path, relative: &str) -> Result<PathBuf, String> {
    if relative.trim().is_empty() {
        return Err("Invalid path.".to_string());
    }
    let canonical_root = fs::canonicalize(root).map_err(|e| e.to_string())?;
    let path = walk_checked(&canonical_root, relative)?;
    let parent = path.parent().ok_or_else(|| "Invalid path.".to_string())?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    Ok(path)
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

    /// Direct coverage of `reject_traversal` itself, so a regression that weakens or removes it
    /// fails here rather than only being caught incidentally through `resolve_*`.
    #[test]
    fn reject_traversal_rejects_escaping_and_absolute_components_but_accepts_plain_ones() {
        assert!(reject_traversal("../x").is_err());
        assert!(reject_traversal("/etc/passwd").is_err());
        assert!(reject_traversal("a/../b").is_err());
        assert!(reject_traversal(".").is_err());
        assert!(reject_traversal("a/b.txt").is_ok());
    }

    #[test]
    fn resolve_for_write_rejects_empty_absolute_and_traversal_paths() {
        let root = temp_test_dir("write-invalid");
        assert!(resolve_for_write(&root, "").is_err());
        assert!(resolve_for_write(&root, "   ").is_err());
        assert!(resolve_for_write(&root, "/etc/passwd").is_err());
        assert!(resolve_for_write(&root, "../escape.txt").is_err());
        let _ = fs::remove_dir_all(&root);
    }

    /// Creates a symlink the portable way: `std::os::unix::fs::symlink` on Unix,
    /// `std::os::windows::fs::symlink_dir`/`symlink_file` on Windows (which needs either
    /// elevation or Developer Mode enabled). Returns `false` (instead of panicking) when
    /// creation fails, so callers can skip the test on a machine that can't create symlinks
    /// rather than fail it — the point of these tests is proving the escape is rejected, not
    /// proving this particular machine can make symlinks at all.
    fn try_symlink_dir(target: &Path, link: &Path) -> bool {
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(target, link).is_ok()
        }
        #[cfg(windows)]
        {
            std::os::windows::fs::symlink_dir(target, link).is_ok()
        }
        #[cfg(not(any(unix, windows)))]
        {
            let _ = (target, link);
            false
        }
    }

    fn try_symlink_file(target: &Path, link: &Path) -> bool {
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(target, link).is_ok()
        }
        #[cfg(windows)]
        {
            std::os::windows::fs::symlink_file(target, link).is_ok()
        }
        #[cfg(not(any(unix, windows)))]
        {
            let _ = (target, link);
            false
        }
    }

    #[test]
    fn resolve_existing_rejects_a_symlinked_directory() {
        let root = temp_test_dir("existing-symlink-root");
        let outside = temp_test_dir("existing-symlink-outside");
        fs::write(outside.join("secret.txt"), "should not be reachable").unwrap();

        if !try_symlink_dir(&outside, &root.join("escape")) {
            println!(
                "skipping resolve_existing_rejects_a_symlinked_directory: could not create a \
                 symlink on this machine (Windows without Developer Mode?)"
            );
            let _ = fs::remove_dir_all(&root);
            let _ = fs::remove_dir_all(&outside);
            return;
        }

        let result = resolve_existing(&root, "escape/secret.txt");
        assert!(result.is_err(), "a symlink escaping the root must be rejected, not followed");

        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&outside);
    }

    #[test]
    fn resolve_for_write_rejects_a_symlinked_parent_and_creates_nothing_outside_the_root() {
        let root = temp_test_dir("write-symlink-parent-root");
        let outside = temp_test_dir("write-symlink-parent-outside");

        if !try_symlink_dir(&outside, &root.join("escape")) {
            println!(
                "skipping resolve_for_write_rejects_a_symlinked_parent_and_creates_nothing_outside_the_root: \
                 could not create a symlink on this machine (Windows without Developer Mode?)"
            );
            let _ = fs::remove_dir_all(&root);
            let _ = fs::remove_dir_all(&outside);
            return;
        }

        let result = resolve_for_write(&root, "escape/newsubdir/newfile.txt");
        assert!(result.is_err(), "writing through a symlinked parent must be rejected");

        let outside_entries: Vec<_> = fs::read_dir(&outside).unwrap().flatten().collect();
        assert!(
            outside_entries.is_empty(),
            "a rejected write must not have created any directory outside the root"
        );

        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&outside);
    }

    #[test]
    fn resolve_for_write_rejects_when_the_final_component_is_an_existing_symlink() {
        let root = temp_test_dir("write-symlink-file-root");
        let outside = temp_test_dir("write-symlink-file-outside");
        fs::write(outside.join("real.txt"), "data").unwrap();

        if !try_symlink_file(&outside.join("real.txt"), &root.join("link.txt")) {
            println!(
                "skipping resolve_for_write_rejects_when_the_final_component_is_an_existing_symlink: \
                 could not create a symlink on this machine (Windows without Developer Mode?)"
            );
            let _ = fs::remove_dir_all(&root);
            let _ = fs::remove_dir_all(&outside);
            return;
        }

        let result = resolve_for_write(&root, "link.txt");
        assert!(result.is_err(), "writing to a path whose final component is an existing symlink must be rejected");

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
