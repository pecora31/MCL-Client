use base64::prelude::*;
use iroh::{
    endpoint::{Connection, Endpoint},
    NodeAddr,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::task::JoinHandle;

pub const ALPN: &[u8] = b"mcl/p2p-tunnel/v1";

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

#[derive(Debug, Serialize, Deserialize)]
struct HandshakeRequest {
    pub username: String,
    pub password: Option<String>,
    pub node_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct HandshakeResponse {
    pub success: bool,
    pub room_name: Option<String>,
    pub host_username: Option<String>,
    pub error: Option<String>,
}

struct HostPeerSession {
    pub username: String,
    pub node_id: String,
    pub joined_at: u64,
    pub ping_ms: Arc<Mutex<Option<f64>>>,
    pub connection: Connection,
}

struct HostState {
    endpoint: Endpoint,
    ticket: String,
    node_id: String,
    room_name: String,
    host_username: String,
    password: Option<String>,
    target_port: u16,
    direct_addresses: Vec<String>,
    peers_count: Arc<AtomicUsize>,
    is_locked: Arc<AtomicBool>,
    members_map: Arc<Mutex<HashMap<String, HostPeerSession>>>,
    accept_task: JoinHandle<()>,
}

struct ClientState {
    endpoint: Endpoint,
    _connection: Connection,
    room_name: Option<String>,
    host_username: Option<String>,
    local_port: u16,
    remote_node_id: String,
    client_username: String,
    ping_ms: Arc<Mutex<Option<f64>>>,
    proxy_task: JoinHandle<()>,
    ping_task: JoinHandle<()>,
}

static HOST_STATE: Mutex<Option<HostState>> = Mutex::new(None);
static CLIENT_STATE: Mutex<Option<ClientState>> = Mutex::new(None);

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

pub fn encode_ticket(addr: &NodeAddr) -> Result<String, String> {
    let json = serde_json::to_string(addr).map_err(|e| e.to_string())?;
    Ok(BASE64_URL_SAFE_NO_PAD.encode(json.as_bytes()))
}

pub fn decode_ticket(ticket: &str) -> Result<NodeAddr, String> {
    let raw = ticket.trim();
    let bytes = BASE64_URL_SAFE_NO_PAD
        .decode(raw.as_bytes())
        .map_err(|e| format!("Invalid Base64 URL Safe ticket format: {}", e))?;
    let addr: NodeAddr = serde_json::from_slice(&bytes)
        .map_err(|e| format!("Invalid NodeAddr JSON payload inside ticket: {}", e))?;
    Ok(addr)
}

/// Starts hosting a P2P Room with Room Name, optional Freestyle Password, and target local Minecraft port.
pub async fn start_p2p_host(
    room_name: String,
    host_username: String,
    password: Option<String>,
    target_port: u16,
) -> Result<P2PHostStatus, String> {
    // Stop any previous running host first
    stop_p2p_host().await?;

    let clean_room_name = if room_name.trim().is_empty() {
        "MCL Multiplayer Room".to_string()
    } else {
        room_name.trim().to_string()
    };

    let clean_host_username = if host_username.trim().is_empty() {
        "Host".to_string()
    } else {
        host_username.trim().to_string()
    };

    let clean_password = password.and_then(|p| {
        let t = p.trim().to_string();
        if t.is_empty() {
            None
        } else {
            Some(t)
        }
    });

    let endpoint = Endpoint::builder()
        .alpns(vec![ALPN.to_vec()])
        .bind()
        .await
        .map_err(|e| format!("Failed to bind P2P host endpoint: {}", e))?;

    // Allow brief time for discovery / STUN
    tokio::time::sleep(Duration::from_millis(600)).await;

    let node_addr = endpoint
        .node_addr()
        .await
        .map_err(|e| format!("Failed to read P2P node address: {}", e))?;

    let ticket = encode_ticket(&node_addr)?;
    let node_id = node_addr.node_id.to_string();
    let direct_addresses: Vec<String> = node_addr
        .direct_addresses
        .iter()
        .map(|s| s.to_string())
        .collect();

    let peers_count = Arc::new(AtomicUsize::new(0));
    let is_locked = Arc::new(AtomicBool::new(false));
    let members_map = Arc::new(Mutex::new(HashMap::<String, HostPeerSession>::new()));

    let ep_clone = endpoint.clone();
    let peers_count_clone = Arc::clone(&peers_count);
    let is_locked_clone = Arc::clone(&is_locked);
    let members_map_clone = Arc::clone(&members_map);
    let expected_password = clean_password.clone();
    let room_name_clone = clean_room_name.clone();
    let host_username_clone = clean_host_username.clone();

    let accept_task = tokio::spawn(async move {
        while let Some(incoming) = ep_clone.accept().await {
            let connecting = match incoming.accept() {
                Ok(c) => c,
                Err(_) => continue,
            };

            let connection = match connecting.await {
                Ok(c) => c,
                Err(_) => continue,
            };

            let peers_counter = Arc::clone(&peers_count_clone);
            let locked_flag = Arc::clone(&is_locked_clone);
            let members_ref = Arc::clone(&members_map_clone);
            let expected_pass = expected_password.clone();
            let r_name = room_name_clone.clone();
            let h_user = host_username_clone.clone();

            tokio::spawn(async move {
                handle_incoming_peer(
                    connection,
                    target_port,
                    expected_pass,
                    r_name,
                    h_user,
                    peers_counter,
                    locked_flag,
                    members_ref,
                )
                .await;
            });
        }
    });

    let has_pwd = clean_password.is_some();
    let host_member = P2PMemberInfo {
        username: clean_host_username.clone(),
        node_id: node_id.clone(),
        ping_ms: Some(0.0),
        joined_at: now_secs(),
        is_host: true,
    };

    let status = P2PHostStatus {
        is_running: true,
        ticket: Some(ticket.clone()),
        node_id: Some(node_id.clone()),
        room_name: Some(clean_room_name.clone()),
        has_password: has_pwd,
        target_port,
        connected_peers_count: 0,
        members: vec![host_member],
        direct_addresses: direct_addresses.clone(),
        is_locked: false,
    };

    let mut lock = HOST_STATE.lock().unwrap_or_else(|e| e.into_inner());
    *lock = Some(HostState {
        endpoint,
        ticket,
        node_id,
        room_name: clean_room_name,
        host_username: clean_host_username,
        password: clean_password,
        target_port,
        direct_addresses,
        peers_count,
        is_locked,
        members_map,
        accept_task,
    });

    Ok(status)
}

#[allow(clippy::too_many_arguments)]
async fn handle_incoming_peer(
    connection: Connection,
    target_port: u16,
    expected_password: Option<String>,
    room_name: String,
    host_username: String,
    peers_counter: Arc<AtomicUsize>,
    is_locked: Arc<AtomicBool>,
    members_map: Arc<Mutex<HashMap<String, HostPeerSession>>>,
) {
    // Check if room is locked
    if is_locked.load(Ordering::Relaxed) {
        let _ = connection.close(1u32.into(), b"Room is locked");
        return;
    }

    // Check max players (default 12 peers max)
    if peers_counter.load(Ordering::Relaxed) >= 12 {
        let _ = connection.close(2u32.into(), b"Room is full");
        return;
    }

    // The peer MUST open the first bi-stream for Handshake / Authentication
    let Ok((send_stream, recv_stream)) = connection.accept_bi().await else {
        let _ = connection.close(3u32.into(), b"Handshake stream failed");
        return;
    };

    let mut reader = BufReader::new(recv_stream);
    let mut writer = send_stream;
    let mut line = String::new();

    if reader.read_line(&mut line).await.is_err() || line.trim().is_empty() {
        let _ = connection.close(4u32.into(), b"Empty handshake request");
        return;
    }

    let handshake_req: HandshakeRequest = match serde_json::from_str(line.trim()) {
        Ok(req) => req,
        Err(_) => {
            let _ = connection.close(5u32.into(), b"Malformed handshake request");
            return;
        }
    };

    // Verify password if required
    if let Some(ref required_pwd) = expected_password {
        let provided_pwd = handshake_req.password.unwrap_or_default();
        if provided_pwd != *required_pwd {
            let err_resp = HandshakeResponse {
                success: false,
                room_name: None,
                host_username: None,
                error: Some("Incorrect room password".to_string()),
            };
            if let Ok(json) = serde_json::to_string(&err_resp) {
                let _ = writer.write_all(format!("{}\n", json).as_bytes()).await;
                let _ = writer.finish();
            }
            let _ = connection.close(6u32.into(), b"Incorrect room password");
            return;
        }
    }

    // Handshake succeeded
    let peer_node_id = handshake_req.node_id.clone();
    let peer_username = handshake_req.username.clone();

    let ok_resp = HandshakeResponse {
        success: true,
        room_name: Some(room_name),
        host_username: Some(host_username),
        error: None,
    };

    if let Ok(json) = serde_json::to_string(&ok_resp) {
        let _ = writer.write_all(format!("{}\n", json).as_bytes()).await;
        let _ = writer.finish();
    }

    // Register member
    peers_counter.fetch_add(1, Ordering::Relaxed);
    let ping_val = Arc::new(Mutex::new(Some(connection.rtt().as_secs_f64() * 1000.0)));
    let ping_clone = Arc::clone(&ping_val);
    let conn_for_ping = connection.clone();

    {
        let mut m = members_map.lock().unwrap_or_else(|e| e.into_inner());
        m.insert(
            peer_node_id.clone(),
            HostPeerSession {
                username: peer_username.clone(),
                node_id: peer_node_id.clone(),
                joined_at: now_secs(),
                ping_ms: ping_val,
                connection: connection.clone(),
            },
        );
    }

    // Ping tracking task for this peer
    let ping_task = tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_millis(2000)).await;
            let rtt = conn_for_ping.rtt();
            let mut lock = ping_clone.lock().unwrap_or_else(|e| e.into_inner());
            *lock = Some(rtt.as_secs_f64() * 1000.0);
        }
    });

    // Handle subsequent proxy streams (Minecraft TCP traffic)
    while let Ok((mut send_stream, mut recv_stream)) = connection.accept_bi().await {
        tokio::spawn(async move {
            let tcp_dest = format!("127.0.0.1:{}", target_port);
            let Ok(tcp_stream) = TcpStream::connect(&tcp_dest).await else {
                return;
            };

            let (mut tcp_read, mut tcp_write) = tcp_stream.into_split();

            let upload = async move {
                let _ = tokio::io::copy(&mut recv_stream, &mut tcp_write).await;
            };

            let download = async move {
                let _ = tokio::io::copy(&mut tcp_read, &mut send_stream).await;
                let _ = send_stream.finish();
            };

            let _ = tokio::join!(upload, download);
        });
    }

    // Cleanup when peer disconnects
    ping_task.abort();
    peers_counter.fetch_sub(1, Ordering::Relaxed);
    {
        let mut m = members_map.lock().unwrap_or_else(|e| e.into_inner());
        m.remove(&peer_node_id);
    }
}

pub async fn stop_p2p_host() -> Result<bool, String> {
    let state_opt = {
        let mut lock = HOST_STATE.lock().unwrap_or_else(|e| e.into_inner());
        lock.take()
    };
    if let Some(state) = state_opt {
        state.accept_task.abort();
        state.endpoint.close().await;
        Ok(true)
    } else {
        Ok(false)
    }
}

pub fn p2p_host_kick_peer(peer_node_id: &str) -> bool {
    let lock = HOST_STATE.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(ref state) = *lock {
        let mut map = state.members_map.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(session) = map.remove(peer_node_id) {
            let _ = session.connection.close(10u32.into(), b"Kicked by host");
            return true;
        }
    }
    false
}

pub fn p2p_host_toggle_lock() -> bool {
    let lock = HOST_STATE.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(ref state) = *lock {
        let current = state.is_locked.load(Ordering::Relaxed);
        state.is_locked.store(!current, Ordering::Relaxed);
        !current
    } else {
        false
    }
}

pub fn get_p2p_host_status() -> P2PHostStatus {
    let lock = HOST_STATE.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(ref state) = *lock {
        let host_entry = P2PMemberInfo {
            username: state.host_username.clone(),
            node_id: state.node_id.clone(),
            ping_ms: Some(0.0),
            joined_at: now_secs(),
            is_host: true,
        };

        let mut members = vec![host_entry];
        {
            let map = state.members_map.lock().unwrap_or_else(|e| e.into_inner());
            for session in map.values() {
                let ping = *session.ping_ms.lock().unwrap_or_else(|e| e.into_inner());
                members.push(P2PMemberInfo {
                    username: session.username.clone(),
                    node_id: session.node_id.clone(),
                    ping_ms: ping,
                    joined_at: session.joined_at,
                    is_host: false,
                });
            }
        }

        P2PHostStatus {
            is_running: true,
            ticket: Some(state.ticket.clone()),
            node_id: Some(state.node_id.clone()),
            room_name: Some(state.room_name.clone()),
            has_password: state.password.is_some(),
            target_port: state.target_port,
            connected_peers_count: state.peers_count.load(Ordering::Relaxed),
            members,
            direct_addresses: state.direct_addresses.clone(),
            is_locked: state.is_locked.load(Ordering::Relaxed),
        }
    } else {
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
}

/// Connects as a client to a remote P2P Host using Ticket + Player Username + optional Password.
pub async fn start_p2p_client(
    ticket: String,
    username: String,
    password: Option<String>,
) -> Result<P2PClientStatus, String> {
    stop_p2p_client().await?;

    let node_addr = decode_ticket(&ticket)?;
    let remote_node_id = node_addr.node_id.to_string();

    let endpoint = Endpoint::builder()
        .alpns(vec![ALPN.to_vec()])
        .bind()
        .await
        .map_err(|e| format!("Failed to create client P2P endpoint: {}", e))?;

    let client_node_id = endpoint
        .node_addr()
        .await
        .map(|a| a.node_id.to_string())
        .unwrap_or_else(|_| "client".to_string());

    let connection = endpoint
        .connect(node_addr, ALPN)
        .await
        .map_err(|e| format!("Failed to connect to P2P host: {}", e))?;

    // Perform Handshake Stream
    let (send_stream, recv_stream) = connection
        .open_bi()
        .await
        .map_err(|e| format!("Failed to open handshake stream to host: {}", e))?;

    let mut writer = send_stream;
    let mut reader = BufReader::new(recv_stream);

    let clean_username = if username.trim().is_empty() {
        "Player".to_string()
    } else {
        username.trim().to_string()
    };

    let req = HandshakeRequest {
        username: clean_username.clone(),
        password,
        node_id: client_node_id.clone(),
    };

    let req_json = serde_json::to_string(&req).map_err(|e| e.to_string())?;
    writer
        .write_all(format!("{}\n", req_json).as_bytes())
        .await
        .map_err(|e| format!("Failed to send handshake: {}", e))?;
    let _ = writer.flush().await;

    let mut resp_line = String::new();
    reader
        .read_line(&mut resp_line)
        .await
        .map_err(|e| format!("Failed to read handshake response from host: {}", e))?;

    let resp: HandshakeResponse = serde_json::from_str(resp_line.trim())
        .map_err(|e| format!("Invalid handshake response JSON: {}", e))?;

    if !resp.success {
        let err_msg = resp
            .error
            .unwrap_or_else(|| "Handshake rejected by host".to_string());
        let _ = connection.close(10u32.into(), err_msg.as_bytes());
        return Err(err_msg);
    }

    // Bind local TCP listener (try 39565 first, fall back to random open port 0)
    let listener = match TcpListener::bind("127.0.0.1:39565").await {
        Ok(l) => l,
        Err(_) => TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| format!("Failed to bind local proxy listener: {}", e))?,
    };

    let local_addr = listener
        .local_addr()
        .map_err(|e| format!("Failed to get local port: {}", e))?;
    let local_port = local_addr.port();

    let ping_ms = Arc::new(Mutex::new(None));
    let ping_clone = Arc::clone(&ping_ms);
    let conn_clone = connection.clone();

    // Background task to track connection RTT
    let ping_task = tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_millis(1500)).await;
            let rtt = conn_clone.rtt();
            let mut lock = ping_clone.lock().unwrap_or_else(|e| e.into_inner());
            *lock = Some(rtt.as_secs_f64() * 1000.0);
        }
    });

    let conn_for_proxy = connection.clone();
    let proxy_task = tokio::spawn(async move {
        while let Ok((tcp_stream, _)) = listener.accept().await {
            let conn = conn_for_proxy.clone();
            tokio::spawn(async move {
                let Ok((mut send_stream, mut recv_stream)) = conn.open_bi().await else {
                    return;
                };

                let (mut tcp_read, mut tcp_write) = tcp_stream.into_split();

                let upload = async move {
                    let _ = tokio::io::copy(&mut tcp_read, &mut send_stream).await;
                    let _ = send_stream.finish();
                };

                let download = async move {
                    let _ = tokio::io::copy(&mut recv_stream, &mut tcp_write).await;
                };

                let _ = tokio::join!(upload, download);
            });
        }
    });

    let members = vec![
        P2PMemberInfo {
            username: resp.host_username.clone().unwrap_or_else(|| "Host".to_string()),
            node_id: remote_node_id.clone(),
            ping_ms: None,
            joined_at: now_secs(),
            is_host: true,
        },
        P2PMemberInfo {
            username: clean_username.clone(),
            node_id: client_node_id,
            ping_ms: None,
            joined_at: now_secs(),
            is_host: false,
        },
    ];

    let status = P2PClientStatus {
        is_connected: true,
        room_name: resp.room_name.clone(),
        local_port: Some(local_port),
        remote_node_id: Some(remote_node_id.clone()),
        host_username: resp.host_username.clone(),
        ping_ms: None,
        members,
        error: None,
    };

    let mut lock = CLIENT_STATE.lock().unwrap_or_else(|e| e.into_inner());
    *lock = Some(ClientState {
        endpoint,
        _connection: connection,
        room_name: resp.room_name,
        host_username: resp.host_username,
        local_port,
        remote_node_id,
        client_username: clean_username,
        ping_ms,
        proxy_task,
        ping_task,
    });

    Ok(status)
}

pub async fn stop_p2p_client() -> Result<bool, String> {
    let state_opt = {
        let mut lock = CLIENT_STATE.lock().unwrap_or_else(|e| e.into_inner());
        lock.take()
    };
    if let Some(state) = state_opt {
        state.proxy_task.abort();
        state.ping_task.abort();
        state.endpoint.close().await;
        Ok(true)
    } else {
        Ok(false)
    }
}

pub fn get_p2p_client_status() -> P2PClientStatus {
    let lock = CLIENT_STATE.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(ref state) = *lock {
        let ping = *state.ping_ms.lock().unwrap_or_else(|e| e.into_inner());
        let members = vec![
            P2PMemberInfo {
                username: state
                    .host_username
                    .clone()
                    .unwrap_or_else(|| "Host".to_string()),
                node_id: state.remote_node_id.clone(),
                ping_ms: ping,
                joined_at: now_secs(),
                is_host: true,
            },
            P2PMemberInfo {
                username: state.client_username.clone(),
                node_id: "me".to_string(),
                ping_ms: Some(0.0),
                joined_at: now_secs(),
                is_host: false,
            },
        ];

        P2PClientStatus {
            is_connected: true,
            room_name: state.room_name.clone(),
            local_port: Some(state.local_port),
            remote_node_id: Some(state.remote_node_id.clone()),
            host_username: state.host_username.clone(),
            ping_ms: ping,
            members,
            error: None,
        }
    } else {
        P2PClientStatus {
            is_connected: false,
            room_name: None,
            local_port: None,
            remote_node_id: None,
            host_username: None,
            ping_ms: None,
            members: Vec::new(),
            error: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encode_and_decode_ticket() {
        use std::collections::BTreeSet;
        use std::net::SocketAddr;

        let raw_bytes = [7u8; 32];
        let key = iroh::SecretKey::from_bytes(&raw_bytes);
        let node_id = key.public();

        let mut direct = BTreeSet::new();
        direct.insert("127.0.0.1:55500".parse::<SocketAddr>().unwrap());
        direct.insert("113.190.4.206:55500".parse::<SocketAddr>().unwrap());

        let node_addr = NodeAddr {
            node_id,
            relay_url: None,
            direct_addresses: direct,
        };

        let ticket = encode_ticket(&node_addr).expect("encode should succeed");
        assert!(!ticket.is_empty());

        let decoded = decode_ticket(&ticket).expect("decode should succeed");
        assert_eq!(decoded.node_id, node_id);
        assert_eq!(decoded.direct_addresses.len(), 2);
    }
}
