import React from 'react';
import { X, Download, ExternalLink, Check, RefreshCw, Heart, Clock, Monitor, Server, Globe, Package } from 'lucide-react';
import type { AddonItem, AddonContentType } from '../../types';
import { getTranslation, type Language } from '../../locales/i18n';
import { openExternalUrl } from '../../services/externalLink';
import { ModrinthLogo, CurseForgeLogo, getLoaderIcon } from './ModIcons';

interface ModDetailModalProps {
  item: AddonItem | null;
  isInstalling: boolean;
  isInstalled: boolean;
  onClose: () => void;
  onInstall: (item: AddonItem) => void;
  language: Language;
}

function formatCount(num: number): string {
  if (!num || num <= 0) return '0';
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K';
  return num.toString();
}

function formatFullDate(dateStr?: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleDateString();
}

/**
 * A read-first stop before installing: everything a search-result card only hints at
 * (full description, every category and supported loader, publish stats) without leaving
 * the app the way "view on Modrinth/CurseForge" does.
 */
export const ModDetailModal: React.FC<ModDetailModalProps> = ({
  item,
  isInstalling,
  isInstalled,
  onClose,
  onInstall,
  language,
}) => {
  const t = getTranslation(language);
  if (!item) return null;

  const environmentLabel =
    item.environment === 'client'
      ? { icon: <Monitor className="w-3.5 h-3.5 text-slate-400" />, text: 'Client' }
      : item.environment === 'server'
      ? { icon: <Server className="w-3.5 h-3.5 text-slate-400" />, text: 'Server' }
      : { icon: <Globe className="w-3.5 h-3.5 text-slate-400" />, text: 'Client or server' };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-sm p-6 animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[85vh] rounded-3xl border border-white/10 shadow-2xl overflow-hidden bg-[#121212] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-4 px-6 py-5 border-b border-white/[0.08] bg-[#161616]">
          <div className="w-16 h-16 rounded-2xl bg-slate-950/80 border border-white/10 overflow-hidden flex items-center justify-center shrink-0 shadow-inner">
            {item.iconUrl ? (
              <img src={item.iconUrl} alt={item.name} className="w-full h-full object-cover" />
            ) : (
              <Package className="w-7 h-7 text-amber-400" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold font-riot text-white tracking-wide truncate">{item.name}</h2>
            {item.author && (
              <p className="text-sm text-slate-400 mt-0.5">
                {t.authorBy || 'by'} <strong className="text-slate-200 font-medium">{item.author}</strong>
              </p>
            )}
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              {(item.source === 'modrinth' || item.sources?.includes('modrinth') || Boolean(item.modrinthId)) && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[#1bd96a]/15 border border-[#1bd96a]/40 text-[11px] font-bold text-[#1bd96a]">
                  <ModrinthLogo className="w-3.5 h-3.5" />
                  <span>Modrinth</span>
                </span>
              )}
              {(item.source === 'curseforge' || item.sources?.includes('curseforge') || Boolean(item.curseforgeId)) && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[#f16436]/15 border border-[#f16436]/40 text-[11px] font-bold text-[#f16436]">
                  <CurseForgeLogo className="w-3.5 h-3.5" />
                  <span>CurseForge</span>
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-[#2a2b2f]/90 hover:bg-[#383a40] text-white border border-white/10 shadow-lg flex items-center justify-center transition-all duration-150 active:scale-90 cursor-pointer shrink-0"
            title="Close"
          >
            <X className="w-4.5 h-4.5 text-white" strokeWidth={3} />
          </button>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto custom-scrollbar">
          <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-line">
            {item.summary || 'No description provided.'}
          </p>

          <div className="flex items-center gap-4 text-sm text-slate-400 flex-wrap">
            <span className="flex items-center gap-1.5" title={t.downloadsCountTooltip || 'Downloads'}>
              <Download className="w-4 h-4 text-slate-500" />
              <strong className="text-slate-200 font-bold">{formatCount(item.downloads)}</strong>
            </span>
            {item.follows && item.follows > 0 ? (
              <span className="flex items-center gap-1.5" title={t.favoritesCountTooltip || 'Favorites'}>
                <Heart className="w-4 h-4 text-rose-500/90" />
                <span>{formatCount(item.follows)}</span>
              </span>
            ) : null}
            {item.updatedAt && (
              <span className="flex items-center gap-1.5" title={t.updated || 'Updated'}>
                <Clock className="w-4 h-4 text-slate-500" />
                <span>{formatFullDate(item.updatedAt)}</span>
              </span>
            )}
            <span className="flex items-center gap-1.5">
              {environmentLabel.icon}
              <span>{environmentLabel.text}</span>
            </span>
          </div>

          {item.loaders && item.loaders.length > 0 && (
            <div>
              <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider mb-2">Mod Loader</div>
              <div className="flex flex-wrap gap-1.5">
                {item.loaders.map((loader) => (
                  <span
                    key={loader}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-xs font-medium text-slate-300 capitalize"
                  >
                    {getLoaderIcon(loader, 'w-3.5 h-3.5')}
                    <span>{loader}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {item.categories && item.categories.length > 0 && (
            <div>
              <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider mb-2">Categories</div>
              <div className="flex flex-wrap gap-1.5">
                {item.categories.map((cat) => (
                  <span
                    key={cat}
                    className="px-2.5 py-1 rounded-lg bg-white/[0.04] text-xs text-slate-300 border border-white/5 font-medium capitalize"
                  >
                    {cat}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-white/[0.08] bg-[#161616]/50 shrink-0">
          <a
            href={item.webUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => {
              e.preventDefault();
              openExternalUrl(item.webUrl);
            }}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-white/10 hover:bg-white/15 border border-white/10 text-white transition cursor-pointer flex items-center gap-2"
          >
            <ExternalLink className="w-4 h-4" />
            <span>{t.viewOfficialWeb || 'View details on official website'}</span>
          </a>
          <button
            onClick={() => onInstall(item)}
            disabled={isInstalling || isInstalled}
            className={`px-6 py-2.5 rounded-xl text-sm font-bold font-riot flex items-center gap-2 cursor-pointer shadow-md active:scale-95 transition disabled:opacity-70 ${
              isInstalled ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30' : 'btn-primary'
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
                <span>{t.installingBtn || 'Installing'}</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>{t.btnInstall || 'Install'}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
