import React, { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Server, Play, Square, Download, RefreshCw, AlertCircle, Copy, Check, ExternalLink } from 'lucide-react';
import { invokeCommand, isTauri } from '../../services/api';
import type { GameInstance, SystemInfo, ServerPropertiesSummary, HostedServerStatus } from '../../types';
import { getTranslation, type Language } from '../../locales/i18n';
import { CustomSelect, type SelectOption } from '../common/CustomSelect';
import { RamAllocationField } from '../common/RamAllocationField';
import { Checkbox } from '../common/Checkbox';

interface HostServerViewProps {
  instances: GameInstance[];
  language: Language;
  onOpenCreateModal: () => void;
}

// Forge and NeoForge ship an installer that has to run as its own process to produce a
// server — not built yet (see server_host.rs), so only these three can be hosted for now.
const HOSTABLE_LOADERS = new Set(['vanilla', 'fabric', 'quilt']);

/**
 * Host and play a profile's world on this same computer — MCL downloads the matching server
 * jar, runs it in the background, and exposes its online-mode and a few other settings right
 * here, with no folder to point at: the server lives inside the profile's own directory, so
 * MCL already knows exactly where it is.
 */
export const HostServerView: React.FC<HostServerViewProps> = ({ instances, language, onOpenCreateModal }) => {
  const t = getTranslation(language);
  const [selectedId, setSelectedId] = useState(instances[0]?.id || '');
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
  const [summary, setSummary] = useState<ServerPropertiesSummary | null>(null);
  const [copied, setCopied] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  const instance = instances.find((i) => i.id === selectedId) || null;

  useEffect(() => {
    invokeCommand<SystemInfo>('get_system_info').then(setSystemInfo).catch(() => {});
  }, []);

  // Instances can still be loading when this view first mounts, so the initial state's
  // `instances[0]` is often empty — pick one as soon as the real list shows up.
  useEffect(() => {
    if (!selectedId && instances.length > 0) {
      setSelectedId(instances[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instances]);

  const refreshStatus = async (id: string) => {
    if (!id) {
      setStatus(null);
      setSummary(null);
      return;
    }
    try {
      const s = await invokeCommand<HostedServerStatus>('get_hosted_server_status', { instanceId: id });
      setStatus(s);
      if (s.hasJar) {
        try {
          setSummary(await invokeCommand<ServerPropertiesSummary>('read_server_properties', { dir: s.serverDir }));
        } catch {
          setSummary(null);
        }
      } else {
        setSummary(null);
      }
    } catch (err) {
      console.warn('Could not read hosted server status:', err);
    }
  };

  useEffect(() => {
    setError('');
    setEulaAccepted(false);
    refreshStatus(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    if (!isTauri()) return;
    const unlisten = listen<string>('server-log', (event) => {
      setLogs((prev) => [...prev.slice(-500), event.payload]);
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Poll while a server is running so Stop (triggered elsewhere, or the server dying on its
  // own) is reflected here without the player having to switch tabs and back.
  useEffect(() => {
    if (!status?.running || !selectedId) return;
    const interval = setInterval(() => refreshStatus(selectedId), 4000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.running, selectedId]);

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

  const loaderSupported = instance ? HOSTABLE_LOADERS.has(instance.loader) : false;

  const profileOptions: SelectOption<string>[] = instances.map((i) => ({
    value: i.id,
    label: i.name,
    badge: `${i.loader.toUpperCase()} ${i.gameVersion}`,
  }));

  const difficultyOptions: SelectOption<ServerPropertiesSummary['difficulty']>[] = [
    { value: 'peaceful', label: t.difficultyPeaceful || 'Peaceful' },
    { value: 'easy', label: t.difficultyEasy || 'Easy' },
    { value: 'normal', label: t.difficultyNormal || 'Normal' },
    { value: 'hard', label: t.difficultyHard || 'Hard' },
  ];

  const updateSummary = (patch: Partial<ServerPropertiesSummary>) =>
    setSummary((prev) => (prev ? { ...prev, ...patch } : prev));

  const handlePrepare = async () => {
    if (!instance) return;
    setIsPreparing(true);
    setError('');
    try {
      const s = await invokeCommand<HostedServerStatus>('prepare_hosted_server', {
        instanceId: instance.id,
        acceptEula: eulaAccepted,
      });
      setStatus(s);
      setSummary(await invokeCommand<ServerPropertiesSummary>('read_server_properties', { dir: s.serverDir }));
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
      const [javaBin] = await invokeCommand<[string, number, string]>('find_best_java', {
        gameVersion: instance.gameVersion,
      });
      await invokeCommand('start_hosted_server', { instanceId: instance.id, javaBin, minRam, maxRam });
      setTimeout(() => refreshStatus(instance.id), 800);
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
      await invokeCommand('stop_hosted_server', { instanceId: instance.id });
      setTimeout(() => refreshStatus(instance.id), 500);
    } catch (err) {
      setError(String(err));
    } finally {
      setIsStopping(false);
    }
  };

  const handleSaveProperties = async () => {
    if (!status || !summary) return;
    try {
      await invokeCommand('write_server_properties', { dir: status.serverDir, summary });
    } catch (err) {
      setError(String(err));
    }
  };

  const handleCopyAddress = () => {
    navigator.clipboard.writeText('localhost:25565');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex-1 flex flex-col overflow-y-auto p-10 space-y-7 custom-scrollbar">
      {/* Header */}
      <div>
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[var(--accent-color)]/10 border border-[var(--accent-color)]/20 text-[var(--accent-color)] text-xs font-semibold mb-2 tracking-wide">
          <Server className="w-4 h-4" />
          <span>{t.hostServerBadge || 'Host & Play'}</span>
        </div>
        <h1 className="text-3xl font-extrabold text-white tracking-normal">{t.hostServerTitle || 'Host a Server'}</h1>
        <p className="text-base text-slate-300 mt-1 tracking-wide max-w-2xl">
          {t.hostServerSub ||
            'Run a dedicated server for one of your profiles on this computer, and join it yourself, without a terminal.'}
        </p>
      </div>

      {/* Profile picker */}
      <div className="max-w-2xl">
        <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
          {t.hostServerProfileLabel || 'Profile to Host'}
        </label>
        <CustomSelect value={selectedId} onChange={setSelectedId} options={profileOptions} />
      </div>

      {instance && !loaderSupported && (
        <div className="max-w-2xl p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-sm flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <span>
            {t.hostServerLoaderUnsupported ||
              'Hosting a Forge or NeoForge server is not supported yet — only Vanilla, Fabric and Quilt profiles can be hosted right now.'}
          </span>
        </div>
      )}

      {error && (
        <div className="max-w-2xl p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {instance && loaderSupported && (
        <div className="max-w-2xl space-y-5">
          {!status?.hasJar ? (
            /* Not prepared yet: EULA + download */
            <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.06] space-y-4">
              <div>
                <h3 className="text-base font-bold text-white">{t.hostServerPrepareTitle || 'Set up the server'}</h3>
                <p className="text-sm text-slate-400 mt-1">
                  {t.hostServerPrepareDesc ||
                    "Downloads a dedicated server matching this profile's loader and version, right into its own folder."}
                </p>
              </div>
              <Checkbox checked={eulaAccepted} onChange={setEulaAccepted} align="start">
                <span className="text-sm text-slate-300">
                  {t.hostServerEulaPrefix || 'I have read and accept the '}
                  <a
                    href="https://www.minecraft.net/en-us/eula"
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-[var(--accent-light)] hover:underline inline-flex items-center gap-1"
                  >
                    Minecraft EULA
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </span>
              </Checkbox>
              <button
                type="button"
                onClick={handlePrepare}
                disabled={!eulaAccepted || isPreparing}
                className="btn-primary px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 cursor-pointer active:scale-95 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Download className="w-4 h-4" />
                <span>{isPreparing ? t.hostServerPreparing || 'Downloading...' : t.hostServerPrepareBtn || 'Download & Prepare'}</span>
              </button>
            </div>
          ) : (
            <>
              {/* Start / Stop + connect info */}
              <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.06] space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                        status.running ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]' : 'bg-slate-500'
                      }`}
                    />
                    <span className="text-sm font-bold text-white">
                      {status.running ? t.hostServerRunning || 'Running' : t.hostServerStopped || 'Stopped'}
                    </span>
                  </div>
                  {status.running ? (
                    <button
                      type="button"
                      onClick={handleStop}
                      disabled={isStopping}
                      className="px-4 py-2 rounded-xl text-xs font-bold bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 flex items-center gap-1.5 cursor-pointer active:scale-95 transition disabled:opacity-40"
                    >
                      <Square className="w-3.5 h-3.5 fill-current" />
                      <span>{isStopping ? t.hostServerStopping || 'Stopping...' : t.hostServerStopBtn || 'Stop'}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleStart}
                      disabled={isStarting}
                      className="btn-primary px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer active:scale-95 transition disabled:opacity-40"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>{isStarting ? t.hostServerStarting || 'Starting...' : t.hostServerStartBtn || 'Start'}</span>
                    </button>
                  )}
                </div>

                {status.running && (
                  <div className="flex items-center justify-between p-3 rounded-xl bg-black/40 border border-white/5">
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider mb-0.5">
                        {t.hostServerAddress || 'Address to join'}
                      </div>
                      <div className="text-xs font-mono font-semibold text-white truncate">localhost:25565</div>
                    </div>
                    <button
                      type="button"
                      onClick={handleCopyAddress}
                      className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-slate-200 flex items-center gap-1.5 transition cursor-pointer shrink-0 active:scale-95"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copied ? t.copied || 'Copied!' : t.copyAction || 'Copy'}</span>
                    </button>
                  </div>
                )}

                {!status.running && (
                  <RamAllocationField
                    value={maxRam}
                    onChange={(v) => {
                      setMaxRam(v);
                      setMinRam((m) => Math.min(m, v));
                    }}
                    systemInfo={systemInfo}
                    min={1024}
                    step={512}
                  />
                )}
              </div>

              {/* Live console */}
              <div className="rounded-2xl bg-black/60 border border-white/[0.06] overflow-hidden">
                <div className="px-4 py-2.5 border-b border-white/[0.06] flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                    {t.hostServerConsole || 'Server Console'}
                  </span>
                  <button
                    type="button"
                    onClick={() => refreshStatus(instance.id)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
                    title={t.rescanBtn || 'Refresh'}
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="h-48 overflow-y-auto custom-scrollbar px-4 py-3 font-mono text-[11px] text-slate-300 space-y-0.5">
                  {logs.length === 0 ? (
                    <p className="text-slate-500">{t.hostServerNoLogsYet || 'No output yet.'}</p>
                  ) : (
                    logs.map((line, i) => <div key={i}>{line}</div>)
                  )}
                  <div ref={logEndRef} />
                </div>
              </div>

              {/* Server settings, no folder picker needed — MCL already knows where this one is */}
              {summary && (
                <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.06] space-y-4">
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                    {t.serverConfigTitle || 'Server Config'}
                  </h3>

                  <Checkbox checked={summary.onlineMode} onChange={(v) => updateSummary({ onlineMode: v })} align="start">
                    <div>
                      <div className="text-sm font-bold text-white">
                        {t.serverConfigOnlineMode || 'Require a Microsoft account'}
                      </div>
                      <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                        {t.serverConfigOnlineModeDesc ||
                          "Off lets offline accounts join — turn this off for a group all using offline accounts, or no one can connect."}
                      </p>
                    </div>
                  </Checkbox>

                  <div className="space-y-3.5">
                    <Checkbox checked={summary.pvp} onChange={(v) => updateSummary({ pvp: v })}>
                      <span className="text-sm font-semibold text-white">{t.serverConfigPvp || 'Players can fight each other'}</span>
                    </Checkbox>
                    <Checkbox checked={summary.whiteList} onChange={(v) => updateSummary({ whiteList: v })}>
                      <span className="text-sm font-semibold text-white">{t.serverConfigWhitelist || 'Only allow listed players'}</span>
                    </Checkbox>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                        {t.serverConfigDifficulty || 'Difficulty'}
                      </label>
                      <CustomSelect
                        value={summary.difficulty}
                        onChange={(v) => updateSummary({ difficulty: v })}
                        options={difficultyOptions}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                        {t.serverConfigMaxPlayers || 'Max Players'}
                      </label>
                      <input
                        type="number"
                        min={1}
                        value={summary.maxPlayers}
                        onChange={(e) => updateSummary({ maxPlayers: Math.max(1, Number(e.target.value) || 1) })}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-[#1a1a1a] border border-white/10 text-sm text-white focus:outline-none focus:border-[var(--accent-color)]"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 pt-1">
                    <p className="text-xs text-slate-500">
                      {t.serverConfigRestartHint || 'Restart the server for changes to take effect.'}
                    </p>
                    <button
                      type="button"
                      onClick={handleSaveProperties}
                      className="px-4 py-2 rounded-xl text-xs font-bold bg-white/10 hover:bg-white/15 text-white flex items-center gap-1.5 cursor-pointer active:scale-95 transition"
                    >
                      <span>{t.btnSave || 'Save'}</span>
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default HostServerView;
