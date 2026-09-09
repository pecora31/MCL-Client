//! Discord Rich Presence.
//!
//! Everything here is best-effort: Discord may not be installed, may not be running, or may
//! be closed halfway through a session. None of that is an error the player needs to hear
//! about, so failures only ever reach the log.
//!
//! Commands are handed to one background thread rather than executed inline. The IPC calls
//! are short, but the launch path must never wait on a pipe that Discord may not answer, and
//! a single worker keeps updates in the order they were requested.

use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use std::sync::mpsc::{channel, Sender};
use std::sync::OnceLock;

/// The launcher's own application registered with Discord; it only names the app and
/// carries no permissions.
const APPLICATION_ID: &str = "1547328138412040315";

/// Uploaded under Rich Presence → Art Assets in the Discord developer portal. Discord
/// ignores a key it does not know, so a missing asset costs nothing but the icon.
const LARGE_IMAGE_KEY: &str = "mcl_logo";

#[derive(Debug, Clone)]
pub struct PlayingInfo {
    pub instance_name: String,
    pub game_version: String,
    pub loader: String,
    pub server: Option<String>,
    /// Unix seconds, so Discord can count the session up on its own.
    pub started_at: i64,
}

#[derive(Debug, Clone)]
enum Presence {
    Idle,
    Playing(PlayingInfo),
}

enum Command {
    SetEnabled(bool),
    Show(Presence),
}

static SENDER: OnceLock<Sender<Command>> = OnceLock::new();

fn describe(loader: &str) -> String {
    match loader {
        "fabric" => "Fabric".to_string(),
        "quilt" => "Quilt".to_string(),
        "forge" => "Forge".to_string(),
        "neoforge" => "NeoForge".to_string(),
        "vanilla" => "Vanilla".to_string(),
        other => other.to_string(),
    }
}

fn build_activity(presence: &Presence) -> activity::Activity<'_> {
    let base = activity::Activity::new().assets(
        activity::Assets::new()
            .large_image(LARGE_IMAGE_KEY)
            .large_text("MCLv2"),
    );

    match presence {
        Presence::Idle => base.details("In the launcher").state("Picking a profile"),
        Presence::Playing(info) => {
            let state = match &info.server {
                Some(server) => format!("On {}", server),
                None => format!("{} · {}", info.game_version, describe(&info.loader)),
            };
            base.details(&info.instance_name)
                .state(state)
                .timestamps(activity::Timestamps::new().start(info.started_at))
        }
    }
}

/// Owns the connection. Kept in one place so a dropped Discord client is reconnected on the
/// next update rather than leaving presence stuck on whatever was last shown.
struct Worker {
    enabled: bool,
    client: Option<DiscordIpcClient>,
    last: Presence,
}

impl Worker {
    fn new() -> Self {
        Self {
            enabled: false,
            client: None,
            last: Presence::Idle,
        }
    }

    fn disconnect(&mut self) {
        if let Some(mut client) = self.client.take() {
            let _ = client.close();
        }
    }

    fn apply(&mut self) {
        if !self.enabled {
            return;
        }

        if self.client.is_none() {
            let mut client = DiscordIpcClient::new(APPLICATION_ID);
            match client.connect() {
                Ok(()) => self.client = Some(client),
                Err(e) => {
                    // Discord simply is not running. Worth one line, not a retry loop.
                    log::debug!("Discord Rich Presence unavailable: {}", e);
                    return;
                }
            }
        }

        let activity = build_activity(&self.last);
        if let Some(client) = self.client.as_mut() {
            if let Err(e) = client.set_activity(activity) {
                log::debug!("Discord Rich Presence update failed: {}", e);
                // Discord was probably closed; the next update reconnects.
                self.disconnect();
            }
        }
    }

    fn handle(&mut self, command: Command) {
        match command {
            Command::SetEnabled(enabled) => {
                if self.enabled == enabled {
                    return;
                }
                self.enabled = enabled;
                if enabled {
                    self.apply();
                } else {
                    self.disconnect();
                }
            }
            Command::Show(presence) => {
                self.last = presence;
                self.apply();
            }
        }
    }
}

fn sender() -> &'static Sender<Command> {
    SENDER.get_or_init(|| {
        let (tx, rx) = channel::<Command>();
        std::thread::spawn(move || {
            let mut worker = Worker::new();
            // Ends when the sender is dropped, which only happens as the process exits.
            while let Ok(command) = rx.recv() {
                worker.handle(command);
            }
            worker.disconnect();
        });
        tx
    })
}

/// Ignored if the worker thread is gone: presence is never worth failing a caller over.
fn send(command: Command) {
    let _ = sender().send(command);
}

pub fn set_enabled(enabled: bool) {
    send(Command::SetEnabled(enabled));
}

pub fn show_idle() {
    send(Command::Show(Presence::Idle));
}

pub fn show_playing(info: PlayingInfo) {
    send(Command::Show(Presence::Playing(info)));
}

pub fn now_unix_seconds() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shows_the_server_instead_of_the_version_when_connected_to_one() {
        let info = PlayingInfo {
            instance_name: "Survival".to_string(),
            game_version: "1.21.1".to_string(),
            loader: "fabric".to_string(),
            server: Some("play.example.com".to_string()),
            started_at: 1_700_000_000,
        };
        let presence = Presence::Playing(info);
        let rendered = serde_json::to_string(&build_activity(&presence)).unwrap();
        assert!(rendered.contains("On play.example.com"));
        assert!(rendered.contains("Survival"));
    }

    #[test]
    fn falls_back_to_version_and_loader_in_singleplayer() {
        let info = PlayingInfo {
            instance_name: "Modded".to_string(),
            game_version: "1.20.1".to_string(),
            loader: "neoforge".to_string(),
            server: None,
            started_at: 0,
        };
        let presence = Presence::Playing(info);
        let rendered = serde_json::to_string(&build_activity(&presence)).unwrap();
        assert!(rendered.contains("1.20.1 · NeoForge"), "got {}", rendered);
    }

    #[test]
    fn idle_presence_carries_no_timestamp() {
        let rendered = serde_json::to_string(&build_activity(&Presence::Idle)).unwrap();
        assert!(rendered.contains("In the launcher"));
        assert!(!rendered.contains("timestamps"));
    }
}
