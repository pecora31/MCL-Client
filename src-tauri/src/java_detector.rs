use crate::models::JavaInstallation;
use std::path::{Path, PathBuf};
use std::process::Command;
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

/// Whether Automatic may run a game on the Java it found instead of downloading the exact one.
///
/// Games built for Java 8 insist on Java 8: the jump to 17 is where Forge and the mods of that
/// era break. From Java 17 on, a newer runtime generally runs the game fine, so an installed
/// newer Java is used rather than downloading another one.
pub fn installed_java_fits(found_major: u32, required: u32) -> bool {
    if required == 8 {
        found_major == 8
    } else {
        found_major >= required
    }
}

/// Finds the best matching Java executable from the detected list for a given Minecraft version.
/// Returns `(java_exe_path, major_version, reason_string)`.
pub fn find_best_java_for_version(game_version: &str) -> (String, u32, String) {
    let required = required_java_major(game_version);
    let javas = detect_installed_javas();

    if javas.is_empty() {
        return (
            "javaw.exe".to_string(),
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

    // 2nd priority: any version >= required (pick the lowest that satisfies)
    let mut compatible: Vec<&JavaInstallation> = javas
        .iter()
        .filter(|j| j.major_version >= required)
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

pub fn detect_installed_javas() -> Vec<JavaInstallation> {
    let mut results: Vec<JavaInstallation> = Vec::new();
    let mut visited_paths = std::collections::HashSet::new();

    // Check environment variables
    if let Ok(java_home) = std::env::var("JAVA_HOME") {
        check_and_add(&PathBuf::from(java_home), &mut results, &mut visited_paths);
    }

    // Common Windows search directories
    let program_files = std::env::var("ProgramFiles").unwrap_or_else(|_| "C:\\Program Files".to_string());
    let program_files_x86 = std::env::var("ProgramFiles(x86)").unwrap_or_else(|_| "C:\\Program Files (x86)".to_string());

    let candidates = vec![
        PathBuf::from(&program_files).join("Common Files").join("Oracle").join("Java").join("javapath"),
        PathBuf::from(&program_files).join("Java"),
        PathBuf::from(&program_files).join("Eclipse Adoptium"),
        PathBuf::from(&program_files).join("Microsoft"),
        PathBuf::from(&program_files).join("BellSoft"),
        PathBuf::from(&program_files).join("Zulu"),
        PathBuf::from(&program_files_x86).join("Java"),
        // Runtimes this launcher downloaded itself
        crate::java_runtime::runtime_root(),
    ];

    // Query where.exe javaw — but detect actual version
    if let Ok(output) = Command::new("where.exe").arg("javaw").output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                let trimmed = line.trim();
                if !trimmed.is_empty() && Path::new(trimmed).exists() {
                    let path_buf = PathBuf::from(trimmed);
                    let p_str = path_buf.to_string_lossy().to_string();
                    if !visited_paths.contains(&p_str) {
                        visited_paths.insert(p_str.clone());
                        // Try to detect actual version from the sibling java.exe
                        let java_exe = path_buf.with_file_name("java.exe");
                        let (major, ver_str, is_64_bit) =
                            detect_version_from_executable(&java_exe, "System PATH");
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
                    if file_name.eq_ignore_ascii_case("javaw.exe") || file_name.eq_ignore_ascii_case("java.exe") {
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
    let javaw_path = dir.join("bin").join("javaw.exe");
    let java_path = dir.join("bin").join("java.exe");

    let exe_path = if javaw_path.exists() {
        javaw_path
    } else if java_path.exists() {
        java_path
    } else {
        return;
    };

    let path_str = exe_path.to_string_lossy().to_string();
    if visited.contains(&path_str) {
        return;
    }
    visited.insert(path_str.clone());

    let folder_name = dir.file_name().and_then(|n| n.to_str()).unwrap_or("");
    let java_exe = dir.join("bin").join("java.exe");
    let (major, version_str, is_64_bit) = detect_version_from_executable(&java_exe, folder_name);

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
        if let Ok(output) = Command::new(java_exe)
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
    fn newer_games_accept_any_newer_java() {
        assert!(installed_java_fits(21, 21));
        assert!(installed_java_fits(25, 21));
        assert!(installed_java_fits(21, 17));
        assert!(!installed_java_fits(17, 21), "too old");
        assert!(!installed_java_fits(0, 25), "nothing found");
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
