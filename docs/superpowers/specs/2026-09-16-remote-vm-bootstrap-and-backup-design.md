# Remote VM Bootstrap & Agent Backup/Monitoring — Design

## 1. Motivation

The user rented an Oracle Cloud VM (Singapore, 12 vCPU / 32GB RAM / 256GB disk, Ubuntu 24.04,
currently blank) to host a Minecraft server, and wants an in-app UI to set it up and manage it
optimally: performance, clean/maintainable data layout, and emergency backups.

MCL already has a working remote-hosting subsystem for the *ongoing management* half of this:
`mcl-agent` is a standalone daemon meant to run on the VM, exposing an authenticated HTTPS API
(`src-tauri/src/bin/mcl_agent.rs`) that the desktop app already talks to for start/stop,
console, `server.properties` editing, and mod sync (`src-tauri/src/remote_agent.rs`,
`src/services/remoteAgent.ts`, `src/components/server/HostServerView.tsx`). That part is not
being redesigned here.

Two things are genuinely missing:

- **Getting the agent onto a blank VM** currently requires the operator to manually SSH in, run
  an install script, and copy-paste a token and a certificate into MCL by hand
  (`docs/mcl-agent-remote-hosting.md`). This is the one place SSH is still the right tool, since
  before the agent exists there is nothing else to talk to.
- **Backup/restore and resource visibility** don't exist anywhere in the agent's API yet
  (`GET /v1/status`, `/v1/prepare`, `/v1/start`, `/v1/stop`, `/v1/console`, `/v1/properties`,
  `/v1/mods`, `/v1/logs`, `/v1/health` — no backup endpoints, no CPU/RAM/disk fields).

This spec covers both, as two independent pieces of work.

## 2. Scope

**In scope:**
- Part A: a guided in-app wizard that SSHes into a blank Linux VM once, installs Java if
  missing, installs `mcl-agent` via the existing `scripts/install-agent.sh`, and auto-fills the
  "Add a remote host" form — no manual copy-pasting.
- Part B: backup/restore endpoints added to `mcl-agent`, a self-scheduled daily backup inside
  the agent (independent of whether the desktop app is open), and CPU/RAM/disk fields added to
  its status response, all surfaced in `HostServerView`'s remote-host UI.

**Out of scope (noted, not built here):**
- Multi-server-per-VM support (the user chose a single server for v1; the agent already only
  ever manages one server per data directory, so this isn't a regression, just not extended).
- Non-apt Linux distros (the existing `install-agent.sh` already assumes systemd + is exercised
  on Debian/Ubuntu only; the bootstrap wizard inherits that same assumption rather than adding
  new distro-detection logic the script itself doesn't have).
- Cloud-provider firewall/Security List automation — Oracle Cloud's Security List is a
  console-level setting outside the VM's own OS, nothing running on the VM (agent or an SSH
  session) can change it. The wizard best-efforts the OS-level firewall (`ufw`) and otherwise
  surfaces a clear, persistent reminder instead of silently assuming it's open.
- Off-VM backup destinations other than the operator's own machine (e.g. S3/Object Storage) —
  the user picked "download to my machine via MCL" for v1.

## 3. Architecture Overview

```
┌─────────────────┐   SSH (once, to bootstrap)   ┌──────────────────────┐
│  MCL Desktop     │ ────────────────────────────▶│  Blank VM            │
│  (mcl-client)    │                               │  (installs mcl-agent)│
│                  │   HTTPS + bearer token         │                      │
│                  │   (every request after that)   │  mcl-agent (daemon)  │
│                  │ ◀────────────────────────────▶│  ├─ server_host.rs    │
└─────────────────┘                                │  ├─ backup scheduler │
                                                     │  └─ sysinfo stats    │
                                                     └──────────────────────┘
```

Part A adds one new Rust module (`vm_bootstrap.rs`) to the **desktop** binary only — it is never
linked into `mcl-agent` (the agent has no reason to SSH anywhere). Part B extends the **agent**
binary's existing HTTP API and adds a background task; the desktop-side changes for Part B are
just new thin wrapper functions next to the ones already in `remote_agent.rs` /
`remoteAgent.ts`, following the exact pattern `remote_agent_start_log_stream` already
establishes for streaming.

## 4. Part A — SSH Bootstrap Wizard

### 4.1 New dependency and feature gate

Add `russh` (pure-Rust SSH client, async/tokio-native — no OpenSSL/libssh2 to vendor for the
Windows build, unlike `ssh2`). Following the exact pattern `iroh` already uses for `p2p`
(`src-tauri/Cargo.toml`):

```toml
russh = { version = "0", optional = true }  # pin to whatever's current on crates.io at implementation time

[features]
default = ["p2p", "remote-setup"]
remote-setup = ["dep:russh"]
```

This keeps `russh` out of the `mcl-agent` binary (`--no-default-features --features agent`
already excludes everything not explicitly listed), matching the project's existing "keep the
VPS-exposed binary lean" rule.

### 4.2 New module: `src-tauri/src/vm_bootstrap.rs`

```rust
pub struct BootstrapRequest {
    pub host: String,           // "140.245.125.66" — also becomes the agent URL's host
    pub port: u16,              // default 22
    pub username: String,       // default "ubuntu" (Oracle's default cloud-init user)
    pub private_key_path: String,
    pub agent_port: u16,        // default 8642, matches install-agent.sh's default
}

pub struct BootstrapOutcome {
    pub url: String,
    pub token: String,
    pub cert_pem: String,
}

pub async fn run_bootstrap(
    app: AppHandle,
    stream_id: String,
    req: BootstrapRequest,
) -> Result<BootstrapOutcome, String>
```

`BootstrapOutcome` mirrors `RemoteHostConfig` (`src-tauri/src/remote_agent.rs`) exactly — the
same `{ url, token, certPem }` shape every existing remote-agent command already takes, not the
full `RemoteHost` (which also carries `id`/`name` and only ever exists on the frontend, built by
`handleAddHost` in `HostServerView.tsx` via `id: Date.now().toString()`). The wizard builds the
full `RemoteHost` itself the same way once `vm_bootstrap_start` resolves, then calls
`saveRemoteHosts` — Part A never needs to know about `id`/display name at all.

Steps, each emitting a `"vm-bootstrap-progress"` event (same `{ stream_id, line }` shape
`RemoteLogEvent` already uses in `remote_agent.rs`, reused as-is) before and after so the UI can
show a live checklist:

1. **Connect.** Open the SSH session with `russh`, authenticate with the selected private key
   file (read from disk, never stored by MCL — matches the user's explicit choice). A failure
   here (wrong host, refused key, timeout) stops immediately with a specific message ("SSH
   handshake failed: ...", "Host unreachable: ...") rather than a generic error.
2. **Check Java.** Run `command -v java`. If missing, run
   `sudo apt-get update && sudo apt-get install -y openjdk-21-jre-headless` and stream its
   output live. (Oracle's `ubuntu` cloud-init user has passwordless sudo by default; if `sudo`
   prompts for a password the command will hang until the SSH channel's read times out, at
   which point the step fails with a message telling the operator to grant passwordless sudo or
   install Java manually first — this is a known, documented limitation, not silently retried.)
3. **Best-effort firewall.** If `ufw status` reports `active`, run
   `sudo ufw allow <agent_port>/tcp` and `sudo ufw allow 25565/tcp`. Failures here are logged as
   a warning line, not a fatal error — the VM may not use `ufw` at all (Oracle's default image
   doesn't enable it), and this is not the layer that actually needs opening (see step 6).
4. **Install the agent.** Run the exact command already documented in
   `docs/mcl-agent-remote-hosting.md`:
   `curl -fsSL https://raw.githubusercontent.com/pecora31/MCL-Client/main/scripts/install-agent.sh | sudo MCL_AGENT_PORT=<agent_port> bash`.
   Streamed live, same as step 2. This deliberately reuses the script as-is instead of
   reimplementing its systemd/cert-generation logic a second time in Rust — one source of
   truth, already documented and already the thing a manual operator would run.
5. **Read back credentials.** Rather than scraping the script's printed `URL:`/`Token:` lines
   (fragile if the script's wording ever changes), run two follow-up commands and read their
   output directly: `cat /var/lib/mcl-agent/agent-token.txt` and
   `cat /var/lib/mcl-agent/agent-cert.pem` (data dir path fixed at the script's own default for
   v1, since the wizard doesn't expose a custom `MCL_AGENT_DIR` option). The agent URL is built
   from the **SSH host itself** (`https://<host>:<agent_port>`) rather than the script's own
   `ifconfig.me` lookup, since that's the address the wizard already proved is reachable a
   moment ago.
6. **Verify end-to-end.** Call the existing `remote_agent_status` Tauri command against the
   freshly-built `RemoteHostConfig`. This is what actually proves port `agent_port` is reachable
   from the outside — catching the Oracle Cloud Security List gap (see §2, out of scope)
   immediately, with a clear message: *"Agent installed, but MCL can't reach it from outside
   the VM. Open port `<agent_port>` (and 25565 for players) in your cloud provider's firewall/
   Security List, then click Retry."* A **Retry** action re-runs only this step, not the whole
   bootstrap.

### 4.3 Tauri commands

```rust
#[tauri::command]
async fn vm_bootstrap_start(app: AppHandle, stream_id: String, req: BootstrapRequest) -> Result<BootstrapOutcome, String>
#[tauri::command]
async fn vm_bootstrap_retry_verify(host: RemoteHostConfig) -> Result<(), String>
```

`vm_bootstrap_start` is the only long-running one; it drives steps 1–6 and emits progress as it
goes, then resolves with the finished `BootstrapOutcome` on success (or rejects with the message
from whichever step failed — the UI has already shown *why* via the progress log, the rejection
just unblocks the "Connect & Install" button).

### 4.4 Frontend

New file `src/components/server/VmBootstrapWizard.tsx`, opened from a new "Set up a new VM
automatically" button next to the existing manual "Add a remote host" entry point in
`HostServerView.tsx`. Fields: Host/IP, SSH port (default 22), SSH username (default `ubuntu`),
private key file (via `rfd`'s native picker, already a dependency — same pattern other file
pickers in this codebase already use), agent port (default 8642, advanced/collapsed by
default), display name for the host.

A live-scrolling log panel (visually similar to the existing server console) shows each
progress line as it streams in. On success, the wizard calls `saveRemoteHosts([...existing,
newHost])` (the exact same function the manual flow already uses) and closes, landing the user
on the now-configured remote host exactly as if they'd pasted the values in by hand.

### 4.5 Error handling

Every step's failure message is specific enough to act on (see step-by-step list above); none
of them are swallowed into a generic "bootstrap failed." The wizard never retries a failed step
automatically — Oracle billing/quota and VM state are the user's to control, and a silent retry
loop against a host that just rejected a connection is more likely to look like a hang than help.

## 5. Part B — Agent Backup/Restore & Resource Monitoring

### 5.1 Backup scope

A backup archives only what's actually irreplaceable player data, not the whole `server_dir()`:

- The world folder(s) named after `level-name` in `server.properties` (plus that name's
  `_nether` / `_the_end` siblings, which is how vanilla/Paper lay out the End and Nether by
  default).
- `server.properties`, `whitelist.json`, `ops.json`, `banned-players.json`, `banned-ips.json`,
  `usercache.json`.

Explicitly **excluded**: the loader jar and `libraries/` (fully reproducible from `spec.json` via
the same `/v1/prepare` logic already used to set the server up the first time), `logs/`,
`crash-reports/`, any cache directories. This keeps each archive proportional to actual player
data instead of ballooning with redownloadable jars — directly serving the "clean, maintainable
data" goal from the original request.

Archived with the `zip` crate (already a dependency, already used elsewhere in this codebase —
no new dependency for this part).

### 5.2 New agent endpoints

All under the same bearer-token middleware every other route already uses
(`require_token`, `src/bin/mcl_agent.rs:394`).

```
POST   /v1/backups              → trigger one now, returns its metadata immediately (blocking until done — a backup of a few hundred MB takes low single-digit seconds to zip, no need for an async job/poll pattern)
GET    /v1/backups              → list existing backups: [{ name, sizeBytes, createdAt }]
GET    /v1/backups/:name        → streams the archive bytes (same download shape callers already use for other binary responses)
DELETE /v1/backups/:name        → removes one
POST   /v1/restore              → { name: string } — stops the server if running, extracts that
                                    archive over the current world/config files (overwriting
                                    them), does not restart automatically (the operator presses
                                    Start themselves once they're ready)
```

Stored at `<data_dir>/backups/<timestamp>.zip` (`AppState` gains a `backups_dir()` helper next
to the existing `common_dir()`/`server_dir()`). Rotation: after each scheduled or manual backup,
delete the oldest beyond the configured retention count (default 7, one field in `spec.json`
alongside the loader/version info already stored there).

### 5.3 Scheduler

A `tokio::spawn`'d background task started once at agent boot (next to where `accept_task`-style
long-running tasks are already spawned in `main()`), sleeping until the next scheduled run
(default: once every 24h from agent start — no cron parsing needed for v1, a fixed interval is
enough and much simpler) and calling the same internal function `POST /v1/backups` calls. This
runs whether or not the desktop app is connected, which is the entire point: the VM is meant to
run unattended, so "emergency backup" can't depend on a laptop being open.

### 5.4 Resource monitoring

Extend `HostedServerStatus` (or add a sibling struct returned by the same `/v1/status` call, to
avoid a second round-trip) with a `system: SystemStats` field:

```rust
pub struct SystemStats {
    pub cpu_percent: f32,
    pub mem_used_mb: u64,
    pub mem_total_mb: u64,
    pub disk_used_mb: u64,
    pub disk_total_mb: u64,
}
```

Populated via `sysinfo` (already a dependency). No new endpoint needed.

### 5.5 Desktop-side additions

`src-tauri/src/remote_agent.rs` gains thin wrapper commands
(`remote_agent_list_backups`, `remote_agent_backup_now`, `remote_agent_download_backup`,
`remote_agent_delete_backup`, `remote_agent_restore_backup`) following the exact shape the
existing commands in that file already use (cert-pinned `reqwest::Client` built via
`client_for(&host)`, bearer token from `host.token`). `remote_agent_download_backup` writes the
streamed bytes to a path chosen via `rfd`'s save dialog, same as any other "save to disk" flow
in this app.

`src/services/remoteAgent.ts` gains matching thin functions, mirroring the existing
`remoteAgent.status`/`remoteAgent.start` style exactly.

### 5.6 Frontend

A new "Backups" section inside `HostServerView`'s remote-host panel (only rendered when the
selected host is remote, next to the existing console/mods sections): a list (name, size,
relative time), a **Backup now** button, per-row **Download** and **Delete**, and **Restore**
(behind a confirm dialog, since it overwrites the live world — matches this codebase's existing
pattern for destructive actions, e.g. the kick-confirm in `P2PDirectConnectCard.tsx`). A small
resource strip (CPU/RAM/disk bars) sits in the existing remote-host status card, fed by the
extended `/v1/status` response.

## 6. Data Model Changes

- `mcl-agent`: `spec.json` gains `backupRetentionCount: u32` (default 7). New `backups/`
  subdirectory under the agent's data dir.
- Frontend: `RemoteHost` (`src/services/remoteAgent.ts`) is unchanged — Part A only ever
  *produces* a `RemoteHost`, it doesn't need a new shape of its own.
- `src/types/index.ts`: new `BackupInfo { name: string; sizeBytes: number; createdAt: string }`
  and `SystemStats` (camelCase mirror of the Rust structs above, same convention every other
  type in that file already follows).

## 7. Security Considerations

- The private key file is read from disk for the duration of one SSH session and never copied
  into MCL's own storage or logs — matches the user's explicit choice in this conversation.
- Bootstrap progress logs (streamed to the UI and nowhere else) may contain command output; the
  `apt`/`curl`/`ufw` commands run here don't print secrets, but the token/cert read-back step
  (§4.2 step 5) deliberately reads the files directly rather than echoing them through a log
  line that might otherwise get captured somewhere unintended.
- New agent endpoints sit behind the same bearer-token middleware as every existing one — no new
  auth mechanism introduced.
- `POST /v1/restore` is destructive by design (that's its job); it is not reachable without the
  same bearer token every other mutating endpoint already requires, and the frontend gates it
  behind an explicit confirmation like every other destructive action in this app.

## 8. Testing Strategy

- Rust unit tests for the backup archive scope logic (given a `server.properties` with a
  non-default `level-name`, confirm the right folder names are selected; confirm excluded paths
  like `libraries/` never end up in the archive) and for rotation (retention count enforced,
  oldest deleted first) — pure functions, testable without a real VM, following this codebase's
  existing style of testing file-layout logic directly (`server_config::tests`,
  `mod_conflicts::tests`).
- The SSH bootstrap steps themselves are not unit-testable without a real or containerized SSH
  target; verification is manual, against the user's actual Oracle VM (already confirmed
  reachable via `ssh mcl` in this conversation) — run the wizard end-to-end once implemented,
  the same way P2P reconnect behavior in this codebase has been manually verified rather than
  mocked.
- `cargo build`/`cargo test --offline` for both the default desktop feature set and
  `--no-default-features --features agent` (confirming `russh` never ends up in the agent
  binary), `npx tsc -b`, `npm run build`, and a browser-preview pass of the new wizard and
  Backups UI, per this project's established verification routine.

## 9. Out of Scope / Future Work

- Multiple servers per VM.
- Non-apt distros for the bootstrap wizard.
- Automating Oracle Cloud's Security List from within MCL (would need Oracle's own cloud API and
  credentials — a materially different, much larger scope than anything else here).
- Off-VM backup destinations beyond "download to the operator's own machine."
- Cron-style configurable backup schedule (v1 ships a fixed 24h interval).
