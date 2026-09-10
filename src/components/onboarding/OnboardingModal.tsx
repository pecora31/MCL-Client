import React, { useState, useEffect } from 'react';
import { HardDrive, FolderOpen, Check, Cpu, Globe, ArrowRight, RefreshCw, Layers } from 'lucide-react';
import type { JavaInstallation, LauncherSettings } from '../../types';
import { invokeCommand } from '../../services/api';
import { getTranslation, type Language } from '../../locales/i18n';

interface OnboardingModalProps {
  isOpen: boolean;
  onComplete: (updatedSettings: Partial<LauncherSettings>) => void;
  currentLanguage: Language;
  onLanguageChange: (lang: Language) => void;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({
  isOpen,
  onComplete,
  currentLanguage,
  onLanguageChange,
}) => {
  const t = getTranslation(currentLanguage);

  const [gameDataDir, setGameDataDir] = useState<string>('');
  const [javaList, setJavaList] = useState<JavaInstallation[]>([]);
  const [detectingJava, setDetectingJava] = useState(false);
  const [isBrowsing, setIsBrowsing] = useState(false);

  useEffect(() => {
    if (isOpen) {
      // Load current default data directory
      invokeCommand<string>('get_game_data_dir')
        .then((dir) => {
          if (dir) setGameDataDir(dir);
        })
        .catch(console.warn);

      // Detect Java
      handleDetectJava();
    }
  }, [isOpen]);

  const handleDetectJava = async () => {
    setDetectingJava(true);
    try {
      const list = await invokeCommand<JavaInstallation[]>('detect_java');
      setJavaList(list || []);
    } catch {
      // ignore fallback
    } finally {
      setDetectingJava(false);
    }
  };

  // Each profile picks the Java its Minecraft version needs, so this step only reports what
  // is installed; the major versions are enough to tell whether that will work.
  const javaMajors = [...new Set(javaList.map((j) => j.majorVersion))].sort((a, b) => b - a);

  const handleBrowseFolder = async () => {
    try {
      setIsBrowsing(true);
      const chosen = await invokeCommand<string | null>('select_folder', {
        defaultPath: gameDataDir || undefined,
      });
      if (chosen) {
        setGameDataDir(chosen);
      }
    } catch (err) {
      console.error('Failed to browse folder:', err);
    } finally {
      setIsBrowsing(false);
    }
  };

  const handleFinish = async () => {
    if (gameDataDir) {
      try {
        await invokeCommand('set_game_data_dir', { path: gameDataDir });
      } catch (err) {
        console.error('Failed to set game data dir:', err);
      }
    }

    onComplete({
      gameDataDir,
      hasCompletedOnboarding: true,
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-lg animate-fadeIn">
      <div
        className="glass-panel w-full max-w-2xl rounded-3xl border border-amber-500/20 shadow-2xl overflow-hidden animate-scaleUp flex flex-col max-h-[90vh]"
        style={{ fontFamily: "'Plus Jakarta Sans', 'Inter', sans-serif" }}
      >
        {/* Header */}
        <div className="p-7 border-b border-white/5 bg-amber-500/[0.02] flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shrink-0 shadow-lg">
            <Layers className="w-7 h-7" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-white tracking-wide">{t.onboardingTitle}</h2>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">{t.onboardingSub}</p>
          </div>
        </div>

        {/* Wizard Steps */}
        <div className="p-7 space-y-6 overflow-y-auto custom-scrollbar flex-1">
          {/* Step 1: Language */}
          <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
              <Globe className="w-4 h-4 text-amber-400" />
              <span>{t.onboardingStepLang}</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => onLanguageChange('vi')}
                className={`py-3 px-4 rounded-xl border text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer ${
                  currentLanguage === 'vi'
                    ? 'bg-amber-500/20 border-amber-500 text-white shadow-sm ring-1 ring-amber-500/40'
                    : 'bg-black/30 border-white/5 text-slate-400 hover:border-white/20'
                }`}
              >
                <span className="text-base">🇻🇳</span>
                <span>Tiếng Việt</span>
              </button>

              <button
                type="button"
                onClick={() => onLanguageChange('en')}
                className={`py-3 px-4 rounded-xl border text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer ${
                  currentLanguage === 'en'
                    ? 'bg-amber-500/20 border-amber-500 text-white shadow-sm ring-1 ring-amber-500/40'
                    : 'bg-black/30 border-white/5 text-slate-400 hover:border-white/20'
                }`}
              >
                <span className="text-base">🇺🇸</span>
                <span>English</span>
              </button>
            </div>
          </div>

          {/* Step 2: Default Game Directory */}
          <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
                <HardDrive className="w-4 h-4 text-amber-400" />
                <span>{t.onboardingStepDir}</span>
              </div>
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">{t.onboardingDirDesc}</p>

            <div className="flex items-center gap-2">
              <div className="flex-1 px-3.5 py-2.5 rounded-xl bg-black/40 border border-white/10 text-xs font-medium text-slate-200 truncate">
                {gameDataDir || (currentLanguage === 'vi' ? 'Đang tải đường dẫn mặc định...' : 'Loading default path...')}
              </div>

              <button
                type="button"
                onClick={handleBrowseFolder}
                disabled={isBrowsing}
                className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10 text-xs font-bold text-white flex items-center gap-1.5 transition cursor-pointer shrink-0"
              >
                <FolderOpen className="w-4 h-4 text-amber-400" />
                <span>{t.btnBrowse}</span>
              </button>
            </div>
          </div>

          {/* Step 3: Java Environment */}
          <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
                <Cpu className="w-4 h-4 text-amber-400" />
                <span>{t.onboardingStepJava}</span>
              </div>

              <button
                type="button"
                onClick={handleDetectJava}
                disabled={detectingJava}
                className="text-[11px] text-slate-400 hover:text-white flex items-center gap-1 transition"
              >
                <RefreshCw className={`w-3 h-3 ${detectingJava ? 'animate-spin' : ''}`} />
                <span>{currentLanguage === 'vi' ? 'Quét lại' : 'Rescan'}</span>
              </button>
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">{t.onboardingJavaDesc}</p>

            {detectingJava ? (
              <div className="p-3 rounded-xl bg-black/30 text-xs text-slate-400 flex items-center gap-2">
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-400" />
                <span>{currentLanguage === 'vi' ? 'Đang quét môi trường Java trên hệ thống...' : 'Scanning Java runtime on system...'}</span>
              </div>
            ) : javaList.length > 0 ? (
              <div className="p-3 rounded-xl bg-black/30 text-xs text-slate-300 flex flex-wrap items-center gap-2">
                <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                {javaMajors.map((major) => (
                  <span key={major} className="px-2 py-0.5 rounded-md bg-white/10 font-semibold text-white">
                    Java {major}
                  </span>
                ))}
                <span className="text-slate-400">
                  {currentLanguage === 'vi'
                    ? 'Mỗi profile tự dùng đúng bản nó cần.'
                    : 'Each profile uses the version it needs.'}
                </span>
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300">
                {currentLanguage === 'vi'
                  ? 'Chưa tìm thấy Java nào trên máy. Không sao — khi chơi, launcher sẽ tự tải bản Java cần thiết.'
                  : "No Java found on this computer yet. That's fine — when you play, the launcher downloads the Java it needs."}
              </div>
            )}
          </div>
        </div>

        {/* Footer Action */}
        <div className="p-6 border-t border-white/5 flex items-center justify-end bg-white/[0.01]">
          <button
            type="button"
            onClick={handleFinish}
            className="btn-primary py-3 px-8 rounded-2xl font-bold text-sm flex items-center gap-2 shadow-xl cursor-pointer tracking-wider"
          >
            <span>{t.btnGetStarted}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
