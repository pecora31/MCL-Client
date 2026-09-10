import React, { useState, useEffect, useRef } from 'react';
import { ImageCropModal } from '../common/ImageCropModal';
import {
  Copy,
  Check,
  X,
  Shirt,
  Image as ImageIcon,
  Camera,
  Trash2,
  Edit3,
  User,
  ArrowLeft,
  Upload,
  Palette,
} from 'lucide-react';
import type { Account } from '../../types';
import { getTranslation, type Language } from '../../locales/i18n';
import { useUsernameClaimCheck } from '../../hooks/useUsernameClaimCheck';
import { UsernameClaimHint } from './UsernameClaimHint';

interface ProfileCardProps {
  isOpen: boolean;
  onClose: () => void;
  account: Account;
  onUpdateAccount: (updated: Account) => void;
  onNavigateSkin: () => void;
  language?: Language;
}

// Preset banner gradients that look sleek and futuristic
const BANNER_PRESETS = [
  {
    id: 'pearl',
    name: 'Prism Pearl (Ngọc trai xà cừ)',
    style: 'linear-gradient(135deg, #93c5fd 0%, #c4b5fd 30%, #f472b6 70%, #fda4af 100%)',
  },
  {
    id: 'chameleon',
    name: 'Chameleon Prism (Lăng kính tán sắc)',
    style: 'linear-gradient(135deg, #d97706 0%, #16a34a 30%, #7c3aed 70%, #be185d 100%)',
  },
  {
    id: 'default',
    name: 'Amber Glow (Hổ phách)',
    style: 'linear-gradient(135deg, rgba(245, 158, 11, 0.45) 0%, rgba(124, 58, 237, 0.35) 50%, rgba(15, 23, 42, 0.95) 100%)',
  },
  {
    id: 'indigo',
    name: 'Cyber Indigo (Xanh chàm)',
    style: 'linear-gradient(135deg, rgba(99, 102, 241, 0.55) 0%, rgba(168, 85, 247, 0.4) 50%, rgba(15, 23, 42, 0.95) 100%)',
  },
  {
    id: 'emerald',
    name: 'Emerald Forest (Lục bảo)',
    style: 'linear-gradient(135deg, rgba(16, 185, 129, 0.55) 0%, rgba(13, 148, 136, 0.4) 50%, rgba(15, 23, 42, 0.95) 100%)',
  },
  {
    id: 'crimson',
    name: 'Nether Ruby (Hồng ngọc)',
    style: 'linear-gradient(135deg, rgba(244, 63, 94, 0.55) 0%, rgba(190, 18, 60, 0.4) 50%, rgba(15, 23, 42, 0.95) 100%)',
  },
  {
    id: 'ocean',
    name: 'Ocean Cyan (Xanh ngọc biển)',
    style: 'linear-gradient(135deg, rgba(6, 182, 212, 0.55) 0%, rgba(59, 130, 246, 0.4) 50%, rgba(15, 23, 42, 0.95) 100%)',
  },
  {
    id: 'obsidian',
    name: 'Obsidian Matte (Hắc diện thạch)',
    style: 'linear-gradient(135deg, #23252b 0%, #17181c 50%, #0d0e10 100%)',
  },
];

/**
 * Compresses an image file using an offscreen canvas to avoid localStorage quota crash
 */
const optimizeImage = (
  file: File,
  maxWidth: number,
  maxHeight: number,
  quality = 0.82
): Promise<string> => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        if (height > maxHeight) {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(e.target?.result as string);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => resolve(e.target?.result as string);
      img.src = e.target?.result as string;
    };
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
};

export const ProfileCard: React.FC<ProfileCardProps> = ({
  isOpen,
  onClose,
  account,
  onUpdateAccount,
  onNavigateSkin,
  language = 'vi',
}) => {
  const [isEditMode, setIsEditMode] = useState(false);
  const [showBannerDrawer, setShowBannerDrawer] = useState(false);
  const [isHotEditingName, setIsHotEditingName] = useState(false);
  const [hotNameInput, setHotNameInput] = useState(account.username);
  const [usernameInput, setUsernameInput] = useState(account.username);
  const [copiedName, setCopiedName] = useState(false);
  const hotNameCheck = useUsernameClaimCheck(
    isHotEditingName ? hotNameInput : account.username,
    account.username
  );
  const editNameCheck = useUsernameClaimCheck(
    isEditMode ? usernameInput : account.username,
    account.username
  );

  const hotInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const [bannerCropSource, setBannerCropSource] = useState<string | null>(null);

  const t = getTranslation(language);
  const isVi = language === 'vi';

  useEffect(() => {
    setUsernameInput(account.username);
    setHotNameInput(account.username);
  }, [account.username]);

  // Handle Escape key to close or cancel hot edit
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        if (isHotEditingName) {
          setHotNameInput(account.username);
          setIsHotEditingName(false);
        } else if (showBannerDrawer) {
          setShowBannerDrawer(false);
        } else if (isEditMode) {
          setIsEditMode(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isHotEditingName, showBannerDrawer, isEditMode, onClose, account.username]);

  if (!isOpen) return null;

  const handleCopyUsername = async () => {
    try {
      await navigator.clipboard.writeText(account.username);
      setCopiedName(true);
      setTimeout(() => setCopiedName(false), 2000);
    } catch {
      // fallback
    }
  };

  const handleSaveHotName = () => {
    const trimmed = hotNameInput.trim();
    if (trimmed && trimmed !== account.username) {
      onUpdateAccount({ ...account, username: trimmed });
    }
    setIsHotEditingName(false);
  };

  const handleSaveProfile = () => {
    const trimmed = usernameInput.trim();
    if (!trimmed) return;
    onUpdateAccount({ ...account, username: trimmed });
    setIsEditMode(false);
  };

  const handleUploadAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Optimize to max 160x160 (~10KB)
    const optimized = await optimizeImage(file, 160, 160, 0.85);
    if (optimized) {
      onUpdateAccount({
        ...account,
        avatarCustom: optimized,
        avatarIcon: undefined,
      });
    }
    if (avatarInputRef.current) avatarInputRef.current.value = '';
  };

  const handleRemoveAvatar = () => {
    onUpdateAccount({
      ...account,
      avatarCustom: undefined,
      avatarIcon: undefined,
    });
  };

  const handleUploadBanner = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Let the player choose which part of the picture becomes the banner
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      if (result) setBannerCropSource(result);
    };
    reader.readAsDataURL(file);
    if (bannerInputRef.current) bannerInputRef.current.value = '';
  };

  const handleBannerCropped = (dataUrl: string) => {
    setBannerCropSource(null);
    onUpdateAccount({
      ...account,
      customBanner: dataUrl,
    });
  };

  const handleSelectPresetBanner = (gradientStyle: string) => {
    onUpdateAccount({
      ...account,
      customBanner: gradientStyle,
    });
  };

  const handleRemoveBanner = () => {
    onUpdateAccount({
      ...account,
      customBanner: undefined,
    });
  };

  const isCustomImageBanner =
    account.customBanner?.startsWith('data:image/') ||
    account.customBanner?.startsWith('http');

  return (
    <>
      {bannerCropSource && (
        <ImageCropModal
          isOpen
          src={bannerCropSource}
          aspect={310 / 96}
          outputWidth={960}
          title="Frame your banner"
          onCancel={() => setBannerCropSource(null)}
          onCropped={handleBannerCropped}
        />
      )}

      {/* Invisible backdrop to catch clicks outside the card (Transparent, never dims the app) */}
      <div
        className="fixed inset-0 z-[89] bg-transparent"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Floating Stack: Mini Banner Box (Top) + Profile Popout Card (Bottom) */}
      <div
        className="fixed left-[88px] bottom-3 z-[90] w-[310px] select-none flex flex-col justify-end pointer-events-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Hidden File Inputs for Avatar & Banner */}
        <input
          ref={avatarInputRef}
          type="file"
          accept="image/png, image/jpeg, image/webp"
          onChange={handleUploadAvatar}
          className="hidden pointer-events-none"
        />
        <input
          ref={bannerInputRef}
          type="file"
          accept="image/png, image/jpeg, image/webp"
          onChange={handleUploadBanner}
          className="hidden pointer-events-none"
        />

        {/* Floating Mini Banner Picker Box (Positioned cleanly ABOVE the profile card) */}
        {showBannerDrawer && (
          <div
            className="pointer-events-auto mb-2 w-full rounded-2xl bg-[#141518]/98 border border-white/15 shadow-[0_16px_40px_rgba(0,0,0,0.85)] backdrop-blur-2xl p-3 space-y-2.5 animate-fadeIn text-slate-100"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between text-[11px] text-slate-300 font-semibold">
              <span className="flex items-center gap-1.5">
                <Palette className="w-3.5 h-3.5 text-[var(--accent-color)]" />
                <span>{t.selectBannerTheme || 'Select banner theme:'}</span>
              </span>
              <button
                onClick={() => setShowBannerDrawer(false)}
                className="w-5 h-5 rounded-full hover:bg-white/10 text-slate-400 hover:text-white flex items-center justify-center text-xs transition cursor-pointer"
                title={t.close || 'Close'}
              >
                ✕
              </button>
            </div>

            {/* Presets Row */}
            <div className="grid grid-cols-8 gap-1.5">
              {BANNER_PRESETS.map((preset) => {
                const isSelected = account.customBanner === preset.style;
                return (
                  <button
                    key={preset.id}
                    onClick={() => handleSelectPresetBanner(preset.style)}
                    title={preset.name}
                    className={`h-6 rounded-lg border transition-all cursor-pointer shadow-sm active:scale-95 ${
                      isSelected
                        ? 'border-white scale-105 shadow-[0_0_8px_rgba(255,255,255,0.7)]'
                        : 'border-white/15 hover:scale-105 hover:border-white/40'
                    }`}
                    style={{ background: preset.style }}
                  />
                );
              })}
            </div>

            {/* Custom upload button */}
            <div className="pt-0.5 flex items-center gap-2">
              <button
                onClick={() => bannerInputRef.current?.click()}
                className="flex-1 py-1.5 px-2.5 rounded-lg bg-white/10 hover:bg-white/15 text-white text-[11px] font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer active:scale-98"
              >
                <Upload className="w-3 h-3 text-[var(--accent-color)]" />
                <span>{t.uploadImage || 'Upload image'}</span>
              </button>
              {account.customBanner && (
                <button
                  onClick={handleRemoveBanner}
                  className="p-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-400 text-xs transition cursor-pointer"
                  title={t.resetDefault || 'Reset to default'}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Main Floating Profile Card */}
        <div
          className="pointer-events-auto w-full rounded-2xl bg-[#141518]/98 border border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.85)] backdrop-blur-2xl overflow-hidden select-none animate-profilePopout text-slate-100"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Profile Card Header Banner */}
          <div className="h-24 w-full relative overflow-hidden group/banner bg-[#1a1b20]">
            {isCustomImageBanner ? (
              <img
                src={account.customBanner}
                alt="Profile Banner"
                className="w-full h-full object-cover select-none"
              />
            ) : (
              <div
                className="w-full h-full relative"
                style={{
                  background:
                    account.customBanner ||
                    'linear-gradient(135deg, rgba(245, 158, 11, 0.45) 0%, rgba(124, 58, 237, 0.35) 50%, rgba(15, 23, 42, 0.95) 100%)',
                }}
              />
            )}

            {/* Quick Banner Edit Controls on Hover or When Drawer Open */}
            <div
              className={`absolute top-2.5 left-2.5 flex items-center gap-1.5 ${
                showBannerDrawer ? 'opacity-100' : 'opacity-0 group-hover/banner:opacity-100'
              } transition-opacity duration-150`}
            >
              <button
                onClick={() => setShowBannerDrawer((prev) => !prev)}
                title={t.changeBanner || 'Change banner'}
                className={`px-2.5 py-1 rounded-full ${
                  showBannerDrawer
                    ? 'bg-[var(--accent-color)] text-slate-950 font-bold border-[var(--accent-color)] shadow-sm'
                    : 'bg-black/70 hover:bg-black/90 text-white border-white/20'
                } border text-[10px] font-semibold flex items-center gap-1 backdrop-blur cursor-pointer transition-colors shadow-md`}
              >
                <Palette className="w-3 h-3" />
                <span>{t.editBanner || 'Edit banner'}</span>
              </button>

              {account.customBanner && (
                <button
                  onClick={handleRemoveBanner}
                  title={t.resetBanner || 'Reset banner'}
                  className="p-1 rounded-full bg-black/70 hover:bg-red-500/80 text-slate-300 hover:text-white border border-white/20 backdrop-blur cursor-pointer transition-colors shadow-md"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Close Popout Button */}
            <button
              onClick={onClose}
              title={t.close || 'Close'}
              className="absolute top-2.5 right-2.5 w-6 h-6 rounded-full bg-black/50 hover:bg-black/80 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer shadow-md"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Avatar Section: Clean Crisp Circle Overlapping the Banner (NO square box, NO online dot) */}
          <div className="relative px-4 -mt-10 flex items-end justify-between z-10">
          <div
            onClick={() => avatarInputRef.current?.click()}
            title={t.changeAvatar || 'Click to change avatar'}
            className="w-20 h-20 rounded-full border-4 border-[#141518] bg-[#1a1b20] shadow-2xl overflow-hidden relative group/avatar cursor-pointer shrink-0 transition-transform duration-150 active:scale-95"
          >
            {account.avatarCustom ? (
              <img
                src={account.avatarCustom}
                alt={account.username}
                className="w-full h-full object-cover select-none"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-slate-800 text-[var(--accent-color)]">
                <User className="w-8 h-8" />
              </div>
            )}

            {/* Hover Camera Overlay on Avatar */}
            <div className="absolute inset-0 bg-black/55 opacity-0 group-hover/avatar:opacity-100 flex flex-col items-center justify-center gap-0.5 text-white transition-opacity duration-150">
              <Camera className="w-4 h-4" />
            </div>
          </div>
        </div>

        {/* Card Main Body Content */}
        <div className="p-4 pt-3">
          {!isEditMode ? (
            /* VIEW MODE: Clean, minimal Discord User Info */
            <div className="space-y-4">
              {/* Username + Hot Edit + Copy Username Row */}
              <div className="flex items-center justify-between gap-2 min-h-[36px]">
                {isHotEditingName ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSaveHotName();
                    }}
                    className="flex items-center gap-1.5 flex-1 min-w-0"
                  >
                    <input
                      ref={hotInputRef}
                      type="text"
                      value={hotNameInput}
                      onChange={(e) => setHotNameInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          setHotNameInput(account.username);
                          setIsHotEditingName(false);
                        }
                      }}
                      onBlur={handleSaveHotName}
                      className="w-full px-2.5 py-1 rounded-lg bg-black/70 border border-[var(--accent-color)] text-white font-black text-base focus:outline-none shadow-inner"
                      placeholder={t.enterNamePlaceholder || 'Enter name...'}
                      autoFocus
                    />
                    <button
                      type="submit"
                      onMouseDown={(e) => e.preventDefault()}
                      className="p-1.5 rounded-lg bg-[var(--accent-color)] text-slate-950 hover:brightness-110 transition cursor-pointer shrink-0"
                      title={t.saveName || 'Save'}
                    >
                      <Check className="w-3.5 h-3.5 font-bold" />
                    </button>
                  </form>
                ) : (
                  <div className="flex items-center gap-1.5 min-w-0 flex-1 group/name">
                    <h3
                      onClick={() => {
                        setHotNameInput(account.username);
                        setIsHotEditingName(true);
                      }}
                      title={t.editNameDirect || 'Click to edit name directly'}
                      className="text-lg font-black text-white tracking-wide truncate cursor-pointer hover:text-[var(--accent-color)] transition-colors flex items-center gap-1.5"
                    >
                      <span>{account.username}</span>
                      <Edit3 className="w-3.5 h-3.5 opacity-40 group-hover/name:opacity-100 text-slate-400 group-hover/name:text-[var(--accent-color)] transition-all shrink-0" />
                    </h3>
                  </div>
                )}

                {/* Copy Username Button */}
                <button
                  type="button"
                  onClick={handleCopyUsername}
                  title={t.copyUsername || 'Copy username'}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all duration-150 cursor-pointer shrink-0 ${
                    copiedName
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border border-white/10'
                  }`}
                >
                  {copiedName ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-[10px] font-bold">{t.copied || 'Copied'}</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-slate-400" />
                      <span className="text-[10px]">{t.copyAction || 'Copy'}</span>
                    </>
                  )}
                </button>
              </div>

              {isHotEditingName && (
                <UsernameClaimHint
                  status={hotNameCheck.status}
                  suggestions={hotNameCheck.suggestions}
                  onPickSuggestion={(name) => {
                    setHotNameInput(name);
                    hotInputRef.current?.focus();
                  }}
                  language={language}
                />
              )}

              {/* Divider */}
              <div className="h-px bg-white/[0.08]" />

              {/* Action Buttons: Edit Profile + Edit 3D Skin */}
              <div className="space-y-2">
                {/* 1. Edit Profile Button */}
                <button
                  type="button"
                  onClick={() => setIsEditMode(true)}
                  className="w-full py-2.5 px-4 rounded-xl bg-[#25272c] hover:bg-[#32353b] text-white font-bold text-xs flex items-center justify-center gap-2 border border-white/10 transition-all cursor-pointer active:scale-95 shadow-sm"
                >
                  <Edit3 className="w-3.5 h-3.5 text-[var(--accent-color)]" />
                  <span>{t.editProfile || 'Edit Profile'}</span>
                </button>

                {/* 2. Edit 3D Skin Button */}
                <button
                  type="button"
                  onClick={onNavigateSkin}
                  className="btn-primary w-full py-2.5 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-95 shadow-md hover:shadow-none"
                >
                  <Shirt className="w-4 h-4" />
                  <span>{t.edit3dSkin || 'Edit 3D Skin'}</span>
                </button>
              </div>
            </div>
          ) : (
            /* EDIT PROFILE MODE: Simple & intuitive inline controls */
            <div className="space-y-3.5 animate-fadeIn">
              {/* Header with Back button */}
              <div className="flex items-center justify-between pb-1 border-b border-white/10">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setIsEditMode(false)}
                    className="p-1 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer"
                    title={t.back || 'Back'}
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  <span className="text-xs font-bold text-white tracking-wide">
                    {t.editProfile || 'Edit Profile'}
                  </span>
                </div>
              </div>

              {/* 1. Username Input */}
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-400">
                  {t.playerName || 'Player name'}
                </label>
                <input
                  type="text"
                  value={usernameInput}
                  onChange={(e) => setUsernameInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveProfile()}
                  className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-white font-bold text-sm focus:outline-none focus:border-[var(--accent-color)]"
                  placeholder={t.enterNamePlaceholder || 'Enter name...'}
                  autoFocus
                />
                <UsernameClaimHint
                  status={editNameCheck.status}
                  suggestions={editNameCheck.suggestions}
                  onPickSuggestion={setUsernameInput}
                  language={language}
                />
              </div>

              {/* 2. Avatar & Banner Quick Actions */}
              <div className="space-y-2 pt-1">
                <label className="text-[11px] font-semibold text-slate-400">
                  {t.profileVisuals || 'Profile visuals'}
                </label>

                {/* Avatar upload / reset */}
                <div className="flex items-center justify-between p-2 rounded-xl bg-black/40 border border-white/5">
                  <span className="text-xs text-slate-300 flex items-center gap-1.5">
                    <Camera className="w-3.5 h-3.5 text-slate-400" />
                    <span>{t.avatarImage || 'Avatar image'}</span>
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => avatarInputRef.current?.click()}
                      className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-white text-[11px] font-semibold flex items-center gap-1 transition cursor-pointer"
                    >
                      <Upload className="w-3 h-3" />
                      <span>{t.uploadBtn || 'Upload'}</span>
                    </button>
                    {account.avatarCustom && (
                      <button
                        type="button"
                        onClick={handleRemoveAvatar}
                        title={t.resetAvatar || 'Reset avatar'}
                        className="p-1 rounded-lg hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Banner upload / reset */}
                <div className="flex items-center justify-between p-2 rounded-xl bg-black/40 border border-white/5">
                  <span className="text-xs text-slate-300 flex items-center gap-1.5">
                    <ImageIcon className="w-3.5 h-3.5 text-slate-400" />
                    <span>{t.bannerImage || 'Banner image'}</span>
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => bannerInputRef.current?.click()}
                      className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-white text-[11px] font-semibold flex items-center gap-1 transition cursor-pointer"
                    >
                      <Upload className="w-3 h-3" />
                      <span>{t.uploadBtn || 'Upload'}</span>
                    </button>
                    {account.customBanner && (
                      <button
                        type="button"
                        onClick={handleRemoveBanner}
                        title={t.resetBanner || 'Reset banner'}
                        className="p-1 rounded-lg hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Save / Cancel Buttons */}
              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsEditMode(false)}
                  className="flex-1 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white font-semibold text-xs transition cursor-pointer"
                >
                  {t.btnCancel || 'Cancel'}
                </button>
                <button
                  type="button"
                  onClick={handleSaveProfile}
                  className="flex-1 py-2 rounded-xl bg-[var(--accent-color)] hover:brightness-110 text-slate-950 font-bold text-xs flex items-center justify-center gap-1 transition cursor-pointer shadow-sm"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{t.saveName || t.btnSave || 'Save'}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  </>
  );
};

export default ProfileCard;
