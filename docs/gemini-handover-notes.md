# Notes for Gemini — Implementing Section 7 (Server Metrics & Config Backend + UI)

You have full design freedom on both backend (Rust) and frontend (React/TS) for the
features proposed in `docs/handover-notes.md` section 7 (server metrics, extended
server.properties fields, Aikar's flags/GC, auto-restart on crash). These notes are not
a design spec — they are the hard architectural facts of this codebase that any design
must respect. I (Claude) verified all of these directly against the current code before
writing them down; please don't assume the original section 7 doc was 100% accurate —
it wasn't, in a few places noted below.

## 1. Two binaries share this codebase — build both, always
`src-tauri/` compiles into two different binaries from the same crate:
- `mcl-client` — the desktop app. Default features: `p2p`, `remote-setup`.
- `mcl-agent` — a headless daemon that runs on a remote VPS, built with
  `--no-default-features --features agent`.

Any struct or module you touch that's shared between them (this very likely includes
`HostedServerStatus`, `ServerPropertiesSummary`, anything in `server_host.rs` /
`server_config.rs` / `models.rs`) must compile under **both**:
```
cargo check --offline
cargo check --offline --bin mcl-agent --no-default-features --features agent
```
If a module only makes sense for one binary, follow the existing pattern: a real module
gated `#[cfg(feature = "...")]` plus a matching `_stub.rs` with the same public shapes
for the other build (see `vm_bootstrap.rs` / `vm_bootstrap_stub.rs` for the template).

## 2. Remote metrics must be collected ON the agent, not faked on the desktop side
For a server hosted on a VPS, `src-tauri/src/remote_agent.rs` (desktop side) is only an
HTTP client — it deserializes whatever `src-tauri/src/bin/mcl_agent.rs` (the process
actually running on the VPS) sends back. Any new metric (TPS, online players, JVM heap,
world size, uptime) that needs to work for remote hosts **must be collected inside
`mcl_agent.rs`** and exposed on its HTTP API, mirroring the existing
`collect_system_stats()` / `SystemStats` pattern already there. Don't add fields to
`remote_agent.rs` alone and assume the data appears — it won't.

## 3. Reuse `SystemStats`, don't invent a parallel type
The existing host-machine-stats type is `SystemStats` (camelCase over the wire), already
defined in `remote_agent.rs` and mirrored in `mcl_agent.rs`, and already threaded through
as `RemoteAgentStatus { #[serde(flatten)] status: HostedServerStatus, system:
Option<SystemStats> }`. Don't rename it to `SystemMetrics` or add a second `system`
field somewhere else — extend the existing one.

## 4. `get_status()` is a cheap, synchronous, frequently-polled call
`server_host.rs::get_status()` is an in-memory map lookup, called on a polling interval
from the UI. Any new field that needs disk I/O (e.g. world folder size) or a network/RCON
round-trip (TPS, player list) must be cached with a TTL and refreshed on its own schedule
— not computed inline on every status call. Decide the caching strategy explicitly as
part of your design; don't leave it to "just call it every time."

## 5. Getting TPS / online player list needs one deliberate choice, not three
There is currently no mechanism to read TPS or the live player list. Pick one, document
why, and implement only that one:
- **RCON** — most reliable, gives both TPS-adjacent data (via `/tps` if a plugin exposes
  it — vanilla has no reliable TPS source without one) and player list (`/list`).
  Requires enabling `enable-rcon` + a generated password in server.properties.
- **Server List Ping (SLP)** — simple, gives online/max player counts and player sample,
  but no TPS.
- **Log parsing** — fragile across Minecraft versions, avoid unless the other two are
  ruled out for a good reason.
If you go with RCON: never put the RCON password on a command line or in a log line —
this codebase has an existing discipline around that (see how `vm_bootstrap.rs` pipes an
SSH password only over stdin, never as a command-line argument or into a logged string).
Follow the same discipline for any password/token you introduce.

## 6. Crash-restart must not become a crash-loop
Crash detection already exists: a dedicated `std::thread::spawn` in `server_host.rs`
(around the block that calls `child.wait()`) flips state to `Crashed` when the process
exits unexpectedly. That thread does not currently have access to the instance's launch
args (RAM, JVM flags, etc.), so an auto-restart needs a way to hand it a restart
capability (closure/channel) at spawn time — it's not a one-line addition. Whatever you
build, it must include a max-consecutive-crash counter with backoff, and give up (and
surface why, in the UI) past some threshold, instead of restarting forever on a genuinely
broken config/mod.

## 7. i18n — never touch an existing key
UI strings go through `getTranslation(language)` / `t.xxxKey`, with 8 language blocks in
`src/locales/i18n.ts` (vi, en, zh, ja, ko, de, fr, es). Add new keys, to all 8 blocks,
for anything new. Never rename, delete, or repurpose an existing key.

## 8. Stay inside this feature's boundary
Don't touch: `p2p_tunnel.rs` / `P2PFloatingWidget.tsx` (P2P system), `vm_bootstrap.rs`
(VM bootstrap wizard), or the Cloudflare D1/R2 hybrid-account system — unless a section 7
feature genuinely requires reading from one of them (say so explicitly if it does).

## 9. Verification before calling it done
- `cargo test --offline` (currently 115 passing — should still be green, plus your own
  new unit tests for any pure logic you add, following the existing pattern of testing
  `build_jvm_args` / `build_minecraft_args` in `minecraft_core/launcher.rs`)
- Both `cargo check` commands from section 1
- `npx tsc -b` and `npm run build`
- Manual check in the dev preview

## 10. Suggested order (not mandatory, just lowest-risk-first)
1. Extend `ServerPropertiesSummary` (gamemode, view-distance, etc.) — purely additive,
   no architectural decisions needed.
2. Aikar's flags + GC choice in `build_jvm_args` — already a pure, tested function, easy
   to extend safely.
3. Decide + implement the TPS/player-list mechanism (section 5) — do this as its own
   step since it's the one real architectural decision in the whole set.
4. Auto-restart on crash, with the backoff guard from section 6.

Please give a plain-language changelog (files added/modified/deleted) after each step so
progress stays reviewable, same as the earlier UI redesign work.
