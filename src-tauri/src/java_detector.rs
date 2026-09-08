use crate::models::JavaInstallation;
use std::path::{Path, PathBuf};
use std::process::Command;
use walkdir::WalkDir;

/// Determines the minimum required Java major version for a given Minecraft version.
/// - MC < 1.17   → Java 8
/// - MC 1.17–1.20.4 → Java 17
/// - MC >= 1.20.5 → Java 21
fn required_java_major(game_version: &str) -> u32 {
    // Parse the numeric components: "1.20.4" → [1, 20, 4]
    let parts: Vec<u32> = game_version
        .split('.')
        .filter_map(|s| s.parse::<u32>().ok())
        .collect();

    let (major, minor, patch) = match parts.len() {
        0 => return 21, // unknown → assume latest
        1 => (parts[0], 0u32, 0u32),
        2 => (parts[0], parts[1], 0u32),
        _ => (parts[0], parts[1], parts[2]),
    };

    // Minecraft versions use 1.X.Y scheme
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
        return 21; // 1.20.5+, 1.21+, etc.
    }

    21 // Future major versions
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
                        let (major, ver_str) = detect_version_from_executable(&java_exe, "System PATH");
                        results.push(JavaInstallation {
                            path: p_str,
                            major_version: major,
                            version_string: ver_str,
                            is_64_bit: true,
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

    // If nothing found, provide a graceful default
    if results.is_empty() {
        results.push(JavaInstallation {
            path: "javaw.exe".to_string(),
            major_version: 21,
            version_string: "Default System Java".to_string(),
            is_64_bit: true,
        });
    }

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
    let (major, version_str) = detect_version_from_executable(&java_exe, folder_name);

    results.push(JavaInstallation {
        path: path_str,
        major_version: major,
        version_string: version_str,
        is_64_bit: true,
    });
}

/// Runs `java -version` to get the actual version string and parse the major version.
/// Falls back to directory name heuristics if the command fails.
fn detect_version_from_executable(java_exe: &Path, folder_hint: &str) -> (u32, String) {
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
                return (major, format!("Java {} ({})", major, display));
            }
        }
    }

    // Fallback: guess from folder name
    parse_version_from_folder_name(folder_hint)
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

pub fn find_system_javaw() -> String {
    let program_files = std::env::var("ProgramFiles").unwrap_or_else(|_| "C:\\Program Files".to_string());
    let oracle_javapath = PathBuf::from(&program_files)
        .join("Common Files")
        .join("Oracle")
        .join("Java")
        .join("javapath")
        .join("javaw.exe");

    if oracle_javapath.exists() {
        return oracle_javapath.to_string_lossy().to_string();
    }

    if let Ok(output) = Command::new("where.exe").arg("javaw").output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if let Some(first_line) = stdout.lines().next() {
                let p = first_line.trim();
                if !p.is_empty() && Path::new(p).exists() {
                    return p.to_string();
                }
            }
        }
    }

    "javaw.exe".to_string()
}
