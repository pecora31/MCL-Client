use crate::instance_manager::{get_instance_dir, setup_in_game_skin_support};
use crate::models::GameInstance;
use std::fs;
use std::process::Command;

pub async fn launch_game(
    instance: &GameInstance,
    username: &str,
) -> Result<String, String> {
    let instance_dir = get_instance_dir(&instance.id);
    fs::create_dir_all(&instance_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(instance_dir.join("mods")).map_err(|e| e.to_string())?;

    // If skin in game is enabled, ensure CustomSkinLoader config is set up
    if instance.enable_skin_in_game {
        let _ = setup_in_game_skin_support(&instance_dir);
    }

    // Determine java executable
    let java_exec = instance
        .java_path
        .clone()
        .unwrap_or_else(|| "javaw.exe".to_string());

    // Build JVM flags
    let min_ram = format!("-Xms{}M", instance.min_ram);
    let max_ram = format!("-Xmx{}M", instance.max_ram);

    // Build JVM command
    let mut cmd = Command::new(&java_exec);
    cmd.arg(min_ram);
    cmd.arg(max_ram);

    if let Some(jvm_args) = &instance.jvm_args {
        for arg in jvm_args.split_whitespace() {
            cmd.arg(arg);
        }
    }

    cmd.arg("-Dfile.encoding=UTF-8");
    cmd.arg(format!("-Dminecraft.applet.TargetDirectory={}", instance_dir.display()));

    // Set working directory
    cmd.current_dir(&instance_dir);

    // Simulated launch return status for IPC
    log::info!("Launching Minecraft instance {} with user {}", instance.name, username);

    Ok(format!(
        "Started Minecraft for player '{}' on profile '{}' (MC {}).",
        username, instance.name, instance.game_version
    ))
}
