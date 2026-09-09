export type ModLoader = 'vanilla' | 'fabric' | 'forge' | 'neoforge' | 'quilt';

export interface GameInstance {
  id: string;
  name: string;
  gameVersion: string;
  loader: ModLoader;
  loaderVersion?: string;
  javaPath?: string;
  minRam: number; // in MB
  maxRam: number; // in MB
  jvmArgs?: string;
  icon: string;
  serverIp?: string;
  serverPort?: number;
  customSkinPath?: string;
  windowWidth?: number;
  windowHeight?: number;
  fullscreen?: boolean;
  skinModel?: 'classic' | 'slim';
  enableSkinInGame: boolean;
  customDir?: string;
  lastPlayed?: string;
  totalPlayTime?: number; // in minutes
}

export interface WorldStats {
  worldName: string;
  playTimeMinutes: number;
  deaths: number;
  mobKills: number;
  blocksMined: number;
}

export interface InstanceStats {
  /** Wall-clock minutes the launcher measured itself, so multiplayer is included. */
  trackedPlayMinutes: number;
  /** Minutes Minecraft recorded, which only ever covers singleplayer worlds. */
  inGamePlayMinutes: number;
  deaths: number;
  mobKills: number;
  playerKills: number;
  blocksMined: number;
  itemsCrafted: number;
  distanceWalkedKm: number;
  jumps: number;
  worlds: WorldStats[];
}

export interface MrpackManifestSummary {
  name: string;
  summary: string;
  gameVersion: string;
  loader: string;
  loaderVersion?: string;
  totalFiles: number;
  totalSizeBytes: number;
  filePath: string;
}

export interface VersionItem {
  id: string;
  type: 'release' | 'snapshot' | 'old_beta' | 'old_alpha';
  url: string;
  time: string;
  releaseTime: string;
}

export interface LoaderVersionItem {
  version: string;
  stable: boolean;
}

export interface Account {
  id: string;
  username: string;
  type: 'offline' | 'microsoft';
  avatarIcon?: string;
  avatarCustom?: string;
  customBanner?: string;
  skinUrl?: string;
  skinModel: 'classic' | 'slim';
  uuid: string;
  active: boolean;
}

export interface ServerStatus {
  ip: string;
  port: number;
  online: boolean;
  version?: string;
  playersOnline?: number;
  playersMax?: number;
  motd?: string;
  pingMs?: number;
  favicon?: string;
}

export interface SavedServer {
  id: string;
  name: string;
  ip: string;
  port: number;
  motd?: string;
}

export interface ModrinthMod {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  icon_url?: string;
  downloads: number;
  follows: number;
  categories: string[];
  client_side: string;
  server_side: string;
  versions: string[];
  author: string;
  installed?: boolean;
  installedVersion?: string;
}

export type AddonContentType =
  | 'mods'
  | 'resourcepacks'
  | 'datapacks'
  | 'shaderpacks'
  | 'modpacks'
  | 'plugins'
  | 'servers';
export type AddonSource = 'modrinth' | 'curseforge';

export interface AddonItem {
  id: string;
  source: AddonSource;
  sources?: AddonSource[];
  slug?: string;
  name: string;
  summary: string;
  author: string;
  iconUrl?: string;
  bannerUrl?: string;
  environment?: 'client' | 'server' | 'both';
  color?: string;
  loaders?: string[];
  downloads: number;
  follows?: number;
  updatedAt?: string;
  categories: string[];
  contentType: AddonContentType;
  webUrl: string;
  isInstalled?: boolean;
  modrinthId?: string;
  curseforgeId?: string;
}

export interface LocalMod {
  fileName: string;
  name: string;
  version?: string;
  enabled: boolean;
  sizeBytes: number;
  addonType?: string;
}

// Machine tokens, not display text. Must match the stage values emitted by the
// Rust backend; render them through the i18n table if they ever need a label.
export type LaunchStage =
  | 'idle'
  | 'preparing'
  | 'downloading'
  | 'extracting'
  | 'verifying'
  | 'launching'
  | 'running'
  | 'done'
  | 'error';

export interface SystemInfo {
  totalRamMb: number;
  availableRamMb: number;
  cpuCount: number;
  recommendedMaxRamMb: number;
  recommendedRamMb: number;
}

export interface LaunchProgress {
  stage: LaunchStage;
  percentage: number;
  currentFile: string;
  downloadedBytes: number;
  totalBytes: number;
  speedBps: number;
}

export interface JavaInstallation {
  path: string;
  majorVersion: number;
  versionString: string;
  is64Bit: boolean;
}

export type Language = 'vi' | 'en' | 'zh' | 'ja' | 'ko' | 'de' | 'fr' | 'es';
export type UiStyle = 'riot' | 'minimal';
export type ColorPalette = 'indigo' | 'emerald' | 'amber' | 'rose' | 'cyan' | 'slate';
export type DarkDepth = 'obsidian' | 'pure_black';
export type WindowResolution = '1280x720' | '1440x900' | '1600x900' | '1920x1080';

export interface LauncherSettings {
  defaultJavaPath?: string;
  defaultMinRam: number;
  defaultMaxRam: number;
  defaultJvmArgs: string;
  uiStyle?: UiStyle;
  colorPalette: ColorPalette;
  windowResolution?: WindowResolution;
  darkDepth?: DarkDepth;
  reduceMotion?: boolean;
  bgType?: 'video' | 'image' | 'solid';
  customBgImage?: string;
  customVideoUrl?: string;
  bgOpacity: number;
  bgBlur?: number;
  closeOnLaunch: boolean;
  enableDiscordRpc: boolean;
  serverHost: string;
  serverPort: number;
  serverName: string;
  gameDataDir?: string;
  hasCompletedOnboarding?: boolean;
  curseForgeApiKey?: string;
}

export interface VersionCleanupInfo {
  version: string;
  sizeBytes: number;
}

export interface StorageCleanupScanResult {
  unusedVersions: VersionCleanupInfo[];
  orphanedInstances: string[];
  orphanedInstancesBytes: number;
  tempCacheBytes: number;
  totalReclaimableBytes: number;
  storageRoot: string;
}

export interface StorageCleanupReport {
  bytesFreed: number;
  versionsDeleted: number;
  cacheCleaned: boolean;
  orphanedInstancesDeleted: number;
  message: string;
}

