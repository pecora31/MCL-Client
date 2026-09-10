import type { JavaInstallation } from '../types';
import type { SelectOption } from '../components/common/CustomSelect';

/** Every Java version Minecraft has needed, newest first. */
const MINECRAFT_JAVA_VERSIONS = [25, 21, 17, 8];

// Select value for "this Java version, downloaded if missing", as opposed to one install's path
const VERSION_PREFIX = 'version:';

/** Mirrors required_java_major in java_detector.rs — keep the two in step. */
export function requiredJavaMajor(gameVersion: string): number {
  const [major = 0, minor = 0, patch = 0] = gameVersion.split('.').map(Number);
  if (major === 1) {
    if (minor < 17) return 8;
    if (minor < 20 || (minor === 20 && patch <= 4)) return 17;
    return 21; // 1.20.5-1.21.11, the last releases under the old scheme
  }
  return 25; // 26.1+, the year-based scheme
}

/**
 * Options for a profile's Java picker: Automatic, then every version Minecraft uses (installed
 * or downloadable), then any other install by path. Versions too old for this Minecraft are
 * shown but cannot be picked — the launcher would refuse to start the game on them anyway.
 */
export function buildJavaOptions(
  javaList: JavaInstallation[],
  gameVersion: string
): SelectOption<string>[] {
  const required = requiredJavaMajor(gameVersion);
  const tooOld = `Too old for Minecraft ${gameVersion}, which needs Java ${required}`;

  const options: SelectOption<string>[] = [
    {
      value: '',
      label: 'Automatic',
      badge: 'Recommended',
      description: `Uses Java ${required} for Minecraft ${gameVersion}`,
    },
  ];

  for (const major of MINECRAFT_JAVA_VERSIONS) {
    const installed = javaList.find((java) => java.majorVersion === major);
    options.push({
      value: VERSION_PREFIX + major,
      label: `Java ${major}`,
      badge: installed ? 'Installed' : 'Download',
      description:
        major < required
          ? tooOld
          : installed
          ? installed.path
          : 'Not installed — downloaded when you play (about 40–55 MB)',
      disabled: major < required,
    });
  }

  // Installs outside the versions above (say Java 11 or 23) can still be picked by path
  for (const java of javaList) {
    if (MINECRAFT_JAVA_VERSIONS.includes(java.majorVersion)) continue;
    options.push({
      value: java.path,
      label: `Java ${java.majorVersion} (${java.versionString})`,
      badge: java.is64Bit ? '64-bit' : '32-bit',
      description: java.majorVersion < required ? tooOld : java.path,
      disabled: java.majorVersion < required,
    });
  }

  return options;
}

/** Splits a Java picker value into the two profile fields it stands for. */
export function javaChoiceToProfile(choice: string): { javaPath?: string; javaVersion?: number } {
  if (choice.startsWith(VERSION_PREFIX)) {
    return { javaPath: undefined, javaVersion: Number(choice.slice(VERSION_PREFIX.length)) };
  }
  return { javaPath: choice || undefined, javaVersion: undefined };
}

/** The picker value for a profile's saved Java; a path to one of the listed versions shows as that version. */
export function profileToJavaChoice(
  profile: { javaPath?: string; javaVersion?: number },
  javaList: JavaInstallation[]
): string {
  if (profile.javaPath) {
    const installed = javaList.find((java) => java.path === profile.javaPath);
    if (installed && MINECRAFT_JAVA_VERSIONS.includes(installed.majorVersion)) {
      return VERSION_PREFIX + installed.majorVersion;
    }
    return profile.javaPath;
  }
  return profile.javaVersion ? VERSION_PREFIX + profile.javaVersion : '';
}
