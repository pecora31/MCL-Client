import React, { useState, useMemo, useEffect } from 'react';
import { Monitor, AlertCircle, Check } from 'lucide-react';
import { CustomSelect, type SelectOption } from '../common/CustomSelect';
import { getTranslation, type Language } from '../../locales/i18n';

export interface WindowSizePreset {
  width: number;
  height: number;
  label: string;
  badge: string;
  description: string;
}

interface GameWindowSelectorProps {
  fullscreen: boolean;
  setFullscreen: (val: boolean) => void;
  windowWidth: string;
  setWindowWidth: (val: string) => void;
  windowHeight: string;
  setWindowHeight: (val: string) => void;
  language?: Language;
}

export const GameWindowSelector: React.FC<GameWindowSelectorProps> = ({
  fullscreen,
  setFullscreen,
  windowWidth,
  setWindowWidth,
  windowHeight,
  setWindowHeight,
  language = 'en',
}) => {
  const t = getTranslation(language);

  const presets = useMemo<WindowSizePreset[]>(
    () => [
      {
        width: 1280,
        height: 720,
        label: '1280 × 720 (HD)',
        badge: '16:9',
        description: t.resStandardHDDesc || 'Standard 720p window resolution',
      },
      {
        width: 1600,
        height: 900,
        label: '1600 × 900 (HD+)',
        badge: '16:9',
        description: t.resBalancedHDPlusDesc || 'Balanced 900p window resolution',
      },
      {
        width: 1920,
        height: 1080,
        label: '1920 × 1080 (Full HD)',
        badge: '16:9',
        description: t.resFullHDDesc || 'Sharp 1080p high definition display',
      },
      {
        width: 2560,
        height: 1440,
        label: '2560 × 1440 (2K QHD)',
        badge: '16:9',
        description: t.res2KQHDDesc || 'High definition 1440p resolution',
      },
      {
        width: 3840,
        height: 2160,
        label: '3840 × 2160 (4K UHD)',
        badge: '16:9',
        description: t.res4KUHDDesc || 'Ultra HD 4K resolution',
      },
    ],
    [t]
  );

  // Explicitly track whether the user chose custom resolution mode
  const [isCustomMode, setIsCustomMode] = useState<boolean>(() => {
    if (fullscreen || (!windowWidth && !windowHeight)) return false;
    return !presets.some(
      (p) => String(p.width) === windowWidth && String(p.height) === windowHeight
    );
  });

  const [confirmedNotice, setConfirmedNotice] = useState<string | null>(null);

  // Sync external props if needed
  useEffect(() => {
    if (fullscreen || (!windowWidth && !windowHeight)) {
      setIsCustomMode(false);
    } else {
      const isPreset = presets.some(
        (p) => String(p.width) === windowWidth && String(p.height) === windowHeight
      );
      if (!isPreset) {
        setIsCustomMode(true);
      }
    }
  }, [fullscreen, presets]);

  // Derive active value for CustomSelect
  const activeValue = useMemo(() => {
    if (isCustomMode) return 'custom';
    if (fullscreen) return 'fullscreen';
    if (!windowWidth && !windowHeight) return 'default';
    const isPreset = presets.some(
      (p) => String(p.width) === windowWidth && String(p.height) === windowHeight
    );
    if (isPreset) return `${windowWidth}x${windowHeight}`;
    return 'custom';
  }, [isCustomMode, fullscreen, windowWidth, windowHeight, presets]);

  const numW = parseInt(windowWidth, 10);
  const numH = parseInt(windowHeight, 10);
  const isWidthInvalid = !isNaN(numW) && (numW > 0 && numW < 640);
  const isHeightInvalid = !isNaN(numH) && (numH > 0 && numH < 480);
  const hasWarning = isWidthInvalid || isHeightInvalid;

  // Aspect Ratio calculation
  const aspectRatio = useMemo(() => {
    if (isNaN(numW) || isNaN(numH) || numW <= 0 || numH <= 0) return null;
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    const d = gcd(numW, numH);
    const rW = Math.round(numW / d);
    const rH = Math.round(numH / d);
    if ((rW === 16 && rH === 9) || (rW === 16 && rH === 10) || (rW === 4 && rH === 3) || (rW === 21 && rH === 9)) {
      return `${rW}:${rH}`;
    }
    const ratioVal = (numW / numH).toFixed(2);
    if (ratioVal === '1.78') return '16:9 (~1.78)';
    if (ratioVal === '1.60') return '16:10 (~1.60)';
    if (ratioVal === '1.33') return '4:3 (~1.33)';
    return `${ratioVal}:1`;
  }, [numW, numH]);

  const handleWindowModeChange = (value: string) => {
    setConfirmedNotice(null);
    if (value === 'default') {
      setIsCustomMode(false);
      setFullscreen(false);
      setWindowWidth('');
      setWindowHeight('');
    } else if (value === 'fullscreen') {
      setIsCustomMode(false);
      setFullscreen(true);
      setWindowWidth('');
      setWindowHeight('');
    } else if (value === 'custom') {
      setIsCustomMode(true);
      setFullscreen(false);
      if (!windowWidth) setWindowWidth('1280');
      if (!windowHeight) setWindowHeight('720');
    } else {
      setIsCustomMode(false);
      const [w, h] = value.split('x');
      setFullscreen(false);
      setWindowWidth(w || '1280');
      setWindowHeight(h || '720');
    }
  };

  // Button to confirm / apply and clamp custom size
  const handleConfirmCustom = () => {
    let finalW = isNaN(numW) || numW <= 0 ? 1280 : numW;
    let finalH = isNaN(numH) || numH <= 0 ? 720 : numH;

    if (finalW < 640) finalW = 640;
    if (finalH < 480) finalH = 480;

    setWindowWidth(String(finalW));
    setWindowHeight(String(finalH));
    setConfirmedNotice(`${finalW} × ${finalH}`);
    setTimeout(() => setConfirmedNotice(null), 2500);
  };

  const handleApplyMin = () => {
    setWindowWidth('640');
    setWindowHeight('480');
    setConfirmedNotice('640 × 480');
    setTimeout(() => setConfirmedNotice(null), 2500);
  };

  const windowModeOptions = useMemo<SelectOption<string>[]>(() => {
    return [
      {
        value: 'default',
        label: t.windowModeDefault || 'Let Minecraft decide',
        badge: 'Default',
        description: t.windowModeDefaultDesc || 'Standard window size managed by Minecraft (854 × 480)',
      },
      {
        value: 'fullscreen',
        label: t.windowModeFullscreen || 'Fullscreen Mode',
        badge: 'Immersive',
        description: t.windowModeFullscreenDesc || 'Launch the game in borderless / exclusive fullscreen',
      },
      ...presets.map((p) => ({
        value: `${p.width}x${p.height}`,
        label: p.label,
        badge: p.badge,
        description: p.description,
      })),
      {
        value: 'custom',
        label: t.windowModeCustom || 'Custom size…',
        badge: 'Custom',
        description: t.windowModeCustomDesc || 'Specify custom window width and height in pixels',
      },
    ];
  }, [t, presets]);

  return (
    <div className="space-y-2.5 p-4.5 rounded-xl bg-white/[0.02] border border-white/[0.06]">
      <div className="flex items-center justify-between">
        <div className="text-[13px] font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2.5">
          <Monitor className="w-4 h-4 text-[var(--accent-color)]" />
          <span>{t.gameWindowResolutionTitle || 'Game Window & Resolution'}</span>
        </div>
        {fullscreen ? (
          <span className="text-xs font-bold text-amber-300 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20">
            {t.windowModeFullscreen || 'Fullscreen'}
          </span>
        ) : isCustomMode ? (
          <span className="text-xs font-bold text-[var(--accent-light)] px-2.5 py-1 rounded-lg bg-[var(--accent-color)]/10 border border-[var(--accent-color)]/20">
            {(t.windowModeCustom || 'Custom')}: {windowWidth || '1280'} × {windowHeight || '720'}
          </span>
        ) : windowWidth && windowHeight ? (
          <span className="text-xs font-bold text-[var(--accent-light)] px-2.5 py-1 rounded-lg bg-white/5 border border-white/10">
            {windowWidth} × {windowHeight}
          </span>
        ) : (
          <span className="text-xs font-medium text-slate-400 px-2.5 py-1 rounded-lg bg-white/5 border border-white/5">
            {t.windowModeDefault || 'Default'}
          </span>
        )}
      </div>

      <CustomSelect
        value={activeValue}
        onChange={handleWindowModeChange}
        options={windowModeOptions}
      />

      {isCustomMode && (
        <div className="pt-2 animate-fadeIn space-y-3">
          {/* Dual Inputs */}
          <div className="grid grid-cols-2 gap-3 items-center">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  {t.windowWidthLabel || 'Width (pixels)'}
                </label>
                <span className="text-xs text-slate-500">Min: 640px</span>
              </div>
              <div className="relative">
                <input
                  type="text"
                  inputMode="numeric"
                  value={windowWidth}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, '');
                    setWindowWidth(val);
                    setConfirmedNotice(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleConfirmCustom();
                    }
                  }}
                  placeholder="1280"
                  className={`w-full px-3.5 py-2.5 rounded-xl bg-black/40 border text-sm font-semibold text-white focus:outline-none transition pr-9 ${
                    isWidthInvalid
                      ? 'border-amber-500/60 focus:border-amber-400'
                      : 'border-white/10 focus:border-[var(--accent-color)]'
                  }`}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-slate-400 pointer-events-none">
                  px
                </span>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  {t.windowHeightLabel || 'Height (pixels)'}
                </label>
                <span className="text-xs text-slate-500">Min: 480px</span>
              </div>
              <div className="relative">
                <input
                  type="text"
                  inputMode="numeric"
                  value={windowHeight}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, '');
                    setWindowHeight(val);
                    setConfirmedNotice(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleConfirmCustom();
                    }
                  }}
                  placeholder="720"
                  className={`w-full px-3.5 py-2.5 rounded-xl bg-black/40 border text-sm font-semibold text-white focus:outline-none transition pr-9 ${
                    isHeightInvalid
                      ? 'border-amber-500/60 focus:border-amber-400'
                      : 'border-white/10 focus:border-[var(--accent-color)]'
                  }`}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-slate-400 pointer-events-none">
                  px
                </span>
              </div>
            </div>
          </div>

          {/* Inline Validation Banner if size is below minimum */}
          {hasWarning && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-between gap-3 text-amber-300 animate-fadeIn">
              <div className="flex items-center gap-2 min-w-0">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                <span className="text-[11px] leading-relaxed">
                  {t.minWindowSizeWarning || 'Minimum window size is 640 × 480 px to prevent Minecraft UI scaling issues.'}
                </span>
              </div>
              <button
                type="button"
                onClick={handleApplyMin}
                className="px-2.5 py-1 rounded-lg bg-amber-500/25 hover:bg-amber-500/40 text-amber-200 text-[10px] font-bold shrink-0 transition cursor-pointer active:scale-95"
              >
                {t.setMinimumSizeBtn || 'Set 640 × 480'}
              </button>
            </div>
          )}

          {/* Resolution Helper Bar with Aspect Ratio & Confirmation Button */}
          <div className="flex items-center justify-between pt-1 text-xs">
            <div className="flex items-center gap-2 text-[11px] text-slate-400">
              {aspectRatio ? (
                <span className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-slate-300 font-medium">
                  {t.aspectRatioLabel || 'Ratio:'} <strong className="text-white">{aspectRatio}</strong>
                </span>
              ) : (
                <span className="text-slate-500 text-[10px]">{t.enterDimensionsPlaceholder || 'Enter width & height'}</span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {confirmedNotice ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-bold animate-fadeIn">
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>{(t.appliedCustomSizeNotice || 'Applied: ') + confirmedNotice}</span>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={handleConfirmCustom}
                  className="px-3.5 py-1.5 rounded-xl bg-[var(--accent-color)] hover:bg-[var(--accent-hover)] text-slate-950 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer active:scale-95 shadow-sm"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{t.confirmCustomSizeBtn || 'Confirm Size'}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
