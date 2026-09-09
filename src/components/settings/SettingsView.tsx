import React, { useState, useEffect } from 'react';
import {
  Settings,
  Cpu,
  HardDrive,
  Server,
  RefreshCw,
  Check,
  Palette,
  Trash2,
  Globe,
  Monitor,
  Zap,
  Terminal,
  Key,
  Gamepad2,
} from 'lucide-react';
import type {
  LauncherSettings,
  JavaInstallation,
  ColorPalette,
  WindowResolution,
} from '../../types';
import { invokeCommand, isTauri } from '../../services/api';
import { getTranslation, type Language } from '../../locales/i18n';
import { StorageCleanupModal } from './StorageCleanupModal';

interface SettingsViewProps {
  settings: LauncherSettings;
  onSaveSettings: (settings: LauncherSettings) => void;
  language: Language;
  onChangeLanguage: (lang: Language) => void;
}

// Module-level cache so reopening Settings renders in 0ms with zero delay
let cachedJavaList: JavaInstallation[] = [];
let hasInitialDetected = false;

export const setPrewarmedJavaList = (list: JavaInstallation[]) => {
  cachedJavaList = list;
  hasInitialDetected = true;
};

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  onSaveSettings,
  language,
  onChangeLanguage,
}) => {
  const t = getTranslation(language);
  const [formData, setFormData] = useState<LauncherSettings>(settings);
  const [javaList, setJavaList] = useState<JavaInstallation[]>(cachedJavaList);
  const [detectingJava, setDetectingJava] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [isCleanupModalOpen, setIsCleanupModalOpen] = useState(false);

  useEffect(() => {
    setFormData(settings);
  }, [settings]);

  useEffect(() => {
    // Only detect on mount if cache is not yet populated
    if (!hasInitialDetected && cachedJavaList.length === 0) {
      handleDetectJava();
    }
  }, []);

  const handleDetectJava = async () => {
    setDetectingJava(true);
    try {
      const list = await invokeCommand<JavaInstallation[]>('detect_java');
      const resolved = list || [];
      cachedJavaList = resolved;
      hasInitialDetected = true;
      setJavaList(resolved);
      if (!formData.defaultJavaPath && resolved.length > 0) {
        setFormData((prev) => ({ ...prev, defaultJavaPath: resolved[0].path }));
      }
    } catch {
      // fallback
    } finally {
      setDetectingJava(false);
    }
  };

  const handleSave = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    onSaveSettings(formData);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2000);
  };

  // 1. Color Palettes
  const palettes: { id: ColorPalette; name: string; color: string; desc: string }[] = [
    { id: 'amber', name: t.paletteAmber || 'Amber Gold', color: '#f59e0b', desc: t.paletteAmberDesc || 'Golden Amber' },
    { id: 'indigo', name: t.paletteIndigo || 'Cyber Indigo', color: '#6366f1', desc: t.paletteIndigoDesc || 'Cyber Indigo' },
    { id: 'emerald', name: t.paletteEmerald || 'Emerald', color: '#10b981', desc: t.paletteEmeraldDesc || 'Fresh Emerald' },
    { id: 'rose', name: t.paletteRose || 'Ruby Rose', color: '#f43f5e', desc: t.paletteRoseDesc || 'Ruby Rose' },
    { id: 'cyan', name: t.paletteCyan || 'Ocean Cyan', color: '#06b6d4', desc: t.paletteCyanDesc || 'Deep Ocean Cyan' },
    { id: 'slate', name: t.paletteSlate || 'Slate Dark', color: '#94a3b8', desc: t.paletteSlateDesc || 'Elegant Slate' },
  ];

  const handleSelectPalette = (palette: ColorPalette) => {
    const updated = { ...formData, colorPalette: palette };
    setFormData(updated);
    onSaveSettings(updated);
  };

  // 2. Window Resolutions
  const resolutions: { id: WindowResolution; title: string; tag: string; desc: string }[] = [
    { id: '1280x720', title: '1280 × 720', tag: 'HD', desc: t.res720pDesc || t.res720p || 'Compact / Laptop' },
    { id: '1440x900', title: '1440 × 900', tag: 'WXGA+', desc: t.resMediumDesc || t.resMedium || 'Balanced' },
    { id: '1600x900', title: '1600 × 900', tag: t.tagRecommended || 'Recommended', desc: t.res900pDesc || t.res900p || 'Default Sharp HD+' },
    { id: '1920x1080', title: '1920 × 1080', tag: 'Full HD', desc: t.res1080pDesc || t.res1080p || 'Spacious Big Screen' },
  ];

  const handleSelectResolution = async (res: WindowResolution) => {
    const updated = { ...formData, windowResolution: res };
    setFormData(updated);
    onSaveSettings(updated);

    if (isTauri()) {
      try {
        const [w, h] = res.split('x').map(Number);
        await invokeCommand('set_window_size', { width: w, height: h });
      } catch (err) {
        console.warn('Failed to resize window:', err);
      }
    }
  };

  // 3. Reduce Motion / Performance Mode
  const handleToggleReduceMotion = () => {
    const updated = { ...formData, reduceMotion: !formData.reduceMotion };
    setFormData(updated);
    onSaveSettings(updated);
  };

  const handleToggleDiscordRpc = () => {
    const updated = { ...formData, enableDiscordRpc: !formData.enableDiscordRpc };
    setFormData(updated);
    onSaveSettings(updated);
  };

  // 4. Languages
  const languagesList: { code: Language; name: string; nativeName: string; flag: string }[] = [
    { code: 'vi', name: t.langVi || 'Tiếng Việt', nativeName: 'Tiếng Việt', flag: '🇻🇳' },
    { code: 'en', name: t.langEn || 'English', nativeName: 'English (US)', flag: '🇺🇸' },
    { code: 'zh', name: t.langZh || 'Chinese', nativeName: '简体中文', flag: '🇨🇳' },
    { code: 'ja', name: t.langJa || 'Japanese', nativeName: '日本語', flag: '🇯🇵' },
    { code: 'ko', name: t.langKo || 'Korean', nativeName: '한국어', flag: '🇰🇷' },
    { code: 'de', name: t.langDe || 'German', nativeName: 'Deutsch', flag: '🇩🇪' },
    { code: 'fr', name: t.langFr || 'French', nativeName: 'Français', flag: '🇫🇷' },
    { code: 'es', name: t.langEs || 'Spanish', nativeName: 'Español', flag: '🇪🇸' },
  ];

  const handleSelectLanguage = (langCode: Language) => {
    onChangeLanguage(langCode);
  };

  return (
    <div className="flex-1 flex flex-col overflow-y-auto p-10 space-y-7 custom-scrollbar">
      {/* Top Header - Unified across all menus for seamless tab switching */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pr-12">
        <div>
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[var(--accent-color)]/10 border border-[var(--accent-color)]/20 text-[var(--accent-color)] text-xs font-semibold mb-2 tracking-wide">
            <Settings className="w-4 h-4" />
            <span>{t.badgeSettings || 'Launcher Settings'}</span>
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-normal">{t.settingsTitle}</h1>
          <p className="text-base text-slate-300 mt-1 tracking-wide">{t.settingsSub}</p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={handleSave}
            className="btn-primary h-11 px-6 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 shadow-none hover:shadow-none tracking-wide shrink-0 cursor-pointer active:scale-95 transition-all"
          >
            {savedSuccess ? <Check className="w-4 h-4 text-emerald-300" /> : <Check className="w-4 h-4" />}
            <span>{savedSuccess ? t.saved : t.btnSave}</span>
          </button>
        </div>
      </div>

      {/* Centered Content Wrapper: All settings component boxes centered on the page */}
      <div className="max-w-3xl mx-auto w-full space-y-6 pb-12">

        {/* 1. Interface & Theme: Palette Selector */}
        <div className="glass-panel rounded-2xl p-6 border border-white/5 space-y-4">
          <div className="flex items-center gap-2.5">
            <Palette className="w-5 h-5 text-[var(--accent-color)] shrink-0" />
            <div>
              <h3 className="text-base font-bold text-white tracking-wide">{t.uiSection}</h3>
              <p className="text-xs text-slate-400 mt-0.5">{t.colorPalette}</p>
            </div>
          </div>

          {/* 6 Core Theme Colors Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-1">
            {palettes.map((p) => {
              const isSelected = (formData.colorPalette || 'amber') === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleSelectPalette(p.id)}
                  className={`p-3 rounded-xl border-2 text-left flex items-center justify-between gap-3 transition-all duration-150 cursor-pointer ${
                    isSelected
                      ? 'border-[var(--accent-color)] bg-[var(--accent-color)]/10 text-white font-bold -translate-y-0.5'
                      : 'border-white/5 bg-white/[0.02] text-slate-300 hover:border-white/20 hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className="w-6 h-6 rounded-full border border-white/20 shrink-0"
                      style={{
                        background: p.color,
                      }}
                    />
                    <div className="min-w-0">
                      <div className={`text-xs truncate ${isSelected ? 'text-white font-bold' : 'text-slate-200 font-semibold'}`}>
                        {p.name}
                      </div>
                      <div className="text-[10px] text-slate-400 truncate mt-0.5">{p.desc}</div>
                    </div>
                  </div>

                  {isSelected && (
                    <div className="w-5 h-5 rounded-full bg-[var(--accent-color)]/20 border border-[var(--accent-color)] flex items-center justify-center shrink-0">
                      <Check className="w-3 h-3 text-[var(--accent-color)]" strokeWidth={3} />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* 2. Window Size / Resolution */}
        <div className="glass-panel rounded-2xl p-6 border border-white/5 space-y-4">
          <div className="flex items-center gap-2.5">
            <Monitor className="w-5 h-5 text-[var(--accent-color)] shrink-0" />
            <div>
              <h3 className="text-base font-bold text-white tracking-wide">{t.windowSizeSection}</h3>
              <p className="text-xs text-slate-400 mt-0.5">{t.windowSizeDesc}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
            {resolutions.map((res) => {
              const isSelected = (formData.windowResolution || '1600x900') === res.id;
              return (
                <button
                  key={res.id}
                  type="button"
                  onClick={() => handleSelectResolution(res.id)}
                  className={`p-3.5 rounded-xl border-2 text-left flex flex-col justify-between gap-2 transition-all duration-150 cursor-pointer ${
                    isSelected
                      ? 'border-[var(--accent-color)] bg-[var(--accent-color)]/10 text-white font-bold shadow-lg shadow-black/40 -translate-y-0.5'
                      : 'border-white/5 bg-white/[0.02] text-slate-300 hover:border-white/20 hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                        isSelected
                          ? 'bg-[var(--accent-color)]/20 border-[var(--accent-color)] text-[var(--accent-color)]'
                          : 'bg-white/5 border-white/10 text-slate-400'
                      }`}
                    >
                      {res.tag}
                    </span>
                    {isSelected && <Check className="w-3.5 h-3.5 text-[var(--accent-color)]" strokeWidth={3} />}
                  </div>

                  <div>
                    <div className="text-xs font-bold text-white tracking-tight">{res.title}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5 line-clamp-1">{res.desc}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 3. Performance Mode (Reduce Motion & Blur) */}
        <div className="glass-panel rounded-2xl p-5 border border-white/5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <Zap className="w-5 h-5 text-[var(--accent-color)] shrink-0" />
              <div>
                <h3 className="text-base font-bold text-white tracking-wide">{t.reduceMotionTitle}</h3>
                <p className="text-xs text-slate-400 mt-0.5">{t.reduceMotionDesc}</p>
              </div>
            </div>

            {/* Switch button */}
            <button
              type="button"
              onClick={handleToggleReduceMotion}
              className={`w-12 h-6 rounded-full transition-colors duration-200 relative p-0.5 shrink-0 cursor-pointer ${
                formData.reduceMotion ? 'bg-[var(--accent-color)] shadow-md shadow-[var(--accent-color)]/30' : 'bg-white/15'
              }`}
            >
              <div
                className={`w-5 h-5 rounded-full bg-white shadow-md transform transition-transform duration-200 ${
                  formData.reduceMotion ? 'translate-x-6' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>

        {/* 4. Application Language: 8 Languages */}
        <div className="glass-panel rounded-2xl p-6 border border-white/5 space-y-4">
          <div className="flex items-center gap-2.5">
            <Globe className="w-5 h-5 text-[var(--accent-color)] shrink-0" />
            <div>
              <h3 className="text-base font-bold text-white tracking-wide">{t.languageSection}</h3>
              <p className="text-xs text-slate-400 mt-0.5">{t.languageDesc}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
            {languagesList.map((lang) => {
              const isSelected = language === lang.code;
              return (
                <button
                  key={lang.code}
                  type="button"
                  onClick={() => handleSelectLanguage(lang.code)}
                  className={`p-3 rounded-xl border-2 text-left flex items-center justify-between gap-2 transition-all duration-150 cursor-pointer ${
                    isSelected
                      ? 'border-[var(--accent-color)] bg-[var(--accent-color)]/10 text-white font-bold shadow-md shadow-black/30 -translate-y-0.5'
                      : 'border-white/5 bg-white/[0.02] text-slate-300 hover:border-white/20 hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-base leading-none select-none">{lang.flag}</span>
                    <div className="min-w-0">
                      <div className={`text-xs truncate ${isSelected ? 'text-white font-bold' : 'text-slate-200 font-semibold'}`}>
                        {lang.nativeName}
                      </div>
                      <div className="text-[10px] text-slate-400 truncate">{lang.name}</div>
                    </div>
                  </div>

                  {isSelected && (
                    <Check className="w-3.5 h-3.5 text-[var(--accent-color)] shrink-0" strokeWidth={3} />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* 5. Java Runtime */}
        <div className="glass-panel rounded-2xl p-5 border border-white/5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Cpu className="w-5 h-5 text-[var(--accent-color)] shrink-0" />
              <div>
                <h3 className="text-base font-bold text-white tracking-wide">{t.javaSection}</h3>
                <p className="text-xs text-slate-400 mt-0.5">{t.javaDesc}</p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleDetectJava}
              disabled={detectingJava}
              className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-slate-300 flex items-center gap-1.5 transition cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${detectingJava ? 'animate-spin' : ''}`} />
              <span>{t.btnRescan}</span>
            </button>
          </div>

          <select
            value={formData.defaultJavaPath || ''}
            onChange={(e) => {
              const updated = { ...formData, defaultJavaPath: e.target.value };
              setFormData(updated);
              onSaveSettings(updated);
            }}
            className="w-full glass-input px-3.5 py-2.5 rounded-xl text-xs text-white cursor-pointer"
          >
            {javaList.map((j) => (
              <option key={j.path} value={j.path} className="bg-slate-900 text-white font-sans">
                {j.versionString} - {j.path}
              </option>
            ))}
          </select>
        </div>

        {/* 6. Memory Allocation */}
        <div className="glass-panel rounded-2xl p-5 border border-white/5 space-y-3">
          <div className="flex items-center gap-2.5">
            <HardDrive className="w-5 h-5 text-[var(--accent-color)] shrink-0" />
            <div>
              <h3 className="text-base font-bold text-white tracking-wide">{t.ramSection}</h3>
              <p className="text-xs text-slate-400 mt-0.5">{t.ramDesc}</p>
            </div>
          </div>

          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 font-semibold">RAM:</span>
              <span className="text-[var(--accent-color)] font-mono font-bold text-sm">
                {formData.defaultMaxRam / 1024} GB
              </span>
            </div>
            {(() => {
              const ramPct = Math.round(((formData.defaultMaxRam - 2048) / (16384 - 2048)) * 100);
              return (
                <input
                  type="range"
                  min="2048"
                  max="16384"
                  step="1024"
                  value={formData.defaultMaxRam}
                  style={{
                    background: `linear-gradient(to right, var(--accent-color, #10b981) ${ramPct}%, rgba(255,255,255,0.08) ${ramPct}%)`,
                  }}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    const updated = { ...formData, defaultMaxRam: val };
                    setFormData(updated);
                    onSaveSettings(updated);
                  }}
                  className="w-full cursor-pointer"
                />
              );
            })()}
            <div className="flex justify-between text-[10px] text-slate-500 font-mono mt-1">
              <span>2 GB</span>
              <span>4 GB</span>
              <span>8 GB</span>
              <span>16 GB</span>
            </div>
          </div>
        </div>

        {/* 7. Default Server Host */}
        <div className="glass-panel rounded-2xl p-5 border border-white/5 space-y-3">
          <div className="flex items-center gap-2.5">
            <Server className="w-5 h-5 text-[var(--accent-color)] shrink-0" />
            <div>
              <h3 className="text-base font-bold text-white tracking-wide">{t.serverSection}</h3>
              <p className="text-xs text-slate-400 mt-0.5">{t.serverDesc}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-[11px] text-slate-400 mb-1">IP Host</label>
              <input
                type="text"
                value={formData.serverHost}
                onChange={(e) => setFormData({ ...formData, serverHost: e.target.value })}
                className="w-full glass-input px-3.5 py-2 rounded-xl text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Port</label>
              <input
                type="number"
                value={formData.serverPort}
                onChange={(e) => setFormData({ ...formData, serverPort: Number(e.target.value) })}
                className="w-full glass-input px-3.5 py-2 rounded-xl text-xs text-white"
              />
            </div>
          </div>
        </div>

        {/* 8. JVM Flags */}
        <div className="glass-panel rounded-2xl p-5 border border-white/5 space-y-3">
          <div className="flex items-center gap-2.5">
            <Terminal className="w-5 h-5 text-[var(--accent-color)] shrink-0" />
            <div>
              <h3 className="text-base font-bold text-white tracking-wide">{t.jvmSection}</h3>
              <p className="text-xs text-slate-400 mt-0.5">{t.jvmDesc}</p>
            </div>
          </div>
          <textarea
            rows={2}
            value={formData.defaultJvmArgs}
            onChange={(e) => setFormData({ ...formData, defaultJvmArgs: e.target.value })}
            className="w-full glass-input p-2.5 rounded-xl text-xs text-slate-300 resize-none"
          />
        </div>

        {/* 9. Storage & Cache Management */}
        <div className="glass-panel rounded-2xl p-5 border border-white/5 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <Trash2 className="w-5 h-5 text-[var(--accent-color)] shrink-0" />
              <div>
                <h3 className="text-base font-bold text-white tracking-wide">{t.storageSection}</h3>
                <p className="text-xs text-slate-400 mt-0.5">{t.storageDesc}</p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsCleanupModalOpen(true)}
              className="btn-primary py-2.5 px-5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 shadow-none hover:shadow-none cursor-pointer tracking-wide shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{t.btnCleanStorage}</span>
            </button>
          </div>
        </div>

        {/* 10. Discord Rich Presence */}
        <div className="glass-panel rounded-2xl p-5 border border-white/5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <Gamepad2 className="w-5 h-5 text-[var(--accent-color)] shrink-0" />
              <div>
                <h3 className="text-base font-bold text-white tracking-wide">
                  {t.discordRpcTitle || 'Discord Rich Presence'}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {t.discordRpcDesc ||
                    'Show the profile and version you are playing on your Discord status. Ignored when Discord is not running.'}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleToggleDiscordRpc}
              className={`w-12 h-6 rounded-full transition-colors duration-200 relative p-0.5 shrink-0 cursor-pointer ${
                formData.enableDiscordRpc ? 'bg-[var(--accent-color)] shadow-md shadow-[var(--accent-color)]/30' : 'bg-white/15'
              }`}
            >
              <div
                className={`w-5 h-5 rounded-full bg-white shadow-md transform transition-transform duration-200 ${
                  formData.enableDiscordRpc ? 'translate-x-6' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>

        {/* 11. CurseForge API Integration */}
        <div className="glass-panel rounded-2xl p-5 border border-white/5 space-y-3">
          <div className="flex items-center gap-2.5">
            <Key className="w-5 h-5 text-[var(--accent-color)] shrink-0" />
            <div>
              <h3 className="text-base font-bold text-white tracking-wide">{t.curseForgeSection}</h3>
              <p className="text-xs text-slate-400 mt-0.5">{t.curseForgeDesc}</p>
            </div>
          </div>
          <input
            type="password"
            value={formData.curseForgeApiKey || ''}
            onChange={(e) => setFormData({ ...formData, curseForgeApiKey: e.target.value })}
            placeholder={t.curseForgePlaceholder}
            className="w-full glass-input px-3.5 py-2.5 rounded-xl text-xs text-slate-300 focus:outline-none focus:border-[var(--accent-color)]"
          />
        </div>
      </div>

      {/* Storage Cleanup Modal */}
      <StorageCleanupModal
        isOpen={isCleanupModalOpen}
        onClose={() => setIsCleanupModalOpen(false)}
        language={language}
      />
    </div>
  );
};
