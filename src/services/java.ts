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
 * Options for a profile's Java picker, ranked by how well each fits this Minecraft version:
 * - Recommended: the exact version the game is built for — the safest choice.
 * - May work: newer versions; the game usually runs on them, but older mod loaders can break
 *   (Forge for 1.16, for one, needs Java 8 specifically).
 * - Too old: shown but disabled, since the launcher refuses to start the game on them anyway.
 * Automatic comes first and names the version it would pick right now.
 */
export function buildJavaOptions(
  javaList: JavaInstallation[],
  gameVersion: string
): SelectOption<string>[] {
  const required = requiredJavaMajor(gameVersion);
  const tooOld = `Too old for Minecraft ${gameVersion}, which needs Java ${required}`;
  const installed = (major: number) => javaList.some((java) => java.majorVersion === major);
  const availability = (major: number) =>
    installed(major) ? 'Installed.' : 'Not installed — downloaded when you play (about 40–55 MB).';

  // Mirrors find_best_java_for_version: the exact version if installed, otherwise the oldest
  // installed one that is new enough, otherwise the exact version gets downloaded.
  const newerInstalled = javaList
    .map((java) => java.majorVersion)
    .filter((major) => major > required)
    .sort((a, b) => a - b);
  const automatic = installed(required) ? required : newerInstalled[0] ?? required;

  const options: SelectOption<string>[] = [
    {
      value: '',
      label: `Automatic (Java ${automatic})`,
      badge: 'Default',
      description: installed(automatic)
        ? `Uses the installed Java ${automatic}, and keeps up if Minecraft's requirement changes`
        : `Downloads Java ${automatic} when you play, and keeps up if Minecraft's requirement changes`,
    },
  ];

  const newer = MINECRAFT_JAVA_VERSIONS.filter((major) => major > required).sort((a, b) => a - b);
  const older = MINECRAFT_JAVA_VERSIONS.filter((major) => major < required);
  for (const major of [required, ...newer, ...older]) {
    const isTooOld = major < required;
    options.push({
      value: VERSION_PREFIX + major,
      label: `Java ${major}`,
      badge: major === required ? 'Recommended' : isTooOld ? undefined : 'May work',
      description: isTooOld
        ? tooOld
        : major === required
        ? `The version Minecraft ${gameVersion} is built for. ${availability(major)}`
        : `Newer than Minecraft ${gameVersion} needs: usually runs, but older mods can break. ${availability(major)}`,
      disabled: isTooOld,
    });
  }

  // Installs outside the versions above (say Java 11 or 23) can still be picked by path
  for (const java of javaList) {
    if (MINECRAFT_JAVA_VERSIONS.includes(java.majorVersion)) continue;
    const isTooOld = java.majorVersion < required;
    options.push({
      value: java.path,
      label: `Java ${java.majorVersion} (${java.versionString})`,
      badge: isTooOld ? undefined : 'May work',
      description: isTooOld ? tooOld : java.path,
      disabled: isTooOld,
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
