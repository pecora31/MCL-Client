-- ==============================================================================
-- MCL Minecraft Launcher - Cloudflare D1 Database Schema
-- Hybrid Account System (Scenario B: D1 Database + R2 Object Storage)
--
-- STATUS: UNAPPROVED PROPOSAL, NOT DEPLOYED, NOT REFERENCED BY ANY CODE.
-- Adding accounts with emails and password hashes reverses the "no accounts, no
-- analytics" promise in README.md and PRIVACY.md. See README.md in this folder
-- before running any of this against a real Cloudflare account.
-- ==============================================================================

-- 1. Users Table (Core Identity & Password Authentication)
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,                           -- UUID v4
    username TEXT UNIQUE NOT NULL COLLATE NOCASE,  -- Minecraft username (case-insensitive unique, 3-16 chars)
    email TEXT UNIQUE COLLATE NOCASE,             -- Optional account recovery email
    password_hash TEXT NOT NULL,                  -- Argon2id or scrypt / PBKDF2-SHA256 hashed password
    password_salt TEXT NOT NULL,                  -- 16-byte random cryptographic salt (Hex)
    primary_node_id TEXT,                         -- Default iroh Ed25519 node public key (Hex)
    skin_hash TEXT,                               -- SHA-256 hash of currently active skin in R2
    skin_model TEXT DEFAULT 'classic',            -- 'classic' (Steve, 4px) or 'slim' (Alex, 3px)
    created_at INTEGER NOT NULL,                  -- Unix timestamp (seconds)
    updated_at INTEGER NOT NULL                   -- Unix timestamp (seconds)
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- 2. User Node Identifiers (Multiple devices / AppData node IDs per user)
CREATE TABLE IF NOT EXISTS user_nodes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,                        -- iroh Ed25519 public key (64 hex chars)
    device_label TEXT,                            -- e.g. "Long's PC - Desktop", "Gaming Laptop"
    first_seen_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    UNIQUE(user_id, node_id)
);

CREATE INDEX IF NOT EXISTS idx_user_nodes_node_id ON user_nodes(node_id);

-- 3. Skin Assets Storage Metadata (Skins stored in Cloudflare R2 bucket)
CREATE TABLE IF NOT EXISTS skins (
    skin_hash TEXT PRIMARY KEY,                   -- SHA-256 content hash (64 hex chars)
    r2_key TEXT NOT NULL,                         -- Path in R2 bucket (e.g. "skins/{skin_hash}.png")
    uploader_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    size_bytes INTEGER NOT NULL,                  -- Skin PNG size (typically ~2-15 KB)
    model TEXT DEFAULT 'classic',
    created_at INTEGER NOT NULL
);

-- 4. Auth Sessions / Bearer Tokens (JWT or random opaque tokens)
CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash TEXT PRIMARY KEY,                  -- SHA-256 of active session bearer token
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    node_id TEXT,                                 -- Device node ID if bound
    expires_at INTEGER NOT NULL,                  -- Unix timestamp
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON auth_sessions(expires_at);

-- 5. P2P Multiplayer Rooms Directory (Optional Discovery Cache)
CREATE TABLE IF NOT EXISTS p2p_rooms (
    id TEXT PRIMARY KEY,
    host_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    host_node_id TEXT NOT NULL,
    room_name TEXT NOT NULL,
    has_password INTEGER NOT NULL DEFAULT 0,       -- 1 if room requires password, 0 otherwise
    ticket_data TEXT NOT NULL,                    -- iroh NodeTicket base64 encoded
    is_locked INTEGER NOT NULL DEFAULT 0,
    max_players INTEGER NOT NULL DEFAULT 8,
    active_players_count INTEGER NOT NULL DEFAULT 1,
    last_heartbeat_at INTEGER NOT NULL            -- Rooms pruned after 60 seconds without heartbeat
);

CREATE INDEX IF NOT EXISTS idx_rooms_heartbeat ON p2p_rooms(last_heartbeat_at);
