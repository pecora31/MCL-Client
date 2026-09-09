import React from 'react';
import { AlertTriangle, PackageX, X, Play } from 'lucide-react';
import type { ModConflict } from '../../types';
import { getTranslation, type Language } from '../../locales/i18n';

interface ModConflictModalProps {
  isOpen: boolean;
  conflicts: ModConflict[];
  onClose: () => void;
  onLaunchAnyway: () => void;
  language: Language;
}

/**
 * Shown before launching when installed mods declare, in their own metadata, that they will
 * not work together. It never blocks: the player may know something the metadata does not,
 * and a launcher that refuses to start the game is worse than one that warns.
 */
export const ModConflictModal: React.FC<ModConflictModalProps> = ({
  isOpen,
  conflicts,
  onClose,
  onLaunchAnyway,
  language,
}) => {
  const t = getTranslation(language);
  if (!isOpen || conflicts.length === 0) return null;

  const describe = (conflict: ModConflict): string => {
    switch (conflict.kind) {
      case 'breaks':
        return (t.conflictBreaks || '{a} does not work with {b}')
          .replace('{a}', conflict.sourceName)
          .replace('{b}', conflict.targetName);
      case 'missing':
        return (t.conflictMissing || '{a} needs {b}, which is not installed')
          .replace('{a}', conflict.sourceName)
          .replace('{b}', conflict.targetName);
      default:
        return (t.conflictSoft || '{a} advises against running with {b}')
          .replace('{a}', conflict.sourceName)
          .replace('{b}', conflict.targetName);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-6 animate-fadeIn">
      <div className="w-full max-w-lg minimal-panel rounded-2xl border border-white/10 shadow-2xl overflow-hidden">
        <div className="flex items-start justify-between gap-4 p-5 border-b border-white/[0.06]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white font-riot tracking-wide">
                {t.conflictTitle || 'These mods declare a problem'}
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {t.conflictSub || 'Reported by the mods themselves, before the game starts.'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/10 transition cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-2 max-h-72 overflow-y-auto custom-scrollbar">
          {conflicts.map((conflict, index) => (
            <div
              key={`${conflict.fileName}-${conflict.targetId}-${index}`}
              className="flex items-start gap-3 p-3 rounded-xl bg-black/30 border border-white/5"
            >
              {conflict.kind === 'missing' ? (
                <PackageX className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle
                  className={`w-4 h-4 shrink-0 mt-0.5 ${
                    conflict.kind === 'breaks' ? 'text-rose-400' : 'text-amber-400'
                  }`}
                />
              )}
              <div className="min-w-0">
                <div className="text-xs text-slate-200 leading-snug">{describe(conflict)}</div>
                <div className="text-[10px] text-slate-500 font-mono mt-1 truncate">
                  {conflict.fileName}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-end gap-3 p-5 pt-0">
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl text-xs font-bold bg-white/10 hover:bg-white/20 border border-white/10 text-white transition cursor-pointer"
          >
            {t.conflictCancel || 'Back to mods'}
          </button>
          <button
            onClick={onLaunchAnyway}
            className="btn-primary px-5 py-2.5 rounded-xl text-xs font-bold font-riot flex items-center gap-2 cursor-pointer"
          >
            <Play className="w-3.5 h-3.5" />
            <span>{t.conflictLaunchAnyway || 'Launch anyway'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
