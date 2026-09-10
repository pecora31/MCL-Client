import React, { useEffect, useState } from 'react';
import { Download, X, RefreshCw, CheckCircle2 } from 'lucide-react';
import { isTauri } from '../../services/api';
import { getTranslation, type Language } from '../../locales/i18n';

interface UpdateNoticeProps {
  language: Language;
}

type Phase = 'idle' | 'available' | 'downloading' | 'installed' | 'failed';

interface UpdateHandle {
  version: string;
  downloadAndInstall: (onEvent: (event: DownloadEvent) => void) => Promise<void>;
}

interface DownloadEvent {
  event: 'Started' | 'Progress' | 'Finished';
  data?: { contentLength?: number; chunkLength?: number };
}

/**
 * Offers the update rather than applying it: a launcher that restarts itself while someone
 * is mid-download of a modpack would be worse than being one version behind.
 */
export const UpdateNotice: React.FC<UpdateNoticeProps> = ({ language }) => {
  const t = getTranslation(language);
  const [phase, setPhase] = useState<Phase>('idle');
  const [update, setUpdate] = useState<UpdateHandle | null>(null);
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;

    const checkForUpdate = async () => {
      try {
        // Imported here so a browser dev session never tries to load the plugin at all.
        const { check } = await import('@tauri-apps/plugin-updater');
        const found = await check();
        if (!cancelled && found) {
          setUpdate(found as unknown as UpdateHandle);
          setPhase('available');
        }
      } catch (err) {
        // No network, no release yet, or a signature that does not verify. None of these
        // are worth interrupting someone who only wants to play.
        console.warn('Update check skipped:', err);
      }
    };

    checkForUpdate();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleInstall = async () => {
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
      console.error('Update failed:', err);
      setError(String(err));
      setPhase('failed');
    }
  };

  if (dismissed || phase === 'idle' || !update) return null;

  return (
    <div className="fixed bottom-5 right-5 z-[60] w-80 minimal-panel rounded-2xl border border-white/10 shadow-2xl p-4 space-y-3 animate-fadeIn">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-[var(--accent-color)]/15 border border-[var(--accent-color)]/30 flex items-center justify-center shrink-0">
            {phase === 'installed' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : phase === 'downloading' ? (
              <RefreshCw className="w-4 h-4 text-[var(--accent-color)] animate-spin" />
            ) : (
              <Download className="w-4 h-4 text-[var(--accent-color)]" />
            )}
          </div>
          <div className="min-w-0">
            <div className="text-xs font-bold text-white tracking-wide truncate">
              {phase === 'installed'
                ? t.updateInstalled || 'Update installed'
                : `${t.updateAvailable || 'Update available'} · v${update.version}`}
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
              {phase === 'downloading'
                ? `${t.updateDownloading || 'Downloading'}… ${percent}%`
                : phase === 'installed'
                ? t.updateRestarting || 'Restarting the launcher…'
                : phase === 'failed'
                ? error
                : t.updateReady || 'Restarts the launcher when it finishes.'}
            </p>
          </div>
        </div>

        {phase !== 'downloading' && phase !== 'installed' && (
          <button
            onClick={() => setDismissed(true)}
            className="p-1 rounded-lg text-slate-500 hover:text-white hover:bg-white/10 transition cursor-pointer shrink-0"
            title={t.updateLater || 'Later'}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {phase === 'downloading' && (
        <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full bg-[var(--accent-color)] transition-all duration-200"
            style={{ width: `${percent}%` }}
          />
        </div>
      )}

      {(phase === 'available' || phase === 'failed') && (
        <button
          onClick={handleInstall}
          className="btn-primary w-full py-2 rounded-xl text-xs font-bold cursor-pointer"
        >
          {phase === 'failed' ? t.updateRetry || 'Try again' : t.updateInstall || 'Install now'}
        </button>
      )}
    </div>
  );
};
