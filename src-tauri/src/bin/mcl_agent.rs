//! MCL Agent — a standalone daemon for a remote/VPS-hosted server, so it can be started,
//! stopped and configured from the MCL desktop app the same way a locally-hosted server is,
//! instead of over SSH. It reuses the exact same `server_host`/`server_config` logic the
//! desktop app's "Host Server" tab calls directly, through a small authenticated HTTP API.
//!
//! Security model for this first version: every request needs a bearer token (generated on
//! first run, saved next to the data directory), but the API itself speaks plain HTTP — it
//! has no TLS of its own. Bind it to `127.0.0.1` and reach it through an SSH tunnel, or put a
//! real reverse proxy (Caddy, nginx) in front of it for a TLS-terminated public address.
//! Setting `MCL_AGENT_BIND=0.0.0.0` without either of those exposes the control token to
//! anyone who can see the traffic.

use app_lib::models::ServerPropertiesSummary;
use app_lib::server_config;
use app_lib::server_host::{self, HostedServerStatus};
use axum::extract::{Request, State};
use axum::http::{header, StatusCode};
use axum::middleware::{self, Next};
use axum::response::sse::{Event, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use futures_util::StreamExt;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::convert::Infallible;
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
            running: false,
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
    let stopped = server_host::stop_server(&state.server_dir()).map_err(server_error)?;
    Ok(Json(StartResponse { started: !stopped }))
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
    let data_dir = std::env::var("MCL_AGENT_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("./mcl-agent-data"));
    let bind = std::env::var("MCL_AGENT_BIND").unwrap_or_else(|_| "0.0.0.0".to_string());
    let port: u16 = std::env::var("MCL_AGENT_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8642);

    let token = load_or_create_token(&data_dir).expect("could not read or create the agent's token file");
    let (log_tx, _) = broadcast::channel(256);
    let state = Arc::new(AppState { data_dir, token: token.clone(), log_tx });

    let protected = Router::new()
        .route("/v1/status", get(get_status))
        .route("/v1/prepare", post(prepare))
        .route("/v1/start", post(start))
        .route("/v1/stop", post(stop))
        .route("/v1/properties", get(get_properties).post(set_properties))
        .route("/v1/logs", get(logs))
        .route("/v1/health", get(health))
        .route_layer(middleware::from_fn_with_state(state.clone(), require_token));

    // Permissive because auth is the token, not the origin — the desktop app calls this from
    // a `tauri://` webview origin, which a stricter allow-list would have to special-case anyway.
    let app = Router::new()
        .merge(protected)
        .layer(tower_http::cors::CorsLayer::permissive())
        .with_state(state);

    let addr = format!("{}:{}", bind, port);
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .unwrap_or_else(|e| panic!("could not bind {}: {}", addr, e));

    println!("MCL Agent listening on {}", addr);
    println!("Bearer token: {}", token);
    if bind == "0.0.0.0" {
        println!(
            "WARNING: bound to all interfaces but this API is plain HTTP — put it behind an \
             SSH tunnel or a TLS reverse proxy before exposing it publicly. The bearer token \
             above is the only thing standing between anyone who can reach this port and full \
             control of this server."
        );
    }

    axum::serve(listener, app).await.expect("agent server crashed");
}
