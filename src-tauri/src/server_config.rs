// A friendly editor for the handful of server.properties settings people actually change
// day to day (online-mode above all — the one that trips up a group of offline-account
// friends every time). Deliberately not a full properties editor: every other line in the
// file, comments included, passes through untouched.

use crate::models::ServerPropertiesSummary;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

const FILE_NAME: &str = "server.properties";

fn defaults() -> ServerPropertiesSummary {
    // Minecraft's own defaults for a freshly generated server.properties.
    ServerPropertiesSummary {
        online_mode: true,
        pvp: true,
        white_list: false,
        difficulty: "easy".to_string(),
        max_players: 20,
        motd: "A Minecraft Server".to_string(),
        server_port: 25565,
        gamemode: "survival".to_string(),
        view_distance: 10,
        simulation_distance: 10,
        allow_nether: true,
        spawn_protection: 16,
        hardcore: false,
        level_seed: "".to_string(),
        level_name: "world".to_string(),
    }
}

pub fn read_server_properties(dir: &str) -> Result<ServerPropertiesSummary, String> {
    let path = Path::new(dir).join(FILE_NAME);
    if !path.exists() {
        return Ok(defaults());
    }
    let raw = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
    let map = parse_properties(&raw);
    let mut summary = defaults();
    if let Some(v) = map.get("online-mode") {
        summary.online_mode = v == "true";
    }
    if let Some(v) = map.get("pvp") {
        summary.pvp = v == "true";
    }
    if let Some(v) = map.get("white-list") {
        summary.white_list = v == "true";
    }
    if let Some(v) = map.get("difficulty") {
        summary.difficulty = v.clone();
    }
    if let Some(v) = map.get("max-players") {
        if let Ok(n) = v.parse() {
            summary.max_players = n;
        }
    }
    if let Some(v) = map.get("motd") {
        summary.motd = v.clone();
    }
    if let Some(v) = map.get("server-port") {
        if let Ok(n) = v.parse() {
            summary.server_port = n;
        }
    }
    if let Some(v) = map.get("gamemode") {
        summary.gamemode = v.clone();
    }
    if let Some(v) = map.get("view-distance") {
        if let Ok(n) = v.parse() {
            summary.view_distance = n;
        }
    }
    if let Some(v) = map.get("simulation-distance") {
        if let Ok(n) = v.parse() {
            summary.simulation_distance = n;
        }
    }
    if let Some(v) = map.get("allow-nether") {
        summary.allow_nether = v == "true";
    }
    if let Some(v) = map.get("spawn-protection") {
        if let Ok(n) = v.parse() {
            summary.spawn_protection = n;
        }
    }
    if let Some(v) = map.get("hardcore") {
        summary.hardcore = v == "true";
    }
    if let Some(v) = map.get("level-seed") {
        summary.level_seed = v.clone();
    }
    if let Some(v) = map.get("level-name").filter(|v| !v.trim().is_empty()) {
        summary.level_name = v.clone();
    }
    Ok(summary)
}

/// The one `server.properties` key `ServerPropertiesSummary` doesn't model — needed on its own
/// by the backup feature to know which world folder(s) to archive. Minecraft's own default
/// (`world`) covers both a missing file and a file with no `level-name` line.
pub fn read_level_name(dir: &Path) -> String {
    let Ok(raw) = fs::read_to_string(dir.join(FILE_NAME)) else {
        return "world".to_string();
    };
    parse_properties(&raw)
        .get("level-name")
        .cloned()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| "world".to_string())
}

pub fn write_server_properties(dir: &str, summary: &ServerPropertiesSummary) -> Result<(), String> {
    // Only ever writes into a directory a server was actually prepared in — creating one here
    // would scatter a lone server.properties into whatever path happened to be selected.
    let dir_path = Path::new(dir);
    if !dir_path.is_dir() {
        return Err(format!("No server directory at {}", dir_path.display()));
    }
    let path = dir_path.join(FILE_NAME);
    // A prepared server that has not been started yet has no server.properties on disk; the
    // settings the player picks before that first launch still have to be saved somewhere.
    let raw = fs::read_to_string(&path).unwrap_or_default();

    let mut updates = HashMap::new();
    updates.insert("online-mode".to_string(), summary.online_mode.to_string());
    updates.insert("pvp".to_string(), summary.pvp.to_string());
    updates.insert("white-list".to_string(), summary.white_list.to_string());
    updates.insert("difficulty".to_string(), summary.difficulty.clone());
    updates.insert("max-players".to_string(), summary.max_players.to_string());
    updates.insert("motd".to_string(), summary.motd.clone());
    updates.insert("server-port".to_string(), summary.server_port.to_string());
    updates.insert("gamemode".to_string(), summary.gamemode.clone());
    updates.insert("view-distance".to_string(), summary.view_distance.to_string());
    updates.insert("simulation-distance".to_string(), summary.simulation_distance.to_string());
    updates.insert("allow-nether".to_string(), summary.allow_nether.to_string());
    updates.insert("spawn-protection".to_string(), summary.spawn_protection.to_string());
    updates.insert("hardcore".to_string(), summary.hardcore.to_string());
    updates.insert("level-seed".to_string(), summary.level_seed.clone());

    fs::write(&path, apply_updates(&raw, &updates)).map_err(|e| e.to_string())
}

/// Only lines of the form `key=value` (or `key:value`, which Java's own properties format
/// also accepts) are read; comments and blank lines are simply not in the map.
fn parse_properties(raw: &str) -> HashMap<String, String> {
    raw.lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with('!') {
                return None;
            }
            let sep = trimmed.find(['=', ':'])?;
            let (key, value) = trimmed.split_at(sep);
            Some((key.trim().to_string(), value[1..].trim().to_string()))
        })
        .collect()
}

/// Rewrites only the lines whose key is in `updates`, in place — every other line, comments
/// and blank lines included, stays byte-for-byte as it was. A key from `updates` with no
/// existing line is appended at the end, in `updates`' own (unordered) iteration order.
fn apply_updates(raw: &str, updates: &HashMap<String, String>) -> String {
    let mut seen = HashSet::new();
    let mut lines: Vec<String> = raw
        .lines()
        .map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with('!') {
                return line.to_string();
            }
            let Some(sep) = trimmed.find(['=', ':']) else {
                return line.to_string();
            };
            let key = trimmed[..sep].trim();
            match updates.get(key) {
                Some(value) => {
                    seen.insert(key.to_string());
                    format!("{}={}", key, value)
                }
                None => line.to_string(),
            }
        })
        .collect();

    for (key, value) in updates {
        if !seen.contains(key) {
            lines.push(format!("{}={}", key, value));
        }
    }

    let mut out = lines.join("\n");
    out.push('\n');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "\
#Minecraft server properties
#Thu Sep 11 00:00:00 UTC 2026
online-mode=true
gamemode=survival
difficulty=easy
motd=A Minecraft Server
max-players=20
pvp=true
white-list=false
level-name=world
";

    #[test]
    fn reads_the_known_keys_and_leaves_the_rest_out() {
        let map = parse_properties(SAMPLE);
        assert_eq!(map.get("online-mode").map(String::as_str), Some("true"));
        assert_eq!(map.get("gamemode").map(String::as_str), Some("survival"));
        // Comments never make it into the map at all.
        assert_eq!(map.len(), 8);
    }

    #[test]
    fn toggling_online_mode_leaves_every_other_line_untouched() {
        let mut updates = HashMap::new();
        updates.insert("online-mode".to_string(), "false".to_string());
        let out = apply_updates(SAMPLE, &updates);

        assert!(out.contains("online-mode=false"));
        // Untouched keys and every comment survive exactly as they were.
        assert!(out.contains("#Minecraft server properties"));
        assert!(out.contains("gamemode=survival"));
        assert!(out.contains("level-name=world"));
        // Nothing else was rewritten — same line count as the input.
        assert_eq!(out.lines().count(), SAMPLE.lines().count());
    }

    #[test]
    fn appends_a_managed_key_the_file_does_not_have_yet() {
        let no_pvp_line = "online-mode=true\nmotd=Hi\n";
        let mut updates = HashMap::new();
        updates.insert("pvp".to_string(), "false".to_string());
        let out = apply_updates(no_pvp_line, &updates);
        assert!(out.contains("pvp=false"));
        assert!(out.contains("online-mode=true"));
    }

    #[test]
    fn missing_keys_fall_back_to_minecrafts_own_defaults() {
        let summary = defaults();
        assert!(summary.online_mode);
        assert_eq!(summary.difficulty, "easy");
        assert_eq!(summary.max_players, 20);
        assert_eq!(summary.gamemode, "survival");
        assert_eq!(summary.view_distance, 10);
        assert_eq!(summary.simulation_distance, 10);
        assert!(summary.allow_nether);
        assert_eq!(summary.spawn_protection, 16);
        assert!(!summary.hardcore);
        assert_eq!(summary.level_seed, "");
    }

    #[test]
    fn reads_and_writes_extended_properties() {
        let dir = std::env::temp_dir().join("mcl-server-config-test-extended");
        let _ = fs::create_dir_all(&dir);
        let path = dir.join(FILE_NAME);
        fs::write(
            &path,
            "gamemode=creative\nview-distance=16\nsimulation-distance=12\nallow-nether=false\nspawn-protection=32\nhardcore=true\nlevel-seed=123456789\n",
        ).unwrap();

        let parsed = read_server_properties(&dir.to_string_lossy()).unwrap();
        assert_eq!(parsed.gamemode, "creative");
        assert_eq!(parsed.view_distance, 16);
        assert_eq!(parsed.simulation_distance, 12);
        assert!(!parsed.allow_nether);
        assert_eq!(parsed.spawn_protection, 32);
        assert!(parsed.hardcore);
        assert_eq!(parsed.level_seed, "123456789");

        let mut updated = parsed;
        updated.gamemode = "adventure".to_string();
        updated.view_distance = 24;
        write_server_properties(&dir.to_string_lossy(), &updated).unwrap();

        let reread = read_server_properties(&dir.to_string_lossy()).unwrap();
        assert_eq!(reread.gamemode, "adventure");
        assert_eq!(reread.view_distance, 24);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_level_name_finds_a_custom_name_and_falls_back_to_world() {
        let dir = std::env::temp_dir().join("mcl-server-config-test-level-name");
        let _ = fs::create_dir_all(&dir);

        // No server.properties at all yet — Minecraft's own default.
        assert_eq!(read_level_name(&dir), "world");

        fs::write(dir.join(FILE_NAME), "level-name=survival_smp\nonline-mode=true\n").unwrap();
        assert_eq!(read_level_name(&dir), "survival_smp");

        let _ = fs::remove_dir_all(&dir);
    }
}
