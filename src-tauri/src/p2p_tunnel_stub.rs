// Stands in for `p2p_tunnel` when the `p2p` feature is off, so the Tauri command list in
// lib.rs stays identical either way and the frontend keeps a stable command surface.
//
// The only build that turns `p2p` off today is the `mcl-agent` binary: it never offers
// peer-to-peer rooms, and leaving iroh out drops roughly 190 crates from the one binary that
// actually sits exposed on a VPS. Every desktop build keeps the feature on by default.
//
// The three status structs below must stay field-for-field identical to the real module's,
// since both serialize into the same TypeScript types.

use serde::{Deserialize, Serialize};

const UNAVAILABLE: &str = "This build of MCL was compiled without peer-to-peer support.";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct P2PMemberInfo {
    pub username: String,
    pub node_id: String,
    pub ping_ms: Option<f64>,
    pub joined_at: u64,
    pub is_host: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct P2PHostStatus {
    pub is_running: bool,
    pub ticket: Option<String>,
    pub node_id: Option<String>,
    pub room_name: Option<String>,
    pub has_password: bool,
    pub target_port: u16,
    pub connected_peers_count: usize,
    pub members: Vec<P2PMemberInfo>,
    pub direct_addresses: Vec<String>,
    pub is_locked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct P2PClientStatus {
    pub is_connected: bool,
    pub room_name: Option<String>,
    pub local_port: Option<u16>,
    pub remote_node_id: Option<String>,
    pub host_username: Option<String>,
    pub ping_ms: Option<f64>,
    pub members: Vec<P2PMemberInfo>,
    pub error: Option<String>,
}

pub async fn start_p2p_host(
    _room_name: String,
    _host_username: String,
    _password: Option<String>,
    _target_port: u16,
) -> Result<P2PHostStatus, String> {
    Err(UNAVAILABLE.to_string())
}

pub async fn stop_p2p_host() -> Result<bool, String> {
    Ok(false)
}

pub fn get_p2p_host_status() -> P2PHostStatus {
    P2PHostStatus {
        is_running: false,
        ticket: None,
        node_id: None,
        room_name: None,
        has_password: false,
        target_port: 25565,
        connected_peers_count: 0,
        members: Vec::new(),
        direct_addresses: Vec::new(),
        is_locked: false,
    }
}

pub fn p2p_host_kick_peer(_peer_node_id: &str) -> bool {
    false
}

pub fn p2p_host_toggle_lock() -> bool {
    false
}

pub async fn start_p2p_client(
    _ticket: String,
    _username: String,
    _password: Option<String>,
) -> Result<P2PClientStatus, String> {
    Err(UNAVAILABLE.to_string())
}

pub async fn stop_p2p_client() -> Result<bool, String> {
    Ok(false)
}

pub fn get_p2p_client_status() -> P2PClientStatus {
    P2PClientStatus {
        is_connected: false,
        room_name: None,
        local_port: None,
        remote_node_id: None,
        host_username: None,
        ping_ms: None,
        members: Vec::new(),
        error: Some(UNAVAILABLE.to_string()),
    }
}
