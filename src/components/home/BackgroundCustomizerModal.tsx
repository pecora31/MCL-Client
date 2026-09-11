import React, { useState, useRef, useEffect } from 'react';
import { ImageCropModal } from '../common/ImageCropModal';
import { SmoothRange } from '../common/SmoothRange';
import {
  X,
  Image as ImageIcon,
  Film,
  Upload,
  RotateCcw,
  Sparkles,
  Check,
  Sliders,
  Link,
  Eye,
  Layers,
} from 'lucide-react';
import type { LauncherSettings } from '../../types';
import { getTranslation, type Language } from '../../locales/i18n';
import { isTauri, invokeCommand } from '../../services/api';

interface BackgroundCustomizerModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: LauncherSettings;
  onUpdateSettings: (patch: Partial<LauncherSettings>) => void;
  language: Language;
}

interface PresetItem {
  id: string;
  nameKey: string;
  defaultName: string;
  type: 'video' | 'image';
  url: string;
  previewUrl: string;
}

const PRESET_BACKGROUNDS: PresetItem[] = [
  {
    id: 'cinematic_video',
    nameKey: 'bgPresetVideo',
    defaultName: 'Campfire Cinematic (Video)',
    type: 'video',
    url: '/cinematic_bg.mp4',
    previewUrl: '/environments/taiga_cinematic.jpg',
  },
  {
    id: 'cherry_biome',
    nameKey: 'bgPresetCherry',
    defaultName: 'Cherry Blossom Biome',
    type: 'image',
    url: '/environments/cherry_cinematic.jpg',
    previewUrl: '/environments/cherry_cinematic.jpg',
  },
  {
    id: 'badlands_mesa',
    nameKey: 'bgPresetBadlands',
    defaultName: 'Badlands Mesa',
    type: 'image',
    url: '/environments/badlands_cinematic.jpg',
    previewUrl: '/environments/badlands_cinematic.jpg',
  },
  {
    id: 'nether_fortress',
    nameKey: 'bgPresetNether',
    defaultName: 'Nether Fortress',
    type: 'image',
    url: '/environments/nether_cinematic.jpg',
    previewUrl: '/environments/nether_cinematic.jpg',
  },
  {
    id: 'ocean_depths',
    nameKey: 'bgPresetOcean',
    defaultName: 'Deep Ocean Horizon',
    type: 'image',
    url: '/environments/ocean_cinematic.jpg',
    previewUrl: '/environments/ocean_cinematic.jpg',
  },
  {
    id: 'savanna_sunset',
    nameKey: 'bgPresetSavanna',
    defaultName: 'Savanna Sunset',
    type: 'image',
    url: '/environments/savanna_cinematic.jpg',
    previewUrl: '/environments/savanna_cinematic.jpg',
  },
];

export const BackgroundCustomizerModal: React.FC<BackgroundCustomizerModalProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
  language,
}) => {
  const t = getTranslation(language);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [customUrlInput, setCustomUrlInput] = useState('');
  const [urlError, setUrlError] = useState('');
  const [cropSource, setCropSource] = useState<string | null>(null);

  // Local state for 60fps instant fluid slider response
  const [localOpacity, setLocalOpacity] = useState<number>(() => Math.round((settings.bgOpacity ?? 0.3) * 100));
  const [localBlur, setLocalBlur] = useState<number>(() => settings.bgBlur ?? 0);

  // Sync with external settings changes
  useEffect(() => {
    setLocalOpacity(Math.round((settings.bgOpacity ?? 0.3) * 100));
  }, [settings.bgOpacity]);

  useEffect(() => {
    setLocalBlur(settings.bgBlur ?? 0);
  }, [settings.bgBlur]);

  if (!isOpen) return null;

  const currentBgType = settings.bgType || 'video';
  const currentImageUrl = settings.customBgImage || '';
  const currentVideoUrl = settings.customVideoUrl || '/cinematic_bg.mp4';

  const handleSelectPreset = (preset: PresetItem) => {
    if (preset.type === 'video') {
      onUpdateSettings({
        bgType: 'video',
        customVideoUrl: preset.url,
        customBgImage: undefined,
      });
    } else {
      onUpdateSettings({
        bgType: 'image',
        customBgImage: preset.url,
        customVideoUrl: undefined,
      });
    }
  };

  const handleFileUpload = async (file: File) => {
    const isVideo = file.type.startsWith('video/') || /\.(mp4|webm|mkv|mov)$/i.test(file.name);

    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      if (!result) return;
      if (isVideo) {
        onUpdateSettings({
          bgType: 'video',
          customVideoUrl: result,
          customBgImage: undefined,
        });
      } else {
        // Let the player frame the picture instead of stretching whatever they picked
        setCropSource(result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleCropped = (dataUrl: string) => {
    setCropSource(null);
    onUpdateSettings({
      bgType: 'image',
      customBgImage: dataUrl,
      customVideoUrl: undefined,
    });
  };

  const handleBrowseNativeFile = async () => {
    if (isTauri()) {
      try {
        const selected = await invokeCommand<string | null>('select_file', {
          filterName: 'Media Files',
          filterExtensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'mp4', 'webm'],
        });
        if (selected) {
          const isVideo = /\.(mp4|webm|mkv|mov)$/i.test(selected);
          if (isVideo) {
            onUpdateSettings({
              bgType: 'video',
              customVideoUrl: selected,
              customBgImage: undefined,
            });
          } else {
            onUpdateSettings({
              bgType: 'image',
              customBgImage: selected,
              customVideoUrl: undefined,
            });
          }
          return;
        }
      } catch {
        // Fallback to HTML input
      }
    }
    fileInputRef.current?.click();
  };

  const handleApplyUrl = () => {
    const url = customUrlInput.trim();
    if (!url) return;

    try {
      const isVideo = /\.(mp4|webm|mkv|mov)(\?.*)?$/i.test(url) || url.startsWith('data:video');
      if (isVideo) {
        onUpdateSettings({
          bgType: 'video',
          customVideoUrl: url,
          customBgImage: undefined,
        });
      } else {
        onUpdateSettings({
          bgType: 'image',
          customBgImage: url,
          customVideoUrl: undefined,
        });
      }
      setCustomUrlInput('');
      setUrlError('');
    } catch {
      setUrlError('Invalid URL format');
    }
  };

  const handleResetDefault = () => {
    setLocalOpacity(30);
    setLocalBlur(0);
    onUpdateSettings({
      bgType: 'video',
      customVideoUrl: '/cinematic_bg.mp4',
      customBgImage: undefined,
      bgOpacity: 0.3,
      bgBlur: 0,
    });
  };

  const isPresetActive = (preset: PresetItem) => {
    if (preset.type === 'video') {
      return currentBgType === 'video' && currentVideoUrl === preset.url;
    }
    return currentBgType === 'image' && currentImageUrl === preset.url;
  };


  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
      {cropSource && (
        <ImageCropModal
          isOpen
          src={cropSource}
          aspect={16 / 9}
          outputWidth={1920}
          title="Frame your background"
          onCancel={() => setCropSource(null)}
          onCropped={handleCropped}
        />
      )}
      <div
        className="w-full max-w-2xl rounded-3xl border border-white/10 shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-scaleUp bg-[#121212]"
        style={{ fontFamily: "'Plus Jakarta Sans', 'Inter', sans-serif" }}
        onClick={(e) => e.stopPropagation()}
      >

        {/* Header — clean obsidian matte style */}
        <div className="px-6 py-4.5 flex items-center justify-between border-b border-white/[0.08] bg-[#161616]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold font-riot text-white tracking-wide leading-tight">
                {(t as any).bgModalTitle || 'Customize Launcher Background'}
              </h2>
              <p className="text-sm text-slate-400 mt-0.5 leading-relaxed">
                {(t as any).bgModalDesc || 'Personalize your launcher with videos, wallpapers, or custom photos.'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-[#2a2b2f]/90 hover:bg-[#383a40] text-white border border-white/10 shadow-lg flex items-center justify-center transition-all duration-150 active:scale-90 cursor-pointer shrink-0"
            title={t.cancel || 'Close'}
          >
            <X className="w-4.5 h-4.5 text-white" strokeWidth={3} />
          </button>
        </div>


        {/* Modal Body */}
        <div className="p-6 space-y-5 overflow-y-auto custom-scrollbar flex-1">
          {/* Section 1: Presets Gallery */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[13px] font-bold text-slate-200 uppercase tracking-wider">
                <Layers className="w-4 h-4 text-[var(--accent-color)]" />
                <span>{(t as any).bgPresetTitle || 'Preset Wallpapers'}</span>
              </div>
              <span className="text-xs text-slate-400 font-mono font-bold">HD PRESETS</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5">
              {PRESET_BACKGROUNDS.map((preset) => {
                const active = isPresetActive(preset);
                const presetName = (t as any)[preset.nameKey] || preset.defaultName;

                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleSelectPreset(preset)}
                    className={`group relative rounded-2xl overflow-hidden border-2 transition-all duration-200 cursor-pointer text-left aspect-video ${
                      active
                        ? 'border-[var(--accent-color)] ring-2 ring-[var(--accent-color)]/30 shadow-lg shadow-[var(--accent-color)]/10 -translate-y-0.5'
                        : 'border-white/10 hover:border-white/30 hover:-translate-y-0.5'
                    }`}
                  >
                    <img
                      src={preset.previewUrl}
                      alt={presetName}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />

                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent flex flex-col justify-between p-2.5">
                      <div className="flex items-center justify-between">
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-black/60 backdrop-blur-sm border border-white/10 text-[var(--accent-light)] flex items-center gap-1">
                          {preset.type === 'video' ? (
                            <>
                              <Film className="w-3 h-3" />
                              <span>VIDEO</span>
                            </>
                          ) : (
                            <>
                              <ImageIcon className="w-3 h-3" />
                              <span>IMG</span>
                            </>
                          )}
                        </span>

                        {active && (
                          <span className="w-5 h-5 rounded-full bg-[var(--accent-color)] text-slate-950 flex items-center justify-center shadow-md">
                            <Check className="w-3.5 h-3.5 stroke-[3]" />
                          </span>
                        )}
                      </div>

                      <div className="text-xs font-bold text-white drop-shadow truncate">
                        {presetName}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Section 2: Custom File Upload & URL */}
          <div className="p-4.5 rounded-2xl border border-white/[0.06] space-y-3.5 bg-white/[0.02]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[13px] font-bold text-slate-200 uppercase tracking-wider">
                <Upload className="w-4 h-4 text-[var(--accent-color)]" />
                <span>{(t as any).bgUploadTitle || 'Upload Custom File'}</span>
              </div>
              <span className="text-xs text-slate-400 font-mono">
                {(t as any).bgFileTypeHint || 'Image / Video / GIF'}
              </span>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              {(t as any).bgUploadDesc || 'Supports images (.png, .jpg, .webp), videos (.mp4, .webm), and animations (.gif, .apng).'}
            </p>

            <div className="flex flex-col sm:flex-row items-center gap-3">
              {/* Hidden HTML input */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/mp4,video/webm"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(file);
                }}
              />

              <button
                type="button"
                onClick={handleBrowseNativeFile}
                className="w-full sm:w-auto px-4.5 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200 text-sm font-semibold flex items-center justify-center gap-2 transition cursor-pointer active:scale-95 shrink-0"
              >
                <Upload className="w-4 h-4" />
                <span>{(t as any).bgUploadBtn || 'Choose File from Computer'}</span>
              </button>

              {/* URL Direct Input */}
              <div className="relative flex-1 w-full">
                <Link className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={customUrlInput}
                  onChange={(e) => {
                    setCustomUrlInput(e.target.value);
                    setUrlError('');
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && handleApplyUrl()}
                  placeholder={(t as any).bgUrlInputPlaceholder || 'Or paste image/video URL directly...'}
                  className="w-full bg-black/50 border border-white/[0.08] rounded-xl pl-10 pr-20 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-400 transition"
                />
                {customUrlInput.trim() && (
                  <button
                    type="button"
                    onClick={handleApplyUrl}
                    className="btn-primary absolute right-1.5 top-1/2 -translate-y-1/2 px-3.5 py-1.5 rounded-lg font-bold text-xs transition cursor-pointer active:scale-95 shadow-sm"
                  >
                    {(t as any).bgApply || 'Apply'}
                  </button>
                )}
              </div>
            </div>

            {urlError && <p className="text-xs text-rose-400 font-semibold">{urlError}</p>}
          </div>

          {/* Section 3: Sliders (Dim Overlay Darkness & Backdrop Blur) */}
          <div className="p-4.5 rounded-2xl border border-white/[0.06] space-y-4 bg-white/[0.02]">
            <div className="flex items-center gap-2 text-[13px] font-bold text-slate-200 uppercase tracking-wider">
              <Sliders className="w-4 h-4 text-[var(--accent-color)]" />
              <span>{(t as any).bgBrightness || 'Brightness & Overlay'}</span>
            </div>

            {/* Slider 1: Dim Darkness */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm text-slate-200">
                <span className="flex items-center gap-2 font-semibold">
                  <Eye className="w-4 h-4 text-slate-400" />
                  <span>{(t as any).bgDimOverlay || 'Dim Overlay Darkness'}</span>
                </span>
                <span className="font-mono text-sm text-[var(--accent-light)] font-bold">{localOpacity}%</span>
              </div>
              <SmoothRange
                min={0}
                max={85}
                step={1}
                value={localOpacity}
                onChange={(val) => {
                  setLocalOpacity(val);
                  onUpdateSettings({ bgOpacity: val / 100 });
                }}
              />
              <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
                <span>0%</span>
                <span>30% default</span>
                <span>85%</span>
              </div>
            </div>

            {/* Slider 2: Backdrop Blur */}
            <div className="space-y-2 pt-3.5 border-t border-white/[0.04]">
              <div className="flex items-center justify-between text-sm text-slate-200">
                <span className="flex items-center gap-2 font-semibold">
                  <Sparkles className="w-4 h-4 text-slate-400" />
                  <span>{(t as any).bgBlurLabel || 'Backdrop Blur'}</span>
                </span>
                <span className="font-mono text-sm text-[var(--accent-light)] font-bold">{localBlur}px</span>
              </div>
              <SmoothRange
                min={0}
                max={16}
                step={1}
                value={localBlur}
                onChange={(val) => {
                  setLocalBlur(val);
                  onUpdateSettings({ bgBlur: val });
                }}
              />
              <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
                <span>0px</span>
                <span>4px</span>
                <span>16px</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/[0.08] bg-[#161616]/50 flex items-center justify-between">
          <button
            type="button"
            onClick={handleResetDefault}
            className="px-4.5 py-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.07] text-sm font-semibold text-slate-300 hover:text-white flex items-center gap-2 transition cursor-pointer active:scale-95"
          >
            <RotateCcw className="w-4 h-4" />
            <span>{(t as any).bgResetDefault || 'Reset to Default'}</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="btn-primary px-7 py-2.5 rounded-xl font-bold font-riot text-sm shadow-md cursor-pointer active:scale-95 transition"
          >
            {(t as any).done || 'Done'}
          </button>
        </div>
      </div>
    </div>
  );
};

