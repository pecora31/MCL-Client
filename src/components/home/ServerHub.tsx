import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Play, Wifi, Users, Server, Copy, Check, RefreshCw, Square, ChevronDown, Plus, Globe, Pause, Trash2, Edit3, Save, X, Search, ChevronLeft, ChevronRight, ArrowUpDown, ArrowDownAZ, ArrowUpZA, Activity, CheckCircle2, AlertCircle, Image as ImageIcon } from 'lucide-react';
import type { GameInstance, ServerStatus, LaunchProgress, SavedServer } from '../../types';
import { pingServer, isTauri } from '../../services/api';
import packageJson from '../../../package.json';
import { getTranslation, type Language } from '../../locales/i18n';
import { ToggleSwitch } from '../common/ToggleSwitch';

interface ServerHubProps {
  instances: GameInstance[];
  selectedInstanceId: string;
  onSelectInstance: (id: string) => void;
  onLaunch: () => void;
  onStopGame: () => void;
  onCancelDownload?: () => void;
  launchProgress: LaunchProgress;
  isRunning: boolean;
  isPreparing?: boolean;
  language: Language;
  onOpenCreateModal?: () => void;
  savedServers: SavedServer[];
  activeServerId: string;
  onSelectActiveServer: (id: string) => void;
  onAddServer: (server: Omit<SavedServer, 'id'>) => void;
  onUpdateServer: (server: SavedServer) => void;
  onDeleteServer: (id: string) => void;
  directConnectServer: boolean;
  onToggleDirectConnectServer: (enabled: boolean) => void;
  onOpenBackgroundModal?: () => void;
}

export const ServerHub: React.FC<ServerHubProps> = ({
  instances,
  selectedInstanceId,
  onSelectInstance,
  onLaunch,
  onStopGame,
  onCancelDownload,
  launchProgress,
  isRunning,
  isPreparing = false,
  language,
  onOpenCreateModal,
  savedServers,
  activeServerId,
  onSelectActiveServer,
  onAddServer,
  onUpdateServer,
  onDeleteServer,
  directConnectServer,
  onToggleDirectConnectServer,
  onOpenBackgroundModal,
}) => {
  const t = getTranslation(language);
  const selectedInstance = instances.find((i) => i.id === selectedInstanceId) || instances[0];
  const currentSavedServer = savedServers.find((s) => s.id === activeServerId) || savedServers[0];

  const [activeTab, setActiveTab] = useState<'overview' | 'server'>('overview');
  // Read straight from the running binary's own version rather than a hardcoded string,
  // so this label never drifts from what a release actually bumps.
  const [appVersion, setAppVersion] = useState(packageJson.version);
  useEffect(() => {
    if (!isTauri()) return;
    import('@tauri-apps/api/app')
      .then(({ getVersion }) => getVersion())
      .then(setAppVersion)
      .catch((err) => console.warn('Could not read the app version:', err));
  }, []);
  const overviewTabRef = React.useRef<HTMLButtonElement>(null);
  const serverTabRef = React.useRef<HTMLButtonElement>(null);
  const [tabPillStyle, setTabPillStyle] = useState<{ left: number; width: number }>({ left: 4, width: 92 });

  React.useLayoutEffect(() => {
    const target = activeTab === 'overview' ? overviewTabRef.current : serverTabRef.current;
    if (target) {
      setTabPillStyle({
        left: target.offsetLeft,
        width: target.offsetWidth,
      });
    }
  }, [activeTab, language]);

  const [copied, setCopied] = useState(false);
  const [isPinging, setIsPinging] = useState(false);
  const [isHoveringStop, setIsHoveringStop] = useState(false);
  const [isHoveringLoadingButton, setIsHoveringLoadingButton] = useState(false);
  const [isProfileDropdownOpen, setIsProfileDropdownOpen] = useState(false);
  const [isServerDropdownOpen, setIsServerDropdownOpen] = useState(false);

  // Server management: Search, Sort & Pagination
  const [serverSearch, setServerSearch] = useState('');
  const [serverSort, setServerSort] = useState<'default' | 'az' | 'za' | 'pingAsc' | 'pingDesc' | 'playersDesc'>('default');
  const [isServerSortOpen, setIsServerSortOpen] = useState(false);
  const [serverPage, setServerPage] = useState(1);
  const SERVERS_PER_PAGE = 5;

  // Per-server ping cache: Record<serverId, ServerStatus>
  const [serverPingMap, setServerPingMap] = useState<Record<string, ServerStatus>>({});

  const serverSortRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (serverSortRef.current && !serverSortRef.current.contains(e.target as Node)) {
        setIsServerSortOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Background-ping ALL saved servers so chips are always populated
  useEffect(() => {
    let cancelled = false;
    const pingAll = async () => {
      for (const srv of savedServers) {
        if (cancelled) break;
        try {
          const status = await pingServer(srv.ip, srv.port || 25565);
          if (!cancelled) {
            setServerPingMap((prev) => ({ ...prev, [srv.id]: status }));
          }
        } catch {
          // ignore individual errors
        }
      }
    };
    pingAll();
    const interval = setInterval(pingAll, 60000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [savedServers]);


  // Filtered and sorted servers
  const filteredAndSortedServers = useMemo(() => {
    let list = [...savedServers];
    if (serverSearch.trim()) {
      const q = serverSearch.toLowerCase().trim();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.ip.toLowerCase().includes(q) ||
          String(s.port).includes(q)
      );
    }
    if (serverSort === 'az') {
      list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    } else if (serverSort === 'za') {
      list.sort((a, b) => b.name.localeCompare(a.name, undefined, { sensitivity: 'base' }));
    } else if (serverSort === 'pingAsc') {
      list.sort((a, b) => (serverPingMap[a.id]?.pingMs ?? 9999) - (serverPingMap[b.id]?.pingMs ?? 9999));
    } else if (serverSort === 'pingDesc') {
      list.sort((a, b) => (serverPingMap[b.id]?.pingMs ?? 0) - (serverPingMap[a.id]?.pingMs ?? 0));
    } else if (serverSort === 'playersDesc') {
      list.sort((a, b) => (serverPingMap[b.id]?.playersOnline ?? 0) - (serverPingMap[a.id]?.playersOnline ?? 0));
    }
    return list;
  }, [savedServers, serverSearch, serverSort, serverPingMap]);


  const totalServerPages = Math.max(1, Math.ceil(filteredAndSortedServers.length / SERVERS_PER_PAGE));

  useEffect(() => {
    if (serverPage > totalServerPages) {
      setServerPage(totalServerPages);
    }
  }, [totalServerPages, serverPage]);

  useEffect(() => {
    setServerPage(1);
  }, [serverSearch, serverSort]);

  const paginatedServers = useMemo(() => {
    const start = (serverPage - 1) * SERVERS_PER_PAGE;
    return filteredAndSortedServers.slice(start, start + SERVERS_PER_PAGE);
  }, [filteredAndSortedServers, serverPage]);

  // Modal Dialog states (Add / Edit Server)
  const [isServerModalOpen, setIsServerModalOpen] = useState(false);
  const [isEditingServer, setIsEditingServer] = useState(false);
  const [editingServerId, setEditingServerId] = useState<string | null>(null);
  const [serverNameInput, setServerNameInput] = useState('');
  const [serverIpInput, setServerIpInput] = useState('');
  const [serverPortInput, setServerPortInput] = useState(25565);

  // Test ping in modal
  const [isTestingPing, setIsTestingPing] = useState(false);
  const [testPingResult, setTestPingResult] = useState<{
    tested: boolean;
    online: boolean;
    pingMs?: number;
    motd?: string;
  } | null>(null);

  // Quick delete confirmation state
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const [serverStatus, setServerStatus] = useState<ServerStatus>({
    ip: currentSavedServer?.ip || '',
    port: currentSavedServer?.port || 25565,
    online: false,
  });

  const handleRefreshPing = async () => {
    if (!currentSavedServer) {
      setServerStatus({ ip: '', port: 25565, online: false });
      return;
    }
    setIsPinging(true);
    try {
      const status = await pingServer(currentSavedServer.ip, currentSavedServer.port);
      setServerStatus(status);
    } catch {
      // Keep existing
    } finally {
      setIsPinging(false);
    }
  };

  useEffect(() => {
    handleRefreshPing();
    const interval = setInterval(handleRefreshPing, 30000);
    return () => clearInterval(interval);
  }, [currentSavedServer?.ip, currentSavedServer?.port]);

  const handleCopyIp = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    const target = currentSavedServer
      ? `${currentSavedServer.ip}${currentSavedServer.port !== 25565 ? `:${currentSavedServer.port}` : ''}`
      : `${serverStatus.ip}:${serverStatus.port}`;
    navigator.clipboard.writeText(target);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenAddServerModal = () => {
    setServerNameInput('');
    setServerIpInput('');
    setServerPortInput(25565);
    setIsEditingServer(false);
    setEditingServerId(null);
    setTestPingResult(null);
    setIsServerModalOpen(true);
  };

  const handleOpenEditServerModal = (srv: SavedServer, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setServerNameInput(srv.name);
    setServerIpInput(srv.ip);
    setServerPortInput(srv.port);
    setIsEditingServer(true);
    setEditingServerId(srv.id);
    setTestPingResult(null);
    setIsServerModalOpen(true);
  };

  const handleTestPingInModal = async () => {
    if (!serverIpInput.trim()) return;
    setIsTestingPing(true);
    setTestPingResult(null);
    try {
      const status = await pingServer(serverIpInput.trim(), serverPortInput || 25565);
      setTestPingResult({
        tested: true,
        online: status.online,
        pingMs: status.pingMs,
        motd: status.motd,
      });
    } catch {
      setTestPingResult({
        tested: true,
        online: false,
      });
    } finally {
      setIsTestingPing(false);
    }
  };

  const handleSaveServerModal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!serverNameInput.trim() || !serverIpInput.trim()) return;

    if (isEditingServer && editingServerId) {
      onUpdateServer({
        id: editingServerId,
        name: serverNameInput.trim(),
        ip: serverIpInput.trim(),
        port: serverPortInput || 25565,
      });
    } else {
      onAddServer({
        name: serverNameInput.trim(),
        ip: serverIpInput.trim(),
        port: serverPortInput || 25565,
      });
    }
    setIsServerModalOpen(false);
  };

  const handleDeleteServerWithConfirm = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (deleteConfirmId === id) {
      onDeleteServer(id);
      setDeleteConfirmId(null);
    } else {
      setDeleteConfirmId(id);
      setTimeout(() => setDeleteConfirmId(null), 3500);
    }
  };

  const isPreparingOrDownloading =
    isPreparing ||
    (launchProgress.stage !== 'idle' && launchProgress.stage !== 'running' && !isRunning);

  // SVG Circular Progress calculation
  const circleRadius = 15;
  const circleCircumference = 2 * Math.PI * circleRadius; // ~94.25
  const progressPercent = Math.min(100, Math.max(3, launchProgress.percentage || 0));
  const strokeOffset = circleCircumference - (circleCircumference * progressPercent) / 100;

  return (
    <div className="flex-1 flex flex-col justify-between overflow-hidden relative select-none bg-transparent">
      {/* Top Header Capsule Bar */}
      <div className="px-10 pt-4 pb-2 flex items-center justify-between z-10 bg-transparent">
        {/* Center Capsule Tabs with Smooth Sliding Pill (ModStore Style) */}
        <div className="relative inline-flex items-center p-1 rounded-2xl bg-[#141414]/90 border border-white/10 shadow-lg select-none">
          {/* Smooth Sliding Pill Indicator with theme accent color */}
          <div
            aria-hidden="true"
            className="absolute top-1 bottom-1 rounded-xl bg-[var(--accent-color)] shadow-md shadow-[var(--accent-subtle)] pointer-events-none transition-all duration-300"
            style={{
              left: `${tabPillStyle.left}px`,
              width: `${tabPillStyle.width}px`,
              transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          />

          <button
            ref={overviewTabRef}
            onClick={() => setActiveTab('overview')}
            className={`relative z-10 px-5 py-2 rounded-xl text-sm font-bold font-sans tracking-wide transition-colors duration-200 border-none outline-none cursor-pointer ${
              activeTab === 'overview'
                ? 'text-[#070a12]'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            {t.tabOverview || 'Overview'}
          </button>
          <button
            ref={serverTabRef}
            onClick={() => setActiveTab('server')}
            className={`relative z-10 px-5 py-2 rounded-xl text-sm font-bold font-sans tracking-wide transition-colors duration-200 border-none outline-none cursor-pointer ${
              activeTab === 'server'
                ? 'text-[#070a12]'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            {t.tabServerInfo || 'Server Info & Hub'}
          </button>
        </div>

        {/* Top-Right Notification pill removed per user request */}
        <div />
      </div>

      {/* Main Body Area */}
      <div className="flex-1 flex flex-col justify-center px-12 py-3 relative z-10">
        <div key={activeTab} className="w-full animate-tabSlideFade">
          {activeTab === 'overview' ? (
            <div className="max-w-2xl space-y-5">
            {/* Version badge, read from the running build rather than hardcoded */}
            <div className="inline-flex items-center px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-bold tracking-wider shadow-sm">
              <span>BETA {appVersion}</span>
            </div>

            {/* Headline */}
            <h1 className="text-5xl md:text-6xl font-black text-white tracking-normal leading-tight drop-shadow-[0_4px_16px_rgba(0,0,0,0.8)]">
              {t.heroTitle || 'MCL Client'}
            </h1>

            {/* Description */}
            <p className="text-base text-slate-200 leading-relaxed max-w-xl drop-shadow-md font-normal tracking-wide">
              {t.heroSub || 'Custom Minecraft Launcher with high performance optimization, direct server connection, and unified profile management.'}
            </p>

            {/* Action Zone: Fixed-Size Play Button & Profile Box */}
            <div className="pt-1">
              <div className="flex items-center gap-3">
                {/* 1. Standalone Play Button - Strictly Fixed w-[220px] h-[64px] */}
                <div className="relative shrink-0">
                  {isRunning ? (
                    <button
                      onClick={onStopGame}
                      onMouseEnter={() => setIsHoveringStop(true)}
                      onMouseLeave={() => setIsHoveringStop(false)}
                      className="btn-riot-running w-[220px] h-[64px] rounded-2xl flex items-center justify-center gap-3 text-xl font-bold shadow-xl shrink-0"
                    >
                      {isHoveringStop ? (
                        <>
                          <Square className="w-5 h-5 fill-current" />
                          <span className="tracking-wider text-2xl font-black">{t.btnStopGame || 'STOP'}</span>
                        </>
                      ) : (
                        <>
                          <span className="w-2.5 h-2.5 rounded-full bg-slate-300 animate-pulse" />
                          <span className="tracking-wider text-2xl font-black">{t.btnInGame || 'RUNNING'}</span>
                        </>
                      )}
                    </button>
                  ) : isPreparingOrDownloading ? (
                    /* Enhanced Loading Button with Speed + File Info */
                    <button
                      onClick={onCancelDownload}
                      onMouseEnter={() => setIsHoveringLoadingButton(true)}
                      onMouseLeave={() => setIsHoveringLoadingButton(false)}
                      title="Click to cancel download"
                      className={`w-[220px] h-[64px] px-4 rounded-2xl border transition-colors shadow-2xl flex items-center justify-center gap-3 group cursor-pointer shrink-0 outline-none relative overflow-hidden ${
                        launchProgress.stage === 'error'
                          ? 'bg-red-950/80 border-red-500/60'
                          : 'bg-[#161616] border-[var(--accent-color)]/50 hover:border-red-500/60'
                      }`}
                    >
                      {/* Circular Progress Ring — the sole progress indicator: it already
                          carries the exact percentage, an arc that fills the same way a bar
                          would, and the hover-to-cancel affordance, so a second bar under it
                          would only repeat the same number in a different shape. */}
                      <div className="relative w-11 h-11 shrink-0 flex items-center justify-center">
                        <svg className="w-11 h-11 transform -rotate-90" viewBox="0 0 36 36">
                          {/* Background Ring */}
                          <circle
                            cx="18"
                            cy="18"
                            r={circleRadius}
                            className="text-white/10"
                            strokeWidth="3"
                            stroke="currentColor"
                            fill="transparent"
                          />
                          {/* Active Progress Ring */}
                          <circle
                            cx="18"
                            cy="18"
                            r={circleRadius}
                            className={`transition-all duration-300 ${
                              launchProgress.stage === 'error'
                                ? 'text-red-400'
                                : 'text-[var(--accent-color)] group-hover:text-red-400'
                            }`}
                            strokeWidth="3"
                            strokeDasharray={circleCircumference}
                            strokeDashoffset={strokeOffset}
                            strokeLinecap="round"
                            stroke="currentColor"
                            fill="transparent"
                          />
                        </svg>

                        {/* Center Icon or Percentage */}
                        <div className="absolute inset-0 flex items-center justify-center">
                          {isHoveringLoadingButton ? (
                            <Pause className="w-4 h-4 text-red-400 fill-current animate-pulse" />
                          ) : launchProgress.stage === 'error' ? (
                            <AlertCircle className="w-5 h-5 text-red-400" />
                          ) : (
                            <span className="font-sans text-xs font-bold text-[var(--accent-color)]">
                              {progressPercent}%
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Right side: Status text + Speed */}
                      <div className="flex flex-col items-start min-w-0">
                        <span className={`tracking-wider text-base font-black uppercase transition-colors ${
                          isHoveringLoadingButton
                            ? 'text-red-300'
                            : launchProgress.stage === 'error'
                            ? 'text-red-400'
                            : 'text-white'
                        }`}>
                          {isHoveringLoadingButton
                            ? (t.btnCancel || 'CANCEL')
                            : launchProgress.stage === 'error'
                            ? (t.error || 'ERROR')
                            : progressPercent >= 95
                            ? (t.startingGame || 'STARTING')
                            : (t.loadingState || 'LOADING')}
                        </span>
                        {!isHoveringLoadingButton && launchProgress.speedBps > 0 && (
                          <span className="text-[10px] font-medium text-slate-400 truncate max-w-[130px]">
                            {(launchProgress.speedBps / 1024 / 1024).toFixed(1)} MB/s
                          </span>
                        )}
                      </div>
                    </button>
                  ) : (
                    <button
                      onClick={selectedInstance ? onLaunch : onOpenCreateModal}
                      className="btn-riot-play w-[220px] h-[64px] rounded-2xl flex items-center justify-center gap-3 text-xl font-bold shadow-xl shrink-0"
                    >
                      {selectedInstance ? (
                        <>
                          <Play className="w-5 h-5 fill-current" />
                          <span className="tracking-wider text-2xl font-black">{t.btnLaunch || 'PLAY'}</span>
                        </>
                      ) : (
                        <>
                          <Plus className="w-5 h-5" />
                          <span className="tracking-wide text-base">{t.btnNewInstance || 'New Profile'}</span>
                        </>
                      )}
                    </button>
                  )}
                </div>

                {/* 2. Profile Selector Box - Strictly Fixed w-[280px] h-[64px] */}
                <div className="relative shrink-0">
                  <button
                    onClick={selectedInstance ? () => setIsProfileDropdownOpen((prev) => !prev) : onOpenCreateModal}
                    disabled={isRunning || isPreparingOrDownloading}
                    title={selectedInstance ? 'Click to select profile' : 'Click to create profile'}
                    className={`w-[280px] h-[64px] px-4 rounded-2xl border-2 transition-all duration-150 shadow-lg flex items-center justify-between cursor-pointer shrink-0 outline-none ${
                      isProfileDropdownOpen
                        ? 'border-[var(--accent-color)] bg-theme-selected -translate-y-0.5'
                        : 'border-white/[0.08] bg-[#141414] hover:bg-[#1a1a1a] hover:border-white/20'
                    }`}
                  >
                    <div className="flex flex-col text-left flex-1 min-w-0 pr-2">
                      <span className="font-bold text-white text-sm tracking-wide leading-tight truncate">
                        {selectedInstance?.name || 'No Profiles'}
                      </span>
                      <span className="text-amber-400 text-xs font-semibold leading-tight truncate mt-0.5">
                        {selectedInstance
                          ? `${selectedInstance.loader ? selectedInstance.loader.toUpperCase() : 'VANILLA'} ${selectedInstance.gameVersion}`
                          : 'Click to create'}
                      </span>
                    </div>

                    <div className="w-px h-7 bg-white/10 mx-1 shrink-0" />

                    <div className="shrink-0 pl-1">
                      {selectedInstance ? (
                        <ChevronDown
                          className={`w-5 h-5 text-slate-400 transition-transform duration-150 ${
                            isProfileDropdownOpen ? 'rotate-180 text-amber-300' : ''
                          }`}
                        />
                      ) : (
                        <Plus className="w-5 h-5 text-amber-400" />
                      )}
                    </div>
                  </button>

                  {/* Profile Dropdown Popover */}
                  {isProfileDropdownOpen && (
                    <div className="absolute left-0 top-[calc(100%+8px)] w-[280px] rounded-2xl bg-[#141414] border border-white/10 shadow-2xl p-2 z-50 space-y-1 animate-dropdown">
                      <div className="px-3 py-1.5 text-xs font-bold text-slate-400 uppercase tracking-wider">
                        Select Profile
                      </div>
                      <div className="max-h-56 overflow-y-auto space-y-1 custom-scrollbar">
                        {instances.map((inst) => (
                          <button
                            key={inst.id}
                            onClick={() => {
                              onSelectInstance(inst.id);
                              setIsProfileDropdownOpen(false);
                            }}
                            className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs flex items-center justify-between transition-all duration-150 border-2 cursor-pointer ${
                              inst.id === selectedInstanceId
                                ? 'bg-theme-selected text-white font-bold border-[var(--accent-color)] shadow-sm'
                                : 'border-transparent text-slate-300 hover:bg-white/5 hover:text-white'
                            }`}
                          >
                            <span className="truncate font-semibold">{inst.name}</span>
                            <span className="text-[11px] text-slate-400 font-medium shrink-0 ml-2">
                              {inst.loader.toUpperCase()} {inst.gameVersion}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Server Widget - Located BELOW Play Button & Profile Box */}
              {/* Width = 220px (Play) + 12px (gap) + 280px (Profile) = 512px exact */}
              <div
                className="w-[512px] mt-3.5 p-4 rounded-2xl bg-[#141416]/95 border border-white/[0.08] shadow-2xl flex flex-col gap-3.5"
                style={{ fontFamily: "'Plus Jakarta Sans', 'Inter', sans-serif" }}
              >
                {/* Top Row: Server Selector Dropdown & Live Status (Players/Ping) */}
                <div className="flex items-center justify-between">
                  {/* Active Server Dropdown */}
                  <div className="flex items-center gap-2.5 relative">
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        serverStatus.online ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.4)]' : 'bg-red-400'
                      }`}
                    />

                    <div className="relative">
                      <button
                        onClick={() => setIsServerDropdownOpen(!isServerDropdownOpen)}
                        className="flex items-center gap-1.5 text-sm font-bold text-white hover:text-[var(--accent-light)] transition cursor-pointer"
                        title="Click to switch active server"
                      >
                        <span className="truncate max-w-[200px]">{currentSavedServer?.name || 'Minecraft Server'}</span>
                        <ChevronDown
                          className={`w-4 h-4 text-slate-400 transition-transform duration-150 ${
                            isServerDropdownOpen ? 'rotate-180 text-white' : ''
                          }`}
                        />
                      </button>

                      {/* Dropdown Menu */}
                      {isServerDropdownOpen && (
                        <div className="absolute left-0 top-[calc(100%+8px)] w-64 rounded-2xl bg-[#161618] border border-white/10 shadow-2xl p-2 z-50 space-y-1 animate-dropdown backdrop-blur-md">
                          <div className="px-3 py-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                            Saved Servers
                          </div>
                          <div className="max-h-52 overflow-y-auto space-y-1 custom-scrollbar">
                            {savedServers.map((srv) => (
                              <button
                                key={srv.id}
                                onClick={() => {
                                  onSelectActiveServer(srv.id);
                                  setIsServerDropdownOpen(false);
                                }}
                                className={`w-full text-left px-3 py-2 rounded-xl text-xs flex items-center justify-between transition-all duration-150 border-2 cursor-pointer ${
                                  srv.id === activeServerId
                                    ? 'bg-theme-selected text-white font-bold border-[var(--accent-color)] shadow-sm'
                                    : 'border-transparent text-slate-300 hover:bg-white/5 hover:text-white'
                                }`}
                              >
                                <span className="truncate font-semibold">{srv.name}</span>
                                <span className="text-[10px] text-slate-400 font-mono shrink-0 ml-2">{srv.ip}</span>
                              </button>
                            ))}
                          </div>
                          <div className="pt-1.5 border-t border-white/[0.06]">
                            <button
                              onClick={() => {
                                setIsServerDropdownOpen(false);
                                setActiveTab('server');
                              }}
                              className="w-full text-left px-3 py-2 rounded-xl text-xs text-[var(--accent-light)] font-bold hover:bg-[var(--accent-subtle)] transition flex items-center gap-2 cursor-pointer"
                            >
                              <Server className="w-3.5 h-3.5 text-[var(--accent-color)]" />
                              <span>{t.manageServersTitle || 'Manage Servers'}</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Live Ping & Player Count Badges */}
                  <div className="flex items-center gap-2.5 text-xs">
                    <div className="flex items-center gap-1.5 text-slate-300 font-medium tabular-nums">
                      <Users className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="font-bold text-white tracking-tight">
                        {(serverStatus.playersOnline ?? 0).toLocaleString()}
                      </span>
                      <span className="text-slate-500 font-normal">
                        /{(serverStatus.playersMax ?? 0).toLocaleString()}
                      </span>
                      <span className="text-slate-400 text-[11px] font-normal ml-0.5">
                        {t.online || 'Online'}
                      </span>
                    </div>

                    <span className="text-white/20 text-xs">•</span>

                    <div
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold tracking-tight border ${
                        (serverStatus.pingMs ?? 999) < 80
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                          : (serverStatus.pingMs ?? 999) < 150
                          ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                          : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                      }`}
                    >
                      <Wifi className="w-3 h-3 shrink-0" />
                      <span>{serverStatus.pingMs !== undefined ? `${serverStatus.pingMs} ms` : '--'}</span>
                    </div>
                  </div>
                </div>

                {/* Clean Balanced Divider Line */}
                <div className="h-px bg-white/[0.06] w-full" />

                {/* Bottom Row: Copy IP Button & Switch Toggle for Connect on Play */}
                <div className="flex items-center justify-between gap-3 text-xs">
                  <button
                    onClick={handleCopyIp}
                    className={`h-8 px-3 rounded-xl text-xs flex items-center gap-2 transition-all border cursor-pointer active:scale-95 group ${
                      copied
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                        : 'bg-white/[0.03] hover:bg-white/[0.06] text-slate-300 hover:text-white border-white/[0.08] hover:border-white/20'
                    }`}
                    title="Click to copy server IP address"
                  >
                    {copied ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 text-[var(--accent-color)] group-hover:brightness-110 shrink-0 transition" />
                    )}
                    <span className="font-medium font-mono text-[11px] tracking-tight text-slate-200">
                      {currentSavedServer?.ip || serverStatus.ip}
                    </span>
                    <span className="text-[10px] text-slate-400 font-normal">
                      ({copied ? (t.copied || 'Copied!') : (t.copyAction || 'Copy')})
                    </span>
                  </button>

                  {/* Switch Toggle for Direct Connect */}
                  <div className="flex items-center gap-2.5">
                    <ToggleSwitch
                      checked={directConnectServer}
                      onChange={onToggleDirectConnectServer}
                      size="sm"
                      title={t.connectOnPlay || 'Connect on Play'}
                    />
                    <span
                      onClick={() => onToggleDirectConnectServer(!directConnectServer)}
                      className="text-xs font-semibold text-slate-300 hover:text-white select-none cursor-pointer transition-colors"
                    >
                      {t.connectOnPlay || 'Connect on Play'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Server Info & Hub Tab: High-Scale 2-Column Dashboard */
          <div className="max-w-6xl w-full mx-auto animate-fadeIn pb-2">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
              {/* ================= LEFT COLUMN: Server Browser & Search/Sort (7 cols) ================= */}
              <div className="lg:col-span-7 flex flex-col gap-3">
                {/* Search, Sort and Add Server Header */}
                <div className="glass-panel rounded-2xl p-4 border border-white/[0.08] shadow-xl space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-xl bg-[var(--accent-color)]/10 border border-[var(--accent-color)]/20 flex items-center justify-center text-[var(--accent-color)] shrink-0">
                        <Server className="w-4 h-4" />
                      </div>
                      <div>
                        <h2 className="text-sm font-bold text-white tracking-wide flex items-center gap-2">
                          <span>{t.savedServersCount}</span>
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-white/5 border border-white/10 text-slate-300">
                            {filteredAndSortedServers.length === savedServers.length
                              ? savedServers.length
                              : `${filteredAndSortedServers.length}/${savedServers.length}`}
                          </span>
                        </h2>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleOpenAddServerModal}
                      className="btn-primary px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-none hover:shadow-none cursor-pointer shrink-0 active:scale-95 transition-all"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>{t.addServer}</span>
                    </button>
                  </div>

                  {/* Search and Sort Toolbar */}
                  <div className="flex items-center gap-2">
                    {/* Search Bar */}
                    <div className="relative flex-1">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        value={serverSearch}
                        onChange={(e) => setServerSearch(e.target.value)}
                        placeholder={t.searchServerPlaceholder}
                        className="w-full glass-input pl-9 pr-7 py-2 rounded-xl text-xs text-white placeholder-slate-400 focus:outline-none focus:border-[var(--accent-color)] transition shadow-inner"
                      />
                      {serverSearch && (
                        <button
                          type="button"
                          onClick={() => setServerSearch('')}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-0.5 cursor-pointer"
                          title={t.clearSearch || 'Clear search'}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>

                    {/* Sort Dropdown */}
                    <div className="relative shrink-0" ref={serverSortRef}>
                      <button
                        type="button"
                        onClick={() => setIsServerSortOpen((prev) => !prev)}
                        className={`h-9 px-3 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shadow-sm active:scale-95 ${
                          serverSort !== 'default'
                            ? 'bg-[var(--accent-subtle)] border-[var(--accent-border)] text-[var(--accent-light)]'
                            : isServerSortOpen
                            ? 'bg-white/[0.08] border-white/20 text-white'
                            : 'bg-white/[0.03] hover:bg-white/[0.06] border-white/10 text-slate-300 hover:text-white'
                        }`}
                        title={t.sortLabel || 'Sort servers'}
                      >
                        {serverSort === 'az' ? (
                          <ArrowDownAZ className="w-3.5 h-3.5 text-[var(--accent-color)]" />
                        ) : serverSort === 'za' ? (
                          <ArrowUpZA className="w-3.5 h-3.5 text-[var(--accent-color)]" />
                        ) : (
                          <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                        )}
                        <span className="hidden sm:inline">
                          {serverSort === 'az' ? t.sortAZ : serverSort === 'za' ? t.sortZA : t.sortDefault}
                        </span>
                        <ChevronDown className={`w-3 h-3 opacity-60 transition-transform ${isServerSortOpen ? 'rotate-180 text-white' : ''}`} />
                      </button>

                      {isServerSortOpen && (
                        <div className="absolute right-0 mt-1.5 w-44 rounded-xl bg-[#141416] border border-white/10 shadow-2xl p-1 z-40 space-y-0.5 animate-dropdown backdrop-blur-md">
                          <button
                            type="button"
                            onClick={() => { setServerSort('default'); setIsServerSortOpen(false); }}
                            className={`w-full px-3 py-2 text-xs text-left rounded-lg flex items-center justify-between transition cursor-pointer ${
                              serverSort === 'default' ? 'text-[var(--accent-light)] font-bold bg-[var(--accent-subtle)]' : 'text-slate-300 hover:bg-white/5 hover:text-white'
                            }`}
                          >
                            <span>{t.sortDefault}</span>
                            {serverSort === 'default' && <Check className="w-3.5 h-3.5 text-[var(--accent-color)]" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => { setServerSort('az'); setIsServerSortOpen(false); }}
                            className={`w-full px-3 py-2 text-xs text-left rounded-lg flex items-center justify-between transition cursor-pointer ${
                              serverSort === 'az' ? 'text-[var(--accent-light)] font-bold bg-[var(--accent-subtle)]' : 'text-slate-300 hover:bg-white/5 hover:text-white'
                            }`}
                          >
                            <span>{t.sortAZ}</span>
                            {serverSort === 'az' && <Check className="w-3.5 h-3.5 text-[var(--accent-color)]" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => { setServerSort('za'); setIsServerSortOpen(false); }}
                            className={`w-full px-3 py-2 text-xs text-left rounded-lg flex items-center justify-between transition cursor-pointer ${
                              serverSort === 'za' ? 'text-[var(--accent-light)] font-bold bg-[var(--accent-subtle)]' : 'text-slate-300 hover:bg-white/5 hover:text-white'
                            }`}
                          >
                            <span>{t.sortZA}</span>
                            {serverSort === 'za' && <Check className="w-3.5 h-3.5 text-[var(--accent-color)]" />}
                          </button>
                          {/* Divider */}
                          <div className="my-1 mx-2 h-px bg-white/[0.06]" />
                          <button
                            type="button"
                            onClick={() => { setServerSort('pingAsc'); setIsServerSortOpen(false); }}
                            className={`w-full px-3 py-2 text-xs text-left rounded-lg flex items-center justify-between transition cursor-pointer ${
                              serverSort === 'pingAsc' ? 'text-[var(--accent-light)] font-bold bg-[var(--accent-subtle)]' : 'text-slate-300 hover:bg-white/5 hover:text-white'
                            }`}
                          >
                            <span>{(t as any).sortPingAsc || 'Ping: Low → High'}</span>
                            {serverSort === 'pingAsc' && <Check className="w-3.5 h-3.5 text-[var(--accent-color)]" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => { setServerSort('pingDesc'); setIsServerSortOpen(false); }}
                            className={`w-full px-3 py-2 text-xs text-left rounded-lg flex items-center justify-between transition cursor-pointer ${
                              serverSort === 'pingDesc' ? 'text-[var(--accent-light)] font-bold bg-[var(--accent-subtle)]' : 'text-slate-300 hover:bg-white/5 hover:text-white'
                            }`}
                          >
                            <span>{(t as any).sortPingDesc || 'Ping: High → Low'}</span>
                            {serverSort === 'pingDesc' && <Check className="w-3.5 h-3.5 text-[var(--accent-color)]" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => { setServerSort('playersDesc'); setIsServerSortOpen(false); }}
                            className={`w-full px-3 py-2 text-xs text-left rounded-lg flex items-center justify-between transition cursor-pointer ${
                              serverSort === 'playersDesc' ? 'text-[var(--accent-light)] font-bold bg-[var(--accent-subtle)]' : 'text-slate-300 hover:bg-white/5 hover:text-white'
                            }`}
                          >
                            <span>{(t as any).sortPlayersDesc || 'Players: Most First'}</span>
                            {serverSort === 'playersDesc' && <Check className="w-3.5 h-3.5 text-[var(--accent-color)]" />}
                          </button>
                        </div>
                      )}

                    </div>
                  </div>
                </div>

                {/* Server Cards List Container with Background */}
                <div className="glass-panel rounded-2xl p-3.5 border border-white/[0.08] shadow-xl space-y-3">
                  {/* Server Cards List */}
                  <div className="space-y-2">
                    {paginatedServers.length === 0 ? (
                      <div className="py-8 text-center space-y-3">
                        <div className="w-10 h-10 rounded-2xl bg-white/5 text-slate-400 flex items-center justify-center mx-auto">
                          <Search className="w-4 h-4" />
                        </div>
                        <p className="text-xs text-slate-400">{t.noServersFound}</p>
                        {serverSearch && (
                          <button
                            type="button"
                            onClick={() => setServerSearch('')}
                            className="px-3 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-xs text-white transition cursor-pointer"
                          >
                            {t.clearSearch}
                          </button>
                        )}
                      </div>
                    ) : (
                      paginatedServers.map((srv) => {
                        const isActive = srv.id === activeServerId;
                        const isConfirmingDelete = deleteConfirmId === srv.id;

                        return (
                          <div
                            key={srv.id}
                            onClick={() => onSelectActiveServer(srv.id)}
                            className={`p-3 rounded-xl border-2 transition-all duration-150 cursor-pointer flex items-center justify-between gap-3 ${
                              isActive
                                ? 'bg-theme-selected border-[var(--accent-color)] shadow-md shadow-black/40 -translate-y-0.5'
                                : 'bg-[#161618]/90 hover:bg-[#1c1d24] border-white/[0.06] hover:border-white/15 hover:-translate-y-0.5'
                            }`}
                          >
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              <div
                                className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border transition-colors ${
                                  isActive
                                    ? 'bg-[var(--accent-color)]/15 text-[var(--accent-color)] border-[var(--accent-color)]/30'
                                    : 'bg-white/[0.03] text-slate-400 border-white/10'
                                }`}
                              >
                                <Wifi className="w-4 h-4" />
                              </div>

                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-white text-sm truncate">{srv.name}</span>
                                  {isActive && (
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[var(--accent-color)]/15 text-[var(--accent-light)] border border-[var(--accent-color)]/30 tracking-wide uppercase shrink-0">
                                      {t.activeServerTag}
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs text-slate-400 mt-0.5 truncate">
                                  {srv.ip}{srv.port && srv.port !== 25565 ? `:${srv.port}` : ''}
                                </div>
                              </div>

                              {/* Ping & players chips — clear, readable, stylish badge pill */}
                              {(() => {
                                const ps = serverPingMap[srv.id];
                                const pingMs = ps?.pingMs;
                                const online = ps?.playersOnline;
                                const max = ps?.playersMax;
                                return (
                                  <div className="px-2.5 py-1 rounded-lg bg-white/[0.04] border border-white/[0.08] flex items-center gap-2.5 shrink-0 ml-auto mr-1">
                                    <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                                      <Users className="w-3.5 h-3.5 text-[var(--accent-color)]" />
                                      <span>
                                        {online ?? '--'}
                                        <span className="text-slate-500 font-normal">/{max ?? '--'}</span>
                                      </span>
                                    </span>
                                    <span className="w-px h-3 bg-white/15" />
                                    <span className={`flex items-center gap-1.5 text-xs font-bold ${
                                      pingMs === undefined ? 'text-slate-500'
                                        : pingMs < 80 ? 'text-emerald-400'
                                        : pingMs < 150 ? 'text-amber-400'
                                        : 'text-rose-400'
                                    }`}>
                                      <Wifi className="w-3.5 h-3.5" />
                                      <span>{pingMs !== undefined ? `${pingMs} ms` : '--'}</span>
                                    </span>
                                  </div>
                                );
                              })()}

                            </div>

                            <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                onClick={(e) => handleOpenEditServerModal(srv, e)}
                                className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer active:scale-95"
                                title={t.editServer}
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>

                              {savedServers.length > 1 && (
                                <button
                                  type="button"
                                  onClick={(e) => handleDeleteServerWithConfirm(srv.id, e)}
                                  className={`px-2 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer flex items-center gap-1 active:scale-95 ${
                                    isConfirmingDelete
                                      ? 'bg-red-500/20 border border-red-500/40 text-red-400 animate-pulse'
                                      : 'text-slate-400 hover:text-red-400 hover:bg-red-500/10'
                                  }`}
                                  title={isConfirmingDelete ? 'Click again to delete' : 'Delete server'}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  {isConfirmingDelete && <span className="text-[10px]">{t.deleteConfirmShort}</span>}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* Pagination Controls */}
                  {totalServerPages > 1 && (
                    <div className="flex items-center justify-between px-1 pt-2.5 border-t border-white/5">
                      <div className="text-[11px] text-slate-400">
                        {t.page} {serverPage} / {totalServerPages}
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setServerPage((prev) => Math.max(1, prev - 1))}
                          disabled={serverPage === 1}
                          className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:pointer-events-none border border-white/10 text-slate-300 flex items-center justify-center transition cursor-pointer active:scale-95"
                          title="Previous page"
                        >
                          <ChevronLeft className="w-4 h-4" />
                        </button>

                        {/* Interactive page dots */}
                        <div className="flex items-center gap-1 px-1">
                          {Array.from({ length: totalServerPages }, (_, i) => i + 1).map((p) => (
                            <button
                              key={p}
                              type="button"
                              onClick={() => setServerPage(p)}
                              className={`h-2 rounded-full transition-all duration-200 cursor-pointer ${
                                serverPage === p
                                  ? 'w-5 bg-[var(--accent-color)]'
                                  : 'w-2 bg-white/20 hover:bg-white/40'
                              }`}
                              title={`Page ${p}`}
                            />
                          ))}
                        </div>

                        <button
                          type="button"
                          onClick={() => setServerPage((prev) => Math.min(totalServerPages, prev + 1))}
                          disabled={serverPage === totalServerPages}
                          className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:pointer-events-none border border-white/10 text-slate-300 flex items-center justify-center transition cursor-pointer active:scale-95"
                          title="Next page"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* ================= RIGHT COLUMN: Active Server Live Inspector (5 cols) ================= */}
              <div className="lg:col-span-5 flex flex-col gap-4">
                {/* Fixed height to encompass all content smoothly with zero jitter */}
                <div className="glass-panel rounded-2xl p-5 border border-white/[0.08] shadow-2xl space-y-4 min-h-[485px] overflow-hidden flex flex-col justify-between">

                  {/* Top Bar: Active Server Name & Refresh button */}
                  <div className="flex items-center justify-between gap-3 border-b border-white/5 pb-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-[var(--accent-color)]/10 border border-[var(--accent-color)]/20 text-[var(--accent-color)] flex items-center justify-center shrink-0">
                        <Activity className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase">{t.serverStatus}</div>
                        <h3 className="text-base font-bold text-white tracking-wide truncate">
                          {currentSavedServer?.name || 'Minecraft Server'}
                        </h3>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleRefreshPing}
                      disabled={isPinging}
                      className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-semibold text-slate-300 flex items-center gap-1.5 transition cursor-pointer shrink-0 active:scale-95"
                      title="Refresh status"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isPinging ? 'animate-spin text-[var(--accent-color)]' : ''}`} />
                      <span className="hidden sm:inline">{t.refreshPing}</span>
                    </button>
                  </div>

                  {/* MOTD Banner — Fixed height, clean, no scrollbar */}
                  <div>
                    <div className="text-[11px] font-semibold text-slate-400 mb-1.5">{t.serverMotd}</div>
                    <div className="px-3.5 py-2.5 rounded-xl bg-black/40 border border-white/10 text-xs text-slate-200 shadow-inner h-[56px] overflow-hidden flex items-center leading-relaxed select-text">
                      <span className="w-full line-clamp-2">{serverStatus.motd?.replace(/§[0-9a-fk-or]/g, '') || 'MCL Community Minecraft Server'}</span>
                    </div>
                  </div>

                  {/* Metrics Tiles */}
                  <div className="grid grid-cols-2 gap-3">
                    {/* Players Online */}
                    <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5">
                      <div className="text-slate-400 text-[11px] mb-1 flex items-center gap-1.5">
                        <Users className="w-4 h-4 text-[var(--accent-color)]" />
                        <span>{t.players}</span>
                      </div>
                      <div className="text-base font-bold text-white">
                        {serverStatus.playersOnline}{' '}
                        <span className="text-xs text-slate-500 font-normal">/ {serverStatus.playersMax}</span>
                      </div>
                    </div>

                    {/* Ping Latency */}
                    <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5">
                      <div className="text-slate-400 text-[11px] mb-1 flex items-center gap-1.5">
                        <Wifi className="w-4 h-4 text-emerald-400" />
                        <span>{t.latency}</span>
                      </div>
                      <div
                        className={`text-base font-bold ${
                          (serverStatus.pingMs ?? 999) < 80
                            ? 'text-emerald-400'
                            : (serverStatus.pingMs ?? 999) < 150
                            ? 'text-amber-400'
                            : 'text-rose-400'
                        }`}
                      >
                        {serverStatus.pingMs ?? '--'} <span className="text-xs font-normal text-slate-400">ms</span>
                      </div>
                    </div>
                  </div>

                  {/* Server Address with 1-click copy */}
                  <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider mb-0.5">{t.serverIp}</div>
                      <div className="text-xs font-semibold text-white truncate">
                        {currentSavedServer
                          ? `${currentSavedServer.ip}${currentSavedServer.port !== 25565 ? `:${currentSavedServer.port}` : ''}`
                          : `${serverStatus.ip}:${serverStatus.port}`}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleCopyIp}
                      className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-slate-200 flex items-center gap-1.5 transition cursor-pointer shrink-0 active:scale-95"
                      title="Copy address"
                    >
                      {copied ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="text-emerald-400 font-semibold">{t.copied}</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Connect on Play Toggle Switch */}
                  <div className="pt-2 border-t border-white/5">
                    <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/5">
                      <div>
                        <div className="text-xs font-bold text-white tracking-wide">{t.connectOnPlay}</div>
                        <div className="text-[11px] text-slate-400 mt-0.5">{t.connectOnPlayDesc}</div>
                      </div>

                      <ToggleSwitch
                        checked={directConnectServer}
                        onChange={onToggleDirectConnectServer}
                        size="md"
                        title={t.connectOnPlay}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        </div>
      </div>

      {/* Clean Bottom Footer */}
      <div className="bg-gradient-to-t from-black/95 via-black/50 to-transparent pb-6 pt-6 px-12 flex items-center justify-between z-20">
        <div className="flex items-center gap-3">
          <button
            onClick={() => onOpenBackgroundModal?.()}
            className="px-4 py-2 rounded-xl text-xs font-bold border transition-all flex items-center gap-2 shadow-sm active:scale-95 cursor-pointer bg-[#141414] hover:bg-[#1c1c1c] text-slate-300 hover:text-white border-white/[0.08]"
          >
            <ImageIcon className="w-3.5 h-3.5 text-[var(--accent-color)]" />
            <span>{t.changeBackground || 'Change Background'}</span>
          </button>
        </div>

        <div />
      </div>

      {/* Add / Edit Server Modal Dialog */}
      {isServerModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
          <div className="glass-panel w-full max-w-md rounded-3xl border border-white/10 shadow-2xl p-6 space-y-4 animate-scaleUp">
            <div className="flex items-center justify-between border-b border-white/5 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[var(--accent-color)]/10 border border-[var(--accent-color)]/20 flex items-center justify-center text-[var(--accent-color)]">
                  <Server className="w-4 h-4" />
                </div>
                <h3 className="text-base font-bold text-white tracking-wide">
                  {isEditingServer ? t.editServer : t.addServer}
                </h3>
              </div>

              <button
                type="button"
                onClick={() => setIsServerModalOpen(false)}
                className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white flex items-center justify-center transition cursor-pointer active:scale-95"
                title={t.cancel}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveServerModal} className="space-y-3.5">
              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">{t.serverName}</label>
                <input
                  type="text"
                  value={serverNameInput}
                  onChange={(e) => setServerNameInput(e.target.value)}
                  placeholder="e.g. Hypixel Network"
                  required
                  className="w-full glass-input px-3 py-2 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[var(--accent-color)] transition"
                />
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                <div className="col-span-2">
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">{t.serverAddress}</label>
                  <input
                    type="text"
                    value={serverIpInput}
                    onChange={(e) => setServerIpInput(e.target.value)}
                    placeholder="mc.hypixel.net"
                    required
                    className="w-full glass-input px-3 py-2 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[var(--accent-color)] transition"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">{t.serverPort}</label>
                  <input
                    type="number"
                    value={serverPortInput}
                    onChange={(e) => setServerPortInput(Number(e.target.value))}
                    className="w-full glass-input px-3 py-2 rounded-xl text-xs text-white focus:outline-none focus:border-[var(--accent-color)] transition"
                  />
                </div>
              </div>

              {/* Test Ping inside Modal */}
              <div className="pt-1">
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={handleTestPingInModal}
                    disabled={isTestingPing || !serverIpInput.trim()}
                    className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 disabled:opacity-40 text-xs font-semibold text-slate-300 flex items-center gap-1.5 transition cursor-pointer active:scale-95"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isTestingPing ? 'animate-spin text-[var(--accent-color)]' : ''}`} />
                    <span>{isTestingPing ? t.testingConnection : t.testConnection}</span>
                  </button>

                  {testPingResult && (
                    <div className="text-xs flex items-center gap-1.5">
                      {testPingResult.online ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="text-emerald-400 font-semibold">{testPingResult.pingMs} ms</span>
                        </>
                      ) : (
                        <>
                          <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                          <span className="text-rose-400 font-semibold">{t.offline}</span>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => setIsServerModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white transition cursor-pointer active:scale-95"
                >
                  {t.cancel}
                </button>
                <button
                  type="submit"
                  className="btn-primary px-5 py-2 rounded-xl text-xs font-bold shadow-none hover:shadow-none cursor-pointer active:scale-95 transition-all"
                >
                  {t.saveServer}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
