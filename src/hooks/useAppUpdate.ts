import { useCallback, useRef, useState } from 'react';
import { isTauri } from '../services/api';

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'installed'
  | 'failed';

interface DownloadEvent {
  event: 'Started' | 'Progress' | 'Finished';
  data?: { contentLength?: number; chunkLength?: number };
}

interface UpdateHandle {
  version: string;
  downloadAndInstall: (onEvent: (event: DownloadEvent) => void) => Promise<void>;
}

export interface AppUpdateState {
  phase: UpdatePhase;
  version: string | null;
  percent: number;
  error: string | null;
  /** Runs a check; returns whether an update was found. Safe to call repeatedly — a click
   *  in Settings and the automatic on-launch check both go through this same path.
   *  `silent: true` (the automatic on-launch check) swallows a failure back to idle rather
   *  than surfacing it — nobody who just wants to play should see a toast because their
   *  wifi hiccupped on startup. A manual click in Settings always wants to know either way. */
  checkForUpdate: (options?: { silent?: boolean }) => Promise<boolean>;
  install: () => Promise<void>;
  /** Retries whatever failed: a fresh check, or the download if a version was already found. */
  retry: () => Promise<void>;
  /** Drops back to idle without checking again — what dismissing the toast does. */
  reset: () => void;
}

/**
 * One update-check/download/install flow shared by the floating notice and the Settings
 * button, so triggering a check from either place is reflected in both rather than each
 * keeping its own answer to "is there an update".
 */
export function useAppUpdate(): AppUpdateState {
  const [phase, setPhase] = useState<UpdatePhase>('idle');
  const [version, setVersion] = useState<string | null>(null);
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const updateRef = useRef<UpdateHandle | null>(null);

  const checkForUpdate = useCallback(async (options?: { silent?: boolean }): Promise<boolean> => {
    const silent = options?.silent ?? false;

    if (!isTauri()) {
      if (!silent) {
        setPhase('failed');
        setError('Update checks only work in the installed app, not this preview.');
      }
      return false;
    }

    setPhase('checking');
    setError(null);
    try {
      // Imported here so a browser dev session never tries to load the plugin at all.
      const { check } = await import('@tauri-apps/plugin-updater');
      const found = await check();
      if (found) {
        updateRef.current = found as unknown as UpdateHandle;
        setVersion(found.version);
        setPhase('available');
        return true;
      }
      setPhase('up-to-date');
      return false;
    } catch (err) {
      // No network, no release yet, or a signature that does not verify. None of these
      // are worth interrupting someone who only wants to play — a background check stays
      // quiet about it; a check someone asked for in Settings should say what happened.
      console.warn('Update check failed:', err);
      if (silent) {
        setPhase('idle');
      } else {
        setPhase('failed');
        setError(String(err));
      }
      return false;
    }
  }, []);

  const install = useCallback(async () => {
    const update = updateRef.current;
    if (!update) return;

    setPhase('downloading');
    setError(null);
    let downloaded = 0;
    let total = 0;

    try {
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          total = event.data?.contentLength || 0;
        } else if (event.event === 'Progress') {
          downloaded += event.data?.chunkLength || 0;
          if (total > 0) setPercent(Math.min(100, Math.round((downloaded / total) * 100)));
        }
      });

      setPhase('installed');
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (err) {
      console.error('Update install failed:', err);
      setError(String(err));
      setPhase('failed');
    }
  }, []);

  const reset = useCallback(() => {
    setPhase('idle');
    setError(null);
  }, []);

  // "Try again" means different things depending on what failed: retry the download if a
  // version was already found, or run a fresh check if the failure happened before that —
  // calling install() with nothing to install would otherwise just do nothing silently.
  const retry = useCallback(async () => {
    if (updateRef.current) {
      await install();
    } else {
      await checkForUpdate();
    }
  }, [install, checkForUpdate]);

  return { phase, version, percent, error, checkForUpdate, install, retry, reset };
}
