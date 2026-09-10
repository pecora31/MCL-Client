import React, { useState, useEffect } from 'react';
import {
  Settings,
  HardDrive,
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
  Download,
  Play,
  LifeBuoy,
  ShieldCheck,
  Share2,
  ChevronDown,
  Coffee,
} from 'lucide-react';
import type {
  LauncherSettings,
  ColorPalette,
  WindowResolution,
  SystemInfo,
  LaunchBehavior,
} from '../../types';
import { invokeCommand, isTauri } from '../../services/api';
import { resetLauncherData } from '../../services/localData';
import type { AppUpdateState } from '../../hooks/useAppUpdate';
import { getTranslation, type Language } from '../../locales/i18n';
import { StorageCleanupModal } from './StorageCleanupModal';
import { SmoothRange } from '../common/SmoothRange';

const PRIVACY_URL = 'https://github.com/pecora31/MCL-Client/blob/main/PRIVACY.md';

interface SettingsViewProps {
  settings: LauncherSettings;
  onSaveSettings: (settings: LauncherSettings) => void;
  language: Language;
  onChangeLanguage: (lang: Language) => void;
  appUpdate: AppUpdateState;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  onSaveSettings,
  language,
  onChangeLanguage,
  appUpdate,
}) => {
  const t = getTranslation(language);
  const [formData, setFormData] = useState<LauncherSettings>(settings);
  const [isCleanupModalOpen, setIsCleanupModalOpen] = useState(false);
  // Read straight from the running binary's own version, same as the home screen badge,
  // so this label never drifts from what a release actually bumps.
  const [appVersion, setAppVersion] = useState('');
  useEffect(() => {
    if (!isTauri()) return;
    import('@tauri-apps/api/app')
      .then(({ getVersion }) => getVersion())
      .then(setAppVersion)
      .catch((err) => console.warn('Could not read the app version:', err));
  }, []);

  useEffect(() => {
    setFormData(settings);
  }, [settings]);

  // A default applied to every new profile should never overcommit the machine, so it tops
  // out at what the computer can comfortably spare rather than a fixed 16 GB.
  const [ramCeilingMb, setRamCeilingMb] = useState(16384);
  useEffect(() => {
    invokeCommand<SystemInfo>('get_system_info')
      .then((info) => setRamCeilingMb(Math.max(2048, Math.floor(info.recommendedMaxRamMb / 1024) * 1024)))
      .catch((err) => console.warn('Could not read system info:', err));
  }, []);

  // Every other control saves the moment it is clicked; text fields save once typing pauses,
  // so nothing here depends on remembering a separate Save button before leaving the page.
  useEffect(() => {
    if (
      formData.defaultJvmArgs === settings.defaultJvmArgs &&
      formData.curseForgeApiKey === settings.curseForgeApiKey
    ) {
      return;
    }
    const timer = setTimeout(() => onSaveSettings(formData), 500);
    return () => clearTimeout(timer);
  }, [formData.defaultJvmArgs, formData.curseForgeApiKey]);

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

  const launchBehaviors: { id: LaunchBehavior; label: string }[] = [
    { id: 'keep', label: t.launchKeep || 'Keep open' },
    { id: 'minimize', label: t.launchMinimize || 'Minimize' },
    { id: 'hide', label: t.launchHide || 'Hide until it closes' },
  ];

  const handleSelectLaunchBehavior = (behavior: LaunchBehavior) => {
    const updated = { ...formData, launchBehavior: behavior };
    setFormData(updated);
    onSaveSettings(updated);
  };

  const [confirmingReset, setConfirmingReset] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleToggleAutoDownloadJava = () => {
    const updated = { ...formData, autoDownloadJava: !formData.autoDownloadJava };
    setFormData(updated);
    onSaveSettings(updated);
  };

  const handleToggleShareSkin = () => {
    const updated = { ...formData, shareSkin: !formData.shareSkin };
    setFormData(updated);
    onSaveSettings(updated);
  };

  const handleToggleAutoUpdate = () => {
    const updated = { ...formData, autoUpdate: !formData.autoUpdate };
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
      </div>

      {/* Centered Content Wrapper: All settings component boxes centered on the page */}
      <div className="max-w-3xl mx-auto w-full space-y-8 pb-12">

        <section className="space-y-4">
          <h2 className="px-1 pt-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">{t.settingsGroupAppearance || 'Appearance'}</h2>

          {/* Accent colour */}
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

          {/* Launcher window size */}
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

          {/* Reduce motion */}
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

          {/* Language */}
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
        </section>

        <section className="space-y-4">
          <h2 className="px-1 pt-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">{t.settingsGroupGameplay || 'Playing'}</h2>

          {/* What the launcher does while the game runs */}
          <div className="glass-panel rounded-2xl p-5 border border-white/5 space-y-4">
            <div className="flex items-center gap-2.5">
              <Play className="w-5 h-5 text-[var(--accent-color)] shrink-0" />
              <div>
                <h3 className="text-base font-bold text-white tracking-wide">
                  {t.launchBehaviorTitle || 'When the game starts'}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {t.launchBehaviorDesc || 'The launcher comes back on its own when the game closes or crashes.'}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {launchBehaviors.map((option) => {
                const isSelected = (formData.launchBehavior || 'keep') === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => handleSelectLaunchBehavior(option.id)}
                    className={`py-2.5 px-3 rounded-xl border-2 text-xs font-semibold transition-all duration-150 cursor-pointer ${
                      isSelected
                        ? 'border-[var(--accent-color)] bg-[var(--accent-color)]/10 text-white font-bold'
                        : 'border-white/5 bg-white/[0.02] text-slate-300 hover:border-white/20 hover:bg-white/[0.04]'
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Default RAM for new profiles */}
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
              <SmoothRange
                min={2048}
                max={ramCeilingMb}
                step={1024}
                value={formData.defaultMaxRam}
                onChange={(val) => {
                  const updated = { ...formData, defaultMaxRam: val };
                  setFormData(updated);
                  onSaveSettings(updated);
                }}
              />
              <div className="flex justify-between text-[10px] text-slate-500 font-mono mt-1">
                <span>2 GB</span>
                <span>{ramCeilingMb / 1024} GB</span>
              </div>
            </div>
          </div>

          {/* Missing Java */}
          <div className="glass-panel rounded-2xl p-5 border border-white/5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-2.5">
                <Coffee className="w-5 h-5 text-[var(--accent-color)] shrink-0" />
                <div>
                  <h3 className="text-base font-bold text-white tracking-wide">
                    {t.autoDownloadJavaTitle || 'Download missing Java automatically'}
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {t.autoDownloadJavaDesc ||
                      "When this computer doesn't have the Java a Minecraft version needs, the launcher downloads Eclipse Temurin into its own folder (about 40–55 MB). Turn it off to be told which version to install instead."}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleToggleAutoDownloadJava}
                className={`w-12 h-6 rounded-full transition-colors duration-200 relative p-0.5 shrink-0 cursor-pointer ${
                  formData.autoDownloadJava ? 'bg-[var(--accent-color)] shadow-md shadow-[var(--accent-color)]/30' : 'bg-white/15'
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full bg-white shadow-md transform transition-transform duration-200 ${
                    formData.autoDownloadJava ? 'translate-x-6' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Skin sharing */}
          <div className="glass-panel rounded-2xl p-5 border border-white/5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-2.5">
                <Share2 className="w-5 h-5 text-[var(--accent-color)] shrink-0" />
                <div>
                  <h3 className="text-base font-bold text-white tracking-wide">
                    {t.shareSkinTitle || 'Share my skin with other players'}
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {t.shareSkinDesc ||
                      'Other MCL players see your skin in game. Turn it off to keep it to yourself — the copy shared earlier is removed the next time you play.'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleToggleShareSkin}
                className={`w-12 h-6 rounded-full transition-colors duration-200 relative p-0.5 shrink-0 cursor-pointer ${
                  formData.shareSkin ? 'bg-[var(--accent-color)] shadow-md shadow-[var(--accent-color)]/30' : 'bg-white/15'
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full bg-white shadow-md transform transition-transform duration-200 ${
                    formData.shareSkin ? 'translate-x-6' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Discord Rich Presence */}
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
        </section>

        <section className="space-y-4">
          <h2 className="px-1 pt-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">{t.settingsGroupSystem || 'System'}</h2>

          {/* Storage cleanup */}
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

          {/* Updates */}
          <div className="glass-panel rounded-2xl p-5 border border-white/5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-2.5">
                <Download className="w-5 h-5 text-[var(--accent-color)] shrink-0" />
                <div>
                  <h3 className="text-base font-bold text-white tracking-wide">
                    {t.updatesTitle || 'Updates'}
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {(t.updatesDesc || "You're running v{version}.").replace('{version}', appVersion || '…')}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => appUpdate.checkForUpdate()}
                disabled={appUpdate.phase === 'checking' || appUpdate.phase === 'downloading'}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-white/10 hover:bg-white/20 border border-white/10 text-white transition flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              >
                {appUpdate.phase === 'checking' ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                <span>{t.updateCheckNow || 'Check for Updates'}</span>
              </button>
            </div>

            {appUpdate.phase !== 'idle' && appUpdate.phase !== 'checking' && (
              <div
                className={`flex items-center gap-2 text-xs px-3 py-2 rounded-xl border ${
                  appUpdate.phase === 'failed'
                    ? 'bg-rose-500/10 border-rose-500/25 text-rose-300'
                    : appUpdate.phase === 'up-to-date'
                    ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300'
                    : 'bg-[var(--accent-color)]/10 border-[var(--accent-color)]/25 text-[var(--accent-light)]'
                }`}
              >
                {appUpdate.phase === 'up-to-date' && <Check className="w-3.5 h-3.5 shrink-0" />}
                <span>
                  {appUpdate.phase === 'up-to-date'
                    ? t.updateUpToDate || "You're on the latest version."
                    : appUpdate.phase === 'failed'
                    ? appUpdate.error
                    : appUpdate.phase === 'available'
                    ? `${t.updateAvailable || 'Update available'} · v${appUpdate.version}`
                    : appUpdate.phase === 'downloading'
                    ? `${t.updateDownloading || 'Downloading'}… ${appUpdate.percent}%`
                    : t.updateInstalled || 'Update installed'}
                </span>
              </div>
            )}

            <div className="flex items-center justify-between pt-3 border-t border-white/[0.06]">
              <div>
                <div className="text-xs font-semibold text-slate-200">
                  {t.autoUpdateTitle || 'Automatically install updates'}
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  {t.autoUpdateDesc ||
                    'Installs a new version as soon as it is found, as long as nothing is downloading or running.'}
                </div>
              </div>
              <button
                type="button"
                onClick={handleToggleAutoUpdate}
                className={`w-12 h-6 rounded-full transition-colors duration-200 relative p-0.5 shrink-0 cursor-pointer ${
                  formData.autoUpdate ? 'bg-[var(--accent-color)] shadow-md shadow-[var(--accent-color)]/30' : 'bg-white/15'
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full bg-white shadow-md transform transition-transform duration-200 ${
                    formData.autoUpdate ? 'translate-x-6' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <button
            type="button"
            onClick={() => setShowAdvanced((open) => !open)}
            aria-expanded={showAdvanced}
            className="w-full px-1 pt-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400 flex items-center justify-between hover:text-white transition-colors cursor-pointer"
          >
            <span>{t.settingsGroupAdvanced || 'Advanced'}</span>
            <ChevronDown className={`w-4 h-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
          </button>
          {/* Collapsed by default: none of this is needed to play, and a wrong JVM flag stops the game from starting */}
          {showAdvanced && (
            <div className="space-y-4">
              {/* JVM flags for new profiles */}
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

              {/* CurseForge API key */}
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

              {/* Privacy */}
              <div className="glass-panel rounded-2xl p-5 border border-white/5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-2.5">
                    <ShieldCheck className="w-5 h-5 text-[var(--accent-color)] shrink-0" />
                    <div>
                      <h3 className="text-base font-bold text-white tracking-wide">{t.privacyTitle || 'Privacy'}</h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {t.privacyDesc ||
                          'No accounts, no analytics, no ads. See every place the launcher connects to and what it sends.'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      isTauri()
                        ? invokeCommand('open_external_url', { url: PRIVACY_URL }).catch((err) =>
                            console.warn('Could not open the privacy page:', err)
                          )
                        : window.open(PRIVACY_URL, '_blank')
                    }
                    className="py-2.5 px-4 rounded-xl text-xs font-bold border border-white/10 bg-white/5 hover:bg-white/10 text-slate-200 transition cursor-pointer shrink-0"
                  >
                    {t.privacyBtn || 'Read the details'}
                  </button>
                </div>
              </div>

              {/* Troubleshooting */}
              <div className="glass-panel rounded-2xl p-5 border border-white/5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-2.5">
                    <LifeBuoy className="w-5 h-5 text-[var(--accent-color)] shrink-0" />
                    <div>
                      <h3 className="text-base font-bold text-white tracking-wide">
                        {t.supportTitle || 'Troubleshooting'}
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {t.resetDataDesc ||
                          'Clears the settings, servers, skins and account saved in the launcher, then restarts it. Profiles and downloaded game files stay.'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    // Two clicks, because this cannot be undone
                    onClick={() => (confirmingReset ? resetLauncherData() : setConfirmingReset(true))}
                    onBlur={() => setConfirmingReset(false)}
                    className={`py-2.5 px-4 rounded-xl text-xs font-bold border transition cursor-pointer shrink-0 ${
                      confirmingReset
                        ? 'bg-rose-500/25 border-rose-500/60 text-rose-200'
                        : 'bg-rose-500/10 hover:bg-rose-500/20 border-rose-500/30 text-rose-300'
                    }`}
                  >
                    {confirmingReset ? t.resetDataConfirm || 'Click again to erase' : t.resetDataBtn || 'Reset launcher data'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
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
