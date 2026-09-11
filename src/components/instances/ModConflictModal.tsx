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
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-sm p-6 animate-fadeIn">
      <div className="w-full max-w-xl rounded-3xl border border-white/10 shadow-2xl overflow-hidden bg-[#121212]">
        <div className="flex items-center justify-between px-6 py-4.5 border-b border-white/[0.08] bg-[#161616]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold font-riot text-white tracking-wide">
                {t.conflictTitle || 'These mods declare a problem'}
              </h2>
              <p className="text-sm text-slate-400 mt-0.5">
                {t.conflictSub || 'Reported by the mods themselves, before the game starts.'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-[#2a2b2f]/90 hover:bg-[#383a40] text-white border border-white/10 shadow-lg flex items-center justify-center transition-all duration-150 active:scale-90 cursor-pointer shrink-0"
            title="Close"
          >
            <X className="w-4.5 h-4.5 text-white" strokeWidth={3} />
          </button>
        </div>

        <div className="p-6 space-y-2.5 max-h-80 overflow-y-auto custom-scrollbar">
          {conflicts.map((conflict, index) => (
            <div
              key={`${conflict.fileName}-${conflict.targetId}-${index}`}
              className="flex items-start gap-3.5 p-3.5 rounded-xl bg-black/30 border border-white/5"
            >
              {conflict.kind === 'missing' ? (
                <PackageX className="w-4.5 h-4.5 text-cyan-400 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle
                  className={`w-4.5 h-4.5 shrink-0 mt-0.5 ${
                    conflict.kind === 'breaks' ? 'text-rose-400' : 'text-amber-400'
                  }`}
                />
              )}
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-200 leading-snug">{describe(conflict)}</div>
                <div className="text-xs text-slate-400 font-mono mt-1 truncate">
                  {conflict.fileName}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-white/[0.08] bg-[#161616]/50">
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-white/10 hover:bg-white/15 border border-white/10 text-white transition cursor-pointer"
          >
            {t.conflictCancel || 'Back to mods'}
          </button>
          <button
            onClick={onLaunchAnyway}
            className="btn-primary px-6 py-2.5 rounded-xl text-sm font-bold font-riot flex items-center gap-2 cursor-pointer shadow-md active:scale-95 transition"
          >
            <Play className="w-4 h-4" />
            <span>{t.conflictLaunchAnyway || 'Launch anyway'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
