import React, { useEffect, useState } from 'react';
import { PackageCheck, Download, X } from 'lucide-react';
import type { AddonSource } from '../../types';
import { getTranslation, type Language } from '../../locales/i18n';
import { Checkbox } from '../common/Checkbox';

export interface DependencyChoice {
  id: string;
  title: string;
  iconUrl?: string;
  source: AddonSource;
}

interface DependencyConfirmModalProps {
  isOpen: boolean;
  sourceModName: string;
  dependencies: DependencyChoice[];
  isInstalling: boolean;
  onCancel: () => void;
  onSkip: () => void;
  onConfirm: (selectedIds: string[]) => void;
  language: Language;
}

/**
 * Shown after picking a mod whose metadata declares it needs other mods to work. Never forces
 * the choice: a player who installs dependencies by hand, outside MCL's own search, can still
 * skip this and just get the mod they picked.
 */
export const DependencyConfirmModal: React.FC<DependencyConfirmModalProps> = ({
  isOpen,
  sourceModName,
  dependencies,
  isInstalling,
  onCancel,
  onSkip,
  onConfirm,
  language,
}) => {
  const t = getTranslation(language);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Every dependency starts checked — this mirrors what MCL used to do silently (install them
  // all), just visible and reversible now instead of automatic.
  useEffect(() => {
    if (isOpen) setSelected(new Set(dependencies.map((d) => d.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, dependencies]);

  if (!isOpen || dependencies.length === 0) return null;

  const toggle = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-sm p-6 animate-fadeIn">
      <div className="w-full max-w-xl rounded-3xl border border-white/10 shadow-2xl overflow-hidden bg-[#121212]">
        <div className="flex items-center justify-between px-6 py-4.5 border-b border-white/[0.08] bg-[#161616]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-500/20 text-sky-400 border border-sky-500/30 flex items-center justify-center shrink-0">
              <PackageCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold font-riot text-white tracking-wide">
                {(t.depsTitle || '{mod} needs a few more mods').replace('{mod}', sourceModName)}
              </h2>
              <p className="text-sm text-slate-400 mt-0.5">
                {t.depsSub || "Choose which ones to install alongside it, or skip if you'll add them yourself."}
              </p>
            </div>
          </div>
          <button
            onClick={onCancel}
            disabled={isInstalling}
            className="w-9 h-9 rounded-xl bg-[#2a2b2f]/90 hover:bg-[#383a40] text-white border border-white/10 shadow-lg flex items-center justify-center transition-all duration-150 active:scale-90 cursor-pointer shrink-0 disabled:opacity-40"
            title="Close"
          >
            <X className="w-4.5 h-4.5 text-white" strokeWidth={3} />
          </button>
        </div>

        <div className="p-6 space-y-2.5 max-h-80 overflow-y-auto custom-scrollbar">
          {dependencies.map((dep) => (
            <Checkbox
              key={dep.id}
              checked={selected.has(dep.id)}
              onChange={(checked) => toggle(dep.id, checked)}
              className="p-3.5 rounded-xl bg-black/30 border border-white/5 hover:border-white/10 transition"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                {dep.iconUrl ? (
                  <img src={dep.iconUrl} alt="" className="w-6 h-6 rounded-md object-cover shrink-0" />
                ) : (
                  <div className="w-6 h-6 rounded-md bg-white/10 shrink-0" />
                )}
                <span className="text-sm font-medium text-slate-200 truncate">{dep.title}</span>
              </div>
            </Checkbox>
          ))}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-white/[0.08] bg-[#161616]/50">
          <button
            onClick={onSkip}
            disabled={isInstalling}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-white/10 hover:bg-white/15 border border-white/10 text-white transition cursor-pointer disabled:opacity-40"
          >
            {t.depsSkip || "Skip, just this mod"}
          </button>
          <button
            onClick={() => onConfirm([...selected])}
            disabled={isInstalling}
            className="btn-primary px-6 py-2.5 rounded-xl text-sm font-bold font-riot flex items-center gap-2 cursor-pointer shadow-md active:scale-95 transition disabled:opacity-40"
          >
            <Download className="w-4 h-4" />
            <span>
              {isInstalling
                ? t.depsInstalling || 'Installing...'
                : selected.size > 0
                ? (t.depsInstallSelected || 'Install selected ({count})').replace('{count}', String(selected.size))
                : t.depsInstallMainOnly || 'Install this mod only'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
