import React, { useState, useEffect, useMemo } from 'react';
import { X, Sliders, Save, FolderOpen, AlertCircle } from 'lucide-react';

import type { GameInstance, SystemInfo, JavaInstallation } from '../../types';
import { invokeCommand } from '../../services/api';
import { getTranslation, type Language } from '../../locales/i18n';
import { ToggleSwitch } from '../common/ToggleSwitch';
import { RamAllocationField } from '../common/RamAllocationField';
import { CustomSelect } from '../common/CustomSelect';
import { GameWindowSelector } from './GameWindowSelector';
import { buildJavaOptions, javaChoiceToProfile, profileToJavaChoice } from '../../services/java';

interface EditInstanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  instance: GameInstance | null;
  onSave: (updated: GameInstance) => void;
  onOpenDir?: (id: string) => void;
  language?: Language;
}

export const EditInstanceModal: React.FC<EditInstanceModalProps> = ({
  isOpen,
  onClose,
  instance,
  onSave,
  onOpenDir,
  language = 'en',
}) => {
  const t = getTranslation(language);
  const [name, setName] = useState('');
  const [minRam, setMinRam] = useState(2048);
  const [maxRam, setMaxRam] = useState(4096);
  const [jvmArgs, setJvmArgs] = useState('');
  const [useAikarFlags, setUseAikarFlags] = useState(false);
  const [gcEngine, setGcEngine] = useState<'G1GC' | 'ZGC'>('G1GC');
  const [enableSkinInGame, setEnableSkinInGame] = useState(true);
  const [javaPath, setJavaPath] = useState('');
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [javaList, setJavaList] = useState<JavaInstallation[]>([]);
  const [windowWidth, setWindowWidth] = useState('');
  const [windowHeight, setWindowHeight] = useState('');
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (instance) {
      setName(instance.name);
      setMinRam(instance.minRam || 2048);
      setMaxRam(instance.maxRam || 4096);
      setJvmArgs(instance.jvmArgs || '');
      setUseAikarFlags(instance.useAikarFlags ?? false);
      setGcEngine(instance.gcEngine || 'G1GC');
      setEnableSkinInGame(instance.enableSkinInGame ?? true);
      setWindowWidth(instance.windowWidth ? String(instance.windowWidth) : '');
      setWindowHeight(instance.windowHeight ? String(instance.windowHeight) : '');
      setFullscreen(instance.fullscreen ?? false);
    }
  }, [instance, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    invokeCommand<SystemInfo>('get_system_info')
      .then(setSystemInfo)
      .catch((err) => console.warn('Could not read system info:', err));
    invokeCommand<JavaInstallation[]>('detect_java')
      .then((list) => setJavaList(list || []))
      .catch((err) => console.warn('Could not detect Java:', err));
  }, [isOpen]);

  // Kept apart from the effect above because the Java list arrives after the form opens, and a
  // saved path can only be shown as its version once that list is known
  useEffect(() => {
    if (instance) setJavaPath(profileToJavaChoice(instance, javaList));
  }, [instance, isOpen, javaList]);

  const javaOptions = useMemo(
    () => buildJavaOptions(javaList, instance?.gameVersion ?? ''),
    [javaList, instance?.gameVersion]
  );

  if (!isOpen || !instance) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let finalW = Number(windowWidth) || undefined;
    let finalH = Number(windowHeight) || undefined;
    if (finalW && finalW < 640) finalW = 640;
    if (finalH && finalH < 480) finalH = 480;

    onSave({
      ...instance,
      name: name.trim() || instance.name,
      minRam,
      maxRam,
      jvmArgs: jvmArgs.trim() || undefined,
      useAikarFlags: useAikarFlags || undefined,
      gcEngine: useAikarFlags || gcEngine === 'ZGC' ? gcEngine : undefined,
      ...javaChoiceToProfile(javaPath),
      windowWidth: finalW,
      windowHeight: finalH,
      fullscreen: fullscreen || undefined,
      enableSkinInGame,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
      {/* Matches Create Profile's width (max-w-2xl) so the two feel like the same dialog family */}
      <div className="w-full max-w-2xl rounded-2xl bg-[#121212] border border-white/10 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4.5 border-b border-white/[0.08] bg-[#161616]">
          <div className="flex items-center gap-3">
            <Sliders className="w-6 h-6 text-amber-400 shrink-0" />
            <div>
              <h2 className="text-lg font-bold text-white font-riot">Edit Profile</h2>
              <p className="text-sm text-slate-400 mt-0.5">
                {instance.loader.toUpperCase()} • Minecraft {instance.gameVersion}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-[#2a2b2f]/90 hover:bg-[#383a40] text-white border border-white/10 shadow-lg flex items-center justify-center transition-all duration-150 active:scale-90 cursor-pointer"
            title="Close"
          >
            <X className="w-4.5 h-4.5 text-white" strokeWidth={3} />
          </button>
        </div>

        {/* Body Form */}
        <form onSubmit={handleSubmit} noValidate className="p-6 space-y-5 overflow-y-auto flex-1">
          {/* Profile Name */}
          <div>
            <label className="block text-[13px] font-bold text-slate-200 uppercase tracking-wider mb-2">
              Profile Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter profile name..."
              required
              className="w-full px-4 py-3 rounded-xl bg-[#1a1a1a] border border-white/10 text-base font-semibold text-white focus:outline-none focus:border-amber-400"
            />
          </div>

          {/* RAM Allocation */}
          <div className="space-y-3.5">
            <RamAllocationField value={maxRam} onChange={setMaxRam} systemInfo={systemInfo} step={512} />

            <GameWindowSelector
              fullscreen={fullscreen}
              setFullscreen={setFullscreen}
              windowWidth={windowWidth}
              setWindowWidth={setWindowWidth}
              windowHeight={windowHeight}
              setWindowHeight={setWindowHeight}
              language={language}
            />

            <div className="space-y-2 p-4.5 rounded-xl bg-white/[0.02] border border-white/[0.06]">
              <div className="text-[13px] font-bold text-slate-200 uppercase tracking-wider mb-1.5">Java Runtime</div>
              <CustomSelect
                value={javaPath}
                onChange={setJavaPath}
                options={javaOptions}
              />
            </div>
          </div>

          {/* JVM Arguments */}
          <div>
            <label className="block text-[13px] font-bold text-slate-200 uppercase tracking-wider mb-2">
              Custom JVM Arguments (Optional)
            </label>
            <input
              type="text"
              value={jvmArgs}
              onChange={(e) => setJvmArgs(e.target.value)}
              placeholder="-XX:+UseG1GC -XX:+ParallelRefProcEnabled"
              className="w-full px-4 py-3 rounded-xl bg-[#1a1a1a] border border-white/10 text-sm font-mono text-slate-200 focus:outline-none focus:border-amber-400"
            />
          </div>

          {/* Garbage collector tuning — the same JVM, the same GC-pause stutter, as hosting a
              server already offers */}
          <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <span className="text-sm font-bold text-white block">{t.profileGcEngineTitle || 'Garbage Collector'}</span>
                <span className="text-xs text-slate-400 mt-0.5 block">
                  {t.profileGcEngineDesc || 'G1GC is stable and standard. ZGC minimizes GC pause stutter, and needs Java 15 or newer.'}
                </span>
              </div>
              <div className="w-44 shrink-0">
                <CustomSelect
                  value={gcEngine}
                  onChange={(v) => setGcEngine(v)}
                  options={[
                    { value: 'G1GC', label: t.hostServerGcG1 || 'G1GC (Default - Recommended)' },
                    { value: 'ZGC', label: t.hostServerGcZgc || 'ZGC (Ultra Low Latency - Java 17+)' },
                  ]}
                />
              </div>
            </div>
            {gcEngine === 'ZGC' && (
              <div className="flex items-start gap-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-lg p-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{t.profileZgcJavaWarning || 'ZGC needs Java 15 or newer. On an older Java the game will refuse to start.'}</span>
              </div>
            )}
          </div>

          <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] flex items-center justify-between">
            <div>
              <span className="text-sm font-bold text-white block">{t.profileAikarFlagsTitle || "Aikar's Flags"}</span>
              <span className="text-xs text-slate-400 mt-0.5 block">
                {t.profileAikarFlagsDesc ||
                  'Tuned G1GC flags that smooth out GC pause stutter. They include AlwaysPreTouch, so the JVM claims the full allocated RAM right at startup.'}
              </span>
            </div>
            <ToggleSwitch size="md" checked={useAikarFlags} onChange={setUseAikarFlags} title={t.profileAikarFlagsTitle} />
          </div>

          {/* Skin Synchronization Toggle */}
          <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] flex items-center justify-between">
            <div>
              <span className="text-sm font-bold text-white block">In-Game Team Skin Support</span>
              <span className="text-xs text-slate-400 mt-0.5">Automatically sync custom player skins in-game</span>
            </div>
            <ToggleSwitch
              size="md"
              checked={enableSkinInGame}
              onChange={setEnableSkinInGame}
              title="In-Game Team Skin Support"
            />
          </div>

          {/* Footer Actions */}
          <div className="pt-3.5 border-t border-white/[0.08] flex items-center justify-between gap-3">
            {onOpenDir && (
              <button
                type="button"
                onClick={() => onOpenDir(instance.id)}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 flex items-center gap-2 transition cursor-pointer"
                title={t.openFolderInExplorer || 'Open profile folder in File Explorer'}
              >
                <FolderOpen className="w-4 h-4 text-amber-400" />
                <span>{t.btnOpenDir || 'Open Folder'}</span>
              </button>
            )}

            <div className="flex items-center gap-3 ml-auto">
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2.5 rounded-xl text-sm font-semibold text-slate-400 hover:text-white hover:bg-white/5 transition cursor-pointer"
              >
                {t.cancel || 'Cancel'}
              </button>
              <button
                type="submit"
                className="btn-primary px-6 py-2.5 rounded-xl text-sm font-bold font-riot flex items-center gap-2 shadow-lg cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>{t.btnSave || 'Save Changes'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
