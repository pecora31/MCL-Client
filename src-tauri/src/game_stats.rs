//! Reads the statistics Minecraft writes for itself.
//!
//! Every singleplayer world keeps `stats/<player-uuid>.json`, so these numbers need no mod
//! and no server: the game has already recorded them. Multiplayer sessions are stored on the
//! server instead, which is why the launcher also tracks wall-clock playtime of its own.

use crate::instance_manager::get_instance_dir;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

/// Minecraft counts time in ticks; twenty of them make a second.
const TICKS_PER_MINUTE: u64 = 20 * 60;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldStats {
    pub world_name: String,
    pub play_time_minutes: u64,
    pub deaths: u64,
    pub mob_kills: u64,
    pub blocks_mined: u64,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceStats {
    /// Wall-clock minutes the launcher itself measured, so multiplayer counts too.
    pub tracked_play_minutes: u64,
    /// Minutes the game recorded, which only ever covers singleplayer worlds.
    pub in_game_play_minutes: u64,
    pub deaths: u64,
    pub mob_kills: u64,
    pub player_kills: u64,
    pub blocks_mined: u64,
    pub items_crafted: u64,
    pub distance_walked_km: f64,
    pub jumps: u64,
    pub worlds: Vec<WorldStats>,
}

#[derive(Debug, Deserialize)]
struct StatsFile {
    #[serde(default)]
    stats: StatsSections,
}

#[derive(Debug, Default, Deserialize)]
struct StatsSections {
    #[serde(rename = "minecraft:custom", default)]
    custom: HashMap<String, u64>,
    #[serde(rename = "minecraft:mined", default)]
    mined: HashMap<String, u64>,
    #[serde(rename = "minecraft:crafted", default)]
    crafted: HashMap<String, u64>,
}

/// 1.17 renamed the playtime counter; older worlds still carry the previous key, whose name
/// says "one minute" but which has always held ticks.
fn play_time_ticks(custom: &HashMap<String, u64>) -> u64 {
    custom
        .get("minecraft:play_time")
        .or_else(|| custom.get("minecraft:play_one_minute"))
        .copied()
        .unwrap_or(0)
}

fn sum(map: &HashMap<String, u64>) -> u64 {
    map.values().sum()
}

fn read_world(world_dir: &Path) -> Option<(WorldStats, StatsSections)> {
    let stats_dir = world_dir.join("stats");
    if !stats_dir.is_dir() {
        return None;
    }

    // A world holds one file per player that has joined it. In singleplayer that is the one
    // local player, but a world copied off a LAN host can carry several, so all are summed.
    let mut merged = StatsSections::default();
    let mut found_any = false;

    for entry in fs::read_dir(&stats_dir).ok()?.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Ok(raw) = fs::read_to_string(&path) else { continue };
        // A world still being written to can hold a half-flushed file; skipping it loses one
        // world's numbers rather than the whole report.
        let Ok(parsed) = serde_json::from_str::<StatsFile>(&raw) else { continue };

        found_any = true;
        for (key, value) in parsed.stats.custom {
            *merged.custom.entry(key).or_insert(0) += value;
        }
        for (key, value) in parsed.stats.mined {
            *merged.mined.entry(key).or_insert(0) += value;
        }
        for (key, value) in parsed.stats.crafted {
            *merged.crafted.entry(key).or_insert(0) += value;
        }
    }

    if !found_any {
        return None;
    }

    let world_name = world_dir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "Unknown world".to_string());

    let summary = WorldStats {
        world_name,
        play_time_minutes: play_time_ticks(&merged.custom) / TICKS_PER_MINUTE,
        deaths: merged.custom.get("minecraft:deaths").copied().unwrap_or(0),
        mob_kills: merged.custom.get("minecraft:mob_kills").copied().unwrap_or(0),
        blocks_mined: sum(&merged.mined),
    };

    Some((summary, merged))
}

pub fn read_instance_stats(instance_id: &str, tracked_play_minutes: u64) -> InstanceStats {
    let saves_dir = get_instance_dir(instance_id).join("saves");

    let mut stats = InstanceStats {
        tracked_play_minutes,
        ..Default::default()
    };

    let Ok(entries) = fs::read_dir(&saves_dir) else {
        // No saves folder at all simply means nothing has been played offline yet.
        return stats;
    };

    let mut walked_cm: u64 = 0;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some((world, sections)) = read_world(&path) else { continue };

        stats.in_game_play_minutes += world.play_time_minutes;
        stats.deaths += world.deaths;
        stats.mob_kills += world.mob_kills;
        stats.blocks_mined += world.blocks_mined;
        stats.player_kills += sections
            .custom
            .get("minecraft:player_kills")
            .copied()
            .unwrap_or(0);
        stats.jumps += sections.custom.get("minecraft:jump").copied().unwrap_or(0);
        stats.items_crafted += sum(&sections.crafted);
        walked_cm += sections
            .custom
            .get("minecraft:walk_one_cm")
            .copied()
            .unwrap_or(0);

        stats.worlds.push(world);
    }

    stats.distance_walked_km = walked_cm as f64 / 100_000.0;
    // Most played first, so the list opens on the world that actually matters.
    stats
        .worlds
        .sort_by(|a, b| b.play_time_minutes.cmp(&a.play_time_minutes));

    stats
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefers_the_modern_playtime_key_and_falls_back_to_the_old_one() {
        let mut modern = HashMap::new();
        modern.insert("minecraft:play_time".to_string(), 24_000);
        modern.insert("minecraft:play_one_minute".to_string(), 999);
        assert_eq!(play_time_ticks(&modern), 24_000);

        let mut legacy = HashMap::new();
        legacy.insert("minecraft:play_one_minute".to_string(), 36_000);
        assert_eq!(play_time_ticks(&legacy), 36_000);

        assert_eq!(play_time_ticks(&HashMap::new()), 0);
    }

    #[test]
    fn reads_and_merges_every_player_file_in_a_world() {
        let dir = std::env::temp_dir().join(format!("mcl-stats-test-{}", uuid::Uuid::new_v4()));
        let stats_dir = dir.join("stats");
        fs::create_dir_all(&stats_dir).unwrap();

        fs::write(
            stats_dir.join("player-a.json"),
            r#"{"stats":{"minecraft:custom":{"minecraft:play_time":36000,"minecraft:deaths":2},
                        "minecraft:mined":{"minecraft:stone":40,"minecraft:dirt":10}},
                "DataVersion":3953}"#,
        )
        .unwrap();
        fs::write(
            stats_dir.join("player-b.json"),
            r#"{"stats":{"minecraft:custom":{"minecraft:play_time":24000,"minecraft:deaths":1},
                        "minecraft:mined":{"minecraft:stone":5}},
                "DataVersion":3953}"#,
        )
        .unwrap();
        // Half-written files must not take the whole world's numbers down with them
        fs::write(stats_dir.join("corrupt.json"), "{not json").unwrap();

        let (world, sections) = read_world(&dir).unwrap();
        assert_eq!(world.play_time_minutes, 50); // (36000 + 24000) ticks
        assert_eq!(world.deaths, 3);
        assert_eq!(world.blocks_mined, 55);
        assert_eq!(sum(&sections.mined), 55);

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn ignores_a_world_folder_without_a_stats_directory() {
        let dir = std::env::temp_dir().join(format!("mcl-stats-empty-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        assert!(read_world(&dir).is_none());
        fs::remove_dir_all(&dir).ok();
    }
}
