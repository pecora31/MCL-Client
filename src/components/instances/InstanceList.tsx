import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Plus, Play, Trash2, Edit3, Clock, Layers, HardDrive, FolderOpen, Search, X, ChevronLeft, ChevronRight, ArrowUpDown, ArrowDownAZ, ArrowUpZA, ChevronDown, Check, BrushCleaning, Copy, Archive, Share2, Download } from 'lucide-react';
import type { GameInstance } from '../../types';
import { getTranslation, type Language } from '../../locales/i18n';

interface InstanceListProps {
  instances: GameInstance[];
  selectedInstanceId: string;
  onSelectInstance: (id: string) => void;
  onLaunchInstance: (id: string) => void;
  onEditInstance: (instance: GameInstance) => void;
  onDuplicateInstance: (instance: GameInstance) => void;
  onBackupWorlds: (instance: GameInstance) => void;
  onRequestDeleteInstance: (instance: GameInstance) => void;
  onOpenInstanceDir: (id: string) => void;
  onOpenCreateModal: () => void;
  onShareInstance: (instance: GameInstance) => void;
  onImportShareCode: () => void;
  onOpenCleanStorageModal?: () => void;
  isRunning: boolean;
  defaultGameDir?: string;
  onChangeDefaultGameDir?: () => void;
  onOpenDefaultGameDir?: () => void;
  language?: Language;
}

const PAGE_SIZE = 12;

function formatLastPlayed(lastPlayed: string | undefined, t: any): string {
  if (!lastPlayed) return t.neverPlayed || 'Never';

  // The backend stamps a real timestamp when a session ends; older profiles still carry the
  // free-form strings the UI used to write, so both shapes are handled.
  const stamped = new Date(lastPlayed);
  if (!Number.isNaN(stamped.getTime())) {
    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const days = Math.round((startOfDay(new Date()) - startOfDay(stamped)) / 86_400_000);
    const time = stamped.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (days <= 0) return `${t.todayAt || 'Today'}, ${time}`;
    if (days === 1) return t.yesterday || 'Yesterday';
    if (days < 30) return `${days} ${t.daysAgo || 'days ago'}`;
    return stamped.toLocaleDateString();
  }

  const lower = lastPlayed.toLowerCase();
  if (lower.includes('hôm nay') || lower.includes('today')) {
    const timePart = lastPlayed.split(/,\s*/)[1] || '';
    return timePart ? `${t.todayAt || 'Today'}, ${timePart}` : (t.todayAt || 'Today');
  }
  if (lower.includes('hôm qua') || lower.includes('yesterday')) {
    return t.yesterday || 'Yesterday';
  }
  if (lower.includes('vừa tạo') || lower.includes('just created')) {
    return t.justCreated || 'Just created';
  }
  if (lower.includes('ngày trước') || lower.includes('days ago')) {
    const num = lastPlayed.match(/\d+/)?.[0] || '';
    return num ? `${num} ${t.daysAgo || 'days ago'}` : lastPlayed;
  }
  return lastPlayed;
}

export const InstanceList: React.FC<InstanceListProps> = ({
  instances,
  selectedInstanceId,
  onSelectInstance,
  onLaunchInstance,
  onEditInstance,
  onDuplicateInstance,
  onBackupWorlds,
  onRequestDeleteInstance,
  onOpenInstanceDir,
  onOpenCreateModal,
  onShareInstance,
  onImportShareCode,
  onOpenCleanStorageModal,
  isRunning,
  defaultGameDir,
  onChangeDefaultGameDir,
  onOpenDefaultGameDir,
  language = 'en',
}) => {
  const t = getTranslation(language);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'default' | 'az' | 'za'>('default');
  const [isSortOpen, setIsSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);
  const [currentPage, setCurrentPage] = useState(0);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) {
        setIsSortOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsSortOpen(false);
      }
    };
    if (isSortOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isSortOpen]);

  const filteredAndSortedInstances = useMemo(() => {
    let result = [...instances];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (inst) =>
          inst.name.toLowerCase().includes(q) ||
          inst.gameVersion.toLowerCase().includes(q) ||
          inst.loader.toLowerCase().includes(q)
      );
    }

    if (sortBy === 'az') {
      result.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    } else if (sortBy === 'za') {
      result.sort((a, b) => b.name.localeCompare(a.name, undefined, { sensitivity: 'base' }));
    }

    return result;
  }, [instances, searchQuery, sortBy]);

  const totalPages = Math.ceil(filteredAndSortedInstances.length / PAGE_SIZE);

  useEffect(() => {
    if (currentPage >= totalPages && totalPages > 0) {
      setCurrentPage(totalPages - 1);
    }
  }, [totalPages, currentPage]);

  useEffect(() => {
    setCurrentPage(0);
  }, [searchQuery, sortBy]);

  const paginatedInstances = useMemo(() => {
    const start = currentPage * PAGE_SIZE;
    return filteredAndSortedInstances.slice(start, start + PAGE_SIZE);
  }, [filteredAndSortedInstances, currentPage]);

  return (
    <div className="flex-1 flex flex-col overflow-y-auto p-10 space-y-7 custom-scrollbar">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pr-12">
        <div>
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[var(--accent-color)]/10 border border-[var(--accent-color)]/20 text-[var(--accent-color)] text-xs font-semibold mb-2 tracking-wide">
            <Layers className="w-4 h-4" />
            <span>{t.badgeProfileManager || 'Profile Manager'}</span>
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-normal">{t.instancesTitle || 'Game Profiles & Versions'}</h1>
          <p className="text-base text-slate-300 mt-1 tracking-wide">
            {t.instancesSub || 'Each profile is stored in an isolated directory with its own mods and configurations.'}
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {onOpenCleanStorageModal && (
            <button
              onClick={onOpenCleanStorageModal}
              className="h-11 px-4 rounded-2xl bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border border-white/10 text-xs font-bold flex items-center gap-2 transition tracking-wide shadow-none cursor-pointer"
              title={t.storageCleanupTooltip || 'Clean unused versions and cache'}
            >
              <BrushCleaning className="w-4 h-4 text-[var(--accent-color)]" />
              <span>{t.btnCleanStorage || 'Clean Storage & Cache'}</span>
            </button>
          )}

          <button
            onClick={onImportShareCode}
            title={t.importTitle || 'Import a profile'}
            className="h-11 px-4 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 border border-white/10 text-white transition shrink-0 cursor-pointer active:scale-95"
          >
            <Download className="w-4 h-4" />
            <span>{t.importStart || 'Import profile'}</span>
          </button>

          <button
            onClick={onOpenCreateModal}
            className="btn-primary h-11 px-6 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 shadow-none hover:shadow-none shrink-0 tracking-wide cursor-pointer active:scale-95 transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>{t.btnCreateProfile || 'New Profile'}</span>
          </button>
        </div>
      </div>

      {/* Default Game Storage Directory Bar (At the very top of Profile Menu) */}
      <div className="rounded-2xl bg-white/[0.03] border border-white/[0.08] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-inner">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
            <HardDrive className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-bold font-riot text-slate-300 uppercase tracking-wider">
              {t.defaultDirLabel}
            </div>
            <div
              className="text-xs font-mono text-amber-300/90 truncate max-w-xl mt-0.5"
              title={defaultGameDir || ''}
            >
              {defaultGameDir || '%APPDATA%\\MCL Client'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {onChangeDefaultGameDir && (
            <button
              onClick={onChangeDefaultGameDir}
              className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border border-white/10 text-xs font-bold font-riot flex items-center gap-1.5 transition cursor-pointer"
              title={t.btnChangeDir}
            >
              <Edit3 className="w-3.5 h-3.5 text-amber-400" />
              <span>{t.btnChangeDir}</span>
            </button>
          )}

          {onOpenDefaultGameDir && (
            <button
              onClick={onOpenDefaultGameDir}
              className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border border-white/10 text-xs font-bold font-riot flex items-center gap-1.5 transition cursor-pointer"
              title={t.btnOpenDir}
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span>{t.btnOpenDir}</span>
            </button>
          )}
        </div>
      </div>

      {/* Ultra-Minimalist Search & Sort Bar */}
      {instances.length > 0 && (
        <div className="flex items-center justify-between gap-3 -mt-2">
          {/* Search Bar - Matching height, font size, glass-input and effects from ModStore */}
          <div className="relative w-64 sm:w-72">
            <Search className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t.searchProfilesPlaceholder}
              className="w-full glass-input pl-11 pr-10 py-3 rounded-2xl text-sm text-white focus:outline-none focus:border-[var(--accent-color)] shadow-inner transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1 hover:bg-white/10 rounded-lg transition text-slate-400 hover:text-white cursor-pointer"
                title={t.clearSearch || 'Clear search'}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Sort Dropdown Menu */}
          <div className="relative" ref={sortRef}>
            <button
              type="button"
              onClick={() => setIsSortOpen((prev) => !prev)}
              className={`min-w-[108px] h-[46px] px-3.5 rounded-2xl border text-xs font-semibold flex items-center justify-between gap-2 transition cursor-pointer shrink-0 shadow-sm active:scale-95 ${
                sortBy !== 'default'
                  ? 'bg-[var(--accent-subtle)] border-[var(--accent-border)] text-[var(--accent-light)]'
                  : isSortOpen
                  ? 'bg-white/[0.08] border-white/20 text-white'
                  : 'bg-white/[0.03] hover:bg-white/[0.06] border-white/10 text-slate-300 hover:text-white'
              }`}
              title={t.sortLabel}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                {sortBy === 'az' ? (
                  <ArrowDownAZ className="w-3.5 h-3.5 text-[var(--accent-color)] shrink-0" />
                ) : sortBy === 'za' ? (
                  <ArrowUpZA className="w-3.5 h-3.5 text-[var(--accent-color)] shrink-0" />
                ) : (
                  <ArrowUpDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                )}
                <span>
                  {sortBy === 'az' ? 'A → Z' : sortBy === 'za' ? 'Z → A' : t.sortDefault}
                </span>
              </div>
              <ChevronDown
                className={`w-3 h-3 text-slate-400 transition-transform duration-200 shrink-0 ${
                  isSortOpen ? 'rotate-180 text-white' : ''
                }`}
              />
            </button>

            {/* Dropdown Options List */}
            {isSortOpen && (
              <div className="absolute left-0 right-0 top-full mt-1.5 rounded-xl bg-[#141416] border border-white/10 shadow-2xl p-1 z-40 space-y-0.5 animate-dropdown backdrop-blur-md">
                {[
                  { id: 'default' as const, label: t.sortDefault, icon: ArrowUpDown },
                  { id: 'az' as const, label: 'A → Z', icon: ArrowDownAZ },
                  { id: 'za' as const, label: 'Z → A', icon: ArrowUpZA },
                ]
                  .filter((opt) => opt.id !== sortBy)
                  .map((opt) => {
                    const Icon = opt.icon;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          setSortBy(opt.id);
                          setIsSortOpen(false);
                        }}
                        className="w-full px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-2 transition cursor-pointer text-slate-300 hover:text-white hover:bg-white/[0.08]"
                      >
                        <Icon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="truncate">{opt.label}</span>
                      </button>
                    );
                  })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Grid of Instances, Empty State, or No Search Results */}
      {instances.length === 0 ? (
        <div className="minimal-panel rounded-2xl p-12 border border-white/[0.06] text-center flex flex-col items-center justify-center space-y-5 max-w-xl mx-auto my-12 shadow-2xl animate-fadeIn">
          <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center shadow-lg">
            <Layers className="w-8 h-8" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-white font-riot">No Profiles Found</h3>
            <p className="text-xs text-slate-400 mt-1.5 max-w-md leading-relaxed">
              You haven't created any profiles yet. Create your first profile to download Minecraft assets and begin playing!
            </p>
          </div>
          <button
            onClick={onOpenCreateModal}
            className="btn-primary py-3 px-6 rounded-xl font-riot font-bold text-sm flex items-center gap-2 shadow-lg cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Create First Profile</span>
          </button>
        </div>
      ) : filteredAndSortedInstances.length === 0 ? (
        <div className="minimal-panel rounded-2xl p-10 border border-white/[0.06] text-center flex flex-col items-center justify-center space-y-4 max-w-md mx-auto my-8 shadow-xl animate-fadeIn">
          <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 text-slate-400 flex items-center justify-center">
            <Search className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white font-riot">{t.noMatchingProfiles}</h3>
            <p className="text-xs text-slate-400 mt-1 max-w-sm leading-relaxed">
              {t.noMatchingProfilesDesc}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setSearchQuery('');
              setSortBy('default');
            }}
            className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-semibold text-white transition cursor-pointer"
          >
            Clear Search
          </button>
        </div>
      ) : (
        <>
          <div
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full"
            style={{ gridAutoRows: '216px' }}
          >
            {paginatedInstances.map((inst) => {
              const isSelected = inst.id === selectedInstanceId;

              return (
                <div
                  key={inst.id}
                  onClick={() => onSelectInstance(inst.id)}
                  style={{
                    height: '216px',
                    minHeight: '216px',
                    maxHeight: '216px',
                    boxSizing: 'border-box',
                  }}
                  className={`relative rounded-2xl p-6 border-2 transition-all duration-150 cursor-pointer flex flex-col justify-between select-none w-full min-w-0 max-w-full overflow-hidden ${
                    isSelected
                      ? 'border-[var(--accent-color)] bg-theme-selected-card shadow-lg shadow-black/40 -translate-y-0.5'
                      : 'border-white/[0.07] bg-[#161616] hover:border-white/20 hover:bg-[#1c1c1c] hover:-translate-y-0.5 hover:shadow-md hover:shadow-black/30'
                  }`}
                >
                  {/* Header */}
                  <div className="space-y-1.5 shrink-0 min-w-0 w-full overflow-hidden">
                    {/* Row 1: Title (full width when unselected, truncates only when selected) + Badge */}
                    <div className="flex items-center justify-between gap-2.5 min-w-0 w-full h-7">
                      <h3
                        className="text-lg font-bold text-white leading-snug truncate tracking-wide flex-1 min-w-0"
                        title={inst.name}
                      >
                        {inst.name}
                      </h3>

                      {isSelected && (
                        <div
                          title={t.selectedTag || 'Selected'}
                          className="w-6 h-6 rounded-full bg-emerald-500 border border-emerald-400/40 flex items-center justify-center shadow-md shadow-emerald-950/40 shrink-0 select-none animate-fadeIn"
                        >
                          <Check className="w-3.5 h-3.5 stroke-[3] text-white" />
                        </div>
                      )}
                    </div>

                    {/* Row 2: Version & Loader Info - FULL WIDTH of the card */}
                    <div className="flex items-center gap-2 text-xs text-slate-300 tracking-wide whitespace-nowrap overflow-hidden h-5 w-full">
                      <span className="font-semibold text-white shrink-0">Minecraft {inst.gameVersion}</span>
                      <span className="text-slate-500 shrink-0">•</span>
                      <span className="capitalize text-amber-400 font-bold font-mono truncate">
                        {inst.loader === 'vanilla' ? 'Vanilla' : `${inst.loader.toUpperCase()} ${inst.loaderVersion || ''}`}
                      </span>
                    </div>
                  </div>

                  {/* Middle Info Row: Custom Dir or Last Played */}
                  <div className="space-y-1.5 my-auto min-w-0 w-full overflow-hidden">
                    {inst.customDir && (
                      <div
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.02] border border-amber-500/20 text-[11px] font-mono text-amber-300/80 truncate w-full"
                        title={inst.customDir}
                      >
                        <FolderOpen className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        <span className="truncate">{inst.customDir}</span>
                      </div>
                    )}

                    {/* Last played info */}
                    <div className="flex items-center gap-2 text-xs text-slate-400 tracking-wide w-full truncate">
                      <Clock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      <span className="truncate">{t.lastPlayedPrefix || t.lastPlayed || 'Last played'}: {formatLastPlayed(inst.lastPlayed, t)}</span>
                    </div>
                  </div>

                  {/* Actions Footer */}
                  <div className="pt-3 border-t border-white/[0.06] flex items-center justify-between gap-2 shrink-0 w-full">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onLaunchInstance(inst.id);
                      }}
                      disabled={isRunning}
                      className={`py-2 px-4 rounded-xl font-bold text-xs flex items-center gap-2 transition tracking-wider shrink-0 ${
                        isSelected
                          ? 'bg-amber-400 hover:bg-amber-300 text-slate-950 shadow-md'
                          : 'bg-white/10 hover:bg-white/20 text-white'
                      }`}
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>{t.btnPlay || t.btnLaunch || 'PLAY'}</span>
                    </button>

                    <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => onOpenInstanceDir(inst.id)}
                        title={t.openFolderInExplorer || 'Open profile folder in File Explorer'}
                        className="p-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
                      >
                        <FolderOpen className="w-4 h-4" />
                      </button>

                      <button
                        onClick={() => onEditInstance(inst)}
                        title={t.editServer || 'Edit Profile'}
                        className="p-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>

                      <button
                        onClick={() => onDuplicateInstance(inst)}
                        title="Duplicate Profile"
                        className="p-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
                      >
                        <Copy className="w-4 h-4" />
                      </button>

                      <button
                        onClick={() => onShareInstance(inst)}
                        title={t.shareTitle || 'Share this profile'}
                        className="p-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
                      >
                        <Share2 className="w-4 h-4" />
                      </button>

                      <button
                        onClick={() => onBackupWorlds(inst)}
                        title="Back up worlds"
                        className="p-2.5 rounded-xl text-slate-400 hover:text-emerald-300 hover:bg-emerald-500/10 transition cursor-pointer"
                      >
                        <Archive className="w-4 h-4" />
                      </button>

                      <button
                        onClick={() => onRequestDeleteInstance(inst)}
                        title={t.btnDeleteProfile || 'Delete Profile'}
                        className="p-2.5 rounded-xl text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Interactive Dot Pagination: No numbers, clickable dots with prev/next buttons */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-4 pt-4 pb-2">
              {/* Previous Page Button */}
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
                disabled={currentPage === 0}
                className="w-9 h-9 rounded-xl bg-white/[0.04] hover:bg-white/[0.1] disabled:opacity-25 disabled:hover:bg-white/[0.04] disabled:cursor-not-allowed text-slate-300 hover:text-white border border-white/10 flex items-center justify-center transition cursor-pointer active:scale-95"
                title={t.prevPage || 'Previous'}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              {/* Interactive Dots */}
              <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-full bg-black/40 border border-white/10 shadow-inner">
                {Array.from({ length: totalPages }).map((_, idx) => {
                  const isActive = currentPage === idx;
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setCurrentPage(idx)}
                      className={`transition-all duration-200 cursor-pointer ${
                        isActive
                          ? 'w-7 h-2.5 rounded-full bg-[var(--accent-color)] shadow-sm shadow-[var(--accent-glow)]'
                          : 'w-2.5 h-2.5 rounded-full bg-white/25 hover:bg-white/50 hover:scale-125'
                      }`}
                      title={`${t.page || 'Page'} ${idx + 1}`}
                    />
                  );
                })}
              </div>

              {/* Next Page Button */}
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(0, Math.min(totalPages - 1, p + 1)))}
                disabled={currentPage === totalPages - 1}
                className="w-9 h-9 rounded-xl bg-white/[0.04] hover:bg-white/[0.1] disabled:opacity-25 disabled:hover:bg-white/[0.04] disabled:cursor-not-allowed text-slate-300 hover:text-white border border-white/10 flex items-center justify-center transition cursor-pointer active:scale-95"
                title={t.nextPage || 'Next'}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};
