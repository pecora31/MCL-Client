import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Package,
  Search,
  Download,
  Check,
  Trash2,
  ExternalLink,
  FolderOpen,
  Sparkles,
  Layers,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  X,
  Filter,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Flame,
  Heart,
  Clock,
  RotateCcw,
  FileCode,
  Box,
  Monitor,
  Server,
  LayoutGrid,
  List,
  Globe,
  ArrowUp,
  FileArchive,
} from 'lucide-react';
import { ToggleSwitch } from '../common/ToggleSwitch';
import type { GameInstance, AddonContentType, AddonSource, AddonItem, LocalMod } from '../../types';
import {
  searchAddonsMultiSource,
  getModrinthDownloadInfo,
  getCurseForgeDownloadInfo,
  installAddon,
  getInstalledAddons,
  toggleAddon,
  deleteAddon,
  fetchMojangVersions,
  selectMrpackFile,
} from '../../services/api';
import { getTranslation, type Language } from '../../locales/i18n';
import {
  ModrinthLogo,
  CurseForgeLogo,
  FabricIcon,
  ForgeIcon,
  NeoForgeIcon,
  QuiltIcon,
  BabricIcon,
  BtaIcon,
  JavaAgentIcon,
  LegacyFabricIcon,
  LiteLoaderIcon,
  ModLoaderIcon,
  NilLoaderIcon,
  OrnitheIcon,
  RiftIcon,
  getLoaderIcon,
} from './ModIcons';
import { InstallModpackModal } from '../instances/InstallModpackModal';

export { ModrinthLogo, CurseForgeLogo, getLoaderIcon };

interface ModStoreProps {
  activeInstance?: GameInstance;
  instances?: GameInstance[];
  onSelectInstance?: (id: string) => void;
  onOpenCreateModal?: () => void;
  onOpenInstanceDir?: (id: string) => void;
  onModpackInstalled?: (instance: GameInstance) => void;
  language?: Language;
  curseForgeApiKey?: string;
}

// Helpers
function formatCount(num: number): string {
  if (!num || num <= 0) return '0';
  if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(1) + 'B';
  if (num >= 100_000_000) return Math.round(num / 1_000_000) + 'M';
  if (num >= 10_000_000) return (num / 1_000_000).toFixed(1) + 'M';
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
  if (num >= 10_000) return Math.round(num / 1_000) + 'K';
  if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K';
  return num.toString();
}

function formatTimeAgo(dateStr?: string, lang: Language = 'en'): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (isNaN(diffSec) || diffSec < 0) return '';

  if (diffSec < 60) {
    if (lang === 'vi') return 'Vừa xong';
    if (lang === 'zh') return '刚刚';
    if (lang === 'ja') return 'たった今';
    if (lang === 'ko') return '방금 전';
    return 'Just now';
  }
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    if (lang === 'vi') return `${diffMin}m trước`;
    if (lang === 'zh') return `${diffMin}分钟前`;
    if (lang === 'ja') return `${diffMin}分前`;
    if (lang === 'ko') return `${diffMin}분 전`;
    return `${diffMin}m ago`;
  }
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) {
    if (lang === 'vi') return `${diffHours}h trước`;
    if (lang === 'zh') return `${diffHours}小时前`;
    if (lang === 'ja') return `${diffHours}時間前`;
    if (lang === 'ko') return `${diffHours}시간 전`;
    return `${diffHours}h ago`;
  }
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) {
    if (lang === 'vi') return `${diffDays}d trước`;
    if (lang === 'zh') return `${diffDays}天前`;
    if (lang === 'ja') return `${diffDays}日前`;
    if (lang === 'ko') return `${diffDays}일 전`;
    return `${diffDays}d ago`;
  }
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) {
    if (lang === 'vi') return `${diffMonths}mo trước`;
    if (lang === 'zh') return `${diffMonths}个月前`;
    if (lang === 'ja') return `${diffMonths}ヶ月前`;
    if (lang === 'ko') return `${diffMonths}개월 전`;
    return `${diffMonths}mo ago`;
  }
  const diffYears = Math.floor(diffDays / 365);
  if (lang === 'vi') return `${diffYears}y trước`;
  if (lang === 'zh') return `${diffYears}年前`;
  if (lang === 'ja') return `${diffYears}年前`;
  if (lang === 'ko') return `${diffYears}년 전`;
  return `${diffYears}y ago`;
}

// Resource types corresponding exactly to Image 1
const getResourceTypes = (t: any): { id: AddonContentType; label: string }[] => [
  { id: 'mods', label: t.categoryMods || 'Mods' },
  { id: 'resourcepacks', label: t.categoryResourcePacks || 'Resource Packs' },
  { id: 'datapacks', label: t.categoryDataPacks || 'Data Packs' },
  { id: 'shaderpacks', label: t.categoryShaders || 'Shaders' },
  { id: 'modpacks', label: t.categoryModpacks || 'Modpacks' },
  { id: 'plugins', label: t.categoryPlugins || 'Plugins' },
  { id: 'servers', label: t.categoryServers || 'Servers' },
];

function getCategoryName(cat: { id: string; nameVi: string; nameEn: string }, lang: Language): string {
  if (lang === 'vi') return cat.nameVi;
  if (lang === 'zh') {
    const zhMap: Record<string, string> = {
      'all': '全部类别',
      'optimization': '性能与帧率优化',
      'technology': '科技与机械',
      'magic': '魔法与法术',
      'utility': '实用辅助与 QoL',
      'adventure': '冒险与角色扮演 (RPG)',
      'decoration': '建筑与装饰',
      'library': '前置运行库与 API',
      'realistic': '逼真写实',
      'performance': '低配流畅 / 高 FPS',
      'fantasy': '魔幻唯美 / 电影画质',
      'vanilla-plus': '原版增强 (Vanilla+)',
      '16x': '16x 基础分辨率',
      '32x': '32x 清晰分辨率',
      '64x': '64x+ 超清分辨率',
      'pvp': 'PVP 战斗增强',
      'gui': '界面美化 & HUD',
      'worldgen': '世界生成与地形',
      'survival': '生存拓展',
    };
    return zhMap[cat.id.toLowerCase()] || cat.nameEn;
  }
  if (lang === 'ja') {
    const jaMap: Record<string, string> = {
      'all': 'すべてのカテゴリ',
      'optimization': '最適化 & 軽量化',
      'technology': 'テクノロジー & 工業',
      'magic': '魔法 & 魔術',
      'utility': '便利機能 & QoL',
      'adventure': '冒険 & RPG',
      'decoration': '装飾 & 建築',
      'library': '前提ライブラリ & API',
      'realistic': 'リアル調',
      'performance': '軽量 / 高FPS',
      'fantasy': 'ファンタジー / 映画調',
      'vanilla-plus': 'バニラ拡張 (Vanilla+)',
    };
    return jaMap[cat.id.toLowerCase()] || cat.nameEn;
  }
  return cat.nameEn;
}

// Complete Mod Loader list with authentic Modrinth SVGs
interface LoaderOption {
  id: string;
  name: string;
  color: string;
  icon: React.ReactNode;
  isPopular: boolean;
}

const LOADERS_LIST: LoaderOption[] = [
  { id: 'fabric', name: 'Fabric', color: '#dbb78e', icon: <FabricIcon className="w-5 h-5" />, isPopular: true },
  { id: 'forge', name: 'Forge', color: '#dfa863', icon: <ForgeIcon className="w-5 h-5" />, isPopular: true },
  { id: 'neoforge', name: 'NeoForge', color: '#fa8231', icon: <NeoForgeIcon className="w-5 h-5" />, isPopular: true },
  { id: 'quilt', name: 'Quilt', color: '#c56cf0', icon: <QuiltIcon className="w-5 h-5" />, isPopular: true },
  { id: 'babric', name: 'Babric', color: '#a4b0be', icon: <BabricIcon className="w-5 h-5" />, isPopular: false },
  { id: 'bta', name: 'BTA (Babric)', color: '#2ed573', icon: <BtaIcon className="w-5 h-5" />, isPopular: false },
  { id: 'java-agent', name: 'Java Agent', color: '#747d8c', icon: <JavaAgentIcon className="w-5 h-5" />, isPopular: false },
  { id: 'legacy-fabric', name: 'Legacy Fabric', color: '#a4b0be', icon: <LegacyFabricIcon className="w-5 h-5" />, isPopular: false },
  { id: 'liteloader', name: 'LiteLoader', color: '#70a1ff', icon: <LiteLoaderIcon className="w-5 h-5" />, isPopular: false },
  { id: 'risugami', name: "Risugami's ModLoader", color: '#a78bfa', icon: <ModLoaderIcon className="w-5 h-5" />, isPopular: false },
  { id: 'nilloader', name: 'NilLoader', color: '#ff6b81', icon: <NilLoaderIcon className="w-5 h-5" />, isPopular: false },
  { id: 'ornithe', name: 'Ornithe', color: '#54a0ff', icon: <OrnitheIcon className="w-5 h-5" />, isPopular: false },
  { id: 'rift', name: 'Rift', color: '#818cf8', icon: <RiftIcon className="w-5 h-5" />, isPopular: false },
];

function getLoaderColor(loaderId?: string): string {
  if (!loaderId) return '#94a3b8';
  const lower = loaderId.toLowerCase();
  if (lower === 'vanilla' || lower === 'minecraft') return '#48bb78';
  if (lower === 'optifine') return '#e63946';
  if (lower === 'iris') return '#38bdf8';
  const found = LOADERS_LIST.find((l) => l.id.toLowerCase() === lower);
  return found?.color || '#94a3b8';
}

function getLoaderName(loaderId?: string): string {
  if (!loaderId) return '';
  const found = LOADERS_LIST.find((l) => l.id.toLowerCase() === loaderId.toLowerCase());
  return found?.name || (loaderId.charAt(0).toUpperCase() + loaderId.slice(1));
}

// Fallback comprehensive Minecraft release versions
const POPULAR_MC_VERSIONS = [
  '1.21.4', '1.21.3', '1.21.2', '1.21.1', '1.21',
  '1.20.6', '1.20.4', '1.20.2', '1.20.1', '1.20',
  '1.19.4', '1.19.3', '1.19.2', '1.19.1', '1.19',
  '1.18.2', '1.18.1', '1.18',
  '1.17.1', '1.17',
  '1.16.5', '1.16.4', '1.16.3', '1.16.2', '1.16.1',
  '1.15.2', '1.14.4', '1.13.2', '1.12.2', '1.11.2',
  '1.10.2', '1.9.4', '1.8.9', '1.7.10'
];

// Category lists per resource type
const MOD_CATEGORIES = [
  { id: 'all', nameVi: 'Tất cả thể loại', nameEn: 'All Categories' },
  { id: 'optimization', nameVi: 'Tối ưu & FPS', nameEn: 'Optimization' },
  { id: 'technology', nameVi: 'Công nghệ & Máy móc', nameEn: 'Technology' },
  { id: 'magic', nameVi: 'Ma thuật & Phép thuật', nameEn: 'Magic' },
  { id: 'utility', nameVi: 'Tiện ích & QoL', nameEn: 'Utility & QoL' },
  { id: 'adventure', nameVi: 'Phiêu lưu & RPG', nameEn: 'Adventure' },
  { id: 'decoration', nameVi: 'Trang trí & Xây dựng', nameEn: 'Decoration' },
  { id: 'library', nameVi: 'Thư viện & API', nameEn: 'Library & API' },
];

const SHADER_CATEGORIES = [
  { id: 'all', nameVi: 'Tất cả Shaders', nameEn: 'All Shaders' },
  { id: 'realistic', nameVi: 'Thực tế (Realistic)', nameEn: 'Realistic' },
  { id: 'performance', nameVi: 'Máy yếu / FPS cao', nameEn: 'Low-End / Fast' },
  { id: 'fantasy', nameVi: 'Huyền ảo / Điện ảnh', nameEn: 'Fantasy' },
  { id: 'vanilla-plus', nameVi: 'Vanilla+', nameEn: 'Vanilla+' },
];

const RESOURCE_CATEGORIES = [
  { id: 'all', nameVi: 'Tất cả Packs', nameEn: 'All Packs' },
  { id: '16x', nameVi: 'Độ phân giải 16x', nameEn: '16x' },
  { id: '32x', nameVi: 'Độ phân giải 32x', nameEn: '32x' },
  { id: '64x', nameVi: 'Độ phân giải 64x+', nameEn: '64x+' },
  { id: 'pvp', nameVi: 'PVP & Combat', nameEn: 'PVP' },
  { id: 'gui', nameVi: 'Giao diện & HUD', nameEn: 'Interface / GUI' },
];

const DATAPACK_CATEGORIES = [
  { id: 'all', nameVi: 'Tất cả Data Packs', nameEn: 'All Data Packs' },
  { id: 'worldgen', nameVi: 'Tạo Địa Hình & Biomes', nameEn: 'World Generation' },
  { id: 'survival', nameVi: 'Sinh Tồn Mở Rộng', nameEn: 'Survival Expansion' },
  { id: 'magic', nameVi: 'Kỹ Năng & Phép Thuật', nameEn: 'Magic & Skills' },
  { id: 'utility', nameVi: 'Tiện Ích Hệ Thống', nameEn: 'Utility & Mechanics' },
];

const MODPACK_CATEGORIES = [
  { id: 'all', nameVi: 'Tất cả Modpacks', nameEn: 'All Modpacks' },
  { id: 'adventure', nameVi: 'Phiêu Lưu & RPG', nameEn: 'Adventure & RPG' },
  { id: 'technology', nameVi: 'Kỹ Thuật & Công Nghiệp', nameEn: 'Tech & Industrial' },
  { id: 'magic', nameVi: 'Ma Thuật & Huyền Bí', nameEn: 'Magic' },
  { id: 'optimization', nameVi: 'Gói Nhẹ Tối Ưu FPS', nameEn: 'Lightweight & FPS' },
];

// Modrinth-style Authentic Geometric Maze Pattern for cards without banner
const GeometricBannerPattern: React.FC<{ color?: string; id?: string }> = ({ color, id = 'default' }) => {
  const baseBg = color || '#1c1d22';
  const patternId = `mod-pattern-${id.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  return (
    <div
      className="w-full h-full relative overflow-hidden flex items-center justify-center select-none"
      style={{ backgroundColor: baseBg }}
    >
      <div className="absolute inset-0 bg-black/40" />
      <svg
        className="w-full h-full absolute inset-0 opacity-15"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern
            id={patternId}
            width="40"
            height="40"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <path
              d="M 0 10 L 20 10 L 20 30 L 40 30 M 30 0 L 30 10 M 10 30 L 10 40 M 0 30 L 10 30"
              fill="none"
              stroke="#ffffff"
              strokeWidth="6"
              strokeLinecap="square"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${patternId})`} />
      </svg>
    </div>
  );
};

// Grid Card Component matching the user's screenshot
interface ModGridCardProps {
  item: AddonItem;
  isInstalling: boolean;
  isInstalled: boolean;
  isDeduplicated: boolean;
  onInstall: (item: AddonItem) => void;
  language: Language;
  t: any;
  contentType: AddonContentType;
}

const ModGridCard: React.FC<ModGridCardProps> = ({
  item,
  isInstalling,
  isInstalled,
  isDeduplicated,
  onInstall,
  language,
  t,
  contentType,
}) => {
  const [imgError, setImgError] = useState(false);

  // Environment badge
  const renderEnvironmentBadge = () => {
    if (contentType === 'shaderpacks' || contentType === 'resourcepacks') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-300 font-medium">
          <Monitor className="w-3.5 h-3.5 text-slate-400" />
          <span>Client</span>
        </span>
      );
    }
    if (item.environment === 'client') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-300 font-medium">
          <Monitor className="w-3.5 h-3.5 text-slate-400" />
          <span>Client</span>
        </span>
      );
    }
    if (item.environment === 'server') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-300 font-medium">
          <Server className="w-3.5 h-3.5 text-slate-400" />
          <span>Server</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-300 font-medium">
        <Globe className="w-3.5 h-3.5 text-slate-400" />
        <span>Client or server</span>
      </span>
    );
  };

  return (
    <div className="glass-card rounded-2xl border border-white/5 hover:border-white/20 bg-[#18191d]/85 hover:bg-[#1c1e24] transition-all duration-200 hover:shadow-xl hover:shadow-black/30 flex flex-col justify-between overflow-hidden group shadow-sm">
      {/* Top Banner (176px / h-44) */}
      <div className="h-44 w-full relative overflow-hidden bg-slate-950/80 shrink-0">
        {item.bannerUrl && !imgError ? (
          <img
            src={item.bannerUrl}
            alt={item.name}
            onError={() => setImgError(true)}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ease-out"
            loading="lazy"
          />
        ) : (
          <GeometricBannerPattern color={item.color} id={`${item.source}-${item.id}`} />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#18191d] via-transparent to-transparent opacity-60 pointer-events-none" />

        {/* Platform Badge Overlay on Top-Right */}
        <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5">
          {(item.source === 'modrinth' || item.sources?.includes('modrinth') || Boolean(item.modrinthId)) && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-black/60 backdrop-blur-md border border-[#1bd96a]/40 text-[11px] font-bold text-[#1bd96a] shadow-md">
              <ModrinthLogo className="w-3.5 h-3.5" />
              <span>Modrinth</span>
            </span>
          )}
          {(item.source === 'curseforge' || item.sources?.includes('curseforge') || Boolean(item.curseforgeId)) && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-black/60 backdrop-blur-md border border-[#f16436]/40 text-[11px] font-bold text-[#f16436] shadow-md">
              <CurseForgeLogo className="w-3.5 h-3.5" />
              <span>CurseForge</span>
            </span>
          )}
        </div>
      </div>

      {/* Card Body */}
      <div className="p-4 flex-1 flex flex-col justify-between gap-3">
        <div>
          {/* Header Row: Icon + Title + Description */}
          <div className="flex items-start gap-3">
            {/* Mod Icon */}
            <div className="w-11 h-11 rounded-xl bg-slate-950/80 border border-white/10 overflow-hidden flex items-center justify-center shrink-0 shadow-inner">
              {item.iconUrl ? (
                <img
                  src={item.iconUrl}
                  alt={item.name}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              ) : contentType === 'shaderpacks' ? (
                <Sparkles className="w-5 h-5 text-amber-400" />
              ) : contentType === 'resourcepacks' ? (
                <Layers className="w-5 h-5 text-amber-400" />
              ) : contentType === 'datapacks' ? (
                <FileCode className="w-5 h-5 text-amber-400" />
              ) : (
                <Package className="w-5 h-5 text-amber-400" />
              )}
            </div>

            {/* Title & Author */}
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-1.5 flex-wrap min-w-0">
                <a
                  href={item.webUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[15px] font-bold text-white group-hover:text-[var(--accent-light)] transition truncate leading-snug"
                >
                  {item.name}
                </a>
                {item.author && (
                  <span className="text-xs text-slate-400 font-normal truncate">
                    {t.authorBy || 'by'} <strong className="text-slate-300 font-medium">{item.author}</strong>
                  </span>
                )}
              </div>

              {/* Description (2-line clamp) */}
              <p className="text-xs text-slate-300 line-clamp-2 mt-1 leading-relaxed">
                {item.summary || 'No description provided.'}
              </p>
            </div>
          </div>

          {/* Tags Row: Environment + Categories + Loaders */}
          <div className="flex flex-wrap items-center gap-1.5 mt-3">
            {/* Environment Badge */}
            {renderEnvironmentBadge()}

            {/* Category Badges (up to 2 in grid view) */}
            {(item.categories || []).slice(0, 2).map((cat) => (
              <span
                key={cat}
                className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-300 font-medium capitalize"
              >
                {cat}
              </span>
            ))}

            {/* Loader Badges */}
            {(item.loaders && item.loaders.length > 0 ? item.loaders.slice(0, 3) : []).map((loader) => (
              <span
                key={loader}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-xs font-medium"
                style={{ color: getLoaderColor(loader) }}
              >
                {getLoaderIcon(loader, 'w-3.5 h-3.5')}
                <span>{getLoaderName(loader)}</span>
              </span>
            ))}
          </div>
        </div>

        {/* Footer: Stats & Actions */}
        <div className="flex items-center justify-between pt-3 border-t border-white/5 text-xs text-slate-400 font-sans gap-3">
          {/* Stats: Downloads, Favorites, Time Ago */}
          <div className="flex items-center gap-2 sm:gap-2.5 min-w-0 flex-nowrap shrink">
            <span className="flex items-center gap-1 shrink-0 whitespace-nowrap" title={t.downloadsCountTooltip || 'Downloads'}>
              <Download className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <strong className="text-slate-200 font-semibold">{formatCount(item.downloads)}</strong>
            </span>

            {item.follows && item.follows > 0 ? (
              <span className="flex items-center gap-1 shrink-0 whitespace-nowrap" title={t.favoritesCountTooltip || 'Favorites'}>
                <Heart className="w-3.5 h-3.5 text-rose-500/80 shrink-0" />
                <span>{formatCount(item.follows)}</span>
              </span>
            ) : null}

            {item.updatedAt && (
              <span
                className="flex items-center gap-1 text-slate-400 shrink-0 whitespace-nowrap"
                title={`${t.updated || 'Updated'}: ${new Date(item.updatedAt).toLocaleDateString()}`}
              >
                <Clock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                <span>{formatTimeAgo(item.updatedAt, language)}</span>
              </span>
            )}
          </div>

          {/* Action Buttons: Install & Official Link */}
          <div className="flex items-center gap-1.5 shrink-0 pl-2">
            <button
              type="button"
              onClick={() => onInstall(item)}
              disabled={isInstalling || isInstalled}
              className={`py-1.5 px-3 rounded-xl font-bold font-riot text-xs flex items-center gap-1.5 transition cursor-pointer ${
                isInstalled
                  ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shadow-sm'
                  : isInstalling
                  ? 'bg-amber-500/50 text-white animate-pulse'
                  : 'btn-primary text-white shadow-sm hover:shadow-amber-500/20 active:scale-95'
              }`}
            >
              {isInstalled ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>{t.btnInstalled || 'Installed'}</span>
                </>
              ) : isInstalling ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>{t.installing || 'Downloading...'}</span>
                </>
              ) : (
                <>
                  <Download className="w-3.5 h-3.5" />
                  <span>{t.btnInstall || 'Install'}</span>
                </>
              )}
            </button>

            <a
              href={item.webUrl}
              target="_blank"
              rel="noreferrer"
              title={t.viewOfficialWeb || 'View details on official website'}
              className="p-1.5 rounded-xl bg-white/[0.03] border border-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition cursor-pointer active:scale-95"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

export const ModStore: React.FC<ModStoreProps> = ({
  activeInstance,
  instances = [],
  onSelectInstance,
  onOpenCreateModal,
  onOpenInstanceDir,
  onModpackInstalled,
  language = 'en',
  curseForgeApiKey,
}) => {
  const t = getTranslation(language);
  const [isModpackModalOpen, setIsModpackModalOpen] = useState(false);
  const [isDraggingMrpack, setIsDraggingMrpack] = useState(false);
  const [mrpackFilePath, setMrpackFilePath] = useState<string>('');

  const handlePickMrpackFile = async () => {
    try {
      const path = await selectMrpackFile();
      if (!path) return;
      setMrpackFilePath(path);
      setIsModpackModalOpen(true);
    } catch (err) {
      console.error('Failed to pick mrpack file:', err);
    }
  };

  const handleDropMrpack = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingMrpack(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      // File object in Tauri webview typically carries a path property
      const filePath = (file as any).path || file.name;
      if (filePath.toLowerCase().endsWith('.mrpack')) {
        setMrpackFilePath(filePath);
        setIsModpackModalOpen(true);
      } else {
        setNotification({
          type: 'error',
          text: t.mrpackDropInvalid || 'Please drop a valid .mrpack file',
        });
      }
    }
  };

  // SubTab: Store (Browse) vs Installed
  const [activeSubTab, setActiveSubTab] = useState<'store' | 'installed'>('store');

  // Resource Type: mods | resourcepacks | datapacks | shaderpacks | modpacks | plugins | servers
  const [contentType, setContentType] = useState<AddonContentType>('mods');

  // Sliding pill indicator for Resource Types
  const resourceTypeRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [resourcePillStyle, setResourcePillStyle] = useState<{ left: number; width: number; opacity: number }>({
    left: 4,
    width: 0,
    opacity: 0,
  });

  useEffect(() => {
    const updatePill = () => {
      const el = resourceTypeRefs.current[contentType];
      if (el) {
        setResourcePillStyle({
          left: el.offsetLeft,
          width: el.offsetWidth,
          opacity: 1,
        });
      }
    };

    updatePill();
    const timer = setTimeout(updatePill, 40);
    window.addEventListener('resize', updatePill);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updatePill);
    };
  }, [contentType, activeSubTab]);

  // Download Sources: multi-select checkboxes (Modrinth & CurseForge)
  const [sources, setSources] = useState<{ modrinth: boolean; curseforge: boolean }>({
    modrinth: true,
    curseforge: true,
  });

  // Target Profile Selector
  const [isProfilePickerOpen, setIsProfilePickerOpen] = useState(false);
  const profilePickerRef = useRef<HTMLDivElement>(null);

  // Game Version Filter State
  const [allVersions, setAllVersions] = useState<string[]>(POPULAR_MC_VERSIONS);
  const [selectedVersion, setSelectedVersion] = useState<string>(activeInstance?.gameVersion || '1.21.4');
  const [versionSearchQuery, setVersionSearchQuery] = useState<string>('');

  // Mod Loader Filter State
  const [selectedLoader, setSelectedLoader] = useState<string>(activeInstance?.loader || 'fabric');

  // Environment Filter State (Image 2: Client / Server)
  const [environment, setEnvironment] = useState<'all' | 'client' | 'server'>('all');

  // Specific Category Filter
  const [categoryFilter, setCategoryFilter] = useState('all');

  // Sort & Pagination controls
  const [sortBy, setSortBy] = useState<'relevance' | 'downloads' | 'newest' | 'published'>('relevance');
  const [pageSize, setPageSize] = useState<number>(20);
  const [page, setPage] = useState<number>(1);
  const [totalItems, setTotalItems] = useState<number>(0);

  // View mode: Grid vs List (defaulting to grid, persisted in localStorage)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => {
    try {
      return (localStorage.getItem('mcl_modstore_view_mode') as 'grid' | 'list') || 'grid';
    } catch {
      return 'grid';
    }
  });

  const handleViewModeChange = (mode: 'grid' | 'list') => {
    setViewMode(mode);
    try {
      localStorage.setItem('mcl_modstore_view_mode', mode);
    } catch {
      // ignore
    }
  };

  // Custom Dropdowns for Sort and Display count
  const [isSortDropdownOpen, setIsSortDropdownOpen] = useState(false);
  const [isPageSizeDropdownOpen, setIsPageSizeDropdownOpen] = useState(false);
  const sortDropdownRef = useRef<HTMLDivElement>(null);
  const pageSizeDropdownRef = useRef<HTMLDivElement>(null);

  // Search input state
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  // Search results & Installed state
  const [items, setItems] = useState<AddonItem[]>([]);
  const [installedItems, setInstalledItems] = useState<LocalMod[]>([]);
  const [installedContentType, setInstalledContentType] = useState<AddonContentType>('mods');

  // Sliding pill indicator for Installed Content Type
  const installedTypeRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [installedPillStyle, setInstalledPillStyle] = useState<{ left: number; width: number; opacity: number }>({
    left: 4,
    width: 0,
    opacity: 0,
  });

  useEffect(() => {
    const updateInstalledPill = () => {
      const el = installedTypeRefs.current[installedContentType];
      if (el) {
        setInstalledPillStyle({
          left: el.offsetLeft,
          width: el.offsetWidth,
          opacity: 1,
        });
      }
    };

    updateInstalledPill();
    const timer = setTimeout(updateInstalledPill, 40);
    window.addEventListener('resize', updateInstalledPill);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updateInstalledPill);
    };
  }, [installedContentType, activeSubTab]);
  const [loading, setLoading] = useState(false);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  // Installed Tab Search, Filters, Sorting, View Mode and Pagination
  const [installedSearchQuery, setInstalledSearchQuery] = useState('');
  const [debouncedInstalledQuery, setDebouncedInstalledQuery] = useState('');
  const [installedSortBy, setInstalledSortBy] = useState<
    'name-asc' | 'name-desc' | 'size-desc' | 'size-asc' | 'status-enabled' | 'status-disabled'
  >('name-asc');
  const [installedStatusFilter, setInstalledStatusFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [installedPage, setInstalledPage] = useState<number>(1);
  const [installedPageSize, setInstalledPageSize] = useState<number>(10);
  const [installedViewMode, setInstalledViewMode] = useState<'grid' | 'list'>(() => {
    try {
      return (localStorage.getItem('mcl_installed_view_mode') as 'grid' | 'list') || 'list';
    } catch {
      return 'list';
    }
  });

  const handleInstalledViewModeChange = (mode: 'grid' | 'list') => {
    setInstalledViewMode(mode);
    try {
      localStorage.setItem('mcl_installed_view_mode', mode);
    } catch {
      // ignore
    }
  };

  const [isInstalledSortDropdownOpen, setIsInstalledSortDropdownOpen] = useState(false);
  const [isInstalledPageSizeDropdownOpen, setIsInstalledPageSizeDropdownOpen] = useState(false);
  const [isInstalledStatusDropdownOpen, setIsInstalledStatusDropdownOpen] = useState(false);
  const installedSortDropdownRef = useRef<HTMLDivElement>(null);
  const installedPageSizeDropdownRef = useRef<HTMLDivElement>(null);
  const installedStatusDropdownRef = useRef<HTMLDivElement>(null);
  const installedListTopRef = useRef<HTMLDivElement>(null);
  const mainScrollContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);

  // Debounce installed search query (250ms)
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedInstalledQuery(installedSearchQuery);
      setInstalledPage(1);
    }, 250);
    return () => clearTimeout(handler);
  }, [installedSearchQuery]);

  // Reset page & search on content type switch
  useEffect(() => {
    setInstalledPage(1);
    setInstalledSearchQuery('');
  }, [installedContentType]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const top = e.currentTarget.scrollTop;
    if (top > 250 && !showScrollTop) {
      setShowScrollTop(true);
    } else if (top <= 250 && showScrollTop) {
      setShowScrollTop(false);
    }
  };

  const scrollToInstalledTop = () => {
    if (installedListTopRef.current) {
      installedListTopRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (mainScrollContainerRef.current) {
      mainScrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (profilePickerRef.current && !profilePickerRef.current.contains(e.target as Node)) {
        setIsProfilePickerOpen(false);
      }
      if (sortDropdownRef.current && !sortDropdownRef.current.contains(e.target as Node)) {
        setIsSortDropdownOpen(false);
      }
      if (pageSizeDropdownRef.current && !pageSizeDropdownRef.current.contains(e.target as Node)) {
        setIsPageSizeDropdownOpen(false);
      }
      if (installedSortDropdownRef.current && !installedSortDropdownRef.current.contains(e.target as Node)) {
        setIsInstalledSortDropdownOpen(false);
      }
      if (installedPageSizeDropdownRef.current && !installedPageSizeDropdownRef.current.contains(e.target as Node)) {
        setIsInstalledPageSizeDropdownOpen(false);
      }
      if (installedStatusDropdownRef.current && !installedStatusDropdownRef.current.contains(e.target as Node)) {
        setIsInstalledStatusDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Sync selected version & loader when active profile changes
  useEffect(() => {
    if (activeInstance?.gameVersion) {
      setSelectedVersion(activeInstance.gameVersion);
    }
    if (activeInstance?.loader) {
      setSelectedLoader(activeInstance.loader);
    }
  }, [activeInstance?.id, activeInstance?.gameVersion, activeInstance?.loader]);

  // Fetch full list of Minecraft release versions from Mojang
  useEffect(() => {
    const loadMojangVersions = async () => {
      try {
        const data = await fetchMojangVersions();
        if (data.versions && Array.isArray(data.versions)) {
          const releases = data.versions
            .filter((v: any) => v.type === 'release')
            .map((v: any) => v.id);

          const merged = Array.from(new Set([...releases, ...POPULAR_MC_VERSIONS]));
          setAllVersions(merged);
        }
      } catch (err) {
        console.warn('Failed to load Mojang versions, using default list:', err);
      }
    };
    loadMojangVersions();
  }, []);

  // Debounce search query input (400ms)
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedQuery(searchQuery);
      setPage(1);
    }, 400);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  // Current category list according to content type
  const activeCategories = useMemo(() => {
    switch (contentType) {
      case 'shaderpacks':
        return SHADER_CATEGORIES;
      case 'resourcepacks':
        return RESOURCE_CATEGORIES;
      case 'datapacks':
        return DATAPACK_CATEGORIES;
      case 'modpacks':
        return MODPACK_CATEGORIES;
      case 'mods':
      default:
        return MOD_CATEGORIES;
    }
  }, [contentType]);

  // Filtered versions based on search query in Game Version box
  const filteredVersions = useMemo(() => {
    if (!versionSearchQuery.trim()) return allVersions;
    const q = versionSearchQuery.trim().toLowerCase();
    return allVersions.filter((v) => v.toLowerCase().includes(q));
  }, [allVersions, versionSearchQuery]);

  // Effective game version (if 'all' or empty string -> undefined)
  const effectiveVersion = useMemo(() => {
    if (!selectedVersion || selectedVersion === 'all') return undefined;
    return selectedVersion;
  }, [selectedVersion]);

  // Effective loader
  const effectiveLoader = useMemo(() => {
    if (contentType !== 'mods') return undefined;
    if (!selectedLoader || selectedLoader === 'all') return undefined;
    return selectedLoader;
  }, [contentType, selectedLoader]);

  // Toggle Source Checkbox (Prevent unchecking both)
  const handleToggleSource = (target: 'modrinth' | 'curseforge') => {
    setSources((prev) => {
      const nextState = { ...prev, [target]: !prev[target] };
      if (!nextState.modrinth && !nextState.curseforge) {
        return prev;
      }
      setPage(1);
      return nextState;
    });
  };

  // Perform Multi-Source Search
  const fetchAddons = async () => {
    if (!activeInstance) return;
    setLoading(true);

    try {
      const offset = (page - 1) * pageSize;
      const res = await searchAddonsMultiSource({
        query: debouncedQuery,
        contentType,
        sources,
        gameVersion: effectiveVersion,
        loader: effectiveLoader,
        categoryFilter: categoryFilter !== 'all' ? categoryFilter : undefined,
        sortBy,
        environment,
        curseForgeApiKey,
        limit: pageSize,
        offset,
      });

      setItems(res.items);
      setTotalItems(res.total);
    } catch (err) {
      console.error('Failed to search addons:', err);
      setItems([]);
      setTotalItems(0);
    } finally {
      setLoading(false);
    }
  };

  // Fetch when search dependencies change
  useEffect(() => {
    if (activeInstance && activeSubTab === 'store') {
      fetchAddons();
    }
  }, [
    activeInstance?.id,
    activeSubTab,
    debouncedQuery,
    contentType,
    sources.modrinth,
    sources.curseforge,
    effectiveVersion,
    effectiveLoader,
    environment,
    categoryFilter,
    sortBy,
    pageSize,
    page,
  ]);

  // Fetch installed addons
  const loadInstalledItems = async () => {
    if (!activeInstance) return;
    try {
      const list = await getInstalledAddons(activeInstance.id, installedContentType);
      setInstalledItems(list || []);
    } catch (err) {
      console.error('Failed to load installed addons:', err);
    }
  };

  useEffect(() => {
    if (activeInstance) {
      loadInstalledItems();
    }
  }, [activeInstance?.id, installedContentType, activeSubTab]);

  // Handle Addon Installation (with deduplication fallback support)
  const handleInstall = async (item: AddonItem) => {
    if (!activeInstance) return;
    setInstallingId(item.id);
    setNotification(null);

    try {
      let downloadUrl: string | null = null;
      let fileName = '';
      let fileSha1: string | undefined;
      let installedProjectId: string | undefined;
      // Recorded alongside the project id so a shared profile can ask the right platform
      // for the right file, rather than guessing from a file name.
      let installedSource: AddonSource | undefined;
      let installedVersionId: string | undefined;
      let requiredDependencies: string[] = [];

      // 1. If available on Modrinth, attempt Modrinth direct download first
      if (item.modrinthId || item.source === 'modrinth') {
        const info = await getModrinthDownloadInfo(
          item.modrinthId || item.id,
          effectiveVersion || activeInstance.gameVersion,
          effectiveLoader || activeInstance.loader
        );
        if (info && info.url) {
          downloadUrl = info.url;
          fileName = info.fileName;
          fileSha1 = info.sha1;
          installedProjectId = item.modrinthId || item.id;
          installedSource = 'modrinth';
          installedVersionId = info.versionId;
          requiredDependencies = info.requiredDependencies || [];
        }
      }

      // 2. If Modrinth had no compatible file or item is CurseForge, attempt CurseForge
      if (!downloadUrl && (item.curseforgeId || item.source === 'curseforge')) {
        const info = await getCurseForgeDownloadInfo(
          item.curseforgeId || item.id,
          effectiveVersion || activeInstance.gameVersion,
          effectiveLoader || activeInstance.loader,
          curseForgeApiKey
        );
        if (info.url) {
          downloadUrl = info.url;
          fileName = info.fileName;
          installedProjectId = item.curseforgeId || item.id;
          installedSource = 'curseforge';
          installedVersionId = info.versionId;
        } else if (!info.directAllowed) {
          window.open(item.webUrl, '_blank');
          setNotification({
            type: 'info',
            text:
              language === 'vi'
                ? (t.thirdPartyNotice || 'Tác giả mod này khóa tải bên thứ ba. Trình duyệt đã mở để bạn tải file và kéo thả vào launcher.')
                : (t.thirdPartyNotice || 'The author of this mod requires direct web download. Browser opened to download file.'),
          });
          return;
        }
      }

      if (!downloadUrl) {
        setNotification({
          type: 'error',
          text:
            t.noCompatibleFile ||
            (language === 'vi'
              ? 'Không tìm thấy tệp tải phù hợp với phiên bản game hiện tại.'
              : 'No compatible file found for the current game version.'),
        });
        return;
      }

      const installed = await installAddon(activeInstance.id, downloadUrl, fileName, contentType, {
        sha1: fileSha1,
        projectId: installedProjectId,
        source: installedSource,
        versionId: installedVersionId,
      });
      setInstalledItems((prev) => [installed, ...prev]);
      item.isInstalled = true;

      // Mods such as Sodium refuse to load without their required libraries, so pull those
      // in as well rather than letting the game crash on startup
      for (const dependencyId of requiredDependencies) {
        try {
          const depInfo = await getModrinthDownloadInfo(
            dependencyId,
            effectiveVersion || activeInstance.gameVersion,
            effectiveLoader || activeInstance.loader
          );
          if (!depInfo?.url) continue;
          const depInstalled = await installAddon(
            activeInstance.id,
            depInfo.url,
            depInfo.fileName,
            contentType,
            {
              sha1: depInfo.sha1,
              projectId: dependencyId,
              source: 'modrinth',
              versionId: depInfo.versionId,
            }
          );
          setInstalledItems((prev) =>
            prev.some((p) => p.fileName === depInstalled.fileName) ? prev : [depInstalled, ...prev]
          );
        } catch (depErr) {
          console.warn('Could not install a required dependency:', dependencyId, depErr);
        }
      }

      setNotification({
        type: 'success',
        text: `${t.installSuccess || 'Installed successfully!'} (${fileName}) - ${activeInstance.name}`,
      });

      setTimeout(() => setNotification(null), 4500);
    } catch (err: any) {
      console.error('Install failed:', err);
      setNotification({
        type: 'error',
        text: err?.toString() || t.installFailed || 'Installation failed.',
      });
    } finally {
      setInstallingId(null);
    }
  };

  // Toggle enable/disable installed addon
  const handleToggleInstalled = async (item: LocalMod) => {
    if (!activeInstance) return;
    const oldFileName = item.fileName;
    const nextEnabled = !item.enabled;
    const newFileName = nextEnabled
      ? oldFileName.replace(/\.disabled$/i, '')
      : (oldFileName.endsWith('.disabled') ? oldFileName : `${oldFileName}.disabled`);

    // 1. Instant optimistic UI update so ToggleSwitch animates smoothly at 60fps immediately
    setInstalledItems((prev) =>
      prev.map((m) =>
        m.fileName === oldFileName
          ? { ...m, enabled: nextEnabled, fileName: newFileName }
          : m
      )
    );

    // 2. Perform backend rename in background
    try {
      await toggleAddon(activeInstance.id, installedContentType, oldFileName, nextEnabled);
      const fresh = await getInstalledAddons(activeInstance.id, installedContentType);
      setInstalledItems(fresh || []);
    } catch (err) {
      console.error('Toggle failed:', err);
      // Rollback on error
      setInstalledItems((prev) =>
        prev.map((m) =>
          m.fileName === newFileName
            ? { ...m, enabled: item.enabled, fileName: oldFileName }
            : m
        )
      );
    }
  };

  // Delete installed addon
  const handleDeleteInstalled = async (item: LocalMod) => {
    if (!activeInstance) return;
    try {
      await deleteAddon(activeInstance.id, installedContentType, item.fileName);
      await loadInstalledItems();
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  // Filtered and Sorted installed addons
  const filteredAndSortedInstalled = useMemo(() => {
    let result = [...installedItems];

    // Search query filter
    if (debouncedInstalledQuery.trim()) {
      const q = debouncedInstalledQuery.trim().toLowerCase();
      result = result.filter(
        (mod) =>
          mod.name.toLowerCase().includes(q) ||
          mod.fileName.toLowerCase().includes(q) ||
          (mod.version && mod.version.toLowerCase().includes(q))
      );
    }

    // Status filter
    if (installedStatusFilter === 'enabled') {
      result = result.filter((mod) => mod.enabled);
    } else if (installedStatusFilter === 'disabled') {
      result = result.filter((mod) => !mod.enabled);
    }

    // Sort
    result.sort((a, b) => {
      switch (installedSortBy) {
        case 'name-asc':
          return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
        case 'name-desc':
          return b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: 'base' });
        case 'size-desc':
          return b.sizeBytes - a.sizeBytes;
        case 'size-asc':
          return a.sizeBytes - b.sizeBytes;
        case 'status-enabled':
          return (b.enabled ? 1 : 0) - (a.enabled ? 1 : 0);
        case 'status-disabled':
          return (a.enabled ? 1 : 0) - (b.enabled ? 1 : 0);
        default:
          return 0;
      }
    });

    return result;
  }, [installedItems, debouncedInstalledQuery, installedStatusFilter, installedSortBy]);

  const totalInstalledPages = Math.max(1, Math.ceil(filteredAndSortedInstalled.length / installedPageSize));

  const pagedInstalledItems = useMemo(() => {
    const start = (installedPage - 1) * installedPageSize;
    return filteredAndSortedInstalled.slice(start, start + installedPageSize);
  }, [filteredAndSortedInstalled, installedPage, installedPageSize]);

  useEffect(() => {
    if (installedPage > totalInstalledPages) {
      setInstalledPage(1);
    }
  }, [totalInstalledPages, installedPage]);

  // Calculate total pages
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  if (!activeInstance) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4">
        <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center">
          <Package className="w-8 h-8" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white font-riot">{t.noProfileTitle || 'No Profile Selected'}</h2>
          <p className="text-xs text-slate-400 mt-1 max-w-md">
            {t.noProfileDesc || 'No profile is currently available to manage mods. Create a new profile to get started.'}
          </p>
        </div>
        {onOpenCreateModal && (
          <button
            onClick={onOpenCreateModal}
            className="btn-primary py-2.5 px-6 rounded-xl font-riot font-bold text-xs flex items-center gap-2 shadow-lg cursor-pointer"
          >
            {t.btnCreateNewProfile || 'Create New Profile'}
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      ref={mainScrollContainerRef}
      onScroll={handleScroll}
      className="flex-1 flex flex-col overflow-y-auto [scrollbar-gutter:stable] p-10 space-y-7 custom-scrollbar relative"
    >
      {/* Top Header: Title & Description */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pr-12">
        <div>
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[var(--accent-color)]/10 border border-[var(--accent-color)]/20 text-[var(--accent-color)] text-xs font-semibold mb-2 tracking-wide">
            <Package className="w-4 h-4" />
            <span>{t.badgeMods || 'Mods & Shaders'}</span>
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-normal">
            {t.modsTitle || 'Mods, Shaders & Packs Store'}
          </h1>
          <p className="text-base text-slate-300 mt-1 tracking-wide">
            {t.modsSub || 'Discover and install addons from Modrinth & CurseForge'}
          </p>
        </div>
      </div>

      {/* Notification Toast Banner */}
      {notification && (
        <div
          className={`p-3.5 rounded-2xl border flex items-center justify-between gap-3 text-xs animate-smooth-in ${
            notification.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : notification.type === 'error'
              ? 'bg-red-500/10 border-red-500/30 text-red-300'
              : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {notification.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
            )}
            <span>{notification.text}</span>
          </div>
          <button
            onClick={() => setNotification(null)}
            className="p-1 hover:bg-white/10 rounded-lg transition text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Control Deck (2 Hierarchical Rows):
          Row 1: Profile Picker (enlarged, on left) & Browse vs Installed Switcher (on right)
          Row 2: Resource Types (on left) & Download Sources (on right) */}
      <div className="space-y-3.5">
        {/* Row 1: Profile Selector on Left (above Resource Capsule) | Browse vs Installed on Right (above Download Sources) */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          {/* Target Profile Picker (Enlarged & Prominent for easy visibility) */}
          <div className="relative min-w-[300px]" ref={profilePickerRef}>
            <button
              type="button"
              onClick={() => setIsProfilePickerOpen(!isProfilePickerOpen)}
              className="w-full flex items-center justify-between gap-3.5 px-4 py-2.5 rounded-2xl bg-[#161719] hover:bg-[#1f2125] border border-white/10 hover:border-white/20 text-xs transition-colors duration-200 cursor-pointer group shadow-md select-none"
              title={t.changeProfileTooltip || 'Change target profile for mods'}
            >
              {(() => {
                const activeLoaderColor = getLoaderColor(activeInstance.loader);
                return (
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform duration-200 shadow-inner"
                      style={{
                        backgroundColor: `${activeLoaderColor}1a`,
                        borderColor: `${activeLoaderColor}40`,
                        borderWidth: '1px',
                        borderStyle: 'solid',
                        color: activeLoaderColor,
                      }}
                    >
                      {getLoaderIcon(activeInstance.loader, 'w-5 h-5')}
                    </div>
                    <div className="text-left min-w-0">
                      <div className="text-xs text-slate-400 font-medium leading-none mb-1">{t.installForProfile || 'Install for profile:'}</div>
                      <div className="text-sm font-bold text-white flex items-center gap-2 truncate max-w-[240px]">
                        <span className="truncate">{activeInstance.name}</span>
                        <span
                          className="text-xs px-2 py-0.5 rounded-md font-sans font-semibold shrink-0 border"
                          style={{
                            backgroundColor: `${activeLoaderColor}15`,
                            borderColor: `${activeLoaderColor}30`,
                            color: activeLoaderColor,
                          }}
                        >
                          {activeInstance.gameVersion}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })()}
              <ChevronDown
                className={`w-4 h-4 text-slate-400 group-hover:text-white transition-transform duration-200 ml-1 shrink-0 ${
                  isProfilePickerOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {/* Profile Dropdown Menu: Width exactly matches original box above (left-0 right-0 w-full) */}
            {isProfilePickerOpen && (
              <div className="absolute top-full left-0 right-0 mt-2 w-full rounded-2xl bg-[#18191c] border border-white/15 shadow-2xl p-2.5 z-50 animate-dropdown space-y-1">
                <div className="px-2.5 py-1.5 text-xs font-bold uppercase tracking-wider text-slate-400 border-b border-white/5 flex items-center justify-between">
                  <span>{t.selectTargetProfile || 'Select Target Profile'}</span>
                  <span className="text-amber-400 font-sans font-bold">{instances.length || 1} {t.totalProfilesCount || 'profiles'}</span>
                </div>
                <div className="max-h-60 overflow-y-auto custom-scrollbar space-y-1 pt-1">
                  {(instances.length > 0 ? instances : [activeInstance]).map((inst) => {
                    const isCurrent = inst.id === activeInstance.id;
                    const instColor = getLoaderColor(inst.loader);
                    return (
                      <button
                        key={inst.id}
                        type="button"
                        onClick={() => {
                          onSelectInstance?.(inst.id);
                          setSelectedVersion(inst.gameVersion);
                          setSelectedLoader(inst.loader);
                          setIsProfilePickerOpen(false);
                        }}
                        className={`w-full flex items-center justify-between p-2.5 rounded-xl text-xs font-medium transition-colors duration-150 cursor-pointer text-left border ${
                          isCurrent
                            ? 'bg-white/10 text-white border-white/20 shadow-sm'
                            : 'text-slate-300 hover:text-white hover:bg-white/5 border-transparent'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div
                            className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border"
                            style={{
                              backgroundColor: `${instColor}18`,
                              borderColor: `${instColor}35`,
                              color: instColor,
                            }}
                          >
                            {getLoaderIcon(inst.loader, 'w-4 h-4')}
                          </div>
                          <div className="truncate flex-1 min-w-0">
                            <div className="text-xs font-semibold truncate text-white">{inst.name}</div>
                            <div className="text-xs text-slate-400 font-sans mt-0.5">
                              MC {inst.gameVersion} • <span className="uppercase font-semibold" style={{ color: instColor }}>{inst.loader}</span>
                            </div>
                          </div>
                        </div>
                        <Check className={`w-4 h-4 shrink-0 ml-2 transition-opacity duration-150 ${isCurrent ? 'opacity-100' : 'opacity-0'}`} style={{ color: instColor }} />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* SubTab Switcher: Store vs Installed (Smooth Sliding Pill, Fixed Equal Geometry, Zero Layout Shift) */}
          <div className="relative inline-grid grid-cols-2 p-1 rounded-2xl bg-[#161719] border border-white/10 shrink-0 font-sans shadow-sm select-none">
            {/* Smooth Sliding Pill Indicator */}
            <div
              aria-hidden="true"
              className="absolute top-1 bottom-1 left-1 w-[calc(50%-4px)] rounded-xl bg-[var(--accent-color)] shadow-md shadow-[var(--accent-subtle)] pointer-events-none transition-transform duration-300"
              style={{
                transform: activeSubTab === 'store' ? 'translateX(0%)' : 'translateX(100%)',
                transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            />

            {/* Tab 1: Browse Addons */}
            <button
              type="button"
              onClick={() => setActiveSubTab('store')}
              className={`relative z-10 px-4 py-2 rounded-xl text-sm font-bold font-sans tracking-normal transition-colors duration-200 cursor-pointer flex items-center justify-center text-center whitespace-nowrap min-w-[136px] ${
                activeSubTab === 'store'
                  ? 'text-[#070a12]'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <span>{t.tabStore || 'Browse Addons'}</span>
            </button>

            {/* Tab 2: Installed */}
            <button
              type="button"
              onClick={() => setActiveSubTab('installed')}
              className={`relative z-10 px-4 py-2 rounded-xl text-sm font-bold font-sans tracking-normal transition-colors duration-200 cursor-pointer flex items-center justify-center gap-2 text-center whitespace-nowrap min-w-[136px] ${
                activeSubTab === 'installed'
                  ? 'text-[#070a12]'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <span>{t.tabInstalled || 'Installed'}</span>
              <span
                className={`px-2 py-0.5 rounded-full text-xs font-sans font-bold transition-colors duration-200 ${
                  activeSubTab === 'installed'
                    ? 'bg-black/20 text-[#070a12]'
                    : 'bg-white/10 text-slate-300'
                }`}
              >
                {installedItems.length}
              </span>
            </button>
          </div>
        </div>

        {/* Row 2 (When on Browse Tab): Resource Types on Left | Download Sources on Right */}
        {activeSubTab === 'store' && (
          <div className="flex flex-wrap items-center justify-between gap-4 animate-smooth-in">
            {/* 1. Resource Type Capsule (Positioned directly underneath Profile Selector) */}
            <div className="relative inline-flex items-center p-1 rounded-2xl bg-[#161719] border border-white/10 shadow-sm overflow-x-auto max-w-full custom-scrollbar select-none">
              {/* Smooth Sliding Pill Indicator with theme accent color */}
              <div
                aria-hidden="true"
                className="absolute top-1 bottom-1 left-0 rounded-xl bg-[var(--accent-color)] shadow-md shadow-[var(--accent-subtle)] pointer-events-none transition-all duration-300"
                style={{
                  transform: `translateX(${resourcePillStyle.left}px)`,
                  width: `${resourcePillStyle.width}px`,
                  opacity: resourcePillStyle.opacity,
                  transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
                }}
              />

              {getResourceTypes(t).map((type) => {
                const isActive = contentType === type.id;
                return (
                  <button
                    key={type.id}
                    ref={(el) => {
                      resourceTypeRefs.current[type.id] = el;
                    }}
                    type="button"
                    onClick={() => {
                      setContentType(type.id);
                      setCategoryFilter('all');
                      setPage(1);
                    }}
                    className={`relative z-10 px-4 py-2 rounded-xl text-sm font-bold font-sans transition-colors duration-200 whitespace-nowrap cursor-pointer ${
                      isActive
                        ? 'text-[#070a12]'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    {type.label}
                  </button>
                );
              })}
            </div>

            {/* 2. Download Sources Bar (Positioned directly underneath Browse/Installed switcher) */}
            <div className="inline-flex items-center gap-2 p-1 rounded-2xl bg-[#161719] border border-white/10 shadow-sm text-sm font-sans">
              <span className="text-xs text-slate-400 font-semibold pl-3 pr-1">{t.sourceLabel || 'Source:'}</span>

              {/* Modrinth Toggle with Official Logo (#1bd96a) */}
              <button
                type="button"
                onClick={() => handleToggleSource('modrinth')}
                className={`px-3.5 py-2 rounded-xl text-sm font-bold transition-colors duration-150 cursor-pointer flex items-center gap-2 ${
                  sources.modrinth
                    ? 'bg-[#1bd96a]/15 text-[#1bd96a] border border-[#1bd96a]/50 shadow-sm'
                    : 'text-slate-500 hover:text-slate-300 border border-transparent hover:bg-white/5'
                }`}
                title={t.toggleModrinth || 'Toggle Modrinth source'}
              >
                <ModrinthLogo className="w-4 h-4 shrink-0" />
                <span>Modrinth</span>
              </button>

              {/* CurseForge Toggle with Official Logo & Flame Orange (#f16436) */}
              <button
                type="button"
                onClick={() => handleToggleSource('curseforge')}
                className={`px-3.5 py-2 rounded-xl text-sm font-bold transition-colors duration-150 cursor-pointer flex items-center gap-2 ${
                  sources.curseforge
                    ? 'bg-[#f16436]/15 text-[#f16436] border border-[#f16436]/50 shadow-sm'
                    : 'text-slate-500 hover:text-slate-300 border border-transparent hover:bg-white/5'
                }`}
                title={t.toggleCurseForge || 'Toggle CurseForge source'}
              >
                <CurseForgeLogo className="w-4 h-4 shrink-0" />
                <span>CurseForge</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {activeSubTab === 'store' ? (
        <div key="store-tab" className="space-y-6 animate-tab-switch">
          {/* 2-Column Body: Left Filters Sidebar & Right Results Area */}
          <div className="flex flex-col lg:flex-row items-start gap-6">
            {/* LEFT SIDEBAR: FILTERS */}
            <div className="w-full lg:w-72 shrink-0 space-y-4">
              {/* Filter 1: Game Version (Clean list with prominent font, no show all checkbox) */}
              <div className="glass-panel p-4 rounded-2xl border border-white/5 space-y-3">
                <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-400">
                  <span>{t.filterVersion || 'Game version'}</span>
                  {selectedVersion && selectedVersion !== 'all' ? (
                    <button
                      onClick={() => {
                        setSelectedVersion('all');
                        setPage(1);
                      }}
                      className="text-[10px] text-amber-400 hover:underline flex items-center gap-1 font-sans capitalize"
                    >
                      <span>{t.allLabel || 'All'}</span>
                    </button>
                  ) : (
                    <span className="text-[10px] text-slate-500 font-mono">{t.allLabel || 'All'}</span>
                  )}
                </div>

                {/* Quick Search Version Input */}
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder={t.searchVersionPlaceholder || 'Search version...'}
                    value={versionSearchQuery}
                    onChange={(e) => setVersionSearchQuery(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
                  />
                  {versionSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setVersionSearchQuery('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                {/* Scrollable Version List with Synchronized Bold Typography */}
                <div className="max-h-52 overflow-y-auto custom-scrollbar space-y-1 pr-1">
                  {/* Top "All Versions" option */}
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedVersion('all');
                      setPage(1);
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all duration-150 cursor-pointer text-left border-2 ${
                      selectedVersion === 'all'
                        ? 'bg-[var(--accent-color)]/[0.04] text-white border-[var(--accent-color)] shadow-sm'
                        : 'text-slate-400 hover:text-white hover:bg-white/[0.04] border-transparent'
                    }`}
                  >
                    <span>{t.allVersionsFull || 'All Versions'}</span>
                    <Check className={`w-3.5 h-3.5 text-[var(--accent-color)] shrink-0 transition-opacity duration-150 ${selectedVersion === 'all' ? 'opacity-100' : 'opacity-0'}`} />
                  </button>

                  {filteredVersions.map((v) => {
                    const isSelected = selectedVersion === v;
                    const isProfileDefault = v === activeInstance.gameVersion;

                    return (
                      <button
                        key={v}
                        type="button"
                        onClick={() => {
                          // Toggle: clicking active version deselects it to 'all'
                          setSelectedVersion(isSelected ? 'all' : v);
                          setPage(1);
                        }}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-xl transition-all duration-150 cursor-pointer text-left group border-2 ${
                          isSelected
                            ? 'bg-[var(--accent-color)]/[0.04] text-white border-[var(--accent-color)] shadow-sm'
                            : 'text-slate-300 hover:text-white hover:bg-white/[0.04] border-transparent'
                        }`}
                      >
                        <span className={`text-sm font-bold font-sans tracking-wide transition-colors ${isSelected ? 'text-white' : 'text-slate-200 group-hover:text-white'}`}>
                          {v}
                        </span>
                        {isProfileDefault && (
                          <span className="text-[10px] px-2 py-0.5 rounded-md bg-[var(--accent-color)]/[0.08] border border-[var(--accent-color)]/30 text-[var(--accent-light)] font-medium shrink-0">
                            {t.profileBadge || 'Profile'}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Filter 2: Mod Loader (Expanded with all loaders from Image 1) */}
              {contentType === 'mods' && (
                <div className="glass-panel p-4 rounded-2xl border border-white/5 space-y-3">
                  <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-400">
                    <span>{t.filterLoader || 'Loader'}</span>
                    {selectedLoader && selectedLoader !== 'all' && (
                      <button
                        onClick={() => {
                          setSelectedLoader('all');
                          setPage(1);
                        }}
                        className="text-[10px] text-amber-400 hover:underline capitalize"
                      >
                        {t.allLabel || 'All'}
                      </button>
                    )}
                  </div>

                  <div className="max-h-52 overflow-y-auto custom-scrollbar space-y-1 pr-1">
                    {LOADERS_LIST.map((ldr) => {
                      const isSelected = selectedLoader.toLowerCase() === ldr.id.toLowerCase();
                      const isProfileLoader = activeInstance.loader.toLowerCase() === ldr.id.toLowerCase();

                      return (
                        <button
                          key={ldr.id}
                          type="button"
                          onClick={() => {
                            setSelectedLoader(isSelected ? 'all' : ldr.id);
                            setPage(1);
                          }}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-xl transition-all duration-150 cursor-pointer text-left group border-2 ${
                            isSelected
                              ? 'bg-[var(--accent-color)]/[0.04] text-white border-[var(--accent-color)] shadow-sm'
                              : 'text-slate-300 hover:text-white hover:bg-white/[0.04] border-transparent'
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <span style={{ color: ldr.color }} className="w-5 h-5 shrink-0 flex items-center justify-center">
                              {ldr.icon}
                            </span>
                            <span className={`text-sm font-bold font-sans tracking-wide transition-colors ${isSelected ? 'text-white' : 'text-slate-200 group-hover:text-white'}`}>
                              {ldr.name}
                            </span>
                          </div>

                          {isProfileLoader && (
                            <span className="text-[10px] px-2 py-0.5 rounded-md bg-[var(--accent-color)]/[0.08] border border-[var(--accent-color)]/30 text-[var(--accent-light)] font-medium shrink-0">
                              {t.profileBadge || 'Profile'}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Filter 3: Environment (Image 2: Client / Server) */}
              <div className="glass-panel p-4 rounded-2xl border border-white/5 space-y-3">
                <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-400">
                  <span>{t.filterEnvironment || 'Environment'}</span>
                  {environment !== 'all' && (
                    <button
                      onClick={() => {
                        setEnvironment('all');
                        setPage(1);
                      }}
                      className="text-[10px] text-amber-400 hover:underline capitalize"
                    >
                      {t.allLabel || 'All'}
                    </button>
                  )}
                </div>

                <div className="space-y-1">
                  {/* Client Option */}
                  <button
                    type="button"
                    onClick={() => {
                      setEnvironment(environment === 'client' ? 'all' : 'client');
                      setPage(1);
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl transition-all duration-150 cursor-pointer text-left group border-2 ${
                      environment === 'client'
                        ? 'bg-[var(--accent-color)]/[0.04] text-white border-[var(--accent-color)] shadow-sm'
                        : 'text-slate-300 hover:text-white hover:bg-white/[0.04] border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="w-5 h-5 shrink-0 flex items-center justify-center">
                        <Monitor className="w-5 h-5 text-indigo-400" />
                      </span>
                      <span className={`text-sm font-bold font-sans tracking-wide transition-colors ${environment === 'client' ? 'text-white' : 'text-slate-200 group-hover:text-white'}`}>
                        {t.envClient || 'Client'}
                      </span>
                    </div>
                    <Check className={`w-3.5 h-3.5 text-[var(--accent-color)] shrink-0 transition-opacity duration-150 ${environment === 'client' ? 'opacity-100' : 'opacity-0'}`} />
                  </button>

                  {/* Server Option */}
                  <button
                    type="button"
                    onClick={() => {
                      setEnvironment(environment === 'server' ? 'all' : 'server');
                      setPage(1);
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl transition-all duration-150 cursor-pointer text-left group border-2 ${
                      environment === 'server'
                        ? 'bg-[var(--accent-color)]/[0.04] text-white border-[var(--accent-color)] shadow-sm'
                        : 'text-slate-300 hover:text-white hover:bg-white/[0.04] border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="w-5 h-5 shrink-0 flex items-center justify-center">
                        <Server className="w-5 h-5 text-emerald-400" />
                      </span>
                      <span className={`text-sm font-bold font-sans tracking-wide transition-colors ${environment === 'server' ? 'text-white' : 'text-slate-200 group-hover:text-white'}`}>
                        {t.envServer || 'Server'}
                      </span>
                    </div>
                    <Check className={`w-3.5 h-3.5 text-[var(--accent-color)] shrink-0 transition-opacity duration-150 ${environment === 'server' ? 'opacity-100' : 'opacity-0'}`} />
                  </button>
                </div>
              </div>

              {/* Filter 4: Categories */}
              <div className="glass-panel p-4 rounded-2xl border border-white/5 space-y-3">
                <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-400">
                  <span>{t.filterCategories || 'Category'}</span>
                  {categoryFilter !== 'all' && (
                    <button
                      onClick={() => {
                        setCategoryFilter('all');
                        setPage(1);
                      }}
                      className="text-[10px] text-amber-400 hover:underline flex items-center gap-1"
                    >
                      <RotateCcw className="w-2.5 h-2.5" />
                      <span>{t.resetBtn || 'Reset'}</span>
                    </button>
                  )}
                </div>

                <div className="space-y-1">
                  {activeCategories.map((cat) => {
                    const isSelected = categoryFilter === cat.id;
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => {
                          setCategoryFilter(cat.id);
                          setPage(1);
                        }}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-xl transition-all duration-150 cursor-pointer text-left group border-2 ${
                          isSelected
                            ? 'bg-[var(--accent-color)]/[0.04] text-white border-[var(--accent-color)] shadow-sm'
                            : 'text-slate-300 hover:text-white hover:bg-white/[0.04] border-transparent'
                        }`}
                      >
                        <span className={`text-sm font-bold font-sans tracking-wide transition-colors ${isSelected ? 'text-white' : 'text-slate-200 group-hover:text-white'}`}>
                          {getCategoryName(cat, language)}
                        </span>
                        <Check className={`w-3.5 h-3.5 text-[var(--accent-color)] shrink-0 transition-opacity duration-150 ${isSelected ? 'opacity-100' : 'opacity-0'}`} />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* RIGHT MAIN AREA: SEARCH & RESULTS */}
            <div className="flex-1 min-w-0 space-y-4 w-full">
              {/* Top Search Bar */}
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder={t.searchModsPlaceholder || t.searchPlaceholder || 'Search mods, shaders, resource packs...'}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full glass-input pl-11 pr-10 py-3 rounded-2xl text-sm text-white focus:outline-none focus:border-amber-400 shadow-inner"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1 hover:bg-white/10 rounded-lg transition text-slate-400 hover:text-white cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Controls Bar: Sort, View Count & Pagination */}
              <div className="relative z-30 flex items-center justify-between gap-2.5 p-2 rounded-2xl bg-[#161719] border border-white/10 shadow-sm font-sans flex-nowrap">
                {/* Left Controls: Sort & View Limit */}
                <div className="flex items-center gap-2.5 shrink-0 flex-nowrap">
                  {/* Sort By Custom Dropdown */}
                  <div className="relative flex items-center gap-1.5 text-xs text-slate-400 shrink-0" ref={sortDropdownRef}>
                    <span className="font-semibold text-slate-400 flex items-center gap-1 shrink-0">
                      <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                      <span>{t.sortBy || 'Sort'}:</span>
                    </span>
                    <div className="relative w-[155px]">
                      <button
                        type="button"
                        onClick={() => {
                          setIsSortDropdownOpen((prev) => !prev);
                          setIsPageSizeDropdownOpen(false);
                        }}
                        className={`w-full h-[36px] px-2.5 rounded-xl border text-xs font-semibold flex items-center justify-between gap-1.5 transition cursor-pointer shadow-sm active:scale-95 ${
                          isSortDropdownOpen
                            ? 'bg-white/[0.08] border-[var(--accent-color)] text-white shadow-[0_0_12px_rgba(251,191,36,0.15)]'
                            : 'bg-black/40 hover:bg-white/[0.06] border-white/10 hover:border-white/20 text-slate-200 hover:text-white'
                        }`}
                      >
                        <span className="truncate">
                          {sortBy === 'relevance'
                            ? (t.sortRelevance || 'Relevance')
                            : sortBy === 'downloads'
                            ? (t.sortDownloads || 'Most Downloads')
                            : sortBy === 'published'
                            ? (t.sortPublished || 'Recently Published')
                            : (t.sortNewest || 'Recently Updated')}
                        </span>
                        <ChevronDown
                          className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 shrink-0 ${
                            isSortDropdownOpen ? 'rotate-180 text-[var(--accent-color)]' : ''
                          }`}
                        />
                      </button>

                      {isSortDropdownOpen && (
                        <div className="absolute left-0 right-0 w-full top-full mt-1.5 rounded-xl bg-[#18191c] border border-white/15 shadow-2xl p-1 z-50 space-y-0.5 animate-dropdown backdrop-blur-xl">
                          {[
                            { id: 'relevance' as const, label: t.sortRelevance || 'Relevance' },
                            { id: 'downloads' as const, label: t.sortDownloads || 'Most Downloads' },
                            { id: 'newest' as const, label: t.sortNewest || 'Recently Updated' },
                            { id: 'published' as const, label: t.sortPublished || 'Recently Published' },
                          ].map((opt) => {
                            const isSelected = sortBy === opt.id;
                            return (
                              <button
                                key={opt.id}
                                type="button"
                                onClick={() => {
                                  setSortBy(opt.id);
                                  setPage(1);
                                  setIsSortDropdownOpen(false);
                                }}
                                className={`w-full px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center justify-between transition cursor-pointer ${
                                  isSelected
                                    ? 'bg-[var(--accent-subtle)] border border-[var(--accent-border)] text-[var(--accent-light)] font-bold'
                                    : 'border border-transparent text-slate-300 hover:text-white hover:bg-white/[0.08]'
                                }`}
                              >
                                <span className="truncate">{opt.label}</span>
                                {isSelected && <Check className="w-3.5 h-3.5 text-[var(--accent-color)] shrink-0 ml-1" />}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* View Limit Custom Dropdown */}
                  <div className="relative flex items-center gap-1.5 text-xs text-slate-400 shrink-0" ref={pageSizeDropdownRef}>
                    <span className="font-semibold text-slate-400 shrink-0">{t.viewCount || 'Show'}:</span>
                    <div className="relative w-[60px]">
                      <button
                        type="button"
                        onClick={() => {
                          setIsPageSizeDropdownOpen((prev) => !prev);
                          setIsSortDropdownOpen(false);
                        }}
                        className={`w-full h-[36px] px-2 rounded-xl border text-xs font-semibold flex items-center justify-between gap-1 transition cursor-pointer shadow-sm active:scale-95 ${
                          isPageSizeDropdownOpen
                            ? 'bg-white/[0.08] border-[var(--accent-color)] text-white shadow-[0_0_12px_rgba(251,191,36,0.15)]'
                            : 'bg-black/40 hover:bg-white/[0.06] border-white/10 hover:border-white/20 text-slate-200 hover:text-white'
                        }`}
                      >
                        <span>{pageSize}</span>
                        <ChevronDown
                          className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 shrink-0 ${
                            isPageSizeDropdownOpen ? 'rotate-180 text-[var(--accent-color)]' : ''
                          }`}
                        />
                      </button>

                      {isPageSizeDropdownOpen && (
                        <div className="absolute left-0 right-0 w-full top-full mt-1.5 rounded-xl bg-[#18191c] border border-white/15 shadow-2xl p-1 z-50 space-y-0.5 animate-dropdown backdrop-blur-xl">
                          {[20, 40, 60].map((count) => {
                            const isSelected = pageSize === count;
                            return (
                              <button
                                key={count}
                                type="button"
                                onClick={() => {
                                  setPageSize(count);
                                  setPage(1);
                                  setIsPageSizeDropdownOpen(false);
                                }}
                                className={`w-full px-2 py-1.5 rounded-lg text-xs font-medium flex items-center justify-between transition cursor-pointer ${
                                  isSelected
                                    ? 'bg-[var(--accent-subtle)] border border-[var(--accent-border)] text-[var(--accent-light)] font-bold'
                                    : 'border border-transparent text-slate-300 hover:text-white hover:bg-white/[0.08]'
                                }`}
                              >
                                <span>{count}</span>
                                {isSelected && <Check className="w-3 h-3 text-[var(--accent-color)] shrink-0 ml-1" />}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right Controls: Pagination, View Toggle & Total Counts */}
                <div className="flex items-center gap-2.5 text-xs shrink-0 flex-nowrap">
                  <span className="text-slate-400 font-sans text-xs flex items-center gap-1.5 whitespace-nowrap shrink-0">
                    {loading && <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-400 shrink-0" />}
                    {totalItems > 0 ? (
                      <>
                        <strong className="text-slate-200 font-semibold">{totalItems}</strong> {t.resultsCount || 'results'}
                      </>
                    ) : (
                      ''
                    )}
                  </span>

                  {/* View Mode Switcher: Grid vs List with smooth sliding indicator */}
                  <div className="relative inline-flex items-center p-0.5 rounded-xl bg-black/40 border border-white/10 select-none shrink-0">
                    <div
                      aria-hidden="true"
                      className="absolute top-0.5 bottom-0.5 rounded-lg bg-[var(--accent-subtle)] border border-[var(--accent-border)] pointer-events-none transition-all duration-200"
                      style={{
                        transform: viewMode === 'grid' ? 'translateX(0px)' : 'translateX(32px)',
                        width: '32px',
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => handleViewModeChange('grid')}
                      className={`relative z-10 w-8 h-7 flex items-center justify-center rounded-lg transition-colors cursor-pointer ${
                        viewMode === 'grid' ? 'text-[var(--accent-light)]' : 'text-slate-400 hover:text-white'
                      }`}
                      title={t.viewGrid || 'Grid View'}
                    >
                      <LayoutGrid className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleViewModeChange('list')}
                      className={`relative z-10 w-8 h-7 flex items-center justify-center rounded-lg transition-colors cursor-pointer ${
                        viewMode === 'list' ? 'text-[var(--accent-light)]' : 'text-slate-400 hover:text-white'
                      }`}
                      title={t.viewList || 'List View'}
                    >
                      <List className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      disabled={page <= 1 || loading}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      className="h-[34px] w-[34px] flex items-center justify-center rounded-xl border border-white/10 bg-black/40 hover:bg-white/10 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed transition cursor-pointer shrink-0"
                      title={t.prevPage || 'Previous page'}
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>

                    <span className="h-[34px] px-3 flex items-center justify-center rounded-xl bg-white/5 border border-white/10 font-sans text-xs text-slate-200 font-semibold tracking-wide whitespace-nowrap shrink-0">
                      {page} / {totalPages}
                    </span>

                    <button
                      type="button"
                      disabled={page >= totalPages || loading}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      className="h-[34px] w-[34px] flex items-center justify-center rounded-xl border border-white/10 bg-black/40 hover:bg-white/10 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed transition cursor-pointer shrink-0"
                      title={t.nextPage || 'Next page'}
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Shader Requirement Notice */}
              {contentType === 'shaderpacks' && (
                <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex items-center gap-3">
                  <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>{t.shaderNotice}</span>
                </div>
              )}

              {/* Skeleton loading with realistic sweep animation */}
              {loading && (
                viewMode === 'grid' ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-fadeIn">
                    {[1, 2, 3, 4].map((n) => (
                      <div
                        key={n}
                        className="glass-card rounded-2xl border border-white/5 bg-slate-900/40 overflow-hidden flex flex-col justify-between"
                      >
                        <div className="h-44 w-full bg-white/5 skeleton-shimmer" />
                        <div className="p-4.5 space-y-3 flex-1 flex flex-col justify-between">
                          <div className="flex items-start gap-3">
                            <div className="w-11 h-11 rounded-xl bg-white/5 shrink-0 skeleton-shimmer" />
                            <div className="flex-1 space-y-2">
                              <div className="h-4 bg-white/10 rounded-lg w-36 skeleton-shimmer" />
                              <div className="h-3 bg-white/5 rounded-lg w-full skeleton-shimmer" />
                              <div className="h-3 bg-white/5 rounded-lg w-4/5 skeleton-shimmer" />
                            </div>
                          </div>
                          <div className="flex items-center gap-2 pt-1">
                            <div className="h-5 bg-white/5 rounded-lg w-24 skeleton-shimmer" />
                            <div className="h-5 bg-white/5 rounded-lg w-16 skeleton-shimmer" />
                            <div className="h-5 bg-white/5 rounded-lg w-20 skeleton-shimmer" />
                          </div>
                          <div className="flex items-center justify-between pt-3 border-t border-white/5">
                            <div className="h-4 bg-white/5 rounded-lg w-28 skeleton-shimmer" />
                            <div className="h-7 bg-white/5 rounded-xl w-20 skeleton-shimmer" />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-3 animate-fadeIn">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <div
                        key={n}
                        className="glass-card rounded-2xl p-4 border border-white/5 bg-slate-900/30 flex flex-col md:flex-row md:items-center justify-between gap-4"
                      >
                        <div className="flex items-start md:items-center gap-4 min-w-0 flex-1">
                          <div className="w-16 h-16 rounded-2xl bg-white/5 shrink-0 skeleton-shimmer" />
                          <div className="space-y-2.5 flex-1 min-w-0">
                            <div className="h-5 bg-white/10 rounded-lg w-52 skeleton-shimmer" />
                            <div className="h-4 bg-white/5 rounded-lg w-full max-w-md skeleton-shimmer" />
                            <div className="flex items-center gap-2 pt-0.5">
                              <div className="h-4 bg-white/5 rounded-lg w-20 skeleton-shimmer" />
                              <div className="h-4 bg-white/5 rounded-lg w-20 skeleton-shimmer" />
                            </div>
                          </div>
                        </div>
                        <div className="w-28 h-10 bg-white/5 rounded-xl shrink-0 skeleton-shimmer" />
                      </div>
                    ))}
                  </div>
                )
              )}

              {/* Empty State */}
              {!loading && items.length === 0 && (
                <div className="text-center p-16 glass-panel rounded-2xl border border-white/5 space-y-2 animate-fadeIn">
                  <Package className="w-10 h-10 text-slate-500 mx-auto" />
                  <div className="text-sm font-bold text-white font-riot">{t.noModsFoundTitle || 'No matching resources found'}</div>
                  <p className="text-xs text-slate-400 max-w-sm mx-auto">
                    {t.noModsFoundDesc || 'Try adjusting your search query or enabling both Modrinth and CurseForge in the platform filter.'}
                  </p>
                </div>
              )}

              {/* Addon Items: Grid Mode vs List Mode */}
              {!loading && items.length > 0 && (
                viewMode === 'grid' ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-fadeIn">
                    {items.map((item) => {
                      const isInstalling = installingId === item.id;
                      const isInstalled =
                        item.isInstalled ||
                        installedItems.some((m) =>
                          m.name.toLowerCase().includes(item.name.toLowerCase().trim())
                        );

                      const isDeduplicated =
                        (item.sources && item.sources.length > 1) ||
                        (item.modrinthId && item.curseforgeId);

                      return (
                        <ModGridCard
                          key={`${item.source}-${item.id}`}
                          item={item}
                          isInstalling={isInstalling}
                          isInstalled={isInstalled}
                          isDeduplicated={Boolean(isDeduplicated)}
                          onInstall={handleInstall}
                          language={language}
                          t={t}
                          contentType={contentType}
                        />
                      );
                    })}
                  </div>
                ) : (
                  <div className="space-y-3 animate-fadeIn">
                    {items.map((item) => {
                      const isInstalling = installingId === item.id;
                      const isInstalled =
                        item.isInstalled ||
                        installedItems.some((m) =>
                          m.name.toLowerCase().includes(item.name.toLowerCase().trim())
                        );

                      const isDeduplicated =
                        (item.sources && item.sources.length > 1) ||
                        (item.modrinthId && item.curseforgeId);

                      return (
                        <div
                          key={`${item.source}-${item.id}`}
                          className="glass-card rounded-2xl p-4.5 border border-white/5 hover:border-white/20 bg-slate-900/40 hover:bg-white/[0.04] transition-colors duration-200 hover:shadow-lg hover:shadow-black/20 flex flex-col md:flex-row md:items-center justify-between gap-4 group shadow-sm"
                        >
                          {/* Left: Addon Icon */}
                          <div className="flex items-start md:items-center gap-4 min-w-0 flex-1">
                            <div className="w-16 h-16 rounded-2xl bg-slate-950/80 border border-white/10 overflow-hidden flex items-center justify-center shrink-0 shadow-inner">
                            {item.iconUrl ? (
                              <img
                                src={item.iconUrl}
                                alt={item.name}
                                className="w-full h-full object-cover"
                                loading="lazy"
                              />
                            ) : contentType === 'shaderpacks' ? (
                              <Sparkles className="w-7 h-7 text-amber-400" />
                            ) : contentType === 'resourcepacks' ? (
                              <Layers className="w-7 h-7 text-amber-400" />
                            ) : contentType === 'datapacks' ? (
                              <FileCode className="w-7 h-7 text-amber-400" />
                            ) : (
                              <Package className="w-7 h-7 text-amber-400" />
                            )}
                          </div>

                          {/* Middle: Title, Author, Description, Badges */}
                          <div className="min-w-0 flex-1">
                            {/* Row 1: Title & Author */}
                            <div className="flex items-baseline gap-2.5 flex-wrap">
                              <h3 className="text-lg font-extrabold font-riot text-white group-hover:text-amber-300 transition truncate">
                                {item.name}
                              </h3>
                              {item.author && (
                                <span className="text-sm text-slate-400 truncate">
                                  {t.authorBy || 'by'}{' '}
                                  <strong className="text-slate-200 font-semibold">{item.author}</strong>
                                </span>
                              )}
                            </div>

                            {/* Row 2: Description (2-line clamp) */}
                            <p className="text-sm text-slate-300 line-clamp-2 mt-1 leading-relaxed">
                              {item.summary}
                            </p>

                            {/* Row 3: Platform Badges & Categories */}
                            <div className="flex items-center gap-2 mt-3 flex-wrap">
                              {/* Separate platform badges for Modrinth and CurseForge */}
                              {(item.source === 'modrinth' || item.sources?.includes('modrinth') || Boolean(item.modrinthId)) && (
                                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#1bd96a]/15 border border-[#1bd96a]/40 text-xs font-bold text-[#1bd96a]">
                                  <ModrinthLogo className="w-3.5 h-3.5" />
                                  <span>Modrinth</span>
                                </span>
                              )}
                              {(item.source === 'curseforge' || item.sources?.includes('curseforge') || Boolean(item.curseforgeId)) && (
                                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#f16436]/15 border border-[#f16436]/40 text-xs font-bold text-[#f16436]">
                                  <CurseForgeLogo className="w-3.5 h-3.5" />
                                  <span>CurseForge</span>
                                </span>
                              )}

                              {/* Deduplication merged tag */}
                              {isDeduplicated && (
                                <span className="text-[10px] px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-slate-400 font-mono">
                                  {t.deduplicatedBadge || 'Merged'}
                                </span>
                              )}

                              {/* Categories tags (up to 3) */}
                              {(item.categories || []).slice(0, 3).map((cat) => (
                                <span
                                  key={cat}
                                  className="px-2.5 py-1 rounded-lg bg-white/[0.04] text-xs text-slate-300 border border-white/5 font-medium"
                                >
                                  {cat}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* Right: Downloads count, Favorites, Updated time & Action button */}
                        <div className="flex md:flex-col items-center md:items-end justify-between md:justify-center gap-3.5 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-white/5">
                          {/* Stats Row */}
                          <div className="flex items-center gap-3.5 text-sm text-slate-400 font-sans">
                            <span className="flex items-center gap-1.5" title={t.downloadsCountTooltip || 'Downloads'}>
                              <Download className="w-4 h-4 text-slate-400" />
                              <strong className="text-slate-200 font-bold">{formatCount(item.downloads)}</strong>
                            </span>

                            {item.follows && item.follows > 0 ? (
                              <span className="flex items-center gap-1.5" title={t.favoritesCountTooltip || 'Favorites'}>
                                <Heart className="w-4 h-4 text-rose-500/90" />
                                <span>{formatCount(item.follows)}</span>
                              </span>
                            ) : null}

                            {item.updatedAt && (
                              <span
                                className="hidden sm:flex items-center gap-1.5 text-xs text-slate-400 font-sans whitespace-nowrap shrink-0"
                                title={`${t.updated || 'Updated'}: ${new Date(item.updatedAt).toLocaleDateString()}`}
                              >
                                <Clock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                                <span>{formatTimeAgo(item.updatedAt, language)}</span>
                              </span>
                            )}
                          </div>

                          {/* Action Buttons */}
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleInstall(item)}
                              disabled={isInstalling || isInstalled}
                              className={`py-2.5 px-5 rounded-xl font-bold font-riot text-sm flex items-center gap-2 transition cursor-pointer ${
                                isInstalled
                                  ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shadow-sm'
                                  : isInstalling
                                  ? 'bg-amber-500/50 text-white animate-pulse'
                                  : 'btn-primary text-white shadow-md hover:shadow-amber-500/20 active:scale-95'
                              }`}
                            >
                              {isInstalled ? (
                                <>
                                  <Check className="w-4 h-4" />
                                  <span>{t.btnInstalled || 'Installed'}</span>
                                </>
                              ) : isInstalling ? (
                                <>
                                  <RefreshCw className="w-4 h-4 animate-spin" />
                                  <span>{t.installing || 'Downloading...'}</span>
                                </>
                              ) : (
                                <>
                                  <Download className="w-4 h-4" />
                                  <span>{t.btnInstall || 'Install'}</span>
                                </>
                              )}
                            </button>

                            <a
                              href={item.webUrl}
                              target="_blank"
                              rel="noreferrer"
                              title={t.viewOfficialWeb || 'View details on official website'}
                              className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition cursor-pointer active:scale-95"
                            >
                              <ExternalLink className="w-4 h-4" />
                            </a>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                )
              )}

              {/* Bottom Pagination controls - always visible when items exist to prevent layout jump */}
              {items.length > 0 && totalPages > 1 && (
                <div className="flex items-center justify-between p-4 rounded-2xl bg-white/[0.02] border border-white/5 text-xs">
                  <span className="text-slate-400 font-sans">
                    {t.pageWord || 'Page'} <strong className="text-white font-bold">{page}</strong> {t.ofWord || 'of'}{' '}
                    <strong className="text-white font-bold">{totalPages}</strong>
                  </span>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={page <= 1 || loading}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      className="px-3 py-1.5 rounded-xl border border-white/10 bg-black/40 hover:bg-white/10 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-150 cursor-pointer flex items-center gap-1"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      <span>{t.prevPage || 'Previous'}</span>
                    </button>

                    <button
                      type="button"
                      disabled={page >= totalPages || loading}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      className="px-3 py-1.5 rounded-xl border border-white/10 bg-black/40 hover:bg-white/10 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-150 cursor-pointer flex items-center gap-1"
                    >
                      <span>{t.nextPage || 'Next'}</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* INSTALLED ADDONS TAB */
        <div key="installed-tab" className="space-y-4 animate-tab-switch">
          {/* Dual Action Strip: Mods Folder on Left | Modpack (.mrpack) on Right (Compact, Side-by-Side, Zero Height Waste) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Box 1: Open Folder & Drop .jar/.zip into Current Profile */}
            <div
              onClick={() => onOpenInstanceDir?.(activeInstance.id)}
              className="py-2.5 px-4 rounded-2xl border-2 border-dashed border-white/15 hover:border-[var(--accent-color)]/40 bg-white/[0.02] hover:bg-white/[0.04] flex items-center justify-between gap-3 transition-all duration-150 cursor-pointer group select-none min-h-[52px]"
              title={(t.openFolderTitle || 'Click to open {type} folder for this profile').replace('{type}', installedContentType)}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-xl bg-[var(--accent-color)]/10 border border-[var(--accent-color)]/20 flex items-center justify-center shrink-0 group-hover:bg-[var(--accent-color)]/20 transition-colors">
                  <FolderOpen className="w-4 h-4 text-[var(--accent-color)]" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-xs font-semibold text-white flex items-center gap-2 truncate">
                    <span>{t.dropJarHint || 'Drop .jar or .zip here'}</span>
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5 truncate">
                    {t.openFolderWord || 'Open folder'} <span className="font-semibold text-white">{installedContentType}</span> • {activeInstance.name}
                  </p>
                </div>
              </div>

              <button
                type="button"
                className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-xs font-semibold text-slate-300 group-hover:text-[var(--accent-color)] group-hover:bg-[var(--accent-color)]/10 group-hover:border-[var(--accent-color)]/20 transition-all shrink-0 flex items-center gap-1.5 pointer-events-none"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>{t.btnOpenDir || 'Open Folder'}</span>
              </button>
            </div>

            {/* Box 2: Drop or Click to Install .mrpack Modpack */}
            <div
              onClick={handlePickMrpackFile}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingMrpack(true);
              }}
              onDragLeave={() => setIsDraggingMrpack(false)}
              onDrop={handleDropMrpack}
              className={`py-2.5 px-4 rounded-2xl border-2 border-dashed transition-all duration-150 cursor-pointer group flex items-center justify-between gap-3 select-none min-h-[52px] ${
                isDraggingMrpack
                  ? 'border-[var(--accent-color)] bg-[var(--accent-color)]/15 scale-[1.01]'
                  : 'border-white/15 hover:border-[var(--accent-color)]/40 bg-white/[0.02] hover:bg-white/[0.04]'
              }`}
              title={t.dropMrpackTooltip || 'Drag & drop .mrpack file here or click to install Modpack'}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-xl bg-[var(--accent-color)]/10 border border-[var(--accent-color)]/20 flex items-center justify-center shrink-0 group-hover:bg-[var(--accent-color)]/20 transition-colors">
                  <Package className="w-4 h-4 text-[var(--accent-color)] group-hover:scale-105 transition-transform" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-xs font-semibold text-white flex items-center gap-2 truncate">
                    <span>{t.dropMrpackHint || 'Drop .mrpack file here'}</span>
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5 truncate">
                    {t.dropMrpackSub || 'Click or drop to install Modpack'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-xs font-semibold text-slate-300 group-hover:text-[var(--accent-color)] group-hover:bg-[var(--accent-color)]/10 group-hover:border-[var(--accent-color)]/20 transition-all shrink-0 flex items-center gap-1.5 pointer-events-none"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>{t.btnOpenDir || 'Open Folder'}</span>
              </button>
            </div>
          </div>

          {/* Top ref for smooth scrolling */}
          <div ref={installedListTopRef} className="scroll-mt-4" />

          {/* Search & Content Type Controls Row */}
          <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
            {/* Category switcher inside Installed tab - exact style as Browse tab without icons */}
            <div className="relative inline-flex items-center p-1 rounded-2xl bg-[#161719] border border-white/10 shadow-sm select-none shrink-0">
              {/* Smooth Sliding Pill Indicator with theme accent color */}
              <div
                aria-hidden="true"
                className="absolute top-1 bottom-1 left-0 rounded-xl bg-[var(--accent-color)] shadow-md shadow-[var(--accent-subtle)] pointer-events-none transition-all duration-300"
                style={{
                  transform: `translateX(${installedPillStyle.left}px)`,
                  width: `${installedPillStyle.width}px`,
                  opacity: installedPillStyle.opacity,
                  transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
                }}
              />

              {[
                { id: 'mods' as const, label: 'Mods' },
                { id: 'resourcepacks' as const, label: 'Resource Packs' },
                { id: 'datapacks' as const, label: 'Data Packs' },
                { id: 'shaderpacks' as const, label: 'Shaders' },
              ].map((tab) => {
                const isActive = installedContentType === tab.id;
                return (
                  <button
                    key={tab.id}
                    ref={(el) => {
                      installedTypeRefs.current[tab.id] = el;
                    }}
                    type="button"
                    onClick={() => setInstalledContentType(tab.id)}
                    className={`relative z-10 px-4 py-2 rounded-xl text-sm font-bold font-sans transition-colors duration-200 whitespace-nowrap cursor-pointer ${
                      isActive
                        ? 'text-[#070a12]'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* Installed Tab Search Input */}
            <div className="flex-1 min-w-[240px] relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder={(t.searchInstalledPlaceholder || 'Search installed {type}...').replace('{type}', installedContentType)}
                value={installedSearchQuery}
                onChange={(e) => setInstalledSearchQuery(e.target.value)}
                className="w-full h-[44px] glass-input pl-11 pr-10 rounded-2xl text-sm text-white focus:outline-none focus:border-amber-400 shadow-inner"
              />
              {installedSearchQuery && (
                <button
                  type="button"
                  onClick={() => setInstalledSearchQuery('')}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1 hover:bg-white/10 rounded-lg transition text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Controls Bar: Sort, Status Filter, Show Count, Results, View Mode Switcher, and Pagination */}
          <div className="relative z-20 flex items-center justify-between gap-2.5 p-2 rounded-2xl bg-[#161719] border border-white/10 shadow-sm font-sans flex-nowrap">
            {/* Left Controls: Sort, Status Filter, & Show Count */}
            <div className="flex items-center gap-2.5 shrink-0 flex-nowrap">
              {/* Sort By Custom Dropdown */}
              <div className="relative flex items-center gap-1.5 text-xs text-slate-400 shrink-0" ref={installedSortDropdownRef}>
                <span className="font-semibold text-slate-400 flex items-center gap-1 shrink-0">
                  <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                  <span>{t.sortBy || 'Sort'}:</span>
                </span>
                <div className="relative w-[185px]">
                  <button
                    type="button"
                    onClick={() => {
                      setIsInstalledSortDropdownOpen((prev) => !prev);
                      setIsInstalledPageSizeDropdownOpen(false);
                      setIsInstalledStatusDropdownOpen(false);
                    }}
                    className={`w-full h-[36px] px-2.5 rounded-xl border text-xs font-semibold flex items-center justify-between gap-1.5 transition cursor-pointer shadow-sm active:scale-95 ${
                      isInstalledSortDropdownOpen
                        ? 'bg-white/[0.08] border-[var(--accent-color)] text-white shadow-[0_0_12px_rgba(251,191,36,0.15)]'
                        : 'bg-black/40 hover:bg-white/[0.06] border-white/10 hover:border-white/20 text-slate-200 hover:text-white'
                    }`}
                  >
                    <span className="truncate">
                      {installedSortBy === 'name-asc'
                        ? (t.sortNameAsc || 'Name: A → Z')
                        : installedSortBy === 'name-desc'
                        ? (t.sortNameDesc || 'Name: Z → A')
                        : installedSortBy === 'size-desc'
                        ? (t.sortSizeDesc || 'Size: Largest')
                        : installedSortBy === 'size-asc'
                        ? (t.sortSizeAsc || 'Size: Smallest')
                        : installedSortBy === 'status-enabled'
                        ? (t.sortStatusEnabled || 'Enabled first')
                        : (t.sortStatusDisabled || 'Disabled first')}
                    </span>
                    <ChevronDown
                      className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 shrink-0 ${
                        isInstalledSortDropdownOpen ? 'rotate-180 text-[var(--accent-color)]' : ''
                      }`}
                    />
                  </button>

                  {isInstalledSortDropdownOpen && (
                    <div className="absolute left-0 right-0 w-full top-full mt-1.5 rounded-xl bg-[#18191c] border border-white/15 shadow-2xl p-1 z-50 space-y-0.5 animate-dropdown backdrop-blur-xl">
                      {[
                        { id: 'name-asc' as const, label: t.sortNameAsc || 'Name: A → Z' },
                        { id: 'name-desc' as const, label: t.sortNameDesc || 'Name: Z → A' },
                        { id: 'size-desc' as const, label: t.sortSizeDesc || 'Size: Largest' },
                        { id: 'size-asc' as const, label: t.sortSizeAsc || 'Size: Smallest' },
                        { id: 'status-enabled' as const, label: t.sortStatusEnabled || 'Enabled first' },
                        { id: 'status-disabled' as const, label: t.sortStatusDisabled || 'Disabled first' },
                      ].map((opt) => {
                        const isSelected = installedSortBy === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => {
                              setInstalledSortBy(opt.id);
                              setInstalledPage(1);
                              setIsInstalledSortDropdownOpen(false);
                            }}
                            className={`w-full px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center justify-between transition cursor-pointer ${
                              isSelected
                                ? 'bg-[var(--accent-subtle)] border border-[var(--accent-border)] text-[var(--accent-light)] font-bold'
                                : 'border border-transparent text-slate-300 hover:text-white hover:bg-white/[0.08]'
                            }`}
                          >
                            <span className="truncate">{opt.label}</span>
                            {isSelected && <Check className="w-3.5 h-3.5 text-[var(--accent-color)] shrink-0 ml-1" />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Status Filter Dropdown */}
              <div className="relative flex items-center gap-1.5 text-xs text-slate-400 shrink-0" ref={installedStatusDropdownRef}>
                <span className="font-semibold text-slate-400 flex items-center gap-1 shrink-0">
                  <Filter className="w-3.5 h-3.5 text-slate-400" />
                  <span>Status:</span>
                </span>
                <div className="relative w-[130px]">
                  <button
                    type="button"
                    onClick={() => {
                      setIsInstalledStatusDropdownOpen((prev) => !prev);
                      setIsInstalledSortDropdownOpen(false);
                      setIsInstalledPageSizeDropdownOpen(false);
                    }}
                    className={`w-full h-[36px] px-2.5 rounded-xl border text-xs font-semibold flex items-center justify-between gap-1.5 transition cursor-pointer shadow-sm active:scale-95 ${
                      isInstalledStatusDropdownOpen
                        ? 'bg-white/[0.08] border-[var(--accent-color)] text-white shadow-[0_0_12px_rgba(251,191,36,0.15)]'
                        : 'bg-black/40 hover:bg-white/[0.06] border-white/10 hover:border-white/20 text-slate-200 hover:text-white'
                    }`}
                  >
                    <span className="truncate">
                      {installedStatusFilter === 'all'
                        ? (t.statusFilterAll || 'All')
                        : installedStatusFilter === 'enabled'
                        ? (t.statusFilterEnabled || 'Enabled')
                        : (t.statusFilterDisabled || 'Disabled')}
                    </span>
                    <ChevronDown
                      className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 shrink-0 ${
                        isInstalledStatusDropdownOpen ? 'rotate-180 text-[var(--accent-color)]' : ''
                      }`}
                    />
                  </button>

                  {isInstalledStatusDropdownOpen && (
                    <div className="absolute left-0 right-0 w-full top-full mt-1.5 rounded-xl bg-[#18191c] border border-white/15 shadow-2xl p-1 z-50 space-y-0.5 animate-dropdown backdrop-blur-xl">
                      {[
                        { id: 'all' as const, label: t.statusFilterAll || 'All' },
                        { id: 'enabled' as const, label: t.statusFilterEnabled || 'Enabled' },
                        { id: 'disabled' as const, label: t.statusFilterDisabled || 'Disabled' },
                      ].map((opt) => {
                        const isSelected = installedStatusFilter === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => {
                              setInstalledStatusFilter(opt.id);
                              setInstalledPage(1);
                              setIsInstalledStatusDropdownOpen(false);
                            }}
                            className={`w-full px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center justify-between transition cursor-pointer ${
                              isSelected
                                ? 'bg-[var(--accent-subtle)] border border-[var(--accent-border)] text-[var(--accent-light)] font-bold'
                                : 'border border-transparent text-slate-300 hover:text-white hover:bg-white/[0.08]'
                            }`}
                          >
                            <span className="truncate">{opt.label}</span>
                            {isSelected && <Check className="w-3.5 h-3.5 text-[var(--accent-color)] shrink-0 ml-1" />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Show Count Custom Dropdown */}
              <div className="relative flex items-center gap-1.5 text-xs text-slate-400 shrink-0" ref={installedPageSizeDropdownRef}>
                <span className="font-semibold text-slate-400 shrink-0">{t.viewCount || 'Show'}:</span>
                <div className="relative w-[65px]">
                  <button
                    type="button"
                    onClick={() => {
                      setIsInstalledPageSizeDropdownOpen((prev) => !prev);
                      setIsInstalledSortDropdownOpen(false);
                      setIsInstalledStatusDropdownOpen(false);
                    }}
                    className={`w-full h-[36px] px-2 rounded-xl border text-xs font-semibold flex items-center justify-between gap-1 transition cursor-pointer shadow-sm active:scale-95 ${
                      isInstalledPageSizeDropdownOpen
                        ? 'bg-white/[0.08] border-[var(--accent-color)] text-white shadow-[0_0_12px_rgba(251,191,36,0.15)]'
                        : 'bg-black/40 hover:bg-white/[0.06] border-white/10 hover:border-white/20 text-slate-200 hover:text-white'
                    }`}
                  >
                    <span>{installedPageSize}</span>
                    <ChevronDown
                      className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 shrink-0 ${
                        isInstalledPageSizeDropdownOpen ? 'rotate-180 text-[var(--accent-color)]' : ''
                      }`}
                    />
                  </button>

                  {isInstalledPageSizeDropdownOpen && (
                    <div className="absolute left-0 right-0 w-full top-full mt-1.5 rounded-xl bg-[#18191c] border border-white/15 shadow-2xl p-1 z-50 space-y-0.5 animate-dropdown backdrop-blur-xl">
                      {[10, 20, 50].map((count) => {
                        const isSelected = installedPageSize === count;
                        return (
                          <button
                            key={count}
                            type="button"
                            onClick={() => {
                              setInstalledPageSize(count);
                              setInstalledPage(1);
                              setIsInstalledPageSizeDropdownOpen(false);
                            }}
                            className={`w-full px-2 py-1.5 rounded-lg text-xs font-medium flex items-center justify-between transition cursor-pointer ${
                              isSelected
                                ? 'bg-[var(--accent-subtle)] border border-[var(--accent-border)] text-[var(--accent-light)] font-bold'
                                : 'border border-transparent text-slate-300 hover:text-white hover:bg-white/[0.08]'
                            }`}
                          >
                            <span>{count}</span>
                            {isSelected && <Check className="w-3 h-3 text-[var(--accent-color)] shrink-0 ml-1" />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Right Controls: Results Count, View Mode Switcher & Pagination */}
            <div className="flex items-center gap-2.5 text-xs shrink-0 flex-nowrap">
              <span className="text-slate-400 font-sans text-xs flex items-center gap-1.5 whitespace-nowrap shrink-0">
                {filteredAndSortedInstalled.length > 0 && (
                  <>
                    <strong className="text-slate-200 font-semibold">{filteredAndSortedInstalled.length}</strong> {t.installedItemsCount || 'installed'}
                  </>
                )}
              </span>

              {/* View Mode Switcher: Grid vs List with smooth sliding indicator */}
              <div className="relative inline-flex items-center p-0.5 rounded-xl bg-black/40 border border-white/10 select-none shrink-0">
                <div
                  aria-hidden="true"
                  className="absolute top-0.5 bottom-0.5 rounded-lg bg-[var(--accent-subtle)] border border-[var(--accent-border)] pointer-events-none transition-all duration-200"
                  style={{
                    transform: installedViewMode === 'grid' ? 'translateX(0px)' : 'translateX(32px)',
                    width: '32px',
                  }}
                />
                <button
                  type="button"
                  onClick={() => handleInstalledViewModeChange('grid')}
                  className={`relative z-10 w-8 h-7 flex items-center justify-center rounded-lg transition-colors cursor-pointer ${
                    installedViewMode === 'grid' ? 'text-[var(--accent-light)]' : 'text-slate-400 hover:text-white'
                  }`}
                  title={t.viewGrid || 'Grid View'}
                >
                  <LayoutGrid className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => handleInstalledViewModeChange('list')}
                  className={`relative z-10 w-8 h-7 flex items-center justify-center rounded-lg transition-colors cursor-pointer ${
                    installedViewMode === 'list' ? 'text-[var(--accent-light)]' : 'text-slate-400 hover:text-white'
                  }`}
                  title={t.viewList || 'List View'}
                >
                  <List className="w-4 h-4" />
                </button>
              </div>

              {/* Pagination Controls */}
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  disabled={installedPage <= 1}
                  onClick={() => {
                    setInstalledPage((p) => Math.max(1, p - 1));
                    scrollToInstalledTop();
                  }}
                  className="h-[34px] w-[34px] flex items-center justify-center rounded-xl border border-white/10 bg-black/40 hover:bg-white/10 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed transition cursor-pointer shrink-0"
                  title={t.prevPage || 'Previous page'}
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>

                <span className="h-[34px] px-3 flex items-center justify-center rounded-xl bg-white/5 border border-white/10 font-sans text-xs text-slate-200 font-semibold tracking-wide whitespace-nowrap shrink-0">
                  {installedPage} / {totalInstalledPages}
                </span>

                <button
                  type="button"
                  disabled={installedPage >= totalInstalledPages}
                  onClick={() => {
                    setInstalledPage((p) => Math.min(totalInstalledPages, p + 1));
                    scrollToInstalledTop();
                  }}
                  className="h-[34px] w-[34px] flex items-center justify-center rounded-xl border border-white/10 bg-black/40 hover:bg-white/10 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed transition cursor-pointer shrink-0"
                  title={t.nextPage || 'Next page'}
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Empty State (Directory Empty) */}
          {installedItems.length === 0 && (
            <div className="text-center p-8 glass-panel rounded-2xl border border-white/5 space-y-1">
              <Package className="w-6 h-6 text-slate-500 mx-auto" />
              <div className="text-xs text-slate-400">{t.installedEmpty}</div>
            </div>
          )}

          {/* No Search Matches State */}
          {installedItems.length > 0 && filteredAndSortedInstalled.length === 0 && (
            <div className="text-center p-8 glass-panel rounded-2xl border border-white/5 space-y-2">
              <Search className="w-6 h-6 text-slate-500 mx-auto" />
              <div className="text-sm font-semibold text-white">{t.noInstalledMatchTitle || 'No matching installed addons'}</div>
              <div className="text-xs text-slate-400 max-w-sm mx-auto">
                {t.noInstalledMatchDesc || 'No installed items match your current search query or filter.'}
              </div>
              <button
                type="button"
                onClick={() => {
                  setInstalledSearchQuery('');
                  setInstalledStatusFilter('all');
                }}
                className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-xs text-white transition cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>{t.resetBtn || 'Reset'}</span>
              </button>
            </div>
          )}

          {/* Installed Items: GRID VIEW */}
          {pagedInstalledItems.length > 0 && installedViewMode === 'grid' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {pagedInstalledItems.map((mod) => (
                <div
                  key={mod.fileName.replace(/\.disabled$/i, '')}
                  className="glass-panel p-4 rounded-2xl border border-white/10 hover:border-amber-400/30 transition-all duration-200 flex flex-col justify-between group bg-[#161719]/80 hover:bg-[#1a1c20]"
                >
                  <div className="space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className={`w-2.5 h-2.5 rounded-full shrink-0 transition-all duration-200 ${
                            mod.enabled ? 'bg-[var(--accent-color)] shadow-[0_0_8px_var(--accent-glow)]' : 'bg-slate-600'
                          }`}
                          title={mod.enabled ? t.addonEnabled : t.addonDisabled}
                        />
                        <span className="text-sm font-bold text-white truncate font-sans group-hover:text-amber-300 transition-colors">
                          {mod.name}
                        </span>
                      </div>
                      {mod.version && (
                        <span className="text-[10px] px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-300 font-sans font-semibold shrink-0">
                          {mod.version}
                        </span>
                      )}
                    </div>

                    <div className="text-[11px] text-slate-400 font-mono truncate bg-black/30 px-2.5 py-1 rounded-lg border border-white/5">
                      {mod.fileName}
                    </div>
                  </div>

                  <div className="pt-3 mt-3 border-t border-white/5 flex items-center justify-between gap-2">
                    <span className="text-[11px] font-sans font-medium text-slate-400">
                      {(mod.sizeBytes / (1024 * 1024)).toFixed(2)} MB
                    </span>

                    <div className="flex items-center gap-2">
                      {/* Enable / Disable Modern Minimalist Theme Switch */}
                      <ToggleSwitch
                        checked={mod.enabled}
                        onChange={() => handleToggleInstalled(mod)}
                        title={mod.enabled ? t.addonDisabled : t.addonEnabled}
                      />

                      {/* Delete Mod */}
                      <button
                        type="button"
                        onClick={() => handleDeleteInstalled(mod)}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition cursor-pointer"
                        title={t.btnDeleteAddon || 'Delete'}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Installed Items: LIST VIEW */}
          {pagedInstalledItems.length > 0 && installedViewMode === 'list' && (
            <div className="space-y-3 animate-fadeIn">
              {pagedInstalledItems.map((mod) => {
                const getAddonIcon = () => {
                  switch (installedContentType) {
                    case 'shaderpacks':
                      return Sparkles;
                    case 'resourcepacks':
                      return Layers;
                    case 'datapacks':
                      return FileCode;
                    case 'modpacks':
                      return Box;
                    default:
                      return Package;
                  }
                };
                const AddonIcon = getAddonIcon();

                return (
                  <div
                    key={mod.fileName.replace(/\.disabled$/i, '')}
                    className={`rounded-2xl p-4 sm:px-5 sm:py-3.5 border transition-all duration-200 flex items-center justify-between gap-4 group ${
                      mod.enabled
                        ? 'bg-[#161719]/90 border-white/10 hover:border-white/20 hover:bg-[#1a1c20] shadow-sm'
                        : 'bg-[#121315]/70 border-white/5 hover:border-white/10 opacity-70 hover:opacity-85'
                    }`}
                  >
                    {/* Left: Icon & Details */}
                    <div className="flex items-center gap-4 min-w-0 flex-1">
                      <div
                        className={`w-12 h-12 rounded-xl border flex items-center justify-center shrink-0 transition-colors ${
                          mod.enabled
                            ? 'bg-black/50 border-white/10 text-[var(--accent-color)] shadow-inner'
                            : 'bg-black/30 border-white/5 text-slate-600'
                        }`}
                      >
                        <AddonIcon className="w-6 h-6" />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <span className="text-[15px] font-bold text-white font-sans group-hover:text-[var(--accent-light)] transition-colors truncate">
                            {mod.name}
                          </span>
                          {mod.version && (
                            <span className="text-[11px] px-2 py-0.5 rounded-md bg-white/10 border border-white/15 text-slate-300 font-sans font-semibold shrink-0">
                              {mod.version}
                            </span>
                          )}
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-md font-sans font-semibold shrink-0 ${
                              mod.enabled
                                ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400'
                                : 'bg-white/5 border border-white/10 text-slate-500'
                            }`}
                          >
                            {mod.enabled ? (t.enabled || 'Enabled') : (t.disabled || 'Disabled')}
                          </span>
                        </div>

                        <div className="flex items-center gap-2.5 text-xs text-slate-400 font-mono mt-1 flex-wrap">
                          <span className="truncate max-w-[260px] sm:max-w-md lg:max-w-xl text-slate-400 font-mono text-[11px] bg-black/30 px-2 py-0.5 rounded border border-white/5">
                            {mod.fileName}
                          </span>
                          <span className="text-slate-500">•</span>
                          <span className="text-slate-300 font-sans font-semibold text-[11px] shrink-0">
                            {(mod.sizeBytes / (1024 * 1024)).toFixed(2)} MB
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Right: Toggle Switch & Delete Action */}
                    <div className="flex items-center gap-3.5 shrink-0">
                      <ToggleSwitch
                        checked={mod.enabled}
                        onChange={() => handleToggleInstalled(mod)}
                        title={mod.enabled ? t.addonDisabled : t.addonEnabled}
                        size="md"
                      />

                      <button
                        type="button"
                        onClick={() => handleDeleteInstalled(mod)}
                        className="p-2.5 rounded-xl bg-white/[0.03] hover:bg-red-500/15 text-slate-400 hover:text-red-400 border border-white/5 hover:border-red-500/30 transition-all cursor-pointer shrink-0"
                        title={t.btnDeleteAddon || 'Delete'}
                      >
                        <Trash2 className="w-4.5 h-4.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}


          {/* Bottom Pagination for convenience on long lists */}
          {totalInstalledPages > 1 && (
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={installedPage <= 1}
                onClick={() => {
                  setInstalledPage((p) => Math.max(1, p - 1));
                  scrollToInstalledTop();
                }}
                className="h-[34px] w-[34px] flex items-center justify-center rounded-xl border border-white/10 bg-black/40 hover:bg-white/10 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed transition cursor-pointer"
                title={t.prevPage || 'Previous page'}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <span className="h-[34px] px-3 flex items-center justify-center rounded-xl bg-white/5 border border-white/10 font-sans text-xs text-slate-200 font-semibold tracking-wide whitespace-nowrap">
                {installedPage} / {totalInstalledPages}
              </span>

              <button
                type="button"
                disabled={installedPage >= totalInstalledPages}
                onClick={() => {
                  setInstalledPage((p) => Math.min(totalInstalledPages, p + 1));
                  scrollToInstalledTop();
                }}
                className="h-[34px] w-[34px] flex items-center justify-center rounded-xl border border-white/10 bg-black/40 hover:bg-white/10 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed transition cursor-pointer"
                title={t.nextPage || 'Next page'}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Floating Scroll to Top Button */}
      {showScrollTop && (
        <button
          type="button"
          onClick={scrollToInstalledTop}
          className="fixed bottom-6 right-6 z-40 p-3 rounded-full bg-black/80 hover:bg-[var(--accent-color)] border border-white/20 hover:border-transparent text-white shadow-2xl transition-all duration-200 transform hover:scale-110 active:scale-95 cursor-pointer backdrop-blur-md group"
          title={t.scrollToTop || 'Scroll to top'}
        >
          <ArrowUp className="w-5 h-5 text-slate-300 group-hover:text-black transition-colors" />
        </button>
      )}

      {/* Modpack Import Modal (.mrpack) */}
      <InstallModpackModal
        isOpen={isModpackModalOpen}
        onClose={() => {
          setIsModpackModalOpen(false);
          setMrpackFilePath('');
        }}
        initialFilePath={mrpackFilePath}
        onSuccess={(newInstance) => {
          if (onModpackInstalled) {
            onModpackInstalled(newInstance);
          }
          setIsModpackModalOpen(false);
          setMrpackFilePath('');
          setNotification({
            type: 'success',
            text: `${t.modpackInstalledSuccess || 'Modpack installed successfully:'} ${newInstance.name}`,
          });
        }}
        language={language}
      />
    </div>
  );
};
