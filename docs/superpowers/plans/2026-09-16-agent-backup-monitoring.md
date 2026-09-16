# Agent Backup, Restore & Resource Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add backup/restore and CPU/RAM/disk visibility to `mcl-agent`, so a VPS-hosted
Minecraft server backs itself up on a fixed schedule (independent of whether MCL desktop is
open) and an operator can back up, download, delete, and restore from MCL's UI.

**Architecture:** A new `app_lib` module (`src-tauri/src/backup.rs`) holds the pure,
testable archive logic (what to include, how to zip/unzip, rotation). `mcl-agent`
(`src-tauri/src/bin/mcl_agent.rs`) gets five new HTTP routes calling into it, plus a
`tokio::spawn`'d background task that runs the same logic on a timer, plus CPU/RAM/disk fields
folded into the existing `/v1/status` response via `sysinfo`. The desktop side gets thin
wrapper `#[tauri::command]`s in `remote_agent.rs` (mirroring the eight that already exist there)
and a new "Backups" section plus a resource strip in `HostServerView.tsx`.

**Tech Stack:** Rust (axum, `zip` 2.2, `walkdir` 2.5, `sysinfo` 0.32 — all already
dependencies, no `Cargo.toml` changes needed), React/TypeScript (Tauri commands via
`invokeCommand`).

**Spec:** `docs/superpowers/specs/2026-09-16-remote-vm-bootstrap-and-backup-design.md`
(§5 Part B, §7 Data Model, §8 Security, §9 Testing — this plan implements those sections only;
Parts A and C are separate plans).

## Global Constraints

- Backups only ever include: the world folder(s) named after `level-name` in
  `server.properties` (plus `_nether`/`_the_end` siblings), `server.properties`,
  `whitelist.json`, `ops.json`, `banned-players.json`, `banned-ips.json`, `usercache.json`.
  Never the loader jar, `libraries/`, `logs/`, `crash-reports/`, or cache directories.
- Every new agent HTTP route sits behind the existing `require_token` middleware — do not add
  a route outside the `protected` router in `mcl_agent.rs`'s `run()`.
- New Rust structs/fields use `#[serde(rename_all = "camelCase")]` to match every existing
  struct in this codebase; new TypeScript types use camelCase fields to match the wire format
  directly (no snake_case anywhere on the TS side).
- New filesystem-touching Rust tests use the existing `temp_test_dir(name)` pattern
  (`std::env::temp_dir().join("mcl-<module>-test-<name>")` + manual `remove_dir_all` cleanup),
  not a new `tempfile` dependency — see `src-tauri/src/server_host.rs:525-529` for the pattern
  this plan's tests must match.
- Every new `#[tauri::command]` name must be added to `TAURI_COMMANDS` in
  `src/services/api.ts` — `invokeCommand` is typed against that array, so a command missing
  from it is a TypeScript compile error the moment something tries to call it.

---

### Task 1: `server_config::read_level_name` — the one new fact backup scoping needs

`ServerPropertiesSummary` (`src-tauri/src/models.rs:140-149`) doesn't model `level-name` (it
only tracks the handful of settings the Server Config UI edits). Backup scoping needs it too,
so add a small standalone reader that reuses `server_config.rs`'s own private `parse_properties`
helper rather than duplicating the parsing logic.

**Files:**
- Modify: `src-tauri/src/server_config.rs`

**Interfaces:**
- Produces: `pub fn read_level_name(dir: &std::path::Path) -> String` — Minecraft's own default
  (`"world"`) if `server.properties` is missing or has no `level-name` line.

- [ ] **Step 1: Write the failing test**

Add to the `#[cfg(test)] mod tests` block at the bottom of `src-tauri/src/server_config.rs`
(after the existing `missing_keys_fall_back_to_minecrafts_own_defaults` test):

```rust
    #[test]
    fn read_level_name_finds_a_custom_name_and_falls_back_to_world() {
        let dir = std::env::temp_dir().join("mcl-server-config-test-level-name");
        let _ = fs::create_dir_all(&dir);

        // No server.properties at all yet — Minecraft's own default.
        assert_eq!(read_level_name(&dir), "world");

        fs::write(dir.join(FILE_NAME), "level-name=survival_smp\nonline-mode=true\n").unwrap();
        assert_eq!(read_level_name(&dir), "survival_smp");

        let _ = fs::remove_dir_all(&dir);
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --offline read_level_name_finds_a_custom_name_and_falls_back_to_world`
Expected: FAIL with `cannot find function 'read_level_name' in this scope`

- [ ] **Step 3: Write minimal implementation**

Add to `src-tauri/src/server_config.rs`, right after `read_server_properties` (after line 57):

```rust
/// The one `server.properties` key `ServerPropertiesSummary` doesn't model — needed on its own
/// by the backup feature to know which world folder(s) to archive. Minecraft's own default
/// (`world`) covers both a missing file and a file with no `level-name` line.
pub fn read_level_name(dir: &Path) -> String {
    let Ok(raw) = fs::read_to_string(dir.join(FILE_NAME)) else {
        return "world".to_string();
    };
    parse_properties(&raw)
        .get("level-name")
        .cloned()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| "world".to_string())
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --offline read_level_name_finds_a_custom_name_and_falls_back_to_world`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/server_config.rs
git commit -m "feat(agent): add server_config::read_level_name for backup scoping"
```

---

### Task 2: `backup.rs` — archive scope, zip, list, rotate

The pure logic Task 4's HTTP handlers and Task 5's scheduler both call into. No HTTP, no
`AppState` — just paths in, paths/bytes out, so it's testable without an agent process.

**Files:**
- Create: `src-tauri/src/backup.rs`
- Modify: `src-tauri/src/lib.rs` (register the module)

**Interfaces:**
- Consumes: `server_config::read_level_name` (Task 1).
- Produces:
  - `pub struct BackupInfo { pub name: String, pub size_bytes: u64, pub created_at: u64 }`
    (derives `Debug, Clone, Serialize`, `#[serde(rename_all = "camelCase")]`)
  - `pub fn backup_source_paths(server_dir: &Path) -> Vec<PathBuf>`
  - `pub fn create_backup(server_dir: &Path, backups_dir: &Path) -> Result<BackupInfo, String>`
  - `pub fn list_backups(backups_dir: &Path) -> Vec<BackupInfo>`
  - `pub fn rotate_backups(backups_dir: &Path, retention_count: usize) -> usize`
  - `pub fn restore_backup(server_dir: &Path, backups_dir: &Path, backup_name: &str) -> Result<(), String>`

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/backup.rs` with just the test module first:

```rust
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
        restore_backup(&server_dir, &backups_dir, &info.name).unwrap();
        let restored = fs::read_to_string(server_dir.join("world/level.dat")).unwrap();
        assert_eq!(restored, "fake level data");

        let _ = fs::remove_dir_all(&server_dir);
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --offline backup::tests`
Expected: FAIL to compile — `backup_source_paths`, `create_backup`, `list_backups`,
`rotate_backups`, `restore_backup` don't exist yet.

- [ ] **Step 3: Write the implementation**

Above the test module in `src-tauri/src/backup.rs`:

```rust
//! Backup logic for an agent-hosted Minecraft server: what counts as "the data" (never the
//! loader jar or logs, always the world and player-list files — see the design spec, Part B
//! §5.1), and how it's zipped, listed, rotated, and restored. Pure filesystem functions with
//! no knowledge of HTTP or `AppState`, so `mcl_agent.rs`'s handlers and background scheduler
//! both just call into this.

use crate::server_config;
use serde::Serialize;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub name: String,
    pub size_bytes: u64,
    pub created_at: u64,
}

/// The files and folders, relative to `server_dir`, that make up one backup — irreplaceable
/// player data only, never anything `/v1/prepare` can redownload or regenerate.
pub fn backup_source_paths(server_dir: &Path) -> Vec<PathBuf> {
    let level_name = server_config::read_level_name(server_dir);
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
    fs::create_dir_all(backups_dir).map_err(|e| e.to_string())?;
    let created_at = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_secs();
    let name = format!("{}.zip", created_at);
    let path = backups_dir.join(&name);

    let file = File::create(&path).map_err(|e| e.to_string())?;
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
    let size_bytes = fs::metadata(&path).map_err(|e| e.to_string())?.len();
    Ok(BackupInfo { name, size_bytes, created_at })
}

/// Lists `backups_dir`'s `.zip` files, newest first.
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

/// Extracts `backup_name` back over `server_dir`, overwriting whatever's already there.
/// `enclosed_name()` is the `zip` crate's own zip-slip defense — an entry whose path would
/// resolve outside the extraction root comes back `None` and aborts the restore instead of
/// being written somewhere unintended.
pub fn restore_backup(server_dir: &Path, backups_dir: &Path, backup_name: &str) -> Result<(), String> {
    let backup_path = backups_dir.join(backup_name);
    let file = File::open(&backup_path).map_err(|e| format!("Could not open backup {}: {}", backup_name, e))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Backup {} is not a valid archive: {}", backup_name, e))?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let Some(enclosed) = entry.enclosed_name() else {
            return Err(format!("Backup {} contains an unsafe path.", backup_name));
        };
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
```

Register the module in `src-tauri/src/lib.rs`, alphabetically right after `mod addon_registry;`
(line 1):

```rust
mod addon_registry;
pub mod backup;
mod discord_rpc;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --offline backup::tests`
Expected: 3 passed (`backup_scope_includes_...`, `a_created_backup_can_be_listed_and_restored`,
`rotation_keeps_only_the_newest_n_and_deletes_the_rest`)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/backup.rs src-tauri/src/lib.rs
git commit -m "feat(agent): add backup archive/list/rotate/restore logic"
```

---

### Task 3: `SystemStats` — CPU/RAM/disk via `sysinfo`

**Files:**
- Create: `src-tauri/src/bin/mcl_agent.rs` (modify — this and every later task in this plan
  touch this one file; each task's diff is additive and won't conflict as long as tasks run in
  order)

**Interfaces:**
- Produces: `struct SystemStats { cpu_percent: f32, mem_used_mb: u64, mem_total_mb: u64,
  disk_used_mb: u64, disk_total_mb: u64 }` (private to `mcl_agent.rs`, `#[derive(Serialize)]`,
  `#[serde(rename_all = "camelCase")]`) and `fn collect_system_stats() -> SystemStats`.

This one isn't independently unit-testable in a meaningful way (it reads the real machine's
CPU/memory/disk, so a test can only assert "the numbers are non-negative and total >= used",
which `sysinfo` itself already guarantees) — verified instead by Task 8's manual check against
the real values `htop`/`df` report on the VM. Write it directly, no test-first cycle here.

- [ ] **Step 1: Add the struct and collector function**

Add to `src-tauri/src/bin/mcl_agent.rs`, right after the `AppState` `impl` block (after line 55):

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemStats {
    cpu_percent: f32,
    mem_used_mb: u64,
    mem_total_mb: u64,
    disk_used_mb: u64,
    disk_total_mb: u64,
}

/// Averaged across every core rather than a single global-aggregate call, since that's the one
/// reading guaranteed to exist across `sysinfo` releases. Disk figures come from whichever
/// mounted disk's mount point is exactly `/` — the only one that matters on the single-purpose
/// Linux VPS this agent runs on — falling back to the first disk `sysinfo` reports if none
/// matches (e.g. an unusual partition layout), so this never silently reports all zeroes.
fn collect_system_stats() -> SystemStats {
    let mut sys = sysinfo::System::new();
    sys.refresh_cpu_usage();
    sys.refresh_memory();
    let cpu_percent = if sys.cpus().is_empty() {
        0.0
    } else {
        sys.cpus().iter().map(|c| c.cpu_usage()).sum::<f32>() / sys.cpus().len() as f32
    };

    let disks = sysinfo::Disks::new_with_refreshed_list();
    let root_disk = disks
        .iter()
        .find(|d| d.mount_point() == std::path::Path::new("/"))
        .or_else(|| disks.iter().next());
    let (disk_used_mb, disk_total_mb) = match root_disk {
        Some(d) => {
            let total = d.total_space() / 1024 / 1024;
            let available = d.available_space() / 1024 / 1024;
            (total.saturating_sub(available), total)
        }
        None => (0, 0),
    };

    SystemStats {
        cpu_percent,
        mem_used_mb: sys.used_memory() / 1024 / 1024,
        mem_total_mb: sys.total_memory() / 1024 / 1024,
        disk_used_mb,
        disk_total_mb,
    }
}
```

- [ ] **Step 2: Fold it into `/v1/status`**

Change `get_status`'s return type and body (`src-tauri/src/bin/mcl_agent.rs:117-131`) from:

```rust
async fn get_status(State(state): State<Arc<AppState>>) -> ApiResult<HostedServerStatus> {
    let Some(spec) = read_spec(&state) else {
        return Ok(Json(HostedServerStatus {
            state: server_host::ServerState::Stopped,
            has_jar: false,
            server_dir: state.server_dir().to_string_lossy().to_string(),
        }));
    };
    Ok(Json(server_host::get_status(
        &state.server_dir(),
        &spec.loader,
        &spec.game_version,
        spec.loader_version.as_deref(),
    )))
}
```

to:

```rust
#[derive(Serialize)]
struct AgentStatusResponse {
    #[serde(flatten)]
    status: HostedServerStatus,
    system: SystemStats,
}

async fn get_status(State(state): State<Arc<AppState>>) -> ApiResult<AgentStatusResponse> {
    let system = collect_system_stats();
    let Some(spec) = read_spec(&state) else {
        return Ok(Json(AgentStatusResponse {
            status: HostedServerStatus {
                state: server_host::ServerState::Stopped,
                has_jar: false,
                server_dir: state.server_dir().to_string_lossy().to_string(),
            },
            system,
        }));
    };
    Ok(Json(AgentStatusResponse {
        status: server_host::get_status(
            &state.server_dir(),
            &spec.loader,
            &spec.game_version,
            spec.loader_version.as_deref(),
        ),
        system,
    }))
}
```

`#[serde(flatten)]` keeps every existing `HostedServerStatus` field (`state`, `hasJar`,
`serverDir`) at the top level of the JSON response, unchanged for any caller that only reads
those — `system` is purely additive.

- [ ] **Step 3: Verify it builds**

Run: `cargo build --offline --bin mcl-agent --no-default-features --features agent`
Expected: builds cleanly, no warnings about unused `SystemStats`/`collect_system_stats` (both
are now used by `get_status`).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/bin/mcl_agent.rs
git commit -m "feat(agent): report CPU/RAM/disk stats alongside server status"
```

---

### Task 4: Backup/restore HTTP endpoints

**Files:**
- Modify: `src-tauri/src/bin/mcl_agent.rs`

**Interfaces:**
- Consumes: `backup::{BackupInfo, create_backup, list_backups, rotate_backups, restore_backup}`
  (Task 2), `AppState` (existing).
- Produces: `AppState::backups_dir(&self) -> PathBuf`, `ServerSpec.backup_retention_count: u32`
  (new field, `#[serde(default = "default_retention")]` so an existing agent's `spec.json`
  written before this change still deserializes), and the five routes from spec §5.2.

- [ ] **Step 1: `backups_dir()` and the retention field**

Add to `AppState`'s `impl` block (`src-tauri/src/bin/mcl_agent.rs:43-55`), right after
`server_dir`:

```rust
    fn backups_dir(&self) -> PathBuf {
        self.data_dir.join("backups")
    }
```

Change `ServerSpec` (lines 59-65) to add the retention field with a default for old files:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServerSpec {
    loader: String,
    game_version: String,
    loader_version: Option<String>,
    #[serde(default = "default_retention")]
    backup_retention_count: u32,
}

fn default_retention() -> u32 {
    7
}
```

`prepare`'s construction of `ServerSpec` (`src-tauri/src/bin/mcl_agent.rs:146-150`) needs the
new field too:

```rust
    let spec = ServerSpec {
        loader: body.loader,
        game_version: body.game_version,
        loader_version: body.loader_version,
        backup_retention_count: default_retention(),
    };
```

- [ ] **Step 2: The five handlers**

Add after `upload_mod` (`src-tauri/src/bin/mcl_agent.rs`, after line 291, before `logs`):

```rust
async fn create_backup_now(State(state): State<Arc<AppState>>) -> ApiResult<backup::BackupInfo> {
    let server_dir = state.server_dir();
    let backups_dir = state.backups_dir();
    let info = tokio::task::spawn_blocking(move || backup::create_backup(&server_dir, &backups_dir))
        .await
        .map_err(|e| server_error(e.to_string()))?
        .map_err(server_error)?;

    let retention = read_spec(&state).map(|s| s.backup_retention_count).unwrap_or_else(default_retention) as usize;
    let backups_dir = state.backups_dir();
    tokio::task::spawn_blocking(move || backup::rotate_backups(&backups_dir, retention))
        .await
        .map_err(|e| server_error(e.to_string()))?;

    Ok(Json(info))
}

async fn list_backups_handler(State(state): State<Arc<AppState>>) -> ApiResult<Vec<backup::BackupInfo>> {
    Ok(Json(backup::list_backups(&state.backups_dir())))
}

fn safe_backup_name(name: &str) -> Result<(), ApiError> {
    if name.contains('/') || name.contains('\\') || name.contains("..") || !name.ends_with(".zip") {
        return Err(bad_request("Invalid backup name."));
    }
    Ok(())
}

async fn download_backup(State(state): State<Arc<AppState>>, AxumPath(name): AxumPath<String>) -> Result<Response, ApiError> {
    safe_backup_name(&name)?;
    let path = state.backups_dir().join(&name);
    let bytes = tokio::fs::read(&path).await.map_err(|_| bad_request(format!("No backup named {}.", name)))?;
    Ok((
        [(header::CONTENT_TYPE, "application/zip"), (header::CONTENT_DISPOSITION, &format!("attachment; filename=\"{}\"", name))],
        bytes,
    )
        .into_response())
}

async fn delete_backup(State(state): State<Arc<AppState>>, AxumPath(name): AxumPath<String>) -> Result<StatusCode, ApiError> {
    safe_backup_name(&name)?;
    std::fs::remove_file(state.backups_dir().join(&name)).map_err(|_| bad_request(format!("No backup named {}.", name)))?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct RestoreRequest {
    name: String,
}

async fn restore(State(state): State<Arc<AppState>>, Json(body): Json<RestoreRequest>) -> Result<StatusCode, ApiError> {
    safe_backup_name(&body.name)?;
    // Stop first if running — restoring over a live world's files while the server process
    // still has them open is how you end up with a corrupted world, not a restored one.
    let dir = state.server_dir();
    let _ = tokio::task::spawn_blocking(move || server_host::stop_server(&dir)).await;

    let server_dir = state.server_dir();
    let backups_dir = state.backups_dir();
    let name = body.name.clone();
    tokio::task::spawn_blocking(move || backup::restore_backup(&server_dir, &backups_dir, &name))
        .await
        .map_err(|e| server_error(e.to_string()))?
        .map_err(server_error)?;
    Ok(StatusCode::NO_CONTENT)
}
```

Add `use app_lib::backup;` to the top of `src-tauri/src/bin/mcl_agent.rs` (alongside the
existing `use app_lib::models::...` / `use app_lib::server_config;` / `use app_lib::server_host`
lines, 15-17).

- [ ] **Step 3: Register the routes**

In `run()`'s router (`src-tauri/src/bin/mcl_agent.rs:383-394`), add four routes to the
`protected` router (right after the `/v1/mods/:filename` line):

```rust
        .route("/v1/backups", get(list_backups_handler).post(create_backup_now))
        .route("/v1/backups/:name", get(download_backup).delete(delete_backup))
        .route("/v1/restore", post(restore))
```

`axum::routing` already imports `get`/`post` (line 23); `delete` needs adding to that import:

```rust
use axum::routing::{delete, get, post};
```

- [ ] **Step 4: Verify it builds**

Run: `cargo build --offline --bin mcl-agent --no-default-features --features agent`
Expected: builds cleanly.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/bin/mcl_agent.rs
git commit -m "feat(agent): add backup/list/download/delete/restore HTTP endpoints"
```

---

### Task 5: Scheduled backups

**Files:**
- Modify: `src-tauri/src/bin/mcl_agent.rs`

**Interfaces:**
- Consumes: `backup::{create_backup, rotate_backups}` (Task 2), `read_spec`/`AppState`
  (existing/Task 4).

- [ ] **Step 1: Add the scheduler task**

In `run()`, right after `let state = Arc::new(AppState { ... });` (line 381), before the
`protected` router is built:

```rust
    tokio::spawn(backup_scheduler(state.clone()));
```

Add the function itself above `run()` (before line 365):

```rust
/// Backs up on a fixed 24h interval from whenever the agent started, independent of whether
/// MCL desktop is even open — the whole point of an "emergency" backup on a VPS meant to run
/// unattended. No cron parsing for v1: a fixed interval is enough, and much simpler.
async fn backup_scheduler(state: Arc<AppState>) {
    const INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);
    loop {
        tokio::time::sleep(INTERVAL).await;
        let Some(spec) = read_spec(&state) else { continue };
        let server_dir = state.server_dir();
        let backups_dir = state.backups_dir();
        let result = tokio::task::spawn_blocking(move || backup::create_backup(&server_dir, &backups_dir)).await;
        if let Ok(Ok(_)) = result {
            let backups_dir = state.backups_dir();
            let retention = spec.backup_retention_count as usize;
            let _ = tokio::task::spawn_blocking(move || backup::rotate_backups(&backups_dir, retention)).await;
        }
    }
}
```

- [ ] **Step 2: Verify it builds**

Run: `cargo build --offline --bin mcl-agent --no-default-features --features agent`
Expected: builds cleanly.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/bin/mcl_agent.rs
git commit -m "feat(agent): run backups on a fixed 24h schedule independent of the desktop app"
```

---

### Task 6: Desktop-side Tauri commands

**Files:**
- Modify: `src-tauri/src/remote_agent.rs`
- Modify: `src-tauri/src/lib.rs` (register the new commands)

**Interfaces:**
- Consumes: `RemoteHostConfig`, `client_for`, `base_url`, `get_json`, `post_no_content`,
  `error_message` (all already in `remote_agent.rs`).
- Produces: `remote_agent_list_backups`, `remote_agent_backup_now`,
  `remote_agent_download_backup`, `remote_agent_delete_backup`, `remote_agent_restore_backup`
  (all `#[tauri::command]`, `pub async fn`).

- [ ] **Step 1: Add the five commands**

Add to `src-tauri/src/remote_agent.rs`, after `remote_agent_sync_mods` (after line 213, before
the log-streaming section):

```rust
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub name: String,
    pub size_bytes: u64,
    pub created_at: u64,
}

#[tauri::command]
pub async fn remote_agent_list_backups(host: RemoteHostConfig) -> Result<Vec<BackupInfo>, String> {
    get_json(&host, "/v1/backups").await
}

#[tauri::command]
pub async fn remote_agent_backup_now(host: RemoteHostConfig) -> Result<BackupInfo, String> {
    let client = client_for(&host)?;
    let resp = client
        .post(format!("{}/v1/backups", base_url(&host)))
        .bearer_auth(&host.token)
        .send()
        .await
        .map_err(|e| format!("Could not reach the agent: {}", e))?;
    if !resp.status().is_success() {
        return Err(error_message(resp).await);
    }
    resp.json::<BackupInfo>().await.map_err(|e| e.to_string())
}

/// Downloads one backup straight to `save_path` (chosen by the frontend via `rfd`'s native
/// save dialog) rather than returning the bytes through Tauri's IPC, so a large world backup
/// never has to round-trip through the webview's own memory.
#[tauri::command]
pub async fn remote_agent_download_backup(host: RemoteHostConfig, name: String, save_path: String) -> Result<(), String> {
    let client = client_for(&host)?;
    let resp = client
        .get(format!("{}/v1/backups/{}", base_url(&host), name))
        .bearer_auth(&host.token)
        .send()
        .await
        .map_err(|e| format!("Could not reach the agent: {}", e))?;
    if !resp.status().is_success() {
        return Err(error_message(resp).await);
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    tokio::fs::write(&save_path, &bytes).await.map_err(|e| format!("Could not save the backup: {}", e))
}

#[tauri::command]
pub async fn remote_agent_delete_backup(host: RemoteHostConfig, name: String) -> Result<(), String> {
    let client = client_for(&host)?;
    let resp = client
        .delete(format!("{}/v1/backups/{}", base_url(&host), name))
        .bearer_auth(&host.token)
        .send()
        .await
        .map_err(|e| format!("Could not reach the agent: {}", e))?;
    if !resp.status().is_success() {
        return Err(error_message(resp).await);
    }
    Ok(())
}

#[derive(Serialize)]
struct RestoreBody {
    name: String,
}

#[tauri::command]
pub async fn remote_agent_restore_backup(host: RemoteHostConfig, name: String) -> Result<(), String> {
    post_no_content(&host, "/v1/restore", &RestoreBody { name }).await
}
```

- [ ] **Step 2: Register the commands**

In `src-tauri/src/lib.rs`'s `generate_handler!` list, right after
`remote_agent::remote_agent_stop_log_stream,` (line 761):

```rust
            remote_agent::remote_agent_list_backups,
            remote_agent::remote_agent_backup_now,
            remote_agent::remote_agent_download_backup,
            remote_agent::remote_agent_delete_backup,
            remote_agent::remote_agent_restore_backup,
```

- [ ] **Step 3: Verify it builds**

Run: `cargo build --offline` (default desktop feature set)
Expected: builds cleanly.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/remote_agent.rs src-tauri/src/lib.rs
git commit -m "feat(desktop): add Tauri commands for remote agent backups"
```

---

### Task 7: `select_save_path` command, TypeScript types and service functions

**Files:**
- Modify: `src-tauri/src/lib.rs` (new `select_save_path` command — this codebase has
  `select_folder`/`select_file`/`select_mrpack_file` for *opening* a path, but nothing yet for
  a *save-to* dialog with a suggested filename, which downloading a backup needs)
- Modify: `src/types/index.ts`
- Modify: `src/services/remoteAgent.ts`
- Modify: `src/services/api.ts` (register the five backup commands plus `select_save_path`)

**Interfaces:**
- Consumes: the five commands from Task 6, `RemoteHost`/`toHostArg` (existing in
  `remoteAgent.ts`).
- Produces: `select_save_path(default_name: String) -> Option<String>` (new Tauri command);
  `BackupInfo`, `SystemStats` (TS types); `remoteAgent.listBackups`, `remoteAgent.backupNow`,
  `remoteAgent.downloadBackup`, `remoteAgent.deleteBackup`, `remoteAgent.restoreBackup`.

- [ ] **Step 1: `select_save_path` command**

Add to `src-tauri/src/lib.rs`, right after `select_folder` (after line 203), following that
function's exact `rfd::FileDialog` style:

```rust
#[tauri::command]
fn select_save_path(default_name: String) -> Option<String> {
    rfd::FileDialog::new()
        .set_file_name(&default_name)
        .save_file()
        .map(|p| p.to_string_lossy().to_string())
}
```

Add `select_save_path,` to the `generate_handler!` list right after `select_folder,` (find that
line in the existing list — it's grouped with `select_file`/`select_folder` near the top of the
list).

- [ ] **Step 2: Types**

Add to `src/types/index.ts`, right after the `HostedServerStatus` interface (after line 322):

```typescript
export interface BackupInfo {
  name: string;
  sizeBytes: number;
  createdAt: number;
}

export interface SystemStats {
  cpuPercent: number;
  memUsedMb: number;
  memTotalMb: number;
  diskUsedMb: number;
  diskTotalMb: number;
}
```

Extend `HostedServerStatus` itself to carry the flattened `system` field Task 3 added to the
wire format:

```typescript
export interface HostedServerStatus {
  state: HostedServerState;
  hasJar: boolean;
  serverDir: string;
  /** Only present when this status came from a remote agent (local hosting has no need for its own machine's stats here). */
  system?: SystemStats;
}
```

- [ ] **Step 3: Service functions**

Add to `src/services/remoteAgent.ts`, at the end of the `remoteAgent` object (find the closing
`};` of that object — insert the five new entries before it, after whatever the last existing
entry is):

```typescript
  listBackups: (host: RemoteHost) => invokeCommand<BackupInfo[]>('remote_agent_list_backups', { host: toHostArg(host) }),
  backupNow: (host: RemoteHost) => invokeCommand<BackupInfo>('remote_agent_backup_now', { host: toHostArg(host) }),
  downloadBackup: (host: RemoteHost, name: string, savePath: string) =>
    invokeCommand<void>('remote_agent_download_backup', { host: toHostArg(host), name, savePath }),
  deleteBackup: (host: RemoteHost, name: string) =>
    invokeCommand<void>('remote_agent_delete_backup', { host: toHostArg(host), name }),
  restoreBackup: (host: RemoteHost, name: string) =>
    invokeCommand<void>('remote_agent_restore_backup', { host: toHostArg(host), name }),
```

Add `BackupInfo` to the `import type { HostedServerStatus, ServerPropertiesSummary }` line at
the top of `src/services/remoteAgent.ts` (line 5):

```typescript
import type { HostedServerStatus, ServerPropertiesSummary, BackupInfo } from '../types';
```

- [ ] **Step 4: Register the command names**

Add to `TAURI_COMMANDS` in `src/services/api.ts`, right after `'remote_agent_stop_log_stream',`
(line 54):

```typescript
  'remote_agent_list_backups',
  'remote_agent_backup_now',
  'remote_agent_download_backup',
  'remote_agent_delete_backup',
  'remote_agent_restore_backup',
  'select_save_path',
```

- [ ] **Step 5: Verify it builds and type-checks**

Run: `cargo build --offline && npx tsc -b`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/types/index.ts src/services/remoteAgent.ts src/services/api.ts
git commit -m "feat(desktop): add BackupInfo/SystemStats types and remoteAgent backup functions"
```

---

### Task 8: Backups UI section and resource strip in `HostServerView.tsx`

**Files:**
- Modify: `src/components/server/HostServerView.tsx`

**Interfaces:**
- Consumes: `remoteAgent.{listBackups,backupNow,downloadBackup,deleteBackup,restoreBackup}`
  (Task 7), `selectedHost`, `status` (existing state in this component), `rfd`-backed save
  dialog via the existing `select_folder`/`select_file` command pattern already used elsewhere
  in this codebase for "choose where to save" flows.

- [ ] **Step 1: State and data loading**

Add near the other `selectedHost`-scoped `useState` calls (after `isSyncingMods`, around line
52):

```typescript
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [restoringName, setRestoringName] = useState<string | null>(null);
```

Add `BackupInfo` to the type-only import at `src/components/server/HostServerView.tsx:20`:

```typescript
import type { GameInstance, SystemInfo, ServerPropertiesSummary, HostedServerStatus, BackupInfo } from '../../types';
```

Add a loader function near the other `refresh*`-style handlers (next to wherever
`refreshStatus`/equivalent already lives in this component):

```typescript
  const refreshBackups = async () => {
    if (!selectedHost) {
      setBackups([]);
      return;
    }
    try {
      setBackups(await remoteAgent.listBackups(selectedHost));
    } catch {
      // Same pattern as refreshStatus elsewhere in this component: a transient agent error
      // here shouldn't blank out state the last successful poll already populated.
    }
  };
```

Call it once whenever `selectedHost` changes — add to the existing effect that already runs on
`[selectedId, selectedHostId]` (around line 125), or add a small standalone one:

```typescript
  useEffect(() => {
    refreshBackups();
  }, [selectedHost?.id]);
```

- [ ] **Step 2: Handlers**

```typescript
  const handleBackupNow = async () => {
    if (!selectedHost) return;
    setIsBackingUp(true);
    try {
      await remoteAgent.backupNow(selectedHost);
      await refreshBackups();
    } catch (err) {
      setError(String(err));
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleDownloadBackup = async (name: string) => {
    if (!selectedHost) return;
    const savePath = await invokeCommand<string | null>('select_save_path', { defaultName: name });
    if (!savePath) return;
    try {
      await remoteAgent.downloadBackup(selectedHost, name, savePath);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleDeleteBackup = async (name: string) => {
    if (!selectedHost) return;
    if (!window.confirm(t.hostServerDeleteBackupConfirm || `Delete backup "${name}"? This cannot be undone.`)) return;
    try {
      await remoteAgent.deleteBackup(selectedHost, name);
      await refreshBackups();
    } catch (err) {
      setError(String(err));
    }
  };

  const handleRestoreBackup = async (name: string) => {
    if (!selectedHost) return;
    if (
      !window.confirm(
        t.hostServerRestoreBackupConfirm ||
          `Restore "${name}"? This overwrites the current world and stops the server if it's running.`
      )
    )
      return;
    setRestoringName(name);
    try {
      await remoteAgent.restoreBackup(selectedHost, name);
      await refreshStatus();
    } catch (err) {
      setError(String(err));
    } finally {
      setRestoringName(null);
    }
  };
```

`select_save_path` is the command Task 7 Step 1 added.

- [ ] **Step 3: Render the Backups section**

Add right after the "Sync Mods" button block (`src/components/server/HostServerView.tsx:645-655`,
the `{selectedHost && (<button ... Sync Mods ...>)}` block), before the "Live console" comment:

```tsx
              {selectedHost && (
                <div className="rounded-2xl bg-white/[0.02] border border-white/[0.06] overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-white/[0.06] flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                      {t.hostServerBackupsTitle || 'Backups'} ({backups.length})
                    </span>
                    <button
                      type="button"
                      onClick={handleBackupNow}
                      disabled={isBackingUp}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white/10 hover:bg-white/15 text-white flex items-center gap-1.5 cursor-pointer active:scale-95 transition disabled:opacity-40"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isBackingUp ? 'animate-spin' : ''}`} />
                      <span>{isBackingUp ? t.hostServerBackingUp || 'Backing up...' : t.hostServerBackupNow || 'Backup now'}</span>
                    </button>
                  </div>
                  <div className="divide-y divide-white/5 max-h-56 overflow-y-auto custom-scrollbar">
                    {backups.length === 0 ? (
                      <p className="px-4 py-3 text-xs text-slate-500">{t.hostServerNoBackupsYet || 'No backups yet.'}</p>
                    ) : (
                      backups.map((b) => (
                        <div key={b.name} className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs">
                          <div className="min-w-0">
                            <div className="font-mono text-slate-200 truncate">{new Date(b.createdAt * 1000).toLocaleString()}</div>
                            <div className="text-slate-500">{(b.sizeBytes / 1024 / 1024).toFixed(1)} MB</div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleDownloadBackup(b.name)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
                              title={t.hostServerDownloadBackup || 'Download'}
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRestoreBackup(b.name)}
                              disabled={restoringName === b.name}
                              className="p-1.5 rounded-lg text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 transition cursor-pointer disabled:opacity-40"
                              title={t.hostServerRestoreBackup || 'Restore'}
                            >
                              {restoringName === b.name ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <RotateCcw className="w-3.5 h-3.5" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteBackup(b.name)}
                              className="p-1.5 rounded-lg text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 transition cursor-pointer"
                              title={t.hostServerDeleteBackup || 'Delete'}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
```

Add `RotateCcw` and `Loader2` to this file's `lucide-react` import block
(`src/components/server/HostServerView.tsx:3-17`) — `Download`, `RefreshCw`, and `Trash2` are
already imported there.

- [ ] **Step 4: Render the resource strip**

Somewhere in the existing status card that already shows `status.state` for the selected host
(find it by searching this file for where `status.state` is first rendered), add, gated on
`status?.system` being present:

```tsx
              {status?.system && (
                <div className="grid grid-cols-3 gap-3 text-xs">
                  <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06]">
                    <div className="text-slate-500 uppercase tracking-wider text-[10px] mb-1">CPU</div>
                    <div className="font-mono text-white font-bold">{status.system.cpuPercent.toFixed(0)}%</div>
                  </div>
                  <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06]">
                    <div className="text-slate-500 uppercase tracking-wider text-[10px] mb-1">RAM</div>
                    <div className="font-mono text-white font-bold">
                      {(status.system.memUsedMb / 1024).toFixed(1)} / {(status.system.memTotalMb / 1024).toFixed(1)} GB
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06]">
                    <div className="text-slate-500 uppercase tracking-wider text-[10px] mb-1">Disk</div>
                    <div className="font-mono text-white font-bold">
                      {(status.system.diskUsedMb / 1024).toFixed(1)} / {(status.system.diskTotalMb / 1024).toFixed(1)} GB
                    </div>
                  </div>
                </div>
              )}
```

- [ ] **Step 5: Verify it builds and type-checks**

Run: `npx tsc -b && npm run build`
Expected: no errors.

- [ ] **Step 6: Manual browser-preview check**

Start the dev server (`preview_start` with the `mcl-dev` launch config, per this project's
established workflow), navigate to Host Server, select a remote host if one is configured, and
confirm the Backups section and resource strip render without console errors. A real backup
round-trip against a live agent isn't reachable from browser preview (no Tauri backend there);
that's covered by Task 9's manual pass against the real VM.

- [ ] **Step 7: Commit**

```bash
git add src/components/server/HostServerView.tsx
git commit -m "feat(desktop): add Backups section and resource strip to Host Server view"
```

---

### Task 9: Full verification against the real agent

**Files:** none (verification only)

- [ ] **Step 1: Full Rust test suite**

Run: `cargo test --offline`
Expected: every existing test still passes, plus the 4 new ones from Tasks 1 and 2
(`read_level_name_finds_a_custom_name_and_falls_back_to_world`,
`backup_scope_includes_...`, `a_created_backup_can_be_listed_and_restored`,
`rotation_keeps_only_the_newest_n_and_deletes_the_rest`).

- [ ] **Step 2: Both binaries build**

Run: `cargo build --offline` (desktop, default features) and
`cargo build --offline --bin mcl-agent --no-default-features --features agent`
Expected: both succeed.

- [ ] **Step 3: Deploy the updated agent to the real VM and exercise every endpoint**

Build the Linux agent binary (cross-compile, or build directly on the VM via `ssh mcl` using
the same `cargo build --release --bin mcl-agent --no-default-features --features agent` command
`docs/mcl-agent-remote-hosting.md` already documents), replace the running one, restart the
`mcl-agent` systemd service, then from MCL's Host Server tab against that real host: prepare and
start a server, click **Backup now**, confirm it appears in the list with a plausible size,
**Download** it and confirm the `.zip` opens and contains the world folder, **Restore** it and
confirm the server's world is intact afterward, **Delete** an old backup, and confirm the CPU/
RAM/disk numbers in the resource strip roughly match what `htop`/`free -h`/`df -h` report on
the VM directly over `ssh mcl`.

- [ ] **Step 4: Confirm CI is green**

Push and check the `CI` GitHub Actions workflow (`gh run list --branch main --limit 1`,
`gh run watch <run-id>` or repeated `gh run view` until `completed`/`success`).
