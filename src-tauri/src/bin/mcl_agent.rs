//! MCL Agent — a standalone daemon for a remote/VPS-hosted server, so it can be started,
//! stopped and configured from the MCL desktop app the same way a locally-hosted server is,
//! instead of over SSH. It reuses the exact same `server_host`/`server_config` logic the
//! desktop app's "Host Server" tab calls directly, through a small authenticated HTTP API.
//!
//! Security model: every request needs a bearer token (generated on first run, saved next to
//! the data directory), and the API is served over TLS using a self-signed certificate the
//! agent generates for itself on first run — there's no CA behind it, so the desktop app has
//! to be told to trust that exact certificate (pasted in once, the same way the token is)
//! rather than relying on hostname/CA validation. This is certificate *pinning*, not the
//! usual browser trust model: it's secure as long as the certificate was copied over a
//! channel the operator already trusts (the same one used to hand over the token), and it
//! needs no domain name, no ACME setup and no reverse proxy in front of it.

use app_lib::backup;
use app_lib::models::ServerPropertiesSummary;
use app_lib::server_config;
use app_lib::server_host::{self, HostedServerStatus};
use axum::extract::{Path as AxumPath, Request, State};
use axum::http::{header, StatusCode};
use axum::middleware::{self, Next};
use axum::response::sse::{Event, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use axum_server::tls_rustls::RustlsConfig;
use futures_util::StreamExt;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::convert::Infallible;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::broadcast;

#[derive(Clone)]
struct AppState {
    data_dir: PathBuf,
    token: String,
    log_tx: broadcast::Sender<String>,
}

impl AppState {
    fn common_dir(&self) -> PathBuf {
        self.data_dir.join("common")
    }

    fn server_dir(&self) -> PathBuf {
        self.data_dir.join("server")
    }

    fn backups_dir(&self) -> PathBuf {
        self.data_dir.join("backups")
    }

    fn spec_path(&self) -> PathBuf {
        self.data_dir.join("spec.json")
    }
}

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

/// What loader/version the one server this agent manages currently is — set by `/v1/prepare`
/// and read back by every other endpoint, so callers don't need to keep repeating it.
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

fn read_spec(state: &AppState) -> Option<ServerSpec> {
    let raw = std::fs::read_to_string(state.spec_path()).ok()?;
    serde_json::from_str(&raw).ok()
}

fn write_spec(state: &AppState, spec: &ServerSpec) -> Result<(), String> {
    std::fs::create_dir_all(&state.data_dir).map_err(|e| e.to_string())?;
    let raw = serde_json::to_string_pretty(spec).map_err(|e| e.to_string())?;
    std::fs::write(state.spec_path(), raw).map_err(|e| e.to_string())
}

type ApiResult<T> = Result<Json<T>, ApiError>;

struct ApiError(StatusCode, String);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(serde_json::json!({ "error": self.1 }))).into_response()
    }
}

fn bad_request(message: impl Into<String>) -> ApiError {
    ApiError(StatusCode::BAD_REQUEST, message.into())
}

fn server_error(message: impl Into<String>) -> ApiError {
    ApiError(StatusCode::INTERNAL_SERVER_ERROR, message.into())
}

/// Accepts the token either as a normal `Authorization: Bearer` header (every JSON call) or
/// as a `?token=` query parameter (the one exception: browsers' `EventSource` API — used for
/// `/v1/logs` — cannot set custom headers, so the log stream has no other way to authenticate).
async fn require_token(State(state): State<Arc<AppState>>, req: Request, next: Next) -> Result<Response, StatusCode> {
    let header_token = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));
    let query_token = req.uri().query().and_then(|q| {
        q.split('&')
            .find_map(|pair| pair.strip_prefix("token=").map(|v| v.to_string()))
    });

    let provided = header_token.map(|s| s.to_string()).or(query_token);
    if provided.as_deref() != Some(state.token.as_str()) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    Ok(next.run(req).await)
}

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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrepareRequest {
    loader: String,
    game_version: String,
    loader_version: Option<String>,
    accept_eula: bool,
}

async fn prepare(State(state): State<Arc<AppState>>, Json(body): Json<PrepareRequest>) -> ApiResult<HostedServerStatus> {
    if !body.accept_eula {
        return Err(bad_request("Hosting a server means accepting Mojang's EULA first."));
    }
    let spec = ServerSpec {
        loader: body.loader,
        game_version: body.game_version,
        loader_version: body.loader_version,
        backup_retention_count: default_retention(),
    };
    let server_dir = state.server_dir();

    server_host::prepare_server_jar(
        &spec.loader,
        &spec.game_version,
        spec.loader_version.as_deref(),
        &state.common_dir(),
        &server_dir,
    )
    .await
    .map_err(server_error)?;
    server_host::accept_eula(&server_dir).map_err(server_error)?;
    write_spec(&state, &spec).map_err(server_error)?;

    Ok(Json(server_host::get_status(
        &server_dir,
        &spec.loader,
        &spec.game_version,
        spec.loader_version.as_deref(),
    )))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartRequest {
    min_ram: u32,
    max_ram: u32,
    /// Defaults to whatever java this host has installed for the profile's Minecraft
    /// version — most operators will never need to set this.
    java_bin: Option<String>,
}

#[derive(Serialize)]
struct StartResponse {
    started: bool,
}

async fn start(State(state): State<Arc<AppState>>, Json(body): Json<StartRequest>) -> ApiResult<StartResponse> {
    let spec = read_spec(&state).ok_or_else(|| bad_request("No server prepared yet — call /v1/prepare first."))?;
    let java_bin = match body.java_bin {
        Some(bin) => bin,
        None => app_lib::java_detector::find_best_java_for_version(&spec.game_version).0,
    };

    let log_tx = state.log_tx.clone();
    server_host::start_server(
        &state.server_dir(),
        &spec.loader,
        &spec.game_version,
        spec.loader_version.as_deref(),
        &java_bin,
        body.min_ram,
        body.max_ram,
        move |line| {
            let _ = log_tx.send(line);
        },
    )
    .map_err(server_error)?;

    Ok(Json(StartResponse { started: true }))
}

async fn stop(State(state): State<Arc<AppState>>) -> ApiResult<StartResponse> {
    // stop_server blocks the calling thread for up to 10s waiting for a graceful shutdown,
    // so it runs on a blocking-pool thread instead of tying up an async worker.
    let dir = state.server_dir();
    let stopped = tokio::task::spawn_blocking(move || server_host::stop_server(&dir))
        .await
        .map_err(|e| server_error(e.to_string()))?
        .map_err(server_error)?;
    Ok(Json(StartResponse { started: !stopped }))
}

#[derive(Deserialize)]
struct ConsoleCommandBody {
    command: String,
}

async fn send_console_command(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ConsoleCommandBody>,
) -> Result<StatusCode, ApiError> {
    server_host::send_command(&state.server_dir(), &body.command).map_err(bad_request)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn get_properties(State(state): State<Arc<AppState>>) -> ApiResult<ServerPropertiesSummary> {
    let dir = state.server_dir().to_string_lossy().to_string();
    server_config::read_server_properties(&dir).map(Json).map_err(server_error)
}

async fn set_properties(
    State(state): State<Arc<AppState>>,
    Json(summary): Json<ServerPropertiesSummary>,
) -> Result<StatusCode, ApiError> {
    let dir = state.server_dir().to_string_lossy().to_string();
    server_config::write_server_properties(&dir, &summary).map_err(server_error)?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Serialize)]
struct ModFile {
    name: String,
    size_bytes: u64,
}

/// Lists the jars already sitting in the server's `mods/` folder, so the desktop app can
/// upload only what's missing instead of resending every mod on every sync.
async fn list_mods(State(state): State<Arc<AppState>>) -> ApiResult<Vec<ModFile>> {
    let dir = state.server_dir().join("mods");
    let mut mods = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("jar") {
                continue;
            }
            let Some(name) = path.file_name().and_then(|n| n.to_str()) else { continue };
            let size_bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
            mods.push(ModFile { name: name.to_string(), size_bytes });
        }
    }
    Ok(Json(mods))
}

/// Saves one mod jar's raw bytes into the server's `mods/` folder. One request per file
/// rather than a multipart batch — simpler on both ends, and large modpacks already upload
/// incrementally since `list_mods` lets the client skip files it already sent.
async fn upload_mod(
    State(state): State<Arc<AppState>>,
    AxumPath(filename): AxumPath<String>,
    body: axum::body::Bytes,
) -> Result<StatusCode, ApiError> {
    if filename.contains('/') || filename.contains('\\') || filename.contains("..") {
        return Err(bad_request("Invalid mod filename."));
    }
    let dir = state.server_dir().join("mods");
    std::fs::create_dir_all(&dir).map_err(|e| server_error(e.to_string()))?;
    std::fs::write(dir.join(&filename), &body).map_err(|e| server_error(e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}

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
    let headers = [
        (header::CONTENT_TYPE, "application/zip".to_string()),
        (header::CONTENT_DISPOSITION, format!("attachment; filename=\"{}\"", name)),
    ];
    Ok((headers, bytes).into_response())
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

async fn logs(State(state): State<Arc<AppState>>) -> Sse<impl futures_util::Stream<Item = Result<Event, Infallible>>> {
    let rx = state.log_tx.subscribe();
    let stream = tokio_stream::wrappers::BroadcastStream::new(rx)
        .filter_map(|line| async move { line.ok() })
        .map(|line| Ok(Event::default().data(line)));
    Sse::new(stream)
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "ok": true }))
}

/// Generates and persists a self-signed certificate on first run — persisted so restarts
/// keep the same certificate the operator already pinned in MCL, instead of silently
/// breaking every saved connection on every restart.
fn load_or_create_cert(data_dir: &PathBuf) -> std::io::Result<(String, String)> {
    let cert_path = data_dir.join("agent-cert.pem");
    let key_path = data_dir.join("agent-key.pem");
    if let (Ok(cert), Ok(key)) = (std::fs::read_to_string(&cert_path), std::fs::read_to_string(&key_path)) {
        if !cert.trim().is_empty() && !key.trim().is_empty() {
            return Ok((cert, key));
        }
    }

    std::fs::create_dir_all(data_dir)?;
    let subject_alt_names = vec!["mcl-agent".to_string(), "localhost".to_string()];
    let certified_key = rcgen::generate_simple_self_signed(subject_alt_names)
        .unwrap_or_else(|e| panic!("could not generate a self-signed certificate: {}", e));
    let cert_pem = certified_key.cert.pem();
    let key_pem = certified_key.key_pair.serialize_pem();
    std::fs::write(&cert_path, &cert_pem)?;
    std::fs::write(&key_path, &key_pem)?;
    Ok((cert_pem, key_pem))
}

fn load_or_create_token(data_dir: &PathBuf) -> std::io::Result<String> {
    if let Ok(token) = std::env::var("MCL_AGENT_TOKEN") {
        return Ok(token);
    }
    let token_path = data_dir.join("agent-token.txt");
    if let Ok(existing) = std::fs::read_to_string(&token_path) {
        let trimmed = existing.trim().to_string();
        if !trimmed.is_empty() {
            return Ok(trimmed);
        }
    }
    std::fs::create_dir_all(data_dir)?;
    let mut bytes = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut bytes);
    let token = bytes.iter().map(|b| format!("{:02x}", b)).collect::<String>();
    std::fs::write(&token_path, &token)?;
    Ok(token)
}

/// Resolves one setting as `--flag value` (checked first, since a Windows Service's command
/// line is the only configuration a freshly (re)started service process reliably sees — the
/// Service Control Manager does not pick up machine environment variable changes made after
/// it itself started), then the matching environment variable (the systemd path, and the
/// simplest way to run this directly during development), then `default`.
fn config_value(flag: &str, env_key: &str, default: &str) -> String {
    let args: Vec<String> = std::env::args().collect();
    if let Some(pos) = args.iter().position(|a| a == flag) {
        if let Some(value) = args.get(pos + 1) {
            return value.clone();
        }
    }
    std::env::var(env_key).unwrap_or_else(|_| default.to_string())
}

/// Runs the agent until `shutdown` resolves, then lets in-flight requests finish (up to 5s)
/// before returning. Used identically whether the caller is a plain foreground process
/// (`shutdown` = Ctrl+C) or a Windows Service (`shutdown` = the SCM's Stop control).
async fn run(shutdown: impl std::future::Future<Output = ()> + Send + 'static) {
    // Multiple TLS backends are reachable through this dependency tree, so rustls can't pick
    // one on its own — pin aws-lc-rs explicitly before anything touches TLS.
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();

    let data_dir = PathBuf::from(config_value("--dir", "MCL_AGENT_DIR", "./mcl-agent-data"));
    let bind = config_value("--bind", "MCL_AGENT_BIND", "0.0.0.0");
    let port: u16 = config_value("--port", "MCL_AGENT_PORT", "8642")
        .parse()
        .unwrap_or(8642);

    let token = load_or_create_token(&data_dir).expect("could not read or create the agent's token file");
    let (cert_pem, key_pem) =
        load_or_create_cert(&data_dir).expect("could not read or create the agent's TLS certificate");
    let cert_path = data_dir.join("agent-cert.pem");
    let (log_tx, _) = broadcast::channel(256);
    let state = Arc::new(AppState { data_dir, token: token.clone(), log_tx });

    let protected = Router::new()
        .route("/v1/status", get(get_status))
        .route("/v1/prepare", post(prepare))
        .route("/v1/start", post(start))
        .route("/v1/stop", post(stop))
        .route("/v1/console", post(send_console_command))
        .route("/v1/properties", get(get_properties).post(set_properties))
        .route("/v1/mods", get(list_mods))
        .route("/v1/mods/:filename", post(upload_mod))
        .route("/v1/backups", get(list_backups_handler).post(create_backup_now))
        .route("/v1/backups/:name", get(download_backup).delete(delete_backup))
        .route("/v1/restore", post(restore))
        .route("/v1/logs", get(logs))
        .route("/v1/health", get(health))
        .route_layer(middleware::from_fn_with_state(state.clone(), require_token));

    // Permissive because auth is the token, not the origin — the desktop app calls this from
    // a `tauri://` webview origin, which a stricter allow-list would have to special-case anyway.
    let app = Router::new()
        .merge(protected)
        .layer(tower_http::cors::CorsLayer::permissive())
        .with_state(state);

    let addr: SocketAddr = format!("{}:{}", bind, port)
        .parse()
        .unwrap_or_else(|e| panic!("invalid bind address {}:{}: {}", bind, port, e));
    let tls_config = RustlsConfig::from_pem(cert_pem.into_bytes(), key_pem.into_bytes())
        .await
        .expect("invalid TLS certificate/key pair");

    println!("MCL Agent listening on https://{}", addr);
    println!("Bearer token: {}", token);
    println!(
        "TLS certificate: {} — paste this file's contents into MCL when adding this host \
         (self-signed, so MCL pins the exact certificate instead of trusting a CA).",
        cert_path.display()
    );
    if bind == "0.0.0.0" {
        println!(
            "WARNING: bound to all interfaces. The bearer token and the pinned certificate \
             are the only things standing between anyone who can reach this port and full \
             control of this server — keep both as secret as an SSH key."
        );
    }

    let handle = axum_server::Handle::new();
    let shutdown_handle = handle.clone();
    tokio::spawn(async move {
        shutdown.await;
        shutdown_handle.graceful_shutdown(Some(Duration::from_secs(5)));
    });

    axum_server::bind_rustls(addr, tls_config)
        .handle(handle)
        .serve(app.into_make_service())
        .await
        .expect("agent server crashed");
}

/// Ctrl+C, on every platform this builds for — the shutdown trigger for a plain foreground
/// run, as opposed to a Windows Service's own Stop control (see the `winservice` module).
async fn ctrl_c_signal() {
    let _ = tokio::signal::ctrl_c().await;
}

#[cfg(windows)]
mod winservice {
    //! Lets `mcl-agent.exe --service` register itself with Windows' Service Control Manager
    //! instead of running as a plain foreground process — what `scripts/install-agent.ps1`
    //! sets up so the agent starts on boot and survives no one being logged in, the Windows
    //! equivalent of the systemd unit `install-agent.sh` writes on Linux.
    use std::ffi::OsString;
    use std::sync::mpsc;
    use std::time::Duration;
    use windows_service::service::{
        ServiceControl, ServiceControlAccept, ServiceExitCode, ServiceState, ServiceStatus, ServiceType,
    };
    use windows_service::service_control_handler::{self, ServiceControlHandlerResult};
    use windows_service::{define_windows_service, service_dispatcher};

    const SERVICE_NAME: &str = "MCLAgent";
    const SERVICE_TYPE: ServiceType = ServiceType::OWN_PROCESS;

    define_windows_service!(ffi_service_main, service_main);

    pub fn run_as_service() {
        // Only returns (with an error) if the SCM dispatcher itself could not start, e.g. this
        // was run directly outside a service context despite the --service flag.
        if let Err(e) = service_dispatcher::start(SERVICE_NAME, ffi_service_main) {
            eprintln!("Could not start as a Windows Service: {}", e);
            eprintln!("This flag is meant to be used by the Service Control Manager, not run directly.");
            std::process::exit(1);
        }
    }

    fn service_main(_arguments: Vec<OsString>) {
        let (shutdown_tx, shutdown_rx) = mpsc::channel::<()>();

        let status_handle = match service_control_handler::register(SERVICE_NAME, move |control| match control {
            ServiceControl::Stop | ServiceControl::Shutdown => {
                let _ = shutdown_tx.send(());
                ServiceControlHandlerResult::NoError
            }
            ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,
            _ => ServiceControlHandlerResult::NotImplemented,
        }) {
            Ok(handle) => handle,
            Err(_) => return,
        };

        let report = |state: ServiceState, accept: ServiceControlAccept, wait_hint: Duration| {
            let _ = status_handle.set_service_status(ServiceStatus {
                service_type: SERVICE_TYPE,
                current_state: state,
                controls_accepted: accept,
                exit_code: ServiceExitCode::Win32(0),
                checkpoint: 0,
                wait_hint,
                process_id: None,
            });
        };

        report(ServiceState::StartPending, ServiceControlAccept::empty(), Duration::from_secs(5));

        let runtime = match tokio::runtime::Runtime::new() {
            Ok(rt) => rt,
            Err(_) => {
                report(ServiceState::Stopped, ServiceControlAccept::empty(), Duration::default());
                return;
            }
        };

        report(ServiceState::Running, ServiceControlAccept::STOP, Duration::default());

        runtime.block_on(super::run(async move {
            // Blocking the shutdown signal's own std channel recv on a tokio worker thread is
            // fine here: this task does nothing else, and the runtime has other workers free
            // to serve requests while it waits.
            let _ = tokio::task::spawn_blocking(move || shutdown_rx.recv()).await;
        }));

        report(ServiceState::Stopped, ServiceControlAccept::empty(), Duration::default());
    }
}

fn main() {
    let use_service = std::env::args().any(|a| a == "--service");

    #[cfg(windows)]
    if use_service {
        winservice::run_as_service();
        return;
    }
    #[cfg(not(windows))]
    if use_service {
        eprintln!("--service is only meaningful on Windows; run this directly under systemd on Linux instead.");
        std::process::exit(1);
    }

    let runtime = tokio::runtime::Runtime::new().expect("could not start the async runtime");
    runtime.block_on(run(ctrl_c_signal()));
}
