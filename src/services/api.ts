import type {
  VersionItem,
  ModrinthMod,
  ServerStatus,
  InstanceStats,
  ModConflict,
  AddonContentType,
  AddonSource,
  AddonItem,
  LocalMod,
  MrpackManifestSummary,
  GameInstance,
} from '../types';
import { invoke } from '@tauri-apps/api/core';

// Check if running inside Tauri environment
export const isTauri = () => {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
};

// Must mirror tauri::generate_handler! in src-tauri/src/lib.rs. Typing the command
// names here turns a call to a command the backend does not expose into a build error.
export const TAURI_COMMANDS = [
  'get_instances',
  'save_instances',
  'delete_instance',
  'open_instance_dir',
  'open_external_url',
  'get_game_data_dir',
  'set_game_data_dir',
  'select_folder',
  'select_file',
  'scan_storage_cleanup',
  'execute_storage_cleanup',
  'detect_java',
  'find_best_java',
  'get_system_info',
  'install_local_skin',
  'delete_published_skin',
  'check_username_claim',
  'backup_worlds',
  'export_log',
  'ping_minecraft_server',
  'get_instance_stats',
  'set_discord_rpc_enabled',
  'check_mod_conflicts',
  'build_share_manifest',
  'get_local_mods',
  'get_installed_addons',
  'toggle_addon',
  'delete_addon',
  'download_and_install_addon',
  'launch_instance',
  'cancel_download',
  'kill_game',
  'select_mrpack_file',
  'inspect_mrpack',
  'install_mrpack',
  'app_minimize',
  'app_hide',
  'app_close',
  'set_window_size',
] as const;

export type TauriCommand = (typeof TAURI_COMMANDS)[number];

// Safe invoke wrapper for Tauri commands
export async function invokeCommand<T>(cmd: TauriCommand, args: Record<string, unknown> = {}): Promise<T> {
  if (isTauri()) {
    try {
      return await invoke<T>(cmd, args);
    } catch (err) {
      console.warn(`[Tauri Invoke Error] ${cmd}:`, err);
      throw err;
    }
  }
  // Fallback handler for browser preview mode
  return mockCommand<T>(cmd, args);
}

// Modpack Management (Modrinth .mrpack)
export async function selectMrpackFile(): Promise<string | null> {
  return await invokeCommand<string | null>('select_mrpack_file');
}

export async function inspectMrpack(mrpackPath: string): Promise<MrpackManifestSummary> {
  return await invokeCommand<MrpackManifestSummary>('inspect_mrpack', { mrpackPath });
}

export async function installMrpack(mrpackPath: string, customName?: string): Promise<GameInstance> {
  return await invokeCommand<GameInstance>('install_mrpack', { mrpackPath, customName });
}

// Fetch Minecraft Versions directly from Mojang API
export async function fetchMojangVersions(): Promise<{ latest: { release: string; snapshot: string }; versions: VersionItem[] }> {
  try {
    const res = await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
    if (!res.ok) throw new Error('Failed to fetch Mojang version manifest');
    return await res.json();
  } catch (err) {
    console.error('Mojang API error:', err);
    // Fallback list of popular versions
    return {
      latest: { release: '1.21.4', snapshot: '25w09a' },
      versions: [
        { id: '1.21.4', type: 'release', url: '', time: '', releaseTime: '2024-12-03' },
        { id: '1.21.1', type: 'release', url: '', time: '', releaseTime: '2024-08-08' },
        { id: '1.20.1', type: 'release', url: '', time: '', releaseTime: '2023-06-12' },
        { id: '1.19.4', type: 'release', url: '', time: '', releaseTime: '2023-03-14' },
        { id: '1.18.2', type: 'release', url: '', time: '', releaseTime: '2022-02-28' },
        { id: '1.16.5', type: 'release', url: '', time: '', releaseTime: '2021-01-15' },
        { id: '1.12.2', type: 'release', url: '', time: '', releaseTime: '2017-09-18' },
        { id: '1.7.10', type: 'release', url: '', time: '', releaseTime: '2014-06-26' },
      ],
    };
  }
}

// Fetch Fabric Loader Versions for a specific game version
export async function fetchFabricVersions(gameVersion: string): Promise<string[]> {
  try {
    const res = await fetch(`https://meta.fabricmc.net/v2/versions/loader/${gameVersion}`);
    if (!res.ok) return ['0.16.10', '0.16.9', '0.15.11'];
    const data = await res.json();
    return data.map((item: { loader: { version: string } }) => item.loader.version);
  } catch {
    return ['0.16.10', '0.16.9', '0.15.11'];
  }
}

// Fetch Quilt Loader Versions
export async function fetchQuiltVersions(gameVersion: string): Promise<string[]> {
  try {
    const res = await fetch(`https://meta.quiltmc.org/v3/versions/loader/${gameVersion}`);
    if (!res.ok) return ['0.27.1-beta.1'];
    const data = await res.json();
    return data.map((item: { loader: { version: string } }) => item.loader.version);
  } catch {
    return ['0.27.1'];
  }
}

function readMavenVersions(xml: string): string[] {
  return [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((match) => match[1]);
}

// Forge publishes one artifact per Minecraft version, named "<mc>-<forge>"
export async function fetchForgeVersions(gameVersion: string): Promise<string[]> {
  try {
    const res = await fetch(
      'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml'
    );
    if (!res.ok) return [];
    const prefix = `${gameVersion}-`;
    return readMavenVersions(await res.text())
      .filter((version) => version.startsWith(prefix))
      .map((version) => version.slice(prefix.length))
      .reverse();
  } catch {
    return [];
  }
}

// NeoForge drops the leading "1." and tracks the Minecraft version in its own first two
// components, so 1.21.1 maps to 21.1.x
function neoForgePrefix(gameVersion: string): string {
  const parts = gameVersion.split('.');
  if (parts[0] === '1') {
    return `${parts[1] ?? '0'}.${parts[2] ?? '0'}.`;
  }
  return `${gameVersion}.`;
}

export async function fetchNeoForgeVersions(gameVersion: string): Promise<string[]> {
  try {
    // 1.20.1 is the one Minecraft version NeoForge shipped before switching to its own
    // "neoforge" artifact and versioning: it started as a fork of Forge 47.x, published
    // under Forge's own coordinate and naming, and never moved once the split settled.
    if (gameVersion === '1.20.1') {
      const res = await fetch('https://maven.neoforged.net/releases/net/neoforged/forge/maven-metadata.xml');
      if (!res.ok) return [];
      const prefix = `${gameVersion}-`;
      return readMavenVersions(await res.text())
        .filter((version) => version.startsWith(prefix))
        .map((version) => version.slice(prefix.length))
        .reverse();
    }

    const res = await fetch(
      'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml'
    );
    if (!res.ok) return [];
    const prefix = neoForgePrefix(gameVersion);
    return readMavenVersions(await res.text())
      .filter((version) => version.startsWith(prefix))
      .reverse();
  } catch {
    return [];
  }
}

// CurseForge's terms forbid disclosing an API key to third parties, and a key shipped inside
// an open-source launcher is disclosed to everyone who reads the repository. So this build
// carries no key: requests go to MCL's own service, which holds the key server-side.
//
// A player who enters their own key in Settings bypasses the proxy entirely and talks to
// CurseForge directly, spending their own quota instead of the shared one.
const CURSEFORGE_DIRECT_ROOT = 'https://api.curseforge.com';
// Same Worker the skin service runs on; kept in step with SKIN_SERVICE_ROOT in
// src-tauri/src/instance_manager.rs.
export const MCL_SERVICE_ROOT = 'https://mcl-skin-service.nazarick112.workers.dev';
const CURSEFORGE_PROXY_ROOT = `${MCL_SERVICE_ROOT}/v1/curseforge`;

function curseForgeRequest(
  path: string,
  query: string,
  personalApiKey?: string
): { url: string; headers: Record<string, string> } {
  const key = personalApiKey?.trim();
  if (key) {
    return {
      url: `${CURSEFORGE_DIRECT_ROOT}${path}?${query}`,
      headers: { Accept: 'application/json', 'x-api-key': key },
    };
  }
  return {
    url: `${CURSEFORGE_PROXY_ROOT}${path}?${query}`,
    headers: { Accept: 'application/json' },
  };
}

// Map loader string to CurseForge modLoaderType
// 0 = Any, 1 = Forge, 2 = Cauldron, 3 = LiteLoader, 4 = Fabric, 5 = Quilt, 6 = NeoForge
export function getCurseForgeLoaderType(loader?: string): number {
  if (!loader) return 0;
  const l = loader.toLowerCase();
  if (l.includes('neo')) return 6;
  if (l.includes('forge')) return 1;
  if (l.includes('fabric')) return 4;
  if (l.includes('quilt')) return 5;
  return 0;
}

// Map content type to CurseForge Class ID
// 6 = Mods, 6552 = Shaders, 12 = Resource Packs
export function getCurseForgeClassId(contentType: AddonContentType): number {
  switch (contentType) {
    case 'shaderpacks':
      return 6552;
    case 'resourcepacks':
      return 12;
    case 'datapacks':
      return 4547;
    case 'modpacks':
      return 4471;
    case 'mods':
    default:
      return 6;
  }
}

// Search Modrinth (Mods, Shaders, Resource Packs, Data Packs, Modpacks, Plugins)
export async function searchModrinth(
  query: string,
  contentType: AddonContentType = 'mods',
  gameVersion?: string,
  loader?: string,
  categoryFilter?: string,
  sortBy: 'relevance' | 'downloads' | 'newest' | 'published' = 'relevance',
  environment: 'all' | 'client' | 'server' = 'all',
  limit = 20,
  offset = 0
): Promise<{ items: AddonItem[]; total: number }> {
  try {
    const projectType =
      contentType === 'shaderpacks'
        ? 'shader'
        : contentType === 'resourcepacks'
        ? 'resourcepack'
        : contentType === 'datapacks'
        ? 'datapack'
        : contentType === 'modpacks'
        ? 'modpack'
        : contentType === 'plugins'
        ? 'plugin'
        : 'mod';

    const facets: string[][] = [[`project_type:${projectType}`]];
    if (gameVersion) facets.push([`versions:${gameVersion}`]);
    if (loader && loader !== 'vanilla' && contentType === 'mods') {
      facets.push([`categories:${loader}`]);
    }
    if (categoryFilter && categoryFilter !== 'all') {
      facets.push([`categories:${categoryFilter}`]);
    }
    if (environment === 'client') {
      facets.push(['client_side:required', 'client_side:optional']);
    } else if (environment === 'server') {
      facets.push(['server_side:required', 'server_side:optional']);
    }

    const indexSort =
      sortBy === 'downloads'
        ? 'downloads'
        : sortBy === 'published'
        ? 'newest'
        : sortBy === 'newest'
        ? 'updated'
        : 'relevance';

    const params = new URLSearchParams({
      query: query || '',
      limit: limit.toString(),
      offset: offset.toString(),
      index: indexSort,
      facets: JSON.stringify(facets),
    });

    const res = await fetch(`https://api.modrinth.com/v2/search?${params.toString()}`, {
      headers: {
        'User-Agent': 'MCLClient-Launcher/1.0.0 (https://github.com/pecora31/MCL-Client)',
      },
    });
    if (!res.ok) throw new Error('Modrinth API failed');
    const data = await res.json();

    const items: AddonItem[] = (data.hits || []).map((hit: any) => ({
      id: hit.project_id,
      modrinthId: hit.project_id,
      source: 'modrinth' as AddonSource,
      sources: ['modrinth' as AddonSource],
      slug: hit.slug,
      name: hit.title,
      summary: hit.description,
      author: hit.author,
      iconUrl: hit.icon_url,
      bannerUrl: hit.featured_gallery || (hit.gallery && hit.gallery[0]) || undefined,
      color: hit.color ? `#${hit.color.toString(16).padStart(6, '0')}` : undefined,
      environment:
        hit.client_side === 'required' && hit.server_side === 'required'
          ? 'both'
          : hit.client_side === 'required'
          ? 'client'
          : hit.server_side === 'required'
          ? 'server'
          : hit.client_side === 'optional' || hit.server_side === 'optional'
          ? 'both'
          : undefined,
      loaders: hit.loaders || [],
      downloads: hit.downloads,
      follows: hit.follows || 0,
      updatedAt: hit.date_modified || hit.date_created,
      categories: hit.categories || [],
      contentType,
      webUrl: `https://modrinth.com/${projectType}/${hit.slug || hit.project_id}`,
    }));

    return { items, total: data.total_hits || items.length };
  } catch (err) {
    console.error('Modrinth search error:', err);
    return { items: [], total: 0 };
  }
}

// Backwards-compatible alias for existing callers
export async function searchModrinthMods(
  query: string,
  gameVersion?: string,
  loader?: string,
  limit = 20,
  offset = 0
): Promise<{ hits: ModrinthMod[]; total_hits: number }> {
  const res = await searchModrinth(query, 'mods', gameVersion, loader, undefined, 'relevance', 'all', limit, offset);
  const hits: ModrinthMod[] = res.items.map((i) => ({
    project_id: i.id,
    slug: i.slug || i.id,
    title: i.name,
    description: i.summary,
    icon_url: i.iconUrl,
    downloads: i.downloads,
    follows: i.follows || 0,
    categories: i.categories,
    client_side: 'optional',
    server_side: 'optional',
    versions: [],
    author: i.author,
  }));
  return { hits, total_hits: res.total };
}

// Get direct download info from Modrinth
export async function getModrinthDownloadInfo(
  projectId: string,
  gameVersion?: string,
  loader?: string
): Promise<{
  url: string;
  fileName: string;
  sha1?: string;
  /** The exact version chosen, so a shared profile can ask for this one again. */
  versionId?: string;
  requiredDependencies?: string[];
} | null> {
  try {
    const res = await fetch(`https://api.modrinth.com/v2/project/${projectId}/version`, {
      headers: {
        'User-Agent': 'MCLClient-Launcher/1.0.0 (https://github.com/pecora31/MCL-Client)',
      },
    });
    if (!res.ok) return null;
    const versions: any[] = await res.json();
    if (!Array.isArray(versions) || versions.length === 0) return null;

    // Both the game version and the loader must match. Falling back to any other build
    // installs a jar that cannot load and crashes the game with an unrelated error.
    const target = versions.find((v) => {
      const matchVer = !gameVersion || (v.game_versions && v.game_versions.includes(gameVersion));
      const matchLoader = !loader || loader === 'vanilla' || (v.loaders && v.loaders.includes(loader));
      return matchVer && matchLoader;
    });

    if (!target) return null;

    const primaryFile = (target.files || []).find((f: any) => f.primary) || target.files?.[0];
    if (primaryFile && primaryFile.url) {
      return {
        url: primaryFile.url,
        fileName: primaryFile.filename,
        sha1: primaryFile.hashes?.sha1,
        versionId: target.id,
        requiredDependencies: (target.dependencies || [])
          .filter((d: any) => d.dependency_type === 'required' && d.project_id)
          .map((d: any) => d.project_id as string),
      };
    }
    return null;
  } catch (err) {
    console.error('Failed to get Modrinth download info:', err);
    return null;
  }
}

// Search CurseForge (Mods, Shaders, Resource Packs)
export async function searchCurseForge(
  query: string,
  contentType: AddonContentType = 'mods',
  gameVersion?: string,
  loader?: string,
  categoryFilter?: string,
  sortBy: 'relevance' | 'downloads' | 'newest' | 'published' = 'relevance',
  customApiKey?: string,
  limit = 20,
  offset = 0
): Promise<{ items: AddonItem[]; total: number }> {
  const classId = getCurseForgeClassId(contentType);
  const modLoaderType = contentType === 'mods' ? getCurseForgeLoaderType(loader) : 0;

  try {
    // 2 = Popularity, 6 = TotalDownloads, 3 = LastUpdated, 11 = ReleaseDate (Published)
    const cfSortField =
      sortBy === 'downloads'
        ? '6'
        : sortBy === 'published'
        ? '11'
        : sortBy === 'newest'
        ? '3'
        : '2';

    const params = new URLSearchParams({
      gameId: '432',
      classId: classId.toString(),
      pageSize: limit.toString(),
      index: offset.toString(),
      sortField: cfSortField,
      sortOrder: 'desc',
    });

    if (query && query.trim()) {
      params.append('searchFilter', query.trim());
    }

    if (gameVersion) params.append('gameVersion', gameVersion);
    if (modLoaderType > 0) params.append('modLoaderType', modLoaderType.toString());

    // CurseForge category mapping
    const cfCategoryMap: Record<string, number> = {
      technology: 421,
      magic: 420,
      storage: 419,
      utility: 418,
      optimization: 417,
      adventure: 416,
      worldgen: 414,
      decoration: 424,
      library: 412,
    };
    if (categoryFilter && categoryFilter !== 'all' && cfCategoryMap[categoryFilter]) {
      params.append('categoryId', cfCategoryMap[categoryFilter].toString());
    }

    const request = curseForgeRequest('/v1/mods/search', params.toString(), customApiKey);
    const res = await fetch(request.url, { headers: request.headers });

    if (!res.ok) {
      console.warn(`CurseForge API returned HTTP ${res.status}`);
      return { items: [], total: 0 };
    }

    const data = await res.json();
    const items: AddonItem[] = (data.data || []).map((hit: any) => {
      const webUrl =
        contentType === 'shaderpacks'
          ? `https://www.curseforge.com/minecraft/shaders/${hit.slug || hit.id}`
          : contentType === 'resourcepacks'
          ? `https://www.curseforge.com/minecraft/texture-packs/${hit.slug || hit.id}`
          : contentType === 'datapacks'
          ? `https://www.curseforge.com/minecraft/data-packs/${hit.slug || hit.id}`
          : contentType === 'modpacks'
          ? `https://www.curseforge.com/minecraft/modpacks/${hit.slug || hit.id}`
          : `https://www.curseforge.com/minecraft/mc-mods/${hit.slug || hit.id}`;

      const bannerUrl = hit.screenshots?.[0]?.url || hit.screenshots?.[0]?.thumbnailUrl || undefined;
      const loaders = (hit.latestFilesIndexes || [])
        .map((idx: any) => {
          if (idx.modLoader === 1) return 'forge';
          if (idx.modLoader === 4) return 'fabric';
          if (idx.modLoader === 5) return 'quilt';
          if (idx.modLoader === 6) return 'neoforge';
          return null;
        })
        .filter(Boolean);

      return {
        id: hit.id.toString(),
        curseforgeId: hit.id.toString(),
        source: 'curseforge' as AddonSource,
        sources: ['curseforge' as AddonSource],
        slug: hit.slug || hit.name?.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        name: hit.name,
        summary: hit.summary,
        author: hit.authors?.[0]?.name || 'Unknown',
        iconUrl: hit.logo?.thumbnailUrl || hit.logo?.url,
        bannerUrl,
        loaders,
        downloads: hit.downloadCount || 0,
        follows: hit.thumbsUpCount || 0,
        updatedAt: hit.dateModified,
        categories: (hit.categories || []).map((c: any) => c.name),
        contentType,
        webUrl,
      };
    });

    return { items, total: data.pagination?.totalCount || items.length };
  } catch (err) {
    console.error('CurseForge search error:', err);
    return { items: [], total: 0 };
  }
}

// Helper: Normalize name/slug to identify duplicate mods across platforms
export function normalizeAddonKey(str: string): string {
  return str
    .toLowerCase()
    .replace(/\[.*?\]|\(.*?\)/g, '')
    .replace(/[^a-z0-9]/g, '')
    .replace(/(fabric|forge|neoforge|quilt|mods?|shaders?|texturepacks?|resourcepacks?|pack|mc|minecraft)/g, '')
    .trim();
}

export function areAddonsIdentical(a: AddonItem, b: AddonItem): boolean {
  if (a.contentType !== b.contentType) return false;

  // 1. Direct Slug matching (without loader or edition suffixes)
  if (a.slug && b.slug) {
    const slugA = a.slug.toLowerCase().replace(/[-_](fabric|forge|neoforge|quilt|edition|forge-fabric|fabric-forge)$/, '');
    const slugB = b.slug.toLowerCase().replace(/[-_](fabric|forge|neoforge|quilt|edition|forge-fabric|fabric-forge)$/, '');
    if (slugA === slugB) return true;
  }

  // 2. Direct exact title match (case-insensitive)
  if (a.name.toLowerCase().trim() === b.name.toLowerCase().trim()) return true;

  // 3. Normalized alphanumeric string match (e.g., "Fabric API" vs "Fabric API")
  const rawA = a.name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const rawB = b.name.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (rawA === rawB && rawA.length >= 3) return true;

  // 4. Normalized key matching without stopwords
  const kA = normalizeAddonKey(a.name);
  const kB = normalizeAddonKey(b.name);
  if (kA && kB && kA === kB && kA.length >= 3) {
    return true;
  }

  // 5. Cross-check slug with clean title
  if (a.slug && b.slug) {
    const cleanSlugA = a.slug.toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanSlugB = b.slug.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (cleanSlugA === rawB || cleanSlugB === rawA) return true;
  }

  return false;
}

// Merge & Deduplicate Addon lists from Modrinth and CurseForge
export function mergeAndDeduplicateAddons(
  modrinthItems: AddonItem[],
  curseforgeItems: AddonItem[]
): AddonItem[] {
  const result: AddonItem[] = [];
  const mergedCfIds = new Set<string>();

  for (const mr of modrinthItems) {
    const cfMatch = curseforgeItems.find((cf) => !mergedCfIds.has(cf.id) && areAddonsIdentical(mr, cf));
    if (cfMatch) {
      mergedCfIds.add(cfMatch.id);
      result.push({
        ...mr,
        sources: ['modrinth', 'curseforge'],
        modrinthId: mr.id,
        curseforgeId: cfMatch.id,
        bannerUrl: mr.bannerUrl || cfMatch.bannerUrl,
        loaders: Array.from(new Set([...(mr.loaders || []), ...(cfMatch.loaders || [])])),
        downloads: Math.max(mr.downloads, cfMatch.downloads),
        categories: Array.from(new Set([...mr.categories, ...cfMatch.categories])),
      });
    } else {
      result.push({
        ...mr,
        sources: ['modrinth'],
        modrinthId: mr.id,
      });
    }
  }

  for (const cf of curseforgeItems) {
    if (!mergedCfIds.has(cf.id)) {
      result.push({
        ...cf,
        sources: ['curseforge'],
        curseforgeId: cf.id,
      });
    }
  }

  return result;
}

// Unified Multi-Source Search
export interface MultiSourceSearchOptions {
  query: string;
  contentType: AddonContentType;
  sources: {
    modrinth: boolean;
    curseforge: boolean;
  };
  gameVersion?: string;
  loader?: string;
  categoryFilter?: string;
  sortBy?: 'relevance' | 'downloads' | 'newest' | 'published';
  environment?: 'all' | 'client' | 'server';
  curseForgeApiKey?: string;
  limit?: number;
  offset?: number;
}

export async function searchAddonsMultiSource(options: MultiSourceSearchOptions): Promise<{
  items: AddonItem[];
  total: number;
}> {
  const {
    query,
    contentType,
    sources,
    gameVersion,
    loader,
    categoryFilter,
    sortBy = 'relevance',
    environment = 'all',
    curseForgeApiKey,
    limit = 20,
    offset = 0,
  } = options;

  const mrPromise = sources.modrinth
    ? searchModrinth(query, contentType, gameVersion, loader, categoryFilter, sortBy, environment, limit, offset)
    : Promise.resolve({ items: [], total: 0 });

  const cfPromise = sources.curseforge
    ? searchCurseForge(query, contentType, gameVersion, loader, categoryFilter, sortBy, curseForgeApiKey, limit, offset)
    : Promise.resolve({ items: [], total: 0 });

  const [mrRes, cfRes] = await Promise.allSettled([mrPromise, cfPromise]);

  const mrItems = mrRes.status === 'fulfilled' ? mrRes.value.items : [];
  const cfItems = cfRes.status === 'fulfilled' ? cfRes.value.items : [];

  if (sources.modrinth && sources.curseforge) {
    const deduplicated = mergeAndDeduplicateAddons(mrItems, cfItems);
    if (sortBy === 'downloads') {
      deduplicated.sort((a, b) => b.downloads - a.downloads);
    }
    const total =
      (mrRes.status === 'fulfilled' ? mrRes.value.total : 0) +
      (cfRes.status === 'fulfilled' ? cfRes.value.total : 0);
    return { items: deduplicated, total };
  }

  if (sources.modrinth) {
    return mrRes.status === 'fulfilled' ? mrRes.value : { items: [], total: 0 };
  }

  return cfRes.status === 'fulfilled' ? cfRes.value : { items: [], total: 0 };
}

// Get direct download info from CurseForge
export async function getCurseForgeDownloadInfo(
  modId: string | number,
  gameVersion?: string,
  loader?: string,
  customApiKey?: string
): Promise<{
  url: string | null;
  fileName: string;
  directAllowed: boolean;
  /** CurseForge's file id, its equivalent of a version id. */
  versionId?: string;
}> {
  const modLoaderType = getCurseForgeLoaderType(loader);

  try {
    const params = new URLSearchParams({
      pageSize: '10',
    });
    if (gameVersion) params.append('gameVersion', gameVersion);
    if (modLoaderType > 0) params.append('modLoaderType', modLoaderType.toString());

    const request = curseForgeRequest(`/v1/mods/${modId}/files`, params.toString(), customApiKey);
    const res = await fetch(request.url, { headers: request.headers });

    if (!res.ok) return { url: null, fileName: '', directAllowed: false };
    const data = await res.json();
    const files: any[] = data.data || [];
    if (files.length === 0) return { url: null, fileName: '', directAllowed: false };

    const file = files[0];
    let downloadUrl = file.downloadUrl || null;

    // Fallback: Construct Edge CDN URL if author didn't populate downloadUrl
    if (!downloadUrl && file.id && file.fileName) {
      const firstPart = Math.floor(file.id / 1000);
      const secondPart = file.id % 1000;
      downloadUrl = `https://edge.forgecdn.net/files/${firstPart}/${secondPart}/${encodeURIComponent(file.fileName)}`;
    }

    return {
      url: downloadUrl,
      fileName: file.fileName || `${modId}.jar`,
      directAllowed: Boolean(downloadUrl),
      versionId: file.id ? String(file.id) : undefined,
    };
  } catch (err) {
    console.error('Failed to get CurseForge download info:', err);
    return { url: null, fileName: '', directAllowed: false };
  }
}

// Real addon installation via Tauri backend
export async function installAddon(
  instanceId: string,
  url: string,
  fileName: string,
  addonType: AddonContentType,
  options?: { sha1?: string; projectId?: string; source?: AddonSource; versionId?: string }
): Promise<LocalMod> {
  if (isTauri()) {
    return await invokeCommand<LocalMod>('download_and_install_addon', {
      instanceId,
      url,
      fileName,
      addonType,
      sha1: options?.sha1,
      projectId: options?.projectId,
      source: options?.source,
      versionId: options?.versionId,
    });
  }
  // Browser preview fallback
  await new Promise((r) => setTimeout(r, 600));
  return {
    fileName,
    name: fileName.replace(/\.(jar|zip)(\.disabled)?$/, ''),
    enabled: true,
    sizeBytes: 1024 * 1024,
    addonType,
  };
}

// Get installed addons for a profile
export async function getInstalledAddons(
  instanceId: string,
  addonType: AddonContentType
): Promise<LocalMod[]> {
  if (isTauri()) {
    return await invokeCommand<LocalMod[]>('get_installed_addons', {
      instanceId,
      addonType,
    });
  }
  return [];
}

// Toggle enabled/disabled
export async function toggleAddon(
  instanceId: string,
  addonType: AddonContentType,
  fileName: string,
  enable: boolean
): Promise<void> {
  if (isTauri()) {
    await invokeCommand('toggle_addon', { instanceId, addonType, fileName, enable });
  }
}

// Delete addon file
export async function deleteAddon(
  instanceId: string,
  addonType: AddonContentType,
  fileName: string
): Promise<void> {
  if (isTauri()) {
    await invokeCommand('delete_addon', { instanceId, addonType, fileName });
  }
}

// Ping Minecraft Server (SLP)
export async function checkModConflicts(instanceId: string): Promise<ModConflict[]> {
  return await invokeCommand<ModConflict[]>('check_mod_conflicts', { instanceId });
}

export async function getInstanceStats(instanceId: string): Promise<InstanceStats> {
  return await invokeCommand<InstanceStats>('get_instance_stats', { instanceId });
}

export async function pingServer(host: string, port = 25565): Promise<ServerStatus> {
  if (isTauri()) {
    return await invokeCommand<ServerStatus>('ping_minecraft_server', { host, port });
  }

  // Web mode fallback: query public Minecraft server status API
  try {
    const res = await fetch(`https://api.mcsrvstat.us/3/${host}:${port}`);
    if (res.ok) {
      const data = await res.json();
      return {
        ip: host,
        port,
        online: data.online ?? false,
        version: data.version ?? 'Paper 1.21.4',
        playersOnline: data.players?.online ?? 0,
        playersMax: data.players?.max ?? 20,
        motd: data.motd?.clean?.[0] || '',
        pingMs: 24,
        favicon: data.icon,
      };
    }
  } catch {
    // ignore
  }

  // Reachability is unknown in web mode, so report offline rather than inventing a status
  return { ip: host, port, online: false };
}

// Browser Mock Handlers
async function mockCommand<T>(cmd: TauriCommand, args: Record<string, unknown>): Promise<T> {
  switch (cmd) {
    case 'get_instances':
      // Matches the Rust backend, which starts with no instances
      return [] as unknown as T;

    case 'detect_java':
      return [
        { path: 'C:\\Program Files\\Java\\jdk-21\\bin\\javaw.exe', majorVersion: 21, versionString: 'Java 21.0.11 LTS', is64Bit: true },
        { path: 'C:\\Program Files\\Eclipse Adoptium\\jdk-17\\bin\\javaw.exe', majorVersion: 17, versionString: 'Java 17.0.9 LTS', is64Bit: true },
        { path: 'C:\\Program Files\\Java\\jre1.8.0_361\\bin\\javaw.exe', majorVersion: 8, versionString: 'Java 8 Update 361', is64Bit: true },
      ] as unknown as T;

    case 'build_share_manifest':
      return [{ name: '', gameVersion: '', loader: 'vanilla', addons: [] }, []] as unknown as T;

    case 'check_mod_conflicts':
      return [] as unknown as T;

    case 'set_discord_rpc_enabled':
      return undefined as unknown as T;

    case 'get_instance_stats':
      return {
        trackedPlayMinutes: 0,
        inGamePlayMinutes: 0,
        deaths: 0,
        mobKills: 0,
        playerKills: 0,
        blocksMined: 0,
        itemsCrafted: 0,
        distanceWalkedKm: 0,
        jumps: 0,
        worlds: [],
      } as unknown as T;

    case 'launch_instance':
      console.log('Mock launch instance:', args);
      return true as unknown as T;

    case 'get_local_mods':
      return [
        { fileName: 'fabric-api-0.115.0+1.21.4.jar', name: 'Fabric API', version: '0.115.0', enabled: true, sizeBytes: 2154300 },
        { fileName: 'sodium-fabric-0.6.9+mc1.21.4.jar', name: 'Sodium (FPS Optimization)', version: '0.6.9', enabled: true, sizeBytes: 1540200 },
        { fileName: 'iris-1.8.1+mc1.21.4.jar', name: 'Iris Shaders', version: '1.8.1', enabled: true, sizeBytes: 2840000 },
        { fileName: 'CustomSkinLoader_Fabric-14.21.jar', name: 'CustomSkinLoader (Multiplayer Skin)', version: '14.21', enabled: true, sizeBytes: 890000 },
        { fileName: 'voicechat-fabric-1.21.4-2.5.28.jar', name: 'Simple Voice Chat', version: '2.5.28', enabled: true, sizeBytes: 4200000 },
        { fileName: 'appleskin-fabric-mc1.21.4-3.0.5.jar', name: 'AppleSkin', version: '3.0.5', enabled: false, sizeBytes: 310000 },
      ] as unknown as T;

    case 'backup_worlds':
      return 'mock/backups/saves-20260909-120000.zip' as unknown as T;

    case 'export_log':
      console.log('Mock export log:', args);
      return 'mock/mcl-log-20260909-120000.txt' as unknown as T;

    case 'install_local_skin':
      console.log('Mock install local skin:', args);
      return { message: 'Mock skin saved and published.', published: true } as unknown as T;

    case 'check_username_claim': {
      // "Steve" stands in for a name someone else already claimed, so the warning can be seen
      // in the browser preview.
      const name = String(args.username ?? '');
      if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) return { status: 'invalid', suggestions: [] } as unknown as T;
      if (name.toLowerCase() === 'steve') {
        return { status: 'taken', suggestions: ['Steve_2', 'Steve_3', 'Steve_4'] } as unknown as T;
      }
      return { status: 'available', suggestions: [] } as unknown as T;
    }

    case 'get_system_info':
      return {
        totalRamMb: 16384,
        availableRamMb: 9216,
        cpuCount: 8,
        recommendedMaxRamMb: 12288,
        recommendedRamMb: 4096,
      } as unknown as T;

    case 'get_game_data_dir':
      return 'C:\\Users\\Player\\AppData\\Roaming\\MCLClient' as unknown as T;

    case 'set_game_data_dir':
    case 'set_window_size':
      console.log(`Mock ${cmd}:`, args);
      return undefined as unknown as T;

    case 'scan_storage_cleanup':
      return {
        unusedVersions: [{ version: '1.20.1', sizeBytes: 184320000 }],
        unusedJavaRuntimes: [
          { name: 'java-17', sizeBytes: 146800640 },
          { name: 'java-21.partial', sizeBytes: 31457280 },
        ],
        orphanedInstances: [],
        orphanedInstancesBytes: 0,
        tempCacheBytes: 52428800,
        totalReclaimableBytes: 415006720,
        storageRoot: 'C:\\Users\\Player\\AppData\\Roaming\\MCLClient',
      } as unknown as T;

    case 'execute_storage_cleanup':
      return {
        bytesFreed: 236748800,
        versionsDeleted: 1,
        cacheCleaned: true,
        orphanedInstancesDeleted: 0,
        javaRuntimesDeleted: 2,
        message: 'Mock cleanup complete',
      } as unknown as T;

    case 'select_folder':
    case 'select_file':
      // No native picker in browser mode, so behave as if the user cancelled
      return null as unknown as T;

    case 'select_mrpack_file':
      return 'C:\\Downloads\\Fabulously-Optimized-1.21.4.mrpack' as unknown as T;

    case 'inspect_mrpack':
      return {
        name: 'Fabulously Optimized',
        summary: 'A simple Minecraft modpack focusing on performance and graphics.',
        gameVersion: '1.21.4',
        loader: 'fabric',
        loaderVersion: '0.16.10',
        totalFiles: 42,
        totalSizeBytes: 35000000,
        filePath: (args.mrpackPath as string) || 'modpack.mrpack',
      } as unknown as T;

    case 'install_mrpack':
      return {
        id: 'modpack-mock-01',
        name: (args.customName as string) || 'Fabulously Optimized',
        gameVersion: '1.21.4',
        loader: 'fabric',
        loaderVersion: '0.16.10',
        minRam: 2048,
        maxRam: 4096,
        icon: 'package',
        enableSkinInGame: true,
      } as unknown as T;

    default:
      throw new Error(
        `No browser mock for Tauri command "${cmd}". Add a case to mockCommand() in src/services/api.ts.`
      );
  }
}
