# Remote File Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Windows-Explorer-style folder tree to the remote-host UI, scoped to the
`server_dir()` the agent already manages, so an operator can browse, create/rename/delete
folders, upload/download files, and edit small text files (configs, datapack metadata) without
SSH.

**Architecture:** A new `app_lib` module (`src-tauri/src/remote_files.rs`) holds the one thing
that actually needed careful design here — confining every path to `server_dir()` — plus a
plain directory-listing helper. `mcl-agent` gets six new HTTP routes calling into it. The
desktop side gets eight thin `#[tauri::command]`s in `remote_agent.rs` (list/mkdir/rename/
delete, plus *four* around file content rather than the spec's illustrative two, split so a
binary upload/download never has to pass through a JavaScript `string` — see Task 3 for why).
The frontend is one new component, `RemoteFileBrowser.tsx`: a lazy-expanding tree on the left,
the selected folder's contents on the right, and a small built-in text editor for anything
small enough and valid UTF-8.

**Tech Stack:** Rust (axum, `std::fs`/`walkdir` — no new dependencies), React/TypeScript.

**Spec:** `docs/superpowers/specs/2026-09-16-remote-vm-bootstrap-and-backup-design.md`
(§6 Part C, §7 Data Model, §8 Security, §9 Testing — this plan implements those sections only;
Parts A and B are separate plans).

## Global Constraints

- Every path is resolved relative to `server_dir()` and confined there — never the VM's
  filesystem at large. This is the one genuinely new attack surface in the whole spec (§8), so
  the confinement logic gets real tests, not a code-review glance.
- `GET /v1/files` (and the frontend tree) list **one directory level only**, never recursively —
  a world folder's region files alone can number in the thousands.
- The text editor is offered only for files under 1 MB that decode as valid UTF-8; everything
  else is download-only.
- New Rust structs use `#[serde(rename_all = "camelCase")]`; new TS types use camelCase to
  match the wire format directly.
- New filesystem-touching Rust tests use the existing `temp_test_dir(name)` pattern (see
  `src-tauri/src/server_host.rs:525-529`), not a new `tempfile` dependency.
- Every new `#[tauri::command]` name must be added to `TAURI_COMMANDS` in
  `src/services/api.ts`.
- The `select_save_path` command (native save-file dialog with a suggested filename) is shared
  with the `agent-backup-monitoring` plan. If that plan has already been implemented,
  `select_save_path` already exists in `src-tauri/src/lib.rs` — skip Task 4 Step 1 below. If
  not, Task 4 Step 1 adds it (identically to how the other plan does), so this plan stands on
  its own regardless of implementation order.

---

### Task 1: `remote_files.rs` — path confinement and directory listing

**Files:**
- Create: `src-tauri/src/remote_files.rs`
- Modify: `src-tauri/src/lib.rs` (register the module)

**Interfaces:**
- Produces:
  - `pub struct RemoteFileEntry { pub name: String, pub is_dir: bool, pub size_bytes: u64, pub modified_at: u64 }`
    (derives `Debug, Clone, Serialize`, `#[serde(rename_all = "camelCase")]`)
  - `pub fn resolve_existing(root: &Path, relative: &str) -> Result<PathBuf, String>`
  - `pub fn resolve_for_write(root: &Path, relative: &str) -> Result<PathBuf, String>`
  - `pub fn list_dir(dir: &Path) -> Result<Vec<RemoteFileEntry>, String>`

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/remote_files.rs` with just the test module first:

```rust
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --offline remote_files::tests`
Expected: FAIL to compile — `resolve_existing`, `resolve_for_write`, `list_dir` don't exist yet.

- [ ] **Step 3: Write the implementation**

Above the test module in `src-tauri/src/remote_files.rs`:

```rust
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
```

Register the module in `src-tauri/src/lib.rs`, alphabetically right after `mod remote_agent;`
(the exact line depends on whether the `agent-backup-monitoring` plan's `pub mod backup;` has
already been added above it — either way, insert this line right before `pub mod server_config;`):

```rust
mod remote_agent;
pub mod remote_files;
pub mod server_config;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --offline remote_files::tests`
Expected: 4 passed on Windows (the `cfg(unix)` test doesn't run there), 5 passed on Linux/CI.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/remote_files.rs src-tauri/src/lib.rs
git commit -m "feat(agent): add path-confined file listing for the remote file browser"
```

---

### Task 2: Agent HTTP endpoints

**Files:**
- Modify: `src-tauri/src/bin/mcl_agent.rs`

**Interfaces:**
- Consumes: `remote_files::{RemoteFileEntry, resolve_existing, resolve_for_write, list_dir}`
  (Task 1), `AppState::server_dir()` (existing).
- Produces: the six routes from spec §6.2.

- [ ] **Step 1: Add the handlers**

Add `use app_lib::remote_files;` to the top of `src-tauri/src/bin/mcl_agent.rs`, alongside the
existing `use app_lib::...` lines (15-17).

Add after `upload_mod` (after line 291, before `logs` — if the `agent-backup-monitoring` plan's
backup handlers are already there too, add these after those instead; order among handlers
doesn't matter):

```rust
#[derive(Deserialize)]
struct FilePathQuery {
    #[serde(default)]
    path: String,
}

async fn list_files(State(state): State<Arc<AppState>>, Query(q): Query<FilePathQuery>) -> ApiResult<Vec<remote_files::RemoteFileEntry>> {
    let dir = remote_files::resolve_existing(&state.server_dir(), &q.path).map_err(bad_request)?;
    if !dir.is_dir() {
        return Err(bad_request("Not a folder."));
    }
    remote_files::list_dir(&dir).map(Json).map_err(server_error)
}

#[derive(Deserialize)]
struct MkdirRequest {
    path: String,
}

async fn mkdir(State(state): State<Arc<AppState>>, Json(body): Json<MkdirRequest>) -> Result<StatusCode, ApiError> {
    let target = remote_files::resolve_for_write(&state.server_dir(), &body.path).map_err(bad_request)?;
    std::fs::create_dir_all(&target).map_err(|e| server_error(e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct RenameRequest {
    from: String,
    to: String,
}

async fn rename_file(State(state): State<Arc<AppState>>, Json(body): Json<RenameRequest>) -> Result<StatusCode, ApiError> {
    let from = remote_files::resolve_existing(&state.server_dir(), &body.from).map_err(bad_request)?;
    let to = remote_files::resolve_for_write(&state.server_dir(), &body.to).map_err(bad_request)?;
    std::fs::rename(&from, &to).map_err(|e| server_error(e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn delete_file(State(state): State<Arc<AppState>>, Query(q): Query<FilePathQuery>) -> Result<StatusCode, ApiError> {
    let target = remote_files::resolve_existing(&state.server_dir(), &q.path).map_err(bad_request)?;
    let canonical_root = std::fs::canonicalize(state.server_dir()).map_err(|e| server_error(e.to_string()))?;
    if target == canonical_root {
        return Err(bad_request("Cannot delete the server's root folder."));
    }
    if target.is_dir() {
        std::fs::remove_dir_all(&target).map_err(|e| server_error(e.to_string()))?;
    } else {
        std::fs::remove_file(&target).map_err(|e| server_error(e.to_string()))?;
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn read_file_content(State(state): State<Arc<AppState>>, Query(q): Query<FilePathQuery>) -> Result<Response, ApiError> {
    let target = remote_files::resolve_existing(&state.server_dir(), &q.path).map_err(bad_request)?;
    if !target.is_file() {
        return Err(bad_request("Not a file."));
    }
    let bytes = tokio::fs::read(&target).await.map_err(|e| server_error(e.to_string()))?;
    Ok(([(header::CONTENT_TYPE, "application/octet-stream")], bytes).into_response())
}

async fn write_file_content(
    State(state): State<Arc<AppState>>,
    Query(q): Query<FilePathQuery>,
    body: axum::body::Bytes,
) -> Result<StatusCode, ApiError> {
    let target = remote_files::resolve_for_write(&state.server_dir(), &q.path).map_err(bad_request)?;
    tokio::fs::write(&target, &body).await.map_err(|e| server_error(e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}
```

- [ ] **Step 2: Register the routes and extend imports**

In `run()`'s router (`src-tauri/src/bin/mcl_agent.rs:383-394`), add to the `protected` router:

```rust
        .route("/v1/files", get(list_files).delete(delete_file))
        .route("/v1/files/mkdir", post(mkdir))
        .route("/v1/files/rename", post(rename_file))
        .route("/v1/files/content", get(read_file_content).put(write_file_content))
```

Extend two import lines at the top of the file:

```rust
use axum::extract::{Path as AxumPath, Query, Request, State};
```

```rust
use axum::routing::{delete, get, post, put};
```

(If the `agent-backup-monitoring` plan has already added `delete` to the routing import for its
own `/v1/backups/:name` route, don't add it twice — just make sure both `delete` and `put` end
up in that one `use` line.)

- [ ] **Step 3: Verify it builds**

Run: `cargo build --offline --bin mcl-agent --no-default-features --features agent`
Expected: builds cleanly.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/bin/mcl_agent.rs
git commit -m "feat(agent): add file browser HTTP endpoints (list/mkdir/rename/delete/content)"
```

---

### Task 3: Desktop-side Tauri commands

The spec's illustrative command list (§6.5) has one read and one write command for file
content. That's fine for the HTTP layer (raw bytes, binary-safe end to end), but not for the
desktop `#[tauri::command]` layer if it's shaped as a single pair: a `String` parameter can only
ever carry valid UTF-8, so a `remote_agent_write_file(host, path, content: String)` used for
*both* the text editor's save *and* a general file upload would silently corrupt any binary
upload (a plugin jar, a datapack zip) the moment it round-tripped through that `String`. This
plan splits it into a text pair (small, already-known-UTF-8 content, used only by the editor)
and a binary pair that reads/writes local disk directly — the same pattern
`remote_agent_download_backup` already uses for backups, and the same reason it does.

**Files:**
- Modify: `src-tauri/src/remote_agent.rs`
- Modify: `src-tauri/src/lib.rs` (register the eight new commands)

**Interfaces:**
- Consumes: `RemoteHostConfig`, `client_for`, `base_url`, `error_message` (existing in
  `remote_agent.rs`).
- Produces: `remote_agent_list_files`, `remote_agent_mkdir`, `remote_agent_rename`,
  `remote_agent_delete_file`, `remote_agent_read_text_file`, `remote_agent_write_text_file`,
  `remote_agent_upload_file`, `remote_agent_download_file` (all `#[tauri::command]`,
  `pub async fn`).

- [ ] **Step 1: Add the eight commands**

Add to `src-tauri/src/remote_agent.rs`, after `remote_agent_sync_mods` (after line 213, before
the log-streaming section — if the backup commands from the other plan are already there, add
these after those instead):

```rust
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteFileEntry {
    pub name: String,
    pub is_dir: bool,
    pub size_bytes: u64,
    pub modified_at: u64,
}

#[tauri::command]
pub async fn remote_agent_list_files(host: RemoteHostConfig, path: String) -> Result<Vec<RemoteFileEntry>, String> {
    let client = client_for(&host)?;
    let resp = client
        .get(format!("{}/v1/files", base_url(&host)))
        .query(&[("path", &path)])
        .bearer_auth(&host.token)
        .send()
        .await
        .map_err(|e| format!("Could not reach the agent: {}", e))?;
    if !resp.status().is_success() {
        return Err(error_message(resp).await);
    }
    resp.json::<Vec<RemoteFileEntry>>().await.map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MkdirBody {
    path: String,
}

#[tauri::command]
pub async fn remote_agent_mkdir(host: RemoteHostConfig, path: String) -> Result<(), String> {
    post_no_content(&host, "/v1/files/mkdir", &MkdirBody { path }).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RenameBody {
    from: String,
    to: String,
}

#[tauri::command]
pub async fn remote_agent_rename(host: RemoteHostConfig, from: String, to: String) -> Result<(), String> {
    post_no_content(&host, "/v1/files/rename", &RenameBody { from, to }).await
}

#[tauri::command]
pub async fn remote_agent_delete_file(host: RemoteHostConfig, path: String) -> Result<(), String> {
    let client = client_for(&host)?;
    let resp = client
        .delete(format!("{}/v1/files", base_url(&host)))
        .query(&[("path", &path)])
        .bearer_auth(&host.token)
        .send()
        .await
        .map_err(|e| format!("Could not reach the agent: {}", e))?;
    if !resp.status().is_success() {
        return Err(error_message(resp).await);
    }
    Ok(())
}

/// For the built-in text editor only — rejects anything that isn't valid UTF-8 here rather
/// than in the frontend, since Tauri's IPC needs a `String` either way. The frontend already
/// knows to fall back to download-only when this command errors.
#[tauri::command]
pub async fn remote_agent_read_text_file(host: RemoteHostConfig, path: String) -> Result<String, String> {
    let client = client_for(&host)?;
    let resp = client
        .get(format!("{}/v1/files/content", base_url(&host)))
        .query(&[("path", &path)])
        .bearer_auth(&host.token)
        .send()
        .await
        .map_err(|e| format!("Could not reach the agent: {}", e))?;
    if !resp.status().is_success() {
        return Err(error_message(resp).await);
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    String::from_utf8(bytes.to_vec()).map_err(|_| "This file isn't plain text.".to_string())
}

#[tauri::command]
pub async fn remote_agent_write_text_file(host: RemoteHostConfig, path: String, content: String) -> Result<(), String> {
    let client = client_for(&host)?;
    let resp = client
        .put(format!("{}/v1/files/content", base_url(&host)))
        .query(&[("path", &path)])
        .bearer_auth(&host.token)
        .body(content)
        .send()
        .await
        .map_err(|e| format!("Could not reach the agent: {}", e))?;
    if !resp.status().is_success() {
        return Err(error_message(resp).await);
    }
    Ok(())
}

/// Reads `local_path` off disk directly and streams its raw bytes to the agent — never through
/// a JavaScript `string`, so an arbitrary binary upload (a plugin jar, a datapack zip) can't be
/// corrupted the way it would be if it had to survive a UTF-8 round trip.
#[tauri::command]
pub async fn remote_agent_upload_file(host: RemoteHostConfig, local_path: String, remote_path: String) -> Result<(), String> {
    let bytes = tokio::fs::read(&local_path).await.map_err(|e| format!("Could not read {}: {}", local_path, e))?;
    let client = client_for(&host)?;
    let resp = client
        .put(format!("{}/v1/files/content", base_url(&host)))
        .query(&[("path", &remote_path)])
        .bearer_auth(&host.token)
        .body(bytes)
        .send()
        .await
        .map_err(|e| format!("Could not reach the agent: {}", e))?;
    if !resp.status().is_success() {
        return Err(error_message(resp).await);
    }
    Ok(())
}

/// The download counterpart to `remote_agent_upload_file` — writes straight to
/// `local_save_path` rather than returning bytes through Tauri's IPC, same reasoning as
/// `remote_agent_download_backup`.
#[tauri::command]
pub async fn remote_agent_download_file(host: RemoteHostConfig, remote_path: String, local_save_path: String) -> Result<(), String> {
    let client = client_for(&host)?;
    let resp = client
        .get(format!("{}/v1/files/content", base_url(&host)))
        .query(&[("path", &remote_path)])
        .bearer_auth(&host.token)
        .send()
        .await
        .map_err(|e| format!("Could not reach the agent: {}", e))?;
    if !resp.status().is_success() {
        return Err(error_message(resp).await);
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    tokio::fs::write(&local_save_path, &bytes).await.map_err(|e| format!("Could not save the file: {}", e))
}
```

- [ ] **Step 2: Register the commands**

In `src-tauri/src/lib.rs`'s `generate_handler!` list, right after
`remote_agent::remote_agent_stop_log_stream,` (or after the backup plan's five entries, if
those are already there):

```rust
            remote_agent::remote_agent_list_files,
            remote_agent::remote_agent_mkdir,
            remote_agent::remote_agent_rename,
            remote_agent::remote_agent_delete_file,
            remote_agent::remote_agent_read_text_file,
            remote_agent::remote_agent_write_text_file,
            remote_agent::remote_agent_upload_file,
            remote_agent::remote_agent_download_file,
```

- [ ] **Step 3: Verify it builds**

Run: `cargo build --offline` (default desktop feature set)
Expected: builds cleanly.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/remote_agent.rs src-tauri/src/lib.rs
git commit -m "feat(desktop): add Tauri commands for the remote file browser"
```

---

### Task 4: TypeScript types and service functions

**Files:**
- Modify: `src-tauri/src/lib.rs` (only if `select_save_path` doesn't exist yet — see Step 1)
- Modify: `src/types/index.ts`
- Modify: `src/services/remoteAgent.ts`
- Modify: `src/services/api.ts`

**Interfaces:**
- Consumes: the eight commands from Task 3.
- Produces: `RemoteFileEntry` (TS type); `remoteAgent.listFiles`, `remoteAgent.mkdir`,
  `remoteAgent.renameFile`, `remoteAgent.deleteFile`, `remoteAgent.readTextFile`,
  `remoteAgent.writeTextFile`, `remoteAgent.uploadFile`, `remoteAgent.downloadFile`.

- [ ] **Step 1: `select_save_path`, if it isn't there yet**

Check `src-tauri/src/lib.rs` for a `select_save_path` command. If it's already there (added by
the `agent-backup-monitoring` plan), skip to Step 2. Otherwise add it right after `select_folder`
(after line 203):

```rust
#[tauri::command]
fn select_save_path(default_name: String) -> Option<String> {
    rfd::FileDialog::new()
        .set_file_name(&default_name)
        .save_file()
        .map(|p| p.to_string_lossy().to_string())
}
```

And add `select_save_path,` to the `generate_handler!` list, next to `select_folder,`.

- [ ] **Step 2: Types**

Add to `src/types/index.ts`, right after wherever `BackupInfo`/`SystemStats` ended up if the
other plan already added them, otherwise right after the `HostedServerStatus` interface:

```typescript
export interface RemoteFileEntry {
  name: string;
  isDir: boolean;
  sizeBytes: number;
  modifiedAt: number;
}
```

- [ ] **Step 3: Service functions**

Add to `src/services/remoteAgent.ts`, at the end of the `remoteAgent` object:

```typescript
  listFiles: (host: RemoteHost, path: string) =>
    invokeCommand<RemoteFileEntry[]>('remote_agent_list_files', { host: toHostArg(host), path }),
  mkdir: (host: RemoteHost, path: string) => invokeCommand<void>('remote_agent_mkdir', { host: toHostArg(host), path }),
  renameFile: (host: RemoteHost, from: string, to: string) =>
    invokeCommand<void>('remote_agent_rename', { host: toHostArg(host), from, to }),
  deleteFile: (host: RemoteHost, path: string) => invokeCommand<void>('remote_agent_delete_file', { host: toHostArg(host), path }),
  readTextFile: (host: RemoteHost, path: string) => invokeCommand<string>('remote_agent_read_text_file', { host: toHostArg(host), path }),
  writeTextFile: (host: RemoteHost, path: string, content: string) =>
    invokeCommand<void>('remote_agent_write_text_file', { host: toHostArg(host), path, content }),
  uploadFile: (host: RemoteHost, localPath: string, remotePath: string) =>
    invokeCommand<void>('remote_agent_upload_file', { host: toHostArg(host), localPath, remotePath }),
  downloadFile: (host: RemoteHost, remotePath: string, localSavePath: string) =>
    invokeCommand<void>('remote_agent_download_file', { host: toHostArg(host), remotePath, localSavePath }),
```

Add `RemoteFileEntry` to the `import type { ... } from '../types';` line at the top of
`src/services/remoteAgent.ts`.

- [ ] **Step 4: Register the command names**

Add to `TAURI_COMMANDS` in `src/services/api.ts`:

```typescript
  'remote_agent_list_files',
  'remote_agent_mkdir',
  'remote_agent_rename',
  'remote_agent_delete_file',
  'remote_agent_read_text_file',
  'remote_agent_write_text_file',
  'remote_agent_upload_file',
  'remote_agent_download_file',
```

If Step 1 added `select_save_path`, add `'select_save_path',` too (skip if the other plan
already added it).

- [ ] **Step 5: Verify it builds and type-checks**

Run: `cargo build --offline && npx tsc -b`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/lib.rs src/types/index.ts src/services/remoteAgent.ts src/services/api.ts
git commit -m "feat(desktop): add RemoteFileEntry type and remoteAgent file-browser functions"
```

---

### Task 5: `RemoteFileBrowser.tsx`

**Files:**
- Create: `src/components/server/RemoteFileBrowser.tsx`
- Modify: `src/locales/i18n.ts`

**Interfaces:**
- Consumes: `remoteAgent.{listFiles,mkdir,renameFile,deleteFile,readTextFile,writeTextFile,
  uploadFile,downloadFile}` (Task 4), `RemoteHost` (existing), `invokeCommand` with
  `'select_file'` and `'select_save_path'` (existing / Task 4).
- Produces: `RemoteFileBrowser` React component, props `{ host: RemoteHost; language: Language }`.

- [ ] **Step 1: Write the component**

```tsx
import React, { useEffect, useState } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  File as FileIcon,
  FolderPlus,
  Upload,
  Pencil,
  Trash2,
  Download,
  Save,
  X,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { remoteAgent, type RemoteHost } from '../../services/remoteAgent';
import { invokeCommand } from '../../services/api';
import type { RemoteFileEntry } from '../../types';
import { getTranslation, type Language } from '../../locales/i18n';

const TEXT_EDIT_SIZE_CAP = 1024 * 1024; // 1 MB

interface RemoteFileBrowserProps {
  host: RemoteHost;
  language: Language;
}

function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface TreeNodeProps {
  host: RemoteHost;
  path: string;
  name: string;
  depth: number;
  expanded: Set<string>;
  children_: Record<string, RemoteFileEntry[]>;
  selectedFolder: string;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
}

const TreeNode: React.FC<TreeNodeProps> = ({ host, path, name, depth, expanded, children_, selectedFolder, onToggle, onSelect }) => {
  const isExpanded = expanded.has(path);
  const isSelected = selectedFolder === path;
  const kids = (children_[path] || []).filter((e) => e.isDir);

  return (
    <div>
      <div
        className={`flex items-center gap-1 py-1 rounded-lg cursor-pointer text-xs ${
          isSelected ? 'bg-[var(--accent-color)]/15 text-[var(--accent-color)]' : 'text-slate-300 hover:bg-white/5'
        }`}
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
        onClick={() => onSelect(path)}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggle(path);
          }}
          className="p-0.5 shrink-0 text-slate-500 hover:text-white cursor-pointer"
        >
          {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </button>
        {isExpanded ? <FolderOpen className="w-3.5 h-3.5 shrink-0" /> : <Folder className="w-3.5 h-3.5 shrink-0" />}
        <span className="truncate">{name || host.name}</span>
      </div>
      {isExpanded &&
        kids.map((child) => (
          <TreeNode
            key={joinPath(path, child.name)}
            host={host}
            path={joinPath(path, child.name)}
            name={child.name}
            depth={depth + 1}
            expanded={expanded}
            children_={children_}
            selectedFolder={selectedFolder}
            onToggle={onToggle}
            onSelect={onSelect}
          />
        ))}
    </div>
  );
};

export const RemoteFileBrowser: React.FC<RemoteFileBrowserProps> = ({ host, language }) => {
  const t = getTranslation(language);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['']));
  const [childrenByPath, setChildrenByPath] = useState<Record<string, RemoteFileEntry[]>>({});
  const [selectedFolder, setSelectedFolder] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<{ path: string; content: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const loadFolder = async (path: string) => {
    try {
      const entries = await remoteAgent.listFiles(host, path);
      setChildrenByPath((prev) => ({ ...prev, [path]: entries }));
    } catch (err) {
      setError(String(err));
    }
  };

  useEffect(() => {
    setExpanded(new Set(['']));
    setChildrenByPath({});
    setSelectedFolder('');
    loadFolder('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host.id]);

  const toggleExpand = async (path: string) => {
    const next = new Set(expanded);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
      if (!childrenByPath[path]) await loadFolder(path);
    }
    setExpanded(next);
  };

  const selectFolder = async (path: string) => {
    setSelectedFolder(path);
    if (!childrenByPath[path]) await loadFolder(path);
  };

  const refreshCurrent = () => loadFolder(selectedFolder);

  const handleNewFolder = async () => {
    const name = window.prompt(t.hostServerNewFolderPrompt || 'New folder name:');
    if (!name || !name.trim()) return;
    try {
      await remoteAgent.mkdir(host, joinPath(selectedFolder, name.trim()));
      await refreshCurrent();
    } catch (err) {
      setError(String(err));
    }
  };

  const handleUpload = async () => {
    const localPath = await invokeCommand<string | null>('select_file', { filterName: null, filterExtensions: null });
    if (!localPath) return;
    const name = localPath.split(/[\\/]/).pop() || 'file';
    setIsUploading(true);
    try {
      await remoteAgent.uploadFile(host, localPath, joinPath(selectedFolder, name));
      await refreshCurrent();
    } catch (err) {
      setError(String(err));
    } finally {
      setIsUploading(false);
    }
  };

  const handleRename = async (entry: RemoteFileEntry) => {
    const newName = window.prompt(t.hostServerRenamePrompt || 'New name:', entry.name);
    if (!newName || !newName.trim() || newName.trim() === entry.name) return;
    try {
      await remoteAgent.renameFile(host, joinPath(selectedFolder, entry.name), joinPath(selectedFolder, newName.trim()));
      await refreshCurrent();
    } catch (err) {
      setError(String(err));
    }
  };

  const handleDelete = async (entry: RemoteFileEntry) => {
    const template = entry.isDir
      ? t.hostServerDeleteFolderConfirm || 'Delete "{name}" and everything inside it? This cannot be undone.'
      : t.hostServerDeleteFileConfirm || 'Delete "{name}"? This cannot be undone.';
    if (!window.confirm(template.replace('{name}', entry.name))) return;
    try {
      await remoteAgent.deleteFile(host, joinPath(selectedFolder, entry.name));
      await refreshCurrent();
    } catch (err) {
      setError(String(err));
    }
  };

  const handleDownload = async (entry: RemoteFileEntry) => {
    const savePath = await invokeCommand<string | null>('select_save_path', { defaultName: entry.name });
    if (!savePath) return;
    try {
      await remoteAgent.downloadFile(host, joinPath(selectedFolder, entry.name), savePath);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleOpen = async (entry: RemoteFileEntry) => {
    if (entry.isDir) {
      await selectFolder(joinPath(selectedFolder, entry.name));
      return;
    }
    if (entry.sizeBytes > TEXT_EDIT_SIZE_CAP) {
      await handleDownload(entry);
      return;
    }
    const path = joinPath(selectedFolder, entry.name);
    try {
      const content = await remoteAgent.readTextFile(host, path);
      setEditing({ path, content });
    } catch {
      // Not valid UTF-8, or some other read failure — offer a download instead of erroring.
      await handleDownload(entry);
    }
  };

  const handleSaveEditing = async () => {
    if (!editing) return;
    setIsSaving(true);
    try {
      await remoteAgent.writeTextFile(host, editing.path, editing.content);
      setEditing(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setIsSaving(false);
    }
  };

  const currentEntries = childrenByPath[selectedFolder] || [];

  return (
    <div className="rounded-2xl bg-white/[0.02] border border-white/[0.06] overflow-hidden">
      <div className="px-4 py-2.5 border-b border-white/[0.06] flex items-center justify-between">
        <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">{t.hostServerFilesTitle || 'Files'}</span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleNewFolder}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
            title={t.hostServerNewFolder || 'New folder'}
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleUpload}
            disabled={isUploading}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer disabled:opacity-40"
            title={t.hostServerUpload || 'Upload'}
          >
            {isUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-2 flex items-center gap-2 text-xs text-rose-300 bg-rose-500/10 border-b border-rose-500/20">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{error}</span>
        </div>
      )}

      <div className="flex" style={{ height: '20rem' }}>
        <div className="w-48 shrink-0 border-r border-white/[0.06] overflow-y-auto custom-scrollbar py-2">
          <TreeNode
            host={host}
            path=""
            name=""
            depth={0}
            expanded={expanded}
            children_={childrenByPath}
            selectedFolder={selectedFolder}
            onToggle={toggleExpand}
            onSelect={selectFolder}
          />
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar divide-y divide-white/5">
          {currentEntries.length === 0 ? (
            <p className="px-4 py-3 text-xs text-slate-500">{t.hostServerEmptyFolder || 'Empty folder.'}</p>
          ) : (
            currentEntries.map((entry) => (
              <div
                key={entry.name}
                className="px-3 py-2 flex items-center justify-between gap-2 text-xs hover:bg-white/5 cursor-pointer group"
                onClick={() => handleOpen(entry)}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {entry.isDir ? (
                    <Folder className="w-3.5 h-3.5 shrink-0 text-[var(--accent-color)]" />
                  ) : (
                    <FileIcon className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                  )}
                  <span className="truncate text-slate-200">{entry.name}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {!entry.isDir && <span className="text-slate-500 font-mono">{formatSize(entry.sizeBytes)}</span>}
                  <div className="hidden group-hover:flex items-center gap-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRename(entry);
                      }}
                      className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 cursor-pointer"
                      title={t.hostServerRename || 'Rename'}
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    {!entry.isDir && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDownload(entry);
                        }}
                        className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 cursor-pointer"
                        title={t.hostServerDownloadFile || 'Download'}
                      >
                        <Download className="w-3 h-3" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(entry);
                      }}
                      className="p-1 rounded text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 cursor-pointer"
                      title={t.hostServerDeleteFile || 'Delete'}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-8">
          <div className="w-full max-w-2xl h-[70vh] rounded-2xl bg-[#151515] border border-white/10 flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
              <span className="text-xs font-mono text-slate-300 truncate">{editing.path}</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSaveEditing}
                  disabled={isSaving}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[var(--accent-color)] text-black flex items-center gap-1.5 cursor-pointer active:scale-95 transition disabled:opacity-50"
                >
                  {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  <span>{t.saveBtn || 'Save'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <textarea
              value={editing.content}
              onChange={(e) => setEditing({ ...editing, content: e.target.value })}
              spellCheck={false}
              className="flex-1 w-full p-4 bg-transparent text-xs font-mono text-slate-200 resize-none focus:outline-none"
            />
          </div>
        </div>
      )}
    </div>
  );
};
```

- [ ] **Step 2: Add the new i18n keys**

Every `t.hostServerXxx`/`t.saveBtn` reference above must exist as a key in `translations.en` in
`src/locales/i18n.ts` — the `t` object is typed as `typeof translations['en']`, so a key
missing from `en` entirely is a TypeScript compile error (a key present in `en` but absent from
another language just falls back to the `|| '...'` default at runtime, which is fine). Add
these ten keys to both the `en` and `vi` blocks of `src/locales/i18n.ts`, near the other
`hostServer*` keys:

English (`en` block):

```typescript
    hostServerFilesTitle: 'Files',
    hostServerNewFolder: 'New folder',
    hostServerNewFolderPrompt: 'New folder name:',
    hostServerUpload: 'Upload',
    hostServerRename: 'Rename',
    hostServerRenamePrompt: 'New name:',
    hostServerEmptyFolder: 'Empty folder.',
    hostServerDownloadFile: 'Download',
    hostServerDeleteFile: 'Delete',
    hostServerDeleteFileConfirm: 'Delete "{name}"? This cannot be undone.',
    hostServerDeleteFolderConfirm: 'Delete "{name}" and everything inside it? This cannot be undone.',
    saveBtn: 'Save',
```

Vietnamese (`vi` block):

```typescript
    hostServerFilesTitle: 'Tệp',
    hostServerNewFolder: 'Thư mục mới',
    hostServerNewFolderPrompt: 'Tên thư mục mới:',
    hostServerUpload: 'Tải lên',
    hostServerRename: 'Đổi tên',
    hostServerRenamePrompt: 'Tên mới:',
    hostServerEmptyFolder: 'Thư mục trống.',
    hostServerDownloadFile: 'Tải xuống',
    hostServerDeleteFile: 'Xoá',
    hostServerDeleteFileConfirm: 'Xoá "{name}"? Không thể hoàn tác.',
    hostServerDeleteFolderConfirm: 'Xoá "{name}" cùng toàn bộ nội dung bên trong? Không thể hoàn tác.',
    saveBtn: 'Lưu',
```

If `agent-backup-monitoring`'s plan has already added a `saveBtn` key (unlikely — it doesn't
use one — but check anyway to avoid a duplicate-key error), skip that line.

- [ ] **Step 3: Verify it type-checks**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/server/RemoteFileBrowser.tsx src/locales/i18n.ts
git commit -m "feat(desktop): add RemoteFileBrowser component"
```

---

### Task 6: Mount it in `HostServerView.tsx`

**Files:**
- Modify: `src/components/server/HostServerView.tsx`

**Interfaces:**
- Consumes: `RemoteFileBrowser` (Task 5), `selectedHost`, `language` (existing in this
  component).

- [ ] **Step 1: Import and render**

Add the import near the other component imports (`src/components/server/HostServerView.tsx:25`,
right after `P2PDirectConnectCard`):

```typescript
import { RemoteFileBrowser } from './RemoteFileBrowser';
```

Render it right after the Backups section (wherever that landed if the
`agent-backup-monitoring` plan already added it — otherwise right after the "Sync Mods" button
block at `src/components/server/HostServerView.tsx:645-655`, before "Live console"):

```tsx
              {selectedHost && <RemoteFileBrowser host={selectedHost} language={language} />}
```

Confirm this component already receives a `language` prop (check the destructured props at the
top of `HostServerView`'s function signature — this codebase's other server-tab components,
e.g. `P2PDirectConnectCard`, already take `language` the same way, so `HostServerView` almost
certainly already has it in scope; if it doesn't, thread it through the same way
`P2PDirectConnectCard` receives it a few lines above).

- [ ] **Step 2: Verify it builds and type-checks**

Run: `npx tsc -b && npm run build`
Expected: no errors.

- [ ] **Step 3: Manual browser-preview check**

Start the dev server (`preview_start` with `mcl-dev`), navigate to Host Server, select a remote
host if one is configured, and confirm the Files section renders (even if empty/erroring
without a real agent behind it — the point is no console crash) without breaking the rest of
the page.

- [ ] **Step 4: Commit**

```bash
git add src/components/server/HostServerView.tsx
git commit -m "feat(desktop): mount RemoteFileBrowser in the Host Server remote-host panel"
```

---

### Task 7: Full verification against the real agent

**Files:** none (verification only)

- [ ] **Step 1: Full Rust test suite**

Run: `cargo test --offline`
Expected: every existing test still passes, plus the tests from Task 1 (4 on Windows, 5 on
Linux/CI, including the `cfg(unix)` symlink test).

- [ ] **Step 2: Both binaries build**

Run: `cargo build --offline` and `cargo build --offline --bin mcl-agent --no-default-features --features agent`
Expected: both succeed.

- [ ] **Step 3: Deploy and exercise every operation against the real VM**

Same deployment process as the `agent-backup-monitoring` plan's Task 9 Step 3 (rebuild the
Linux agent binary, restart the `mcl-agent` service on the VM reachable via `ssh mcl`). From
MCL's Host Server tab against that host: expand the tree into `plugins/` (or create it via
**New folder** if it doesn't exist), upload a small text file and confirm it appears, double-
click it to open the built-in editor, edit and **Save**, confirm the change round-trips by
closing and reopening it, **Rename** it, **Download** it and confirm the downloaded file's
content matches, and **Delete** it. Also try opening something clearly binary (e.g. the
server's own jar) and confirm it offers a download instead of garbling text into the editor.

- [ ] **Step 4: Confirm CI is green**

Push and check the `CI` GitHub Actions workflow (`gh run list --branch main --limit 1`, then
`gh run view <run-id>` until `completed`/`success`) — this is the one place the `cfg(unix)`
symlink test from Task 1 actually runs, so a red `ubuntu-latest` job here is the first real
signal something's off with it.
