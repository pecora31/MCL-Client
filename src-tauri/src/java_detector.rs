use crate::hidden_process::hidden_command;
use crate::models::JavaInstallation;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

/// Determines the minimum required Java major version for a given Minecraft version.
///
/// Minecraft moved away from "1.X.Y" numbering after 1.21.11 (25 Mar 2026): "26.1" was the
/// first release under the new "<year>.<drop>" scheme, and it also bumped the bundled JDK
/// to 25 — the same kind of jump 1.17 and 1.20.5 made before it, just easy to miss because
/// the version string itself changed shape at the same moment. A version comparison that
/// assumed every future version still starts with "1." would have quietly kept returning
/// 21 for 26.1 and let it run on a Java version the game itself refuses.
///
/// - MC < 1.17          → Java 8
/// - MC 1.17–1.20.4     → Java 17
/// - MC 1.20.5–1.21.11  → Java 21
/// - MC 26.1+ (new scheme) → Java 25, verified against the real 26.1 and 26.2 releases
///
/// The new scheme has no machine-readable "required Java" feed to check against, so this
/// will need revisiting by hand whenever Mojang next bumps the bundled JDK — same as the
/// last two times, just without "1." to eyeball as a version-scheme flag anymore.
pub fn required_java_major(game_version: &str) -> u32 {
    // Parse the numeric components: "1.20.4" → [1, 20, 4]
    let parts: Vec<u32> = game_version
        .split('.')
        .filter_map(|s| s.parse::<u32>().ok())
        .collect();

    let (major, minor, patch) = match parts.len() {
        0 => return 25, // unparseable → assume the newest known requirement
        1 => (parts[0], 0u32, 0u32),
        2 => (parts[0], parts[1], 0u32),
        _ => (parts[0], parts[1], parts[2]),
    };

    if major == 1 {
        if minor < 17 {
            return 8;
        }
        if minor < 20 {
            return 17;
        }
        if minor == 20 && patch <= 4 {
            return 17;
        }
        return 21; // 1.20.5-1.21.11, the last releases under the old scheme
    }

    // The new "<year>.<drop>" scheme starts at 26.1, so anything reaching here is 26 or
    // later by construction — every release under it so far has needed Java 25.
    25
}

/// The newest Java MCL will trust for a given "required" bucket without downloading the exact
/// one instead.
///
/// A JDK that merely clears the floor is not enough to assume "newer runtime, still fine":
/// Forge/NeoForge (and their installers) parse bytecode with an ASM version frozen at that
/// loader release, and it cannot read class files a JDK released well after it produces. This
/// crashed for real — Java 25 running Forge for MC 1.20.1 (which only needs Java 17) failed
/// with "Unsupported class file major version 69" the moment ModLauncher tried to transform a
/// class. Each bucket's ceiling is the next version Mojang itself has actually shipped as the
/// bundled runtime for some Minecraft release, since that's the newest JDK the loader ecosystem
/// for that era has plausibly been tested against.
fn max_safe_java_major(required: u32) -> u32 {
    match required {
        8 => 8,
        17 => 21, // Mojang's own next bundled-runtime bump, and as far as Forge/NeoForge for
        // this era has broadly proven itself
        21 => 21, // no newer bucket confirmed safe yet for loaders built against this one
        _ => u32::MAX, // the newest known requirement — nothing newer to compare against
    }
}

/// Whether Automatic may run a game on the Java it found instead of downloading the exact one.
///
/// Games built for Java 8 insist on Java 8. From Java 17 on, a newer runtime generally runs the
/// game fine — but only up to `max_safe_java_major`; past that, a fresh download of the exact
/// required version is safer than trusting a JDK this loader era was never tested against.
pub fn installed_java_fits(found_major: u32, required: u32) -> bool {
    if required == 8 {
        found_major == 8
    } else {
        found_major >= required && found_major <= max_safe_java_major(required)
    }
}

/// Finds the best matching Java executable from the detected list for a given Minecraft version.
/// Returns `(java_exe_path, major_version, reason_string)`.
pub fn find_best_java_for_version(game_version: &str) -> (String, u32, String) {
    let required = required_java_major(game_version);
    let javas = detect_installed_javas();

    if javas.is_empty() {
        return (
            java_command_name().to_string(),
            0,
            "No Java runtime found on this system. Please install Java.".to_string(),
        );
    }

    // 1st priority: exact major version match
    if let Some(exact) = javas.iter().find(|j| j.major_version == required) {
        return (
            exact.path.clone(),
            exact.major_version,
            format!(
                "Selected {} (exact match: Java {} for MC {})",
                exact.version_string, required, game_version
            ),
        );
    }

    // 2nd priority: any version within the safe range for this requirement (pick the lowest
    // that satisfies) — see max_safe_java_major for why this isn't just "anything newer".
    let ceiling = max_safe_java_major(required);
    let mut compatible: Vec<&JavaInstallation> = javas
        .iter()
        .filter(|j| j.major_version >= required && j.major_version <= ceiling)
        .collect();
    compatible.sort_by_key(|j| j.major_version);

    if let Some(best) = compatible.first() {
        return (
            best.path.clone(),
            best.major_version,
            format!(
                "Selected {} (Java {} meets the Java {} requirement for MC {})",
                best.version_string, best.major_version, required, game_version
            ),
        );
    }

    // 3rd fallback: highest version available (may not work but best effort)
    let mut all_sorted = javas.clone();
    all_sorted.sort_by_key(|j| std::cmp::Reverse(j.major_version));
    let fallback = &all_sorted[0];
    (
        fallback.path.clone(),
        fallback.major_version,
        format!(
            "⚠ No Java {} or newer found. Falling back to {} (Java {}); the game may fail to start.",
            required, fallback.version_string, fallback.major_version
        ),
    )
}

/// The bare command name a fresh `javaw.exe`/`java` would be spawned as when nothing more
/// specific is known — never a real answer on its own, only what `PATH` lookup falls back to.
/// A hosted server always wants the console-attached binary (never `javaw`, Windows' windowless
/// variant, which is fine for the client GUI but not for a process whose stdout/stdin this
/// launcher needs to pipe).
fn java_command_name() -> &'static str {
    if cfg!(windows) {
        "java.exe"
    } else {
        "java"
    }
}

/// Every filename this platform's JDKs/JREs ship their console-attached `java` binary under,
/// checked in order. `javaw.exe` is included on Windows too (it's what the client launch path
/// has historically preferred, for no console flash), but `java.exe` is what a hosted server
/// actually needs — see `java_command_name`.
fn java_binary_names() -> &'static [&'static str] {
    if cfg!(windows) {
        &["javaw.exe", "java.exe"]
    } else {
        &["java"]
    }
}

pub fn detect_installed_javas() -> Vec<JavaInstallation> {
    let mut results: Vec<JavaInstallation> = Vec::new();
    let mut visited_paths = std::collections::HashSet::new();

    // Check environment variables
    if let Ok(java_home) = std::env::var("JAVA_HOME") {
        check_and_add(&PathBuf::from(java_home), &mut results, &mut visited_paths);
    }

    let mut candidates = vec![
        // Runtimes this launcher downloaded itself — the one location that matters on every
        // platform, since it's where a VPS running the headless agent keeps whatever Java it
        // fetched for itself.
        crate::java_runtime::runtime_root(),
    ];

    if cfg!(windows) {
        let program_files = std::env::var("ProgramFiles").unwrap_or_else(|_| "C:\\Program Files".to_string());
        let program_files_x86 =
            std::env::var("ProgramFiles(x86)").unwrap_or_else(|_| "C:\\Program Files (x86)".to_string());
        candidates.extend([
            PathBuf::from(&program_files).join("Common Files").join("Oracle").join("Java").join("javapath"),
            PathBuf::from(&program_files).join("Java"),
            PathBuf::from(&program_files).join("Eclipse Adoptium"),
            PathBuf::from(&program_files).join("Microsoft"),
            PathBuf::from(&program_files).join("BellSoft"),
            PathBuf::from(&program_files).join("Zulu"),
            PathBuf::from(&program_files_x86).join("Java"),
        ]);
    } else {
        // Where a distro's package manager (apt, dnf, pacman) puts OpenJDK, and where
        // update-alternatives keeps the version currently selected — the layout `apt install
        // default-jre`/`openjdk-*-jre` leaves behind, which is what the VM Bootstrap Wizard
        // installs on a fresh VPS.
        candidates.extend([
            PathBuf::from("/usr/lib/jvm"),
            PathBuf::from("/usr/lib64/jvm"),
            PathBuf::from("/opt/java"),
        ]);
    }

    // Whatever `java` resolves to on PATH, however it's set up — package manager, manual
    // install, update-alternatives. `where.exe` is Windows-only; `which` is its Unix analogue.
    let path_lookup = if cfg!(windows) { ("where.exe", "javaw") } else { ("which", "java") };
    if let Ok(output) = hidden_command(path_lookup.0).arg(path_lookup.1).output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                let trimmed = line.trim();
                if !trimmed.is_empty() && Path::new(trimmed).exists() {
                    let path_buf = PathBuf::from(trimmed);
                    let p_str = path_buf.to_string_lossy().to_string();
                    if !visited_paths.contains(&p_str) {
                        visited_paths.insert(p_str.clone());
                        let (major, ver_str, is_64_bit) = detect_version_from_executable(&path_buf, "System PATH");
                        results.push(JavaInstallation {
                            path: p_str,
                            major_version: major,
                            version_string: ver_str,
                            is_64_bit,
                        });
                    }
                }
            }
        }
    }

    for base_dir in candidates {
        if base_dir.exists() && base_dir.is_dir() {
            for entry in WalkDir::new(&base_dir).max_depth(3).into_iter().filter_map(|e| e.ok()) {
                let p = entry.path();
                if p.is_file() {
                    let file_name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
                    if java_binary_names().iter().any(|name| file_name.eq_ignore_ascii_case(name)) {
                        if let Some(bin_parent) = p.parent().and_then(|bin| bin.parent()) {
                            check_and_add(bin_parent, &mut results, &mut visited_paths);
                        }
                    }
                }
            }
        }
    }

    // Deliberately returns an empty list when nothing is installed: reporting a
    // fake Java 21 here would defeat the version check done before launching.
    results
}

fn check_and_add(
    dir: &Path,
    results: &mut Vec<JavaInstallation>,
    visited: &mut std::collections::HashSet<String>,
) {
    let bin_dir = dir.join("bin");
    let Some(exe_path) = java_binary_names().iter().map(|name| bin_dir.join(name)).find(|p| p.exists()) else {
        return;
    };

    let path_str = exe_path.to_string_lossy().to_string();
    if visited.contains(&path_str) {
        return;
    }
    visited.insert(path_str.clone());

    let folder_name = dir.file_name().and_then(|n| n.to_str()).unwrap_or("");
    let (major, version_str, is_64_bit) = detect_version_from_executable(&exe_path, folder_name);

    results.push(JavaInstallation {
        path: path_str,
        major_version: major,
        version_string: version_str,
        is_64_bit,
    });
}

/// Runs `java -version` to get the actual version string and parse the major version.
/// Falls back to directory name heuristics if the command fails.
fn detect_version_from_executable(java_exe: &Path, folder_hint: &str) -> (u32, String, bool) {
    // Try running java -version (output goes to stderr)
    if java_exe.exists() {
        if let Ok(output) = hidden_command(java_exe)
            .arg("-version")
            .output()
        {
            let version_output = String::from_utf8_lossy(&output.stderr).to_string();
            if let Some(major) = parse_major_from_version_output(&version_output) {
                // Extract the first line for display
                let display = version_output
                    .lines()
                    .next()
                    .unwrap_or("Java")
                    .trim()
                    .trim_matches('"')
                    .to_string();
                // The JVM prints "64-Bit Server VM" on 64-bit builds and omits it on 32-bit ones
                let is_64_bit = version_output.to_ascii_lowercase().contains("64-bit");
                return (major, format!("Java {} ({})", major, display), is_64_bit);
            }
        }
    }

    // Fallback: guess from folder name, assuming 64-bit since it cannot be measured here
    let (major, version_str) = parse_version_from_folder_name(folder_hint);
    (major, version_str, true)
}

/// Parses the major version number from `java -version` stderr output.
/// Handles both old-style "1.8.0_xxx" and new-style "17.0.x", "21.0.x".
fn parse_major_from_version_output(output: &str) -> Option<u32> {
    // Look for patterns like: "21.0.2" or "1.8.0_392" or "17.0.10"
    for line in output.lines() {
        let line = line.trim().trim_matches('"');
        // Find version-like patterns
        for word in line.split_whitespace() {
            let clean = word.trim_matches('"').trim_matches('\'');
            if clean.contains('.') && clean.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false) {
                let parts: Vec<&str> = clean.split('.').collect();
                if let Ok(first) = parts[0].parse::<u32>() {
                    if first == 1 && parts.len() >= 2 {
                        // Old-style: 1.8.0 → major = 8
                        if let Ok(second) = parts[1].parse::<u32>() {
                            return Some(second);
                        }
                    } else if first >= 9 {
                        // New-style: 17.0.10 → major = 17
                        return Some(first);
                    }
                }
            }
        }
    }
    None
}

/// Fallback heuristic: guess Java version from directory/folder name.
fn parse_version_from_folder_name(folder: &str) -> (u32, String) {
    let lower = folder.to_lowercase();
    // Check specific versions in descending order to avoid false positives
    // e.g. "jdk-21" should match 21, not be caught by "1" check
    if lower.contains("25") {
        return (25, format!("Java 25 LTS ({})", folder));
    }
    if lower.contains("24") {
        return (24, format!("Java 24 ({})", folder));
    }
    if lower.contains("23") {
        return (23, format!("Java 23 ({})", folder));
    }
    if lower.contains("22") {
        return (22, format!("Java 22 ({})", folder));
    }
    if lower.contains("21") {
        return (21, format!("Java 21 LTS ({})", folder));
    }
    if lower.contains("17") {
        return (17, format!("Java 17 LTS ({})", folder));
    }
    if lower.contains("16") {
        return (16, format!("Java 16 ({})", folder));
    }
    if lower.contains("11") {
        return (11, format!("Java 11 LTS ({})", folder));
    }
    if lower.contains("1.8") || lower.contains("jdk8") || lower.contains("jre8") {
        return (8, format!("Java 8 ({})", folder));
    }

    (21, format!("Java ({})", folder))
}

#[cfg(test)]
mod folder_name_heuristic_tests {
    use super::parse_version_from_folder_name;

    #[test]
    fn recognises_every_major_version_this_launcher_cares_about() {
        assert_eq!(parse_version_from_folder_name("jdk-25").0, 25);
        assert_eq!(parse_version_from_folder_name("jdk-21.0.11").0, 21);
        assert_eq!(parse_version_from_folder_name("jdk-17").0, 17);
        assert_eq!(parse_version_from_folder_name("jre-1.8").0, 8);
        assert_eq!(parse_version_from_folder_name("jdk8u392").0, 8);
    }

    #[test]
    fn does_not_let_a_25_folder_collapse_into_21() {
        // The exact bug this guards: "25" contains no "21" substring, but before the
        // explicit checks below 21 were added, nothing matched it and it fell through to
        // the generic 21 default anyway.
        assert_ne!(parse_version_from_folder_name("jdk-25.0.1").0, 21);
    }
}

#[cfg(test)]
mod platform_binary_name_tests {
    use super::{java_binary_names, java_command_name};

    #[test]
    fn never_hands_a_windows_only_name_to_a_non_windows_process_spawn() {
        // The bug this guards: a Linux VPS running mcl-agent used to be handed "javaw.exe" as
        // its "nothing found" fallback and blindly tried to spawn it — which fails with a raw
        // "No such file or directory", since that filename doesn't exist, or make sense, off
        // Windows. Every name this module can ever hand to `Command::new` must fit the target
        // it's compiled for.
        if cfg!(windows) {
            assert!(java_command_name().ends_with(".exe"));
            assert!(java_binary_names().iter().all(|n| n.ends_with(".exe")));
        } else {
            assert_eq!(java_command_name(), "java");
            assert_eq!(java_binary_names(), &["java"]);
        }
    }

    #[test]
    fn the_hosting_fallback_is_console_attached_not_the_windowless_client_variant() {
        // A hosted server's stdout/stdin has to be piped and read line by line; `javaw.exe` is
        // the windowless variant the client launch path prefers instead, for no console flash.
        assert_ne!(java_command_name(), "javaw.exe");
    }
}

#[cfg(test)]
mod required_java_tests {
    use super::{installed_java_fits, required_java_major};

    #[test]
    fn java_8_games_only_accept_java_8() {
        assert!(installed_java_fits(8, 8));
        assert!(!installed_java_fits(17, 8), "old Forge breaks on 17, so Java 8 is downloaded instead");
        assert!(!installed_java_fits(21, 8));
        assert!(!installed_java_fits(0, 8), "nothing found");
    }

    #[test]
    fn newer_games_accept_a_java_within_the_known_safe_range() {
        assert!(installed_java_fits(21, 21));
        assert!(installed_java_fits(21, 17));
        assert!(!installed_java_fits(17, 21), "too old");
        assert!(!installed_java_fits(0, 25), "nothing found");
    }

    #[test]
    fn a_java_well_past_the_known_safe_ceiling_is_not_trusted() {
        // The real bug this guards: Java 25 running Forge for MC 1.20.1 (needs Java 17)
        // crashed with "Unsupported class file major version 69" — ModLauncher's bundled ASM
        // cannot parse bytecode from a JDK released years after that Forge build. "newer" is
        // not automatically "fine"; MCL should download the exact required version instead.
        assert!(!installed_java_fits(25, 17), "Java 25 is well past Forge/NeoForge's tested range for MC 1.20.1");
        assert!(!installed_java_fits(25, 21));
    }

    #[test]
    fn old_scheme_thresholds() {
        assert_eq!(required_java_major("1.12.2"), 8);
        assert_eq!(required_java_major("1.16.5"), 8);
        assert_eq!(required_java_major("1.17.1"), 17);
        assert_eq!(required_java_major("1.19.4"), 17);
        assert_eq!(required_java_major("1.20.4"), 17);
        assert_eq!(required_java_major("1.20.5"), 21);
        assert_eq!(required_java_major("1.21.1"), 21);
        assert_eq!(required_java_major("1.21.11"), 21);
    }

    #[test]
    fn new_year_based_scheme_needs_java_25() {
        // Verified against the real 26.1 and 26.2 releases, which bundle Java 25.
        assert_eq!(required_java_major("26.1"), 25);
        assert_eq!(required_java_major("26.2"), 25);
        // A hotfix patch version under the new scheme, e.g. "26.1.1"
        assert_eq!(required_java_major("26.1.1"), 25);
    }

    #[test]
    fn falls_back_to_the_newest_known_requirement_when_unparseable() {
        assert_eq!(required_java_major(""), 25);
        assert_eq!(required_java_major("not-a-version"), 25);
    }
}
