import React, { useState, useEffect } from 'react';
import { X, Layers, Plus, ChevronDown, ShieldCheck, AlertCircle, HardDrive, FolderOpen } from 'lucide-react';
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
    setName(`Minecraft ${newVer} ${loader !== 'vanilla' ? `(${loader.toUpperCase()})` : ''}`.trim());
  };

  const handleLoaderChange = (newLoader: ModLoader) => {
    setLoader(newLoader);
    setName(`Minecraft ${gameVersion} ${newLoader !== 'vanilla' ? `(${newLoader.toUpperCase()})` : ''}`.trim());
  };

  // Mirrors required_java_major() in src-tauri/src/java_detector.rs, which is what the
  // launcher actually enforces. Versions outside the 1.x scheme are modern releases.
  const getRecommendedJava = () => {
    const parts = gameVersion.split('.').map(Number);
    const major = parts[0] || 0;
    const minor = parts[1] || 0;
    const patch = parts[2] || 0;

    if (major !== 1) return 'Java 21 LTS';
    if (minor < 17) return 'Java 8';
    if (minor < 20) return 'Java 17 LTS';
    if (minor === 20 && patch <= 4) return 'Java 17 LTS';
    return 'Java 21 LTS';
  };

  useEffect(() => {
    if (isOpen) {
      setUseCustomDir(false);
      setCustomDirPath('');
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
    onCreate({
      name: name.trim() || `Minecraft ${gameVersion}`,
      gameVersion,
      loader,
      loaderVersion: loader !== 'vanilla' ? loaderVersion : undefined,
      minRam,
      maxRam,
      javaPath: javaPath || undefined,
      enableSkinInGame,
      icon: loader === 'fabric' ? 'fabric' : loader === 'forge' ? 'forge' : 'grass',
      customDir: useCustomDir && customDirPath.trim() ? customDirPath.trim() : undefined,
    });
    onClose();
  };

  if (!isOpen) return null;

  const filteredVersions = versionList.filter((v) => showSnapshots || v.type === 'release');

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
        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto flex-1">
          {/* Instance Name */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
              Profile Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
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

            <div className="relative">
              <select
                value={gameVersion}
                onChange={(e) => handleVersionChange(e.target.value)}
                className="w-full appearance-none px-3.5 py-2.5 rounded-xl bg-[#1a1a1a] border border-white/10 text-sm font-medium text-white cursor-pointer pr-8 focus:outline-none focus:border-amber-400"
              >
                {filteredVersions.length > 0 ? (
                  filteredVersions.map((v) => (
                    <option key={v.id} value={v.id} className="bg-slate-900 text-white">
                      Minecraft {v.id} {v.type === 'release' ? '(Release)' : `(${v.type})`}
                    </option>
                  ))
                ) : (
                  <>
                    <option value="1.21.4" className="bg-slate-900">Minecraft 1.21.4 (Release)</option>
                    <option value="1.21.1" className="bg-slate-900">Minecraft 1.21.1 (Release)</option>
                    <option value="1.20.1" className="bg-slate-900">Minecraft 1.20.1 (Release)</option>
                    <option value="1.19.4" className="bg-slate-900">Minecraft 1.19.4 (Release)</option>
                    <option value="1.16.5" className="bg-slate-900">Minecraft 1.16.5 (Release)</option>
                  </>
                )}
              </select>
              <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
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
              <select
                value={loaderVersion}
                onChange={(e) => setLoaderVersion(e.target.value)}
                disabled={loaderVersions.length === 0}
                className="w-full appearance-none px-3.5 py-2.5 rounded-xl bg-[#1a1a1a] border border-white/10 text-xs text-white cursor-pointer focus:outline-none focus:border-amber-400 disabled:cursor-not-allowed disabled:text-slate-500"
              >
                {loaderVersions.length === 0 && (
                  <option value="" className="bg-slate-900 text-white">
                    {isLoadingLoaders
                      ? 'Loading versions...'
                      : `No ${loader.toUpperCase()} build for ${gameVersion}`}
                  </option>
                )}
                {loaderVersions.map((ver) => (
                  <option key={ver} value={ver} className="bg-slate-900 text-white">
                    {ver}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* RAM Allocation Slider */}
          <div className="space-y-2 p-4 rounded-xl bg-white/[0.02] border border-white/[0.06]">
            <div className="flex items-center justify-between text-xs font-semibold mb-1">
              <span className="text-slate-300 uppercase tracking-wider">Allocated RAM:</span>
              <span className="text-[var(--accent-color)] font-mono text-sm font-bold">{(maxRam / 1024).toFixed(1)} GB RAM</span>
            </div>
            {(() => {
              const sliderMax = systemInfo?.recommendedMaxRamMb ?? 16384;
              const span = Math.max(sliderMax - 2048, 1024);
              const ramPct = Math.round(((maxRam - 2048) / span) * 100);
              return (
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
              );
            })()}
            <div className="flex justify-between text-[10px] text-slate-500 font-mono mt-1">
              <span>2 GB</span>
              {systemInfo ? (
                <>
                  <span className="text-slate-400">
                    {(systemInfo.recommendedRamMb / 1024).toFixed(0)} GB recommended
                  </span>
                  <span>{(systemInfo.totalRamMb / 1024).toFixed(0)} GB installed</span>
                </>
              ) : (
                <>
                  <span>4 GB (Standard)</span>
                  <span>8 GB (Modded)</span>
                </>
              )}
            </div>
            {systemInfo && (
              <p className="text-[10px] text-slate-500 leading-relaxed pt-1">
                Capped at {(systemInfo.recommendedMaxRamMb / 1024).toFixed(0)} GB so Windows and the game
                itself keep enough memory to run.
              </p>
            )}
          </div>

          {/* Java Runtime */}
          <div className="space-y-2 p-4 rounded-xl bg-white/[0.02] border border-white/[0.06]">
            <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Java Runtime</div>
            <select
              value={javaPath}
              onChange={(e) => setJavaPath(e.target.value)}
              className="w-full glass-input px-3.5 py-2.5 rounded-xl text-xs font-mono text-white cursor-pointer"
            >
              <option value="" className="bg-slate-900 font-sans">
                Automatic — pick the right Java for this version
              </option>
              {javaList.map((j) => (
                <option key={j.path} value={j.path} className="bg-slate-900 font-sans">
                  {j.versionString}
                  {j.is64Bit ? '' : ' (32-bit)'} — {j.path}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-slate-500 leading-relaxed">
              {javaList.length === 0
                ? 'No Java runtime detected on this computer yet.'
                : `Automatic selects ${getRecommendedJava()} for Minecraft ${gameVersion}.`}
            </p>
          </div>

          {/* In-Game Skin Feature Toggle */}
          <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.06] flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
              <div>
                <div className="text-xs font-bold text-white">In-game Team Skin Sync</div>
                <div className="text-[11px] text-slate-400">
                  {loader === 'vanilla'
                    ? 'Needs a mod loader. Choose Fabric, Forge, NeoForge or Quilt to use this.'
                    : "Installs CustomSkinLoader so friends can see each other's custom skins"}
                </div>
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
                  ? 'bg-amber-500/10 border-amber-500/30 text-white'
                  : 'bg-black/20 border-white/5 text-slate-400 hover:border-white/10'
              }`}>
                <input
                  type="radio"
                  name="dirOption"
                  checked={!useCustomDir}
                  onChange={() => setUseCustomDir(false)}
                  className="mt-0.5 accent-amber-400 cursor-pointer"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-slate-200">{t.useDefaultDir}</div>
                  <div className="text-[11px] font-mono text-slate-400 truncate mt-0.5">
                    {defaultGameDir ? `${defaultGameDir}\\instances\\...` : '%APPDATA%\\MCLv2\\instances\\...'}
                  </div>
                </div>
              </label>

              <label className={`flex items-start gap-2.5 p-2.5 rounded-xl border cursor-pointer transition ${
                useCustomDir
                  ? 'bg-amber-500/10 border-amber-500/30 text-white'
                  : 'bg-black/20 border-white/5 text-slate-400 hover:border-white/10'
              }`}>
                <input
                  type="radio"
                  name="dirOption"
                  checked={useCustomDir}
                  onChange={() => setUseCustomDir(true)}
                  className="mt-0.5 accent-amber-400 cursor-pointer"
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
                        className="flex-1 px-3 py-2 rounded-xl bg-[#141414] border border-white/10 text-xs font-mono text-white focus:outline-none focus:border-amber-400"
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
          <div className="flex items-center gap-2 text-[11px] text-slate-400 px-1">
            <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
            <span>Assigned runtime: <strong className="text-slate-200">{getRecommendedJava()}</strong></span>
          </div>

          {/* Footer Buttons */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/[0.06]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loader !== 'vanilla' && !loaderVersion}
              className="btn-primary px-6 py-2 rounded-xl text-xs font-bold font-riot flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
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
