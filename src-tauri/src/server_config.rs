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
    }
}

pub fn read_server_properties(dir: &str) -> Result<ServerPropertiesSummary, String> {
    let raw = fs::read_to_string(Path::new(dir).join(FILE_NAME))
        .map_err(|_| format!("No server.properties found in {}", dir))?;
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
    Ok(summary)
}

pub fn write_server_properties(dir: &str, summary: &ServerPropertiesSummary) -> Result<(), String> {
    let path = Path::new(dir).join(FILE_NAME);
    let raw = fs::read_to_string(&path)
        .map_err(|_| format!("No server.properties found in {}", dir))?;

    let mut updates = HashMap::new();
    updates.insert("online-mode".to_string(), summary.online_mode.to_string());
    updates.insert("pvp".to_string(), summary.pvp.to_string());
    updates.insert("white-list".to_string(), summary.white_list.to_string());
    updates.insert("difficulty".to_string(), summary.difficulty.clone());
    updates.insert("max-players".to_string(), summary.max_players.to_string());
    updates.insert("motd".to_string(), summary.motd.clone());

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
    }
}
