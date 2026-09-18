//! Stub used when the `remote-setup` feature is off (the `mcl-agent` binary build) — this
//! module is never reached there, since the agent never SSHes anywhere, but `lib.rs` still
//! needs to compile against a matching API either way. Same reasoning as `p2p_tunnel_stub.rs`.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapRequest {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub private_key_path: Option<String>,
    pub password: Option<String>,
    pub agent_port: u16,
}

// Same reasoning as the real module's hand-rolled Debug: never print the password in the clear.
impl std::fmt::Debug for BootstrapRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("BootstrapRequest")
            .field("host", &self.host)
            .field("port", &self.port)
            .field("username", &self.username)
            .field("private_key_path", &self.private_key_path)
            .field("password", &self.password.as_ref().map(|_| "***"))
            .field("agent_port", &self.agent_port)
            .finish()
    }
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
