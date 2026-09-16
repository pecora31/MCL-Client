# VM Bootstrap Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let MCL SSH into a blank Linux VM once, install Java if missing, install `mcl-agent`
via the existing install script, and auto-fill the "Add a remote host" form — replacing the
current fully-manual SSH-in/copy-paste-token-and-cert setup flow with an in-app wizard.

**Architecture:** One new **desktop-only** Rust module, `src-tauri/src/vm_bootstrap.rs`, using
`russh` (pure-Rust SSH client) to run a fixed sequence of commands over one SSH session,
streaming each step's progress to the frontend as `"vm-bootstrap-progress"` Tauri events. It's
feature-gated (`remote-setup`, on by default, off for the `mcl-agent` binary) with a stub module
mirroring `p2p_tunnel`/`p2p_tunnel_stub`'s existing swap pattern, since `mcl-agent` never SSHes
anywhere and has no reason to link `russh`. The frontend is one new component,
`VmBootstrapWizard.tsx`: a form, a live progress log, and on success, the exact same
`saveRemoteHosts` call the manual "Add a remote host" flow already uses.

**Tech Stack:** Rust (`russh`, new dependency), React/TypeScript.

**Spec:** `docs/superpowers/specs/2026-09-16-remote-vm-bootstrap-and-backup-design.md`
(§4 Part A, §7 Data Model, §8 Security, §9 Testing — this plan implements those sections only;
Parts B and C are separate plans).

## Global Constraints

- `russh` must never end up in the `mcl-agent` binary — it's gated behind a `remote-setup`
  Cargo feature (on by default for the desktop app, off for
  `--no-default-features --features agent`), following the exact pattern `iroh`/`p2p` already
  established in `src-tauri/Cargo.toml`.
- Every bootstrap step's failure message is specific to that step (see Task 3) — never a bare
  "bootstrap failed."
- The wizard never retries a failed step automatically. A **Retry** action only ever re-runs the
  final verification step (see Task 3's credentials event), never the whole install.
- The private key file is read from disk for the duration of one SSH session and never copied
  into MCL's own storage, logs, or progress events.
- Assumes an apt-based (Debian/Ubuntu) target, matching `scripts/install-agent.sh`'s own
  assumption — no new distro-detection logic.
- New Rust structs use `#[serde(rename_all = "camelCase")]`; new TS types use camelCase.
- Every new `#[tauri::command]` name must be added to `TAURI_COMMANDS` in
  `src/services/api.ts`.

---

### Task 1: Add the `russh` dependency and `remote-setup` feature

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add the dependency and feature**

In `src-tauri/Cargo.toml`, add to `[dependencies]` (near `iroh`, since both are optional and
feature-gated the same way):

```toml
russh = { version = "0", optional = true }
```

Run `cargo add russh --optional -p mcl-client` from `src-tauri/` instead if available, so Cargo
resolves and pins whatever's actually current on crates.io rather than trusting a guessed
version number here.

Change the `[features]` block from:

```toml
default = ["p2p"]
p2p = ["dep:iroh"]
```

to:

```toml
default = ["p2p", "remote-setup"]
p2p = ["dep:iroh"]
remote-setup = ["dep:russh"]
```

- [ ] **Step 2: Verify it resolves**

Run: `cargo build --offline` (or without `--offline` on the first run, so Cargo can actually
fetch the new dependency and its lockfile entry)
Expected: `russh` and its transitive dependencies appear in `Cargo.lock`; the desktop build
succeeds. Don't worry about `vm_bootstrap.rs` yet — it doesn't exist until Task 2, so nothing
uses `russh` at this point, which is fine, an unused optional dependency doesn't fail the build.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore(desktop): add russh dependency behind a remote-setup feature"
```

---

### Task 2: Low-level SSH plumbing, verified against the real VM early

`russh`'s exact client API (session handshake, auth, channel exec, reading output) can differ in
small ways between minor versions, and this plan can't pin down which patch version Task 1
resolved to ahead of time. Rather than write all six bootstrap steps on top of unverified
plumbing and find out at the very end whether it even connects, this task isolates just the
"connect, run one command, get its output back" primitive and checks it against the real VM
(`ssh mcl`, already confirmed reachable earlier in this project) before anything else is built
on top of it.

**Files:**
- Create: `src-tauri/src/vm_bootstrap.rs`

**Interfaces:**
- Produces: `async fn connect(host: &str, port: u16, username: &str, private_key_path: &str) -> Result<russh::client::Handle<AcceptAnyHostKey>, String>`,
  `async fn run_remote_command(session: &mut russh::client::Handle<AcceptAnyHostKey>, command: &str) -> Result<(String, u32), String>`
  (both used by every step in Task 3).

- [ ] **Step 1: Write the plumbing**

```rust
//! Bootstraps a blank Linux VM into a running `mcl-agent` host over SSH — the one place SSH is
//! still the right tool, since before the agent exists there is nothing else on the VM to talk
//! to (see the design spec, Part A). Every step streams its progress to the frontend as a
//! `"vm-bootstrap-progress"` event so the wizard can show a live checklist.

use russh::client::{self, Handle};
use russh::keys::{load_secret_key, PublicKey};
use russh::ChannelMsg;
use std::sync::Arc;

/// Accepts whatever host key the VM presents — trust-on-first-use, the same model a manual
/// `ssh` client uses the first time it connects to a new host (the "are you sure you want to
/// continue connecting?" prompt). There is no previously pinned key to compare against: this
/// wizard's entire job is the *first* connection to a VM the operator just told MCL the address
/// and key for.
pub struct AcceptAnyHostKey;

impl client::Handler for AcceptAnyHostKey {
    type Error = russh::Error;

    async fn check_server_key(&mut self, _server_public_key: &PublicKey) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

async fn connect(host: &str, port: u16, username: &str, private_key_path: &str) -> Result<Handle<AcceptAnyHostKey>, String> {
    let key_pair = load_secret_key(private_key_path, None)
        .map_err(|e| format!("Could not read the private key at {}: {}", private_key_path, e))?;
    let config = Arc::new(client::Config::default());
    let mut session = client::connect(config, (host, port), AcceptAnyHostKey)
        .await
        .map_err(|e| format!("Host unreachable: {}", e))?;
    let auth_result = session
        .authenticate_publickey(username, Arc::new(key_pair))
        .await
        .map_err(|e| format!("SSH handshake failed: {}", e))?;
    if !auth_result.success() {
        return Err("The VM rejected this key for this username.".to_string());
    }
    Ok(session)
}

/// Opens one exec channel, sends `command`, and collects its combined stdout+stderr and exit
/// code. One command per call rather than a persistent shell — every step in this module only
/// ever needs to run one command and see whether it succeeded.
async fn run_remote_command(session: &mut Handle<AcceptAnyHostKey>, command: &str) -> Result<(String, u32), String> {
    let mut channel = session.channel_open_session().await.map_err(|e| e.to_string())?;
    channel.exec(true, command).await.map_err(|e| e.to_string())?;

    let mut output = String::new();
    let mut exit_code = 0u32;
    loop {
        let Some(msg) = channel.wait().await else { break };
        match msg {
            ChannelMsg::Data { data } => output.push_str(&String::from_utf8_lossy(&data)),
            ChannelMsg::ExtendedData { data, .. } => output.push_str(&String::from_utf8_lossy(&data)),
            ChannelMsg::ExitStatus { exit_status } => exit_code = exit_status,
            ChannelMsg::Eof | ChannelMsg::Close => break,
            _ => {}
        }
    }
    Ok((output, exit_code))
}
```

If this doesn't compile as-is against whatever version Task 1 resolved to, consult that
version's docs.rs page (`https://docs.rs/russh/<version>/russh/client/index.html`) for its own
client example — the connect → authenticate → open a channel → exec → read `ChannelMsg`s
sequence has been stable across recent `russh` releases even where exact type paths or trait
signatures (e.g. whether `Handler` methods are `async fn` directly or need `#[async_trait]`)
have shifted. Adjust `AcceptAnyHostKey`/`connect`/`run_remote_command` to match; nothing in
Task 3 depends on their internals, only their signatures above.

- [ ] **Step 2: Verify it builds**

Run: `cargo build --offline --features remote-setup`
Expected: builds cleanly (fix any API mismatch per the note above before moving on).

- [ ] **Step 3: Manually verify against the real VM**

Add a throwaway, `#[ignore]`d integration test at the bottom of
`src-tauri/src/vm_bootstrap.rs` — this never runs in CI (no VM there) but gives a concrete,
one-command way to prove the plumbing actually works against the real Oracle VM before building
the rest of the wizard on top of it:

```rust
#[cfg(test)]
mod manual_verification {
    use super::*;

    /// Not part of the automated suite — run by hand against the real VM with:
    /// `cargo test --offline --features remote-setup -- --ignored connects_and_runs_echo`
    /// Replace the arguments below with the real values from `~/.ssh/config`'s `mcl` entry
    /// before running (host `140.245.125.66`, user `ubuntu`, key
    /// `C:\Users\Tran Bao Long\.ssh\oracle-mcl.key`, matching what this project already uses).
    #[tokio::test]
    #[ignore]
    async fn connects_and_runs_echo() {
        let mut session = connect("140.245.125.66", 22, "ubuntu", r"C:\Users\Tran Bao Long\.ssh\oracle-mcl.key")
            .await
            .expect("connect should succeed against the real VM");
        let (output, code) = run_remote_command(&mut session, "echo hello-from-mcl")
            .await
            .expect("running a command should succeed");
        assert_eq!(code, 0);
        assert!(output.contains("hello-from-mcl"));
    }
}
```

Run: `cargo test --offline --features remote-setup -- --ignored connects_and_runs_echo`
Expected: PASS. If it fails, fix `connect`/`run_remote_command` (not the bootstrap steps —
those don't exist yet) until this passes, since every later task depends on this working.

Once it passes, delete this `manual_verification` module (it served its purpose as an early
checkpoint; it isn't part of the plan's permanent test suite and would otherwise be dead code
sitting in the shipped module).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/vm_bootstrap.rs src-tauri/src/lib.rs
git commit -m "feat(desktop): add SSH connect/exec plumbing for the VM bootstrap wizard"
```

(`src-tauri/src/lib.rs` isn't touched yet in this task — included here only because the next
task's diff builds directly on this one; if `git status` shows nothing staged for it, that's
fine, just commit `vm_bootstrap.rs` alone.)

---

### Task 3: The six bootstrap steps

**Files:**
- Modify: `src-tauri/src/vm_bootstrap.rs`

**Interfaces:**
- Consumes: `connect`, `run_remote_command`, `AcceptAnyHostKey` (Task 2),
  `remote_agent::{RemoteHostConfig, remote_agent_status}` (existing).
- Produces:
  - `pub struct BootstrapRequest { pub host: String, pub port: u16, pub username: String, pub private_key_path: String, pub agent_port: u16 }`
    (derives `Debug, Deserialize`, `#[serde(rename_all = "camelCase")]`)
  - `pub struct BootstrapOutcome { pub url: String, pub token: String, pub cert_pem: String }`
    (derives `Debug, Clone, Serialize`, `#[serde(rename_all = "camelCase")]`)
  - `pub async fn run_bootstrap(app: AppHandle, stream_id: String, req: BootstrapRequest) -> Result<BootstrapOutcome, String>`

- [ ] **Step 1: Add the request/outcome types and progress/credentials events**

Add near the top of `src-tauri/src/vm_bootstrap.rs`, after the existing `use` lines:

```rust
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

const DEFAULT_AGENT_PORT: u16 = 8642;
const AGENT_DATA_DIR: &str = "/var/lib/mcl-agent";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapRequest {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub private_key_path: String,
    pub agent_port: u16,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapOutcome {
    pub url: String,
    pub token: String,
    pub cert_pem: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BootstrapProgressEvent {
    stream_id: String,
    line: String,
}

fn emit_progress(app: &AppHandle, stream_id: &str, line: impl Into<String>) {
    let _ = app.emit("vm-bootstrap-progress", BootstrapProgressEvent { stream_id: stream_id.to_string(), line: line.into() });
}

/// Emitted once credentials are read back off the VM, *before* the final reachability check —
/// which is the one step most likely to fail on the first attempt (the operator hasn't opened
/// their cloud provider's firewall yet). Capturing this separately from `run_bootstrap`'s own
/// return value is what lets the frontend's Retry action re-check reachability with these same
/// credentials without re-running the whole install.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BootstrapCredentialsEvent {
    stream_id: String,
    url: String,
    token: String,
    cert_pem: String,
}
```

- [ ] **Step 2: Write `run_bootstrap`**

Add to the end of `src-tauri/src/vm_bootstrap.rs`:

```rust
pub async fn run_bootstrap(app: AppHandle, stream_id: String, req: BootstrapRequest) -> Result<BootstrapOutcome, String> {
    let agent_port = if req.agent_port == 0 { DEFAULT_AGENT_PORT } else { req.agent_port };

    emit_progress(&app, &stream_id, "Connecting over SSH...");
    let mut session = connect(&req.host, req.port, &req.username, &req.private_key_path).await?;
    emit_progress(&app, &stream_id, "Connected.");

    emit_progress(&app, &stream_id, "Checking for Java...");
    let (_, java_check_code) = run_remote_command(&mut session, "command -v java").await?;
    if java_check_code != 0 {
        emit_progress(&app, &stream_id, "Java not found, installing OpenJDK 21 (this can take a minute)...");
        let (install_output, install_code) =
            run_remote_command(&mut session, "sudo apt-get update && sudo apt-get install -y openjdk-21-jre-headless").await?;
        emit_progress(&app, &stream_id, install_output);
        if install_code != 0 {
            return Err(
                "Could not install Java. If `sudo` needs a password for this user, either grant \
                 passwordless sudo or install Java manually first, then retry."
                    .to_string(),
            );
        }
        emit_progress(&app, &stream_id, "Java installed.");
    } else {
        emit_progress(&app, &stream_id, "Java already installed.");
    }

    emit_progress(&app, &stream_id, "Checking the firewall...");
    let (ufw_status, _) = run_remote_command(&mut session, "sudo ufw status").await?;
    if ufw_status.contains("Status: active") {
        let _ = run_remote_command(&mut session, &format!("sudo ufw allow {}/tcp", agent_port)).await;
        let _ = run_remote_command(&mut session, "sudo ufw allow 25565/tcp").await;
        emit_progress(&app, &stream_id, "Opened the agent and Minecraft ports in ufw.");
    } else {
        emit_progress(&app, &stream_id, "ufw isn't active on this VM, skipping (nothing to open at the OS level).");
    }

    emit_progress(&app, &stream_id, "Installing mcl-agent...");
    let install_agent_cmd = format!(
        "curl -fsSL https://raw.githubusercontent.com/pecora31/MCL-Client/main/scripts/install-agent.sh | sudo MCL_AGENT_PORT={} bash",
        agent_port
    );
    let (agent_install_output, agent_install_code) = run_remote_command(&mut session, &install_agent_cmd).await?;
    emit_progress(&app, &stream_id, agent_install_output);
    if agent_install_code != 0 {
        return Err("mcl-agent installation script failed — see the log above for details.".to_string());
    }
    emit_progress(&app, &stream_id, "mcl-agent installed.");

    emit_progress(&app, &stream_id, "Reading the agent's token and certificate...");
    let (token_raw, token_code) = run_remote_command(&mut session, &format!("cat {}/agent-token.txt", AGENT_DATA_DIR)).await?;
    if token_code != 0 || token_raw.trim().is_empty() {
        return Err("Could not read the agent's token file after installation.".to_string());
    }
    let (cert_raw, cert_code) = run_remote_command(&mut session, &format!("cat {}/agent-cert.pem", AGENT_DATA_DIR)).await?;
    if cert_code != 0 || cert_raw.trim().is_empty() {
        return Err("Could not read the agent's certificate file after installation.".to_string());
    }

    let outcome = BootstrapOutcome {
        url: format!("https://{}:{}", req.host, agent_port),
        token: token_raw.trim().to_string(),
        cert_pem: cert_raw.trim().to_string(),
    };

    let _ = app.emit(
        "vm-bootstrap-credentials",
        BootstrapCredentialsEvent {
            stream_id: stream_id.clone(),
            url: outcome.url.clone(),
            token: outcome.token.clone(),
            cert_pem: outcome.cert_pem.clone(),
        },
    );

    emit_progress(&app, &stream_id, "Verifying MCL can reach the agent from outside the VM...");
    let host_config = crate::remote_agent::RemoteHostConfig {
        url: outcome.url.clone(),
        token: outcome.token.clone(),
        cert_pem: outcome.cert_pem.clone(),
    };
    crate::remote_agent::remote_agent_status(host_config).await.map_err(|e| {
        format!(
            "Agent installed, but MCL can't reach it from outside the VM ({}). Open port {} (and \
             25565 for players) in your cloud provider's firewall/Security List, then click Retry.",
            e, agent_port
        )
    })?;
    emit_progress(&app, &stream_id, "Done — the agent is reachable.");

    Ok(outcome)
}
```

- [ ] **Step 3: Verify it builds**

Run: `cargo build --offline --features remote-setup`
Expected: builds cleanly.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/vm_bootstrap.rs
git commit -m "feat(desktop): implement the six VM bootstrap steps"
```

---

### Task 4: Stub module, Tauri commands, and registration

**Files:**
- Create: `src-tauri/src/vm_bootstrap_stub.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `vm_bootstrap::{BootstrapRequest, BootstrapOutcome, run_bootstrap}` (Task 3),
  `remote_agent::RemoteHostConfig` (existing).
- Produces: `vm_bootstrap_start`, `vm_bootstrap_retry_verify` (`#[tauri::command]`s).

- [ ] **Step 1: The stub module**

Create `src-tauri/src/vm_bootstrap_stub.rs`:

```rust
//! Stub used when the `remote-setup` feature is off (the `mcl-agent` binary build) — this
//! module is never reached there, since the agent never SSHes anywhere, but `lib.rs` still
//! needs to compile against a matching API either way. Same reasoning as `p2p_tunnel_stub.rs`.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapRequest {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub private_key_path: String,
    pub agent_port: u16,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapOutcome {
    pub url: String,
    pub token: String,
    pub cert_pem: String,
}

pub async fn run_bootstrap(_app: AppHandle, _stream_id: String, _req: BootstrapRequest) -> Result<BootstrapOutcome, String> {
    Err("This build of MCL was compiled without VM setup support.".to_string())
}
```

- [ ] **Step 2: Module swap in `lib.rs`**

Add right after the existing `p2p_tunnel`/`p2p_tunnel_stub` swap block in `src-tauri/src/lib.rs`
(after line 24), following its exact comment style:

```rust
// The VM bootstrap wizard's SSH client (russh) is desktop-only — mcl-agent never SSHes
// anywhere, so the agent binary builds with the `remote-setup` feature off and gets a
// matching stub instead, same reasoning and same pattern as p2p_tunnel above.
#[cfg(feature = "remote-setup")]
pub mod vm_bootstrap;
#[cfg(not(feature = "remote-setup"))]
#[path = "vm_bootstrap_stub.rs"]
pub mod vm_bootstrap;
```

- [ ] **Step 3: Tauri commands**

Add near the `p2p_*` Tauri commands in `src-tauri/src/lib.rs` (they're grouped together around
line 610 — add these alongside them, before the `generate_handler!` list):

```rust
#[tauri::command]
async fn vm_bootstrap_start(app: tauri::AppHandle, stream_id: String, req: vm_bootstrap::BootstrapRequest) -> Result<vm_bootstrap::BootstrapOutcome, String> {
    vm_bootstrap::run_bootstrap(app, stream_id, req).await
}

#[tauri::command]
async fn vm_bootstrap_retry_verify(host: remote_agent::RemoteHostConfig) -> Result<(), String> {
    remote_agent::remote_agent_status(host).await.map(|_| ())
}
```

Add both to the `generate_handler!` list, right after the `p2p_get_client_status` entry (line
798):

```rust
            p2p_get_client_status,
            vm_bootstrap_start,
            vm_bootstrap_retry_verify,
```

- [ ] **Step 4: Verify both binaries build**

Run: `cargo build --offline` (default features) and
`cargo build --offline --bin mcl-agent --no-default-features --features agent`
Expected: both succeed.

Run: `cargo tree --offline --no-default-features --features agent | grep -i russh`
Expected: no output — confirms `russh` never ends up in the agent binary, mirroring how this
project already confirmed the same thing for `iroh`/`p2p`.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/vm_bootstrap_stub.rs src-tauri/src/lib.rs
git commit -m "feat(desktop): wire up vm_bootstrap_start/retry_verify Tauri commands"
```

---

### Task 5: TypeScript types and command registration

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/services/api.ts`

**Interfaces:**
- Produces: `BootstrapRequest`, `BootstrapOutcome`, `BootstrapProgressEvent`,
  `BootstrapCredentialsEvent` (TS types).

- [ ] **Step 1: Types**

Add to `src/types/index.ts` (anywhere near the other remote-hosting types like
`HostedServerStatus`):

```typescript
export interface BootstrapRequest {
  host: string;
  port: number;
  username: string;
  privateKeyPath: string;
  agentPort: number;
}

export interface BootstrapOutcome {
  url: string;
  token: string;
  certPem: string;
}

export interface BootstrapProgressEvent {
  streamId: string;
  line: string;
}

export interface BootstrapCredentialsEvent {
  streamId: string;
  url: string;
  token: string;
  certPem: string;
}
```

- [ ] **Step 2: Register the commands**

Add to `TAURI_COMMANDS` in `src/services/api.ts`:

```typescript
  'vm_bootstrap_start',
  'vm_bootstrap_retry_verify',
```

- [ ] **Step 3: Verify it type-checks**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts src/services/api.ts
git commit -m "feat(desktop): add TypeScript types for the VM bootstrap wizard"
```

---

### Task 6: `VmBootstrapWizard.tsx`

**Files:**
- Create: `src/components/server/VmBootstrapWizard.tsx`
- Modify: `src/locales/i18n.ts`

**Interfaces:**
- Consumes: `invokeCommand` with `'vm_bootstrap_start'`/`'vm_bootstrap_retry_verify'` (Task 5),
  `'select_file'` (existing, for the private key picker), `listen` from
  `@tauri-apps/api/event` (existing dependency, already used in `HostServerView.tsx`),
  `RemoteHost`, `saveRemoteHosts` (existing in `remoteAgent.ts`).
- Produces: `VmBootstrapWizard` React component, props
  `{ language: Language; onInstalled: (host: RemoteHost) => void; onClose: () => void }`.

- [ ] **Step 1: Write the component**

```tsx
import React, { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Loader2, X, KeyRound, Server } from 'lucide-react';
import { invokeCommand } from '../../services/api';
import { type RemoteHost } from '../../services/remoteAgent';
import type { BootstrapRequest, BootstrapOutcome, BootstrapProgressEvent, BootstrapCredentialsEvent } from '../../types';
import { getTranslation, type Language } from '../../locales/i18n';

interface VmBootstrapWizardProps {
  language: Language;
  onInstalled: (host: RemoteHost) => void;
  onClose: () => void;
}

type WizardPhase = 'form' | 'running' | 'error' | 'done';

export const VmBootstrapWizard: React.FC<VmBootstrapWizardProps> = ({ language, onInstalled, onClose }) => {
  const t = getTranslation(language);
  const [host, setHost] = useState('');
  const [port, setPort] = useState(22);
  const [username, setUsername] = useState('ubuntu');
  const [privateKeyPath, setPrivateKeyPath] = useState('');
  const [agentPort, setAgentPort] = useState(8642);
  const [displayName, setDisplayName] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [phase, setPhase] = useState<WizardPhase>('form');
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [isRetrying, setIsRetrying] = useState(false);
  const credentialsRef = useRef<BootstrapOutcome | null>(null);
  const streamIdRef = useRef('');
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [log]);

  useEffect(() => {
    const unlistenProgress = listen<BootstrapProgressEvent>('vm-bootstrap-progress', (event) => {
      if (event.payload.streamId !== streamIdRef.current) return;
      setLog((prev) => [...prev, event.payload.line]);
    });
    const unlistenCredentials = listen<BootstrapCredentialsEvent>('vm-bootstrap-credentials', (event) => {
      if (event.payload.streamId !== streamIdRef.current) return;
      credentialsRef.current = { url: event.payload.url, token: event.payload.token, certPem: event.payload.certPem };
    });
    return () => {
      unlistenProgress.then((f) => f());
      unlistenCredentials.then((f) => f());
    };
  }, []);

  const pickPrivateKey = async () => {
    const path = await invokeCommand<string | null>('select_file', { filterName: null, filterExtensions: null });
    if (path) setPrivateKeyPath(path);
  };

  const finish = (outcome: BootstrapOutcome) => {
    const newHost: RemoteHost = {
      id: Date.now().toString(),
      name: displayName.trim() || host,
      url: outcome.url,
      token: outcome.token,
      certPem: outcome.certPem,
    };
    setPhase('done');
    onInstalled(newHost);
  };

  const handleStart = async () => {
    if (!host.trim() || !privateKeyPath) return;
    setPhase('running');
    setLog([]);
    setError('');
    credentialsRef.current = null;
    streamIdRef.current = Date.now().toString();

    const req: BootstrapRequest = {
      host: host.trim(),
      port,
      username: username.trim() || 'ubuntu',
      privateKeyPath,
      agentPort,
    };

    try {
      const outcome = await invokeCommand<BootstrapOutcome>('vm_bootstrap_start', { streamId: streamIdRef.current, req });
      finish(outcome);
    } catch (err) {
      setError(String(err));
      setPhase('error');
    }
  };

  const handleRetryVerify = async () => {
    const creds = credentialsRef.current;
    if (!creds) return;
    setIsRetrying(true);
    try {
      await invokeCommand<void>('vm_bootstrap_retry_verify', {
        host: { url: creds.url, token: creds.token, certPem: creds.certPem },
      });
      finish(creds);
    } catch (err) {
      setError(String(err));
    } finally {
      setIsRetrying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-2xl bg-[#151515] border border-white/10 flex flex-col overflow-hidden max-h-[85vh]">
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-[var(--accent-color)]" />
            <span className="text-sm font-bold text-white">{t.hostServerBootstrapTitle || 'Set Up a New VM Automatically'}</span>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto custom-scrollbar">
          {phase === 'form' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  placeholder={t.hostServerBootstrapHost || 'VM address (e.g. 140.245.125.66)'}
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  className="col-span-2 px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-[var(--accent-color)]"
                />
                <input
                  type="text"
                  placeholder={t.hostServerBootstrapUsername || 'SSH username'}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-[var(--accent-color)]"
                />
                <input
                  type="number"
                  placeholder="22"
                  value={port}
                  onChange={(e) => setPort(Number(e.target.value) || 22)}
                  className="px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-[var(--accent-color)]"
                />
              </div>

              <button
                type="button"
                onClick={pickPrivateKey}
                className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-left flex items-center gap-2 cursor-pointer hover:bg-white/10 transition"
              >
                <KeyRound className="w-4 h-4 text-amber-400 shrink-0" />
                <span className={privateKeyPath ? 'text-white truncate' : 'text-slate-500'}>
                  {privateKeyPath || t.hostServerBootstrapPickKey || 'Choose private key file...'}
                </span>
              </button>

              <input
                type="text"
                placeholder={t.hostServerRemoteNamePlaceholder || 'Name (e.g. My VPS)'}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-[var(--accent-color)]"
              />

              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="text-xs font-semibold text-slate-400 hover:text-white cursor-pointer"
              >
                {showAdvanced ? t.hostServerBootstrapHideAdvanced || 'Hide advanced' : t.hostServerBootstrapShowAdvanced || 'Advanced'}
              </button>
              {showAdvanced && (
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    {t.hostServerBootstrapAgentPort || 'Agent port'}
                  </label>
                  <input
                    type="number"
                    value={agentPort}
                    onChange={(e) => setAgentPort(Number(e.target.value) || 8642)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-[var(--accent-color)]"
                  />
                </div>
              )}

              <button
                type="button"
                onClick={handleStart}
                disabled={!host.trim() || !privateKeyPath}
                className="w-full btn-primary px-4 py-2.5 rounded-xl text-sm font-bold cursor-pointer active:scale-95 transition disabled:opacity-40"
              >
                {t.hostServerBootstrapConnect || 'Connect & Install'}
              </button>
            </>
          )}

          {(phase === 'running' || phase === 'error') && (
            <>
              <div className="rounded-xl bg-black/60 border border-white/10 h-56 overflow-y-auto custom-scrollbar px-3.5 py-3 font-mono text-[11px] text-slate-300 space-y-1">
                {log.map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
                {phase === 'running' && (
                  <div className="flex items-center gap-1.5 text-slate-500">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>{t.hostServerBootstrapWorking || 'Working...'}</span>
                  </div>
                )}
                <div ref={logEndRef} />
              </div>

              {phase === 'error' && (
                <>
                  <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-300 text-xs">{error}</div>
                  <div className="flex items-center gap-2">
                    {credentialsRef.current && (
                      <button
                        type="button"
                        onClick={handleRetryVerify}
                        disabled={isRetrying}
                        className="flex-1 btn-primary px-4 py-2.5 rounded-xl text-sm font-bold cursor-pointer active:scale-95 transition disabled:opacity-40 flex items-center justify-center gap-1.5"
                      >
                        {isRetrying && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        <span>{t.hostServerBootstrapRetry || 'Retry'}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setPhase('form')}
                      className="px-4 py-2.5 rounded-xl text-sm font-semibold bg-white/5 hover:bg-white/10 text-slate-300 cursor-pointer active:scale-95 transition"
                    >
                      {t.hostServerBootstrapStartOver || 'Start Over'}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Add the new i18n keys**

Every `t.hostServerBootstrapXxx`/`t.hostServerRemoteNamePlaceholder` reference above must exist
as a key in `translations.en` (`t` is typed as `typeof translations['en']`, so a missing key is
a TypeScript compile error). `hostServerRemoteNamePlaceholder` already exists (used by the
manual "Add a remote host" form in `HostServerView.tsx`) — add the remaining eleven to both the
`en` and `vi` blocks of `src/locales/i18n.ts`:

English (`en` block):

```typescript
    hostServerBootstrapTitle: 'Set Up a New VM Automatically',
    hostServerBootstrapHost: 'VM address (e.g. 140.245.125.66)',
    hostServerBootstrapUsername: 'SSH username',
    hostServerBootstrapPickKey: 'Choose private key file...',
    hostServerBootstrapShowAdvanced: 'Advanced',
    hostServerBootstrapHideAdvanced: 'Hide advanced',
    hostServerBootstrapAgentPort: 'Agent port',
    hostServerBootstrapConnect: 'Connect & Install',
    hostServerBootstrapWorking: 'Working...',
    hostServerBootstrapRetry: 'Retry',
    hostServerBootstrapStartOver: 'Start Over',
```

Vietnamese (`vi` block):

```typescript
    hostServerBootstrapTitle: 'Tự Động Thiết Lập VM Mới',
    hostServerBootstrapHost: 'Địa chỉ VM (vd: 140.245.125.66)',
    hostServerBootstrapUsername: 'Tên đăng nhập SSH',
    hostServerBootstrapPickKey: 'Chọn file private key...',
    hostServerBootstrapShowAdvanced: 'Nâng cao',
    hostServerBootstrapHideAdvanced: 'Ẩn nâng cao',
    hostServerBootstrapAgentPort: 'Cổng agent',
    hostServerBootstrapConnect: 'Kết Nối & Cài Đặt',
    hostServerBootstrapWorking: 'Đang xử lý...',
    hostServerBootstrapRetry: 'Thử Lại',
    hostServerBootstrapStartOver: 'Làm Lại Từ Đầu',
```

- [ ] **Step 3: Verify it type-checks**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/server/VmBootstrapWizard.tsx src/locales/i18n.ts
git commit -m "feat(desktop): add VmBootstrapWizard component"
```

---

### Task 7: Mount it in `HostServerView.tsx`

**Files:**
- Modify: `src/components/server/HostServerView.tsx`

**Interfaces:**
- Consumes: `VmBootstrapWizard` (Task 6), `remoteHosts`, `setRemoteHosts`, `saveRemoteHosts`,
  `setSelectedHostId` (existing state in this component).

- [ ] **Step 1: Import and wire up state**

Add the import near the other component imports
(`src/components/server/HostServerView.tsx:25`):

```typescript
import { VmBootstrapWizard } from './VmBootstrapWizard';
```

Add one new piece of state near `isAddHostOpen` (line 47):

```typescript
  const [isBootstrapOpen, setIsBootstrapOpen] = useState(false);
```

- [ ] **Step 2: Add the button and the wizard**

Add a second button right next to the existing "Add a remote host" one
(`src/components/server/HostServerView.tsx:416-423`):

```tsx
        <button
          type="button"
          onClick={() => setIsBootstrapOpen(true)}
          className="text-xs font-semibold text-[var(--accent-light)] hover:underline flex items-center gap-1 cursor-pointer"
        >
          <Server className="w-3 h-3" />
          <span>{t.hostServerBootstrapButton || 'Set up a new VM automatically'}</span>
        </button>
```

`Server` is already imported at `src/components/server/HostServerView.tsx:4` — no import
changes needed for this icon.

Render the wizard as a sibling of the existing `isAddHostOpen &&` block (right after it, still
inside the same parent), passing it the same `saveRemoteHosts`-based flow the manual form uses:

```tsx
      {isBootstrapOpen && (
        <VmBootstrapWizard
          language={language}
          onClose={() => setIsBootstrapOpen(false)}
          onInstalled={(newHost) => {
            const next = [...remoteHosts, newHost];
            setRemoteHosts(next);
            saveRemoteHosts(next);
            setSelectedHostId(newHost.id);
            setIsBootstrapOpen(false);
          }}
        />
      )}
```

- [ ] **Step 3: Add the one remaining i18n key**

Add to both the `en` and `vi` blocks of `src/locales/i18n.ts`:

```typescript
    hostServerBootstrapButton: 'Set up a new VM automatically',
```

```typescript
    hostServerBootstrapButton: 'Tự động thiết lập VM mới',
```

- [ ] **Step 4: Verify it builds and type-checks**

Run: `npx tsc -b && npm run build`
Expected: no errors.

- [ ] **Step 5: Manual browser-preview check**

Start the dev server (`preview_start` with `mcl-dev`), navigate to Host Server, click "Set up a
new VM automatically", confirm the wizard opens with the form fields and the private-key picker
button, and confirm clicking it opens a native file dialog (browser preview can't complete the
full flow — no Tauri backend there — that's covered by Task 8's manual pass against the real
VM).

- [ ] **Step 6: Commit**

```bash
git add src/components/server/HostServerView.tsx src/locales/i18n.ts
git commit -m "feat(desktop): mount VmBootstrapWizard in the Host Server remote-host panel"
```

---

### Task 8: Full verification against the real VM

**Files:** none (verification only)

- [ ] **Step 1: Full Rust test suite**

Run: `cargo test --offline`
Expected: every existing test still passes (this plan added no automated tests of its own — see
Task 2's note on why the SSH plumbing is manually verified instead).

- [ ] **Step 2: Both binaries build, `russh` confirmed excluded from the agent**

Run: `cargo build --offline`, `cargo build --offline --bin mcl-agent --no-default-features --features agent`,
and `cargo tree --offline --no-default-features --features agent | grep -i russh`
Expected: both builds succeed; the `cargo tree` grep prints nothing.

- [ ] **Step 3: Full end-to-end run against the real Oracle VM**

The VM used throughout this project (`ssh mcl`, currently blank per this conversation) is the
real target. From MCL's Host Server tab, open "Set up a new VM automatically", fill in
`140.245.125.66`, username `ubuntu`, the private key at
`C:\Users\Tran Bao Long\.ssh\oracle-mcl.key`, a display name, and click **Connect & Install**.
Confirm the progress log shows each step in order (connecting, Java, firewall, agent install,
reading credentials, verifying), and that it either finishes with the new host added and
selected, or — if the Oracle Cloud Security List hasn't been opened for the agent's port yet —
stops at the verify step with the documented error message and a working **Retry** button once
the Security List is updated. Then confirm the resulting host works exactly like a manually
added one: status, start/stop, console all function against it.

- [ ] **Step 4: Confirm CI is green**

Push and check the `CI` GitHub Actions workflow (`gh run list --branch main --limit 1`, then
`gh run view <run-id>` until `completed`/`success`) for both the `ubuntu-latest` and
`windows-latest` jobs — this is what confirms the `remote-setup`/agent feature split actually
holds on both platforms, not just the one this was developed on.
