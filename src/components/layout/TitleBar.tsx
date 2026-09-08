import React, { useState, useEffect, useRef } from 'react';
import { Terminal, Languages, Check, ChevronDown } from 'lucide-react';
import { isTauri, invokeCommand } from '../../services/api';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getTranslation, type Language } from '../../locales/i18n';

interface TitleBarProps {
  onOpenConsole?: () => void;
  isRunning?: boolean;
  language: Language;
  onChangeLanguage: (lang: Language) => void;
}

const LANGUAGES: { code: Language; label: string; flag: string }[] = [
  { code: 'vi', label: 'Tiếng Việt', flag: '🇻🇳' },
  { code: 'en', label: 'English',    flag: '🇺🇸' },
  { code: 'zh', label: '中文',        flag: '🇨🇳' },
  { code: 'ja', label: '日本語',      flag: '🇯🇵' },
  { code: 'ko', label: '한국어',      flag: '🇰🇷' },
  { code: 'de', label: 'Deutsch',    flag: '🇩🇪' },
  { code: 'fr', label: 'Français',   flag: '🇫🇷' },
  { code: 'es', label: 'Español',    flag: '🇪🇸' },
];

export const TitleBar: React.FC<TitleBarProps> = ({
  onOpenConsole,
  isRunning = false,
  language,
  onChangeLanguage,
}) => {
  const [isMaximized, setIsMaximized] = useState(false);
  const [isLangOpen, setIsLangOpen] = useState(false);
  const t = getTranslation(language);
  const langDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isTauri()) return;
    const checkMaximized = async () => {
      try {
        const win = getCurrentWindow();
        setIsMaximized(await win.isMaximized());
        win.onResized(async () => {
          setIsMaximized(await win.isMaximized());
        });
      } catch (err) {
        console.warn('Window API error:', err);
      }
    };
    checkMaximized();
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (langDropdownRef.current && !langDropdownRef.current.contains(e.target as Node)) {
        setIsLangOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleMinimize = async () => {
    if (!isTauri()) return;
    try {
      await invokeCommand('app_minimize');
    } catch {
      try {
        await getCurrentWindow().minimize();
      } catch {}
    }
  };

  const handleToggleMaximize = async () => {
    if (!isTauri()) return;
    try {
      await getCurrentWindow().toggleMaximize();
    } catch {}
  };

  const handleClose = async () => {
    if (!isTauri()) return;
    try {
      await invokeCommand('app_close');
    } catch {
      try {
        await getCurrentWindow().close();
      } catch {}
    }
  };

  const currentLang = LANGUAGES.find((l) => l.code === language) ?? LANGUAGES[1];

  return (
    <header
      data-tauri-drag-region
      className="titlebar-drag-region h-[30px] bg-transparent flex items-center justify-between pl-4 pr-0 select-none z-50 shrink-0"
    >
      {/* Left side of canvas header */}
      <div className="flex items-center gap-2 titlebar-no-drag" />

      {/* Center Drag Area */}
      <div data-tauri-drag-region className="flex-1 h-full" />

      {/* Right Controls */}
      <div className="flex items-center h-full titlebar-no-drag">
        {/* Utility buttons */}
        <div className="flex items-center gap-1 pr-2">
          {/* Language Dropdown */}
          <div ref={langDropdownRef} className="relative">
            <button
              type="button"
              onClick={() => setIsLangOpen((prev) => !prev)}
              className={`px-1.5 py-0.5 rounded text-[11px] font-bold flex items-center gap-1 transition tracking-wider cursor-pointer h-5 ${
                isLangOpen
                  ? 'text-[#dbdee1] bg-white/10'
                  : 'text-[#949ba4] hover:text-[#dbdee1] hover:bg-white/10'
              }`}
              title="Change Language"
            >
              <Languages className="w-3 h-3 text-amber-400" />
              <span className="text-[10px]">{currentLang.flag}</span>
              <span>{currentLang.code.toUpperCase()}</span>
              <ChevronDown
                className={`w-2.5 h-2.5 opacity-60 transition-transform duration-200 ${isLangOpen ? 'rotate-180' : ''}`}
              />
            </button>

            {/* Dropdown panel */}
            {isLangOpen && (
              <div
                className="absolute right-0 top-full mt-1.5 w-44 rounded-xl bg-[#141416]/95 backdrop-blur-xl border border-white/10 shadow-2xl p-1 z-[200] space-y-0.5"
                style={{
                  animation: 'fadeInDown 0.12s ease both',
                }}
              >
                {LANGUAGES.map((lang) => {
                  const isActive = lang.code === language;
                  return (
                    <button
                      key={lang.code}
                      type="button"
                      onClick={() => {
                        onChangeLanguage(lang.code);
                        setIsLangOpen(false);
                      }}
                      className={`w-full px-2.5 py-1.5 text-left text-xs rounded-lg flex items-center justify-between gap-2 transition cursor-pointer ${
                        isActive
                          ? 'bg-amber-500/15 text-amber-300 font-bold'
                          : 'text-slate-300 hover:bg-white/5 hover:text-white'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm leading-none">{lang.flag}</span>
                        <span className="truncate">{lang.label}</span>
                      </div>
                      {isActive && <Check className="w-3 h-3 text-amber-400 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Logs */}
          {onOpenConsole && (
            <button
              onClick={onOpenConsole}
              title={t.viewLogs}
              className="px-1.5 py-0.5 rounded text-[11px] font-semibold text-[#949ba4] hover:text-[#dbdee1] hover:bg-white/10 flex items-center gap-1 transition tracking-wide cursor-pointer h-5"
            >
              <Terminal className="w-3 h-3 text-amber-400" />
              <span>{t.viewLogs}</span>
            </button>
          )}

          <div className="w-px h-3 bg-white/10 mx-0.5" />
        </div>

        {/* Window controls: Discord sleek style */}
        <div className="flex items-center h-full">
          <button
            onClick={handleMinimize}
            className="w-10 h-full flex items-center justify-center text-[#949ba4] hover:text-[#dbdee1] hover:bg-white/10 active:bg-white/20 transition-colors duration-100 cursor-pointer"
            title={t.minimize}
          >
            <svg aria-hidden="true" role="img" width="11" height="11" viewBox="0 0 11 11" fill="none">
              <path d="M0.5 9.5H10.5" stroke="currentColor" strokeWidth={1.25} strokeLinecap="round" />
            </svg>
          </button>

          <button
            onClick={handleClose}
            className="w-10 h-full flex items-center justify-center text-[#949ba4] hover:text-white hover:bg-[#da373c] active:bg-[#a1282c] transition-colors duration-100 cursor-pointer"
            title={t.close}
          >
            <svg aria-hidden="true" role="img" width="11" height="11" viewBox="0 0 11 11" fill="none">
              <path d="M1 1L10 10M10 1L1 10" stroke="currentColor" strokeWidth={1.25} strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* Dropdown fade-in animation */}
      <style>{`
        @keyframes fadeInDown {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </header>
  );
};
