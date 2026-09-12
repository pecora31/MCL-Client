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

    fn spec_path(&self) -> PathBuf {
        self.data_dir.join("spec.json")
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

#[tokio::main]
async fn main() {
    // Multiple TLS backends are reachable through this dependency tree, so rustls can't pick
    // one on its own — pin aws-lc-rs explicitly before anything touches TLS.
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();

    let data_dir = std::env::var("MCL_AGENT_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("./mcl-agent-data"));
    let bind = std::env::var("MCL_AGENT_BIND").unwrap_or_else(|_| "0.0.0.0".to_string());
    let port: u16 = std::env::var("MCL_AGENT_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
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

    axum_server::bind_rustls(addr, tls_config)
        .serve(app.into_make_service())
        .await
        .expect("agent server crashed");
}
