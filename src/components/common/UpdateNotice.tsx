import React from 'react';
import { Download, X, RefreshCw, CheckCircle2 } from 'lucide-react';
import type { AppUpdateState } from '../../hooks/useAppUpdate';
import { getTranslation, type Language } from '../../locales/i18n';

interface UpdateNoticeProps {
  language: Language;
  appUpdate: AppUpdateState;
}

/**
 * Surfaces the shared update state as a toast. Only shown for phases worth interrupting
 * over — "checking" and "up to date" have nowhere useful to go but Settings, where a
 * manual check already shows its own inline result.
 */
export const UpdateNotice: React.FC<UpdateNoticeProps> = ({ language, appUpdate }) => {
  const t = getTranslation(language);
  const { phase, version, percent, error, install, retry, reset } = appUpdate;

  if (!['available', 'downloading', 'installed', 'failed'].includes(phase)) return null;

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
                : `${t.updateAvailable || 'Update available'}${version ? ` · v${version}` : ''}`}
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
            onClick={reset}
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
          onClick={phase === 'failed' ? retry : install}
          className="btn-primary w-full py-2 rounded-xl text-xs font-bold cursor-pointer"
        >
          {phase === 'failed' ? t.updateRetry || 'Try again' : t.updateInstall || 'Install now'}
        </button>
      )}
    </div>
  );
};
