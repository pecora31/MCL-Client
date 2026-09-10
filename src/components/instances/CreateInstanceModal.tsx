import React, { useState, useEffect, useMemo } from 'react';
import { X, Layers, Plus, ChevronDown, AlertCircle, HardDrive, FolderOpen } from 'lucide-react';
import type { ModLoader, GameInstance, VersionItem, SystemInfo, JavaInstallation } from '../../types';
import {
  fetchMojangVersions,
  fetchFabricVersions,
  fetchQuiltVersions,
  fetchForgeVersions,
  fetchNeoForgeVersions,
  invokeCommand,
  isTauri,
} from '../../services/api';
import { getTranslation, type Language } from '../../locales/i18n';
import { ToggleSwitch } from '../common/ToggleSwitch';
import { CustomSelect, type SelectOption } from '../common/CustomSelect';
import { GameWindowSelector } from './GameWindowSelector';

interface CreateInstanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (instance: Partial<GameInstance>) => void;
  defaultGameDir?: string;
  language?: Language;
}

export const CreateInstanceModal: React.FC<CreateInstanceModalProps> = ({
  isOpen,
  onClose,
  onCreate,
  defaultGameDir,
  language = 'en',
}) => {
  const t = getTranslation(language);
  const [name, setName] = useState('');
  const [gameVersion, setGameVersion] = useState('1.21.4');
  const [loader, setLoader] = useState<ModLoader>('fabric');
  const [loaderVersion, setLoaderVersion] = useState('');
  const [minRam, setMinRam] = useState(2048);
  const [maxRam, setMaxRam] = useState(4096);
  const [enableSkinInGame, setEnableSkinInGame] = useState(true);
  const [useCustomDir, setUseCustomDir] = useState(false);
  const [customDirPath, setCustomDirPath] = useState('');
  const [isBrowsingDir, setIsBrowsingDir] = useState(false);
  // Once the player types their own name, auto-naming from version/loader stops
  // overwriting it — otherwise picking a loader after typing a name reset it.
  const [nameManuallyEdited, setNameManuallyEdited] = useState(false);

  const [windowWidth, setWindowWidth] = useState('');
  const [windowHeight, setWindowHeight] = useState('');
  const [fullscreen, setFullscreen] = useState(false);

  const [versionList, setVersionList] = useState<VersionItem[]>([]);
  const [loaderVersions, setLoaderVersions] = useState<string[]>([]);
  const [isLoadingLoaders, setIsLoadingLoaders] = useState(false);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [javaList, setJavaList] = useState<JavaInstallation[]>([]);
  const [javaPath, setJavaPath] = useState('');

  // Read the machine's specs so RAM cannot be set beyond what it actually has
  useEffect(() => {
    if (!isOpen) return;
    invokeCommand<SystemInfo>('get_system_info')
      .then((info) => {
        setSystemInfo(info);
        setMaxRam((current) => Math.min(current, info.recommendedMaxRamMb));
      })
      .catch((err) => console.warn('Could not read system info:', err));
    invokeCommand<JavaInstallation[]>('detect_java')
      .then((list) => setJavaList(list || []))
      .catch((err) => console.warn('Could not detect Java:', err));
  }, [isOpen]);

  // Load Mojang versions
  useEffect(() => {
    if (!isOpen) return;
    const loadVersions = async () => {
      try {
        const data = await fetchMojangVersions();
        setVersionList(data.versions);
        if (data.latest?.release) {
          setGameVersion(data.latest.release);
          setName(`Minecraft ${data.latest.release}`);
        }
      } catch (err) {
        console.error('Failed to fetch versions:', err);
      }
    };
    loadVersions();
  }, [isOpen]);

  // Load Loader versions when game version or loader changes
  useEffect(() => {
    if (!isOpen) return;
    const loadLoaders = async () => {
      const fetchers: Partial<Record<ModLoader, () => Promise<string[]>>> = {
        fabric: () => fetchFabricVersions(gameVersion),
        quilt: () => fetchQuiltVersions(gameVersion),
        forge: () => fetchForgeVersions(gameVersion),
        neoforge: () => fetchNeoForgeVersions(gameVersion),
      };
      const fetcher = fetchers[loader];
      if (!fetcher) {
        setLoaderVersions([]);
        setLoaderVersion('');
        return;
      }
      setIsLoadingLoaders(true);
      try {
        const versions = await fetcher();
        setLoaderVersions(versions);
        setLoaderVersion(versions[0] ?? '');
      } catch (err) {
        console.error(`Failed to fetch ${loader} versions:`, err);
        setLoaderVersions([]);
        setLoaderVersion('');
      } finally {
        setIsLoadingLoaders(false);
      }
    };
    loadLoaders();
  }, [isOpen, gameVersion, loader]);

  // Auto-name instance when version changes
  const handleVersionChange = (newVer: string) => {
    setGameVersion(newVer);
    if (!nameManuallyEdited) {
      setName(`Minecraft ${newVer} ${loader !== 'vanilla' ? `(${loader.toUpperCase()})` : ''}`.trim());
    }
  };

  const handleLoaderChange = (newLoader: ModLoader) => {
    setLoader(newLoader);
    if (!nameManuallyEdited) {
      setName(`Minecraft ${gameVersion} ${newLoader !== 'vanilla' ? `(${newLoader.toUpperCase()})` : ''}`.trim());
    }
  };

  // Mirrors required_java_major() in src-tauri/src/java_detector.rs, which is what the
  // launcher actually enforces — keep the two in step. Minecraft moved from "1.X.Y" to a
  // "<year>.<drop>" scheme starting with 26.1, which also bumped the bundled JDK to 25.
  const getRecommendedJava = () => {
    const parts = gameVersion.split('.').map(Number);
    const major = parts[0] || 0;
    const minor = parts[1] || 0;
    const patch = parts[2] || 0;

    if (major === 1) {
      if (minor < 17) return 'Java 8';
      if (minor < 20) return 'Java 17 LTS';
      if (minor === 20 && patch <= 4) return 'Java 17 LTS';
      return 'Java 21 LTS'; // 1.20.5-1.21.11, the last releases under the old scheme
    }
    return 'Java 25 LTS'; // 26.1+, verified against the real 26.1 and 26.2 releases
  };

  useEffect(() => {
    if (isOpen) {
      setUseCustomDir(false);
      setCustomDirPath('');
      setNameManuallyEdited(false);
      setWindowWidth('');
      setWindowHeight('');
      setFullscreen(false);
    }
  }, [isOpen]);

  const handleBrowseFolder = async () => {
    if (isTauri()) {
      setIsBrowsingDir(true);
      try {
        const chosen = await invokeCommand<string | null>('select_folder', {
          defaultPath: customDirPath || defaultGameDir || null,
        });
        if (chosen) {
          setCustomDirPath(chosen);
        }
      } catch (err) {
        console.error('Failed to select folder:', err);
      } finally {
        setIsBrowsingDir(false);
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (loader !== 'vanilla' && !loaderVersion) return;
    let finalW = Number(windowWidth) || undefined;
    let finalH = Number(windowHeight) || undefined;
    if (finalW && finalW < 640) finalW = 640;
    if (finalH && finalH < 480) finalH = 480;

    onCreate({
      name: name.trim() || `Minecraft ${gameVersion}`,
      gameVersion,
      loader,
      loaderVersion: loader !== 'vanilla' ? loaderVersion : undefined,
      minRam,
      maxRam,
      javaPath: javaPath || undefined,
      windowWidth: finalW,
      windowHeight: finalH,
      fullscreen: fullscreen || undefined,
      enableSkinInGame,
      icon: loader === 'fabric' ? 'fabric' : loader === 'forge' ? 'forge' : 'grass',
      customDir: useCustomDir && customDirPath.trim() ? customDirPath.trim() : undefined,
    });
    onClose();
  };

  const filteredVersions = useMemo(
    () => versionList.filter((v) => showSnapshots || v.type === 'release'),
    [versionList, showSnapshots]
  );

  const versionOptions = useMemo<SelectOption<string>[]>(() => {
    if (filteredVersions.length > 0) {
      return filteredVersions.map((v) => ({
        value: v.id,
        label: `Minecraft ${v.id}`,
        badge: v.type === 'release' ? 'Release' : v.type,
      }));
    }
    return [
      { value: '1.21.4', label: 'Minecraft 1.21.4', badge: 'Release' },
      { value: '1.21.1', label: 'Minecraft 1.21.1', badge: 'Release' },
      { value: '1.20.1', label: 'Minecraft 1.20.1', badge: 'Release' },
      { value: '1.19.4', label: 'Minecraft 1.19.4', badge: 'Release' },
      { value: '1.16.5', label: 'Minecraft 1.16.5', badge: 'Release' },
    ];
  }, [filteredVersions]);

  const loaderVersionOptions = useMemo<SelectOption<string>[]>(() => {
    if (loaderVersions.length === 0) {
      return [
        {
          value: '',
          label: isLoadingLoaders
            ? 'Loading versions...'
            : `No ${loader.toUpperCase()} build for ${gameVersion}`,
          disabled: true,
        },
      ];
    }
    return loaderVersions.map((ver, idx) => ({
      value: ver,
      label: ver,
      badge: idx === 0 ? 'Latest' : undefined,
    }));
  }, [loaderVersions, isLoadingLoaders, loader, gameVersion]);

  const javaOptions = useMemo<SelectOption<string>[]>(() => {
    const defaultOpt: SelectOption<string> = {
      value: '',
      label: 'Automatic',
      badge: 'Recommended',
      description: `Pick the right Java for this version (Auto selects ${getRecommendedJava()})`,
    };
    const listOpts = javaList.map((j) => ({
      value: j.path,
      label: `Java ${j.majorVersion} (${j.versionString})`,
      badge: j.is64Bit ? '64-bit' : '32-bit',
      description: j.path,
    }));
    return [defaultOpt, ...listOpts];
  }, [javaList, gameVersion]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
      <div className="w-full max-w-xl bg-[#121212] rounded-2xl border border-white/[0.08] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08] bg-[#161616]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/30">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold font-riot text-white">Create New Profile</h2>
              <p className="text-xs text-slate-400">Configure Minecraft version, mod loader, and RAM</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-[#2a2b2f]/90 hover:bg-[#383a40] text-white border border-white/10 shadow-lg flex items-center justify-center transition-all duration-150 active:scale-90 cursor-pointer"
            title="Close"
          >
            <X className="w-4 h-4 text-white" strokeWidth={3} />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} noValidate className="p-6 space-y-5 overflow-y-auto flex-1">
          {/* Instance Name */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
              Profile Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameManuallyEdited(true);
              }}
              placeholder="e.g. Friends Survival (1.21.4 Fabric)"
              required
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#1a1a1a] border border-white/10 text-sm text-white focus:outline-none focus:border-amber-400"
            />
          </div>

          {/* Minecraft Version Selector */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                Minecraft Version
              </label>
              <div
                onClick={() => setShowSnapshots(!showSnapshots)}
                className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-200 cursor-pointer select-none transition-colors"
              >
                <ToggleSwitch
                  size="sm"
                  checked={showSnapshots}
                  onChange={setShowSnapshots}
                  title="Show Snapshots"
                />
                <span>Show Snapshots</span>
              </div>
            </div>

            <CustomSelect
              value={gameVersion}
              onChange={handleVersionChange}
              options={versionOptions}
              searchable
              searchPlaceholder="Search Minecraft version..."
            />
          </div>

          {/* Mod Loader Selector */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              Mod Loader
            </label>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {(
                [
                  { id: 'fabric', label: 'Fabric', desc: 'Fast, light' },
                  { id: 'forge', label: 'Forge', desc: 'Classic' },
                  { id: 'neoforge', label: 'NeoForge', desc: 'Modern' },
                  { id: 'quilt', label: 'Quilt', desc: 'Modular' },
                  { id: 'vanilla', label: 'Vanilla', desc: 'Clean' },
                ] as const
              ).map((item) => {
                const isSelected = loader === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleLoaderChange(item.id)}
                    className={`p-2.5 rounded-xl border-2 text-center transition-all duration-150 flex flex-col items-center justify-center gap-1 cursor-pointer ${
                      isSelected
                        ? 'bg-[var(--accent-color)]/[0.04] border-[var(--accent-color)] text-white shadow-md shadow-black/30 font-bold -translate-y-0.5'
                        : 'bg-white/[0.02] border-white/10 text-slate-400 hover:border-white/20 hover:text-slate-200'
                    }`}
                  >
                    <span className="font-bold text-xs">{item.label}</span>
                    <span className="text-[10px] text-slate-400 opacity-80">{item.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Loader Version if not vanilla */}
          {loader !== 'vanilla' && (
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                {loader.toUpperCase()} Loader Version
              </label>
              <CustomSelect
                value={loaderVersion}
                onChange={setLoaderVersion}
                options={loaderVersionOptions}
                disabled={loaderVersions.length === 0}
                placeholder={
                  isLoadingLoaders
                    ? 'Loading versions...'
                    : loaderVersions.length === 0
                    ? `No ${loader.toUpperCase()} build for ${gameVersion}`
                    : `Select ${loader.toUpperCase()} version`
                }
              />
            </div>
          )}

          {/* RAM Allocation Slider */}
          <div className="space-y-2 p-4 rounded-xl bg-white/[0.02] border border-white/[0.06]">
            <div className="flex items-center justify-between text-xs font-semibold mb-1">
              <span className="text-slate-300 uppercase tracking-wider">Allocated RAM:</span>
              <span className="text-[var(--accent-color)] text-sm font-bold">{(maxRam / 1024).toFixed(1)} GB RAM</span>
            </div>
            {(() => {
              // Draggable all the way to what's actually installed rather than stopping at
              // the recommended ceiling — going past it is allowed, just called out below.
              const sliderMax = systemInfo?.totalRamMb ?? 16384;
              const span = Math.max(sliderMax - 2048, 1024);
              const ramPct = Math.round(((maxRam - 2048) / span) * 100);
              // Where "recommended" actually falls along that same range, so the label
              // below sits above the point it describes instead of a fixed middle slot.
              const recommendedPct = systemInfo
                ? Math.min(88, Math.max(12, Math.round(((systemInfo.recommendedRamMb - 2048) / span) * 100)))
                : 50;
              return (
                <>
                  <input
                    type="range"
                    min="2048"
                    max={sliderMax}
                    step="1024"
                    value={Math.min(maxRam, sliderMax)}
                    style={{
                      background: `linear-gradient(to right, var(--accent-color, #10b981) ${ramPct}%, rgba(255,255,255,0.08) ${ramPct}%)`,
                    }}
                    onChange={(e) => setMaxRam(Number(e.target.value))}
                    className="w-full cursor-pointer"
                  />
                  <div className="relative h-4 text-[10px] text-slate-500 mt-1">
                    <span className="absolute left-0">2 GB</span>
                    {systemInfo && (
                      <span
                        className="absolute -translate-x-1/2 text-slate-400 whitespace-nowrap"
                        style={{ left: `${recommendedPct}%` }}
                      >
                        {(systemInfo.recommendedRamMb / 1024).toFixed(0)} GB recommended
                      </span>
                    )}
                    <span className="absolute right-0">
                      {systemInfo ? `${(systemInfo.totalRamMb / 1024).toFixed(0)} GB installed` : '16 GB'}
                    </span>
                  </div>
                </>
              );
            })()}
            {systemInfo && maxRam > systemInfo.recommendedMaxRamMb && (
              <p className="text-[10px] text-amber-300 leading-relaxed pt-1">
                This is more than the computer can comfortably spare — Windows and the game itself may not
                have enough memory left to run.
              </p>
            )}
          </div>

          {/* Game Window Resolution */}
          <GameWindowSelector
            fullscreen={fullscreen}
            setFullscreen={setFullscreen}
            windowWidth={windowWidth}
            setWindowWidth={setWindowWidth}
            windowHeight={windowHeight}
            setWindowHeight={setWindowHeight}
          />

          {/* Java Runtime */}
          <div className="space-y-2 p-4 rounded-xl bg-white/[0.02] border border-white/[0.06]">
            <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Java Runtime</div>
            <CustomSelect
              value={javaPath}
              onChange={setJavaPath}
              options={javaOptions}
            />
            <p className="text-[10px] text-slate-500 leading-relaxed">
              {javaList.length === 0
                ? 'No Java runtime detected on this computer yet.'
                : `Automatic selects ${getRecommendedJava()} for Minecraft ${gameVersion}.`}
            </p>
          </div>

          {/* In-Game Skin Feature Toggle */}
          <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.06] flex items-center justify-between">
            <div>
              <div className="text-xs font-bold text-white">In-game Team Skin Sync</div>
              <div className="text-[11px] text-slate-400">
                {loader === 'vanilla'
                  ? 'Needs a mod loader. Choose Fabric, Forge, NeoForge or Quilt to use this.'
                  : "Installs CustomSkinLoader so friends can see each other's custom skins"}
              </div>
            </div>
            <ToggleSwitch
              size="md"
              checked={enableSkinInGame && loader !== 'vanilla'}
              onChange={setEnableSkinInGame}
              disabled={loader === 'vanilla'}
              title="In-game Team Skin Sync"
            />
          </div>

          {/* Profile Storage Directory Selection */}
          <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-3">
            <div className="flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-amber-400" />
              <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">{t.installDirTitle}</span>
            </div>

            <div className="space-y-2">
              <label className={`flex items-start gap-2.5 p-2.5 rounded-xl border cursor-pointer transition ${
                !useCustomDir
                  ? 'bg-[var(--accent-color)]/10 border-[var(--accent-color)]/30 text-white'
                  : 'bg-black/20 border-white/5 text-slate-400 hover:border-white/10'
              }`}>
                <input
                  type="radio"
                  name="dirOption"
                  checked={!useCustomDir}
                  onChange={() => setUseCustomDir(false)}
                  className="mt-0.5 accent-[var(--accent-color)] cursor-pointer"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-slate-200">{t.useDefaultDir}</div>
                  <div className="text-[11px] font-medium text-slate-400 truncate mt-0.5">
                    {defaultGameDir ? `${defaultGameDir}\\instances\\...` : '%APPDATA%\\MCL Client\\instances\\...'}
                  </div>
                </div>
              </label>

              <label className={`flex items-start gap-2.5 p-2.5 rounded-xl border cursor-pointer transition ${
                useCustomDir
                  ? 'bg-[var(--accent-color)]/10 border-[var(--accent-color)]/30 text-white'
                  : 'bg-black/20 border-white/5 text-slate-400 hover:border-white/10'
              }`}>
                <input
                  type="radio"
                  name="dirOption"
                  checked={useCustomDir}
                  onChange={() => setUseCustomDir(true)}
                  className="mt-0.5 accent-[var(--accent-color)] cursor-pointer"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-slate-200">{t.useCustomDir}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                    {t.customDirHint}
                  </div>

                  {useCustomDir && (
                    <div className="flex items-center gap-2 mt-2.5" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="text"
                        value={customDirPath}
                        onChange={(e) => setCustomDirPath(e.target.value)}
                        placeholder="D:\Games\Minecraft\MyPack"
                        className="flex-1 px-3 py-2 rounded-xl bg-[#141414] border border-white/10 text-xs font-medium text-white focus:outline-none focus:border-amber-400"
                      />
                      <button
                        type="button"
                        onClick={handleBrowseFolder}
                        disabled={isBrowsingDir}
                        className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10 text-xs font-semibold text-white flex items-center gap-1.5 transition cursor-pointer shrink-0"
                      >
                        <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
                        <span>{t.btnBrowse}</span>
                      </button>
                    </div>
                  )}
                </div>
              </label>
            </div>
          </div>

          {/* Java Recommendation */}
          <div className="flex items-center gap-2 text-xs text-slate-400 px-1">
            <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="font-medium">Assigned runtime: <strong className="font-bold text-slate-200">{getRecommendedJava()}</strong></span>
          </div>

          {/* Footer Buttons */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/[0.06]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loader !== 'vanilla' && !loaderVersion}
              className="btn-primary px-6 py-2 rounded-xl text-xs font-bold font-riot flex items-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create Profile</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
