/**
 * Sharing a profile as a short code.
 *
 * Only a manifest travels — which mod, from which platform, at which version. The files are
 * fetched from Modrinth and CurseForge on the importing machine exactly as a manual install
 * would, so no mod is ever copied through MCL's service.
 */

import {
  MCL_SERVICE_ROOT,
  invokeCommand,
  installAddon,
  getModrinthDownloadInfo,
  getCurseForgeDownloadInfo,
} from './api';
import type { ImportProgress, ShareManifest } from '../types';

const SHARES_ROOT = `${MCL_SERVICE_ROOT}/v1/shares`;

export interface ShareResult {
  code: string;
  expiresInDays: number;
  /** Files with no project behind them, which the recipient has to add themselves. */
  untracked: string[];
}

/**
 * `fetch()` rejects rather than resolving with a bad status when the request never leaves
 * the machine at all — no internet, DNS failure, or the service being unreachable — and the
 * browser's own message for that ("Failed to fetch", "NetworkError...") reads exactly like
 * a bug report and tells the player nothing they can act on.
 */
async function fetchOrExplain(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch {
    throw new Error("Could not reach MCL's server. Check your internet connection and try again.");
  }
}

export async function createShareCode(instanceId: string): Promise<ShareResult> {
  const [manifest, untracked] = await invokeCommand<[ShareManifest, string[]]>(
    'build_share_manifest',
    { instanceId }
  );

  const res = await fetchOrExplain(SHARES_ROOT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(manifest),
  });

  if (!res.ok) {
    const detail = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error((detail as { error?: string }).error || `HTTP ${res.status}`);
  }

  const { code, expiresInDays } = (await res.json()) as {
    code: string;
    expiresInDays: number;
  };
  return { code, expiresInDays, untracked };
}

export async function fetchShareManifest(code: string): Promise<ShareManifest> {
  const res = await fetchOrExplain(`${SHARES_ROOT}/${encodeURIComponent(code.trim().toUpperCase())}`);
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error((detail as { error?: string }).error || `HTTP ${res.status}`);
  }
  return (await res.json()) as ShareManifest;
}

/**
 * Installs everything a manifest lists into an already-created profile.
 *
 * One addon failing does not stop the rest: a shared profile missing one mod is far more
 * use than no profile at all, so failures are collected and reported at the end.
 */
export async function installSharedAddons(
  instanceId: string,
  manifest: ShareManifest,
  curseForgeApiKey: string | undefined,
  onProgress: (progress: ImportProgress) => void
): Promise<{ failed: string[] }> {
  const failed: string[] = [];
  const total = manifest.addons.length;

  for (let index = 0; index < total; index++) {
    const addon = manifest.addons[index];
    const label = addon.fileName || addon.projectId;
    onProgress({ done: index, total, currentName: label });

    try {
      if (addon.source === 'modrinth') {
        const info = await getModrinthDownloadInfo(
          addon.projectId,
          manifest.gameVersion,
          manifest.loader
        );
        if (!info?.url) {
          failed.push(label);
          continue;
        }
        await installAddon(instanceId, info.url, info.fileName, addon.addonType as never, {
          sha1: info.sha1,
          projectId: addon.projectId,
          source: 'modrinth',
          versionId: info.versionId,
        });
      } else {
        const info = await getCurseForgeDownloadInfo(
          addon.projectId,
          manifest.gameVersion,
          manifest.loader,
          curseForgeApiKey
        );
        if (!info.url) {
          failed.push(label);
          continue;
        }
        await installAddon(instanceId, info.url, info.fileName, addon.addonType as never, {
          projectId: addon.projectId,
          source: 'curseforge',
          versionId: info.versionId,
        });
      }
    } catch (err) {
      console.warn(`Could not install ${label} from the shared profile:`, err);
      failed.push(label);
    }
  }

  onProgress({ done: total, total, currentName: '' });
  return { failed };
}
