import React, { useState, useEffect } from 'react';
import { X, Sliders, Cpu, Save, FolderOpen, ChevronDown } from 'lucide-react';

/** Common resolutions offered in the window-size dropdown, alongside a custom option. */
const WINDOW_SIZE_PRESETS: { width: number; height: number; label: string }[] = [
  { width: 1280, height: 720, label: '1280 × 720' },
  { width: 1600, height: 900, label: '1600 × 900' },
  { width: 1920, height: 1080, label: '1920 × 1080 (Full HD)' },
  { width: 2560, height: 1440, label: '2560 × 1440 (2K)' },
  { width: 3840, height: 2160, label: '3840 × 2160 (4K)' },
];
import type { GameInstance, SystemInfo, JavaInstallation } from '../../types';
import { invokeCommand } from '../../services/api';
import { getTranslation, type Language } from '../../locales/i18n';
import { ToggleSwitch } from '../common/ToggleSwitch';

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
      setEnableSkinInGame(instance.enableSkinInGame ?? true);
      setJavaPath(instance.javaPath || '');
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

  // Derives the dropdown's own value from the plain width/height/fullscreen state that
  // actually gets saved, so switching presets never needs a separate source of truth.
  const windowModeValue = fullscreen
    ? 'fullscreen'
    : !windowWidth && !windowHeight
    ? 'default'
    : WINDOW_SIZE_PRESETS.some((p) => String(p.width) === windowWidth && String(p.height) === windowHeight)
    ? `${windowWidth}x${windowHeight}`
    : 'custom';

  const handleWindowModeChange = (value: string) => {
    if (value === 'default') {
      setFullscreen(false);
      setWindowWidth('');
      setWindowHeight('');
    } else if (value === 'fullscreen') {
      setFullscreen(true);
    } else if (value === 'custom') {
      setFullscreen(false);
      if (!windowWidth) setWindowWidth('1280');
      if (!windowHeight) setWindowHeight('720');
    } else {
      const [w, h] = value.split('x');
      setFullscreen(false);
      setWindowWidth(w);
      setWindowHeight(h);
    }
  };

  if (!isOpen || !instance) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...instance,
      name: name.trim() || instance.name,
      minRam,
      maxRam,
      jvmArgs: jvmArgs.trim() || undefined,
      javaPath: javaPath || undefined,
      windowWidth: Number(windowWidth) || undefined,
      windowHeight: Number(windowHeight) || undefined,
      fullscreen: fullscreen || undefined,
      enableSkinInGame,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
      <div className="w-full max-w-lg rounded-2xl bg-[#121212] border border-white/10 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08] bg-[#161616]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/30">
              <Sliders className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white font-riot">Edit Profile</h2>
              <p className="text-xs text-slate-400">
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
            <X className="w-4 h-4 text-white" strokeWidth={3} />
          </button>
        </div>

        {/* Body Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto flex-1">
          {/* Profile Name */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
              Profile Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter profile name..."
              required
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#1a1a1a] border border-white/10 text-sm text-white focus:outline-none focus:border-amber-400"
            />
          </div>

          {/* RAM Allocation */}
          <div className="space-y-3 p-4 rounded-xl bg-white/[0.02] border border-white/[0.06]">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                <Cpu className="w-4 h-4 text-[var(--accent-color)]" />
                <span>Memory (RAM) Allocation</span>
              </label>
              <span className="text-xs font-bold text-[var(--accent-color)]">
                {(maxRam / 1024).toFixed(1)} GB (Max)
              </span>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-[11px] text-slate-400">
                <span>Maximum RAM: {maxRam} MB</span>
                {systemInfo && <span>({(systemInfo.totalRamMb / 1024).toFixed(0)} GB installed)</span>}
              </div>
              {(() => {
                // Draggable all the way to what's actually installed rather than stopping
                // at the recommended ceiling — going past it is allowed, just called out.
                const sliderMax = systemInfo?.totalRamMb ?? 16384;
                const span = Math.max(sliderMax - 2048, 512);
                const ramPct = Math.round(((Math.min(maxRam, sliderMax) - 2048) / span) * 100);
                return (
                  <input
                    type="range"
                    min={2048}
                    max={sliderMax}
                    step={512}
                    value={Math.min(maxRam, sliderMax)}
                    style={{
                      background: `linear-gradient(to right, var(--accent-color, #10b981) ${ramPct}%, rgba(255,255,255,0.08) ${ramPct}%)`,
                    }}
                    onChange={(e) => setMaxRam(Number(e.target.value))}
                    className="w-full cursor-pointer"
                  />
                );
              })()}
              {systemInfo && maxRam > systemInfo.recommendedMaxRamMb && (
                <p className="text-[10px] text-amber-300 leading-relaxed">
                  This is more than the computer can comfortably spare — Windows and the game itself may
                  not have enough memory left to run.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[11px] text-slate-400">Game Window</div>
                <ToggleSwitch
                  size="sm"
                  checked={fullscreen}
                  onChange={setFullscreen}
                  title="Fullscreen"
                />
              </div>

              <div className="relative">
                <select
                  value={windowModeValue}
                  onChange={(e) => handleWindowModeChange(e.target.value)}
                  className="w-full appearance-none px-3.5 py-2.5 rounded-xl bg-[#1a1a1a] border border-white/10 text-xs text-white cursor-pointer pr-8 focus:outline-none focus:border-amber-400"
                >
                  <option value="default" className="bg-slate-900">Let Minecraft decide (default)</option>
                  <option value="fullscreen" className="bg-slate-900">Fullscreen</option>
                  {WINDOW_SIZE_PRESETS.map((p) => (
                    <option key={p.label} value={`${p.width}x${p.height}`} className="bg-slate-900">
                      {p.label}
                    </option>
                  ))}
                  <option value="custom" className="bg-slate-900">Custom size…</option>
                </select>
                <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>

              {windowModeValue === 'custom' && (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={windowWidth}
                    onChange={(e) => setWindowWidth(e.target.value)}
                    placeholder="Width"
                    className="flex-1 glass-input px-3 py-2 rounded-xl text-xs text-white"
                  />
                  <span className="text-slate-500 text-xs">×</span>
                  <input
                    type="number"
                    value={windowHeight}
                    onChange={(e) => setWindowHeight(e.target.value)}
                    placeholder="Height"
                    className="flex-1 glass-input px-3 py-2 rounded-xl text-xs text-white"
                  />
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="text-[11px] text-slate-400">Java Runtime</div>
              <div className="relative">
                <select
                  value={javaPath}
                  onChange={(e) => setJavaPath(e.target.value)}
                  className="w-full appearance-none glass-input px-3.5 py-2.5 rounded-xl text-xs text-white cursor-pointer pr-8"
                >
                  <option value="" className="bg-slate-900">
                    Automatic — pick the right Java for this version
                  </option>
                  {javaList.map((j) => (
                    <option key={j.path} value={j.path} className="bg-slate-900">
                      {j.versionString}
                      {j.is64Bit ? '' : ' (32-bit)'} — {j.path}
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>
          </div>

          {/* JVM Arguments */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
              Custom JVM Arguments (Optional)
            </label>
            <input
              type="text"
              value={jvmArgs}
              onChange={(e) => setJvmArgs(e.target.value)}
              placeholder="-XX:+UseG1GC -XX:+ParallelRefProcEnabled"
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#1a1a1a] border border-white/10 text-xs font-mono text-slate-200 focus:outline-none focus:border-amber-400"
            />
          </div>

          {/* Skin Synchronization Toggle */}
          <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.06] flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold text-slate-200 block">In-Game Team Skin Support</span>
              <span className="text-[11px] text-slate-400">Automatically sync custom player skins in-game</span>
            </div>
            <ToggleSwitch
              size="md"
              checked={enableSkinInGame}
              onChange={setEnableSkinInGame}
              title="In-Game Team Skin Support"
            />
          </div>

          {/* Footer Actions */}
          <div className="pt-3 border-t border-white/[0.08] flex items-center justify-between gap-3">
            {onOpenDir && (
              <button
                type="button"
                onClick={() => onOpenDir(instance.id)}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 flex items-center gap-2 transition cursor-pointer"
                title={t.openFolderInExplorer || 'Open profile folder in File Explorer'}
              >
                <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
                <span>{t.btnOpenDir || 'Open Folder'}</span>
              </button>
            )}

            <div className="flex items-center gap-3 ml-auto">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white hover:bg-white/5 transition cursor-pointer"
              >
                {t.cancel || 'Cancel'}
              </button>
              <button
                type="submit"
                className="btn-primary px-5 py-2.5 rounded-xl text-xs font-bold font-riot flex items-center gap-2 shadow-lg cursor-pointer"
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
