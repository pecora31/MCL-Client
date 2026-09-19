import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import {
  Server,
  Play,
  Square,
  Download,
  RefreshCw,
  AlertCircle,
  Copy,
  Check,
  ExternalLink,
  Cloud,
  Monitor,
  Trash2,
  RotateCcw,
  Loader2,
  Terminal,
  Sliders,
  Archive,
  FolderTree,
  Cpu,
  HardDrive,
  Activity,
  Wifi,
  ChevronDown,
  Users,
  Box,
  Layers,
  Sparkles,
  Clock,
  Shield,
} from 'lucide-react';
import { invokeCommand, isTauri } from '../../services/api';
import { openExternalUrl } from '../../services/externalLink';
import { loadRemoteHosts, saveRemoteHosts, remoteAgent, type RemoteHost } from '../../services/remoteAgent';
import type { GameInstance, SystemInfo, ServerPropertiesSummary, HostedServerStatus, BackupInfo } from '../../types';
import { getTranslation, type Language } from '../../locales/i18n';
import { CustomSelect, type SelectOption } from '../common/CustomSelect';
import { RamAllocationField } from '../common/RamAllocationField';
import { ToggleSwitch } from '../common/ToggleSwitch';
import { getLoaderColor, getLoaderIcon } from '../mods/ModIcons';
import { RemoteFileBrowser } from './RemoteFileBrowser';
import { VmBootstrapWizard } from './VmBootstrapWizard';

interface HostServerViewProps {
  instances: GameInstance[];
  language: Language;
  onOpenCreateModal: () => void;
  /** Whether Start may download a Java runtime when this machine has none that fits, mirroring
   *  the same setting Play already uses. */
  autoDownloadJava: boolean;
}

/** A stand-in for the desktop app's own PID map, used only to key the "already running" check. */
/** Fraction of the track a range input has been dragged through, for the filled part behind its thumb. */
const rangeFill = (value: number, min: number, max: number): React.CSSProperties =>
  ({ '--fill': `${Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))}%` }) as React.CSSProperties;

const LOCAL_HOST_ID = 'local';

const MAX_LOG_LINES = 500;
/** Long enough to collapse a burst of console output, short enough to still read as live. */
const LOG_FLUSH_MS = 120;

const SELECTED_HOST_STORAGE_KEY = 'mcl_host_server_selected_host';

type ServerTab = 'dashboard' | 'console' | 'config' | 'backups' | 'files';

const getLoaderBadgeColor = (loader: string) => {
  switch (loader.toLowerCase()) {
    case 'fabric':
      return { bg: 'rgba(232, 162, 56, 0.15)', border: 'rgba(232, 162, 56, 0.35)', text: '#e8a238' };
    case 'forge':
      return { bg: 'rgba(223, 117, 56, 0.15)', border: 'rgba(223, 117, 56, 0.35)', text: '#df7538' };
    case 'neoforge':
      return { bg: 'rgba(224, 90, 43, 0.15)', border: 'rgba(224, 90, 43, 0.35)', text: '#e05a2b' };
    case 'quilt':
      return { bg: 'rgba(88, 54, 194, 0.15)', border: 'rgba(88, 54, 194, 0.35)', text: '#8b6ff0' };
    default:
      return { bg: 'rgba(56, 189, 248, 0.15)', border: 'rgba(56, 189, 248, 0.35)', text: '#38bdf8' };
  }
};

const formatUptime = (seconds?: number) => {
  if (seconds === undefined || seconds === null) return '--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
};

/** How far behind the server said it was, as "2.1s" or "450ms". */
const formatLagBehind = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);

const formatBytes = (bytes?: number) => {
  if (bytes === undefined || bytes === null || bytes === 0) return '--';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
};

const DEFAULT_PROPERTIES_SUMMARY: ServerPropertiesSummary = {
  onlineMode: true,
  pvp: true,
  whiteList: false,
  difficulty: 'easy',
  maxPlayers: 20,
  motd: 'A Minecraft Server',
  serverPort: 25565,
  gamemode: 'survival',
  viewDistance: 10,
  simulationDistance: 10,
  allowNether: true,
  spawnProtection: 16,
  hardcore: false,
  levelSeed: '',
  levelName: 'world',
};

export const HostServerView: React.FC<HostServerViewProps> = ({
  instances,
  onOpenCreateModal,
  language,
  autoDownloadJava,
}) => {
  const t = getTranslation(language);
  const [selectedId, setSelectedId] = useState<string>(instances[0]?.id || '');
  // Read synchronously (it is only a localStorage read) rather than in a mount effect: the
  // selected host below is restored on the very first render, and with the list still empty
  // that render resolved the remembered VM to "no such host", fell back to This Computer, and
  // fetched *its* status — which has no server prepared — so the Set up card came back every
  // visit even for a VM that was already fully installed and running.
  const [remoteHosts, setRemoteHosts] = useState<RemoteHost[]>(() => loadRemoteHosts());
  // This view remounts from scratch every time the player navigates back to Server
  // Management (its parent only renders it while that tab is active), so without this the
  // selected host silently reset to "This Computer" on every visit — remembered here the same
  // way the active server in Overview already is.
  const [selectedHostId, setSelectedHostIdState] = useState<string>(() => {
    const saved = localStorage.getItem(SELECTED_HOST_STORAGE_KEY);
    // A VM removed since last time falls back to this computer instead of pointing at nothing.
    return saved && loadRemoteHosts().some((h) => h.id === saved) ? saved : LOCAL_HOST_ID;
  });
  const setSelectedHostId = (id: string) => {
    setSelectedHostIdState(id);
    localStorage.setItem(SELECTED_HOST_STORAGE_KEY, id);
  };
  const [isBootstrapOpen, setIsBootstrapOpen] = useState(false);
  const [isSyncingMods, setIsSyncingMods] = useState(false);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [restoringName, setRestoringName] = useState<string | null>(null);

  const [status, setStatus] = useState<HostedServerStatus | null>(null);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [minRam, setMinRam] = useState(1024);
  const [maxRam, setMaxRam] = useState(2048);
  const [eulaAccepted, setEulaAccepted] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [error, setError] = useState('');
  const [logs, setLogs] = useState<string[]>([]);
  const [summary, setSummary] = useState<ServerPropertiesSummary>(DEFAULT_PROPERTIES_SUMMARY);
  const [copied, setCopied] = useState(false);
  const [consoleCommand, setConsoleCommand] = useState('');
  const [isSendingCommand, setIsSendingCommand] = useState(false);
  const [lanIp, setLanIp] = useState<string | null>(null);
  const [useAikarFlags, setUseAikarFlags] = useState(true);
  const [gcEngine, setGcEngine] = useState<'G1GC' | 'ZGC'>('G1GC');
  const [autoRestart, setAutoRestart] = useState(false);

  // RAM, GC and restart choices are consumed at Start, not written to server.properties, so
  // Save never covered them and they lived only in component state: every visit to this view
  // remounted it, reset them to the defaults, and the next Start ran with those instead of what
  // had been picked. Kept per profile-and-host, since a VM and this computer differ in RAM.
  const launchSettingsKey = `mcl_host_launch:${selectedHostId}:${selectedId}`;
  useEffect(() => {
    let saved: Partial<{ minRam: number; maxRam: number; useAikarFlags: boolean; gcEngine: 'G1GC' | 'ZGC'; autoRestart: boolean }> = {};
    try {
      saved = JSON.parse(localStorage.getItem(launchSettingsKey) || '{}');
    } catch {
      saved = {};
    }
    setMinRam(saved.minRam ?? 1024);
    setMaxRam(saved.maxRam ?? 2048);
    setUseAikarFlags(saved.useAikarFlags ?? true);
    setGcEngine(saved.gcEngine === 'ZGC' ? 'ZGC' : 'G1GC');
    setAutoRestart(saved.autoRestart ?? false);
  }, [launchSettingsKey]);
  const persistLaunchSettings = (patch: Partial<{ minRam: number; maxRam: number; useAikarFlags: boolean; gcEngine: 'G1GC' | 'ZGC'; autoRestart: boolean }>) => {
    try {
      localStorage.setItem(
        launchSettingsKey,
        JSON.stringify({ minRam, maxRam, useAikarFlags, gcEngine, autoRestart, ...patch })
      );
    } catch {
      // Storage unavailable: the choice still applies for this visit.
    }
  };
  const [isSavedSuccess, setIsSavedSuccess] = useState(false);
  // Minecraft only reads server.properties at startup, so a save made while it is running is
  // on disk but not in effect yet — which looked exactly like "the setting was not applied".
  const [savedWhileRunning, setSavedWhileRunning] = useState(false);

  // UI state for navigation and custom dropdowns
  const [activeTab, setActiveTab] = useState<ServerTab>('dashboard');
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isHostMenuOpen, setIsHostMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const hostMenuRef = useRef<HTMLDivElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const tabContainerRef = useRef<HTMLDivElement>(null);
  const [tabPillStyle, setTabPillStyle] = useState<{ left: number; width: number }>({ left: 4, width: 0 });

  const updateTabPill = useCallback(() => {
    const target = tabRefs.current[activeTab];
    if (target && target.offsetWidth > 0) {
      const nextLeft = target.offsetLeft;
      const nextWidth = target.offsetWidth;
      setTabPillStyle((prev) => {
        if (prev.left === nextLeft && prev.width === nextWidth) return prev;
        return { left: nextLeft, width: nextWidth };
      });
    }
  }, [activeTab]);

  useLayoutEffect(() => {
    updateTabPill();
    const raf = requestAnimationFrame(updateTabPill);
    const timer = setTimeout(updateTabPill, 80);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [updateTabPill, activeTab, language, selectedHostId, status?.hasJar]);

  useEffect(() => {
    if (!tabContainerRef.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      updateTabPill();
    });
    observer.observe(tabContainerRef.current);
    return () => observer.disconnect();
  }, [updateTabPill]);

  const instance = instances.find((i) => i.id === selectedId) || null;
  const selectedHost = selectedHostId === LOCAL_HOST_ID ? null : remoteHosts.find((h) => h.id === selectedHostId) || null;

  // Close custom dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target as Node)) {
        setIsProfileMenuOpen(false);
      }
      if (hostMenuRef.current && !hostMenuRef.current.contains(e.target as Node)) {
        setIsHostMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const remoteSystemInfo: SystemInfo | null =
    selectedHost && status?.system
      ? (() => {
          const totalRamMb = status.system.memTotalMb;
          const reservedMb = Math.min(Math.max(totalRamMb / 4, 2048), 8192);
          const recommendedMaxRamMb = Math.max(totalRamMb - reservedMb, 1024);
          return {
            totalRamMb,
            availableRamMb: Math.max(totalRamMb - status.system.memUsedMb, 0),
            cpuCount: 1,
            recommendedMaxRamMb,
            recommendedRamMb: Math.max(Math.min(recommendedMaxRamMb, 4096), 1024),
          };
        })()
      : null;

  useEffect(() => {
    invokeCommand<SystemInfo>('get_system_info').then(setSystemInfo).catch(() => {});
    invokeCommand<string | null>('get_lan_ip').then(setLanIp).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedId && instances.length > 0) {
      setSelectedId(instances[0].id);
    }
  }, [instances]);

  const refreshStatus = async () => {
    if (!instance) {
      setStatus(null);
      return;
    }
    const requestedFor = `${selectedHostId}:${selectedId}`;
    try {
      let s: HostedServerStatus;
      if (selectedHost) {
        s = await remoteAgent.status(selectedHost);
      } else {
        s = await invokeCommand<HostedServerStatus>('get_hosted_server_status', { instanceId: instance.id });
      }
      // The player may have switched profile or host while this was in flight — an answer that
      // arrives after that must not overwrite what's now on screen with the wrong host's status.
      if (`${currentHostIdRef.current}:${currentInstanceIdRef.current}` !== requestedFor) return;
      setStatus(s);
      // Only clears an error this same polling loop put up — an error from Start/Stop/Prepare
      // is left alone, since a routine status read succeeding says nothing about whether that
      // action worked.
      if (statusFetchFailedRef.current) {
        statusFetchFailedRef.current = false;
        setError('');
      }
      if (s.hasJar && !loadedPropertiesForRef.current) {
        loadProperties(s.serverDir);
      }
    } catch (err) {
      if (`${currentHostIdRef.current}:${currentInstanceIdRef.current}` !== requestedFor) return;
      console.warn('Could not read hosted server status:', err);
      // Surfaced rather than left silent: a status fetch that keeps failing (agent unreachable,
      // TLS cert mismatch) used to leave whatever the previous host showed frozen on screen,
      // with nothing telling the player their VM's actual status was never loaded.
      if (selectedHost) {
        statusFetchFailedRef.current = true;
        setError(String(err));
      }
    }
  };

  /// Kept off the status poll on purpose: the Config tab is a controlled form bound to
  /// `summary`, so re-reading the file on a timer would wipe out whatever is being typed into
  /// it — and on a remote host it would also mean a second request to the agent every few
  /// seconds for a file that only changes when someone saves it.
  const loadProperties = async (serverDir: string) => {
    const loadedFor = `${selectedHostId}:${selectedId}`;
    try {
      const props = selectedHost
        ? await remoteAgent.getProperties(selectedHost)
        : await invokeCommand<ServerPropertiesSummary>('read_server_properties', { dir: serverDir });
      // The player may have switched profile or host while this was in flight.
      if (props && `${currentHostIdRef.current}:${currentInstanceIdRef.current}` === loadedFor) {
        loadedPropertiesForRef.current = loadedFor;
        setSummary(props);
      }
    } catch {
      // Leave whatever is on screen; the next prepare or save will try again.
    }
  };

  useEffect(() => {
    setError('');
    statusFetchFailedRef.current = false;
    setEulaAccepted(false);
    // Cleared rather than left in place: leaving the previous host's status on screen while the
    // new one loads meant a failed fetch below (network hiccup, agent still coming up) silently
    // kept showing whatever the last selection had prepared — including its dashboard tabs, for
    // a VM that had never been set up at all.
    setStatus(null);
    // Forget the properties loaded for the previous profile/host so the next status read
    // fetches the ones belonging to this pair.
    loadedPropertiesForRef.current = '';
    setSummary(DEFAULT_PROPERTIES_SUMMARY);
    refreshStatus();
  }, [selectedId, selectedHostId]);

  const currentHostIdRef = useRef(selectedHostId);
  currentHostIdRef.current = selectedHostId;
  const currentInstanceIdRef = useRef(selectedId);
  currentInstanceIdRef.current = selectedId;
  /// "<hostId>:<instanceId>" whose server.properties is currently in `summary`, or "" for none.
  const loadedPropertiesForRef = useRef('');
  /// Whether the error currently on screen came from refreshStatus itself, so a later
  /// successful poll knows it is safe to clear (and an unrelated Start/Stop/Prepare error knows
  /// it is not).
  const statusFetchFailedRef = useRef(false);

  // A starting server (mod loading especially) emits console lines faster than a screen can
  // show them, and one state update per line would re-render this whole view hundreds of times
  // a second. Lines collect here and land in a single update a few times a second instead.
  const pendingLogsRef = useRef<string[]>([]);
  const logFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushPendingLogs = () => {
    if (logFlushTimerRef.current) {
      clearTimeout(logFlushTimerRef.current);
      logFlushTimerRef.current = null;
    }
    if (pendingLogsRef.current.length === 0) return;
    const batch = pendingLogsRef.current;
    pendingLogsRef.current = [];
    setLogs((prev) => [...prev, ...batch].slice(-MAX_LOG_LINES));
  };

  const pushLogLine = (line: string) => {
    pendingLogsRef.current.push(line);
    if (logFlushTimerRef.current) return;
    logFlushTimerRef.current = setTimeout(() => {
      logFlushTimerRef.current = null;
      flushPendingLogs();
    }, LOG_FLUSH_MS);
  };

  useEffect(() => () => flushPendingLogs(), []);

  // A server writes its own server.properties the first time it boots, so the copy read before
  // that (all defaults) has to be replaced once it is actually up.
  useEffect(() => {
    if (status?.state !== 'running' || !status.serverDir) return;
    loadProperties(status.serverDir);
  }, [status?.state]);

  const refreshBackups = async () => {
    if (!selectedHost) {
      setBackups([]);
      return;
    }
    const requestedHostId = selectedHost.id;
    try {
      const list = await remoteAgent.listBackups(selectedHost);
      if (currentHostIdRef.current !== requestedHostId) return;
      setBackups(list);
    } catch {
      // transient agent error
    }
  };

  useEffect(() => {
    setBackups([]);
    refreshBackups();
  }, [selectedHost?.id]);

  useEffect(() => {
    if (selectedHost) return;
    if (!isTauri()) return;
    const unlisten = listen<string>('server-log', (event) => {
      pushLogLine(event.payload);
    });
    return () => {
      unlisten.then((f) => f());
      flushPendingLogs();
    };
  }, [selectedHost]);

  useEffect(() => {
    if (!selectedHost) return;
    setLogs([]);
    remoteAgent.startLogStream(selectedHost, selectedHost.id).catch((err) => setError(String(err)));
    const unlisten = listen<{ streamId: string; line: string }>('remote-server-log', (event) => {
      if (event.payload.streamId !== selectedHost.id) return;
      pushLogLine(event.payload.line);
    });
    return () => {
      unlisten.then((f) => f());
      flushPendingLogs();
      remoteAgent.stopLogStream(selectedHost.id).catch(() => {});
    };
  }, [selectedHost?.id]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const isPolling = status?.state === 'starting' || status?.state === 'running';
  useEffect(() => {
    if (!isPolling || !instance) return;
    const interval = setInterval(() => refreshStatus(), status?.state === 'starting' ? 1500 : 4000);
    return () => clearInterval(interval);
  }, [isPolling, status?.state, selectedId, selectedHostId]);

  if (instances.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center p-10">
        <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-slate-400">
          <Server className="w-6 h-6" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-white">{t.hostServerNoProfiles || 'No profiles yet'}</h2>
          <p className="text-sm text-slate-400 mt-1 max-w-sm">
            {t.hostServerNoProfilesDesc || 'Create a profile first, then come back here to host it.'}
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenCreateModal}
          className="btn-primary px-5 py-2.5 rounded-xl text-sm font-bold cursor-pointer active:scale-95 transition"
        >
          {t.btnCreateProfile || 'New Profile'}
        </button>
      </div>
    );
  }

  const difficultyOptions: SelectOption<ServerPropertiesSummary['difficulty']>[] = [
    { value: 'peaceful', label: t.difficultyPeaceful || 'Peaceful' },
    { value: 'easy', label: t.difficultyEasy || 'Easy' },
    { value: 'normal', label: t.difficultyNormal || 'Normal' },
    { value: 'hard', label: t.difficultyHard || 'Hard' },
  ];

  const gamemodeOptions: SelectOption<NonNullable<ServerPropertiesSummary['gamemode']>>[] = [
    { value: 'survival', label: t.hostServerGamemodeSurvival || 'Survival' },
    { value: 'creative', label: t.hostServerGamemodeCreative || 'Creative' },
    { value: 'adventure', label: t.hostServerGamemodeAdventure || 'Adventure' },
    { value: 'spectator', label: t.hostServerGamemodeSpectator || 'Spectator' },
  ];

  const gcEngineOptions: SelectOption<'G1GC' | 'ZGC'>[] = [
    { value: 'G1GC', label: t.hostServerGcG1 || 'G1GC (Default - Recommended)' },
    { value: 'ZGC', label: t.hostServerGcZgc || 'ZGC (Ultra Low Latency - Java 17+)' },
  ];

  const updateSummary = (patch: Partial<ServerPropertiesSummary>) =>
    setSummary((prev) => (prev ? { ...prev, ...patch } : prev));

  const handleRemoveHost = (id: string) => {
    const next = remoteHosts.filter((h) => h.id !== id);
    setRemoteHosts(next);
    saveRemoteHosts(next);
    if (selectedHostId === id) setSelectedHostId(LOCAL_HOST_ID);
  };

  const handlePrepare = async () => {
    if (!instance) return;
    setIsPreparing(true);
    setError('');
    try {
      let s: HostedServerStatus;
      if (selectedHost) {
        s = await remoteAgent.prepare(selectedHost, {
          loader: instance.loader,
          gameVersion: instance.gameVersion,
          loaderVersion: instance.loaderVersion,
          acceptEula: eulaAccepted,
        });
        setSummary(await remoteAgent.getProperties(selectedHost));
        await remoteAgent.syncMods(selectedHost, instance.id).catch(() => {});
      } else {
        s = await invokeCommand<HostedServerStatus>('prepare_hosted_server', {
          instanceId: instance.id,
          acceptEula: eulaAccepted,
        });
        setSummary(await invokeCommand<ServerPropertiesSummary>('read_server_properties', { dir: s.serverDir }));
      }
      setStatus(s);
    } catch (err) {
      setError(String(err));
    } finally {
      setIsPreparing(false);
    }
  };

  const handleStart = async () => {
    if (!instance) return;
    setIsStarting(true);
    setError('');
    setLogs([]);
    try {
      if (selectedHost) {
        await remoteAgent.start(selectedHost, { minRam, maxRam, useAikarFlags, gcEngine, autoRestart });
      } else {
        // Downloads a Java runtime when this machine has none that fits, the same as starting
        // the game itself does — a hosted server used to be handed a bare "javaw.exe" with no
        // real path behind it in that case, which failed to spawn with a raw OS error instead
        // of ever explaining that Java was the actual problem.
        const [javaBin] = await invokeCommand<[string, number, string]>('find_or_download_java_for_hosting', {
          gameVersion: instance.gameVersion,
          autoDownloadJava,
        });
        await invokeCommand('start_hosted_server', {
          instanceId: instance.id,
          javaBin,
          minRam,
          maxRam,
          useAikarFlags,
          gcEngine,
          autoRestart,
        });
      }
      setTimeout(() => refreshStatus(), 800);
    } catch (err) {
      setError(String(err));
    } finally {
      setIsStarting(false);
    }
  };

  const handleStop = async () => {
    if (!instance) return;
    setIsStopping(true);
    try {
      if (selectedHost) {
        await remoteAgent.stop(selectedHost);
      } else {
        await invokeCommand('stop_hosted_server', { instanceId: instance.id });
      }
      setTimeout(() => refreshStatus(), 500);
    } catch (err) {
      setError(String(err));
    } finally {
      setIsStopping(false);
    }
  };

  const handleSaveProperties = async () => {
    if (!status) return;
    try {
      if (selectedHost) {
        await remoteAgent.setProperties(selectedHost, summary);
      } else {
        await invokeCommand('write_server_properties', { dir: status.serverDir, summary });
      }
      setIsSavedSuccess(true);
      setSavedWhileRunning(status.state === 'running' || status.state === 'starting');
      setTimeout(() => setIsSavedSuccess(false), 2500);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleSendCommand = async () => {
    const command = consoleCommand.trim();
    if (!command) return;
    setIsSendingCommand(true);
    setError('');
    try {
      if (selectedHost) {
        await remoteAgent.sendCommand(selectedHost, command);
      } else if (instance) {
        await invokeCommand('send_hosted_server_command', { instanceId: instance.id, command });
      }
      setConsoleCommand('');
    } catch (err) {
      setError(String(err));
    } finally {
      setIsSendingCommand(false);
    }
  };

  const handleSyncMods = async () => {
    if (!selectedHost || !instance) return;
    setIsSyncingMods(true);
    setError('');
    try {
      await remoteAgent.syncMods(selectedHost, instance.id);
    } catch (err) {
      setError(String(err));
    } finally {
      setIsSyncingMods(false);
    }
  };

  const handleBackupNow = async () => {
    if (!selectedHost) return;
    setIsBackingUp(true);
    try {
      await remoteAgent.backupNow(selectedHost);
      await refreshBackups();
    } catch (err) {
      setError(String(err));
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleDownloadBackup = async (name: string) => {
    if (!selectedHost) return;
    const savePath = await invokeCommand<string | null>('select_save_path', { defaultName: name });
    if (!savePath) return;
    try {
      await remoteAgent.downloadBackup(selectedHost, name, savePath);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleDeleteBackup = async (name: string) => {
    if (!selectedHost) return;
    const confirmMsg = (t.hostServerDeleteBackupConfirm || 'Delete "{name}"? This cannot be undone.').replace('{name}', name);
    if (!window.confirm(confirmMsg)) return;
    try {
      await remoteAgent.deleteBackup(selectedHost, name);
      await refreshBackups();
    } catch (err) {
      setError(String(err));
    }
  };

  const handleRestoreBackup = async (name: string) => {
    if (!selectedHost) return;
    const confirmMsg = (
      t.hostServerRestoreBackupConfirm ||
      "Restore \"{name}\"? This overwrites the current world and stops the server if it's running."
    ).replace('{name}', name);
    if (!window.confirm(confirmMsg)) return;
    setRestoringName(name);
    try {
      await remoteAgent.restoreBackup(selectedHost, name);
      await refreshStatus();
    } catch (err) {
      setError(String(err));
    } finally {
      setRestoringName(null);
    }
  };

  const displayAddress = (() => {
    if (!selectedHost) return 'localhost:25565';
    try {
      return `${new URL(selectedHost.url).hostname}:25565`;
    } catch {
      return selectedHost.url;
    }
  })();

  const handleCopyAddress = (addr = displayAddress) => {
    navigator.clipboard.writeText(addr);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const activeLoaderBadge = instance ? getLoaderBadgeColor(instance.loader) : getLoaderBadgeColor('vanilla');

  return (
    <div className="flex-1 flex flex-col overflow-y-auto p-10 space-y-7 custom-scrollbar font-sans select-none">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pr-12">
        <div>
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[var(--accent-color)]/10 border border-[var(--accent-color)]/20 text-[var(--accent-color)] text-xs font-semibold mb-2 tracking-wide">
            <Server className="w-4 h-4" />
            <span>{t.hostServerTitleShort || 'Server Management'}</span>
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-normal">
            {t.hostServerTitleShort || 'Server Management'}
          </h1>
          <p className="text-base text-slate-300 mt-1 tracking-wide max-w-2xl leading-relaxed">
            {t.hostServerSub ||
              'Run a dedicated server for one of your profiles on this computer, and join it yourself, without a terminal.'}
          </p>
        </div>
      </div>

      {/* Control Deck (Row 1 & Row 2 Styled like Mods & Shaders Workshop Menu) */}
      <div className="space-y-3.5">
        {/* Row 1: Profile Selector + Infrastructure Selector + Add VM Button + Top-Right Primary RUN Button */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            {/* Box 1: Target Profile Selector */}
            <div className="relative min-w-[280px]" ref={profileMenuRef}>
              <button
                type="button"
                onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
                className="w-full h-[54px] flex items-center justify-between gap-3 px-4 rounded-2xl glass-panel bg-[#121212] hover:bg-[#181818] border border-white/5 hover:border-white/15 transition-colors duration-200 cursor-pointer group shadow-md"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="shrink-0" style={{ color: getLoaderColor(instance?.loader) }}>
                    {getLoaderIcon(instance?.loader, 'w-5 h-5')}
                  </span>
                  <div className="text-left min-w-0">
                    <div className="text-[11px] text-slate-400 font-medium leading-none mb-1">
                      {t.hostServerProfileLabel || 'Profile to Host:'}
                    </div>
                    <div className="text-sm font-bold text-white flex items-center gap-2 truncate max-w-[220px]">
                      <span className="truncate">{instance?.name || 'Select profile'}</span>
                      {instance && (
                        <span
                          className="text-[10px] px-2 py-0.5 rounded-md font-sans font-bold shrink-0 border"
                          style={{
                            backgroundColor: activeLoaderBadge.bg,
                            borderColor: activeLoaderBadge.border,
                            color: activeLoaderBadge.text,
                          }}
                        >
                          {instance.gameVersion}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <ChevronDown
                  className={`w-4 h-4 text-slate-400 group-hover:text-white transition-transform duration-200 shrink-0 ${
                    isProfileMenuOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {/* Profile Dropdown Menu */}
              {isProfileMenuOpen && (
                <div className="absolute top-full left-0 mt-2 w-full min-w-[300px] rounded-2xl glass-panel bg-[#121212] border border-white/10 shadow-2xl p-2 z-50 animate-dropdown space-y-1">
                  <div className="px-2.5 py-1.5 text-xs font-bold uppercase tracking-wider text-slate-400 border-b border-white/5 flex items-center justify-between">
                    <span>{t.selectTargetProfile || 'Select Target Profile'}</span>
                    <span className="text-[var(--accent-color)] font-bold">{instances.length} profiles</span>
                  </div>
                  <div className="max-h-60 overflow-y-auto custom-scrollbar space-y-1 pt-1">
                    {instances.map((inst) => {
                      const isCurrent = inst.id === selectedId;
                      const badge = getLoaderBadgeColor(inst.loader);
                      return (
                        <button
                          key={inst.id}
                          type="button"
                          onClick={() => {
                            setSelectedId(inst.id);
                            setIsProfileMenuOpen(false);
                          }}
                          className={`w-full flex items-center justify-between p-2.5 rounded-xl transition-colors cursor-pointer text-left border ${
                            isCurrent
                              ? 'bg-white/10 text-white border-white/20'
                              : 'text-slate-300 hover:text-white hover:bg-white/5 border-transparent'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            <span className="shrink-0" style={{ color: getLoaderColor(inst.loader) }}>
                              {getLoaderIcon(inst.loader, 'w-4 h-4')}
                            </span>
                            <div className="min-w-0">
                              <div className="text-sm font-bold text-white truncate">{inst.name}</div>
                              <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-1.5">
                                <span>MC {inst.gameVersion}</span>
                                <span>•</span>
                                <span className="uppercase font-semibold" style={{ color: badge.text }}>
                                  {inst.loader}
                                </span>
                              </div>
                            </div>
                          </div>
                          {isCurrent && <Check className="w-4 h-4 shrink-0 text-emerald-400 ml-2" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Box 2: Infrastructure Selector ("Chọn Hạ Tầng") */}
            <div className="relative min-w-[300px]" ref={hostMenuRef}>
              <button
                type="button"
                onClick={() => setIsHostMenuOpen(!isHostMenuOpen)}
                className="w-full h-[54px] flex items-center justify-between gap-3 px-4 rounded-2xl glass-panel bg-[#121212] hover:bg-[#181818] border border-white/5 hover:border-white/15 transition-colors duration-200 cursor-pointer group shadow-md"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {selectedHost ? (
                    <Cloud className="w-5 h-5 text-sky-400 shrink-0" />
                  ) : (
                    <Monitor className="w-5 h-5 text-[var(--accent-color)] shrink-0" />
                  )}
                  <div className="text-left min-w-0">
                    <div className="text-[11px] text-slate-400 font-medium leading-none mb-1">
                      {t.hostServerHostPlatform || 'Host Platform:'}
                    </div>
                    <div className="text-sm font-bold text-white flex items-center gap-2 truncate max-w-[220px]">
                      <span className="truncate">{selectedHost ? selectedHost.name : (t.hostServerThisComputer || 'This Computer')}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-md font-sans font-bold shrink-0 bg-white/10 text-slate-300 border border-white/10">
                        {selectedHost
                          ? 'REMOTE VPS'
                          : systemInfo
                          ? `${systemInfo.cpuCount}C • ${(systemInfo.totalRamMb / 1024).toFixed(0)}G`
                          : 'LOCAL'}
                      </span>
                    </div>
                  </div>
                </div>
                <ChevronDown
                  className={`w-4 h-4 text-slate-400 group-hover:text-white transition-transform duration-200 shrink-0 ${
                    isHostMenuOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {/* Platform Dropdown Menu */}
              {isHostMenuOpen && (
                <div className="absolute top-full left-0 mt-2 w-full min-w-[340px] rounded-2xl glass-panel bg-[#121212] border border-white/10 shadow-2xl p-2 z-50 animate-dropdown space-y-1">
                  <div className="px-2.5 py-1.5 text-xs font-bold uppercase tracking-wider text-slate-400 border-b border-white/5 flex items-center justify-between">
                    <span>{t.hostServerAvailablePlatforms || 'Available Platforms'}</span>
                    <span className="text-[var(--accent-color)] font-bold">{1 + remoteHosts.length} nodes</span>
                  </div>
                  <div className="space-y-1 pt-1">
                    {/* Local Machine Option */}
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedHostId(LOCAL_HOST_ID);
                        setIsHostMenuOpen(false);
                      }}
                      className={`w-full flex items-center justify-between p-2.5 rounded-xl transition-colors cursor-pointer text-left border ${
                        selectedHostId === LOCAL_HOST_ID
                          ? 'bg-white/10 text-white border-white/20'
                          : 'text-slate-300 hover:text-white hover:bg-white/5 border-transparent'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Monitor className="w-4 h-4 text-[var(--accent-color)] shrink-0" />
                        <div>
                          <div className="text-sm font-bold text-white">{t.hostServerThisComputer || 'This Computer'}</div>
                          <div className="text-xs text-slate-400 mt-0.5">
                            {systemInfo
                              ? `${systemInfo.cpuCount} Cores CPU • ${(systemInfo.totalRamMb / 1024).toFixed(0)} GB RAM`
                              : 'Local hardware'}
                          </div>
                        </div>
                      </div>
                      {selectedHostId === LOCAL_HOST_ID && <Check className="w-4 h-4 text-emerald-400 shrink-0" />}
                    </button>

                    {/* Remote VPS Hosts */}
                    {remoteHosts.map((h) => {
                      const isCurrent = selectedHostId === h.id;
                      let domain = h.url;
                      try {
                        domain = new URL(h.url).hostname;
                      } catch {}
                      return (
                        <div
                          key={h.id}
                          className={`w-full flex items-center justify-between p-2.5 rounded-xl transition-colors text-left border group ${
                            isCurrent
                              ? 'bg-white/10 text-white border-white/20'
                              : 'text-slate-300 hover:text-white hover:bg-white/5 border-transparent'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedHostId(h.id);
                              setIsHostMenuOpen(false);
                            }}
                            className="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer"
                          >
                            <Cloud className="w-4 h-4 text-sky-400 shrink-0" />
                            <div className="min-w-0">
                              <div className="text-sm font-bold text-white truncate">{h.name}</div>
                              <div className="text-xs text-slate-400 mt-0.5 font-mono truncate">{domain}</div>
                            </div>
                          </button>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRemoveHost(h.id);
                              }}
                              className="opacity-40 group-hover:opacity-100 p-1 text-slate-400 hover:text-rose-400 transition cursor-pointer"
                              title={t.hostServerRemoveHost || 'Remove this host'}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                            {isCurrent && <Check className="w-4 h-4 text-emerald-400 shrink-0" />}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Button 3: "+ Tạo VM" button */}
            <button
              type="button"
              onClick={() => setIsBootstrapOpen(true)}
              className="h-[54px] px-6 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/5 hover:border-white/15 text-slate-200 hover:text-white flex items-center justify-center gap-2.5 font-bold text-sm shadow-sm transition active:scale-95 cursor-pointer"
              title={t.hostServerBootstrapButton || 'Set up a new VM automatically'}
            >
              <Server className="w-5 h-5 text-slate-300" />
              <span>{t.hostServerAddVmShort || '+ Add VM'}</span>
            </button>
          </div>

          {/* Top-Right Big Primary START / STOP Button */}
          {status?.hasJar && (
            <div className="shrink-0 ml-auto">
              {status.state === 'running' || status.state === 'starting' ? (
                <button
                  type="button"
                  onClick={handleStop}
                  disabled={isStopping}
                  className="h-[44px] px-6 rounded-xl text-sm font-bold bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-300 flex items-center justify-center gap-2 cursor-pointer active:scale-95 transition disabled:opacity-40 shadow-md shadow-rose-500/10"
                >
                  {isStopping ? <Loader2 className="w-4 h-4 animate-spin" /> : <Square className="w-4 h-4 fill-current" />}
                  <span>{isStopping ? t.hostServerStopping || 'Đang dừng...' : t.hostServerStopBtn || 'DỪNG SERVER'}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleStart}
                  disabled={isStarting}
                  className="btn-primary h-[44px] px-6 rounded-xl text-sm font-bold flex items-center justify-center gap-2 cursor-pointer active:scale-95 transition disabled:opacity-40 shadow-lg shadow-[var(--accent-glow)]"
                >
                  {isStarting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
                  <span>{isStarting ? t.hostServerStarting || 'Đang khởi động...' : t.hostServerStartBtn || 'CHẠY SERVER'}</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Row 2: Pill-shaped Navigation Bar */}
        {status?.hasJar && (
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div ref={tabContainerRef} className="relative p-1 rounded-2xl glass-panel bg-[#121212] border border-white/5 inline-flex items-center shadow-sm overflow-x-auto max-w-full custom-scrollbar select-none">
              {/* Sliding Active Background Pill */}
              <div
                className={`absolute top-1 bottom-1 rounded-xl bg-[var(--accent-color)] shadow-md shadow-[var(--accent-subtle)] pointer-events-none transition-all duration-300 ${
                  tabPillStyle.width === 0 ? 'opacity-0' : 'opacity-100'
                }`}
                style={{
                  left: `${tabPillStyle.left}px`,
                  width: `${tabPillStyle.width}px`,
                  transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
                }}
              />

              {/* Tab 1: Dashboard */}
              <button
                ref={(el) => {
                  tabRefs.current['dashboard'] = el;
                }}
                type="button"
                onClick={() => setActiveTab('dashboard')}
                className={`relative z-10 px-4 py-2 rounded-xl text-sm font-bold font-sans transition-colors duration-200 whitespace-nowrap cursor-pointer flex items-center justify-center ${
                  activeTab === 'dashboard'
                    ? 'text-[#070a12]'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <span>{t.hostServerTabDashboard || 'Dashboard'}</span>
              </button>

              {/* Tab 2: Server Settings & Config (Placed right next to Dashboard) */}
              <button
                ref={(el) => {
                  tabRefs.current['config'] = el;
                }}
                type="button"
                onClick={() => setActiveTab('config')}
                className={`relative z-10 px-4 py-2 rounded-xl text-sm font-bold font-sans transition-colors duration-200 whitespace-nowrap cursor-pointer flex items-center justify-center ${
                  activeTab === 'config'
                    ? 'text-[#070a12]'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <span>{t.hostServerTabConfig || 'Server Settings & Config'}</span>
              </button>

              {/* Tab 3: Backups (if remote host) */}
              {selectedHost && (
                <button
                  ref={(el) => {
                    tabRefs.current['backups'] = el;
                  }}
                  type="button"
                  onClick={() => setActiveTab('backups')}
                  className={`relative z-10 px-4 py-2 rounded-xl text-sm font-bold font-sans transition-colors duration-200 whitespace-nowrap cursor-pointer flex items-center justify-center ${
                    activeTab === 'backups'
                      ? 'text-[#070a12]'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  <span>{t.hostServerBackupsTitle || 'Sao Lưu'}</span>
                </button>
              )}

              {/* Tab 4: Files (if remote host) */}
              {selectedHost && (
                <button
                  ref={(el) => {
                    tabRefs.current['files'] = el;
                  }}
                  type="button"
                  onClick={() => setActiveTab('files')}
                  className={`relative z-10 px-4 py-2 rounded-xl text-sm font-bold font-sans transition-colors duration-200 whitespace-nowrap cursor-pointer flex items-center justify-center ${
                    activeTab === 'files'
                      ? 'text-[#070a12]'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  <span>{t.hostServerFilesTitle || 'Quản Lý File'}</span>
                </button>
              )}

              {/* Tab 5: Server Console (At the very end) */}
              <button
                ref={(el) => {
                  tabRefs.current['console'] = el;
                }}
                type="button"
                onClick={() => setActiveTab('console')}
                className={`relative z-10 px-4 py-2 rounded-xl text-sm font-bold font-sans transition-colors duration-200 whitespace-nowrap cursor-pointer flex items-center justify-center ${
                  activeTab === 'console'
                    ? 'text-[#070a12]'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <span>{t.hostServerConsole || 'Server Console'}</span>
              </button>
            </div>

            {/* Right Side: Sync Mods button when using a remote host */}
            {selectedHost && (
              <button
                type="button"
                onClick={handleSyncMods}
                disabled={isSyncingMods}
                className="px-3.5 py-2 rounded-xl text-xs font-bold bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200 flex items-center gap-2 cursor-pointer active:scale-95 transition disabled:opacity-40 shadow-sm"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncingMods ? 'animate-spin text-[var(--accent-color)]' : ''}`} />
                <span>{isSyncingMods ? t.hostServerSyncingMods || 'Syncing mods...' : t.hostServerSyncMods || 'Đồng Bộ Mods Sang Host'}</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Bootstrap Wizard Modal */}
      {isBootstrapOpen && (
        <VmBootstrapWizard
          language={language}
          onClose={() => setIsBootstrapOpen(false)}
          onInstalled={(newHost) => {
            const next = [...remoteHosts, newHost];
            setRemoteHosts(next);
            saveRemoteHosts(next);
            setSelectedHostId(newHost.id);
            setIsBootstrapOpen(false);
          }}
        />
      )}

      {/* Global Error Notice */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-300 text-sm flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
          <span className="leading-relaxed">{error}</span>
        </div>
      )}

      {/* Content Area */}
      {instance && (
        <>
          {!status?.hasJar ? (
            /* Not prepared yet: EULA acceptance and download */
            <div className="max-w-xl p-6 rounded-2xl bg-[#161719] border border-white/10 space-y-4 shadow-xl">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  {selectedHost ? <Cloud className="w-4 h-4 text-[var(--accent-color)]" /> : <Monitor className="w-4 h-4 text-[var(--accent-color)]" />}
                  <span>{t.hostServerPrepareTitle || 'Set up the server'}</span>
                </h3>
                <p className="text-sm text-slate-400 mt-1 leading-relaxed">
                  {t.hostServerPrepareDesc ||
                    "Downloads a dedicated server matching this profile's loader and version, right into its own folder."}
                </p>
              </div>
              <div className="p-4 rounded-xl bg-black/40 border border-white/5 flex items-center justify-between gap-4">
                <span className="text-sm text-slate-300">
                  {t.hostServerEulaPrefix || 'Tôi đã đọc và đồng ý với '}
                  <a
                    href="https://www.minecraft.net/en-us/eula"
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      openExternalUrl('https://www.minecraft.net/en-us/eula');
                    }}
                    className="text-[var(--accent-light)] hover:underline inline-flex items-center gap-1 font-semibold"
                  >
                    Minecraft EULA
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </span>
                <ToggleSwitch checked={eulaAccepted} onChange={setEulaAccepted} size="md" />
              </div>
              <button
                type="button"
                onClick={handlePrepare}
                disabled={!eulaAccepted || isPreparing}
                className="btn-primary px-6 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 cursor-pointer active:scale-95 transition disabled:opacity-40 disabled:cursor-not-allowed shadow-md"
              >
                <Download className="w-4 h-4" />
                <span>{isPreparing ? t.hostServerPreparing || 'Downloading...' : t.hostServerPrepareBtn || 'Download & Prepare'}</span>
              </button>
            </div>
          ) : (
            /* Prepared: Tab Views */
            <div className="space-y-6">
              {/* ======================================================== */}
              {/* TAB 1: TỔNG QUAN (ENTERPRISE DASHBOARD) */}
              {/* ======================================================== */}
              {activeTab === 'dashboard' && (
                <div key="dashboard" className="space-y-6 animate-tabSlideFade">
                  {/* Row 1: 3 Big Summary Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Card 1: Server Status */}
                    <div
                      className={`p-5 rounded-2xl border transition-all duration-200 flex flex-col justify-between gap-3 shadow-md ${
                        status.state === 'running'
                          ? 'bg-emerald-500/[0.06] border-emerald-500/30'
                          : status.state === 'starting'
                          ? 'bg-amber-500/[0.06] border-amber-500/30'
                          : status.state === 'crashed'
                          ? 'bg-rose-500/[0.06] border-rose-500/30'
                          : 'glass-panel bg-[#121212] border-white/5'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                          {t.hostServerStateLabel || 'Server State'}
                        </span>
                        <span
                          className={`w-2.5 h-2.5 rounded-full ${
                            status.state === 'running'
                              ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]'
                              : status.state === 'starting'
                              ? 'bg-amber-400 animate-pulse shadow-[0_0_8px_rgba(251,191,36,0.8)]'
                              : status.state === 'crashed'
                              ? 'bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.8)]'
                              : 'bg-slate-500'
                          }`}
                        />
                      </div>
                      <div>
                        <div className="text-xl font-extrabold text-white">
                          {status.state === 'running' && (t.hostServerRunning || 'Đang Chạy')}
                          {status.state === 'starting' && (t.hostServerStatusStarting || 'Đang Khởi Động')}
                          {status.state === 'crashed' && (t.hostServerStatusCrashed || 'Gặp Sự Cố')}
                          {status.state === 'stopped' && (t.hostServerStopped || 'Đã Dừng')}
                        </div>
                        <div className="text-xs text-slate-400 mt-1 flex items-center gap-2">
                          <span className="uppercase font-semibold text-white/80">{instance.loader}</span>
                          <span>•</span>
                          <span>v{instance.gameVersion}</span>
                        </div>
                      </div>
                      {status.state === 'crashed' && (
                        <div className="text-[11px] text-rose-300 font-medium leading-tight">
                          {t.hostServerCrashedHint || 'Server exited unexpectedly. Check console for crash log.'}
                        </div>
                      )}
                    </div>

                    {/* Card 2: Server Address */}
                    <div className="p-5 rounded-2xl glass-panel bg-[#121212] border border-white/5 flex flex-col justify-between gap-3 shadow-md">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                          {t.hostServerConnectionAddress || 'Connection Address'}
                        </span>
                        <Wifi className="w-3.5 h-3.5 text-[var(--accent-color)]" />
                      </div>
                      <div>
                        <div className="text-lg font-mono font-extrabold text-emerald-400 truncate">
                          {displayAddress}
                        </div>
                        {!selectedHost && lanIp && (
                          <div className="text-xs font-mono text-slate-400 mt-0.5 truncate">
                            LAN: {lanIp}:25565
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => handleCopyAddress(displayAddress)}
                          className="flex-1 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-bold text-slate-200 flex items-center justify-center gap-1.5 transition cursor-pointer border border-white/5"
                        >
                          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                          <span>{copied ? (t.p2pTicketCopiedBtn || 'Copied!') : (t.hostServerCopyIp || 'Copy IP')}</span>
                        </button>
                        {!selectedHost && lanIp && (
                          <button
                            type="button"
                            onClick={() => handleCopyAddress(`${lanIp}:25565`)}
                            className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-bold text-slate-300 flex items-center gap-1 transition cursor-pointer border border-white/5"
                            title="Copy LAN IP"
                          >
                            <Copy className="w-3 h-3" />
                            <span>LAN</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Card 3: Online Players */}
                    <div className="p-5 rounded-2xl glass-panel bg-[#121212] border border-white/5 flex flex-col justify-between gap-3 shadow-md">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                          {t.hostServerOnlinePlayers || 'Online Players'}
                        </span>
                        <Users className="w-3.5 h-3.5 text-[var(--accent-color)]" />
                      </div>
                      <div>
                        <div className="text-2xl font-extrabold text-white">
                          {status.onlinePlayers ?? 0}{' '}
                          <span className="text-sm font-normal text-slate-400">
                            / {status.maxPlayers ?? summary?.maxPlayers ?? 20} max
                          </span>
                        </div>
                        <div className="text-xs text-slate-400 mt-1">
                          {status.state === 'running'
                            ? (t.hostServerAcceptingConnections || 'Accepting connections')
                            : (t.hostServerIsOffline || 'Server is offline')}
                        </div>
                      </div>
                      {status.playerList && status.playerList.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5 pt-1.5 border-t border-white/5">
                          {status.playerList.map((p) => (
                            <span
                              key={p}
                              className="px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-[11px] font-mono font-semibold text-emerald-300"
                            >
                              {p}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div className="text-[11px] text-slate-500 pt-1">
                          PVP: {summary?.pvp ? 'Bật' : 'Tắt'} • Whitelist: {summary?.whiteList ? 'Bật' : 'Tắt'}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Row 1.5: 4 Real-time Game Server Metrics (health, uptime, memory, world size) */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {/* Server health, from the server's own overload warnings. A status ping
                        carries no tick rate, so no TPS figure is shown for one. */}
                    <div className="p-4 rounded-xl glass-panel bg-[#121212] border border-white/5 flex flex-col justify-between gap-1 shadow-sm">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                        <span>{t.hostServerHealth || 'Server health'}</span>
                      </div>
                      <div
                        className={`text-xl font-mono font-extrabold ${
                          status.state !== 'running'
                            ? 'text-white'
                            : status.lagBehindMs
                            ? 'text-amber-400'
                            : 'text-emerald-400'
                        }`}
                      >
                        {status.state !== 'running'
                          ? '--'
                          : status.lagBehindMs
                          ? formatLagBehind(status.lagBehindMs)
                          : t.hostServerHealthOk || 'Smooth'}
                      </div>
                      <div className="text-[10px] text-slate-500 truncate">
                        {status.state !== 'running'
                          ? t.hostServerOffline || 'Offline'
                          : status.lagBehindMs
                          ? t.hostServerHealthLagging || 'Server reported falling behind'
                          : t.hostServerHealthNoWarnings || 'No overload reported'}
                      </div>
                    </div>

                    {/* Uptime */}
                    <div className="p-4 rounded-xl glass-panel bg-[#121212] border border-white/5 flex flex-col justify-between gap-1 shadow-sm">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                        <span>{t.hostServerUptime || 'Thời gian chạy'}</span>
                      </div>
                      <div className="text-xl font-mono font-extrabold text-white">
                        {status.state === 'running' ? formatUptime(status.uptimeSeconds) : '--'}
                      </div>
                      <div className="text-[10px] text-slate-500 truncate">
                        {status.state === 'running'
                          ? t.hostServerActive || 'Active'
                          : t.hostServerStoppedLabel || 'Stopped'}
                      </div>
                    </div>

                    {/* Process memory. This is the java process's resident memory, which covers
                        more than the heap, so it is deliberately not labelled as heap usage. */}
                    <div className="p-4 rounded-xl glass-panel bg-[#121212] border border-white/5 flex flex-col justify-between gap-1 shadow-sm">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                        <span>{t.hostServerProcessMemory || 'Process memory'}</span>
                      </div>
                      <div className="text-xl font-mono font-extrabold text-white truncate">
                        {status.processMemoryMb !== undefined ? `${status.processMemoryMb} MB` : '--'}
                      </div>
                      <div className="text-[10px] text-slate-500 truncate">
                        {t.hostServerAllocated || 'Allocated'}: {status.maxRamMb || maxRam} MB
                      </div>
                    </div>

                    {/* World Size */}
                    <div className="p-4 rounded-xl glass-panel bg-[#121212] border border-white/5 flex flex-col justify-between gap-1 shadow-sm">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                        <span>{t.hostServerWorldSize || 'Dung lượng'}</span>
                      </div>
                      <div className="text-xl font-mono font-extrabold text-white">
                        {formatBytes(status.worldSizeBytes)}
                      </div>
                      <div className="text-[10px] text-slate-500 truncate">
                        {summary?.levelName || 'world'}
                      </div>
                    </div>
                  </div>

                  {/* Real-time Hardware Performance Gauges */}
                  <div className="p-6 rounded-2xl glass-panel bg-[#121212] border border-white/5 space-y-4 shadow-md">
                    <div className="flex items-center justify-between border-b border-white/5 pb-3">
                      <div className="flex items-center gap-2">
                        <Activity className="w-4 h-4 text-[var(--accent-color)]" />
                        <span className="text-xs font-bold uppercase tracking-wider text-white">
                          {t.hostServerPlatformMetrics || 'Real-time Platform Metrics'}
                        </span>
                      </div>
                      <span className="text-xs text-slate-400 font-mono">
                        {selectedHost ? selectedHost.name : (t.hostServerThisComputer || 'This Computer')}
                      </span>
                    </div>

                    {status?.system ? (
                      /* Remote Agent Hardware Metrics */
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
                        {/* CPU Metric */}
                        <div className="p-4 rounded-xl bg-black/40 border border-white/5 space-y-2">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-slate-400 font-bold flex items-center gap-1.5">
                              <Cpu className="w-3.5 h-3.5 text-[var(--accent-color)]" />
                              <span>CPU LOAD</span>
                            </span>
                            <span className="font-mono text-white font-bold">{status.system.cpuPercent.toFixed(0)}%</span>
                          </div>
                          <div className="w-full h-2 rounded-full bg-white/5 overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-300"
                              style={{
                                width: `${Math.min(status.system.cpuPercent, 100)}%`,
                                backgroundColor: status.system.cpuPercent > 80 ? '#f43f5e' : 'var(--accent-color)',
                              }}
                            />
                          </div>
                        </div>

                        {/* RAM Metric */}
                        <div className="p-4 rounded-xl bg-black/40 border border-white/5 space-y-2">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-slate-400 font-bold flex items-center gap-1.5">
                              <Activity className="w-3.5 h-3.5 text-[var(--accent-color)]" />
                              <span>MEMORY (RAM)</span>
                            </span>
                            <span className="font-mono text-white font-bold">
                              {(status.system.memUsedMb / 1024).toFixed(1)} / {(status.system.memTotalMb / 1024).toFixed(1)} GB
                            </span>
                          </div>
                          <div className="w-full h-2 rounded-full bg-white/5 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-emerald-400 transition-all duration-300"
                              style={{
                                width: `${Math.min((status.system.memUsedMb / status.system.memTotalMb) * 100, 100)}%`,
                              }}
                            />
                          </div>
                        </div>

                        {/* Storage Metric */}
                        <div className="p-4 rounded-xl bg-black/40 border border-white/5 space-y-2">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-slate-400 font-bold flex items-center gap-1.5">
                              <HardDrive className="w-3.5 h-3.5 text-[var(--accent-color)]" />
                              <span>DISK STORAGE</span>
                            </span>
                            <span className="font-mono text-white font-bold">
                              {(status.system.diskUsedMb / 1024).toFixed(1)} / {(status.system.diskTotalMb / 1024).toFixed(1)} GB
                            </span>
                          </div>
                          <div className="w-full h-2 rounded-full bg-white/5 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-amber-400 transition-all duration-300"
                              style={{
                                width: `${Math.min((status.system.diskUsedMb / status.system.diskTotalMb) * 100, 100)}%`,
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    ) : (
                      /* Local Hardware Info */
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                        <div className="p-4 rounded-xl bg-black/40 border border-white/5 flex items-center gap-3">
                          <div className="p-2.5 rounded-xl bg-white/5 text-[var(--accent-color)]">
                            <Cpu className="w-5 h-5" />
                          </div>
                          <div>
                            <div className="text-[11px] text-slate-400 uppercase font-bold">CPU Architecture</div>
                            <div className="text-sm font-bold text-white mt-0.5">
                              {systemInfo ? `${systemInfo.cpuCount} Cores (Local Processor)` : 'Detected CPU'}
                            </div>
                          </div>
                        </div>
                        <div className="p-4 rounded-xl bg-black/40 border border-white/5 flex items-center gap-3">
                          <div className="p-2.5 rounded-xl bg-white/5 text-[var(--accent-color)]">
                            <Activity className="w-5 h-5" />
                          </div>
                          <div>
                            <div className="text-[11px] text-slate-400 uppercase font-bold">System Memory (RAM)</div>
                            <div className="text-sm font-bold text-white mt-0.5">
                              {systemInfo
                                ? `${(systemInfo.availableRamMb / 1024).toFixed(1)} GB Available / ${(systemInfo.totalRamMb / 1024).toFixed(0)} GB Total`
                                : 'Detected RAM'}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ======================================================== */}
              {/* TAB 2: CONSOLE (DEDICATED FULL-SIZED TERMINAL) */}
              {/* ======================================================== */}
              {activeTab === 'console' && (
                <div key="console" className="rounded-2xl glass-panel bg-[#121212] border border-white/5 overflow-hidden shadow-2xl animate-tabSlideFade">
                  {/* Console Header Bar */}
                  <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between bg-black/40">
                    <div className="flex items-center gap-2">
                      <Terminal className="w-4 h-4 text-[var(--accent-color)]" />
                      <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                        {t.hostServerConsole || 'Server Console'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => refreshStatus()}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
                      title={t.rescanBtn || 'Refresh'}
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Terminal Log Output Window */}
                  <div className="h-[26rem] overflow-y-auto custom-scrollbar px-4 py-3.5 font-mono text-[11.5px] text-slate-300 space-y-1 bg-[#0a0a0c]">
                    {logs.length === 0 ? (
                      <p className="text-slate-600 italic">{t.hostServerNoLogsYet || 'No output yet.'}</p>
                    ) : (
                      logs.map((line, i) => <div key={i} className="leading-relaxed whitespace-pre-wrap break-all">{line}</div>)
                    )}
                    <div ref={logEndRef} />
                  </div>

                  {/* Command Input Bar */}
                  {(status.state === 'running' || status.state === 'starting') && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleSendCommand();
                      }}
                      className="flex items-center gap-2 px-4 py-3 border-t border-white/5 bg-black/40"
                    >
                      <span className="text-sm font-mono text-[var(--accent-color)] font-bold pl-1">&gt;</span>
                      <input
                        type="text"
                        value={consoleCommand}
                        onChange={(e) => setConsoleCommand(e.target.value)}
                        placeholder={t.hostServerConsoleCommandPlaceholder || 'Type a command (e.g. op Steve)...'}
                        className="flex-1 min-w-0 px-3.5 py-2 rounded-xl bg-white/5 border border-white/10 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-[var(--accent-color)]"
                      />
                      <button
                        type="submit"
                        disabled={!consoleCommand.trim() || isSendingCommand}
                        className="btn-primary px-5 py-2 rounded-xl text-xs font-bold shrink-0 cursor-pointer active:scale-95 transition disabled:opacity-40"
                      >
                        {isSendingCommand ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : (t.hostServerSendBtn || 'Send')}
                      </button>
                    </form>
                  )}
                </div>
              )}

              {/* ======================================================== */}
              {/* TAB: CÀI ĐẶT & CẤU HÌNH (SERVER SETTINGS & CONFIG)       */}
              {/* ======================================================== */}
              {activeTab === 'config' && (
                <div key="config" className="space-y-6 animate-tabSlideFade">
                  {/* Top Header with Save Button */}
                  <div className="p-6 rounded-2xl glass-panel bg-[#121212] border border-white/5 flex flex-wrap items-center justify-between gap-4 shadow-md">
                    <div>
                      <h3 className="text-base font-bold text-white flex items-center gap-2.5">
                        <Sliders className="w-5 h-5 text-[var(--accent-color)]" />
                        <span>{t.hostServerConfigTitle || 'Server Settings & Config'}</span>
                      </h3>
                      <p className="text-xs text-slate-400 mt-1">
                        {t.hostServerConfigSubtitle ||
                          'Configure RAM allocation, JVM flags, network ports, and Minecraft gameplay rules.'}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={handleSaveProperties}
                      className={`px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer active:scale-95 transition shadow-md ${
                        isSavedSuccess
                          ? 'bg-emerald-500 text-black font-extrabold shadow-emerald-500/20'
                          : 'btn-primary'
                      }`}
                    >
                      {isSavedSuccess ? (
                        <>
                          <Check className="w-4 h-4 stroke-[3]" />
                          <span>{t.hostServerSavedSettings || 'Saved Settings!'}</span>
                        </>
                      ) : (
                        <>
                          <Check className="w-4 h-4" />
                          <span>{t.btnSave || 'Lưu Cài Đặt'}</span>
                        </>
                      )}
                    </button>
                    {savedWhileRunning && status?.state !== 'stopped' && (
                      <span className="text-xs text-amber-300 basis-full">
                        {t.hostServerRestartToApply || 'Saved. Restart the server for these changes to take effect.'}
                      </span>
                    )}
                  </div>

                  {/* Section 1: Cấp Phát RAM & Hiệu Năng JVM */}
                  <div className="p-6 rounded-2xl glass-panel bg-[#121212] border border-white/5 space-y-4 shadow-md">
                    <div className="text-xs font-bold uppercase tracking-wider text-slate-300 pb-1">
                      <span>{t.hostServerCfgSectionRam || '1. RAM Allocation & JVM Performance'}</span>
                    </div>

                    <div className="space-y-3">
                      {/* RAM Allocation with Slider */}
                      <div className="p-4 rounded-xl bg-black/30 border border-white/5 space-y-3">
                        <div className="text-xs font-bold text-slate-300">
                          {t.hostServerCfgMaxMemory || 'Max Memory Allocation (RAM)'}
                        </div>
                        <RamAllocationField
                          value={maxRam}
                          onChange={(v) => {
                            const nextMin = Math.min(minRam, v);
                            setMaxRam(v);
                            setMinRam(nextMin);
                            persistLaunchSettings({ maxRam: v, minRam: nextMin });
                          }}
                          systemInfo={selectedHost ? remoteSystemInfo : systemInfo}
                          min={1024}
                          step={512}
                        />
                      </div>

                      {/* Garbage Collector Select */}
                      <div className="p-4 rounded-xl bg-black/30 border border-white/5 flex flex-wrap items-center justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-white">
                            {t.hostServerGcEngine || 'Bộ thu gom rác (Garbage Collector)'}
                          </div>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {t.hostServerGcHint ||
                              'G1GC is stable and standard. ZGC minimizes GC pause latencies, and needs Java 15 or newer.'}
                          </p>
                        </div>
                        <div className="w-48 shrink-0">
                          <CustomSelect
                            value={gcEngine}
                            onChange={(v) => {
                              setGcEngine(v);
                              persistLaunchSettings({ gcEngine: v });
                            }}
                            options={gcEngineOptions}
                          />
                        </div>
                        {gcEngine === 'ZGC' && (
                          <div className="w-full flex items-start gap-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-lg p-2.5">
                            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                            <span>
                              {t.hostServerZgcJavaWarning ||
                                'ZGC needs Java 15 or newer. On an older Java the server will refuse to start.'}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Aikar's Flags Toggle */}
                      <div className="p-4 rounded-xl bg-black/30 border border-white/5 flex items-center justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-white">
                            {t.hostServerAikarFlags || "Aikar's Flags (G1GC tối ưu)"}
                          </div>
                          <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                            {t.hostServerAikarHint ||
                              'Tuned G1GC flags for servers. They include AlwaysPreTouch, so the JVM claims the full allocated RAM at startup.'}
                          </p>
                        </div>
                        <ToggleSwitch
                          checked={useAikarFlags}
                          onChange={(v) => {
                            setUseAikarFlags(v);
                            persistLaunchSettings({ useAikarFlags: v });
                          }}
                          size="md"
                        />
                      </div>

                      {/* Auto Restart Toggle */}
                      <div className="p-4 rounded-xl bg-black/30 border border-white/5 flex items-center justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-white">
                            {t.hostServerAutoRestart || 'Tự động khởi động lại khi crash'}
                          </div>
                          <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                            {t.hostServerAutoRestartDesc || 'Tự động bật lại server sau 10 giây nếu bị crash (tối đa 3 lần/phút)'}
                          </p>
                        </div>
                        <ToggleSwitch
                          checked={autoRestart}
                          onChange={(v) => {
                            setAutoRestart(v);
                            persistLaunchSettings({ autoRestart: v });
                          }}
                          size="md"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Section 2: Cài Đặt Kết Nối & Bảo Mật Mạng (Network & Access) */}
                  <div className="p-6 rounded-2xl glass-panel bg-[#121212] border border-white/5 space-y-4 shadow-md">
                    <div className="text-xs font-bold uppercase tracking-wider text-slate-300 pb-1">
                      <span>{t.hostServerCfgSectionNetwork || '2. Network & Access Control'}</span>
                    </div>

                    <div className="space-y-3">
                      {/* Online Mode Toggle */}
                      <div className="p-4 rounded-xl bg-black/30 border border-white/5 flex items-center justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-white">
                            {t.serverConfigOnlineMode || 'Yêu cầu tài khoản Microsoft (Online Mode)'}
                          </div>
                          <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                            {t.serverConfigOnlineModeDesc ||
                              "Tắt để cho phép tài khoản offline/không chính chủ tham gia. Bật nếu muốn bắt buộc tài khoản bản quyền."}
                          </p>
                        </div>
                        <ToggleSwitch
                          checked={summary.onlineMode}
                          onChange={(v) => updateSummary({ onlineMode: v })}
                          size="md"
                        />
                      </div>

                      {/* PvP Toggle */}
                      <div className="p-4 rounded-xl bg-black/30 border border-white/5 flex items-center justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-white">
                            {t.serverConfigPvp || 'Cho phép người chơi tấn công nhau (PvP)'}
                          </div>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {t.hostServerCfgPvpHint || 'Enable or disable combat damage between players.'}
                          </p>
                        </div>
                        <ToggleSwitch
                          checked={summary.pvp}
                          onChange={(v) => updateSummary({ pvp: v })}
                          size="md"
                        />
                      </div>

                      {/* Whitelist Toggle */}
                      <div className="p-4 rounded-xl bg-black/30 border border-white/5 flex items-center justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-white">
                            {t.serverConfigWhitelist || 'Danh sách trắng (Whitelist)'}
                          </div>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {t.hostServerCfgWhitelistHint || 'Only allow players on the whitelist to connect.'}
                          </p>
                        </div>
                        <ToggleSwitch
                          checked={summary.whiteList}
                          onChange={(v) => updateSummary({ whiteList: v })}
                          size="md"
                        />
                      </div>

                      {/* Port (NO SLIDER) */}
                      <div className="p-4 rounded-xl bg-black/30 border border-white/5 flex items-center justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-white">
                            {t.serverConfigPort || 'Cổng kết nối máy chủ (Server Port)'}
                          </div>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {t.hostServerCfgPortHint || 'Default Minecraft TCP port is 25565.'}
                          </p>
                        </div>
                        <input
                          type="number"
                          min={1}
                          max={65535}
                          value={summary.serverPort}
                          onChange={(e) =>
                            updateSummary({ serverPort: Math.min(65535, Math.max(1, Number(e.target.value) || 25565)) })
                          }
                          className="w-28 px-3.5 py-2 rounded-xl bg-white/5 border border-white/10 text-sm font-mono font-bold text-center text-white focus:outline-none focus:border-[var(--accent-color)]"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Section 3: Cấu Hình Gameplay & Thế Giới */}
                  <div className="p-6 rounded-2xl glass-panel bg-[#121212] border border-white/5 space-y-4 shadow-md">
                    <div className="text-xs font-bold uppercase tracking-wider text-slate-300 pb-1">
                      <span>{t.hostServerCfgSectionGameplay || '3. Gameplay & World Settings'}</span>
                    </div>

                    <div className="space-y-3">
                      {/* Gamemode Dropdown */}
                      <div className="p-4 rounded-xl bg-black/30 border border-white/5 flex flex-wrap items-center justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-white">
                            {t.hostServerGamemode || 'Chế độ chơi mặc định'}
                          </div>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {t.hostServerCfgGamemodeHint || 'Default game mode for new players entering the world.'}
                          </p>
                        </div>
                        <div className="w-48 shrink-0">
                          <CustomSelect
                            value={summary.gamemode || 'survival'}
                            onChange={(v) => updateSummary({ gamemode: v })}
                            options={gamemodeOptions}
                          />
                        </div>
                      </div>

                      {/* Difficulty Dropdown */}
                      <div className="p-4 rounded-xl bg-black/30 border border-white/5 flex flex-wrap items-center justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-white">
                            {t.serverConfigDifficulty || 'Độ khó trò chơi'}
                          </div>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {t.hostServerCfgDifficultyHint || 'Affects monster spawn rates and damage.'}
                          </p>
                        </div>
                        <div className="w-48 shrink-0">
                          <CustomSelect
                            value={summary.difficulty}
                            onChange={(v) => updateSummary({ difficulty: v })}
                            options={difficultyOptions}
                          />
                        </div>
                      </div>

                      {/* Max Players (WITH SLIDER) */}
                      <div className="p-4 rounded-xl bg-black/30 border border-white/5 space-y-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-sm font-semibold text-white">
                              {t.serverConfigMaxPlayers || 'Số người chơi tối đa'}
                            </div>
                            <p className="text-xs text-slate-400 mt-0.5">
                              {t.hostServerCfgMaxPlayersHint || 'Maximum concurrent players allowed.'}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              min={1}
                              max={200}
                              value={summary.maxPlayers}
                              onChange={(e) => updateSummary({ maxPlayers: Math.min(200, Math.max(1, Number(e.target.value) || 1)) })}
                              className="w-20 px-3 py-1.5 rounded-lg bg-black/50 border border-white/10 text-xs font-mono font-bold text-center text-white focus:outline-none focus:border-[var(--accent-color)]"
                            />
                            <span className="text-xs text-slate-400 font-mono">slots</span>
                          </div>
                        </div>
                        <input
                          type="range"
                          min={1}
                          max={200}
                          step={1}
                          value={summary.maxPlayers}
                          onChange={(e) => updateSummary({ maxPlayers: Number(e.target.value) })}
                          className="range-filled"
                          style={rangeFill(summary.maxPlayers, 1, 200)}
                        />
                      </div>

                      {/* View Distance (WITH SLIDER) */}
                      <div className="p-4 rounded-xl bg-black/30 border border-white/5 space-y-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-sm font-semibold text-white">
                              {t.hostServerViewDistance || 'Tầm nhìn (View Distance)'}
                            </div>
                            <p className="text-xs text-slate-400 mt-0.5">
                              {t.hostServerCfgViewDistanceHint || 'Radius of chunks sent to players (2–32 chunks).'}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              min={2}
                              max={32}
                              value={summary.viewDistance || 10}
                              onChange={(e) =>
                                updateSummary({ viewDistance: Math.min(32, Math.max(2, Number(e.target.value) || 10)) })
                              }
                              className="w-20 px-3 py-1.5 rounded-lg bg-black/50 border border-white/10 text-xs font-mono font-bold text-center text-white focus:outline-none focus:border-[var(--accent-color)]"
                            />
                            <span className="text-xs text-slate-400 font-mono">chunks</span>
                          </div>
                        </div>
                        <input
                          type="range"
                          min={2}
                          max={32}
                          step={1}
                          value={summary.viewDistance || 10}
                          onChange={(e) => updateSummary({ viewDistance: Number(e.target.value) })}
                          className="range-filled"
                          style={rangeFill(summary.viewDistance || 10, 2, 32)}
                        />
                      </div>

                      {/* Simulation Distance (WITH SLIDER) */}
                      <div className="p-4 rounded-xl bg-black/30 border border-white/5 space-y-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-sm font-semibold text-white">
                              {t.hostServerSimDistance || 'Tầm mô phỏng thực thể (Simulation Distance)'}
                            </div>
                            <p className="text-xs text-slate-400 mt-0.5">
                              {t.hostServerCfgSimDistanceHint || 'Radius of chunks ticking entities (2–32 chunks).'}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              min={2}
                              max={32}
                              value={summary.simulationDistance || 10}
                              onChange={(e) =>
                                updateSummary({ simulationDistance: Math.min(32, Math.max(2, Number(e.target.value) || 10)) })
                              }
                              className="w-20 px-3 py-1.5 rounded-lg bg-black/50 border border-white/10 text-xs font-mono font-bold text-center text-white focus:outline-none focus:border-[var(--accent-color)]"
                            />
                            <span className="text-xs text-slate-400 font-mono">chunks</span>
                          </div>
                        </div>
                        <input
                          type="range"
                          min={2}
                          max={32}
                          step={1}
                          value={summary.simulationDistance || 10}
                          onChange={(e) => updateSummary({ simulationDistance: Number(e.target.value) })}
                          className="range-filled"
                          style={rangeFill(summary.simulationDistance || 10, 2, 32)}
                        />
                      </div>

                      {/* Spawn Protection (WITH SLIDER) */}
                      <div className="p-4 rounded-xl bg-black/30 border border-white/5 space-y-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-sm font-semibold text-white">
                              {t.hostServerSpawnProtection || 'Bán kính bảo vệ điểm hồi sinh (Spawn Protection)'}
                            </div>
                            <p className="text-xs text-slate-400 mt-0.5">
                              {t.hostServerCfgSpawnProtectionHint || 'Protected block radius around world spawn (0–100 blocks).'}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              min={0}
                              max={100}
                              value={summary.spawnProtection ?? 16}
                              onChange={(e) =>
                                updateSummary({ spawnProtection: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })
                              }
                              className="w-20 px-3 py-1.5 rounded-lg bg-black/50 border border-white/10 text-xs font-mono font-bold text-center text-white focus:outline-none focus:border-[var(--accent-color)]"
                            />
                            <span className="text-xs text-slate-400 font-mono">blocks</span>
                          </div>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          value={summary.spawnProtection ?? 16}
                          onChange={(e) => updateSummary({ spawnProtection: Number(e.target.value) })}
                          className="range-filled"
                          style={rangeFill(summary.spawnProtection ?? 16, 0, 100)}
                        />
                      </div>

                      {/* Allow Nether Toggle */}
                      <div className="p-4 rounded-xl bg-black/30 border border-white/5 flex items-center justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-white">
                            {t.hostServerAllowNether || 'Cho phép chiều không gian Nether'}
                          </div>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {t.hostServerCfgNetherHint || 'Enable or disable portals and the Nether dimension.'}
                          </p>
                        </div>
                        <ToggleSwitch
                          checked={summary.allowNether ?? true}
                          onChange={(v) => updateSummary({ allowNether: v })}
                          size="md"
                        />
                      </div>

                      {/* Hardcore Mode Toggle */}
                      <div className="p-4 rounded-xl bg-black/30 border border-white/5 flex items-center justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-white">
                            {t.hostServerHardcore || 'Chế độ 1 mạng duy nhất (Hardcore Mode)'}
                          </div>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {t.hostServerCfgHardcoreHint || 'Locks difficulty to Hard; players are put in spectator upon death.'}
                          </p>
                        </div>
                        <ToggleSwitch
                          checked={summary.hardcore ?? false}
                          onChange={(v) => updateSummary({ hardcore: v })}
                          size="md"
                        />
                      </div>

                      {/* World Seed (NO SLIDER) */}
                      <div className="p-4 rounded-xl bg-black/30 border border-white/5 space-y-2">
                        <div className="text-sm font-semibold text-white">
                          {t.hostServerLevelSeed || 'Hạt giống thế giới (World Seed)'}
                        </div>
                        <p className="text-xs text-slate-400">
                          {t.hostServerCfgSeedHint || 'Leave empty to generate a random seed.'}
                        </p>
                        <input
                          type="text"
                          value={summary.levelSeed ?? ''}
                          placeholder={t.hostServerCfgSeedPlaceholder || 'e.g. 82518294719 or leave blank...'}
                          onChange={(e) => updateSummary({ levelSeed: e.target.value })}
                          className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm font-mono text-white placeholder-slate-500 focus:outline-none focus:border-[var(--accent-color)]"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ======================================================== */}
              {/* TAB 4: SAO LƯU (BACKUPS - REMOTE HOST) */}
              {/* ======================================================== */}
              {activeTab === 'backups' && selectedHost && (
                <div key="backups" className="rounded-2xl glass-panel bg-[#121212] border border-white/5 overflow-hidden shadow-xl animate-tabSlideFade">
                  <div className="px-5 py-3.5 border-b border-white/5 flex items-center justify-between bg-black/40">
                    <div>
                      <span className="text-sm font-bold text-white uppercase tracking-wider">
                        {t.hostServerBackupsTitle || 'Sao Lưu'} ({backups.length})
                      </span>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Snapshots of your world folder on the remote server
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleBackupNow}
                      disabled={isBackingUp}
                      className="btn-primary px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer active:scale-95 transition disabled:opacity-40"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isBackingUp ? 'animate-spin' : ''}`} />
                      <span>{isBackingUp ? t.hostServerBackingUp || 'Backing up...' : t.hostServerBackupNow || 'Tạo Bản Sao Lưu'}</span>
                    </button>
                  </div>

                  <div className="divide-y divide-white/5 max-h-96 overflow-y-auto custom-scrollbar">
                    {backups.length === 0 ? (
                      <p className="px-5 py-8 text-center text-xs text-slate-500">{t.hostServerNoBackupsYet || 'No backups yet.'}</p>
                    ) : (
                      backups.map((b) => (
                        <div key={b.name} className="px-5 py-3 flex items-center justify-between gap-4 text-xs hover:bg-white/[0.02] transition">
                          <div className="min-w-0">
                            <div className="font-mono text-sm text-slate-100 font-semibold truncate">
                              {new Date(b.createdAt * 1000).toLocaleString()}
                            </div>
                            <div className="text-slate-400 text-[11px] mt-0.5 font-mono">
                              {(b.sizeBytes / 1024 / 1024).toFixed(1)} MB • {b.name}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleDownloadBackup(b.name)}
                              className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-200 flex items-center gap-1.5 transition cursor-pointer text-xs font-semibold"
                              title={t.hostServerDownloadBackup || 'Download'}
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>{t.hostServerDownloadBackup || 'Download'}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRestoreBackup(b.name)}
                              disabled={restoringName === b.name}
                              className="px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/20 flex items-center gap-1.5 transition cursor-pointer text-xs font-semibold disabled:opacity-40"
                              title={t.hostServerRestoreBackup || 'Restore'}
                            >
                              {restoringName === b.name ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <RotateCcw className="w-3.5 h-3.5" />
                              )}
                              <span>{t.hostServerRestoreBackup || 'Khôi Phục'}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteBackup(b.name)}
                              className="p-1.5 rounded-lg text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 transition cursor-pointer"
                              title={t.hostServerDeleteBackup || 'Delete'}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* ======================================================== */}
              {/* TAB 5: QUẢN LÝ FILE (FILES - REMOTE HOST) */}
              {/* ======================================================== */}
              {activeTab === 'files' && selectedHost && (
                <div key="files" className="space-y-2 animate-tabSlideFade">
                  <RemoteFileBrowser host={selectedHost} language={language} />
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default HostServerView;
