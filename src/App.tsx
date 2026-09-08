import React, { useState, useEffect, useRef } from 'react';
import { TitleBar } from './components/layout/TitleBar';
import { Sidebar } from './components/layout/Sidebar';
import type { NavigationTab } from './components/layout/Sidebar';
import { ServerHub } from './components/home/ServerHub';
import { InstanceList } from './components/instances/InstanceList';
import { CreateInstanceModal } from './components/instances/CreateInstanceModal';
import { EditInstanceModal } from './components/instances/EditInstanceModal';
import { DeleteProfileModal } from './components/instances/DeleteProfileModal';
import { StorageCleanupModal } from './components/settings/StorageCleanupModal';
import { SkinStudio } from './components/skin/SkinStudio';
import { STEVE_SKIN_BASE64 } from './components/skin/presetSkins';
import defaultBgImage from './assets/1834105-final.png';
import { ModStore } from './components/mods/ModStore';
import { SettingsView, setPrewarmedJavaList } from './components/settings/SettingsView';
import { ConsoleModal } from './components/common/ConsoleModal';
import { OnboardingModal } from './components/onboarding/OnboardingModal';
import { BackgroundCustomizerModal } from './components/home/BackgroundCustomizerModal';
import type { GameInstance, Account, LauncherSettings, LaunchProgress, SavedServer } from './types';
import { invokeCommand, isTauri } from './services/api';
import { listen } from '@tauri-apps/api/event';
import type { Language } from './locales/i18n';
import { X } from 'lucide-react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
  componentStack?: string;
  confirmingReset: boolean;
  copied: boolean;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, confirmingReset: false, copied: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('MCL ErrorBoundary caught error:', error, info);
    this.setState({ componentStack: info.componentStack || undefined });
  }

  private buildReport() {
    return [
      this.state.error?.message || 'Unknown error',
      this.state.error?.stack || '',
      '--- Component stack ---',
      this.state.componentStack || '(unavailable)',
    ].join('\n');
  }

  private handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(this.buildReport());
      this.setState({ copied: true });
    } catch (err) {
      console.warn('Clipboard unavailable:', err);
    }
  };

  private handleResetData = () => {
    if (!this.state.confirmingReset) {
      this.setState({ confirmingReset: true });
      return;
    }
    try {
      Object.keys(localStorage)
        .filter((key) => key.startsWith('mcl_'))
        .forEach((key) => localStorage.removeItem(key));
    } catch (err) {
      console.warn('Failed to clear local data:', err);
    }
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-screen w-screen bg-[#0a0a0a] text-white p-8 select-none">
          <div className="max-w-lg w-full minimal-panel p-8 rounded-2xl border border-white/10 text-center space-y-4 shadow-2xl">
            <div className="w-12 h-12 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center mx-auto text-xl font-bold">
              ⚠️
            </div>
            <h2 className="text-xl font-bold font-riot">Application Interface Error</h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              Encountered issue: <span className="font-mono text-amber-300">{this.state.error?.message}</span>
            </p>

            <pre className="text-left text-[10px] leading-relaxed font-mono text-slate-500 bg-black/40 border border-white/5 rounded-xl p-3 max-h-44 overflow-auto whitespace-pre-wrap select-text">
              {this.buildReport()}
            </pre>

            <div className="flex items-center justify-center gap-3 pt-1">
              <button
                onClick={() => {
                  this.setState({ hasError: false });
                  window.location.reload();
                }}
                className="btn-primary px-5 py-2.5 rounded-xl text-xs font-bold font-riot cursor-pointer"
              >
                Reload App
              </button>
              <button
                onClick={this.handleCopy}
                className="px-5 py-2.5 rounded-xl text-xs font-bold bg-white/10 hover:bg-white/20 border border-white/10 text-white transition cursor-pointer"
              >
                {this.state.copied ? 'Copied' : 'Copy Details'}
              </button>
            </div>

            <div className="pt-1 space-y-2">
              <button
                onClick={this.handleResetData}
                className="px-4 py-2 rounded-xl text-[11px] font-bold bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 transition cursor-pointer"
              >
                {this.state.confirmingReset ? 'Confirm: Erase Local Data' : 'Reset Local Data'}
              </button>
              {this.state.confirmingReset && (
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  Deletes saved profiles, servers, skins and settings stored by this launcher, then restarts it.
                  Downloaded game files are not affected.
                </p>
              )}
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function readStoredJson<T>(key: string, fallback: T): T {
  try {
    const saved = localStorage.getItem(key);
    return saved ? (JSON.parse(saved) as T) : fallback;
  } catch (err) {
    console.warn(`Discarding corrupted localStorage entry "${key}":`, err);
    return fallback;
  }
}

// Bump when the shape of persisted mcl_* data changes, and add the matching step below.
const STORAGE_SCHEMA_VERSION = 1;

export function runStorageMigrations() {
  try {
    const raw = localStorage.getItem('mcl_schema_version');
    // Data written before versioning existed already matches the current shape
    const stored = raw === null ? STORAGE_SCHEMA_VERSION : Number(raw);

    if (stored > STORAGE_SCHEMA_VERSION) {
      console.warn(`Local data comes from a newer launcher (v${stored}); leaving it untouched.`);
      return;
    }

    // Steps run in order, each upgrading from the version before it:
    // if (stored < 2) { ...reshape mcl_instances... }

    if (String(stored) !== raw) {
      localStorage.setItem('mcl_schema_version', String(STORAGE_SCHEMA_VERSION));
    }
  } catch (err) {
    console.warn('Storage migration skipped:', err);
  }
}

// Custom backgrounds are stored inline as data URIs, so writes can exceed the storage quota
function writeStoredJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn(`Failed to persist localStorage entry "${key}":`, err);
  }
}

const DEFAULT_INSTANCES: GameInstance[] = [];

const DEFAULT_SERVERS: SavedServer[] = [];

const DEFAULT_ACCOUNT: Account = {
  id: 'acc-01',
  username: 'Player_Hero',
  type: 'offline',
  skinUrl: STEVE_SKIN_BASE64,
  skinModel: 'classic',
  uuid: '8667ba71-b85a-4004-af54-457a9734eed7',
  active: true,
};

const DEFAULT_SETTINGS: LauncherSettings = {
  defaultMinRam: 2048,
  defaultMaxRam: 4096,
  defaultJvmArgs: '-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200',
  language: 'en',
  uiStyle: 'riot',
  colorPalette: 'rose',
  bgType: 'image',
  customBgImage: defaultBgImage,
  bgOpacity: 0.3,
  closeOnLaunch: false,
  enableDiscordRpc: true,
  serverHost: '',
  serverPort: 25565,
  serverName: '',
};

export const App: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<NavigationTab>('home');
  const [instances, setInstances] = useState<GameInstance[]>(() =>
    readStoredJson('mcl_instances', DEFAULT_INSTANCES)
  );
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>(instances[0]?.id || 'server-instance-01');

  // Multi-server state
  const [savedServers, setSavedServers] = useState<SavedServer[]>(() =>
    readStoredJson('mcl_servers', DEFAULT_SERVERS)
  );
  const [activeServerId, setActiveServerId] = useState<string>(() => {
    return localStorage.getItem('mcl_active_server') || savedServers[0]?.id || 'srv-01';
  });
  const [directConnectServer, setDirectConnectServer] = useState<boolean>(() => {
    return localStorage.getItem('mcl_direct_connect') === 'true';
  });

  const [account, setAccount] = useState<Account>(() => {
    const acc = readStoredJson('mcl_account', DEFAULT_ACCOUNT);
    if (
      acc &&
      (!acc.skinUrl ||
        acc.skinUrl.includes('textures.minecraft.net') ||
        acc.skinUrl === '/skins/steve.png')
    ) {
      acc.skinUrl = STEVE_SKIN_BASE64;
    }
    return acc;
  });
  const [settings, setSettings] = useState<LauncherSettings>(() => {
    const parsed = readStoredJson('mcl_settings', DEFAULT_SETTINGS);
    const bgOpacity =
      parsed.bgOpacity !== undefined && parsed.bgOpacity !== 0.5 && parsed.bgOpacity !== 0.55
        ? parsed.bgOpacity
        : 0.3;
    const validPalettes = ['indigo', 'emerald', 'amber', 'rose', 'cyan', 'slate'];
    const colorPalette = validPalettes.includes(parsed.colorPalette) ? parsed.colorPalette : 'rose';
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      colorPalette,
      bgOpacity,
      language: 'en',
      bgType: parsed.bgType || (parsed.customBgImage ? 'image' : 'video'),
    };
  });

  const [language, setLanguage] = useState<Language>(() => {
    const saved = localStorage.getItem('mcl_lang') as Language;
    return saved || 'en';
  });

  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState<boolean>(() => {
    return localStorage.getItem('mcl_onboarding_completed') === 'true';
  });
  const [defaultGameDir, setDefaultGameDir] = useState<string>('');

  // Modal states
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingInstance, setEditingInstance] = useState<GameInstance | null>(null);
  const [deleteTargetInstance, setDeleteTargetInstance] = useState<GameInstance | null>(null);
  const [isStorageCleanupModalOpen, setIsStorageCleanupModalOpen] = useState(false);
  const [isConsoleOpen, setIsConsoleOpen] = useState(false);
  const [isBackgroundModalOpen, setIsBackgroundModalOpen] = useState(false);

  // Runtime states
  const [isRunning, setIsRunning] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [consoleLogs, setConsoleLogs] = useState<string[]>([]);
  const [launchProgress, setLaunchProgress] = useState<LaunchProgress>({
    stage: 'idle',
    percentage: 0,
    currentFile: '',
    downloadedBytes: 0,
    totalBytes: 0,
    speedBps: 0,
  });

  // Save to localStorage
  useEffect(() => {
    localStorage.setItem('mcl_instances', JSON.stringify(instances));
  }, [instances]);

  useEffect(() => {
    localStorage.setItem('mcl_servers', JSON.stringify(savedServers));
  }, [savedServers]);

  useEffect(() => {
    localStorage.setItem('mcl_active_server', activeServerId);
  }, [activeServerId]);

  useEffect(() => {
    localStorage.setItem('mcl_direct_connect', directConnectServer.toString());
  }, [directConnectServer]);

  useEffect(() => {
    try {
      localStorage.setItem('mcl_account', JSON.stringify(account));
    } catch (err) {
      console.warn('Failed to save account to localStorage:', err);
    }
  }, [account]);

  useEffect(() => {
    writeStoredJson('mcl_settings', settings);
  }, [settings]);

  const videoRef = useRef<HTMLVideoElement>(null);

  // Ensure video auto-plays when active
  useEffect(() => {
    if (settings.bgType !== 'image' && videoRef.current) {
      videoRef.current.defaultMuted = true;
      videoRef.current.muted = true;
      const playPromise = videoRef.current.play();
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          console.log('Video autoplay handled:', err);
        });
      }
    }
  }, [settings.bgType, settings.customVideoUrl]);

  // Apply configured window dimensions, disable shadow and center window
  useEffect(() => {
    if (isTauri()) {
      const configureWindow = async () => {
        try {
          const targetRes = settings.windowResolution || '1600x900';
          const [w, h] = targetRes.split('x').map(Number);
          await invokeCommand('set_window_size', { width: w || 1600, height: h || 900 });
        } catch (err) {
          console.warn('Error applying window settings:', err);
        }
      };
      configureWindow();
    }
  }, [settings.windowResolution]);

  // Load instances from backend if in Tauri & pre-warm Java detection in background
  useEffect(() => {
    const initBackend = async () => {
      if (isTauri()) {
        try {
          const list = await invokeCommand<GameInstance[]>('get_instances');
          if (list && list.length > 0) {
            setInstances(list);
          }
        } catch (err) {
          console.warn('Backend instances fallback:', err);
        }

        // Pre-warm Java detection in background so Settings opens instantly with zero delay
        invokeCommand<any[]>('detect_java')
          .then((javas) => {
            if (javas && javas.length > 0) {
              setPrewarmedJavaList(javas);
            }
          })
          .catch(() => {});

        // Fetch current default game data directory
        invokeCommand<string>('get_game_data_dir')
          .then((dir) => {
            if (dir) setDefaultGameDir(dir);
          })
          .catch(console.warn);
      }
    };
    initBackend();
  }, []);

  // Profile management handlers
  const handleCreateInstance = (newInstData: Partial<GameInstance>) => {
    const newInstance: GameInstance = {
      id: `instance-${Date.now()}`,
      name: newInstData.name || 'Minecraft Profile',
      gameVersion: newInstData.gameVersion || '1.21.4',
      loader: newInstData.loader || 'fabric',
      loaderVersion: newInstData.loaderVersion,
      minRam: newInstData.minRam || settings.defaultMinRam,
      maxRam: newInstData.maxRam || settings.defaultMaxRam,
      jvmArgs: settings.defaultJvmArgs,
      icon: newInstData.icon || 'grass',
      enableSkinInGame: newInstData.enableSkinInGame ?? true,
      lastPlayed: 'Just created',
      totalPlayTime: 0,
      customDir: newInstData.customDir,
    };

    const updated = [newInstance, ...instances];
    setInstances(updated);
    setSelectedInstanceId(newInstance.id);

    if (isTauri()) {
      invokeCommand('save_instances', { instances: updated }).catch(console.warn);
    }
  };

  const handleChangeDefaultGameDir = async () => {
    if (!isTauri()) return;
    try {
      const chosen = await invokeCommand<string | null>('select_folder', {
        defaultPath: defaultGameDir || undefined,
      });
      if (chosen) {
        await invokeCommand('set_game_data_dir', { path: chosen });
        setDefaultGameDir(chosen);
        setSettings((s) => ({ ...s, gameDataDir: chosen }));
      }
    } catch (err) {
      console.error('Failed to change default game dir:', err);
    }
  };

  const handleOpenDefaultGameDir = () => {
    if (isTauri()) {
      invokeCommand('open_instance_dir', { instanceId: '' }).catch(console.warn);
    }
  };

  const handleCompleteOnboarding = (updatedSettings: Partial<LauncherSettings>) => {
    setHasCompletedOnboarding(true);
    localStorage.setItem('mcl_onboarding_completed', 'true');
    if (updatedSettings.gameDataDir) {
      setDefaultGameDir(updatedSettings.gameDataDir);
    }
    setSettings((s) => ({
      ...s,
      ...updatedSettings,
      hasCompletedOnboarding: true,
    }));
  };

  const handleEditInstance = (inst: GameInstance) => {
    setEditingInstance(inst);
    setIsEditModalOpen(true);
  };

  const handleSaveEditedInstance = (updated: GameInstance) => {
    const list = instances.map((i) => (i.id === updated.id ? updated : i));
    setInstances(list);
    if (isTauri()) {
      invokeCommand('save_instances', { instances: list }).catch(console.warn);
    }
  };

  const handleConfirmDeleteInstance = async (instanceId: string, deleteVersionFiles: boolean) => {
    if (isTauri()) {
      try {
        await invokeCommand('delete_instance', { instanceId, deleteVersionFiles });
      } catch (err) {
        console.error('Error deleting instance:', err);
      }
    }
    const remaining = instances.filter((i) => i.id !== instanceId);
    setInstances(remaining);
    if (selectedInstanceId === instanceId) {
      setSelectedInstanceId(remaining[0]?.id || '');
    }
  };

  const handleOpenInstanceDir = (id: string) => {
    if (isTauri()) {
      invokeCommand('open_instance_dir', { instanceId: id }).catch(console.warn);
    }
  };

  // Server management handlers
  const handleAddServer = (srvData: Omit<SavedServer, 'id'>) => {
    const newSrv: SavedServer = {
      ...srvData,
      id: `srv-${Date.now()}`,
    };
    setSavedServers((prev) => [...prev, newSrv]);
    setActiveServerId(newSrv.id);
  };

  const handleUpdateServer = (updated: SavedServer) => {
    setSavedServers((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  };

  const handleDeleteServer = (id: string) => {
    setSavedServers((prev) => {
      const rem = prev.filter((s) => s.id !== id);
      if (activeServerId === id) {
        setActiveServerId(rem[0]?.id || '');
      }
      return rem;
    });
  };

  const handleUpdateUsername = (newName: string) => {
    setAccount((prev) => ({ ...prev, username: newName }));
  };

  const handleUpdateSkin = (skinUrl: string, model: 'classic' | 'slim') => {
    setAccount((prev) => ({ ...prev, skinUrl, skinModel: model }));
  };

  // Listen to Tauri native events
  useEffect(() => {
    if (!isTauri()) return;
    let unlistenProgress: (() => void) | undefined;
    let unlistenLogs: (() => void) | undefined;
    let unlistenStarted: (() => void) | undefined;
    let unlistenExit: (() => void) | undefined;
    let unlistenCrash: (() => void) | undefined;

    const setupListeners = async () => {
      try {
        unlistenProgress = await listen<LaunchProgress>('download-progress', (event) => {
          setLaunchProgress((prev) => {
            const nextPercent = Math.max(prev.percentage || 0, event.payload.percentage || 0);
            return {
              ...event.payload,
              percentage: nextPercent,
            };
          });
          if (event.payload.stage === 'error') {
            setIsPreparing(false);
          }
        });

        unlistenLogs = await listen<string>('mc-log', (event) => {
          setConsoleLogs((prev) => [...prev, event.payload]);
        });

        unlistenStarted = await listen<number>('game-started', () => {
          setIsRunning(true);
          setIsPreparing(false);
        });

        // Auto-open console when game crashes
        unlistenCrash = await listen<number>('game-crash', () => {
          setIsConsoleOpen(true);
        });

        unlistenExit = await listen('game-exit', () => {
          setIsRunning(false);
          setIsPreparing(false);
          setLaunchProgress({ stage: 'idle', percentage: 0, currentFile: '', downloadedBytes: 0, totalBytes: 0, speedBps: 0 });
          setConsoleLogs((prev) => [
            ...prev,
            `[${new Date().toLocaleTimeString()}] [MCL/INFO] Minecraft process exited.`,
          ]);
        });
      } catch (err) {
        console.warn('Tauri event listener setup:', err);
      }
    };

    setupListeners();

    return () => {
      unlistenProgress?.();
      unlistenLogs?.();
      unlistenStarted?.();
      unlistenExit?.();
      unlistenCrash?.();
    };
  }, []);

  // Launch Engine Handler
  const handleLaunch = async () => {
    const targetInstance = instances.find((i) => i.id === selectedInstanceId) || instances[0];
    if (!targetInstance) {
      setIsCreateModalOpen(true);
      return;
    }

    const currentServer = savedServers.find((s) => s.id === activeServerId) || savedServers[0];

    // Inject direct connect server IP and port if user enabled directConnectServer
    const launchData: GameInstance = {
      ...targetInstance,
      serverIp: directConnectServer && currentServer ? currentServer.ip : targetInstance.serverIp,
      serverPort: directConnectServer && currentServer ? currentServer.port : targetInstance.serverPort,
    };

    setIsRunning(false);
    setIsPreparing(true);
    setConsoleLogs([
      `[${new Date().toLocaleTimeString()}] [MCL/INFO] Launching profile: ${launchData.name} (Minecraft ${launchData.gameVersion})`,
      `[${new Date().toLocaleTimeString()}] [MCL/INFO] Player: ${account.username} (${account.type.toUpperCase()})`,
      `[${new Date().toLocaleTimeString()}] [MCL/INFO] Allocated RAM: ${launchData.maxRam} MB`,
      ...(directConnectServer && currentServer
        ? [`[${new Date().toLocaleTimeString()}] [MCL/INFO] Direct connect configured: ${currentServer.name} (${currentServer.ip}:${currentServer.port})`]
        : []),
    ]);

    setLaunchProgress({
      stage: 'preparing',
      percentage: 5,
      currentFile: 'Connecting to Mojang CDN and verifying assets...',
      downloadedBytes: 0,
      totalBytes: 0,
      speedBps: 0,
    });

    if (isTauri()) {
      try {
        await invokeCommand('launch_instance', {
          instanceId: launchData.id,
          username: account.username,
          instanceData: launchData,
        });
      } catch (err: any) {
        setIsPreparing(false);
        setConsoleLogs((prev) => [
          ...prev,
          `[${new Date().toLocaleTimeString()}] [MCL/ERROR] ${err?.toString() || 'Launch failed'}`,
        ]);
        setLaunchProgress({ stage: 'idle', percentage: 0, currentFile: '', downloadedBytes: 0, totalBytes: 0, speedBps: 0 });
        setIsRunning(false);
      }
    } else {
      // Browser preview simulation
      setLaunchProgress({ stage: 'downloading', percentage: 35, currentFile: `client-${launchData.gameVersion}.jar`, downloadedBytes: 25000000, totalBytes: 42000000, speedBps: 8500000 });
      await new Promise((r) => setTimeout(r, 800));
      setLaunchProgress({ stage: 'verifying', percentage: 70, currentFile: 'Verifying SHA-1 hashes...', downloadedBytes: 42000000, totalBytes: 42000000, speedBps: 0 });
      await new Promise((r) => setTimeout(r, 700));
      setLaunchProgress({ stage: 'running', percentage: 100, currentFile: 'Running', downloadedBytes: 0, totalBytes: 0, speedBps: 0 });
      setIsRunning(true);
      setIsPreparing(false);
    }
  };

  // Stop Game Handler
  const handleStopGame = async () => {
    if (isTauri()) {
      try {
        await invokeCommand('kill_game');
      } catch (err) {
        console.warn('Kill game error:', err);
      }
    }
    setIsRunning(false);
    setLaunchProgress({ stage: 'idle', percentage: 0, currentFile: '', downloadedBytes: 0, totalBytes: 0, speedBps: 0 });
    setConsoleLogs((prev) => [
      ...prev,
      `[${new Date().toLocaleTimeString()}] [MCL/INFO] Sent stop game command.`,
    ]);
  };

  // Cancel Download Handler
  const handleCancelDownload = async () => {
    if (isTauri()) {
      try {
        await invokeCommand('cancel_download');
      } catch (err) {
        console.warn('Cancel download error:', err);
      }
    }
    setIsPreparing(false);
    setLaunchProgress({ stage: 'idle', percentage: 0, currentFile: '', downloadedBytes: 0, totalBytes: 0, speedBps: 0 });
    setConsoleLogs((prev) => [
      ...prev,
      `[${new Date().toLocaleTimeString()}] [MCL/INFO] Download cancelled.`,
    ]);
  };

  const handleChangeLanguage = (lang: Language) => {
    setLanguage(lang);
    localStorage.setItem('mcl_lang', lang);
    setSettings((s) => ({ ...s, language: lang }));
  };

  const handleUpdateBackground = (patch: Partial<LauncherSettings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      writeStoredJson('mcl_settings', next);
      return next;
    });
  };

  const handleSaveSettings = (newSettings: LauncherSettings) => {
    setSettings(newSettings);
    if (newSettings.language && newSettings.language !== language) {
      setLanguage(newSettings.language);
      localStorage.setItem('mcl_lang', newSettings.language);
    }
  };

  const activeInstance = instances.find((i) => i.id === selectedInstanceId) || instances[0];

  return (
    <ErrorBoundary>
      <div
        className={`relative flex flex-col h-screen w-screen overflow-hidden font-sans select-none theme-dark bg-[#0a0a0a] text-slate-100 style-riot palette-${settings.colorPalette || 'amber'} ${settings.reduceMotion ? 'reduce-motion' : ''} window-shell`}
      >
        {/* Dynamic Background Media: Persistent across all modals for seamless cinematic look */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
          <div className="absolute inset-0 bg-[#0a0a0a]" />

          {settings.bgType === 'image' && settings.customBgImage ? (
            <img
              src={settings.customBgImage}
              alt="Launcher Background"
              className="w-full h-full object-cover select-none relative z-1"
              style={{ filter: settings.bgBlur ? `blur(${settings.bgBlur}px)` : undefined, transform: settings.bgBlur ? 'scale(1.04)' : undefined }}
            />
          ) : (
            <video
              ref={videoRef}
              src={settings.customVideoUrl || '/cinematic_bg.mp4'}
              autoPlay
              loop
              muted
              playsInline
              className="w-full h-full object-cover select-none relative z-1"
              style={{ filter: settings.bgBlur ? `blur(${settings.bgBlur}px)` : undefined, transform: settings.bgBlur ? 'scale(1.04)' : undefined }}
            />
          )}

          {/* Contrast & Tint Overlays */}
          <div
            className="absolute inset-0 bg-black z-2 pointer-events-none"
            style={{ opacity: settings.bgOpacity ?? 0.3 }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent z-3 pointer-events-none" />
        </div>

        {/* Outer App Frame: Vertical Sidebar + Main Canvas */}
        <div className="relative z-10 flex h-full w-full overflow-hidden">
          {/* Riot-Style Vertical Left Sidebar: ALWAYS rendered and interactive */}
          <Sidebar
            currentTab={currentTab}
            onTabChange={(tab) => setCurrentTab(tab)}
            account={account}
            onUpdateUsername={handleUpdateUsername}
            onUpdateAccount={setAccount}
            language={language}
          />

          {/* Right Main Content Area: Hosts persistent Home canvas and overlays */}
          <div className="flex-1 flex flex-col h-full overflow-hidden bg-transparent relative">
            {/* Frameless TitleBar */}
            <TitleBar
              onOpenConsole={() => setIsConsoleOpen(true)}
              isRunning={isRunning}
              language={language}
              onChangeLanguage={handleChangeLanguage}
            />

            {/* Persistent Home Screen Canvas */}
            <main className="flex-1 flex overflow-hidden bg-transparent relative">
              <ServerHub
                instances={instances}
                selectedInstanceId={selectedInstanceId}
                onSelectInstance={setSelectedInstanceId}
                onLaunch={handleLaunch}
                onStopGame={handleStopGame}
                onCancelDownload={handleCancelDownload}
                launchProgress={launchProgress}
                isRunning={isRunning}
                isPreparing={isPreparing}
                language={language}
                onOpenCreateModal={() => setIsCreateModalOpen(true)}
                onOpenBackgroundModal={() => setIsBackgroundModalOpen(true)}
                savedServers={savedServers}
                activeServerId={activeServerId}
                onSelectActiveServer={setActiveServerId}
                onAddServer={handleAddServer}
                onUpdateServer={handleUpdateServer}
                onDeleteServer={handleDeleteServer}
                directConnectServer={directConnectServer}
                onToggleDirectConnectServer={setDirectConnectServer}
              />
            </main>

            {/* Secondary Menus Rendered as Floating Overlay Popups over Home ONLY in Right Area */}
            {/* Sidebar on left remains 100% visible and interactive! Backdrop is subtle (bg-black/25) */}
            {currentTab !== 'home' && (
              <div
                className="absolute inset-0 z-40 flex items-center justify-center p-6 sm:p-8 bg-black/25 backdrop-blur-[2px] animate-modalBackdrop"
                onClick={() => setCurrentTab('home')}
              >
                <div
                  className="w-full max-w-6xl h-[92vh] rounded-3xl bg-[#111111]/95 border border-white/10 shadow-2xl backdrop-blur-xl flex flex-col overflow-hidden animate-modalScale relative modal-popup-window"
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Floating Close Button - Styled as requested: rounded dark square with bold white X */}
                  <button
                    onClick={() => setCurrentTab('home')}
                    title="Close Window (Return to Home)"
                    aria-label="Close"
                    className="absolute top-5 right-6 z-30 w-9 h-9 rounded-xl bg-[#2a2b2f]/90 hover:bg-[#383a40] text-white border border-white/10 shadow-lg flex items-center justify-center transition-all duration-150 active:scale-90 cursor-pointer"
                  >
                    <X className="w-4 h-4 text-white" strokeWidth={3} />
                  </button>

                  {/* Overlay Window Body Content with Smooth Tab Transition */}
                  <div className="flex-1 flex overflow-hidden relative">
                    <div key={currentTab} className="w-full h-full flex animate-tabSlideFade overflow-hidden">
                      {currentTab === 'instances' && (
                        <InstanceList
                          instances={instances}
                          selectedInstanceId={selectedInstanceId}
                          onSelectInstance={setSelectedInstanceId}
                          onLaunchInstance={(id) => {
                            setSelectedInstanceId(id);
                            setCurrentTab('home');
                            handleLaunch();
                          }}
                          onEditInstance={handleEditInstance}
                          onRequestDeleteInstance={(inst) => setDeleteTargetInstance(inst)}
                          onOpenInstanceDir={handleOpenInstanceDir}
                          onOpenCreateModal={() => setIsCreateModalOpen(true)}
                          onOpenCleanStorageModal={() => setIsStorageCleanupModalOpen(true)}
                          isRunning={isRunning}
                          defaultGameDir={defaultGameDir}
                          onChangeDefaultGameDir={handleChangeDefaultGameDir}
                          onOpenDefaultGameDir={handleOpenDefaultGameDir}
                          language={language}
                        />
                      )}

                      {currentTab === 'mods' && (
                        <ModStore
                          activeInstance={activeInstance}
                          instances={instances}
                          onSelectInstance={(id) => setSelectedInstanceId(id)}
                          onOpenCreateModal={() => setIsCreateModalOpen(true)}
                          onOpenInstanceDir={handleOpenInstanceDir}
                          onModpackInstalled={(newInstance) => {
                            setInstances((prev) => [newInstance, ...prev.filter((i) => i.id !== newInstance.id)]);
                            setSelectedInstanceId(newInstance.id);
                          }}
                          language={language}
                          curseForgeApiKey={settings.curseForgeApiKey}
                        />
                      )}

                      {currentTab === 'skin' && (
                        <SkinStudio
                          account={account}
                          onUpdateSkin={handleUpdateSkin}
                          instances={instances}
                          language={language}
                        />
                      )}

                      {currentTab === 'settings' && (
                        <SettingsView
                          settings={settings}
                          onSaveSettings={handleSaveSettings}
                          language={language}
                        />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Sub Modals */}
          <CreateInstanceModal
            isOpen={isCreateModalOpen}
            onClose={() => setIsCreateModalOpen(false)}
            onCreate={handleCreateInstance}
            defaultGameDir={defaultGameDir}
            language={language}
          />

          <EditInstanceModal
            isOpen={isEditModalOpen}
            onClose={() => setIsEditModalOpen(false)}
            instance={editingInstance}
            onSave={handleSaveEditedInstance}
            onOpenDir={handleOpenInstanceDir}
            language={language}
          />

          <ConsoleModal
            isOpen={isConsoleOpen}
            onClose={() => setIsConsoleOpen(false)}
            logs={consoleLogs}
            onClearLogs={() => setConsoleLogs([])}
            language={language}
          />

          <DeleteProfileModal
            isOpen={!!deleteTargetInstance}
            instance={deleteTargetInstance}
            allInstances={instances}
            onClose={() => setDeleteTargetInstance(null)}
            onConfirmDelete={handleConfirmDeleteInstance}
            language={language}
          />

          <StorageCleanupModal
            isOpen={isStorageCleanupModalOpen}
            onClose={() => setIsStorageCleanupModalOpen(false)}
            language={language}
          />

          <BackgroundCustomizerModal
            isOpen={isBackgroundModalOpen}
            onClose={() => setIsBackgroundModalOpen(false)}
            settings={settings}
            onUpdateSettings={handleUpdateBackground}
            language={language}
          />

          <OnboardingModal
            isOpen={!hasCompletedOnboarding}
            onComplete={handleCompleteOnboarding}
            currentLanguage={language}
            onLanguageChange={(lang) => {
              setLanguage(lang);
              localStorage.setItem('mcl_lang', lang);
              setSettings((s) => ({ ...s, language: lang }));
            }}
          />
        </div>
      </div>
    </ErrorBoundary>
  );
};

export default App;
