import React, { useEffect, useRef, useState } from 'react';
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
  Plus,
  Trash2,
} from 'lucide-react';
import { invokeCommand, isTauri } from '../../services/api';
import { loadRemoteHosts, saveRemoteHosts, remoteAgent, type RemoteHost } from '../../services/remoteAgent';
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

/** A stand-in for the desktop app's own PID map, used only to key the "already running" check. */
const LOCAL_HOST_ID = 'local';

/**
 * Host and play a profile's world — either on this computer, where MCL already knows the
 * server's folder from the profile itself, or on a remote machine running the standalone MCL
 * Agent daemon (src-tauri/src/bin/mcl_agent.rs), reached over its token-authenticated HTTP API
 * instead of SSH.
 */
export const HostServerView: React.FC<HostServerViewProps> = ({ instances, language, onOpenCreateModal }) => {
  const t = getTranslation(language);
  const [selectedId, setSelectedId] = useState(instances[0]?.id || '');
  const [remoteHosts, setRemoteHosts] = useState<RemoteHost[]>([]);
  const [selectedHostId, setSelectedHostId] = useState<string>(LOCAL_HOST_ID);
  const [isAddHostOpen, setIsAddHostOpen] = useState(false);
  const [newHostName, setNewHostName] = useState('');
  const [newHostUrl, setNewHostUrl] = useState('');
  const [newHostToken, setNewHostToken] = useState('');
  const [newHostCertPem, setNewHostCertPem] = useState('');
  const [isSyncingMods, setIsSyncingMods] = useState(false);

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
  const [consoleCommand, setConsoleCommand] = useState('');
  const [isSendingCommand, setIsSendingCommand] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  const instance = instances.find((i) => i.id === selectedId) || null;
  const selectedHost = selectedHostId === LOCAL_HOST_ID ? null : remoteHosts.find((h) => h.id === selectedHostId) || null;

  useEffect(() => {
    invokeCommand<SystemInfo>('get_system_info').then(setSystemInfo).catch(() => {});
    setRemoteHosts(loadRemoteHosts());
  }, []);

  // Instances can still be loading when this view first mounts, so the initial state's
  // `instances[0]` is often empty — pick one as soon as the real list shows up.
  useEffect(() => {
    if (!selectedId && instances.length > 0) {
      setSelectedId(instances[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instances]);

  const refreshStatus = async () => {
    if (!instance) {
      setStatus(null);
      setSummary(null);
      return;
    }
    try {
      let s: HostedServerStatus;
      if (selectedHost) {
        s = await remoteAgent.status(selectedHost);
      } else {
        s = await invokeCommand<HostedServerStatus>('get_hosted_server_status', { instanceId: instance.id });
      }
      setStatus(s);
      if (s.hasJar) {
        try {
          const props = selectedHost
            ? await remoteAgent.getProperties(selectedHost)
            : await invokeCommand<ServerPropertiesSummary>('read_server_properties', { dir: s.serverDir });
          setSummary(props);
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
    refreshStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, selectedHostId]);

  // Local console output arrives as a Tauri event straight from the game process; a remote
  // agent's is tailed by the Rust backend (its certificate-pinned HTTPS client) and re-emitted
  // as its own event tagged with the host's id, since the webview itself can't make that
  // pinned connection directly.
  useEffect(() => {
    if (selectedHost) return;
    if (!isTauri()) return;
    const unlisten = listen<string>('server-log', (event) => {
      setLogs((prev) => [...prev.slice(-500), event.payload]);
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, [selectedHost]);

  useEffect(() => {
    if (!selectedHost) return;
    setLogs([]);
    remoteAgent.startLogStream(selectedHost, selectedHost.id).catch((err) => setError(String(err)));
    const unlisten = listen<{ streamId: string; line: string }>('remote-server-log', (event) => {
      if (event.payload.streamId !== selectedHost.id) return;
      setLogs((prev) => [...prev.slice(-500), event.payload.line]);
    });
    return () => {
      unlisten.then((f) => f());
      remoteAgent.stopLogStream(selectedHost.id).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedHost?.id]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Poll while a server is starting or running, so a crash, a "stop" typed straight into the
  // console, or the starting-to-running transition all show up here without the player having
  // to switch tabs and back.
  const isPolling = status?.state === 'starting' || status?.state === 'running';
  useEffect(() => {
    if (!isPolling || !instance) return;
    const interval = setInterval(() => refreshStatus(), status?.state === 'starting' ? 1500 : 4000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const handleAddHost = () => {
    if (!newHostName.trim() || !newHostUrl.trim() || !newHostToken.trim() || !newHostCertPem.trim()) return;
    const host: RemoteHost = {
      id: `${Date.now()}`,
      name: newHostName.trim(),
      url: newHostUrl.trim(),
      token: newHostToken.trim(),
      certPem: newHostCertPem.trim(),
    };
    const next = [...remoteHosts, host];
    setRemoteHosts(next);
    saveRemoteHosts(next);
    setSelectedHostId(host.id);
    setNewHostName('');
    setNewHostUrl('');
    setNewHostToken('');
    setNewHostCertPem('');
    setIsAddHostOpen(false);
  };

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
        await remoteAgent.start(selectedHost, { minRam, maxRam });
      } else {
        const [javaBin] = await invokeCommand<[string, number, string]>('find_best_java', {
          gameVersion: instance.gameVersion,
        });
        await invokeCommand('start_hosted_server', { instanceId: instance.id, javaBin, minRam, maxRam });
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
    if (!status || !summary) return;
    try {
      if (selectedHost) {
        await remoteAgent.setProperties(selectedHost, summary);
      } else {
        await invokeCommand('write_server_properties', { dir: status.serverDir, summary });
      }
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

  const displayAddress = (() => {
    if (!selectedHost) return 'localhost:25565';
    try {
      return `${new URL(selectedHost.url).hostname}:25565`;
    } catch {
      return selectedHost.url;
    }
  })();

  const handleCopyAddress = () => {
    navigator.clipboard.writeText(displayAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const hostOptions: SelectOption<string>[] = [
    { value: LOCAL_HOST_ID, label: t.hostServerThisComputer || 'This Computer' },
    ...remoteHosts.map((h) => ({ value: h.id, label: h.name, badge: 'REMOTE' })),
  ];

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

      <div className="max-w-2xl grid grid-cols-2 gap-4">
        {/* Profile picker */}
        <div>
          <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
            {t.hostServerProfileLabel || 'Profile to Host'}
          </label>
          <CustomSelect value={selectedId} onChange={setSelectedId} options={profileOptions} />
        </div>

        {/* Where to host: this computer, or a saved remote MCL Agent */}
        <div>
          <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
            {t.hostServerWhereLabel || 'Where'}
          </label>
          <CustomSelect value={selectedHostId} onChange={setSelectedHostId} options={hostOptions} />
        </div>
      </div>

      <div className="max-w-2xl flex items-center gap-2 -mt-3">
        {selectedHost && (
          <button
            type="button"
            onClick={() => handleRemoveHost(selectedHost.id)}
            className="text-xs font-semibold text-slate-500 hover:text-rose-300 flex items-center gap-1 cursor-pointer transition"
          >
            <Trash2 className="w-3 h-3" />
            <span>{t.hostServerRemoveHost || 'Remove this host'}</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => setIsAddHostOpen((v) => !v)}
          className="text-xs font-semibold text-[var(--accent-light)] hover:underline flex items-center gap-1 cursor-pointer ml-auto"
        >
          <Plus className="w-3 h-3" />
          <span>{t.hostServerAddRemote || 'Add a remote host'}</span>
        </button>
      </div>

      {isAddHostOpen && (
        <div className="max-w-2xl p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-3">
          <div className="flex items-start gap-2 text-xs text-slate-400 bg-white/[0.03] border border-white/[0.06] rounded-lg p-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[var(--accent-color)]" />
            <span>
              {t.hostServerRemoteWarning ||
                "The agent prints its address, bearer token and certificate path the first time it runs — paste that certificate file's contents below so MCL knows it's really talking to your server."}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input
              type="text"
              placeholder={t.hostServerRemoteNamePlaceholder || 'Name (e.g. My VPS)'}
              value={newHostName}
              onChange={(e) => setNewHostName(e.target.value)}
              className="px-3.5 py-2.5 rounded-xl bg-[#1a1a1a] border border-white/10 text-sm text-white focus:outline-none focus:border-[var(--accent-color)]"
            />
            <input
              type="text"
              placeholder={t.hostServerRemoteUrlPlaceholder || 'https://host:8642'}
              value={newHostUrl}
              onChange={(e) => setNewHostUrl(e.target.value)}
              className="px-3.5 py-2.5 rounded-xl bg-[#1a1a1a] border border-white/10 text-sm text-white focus:outline-none focus:border-[var(--accent-color)]"
            />
          </div>
          <input
            type="password"
            placeholder={t.hostServerRemoteTokenPlaceholder || 'Bearer token (printed when the agent first starts)'}
            value={newHostToken}
            onChange={(e) => setNewHostToken(e.target.value)}
            className="w-full px-3.5 py-2.5 rounded-xl bg-[#1a1a1a] border border-white/10 text-sm text-white focus:outline-none focus:border-[var(--accent-color)]"
          />
          <textarea
            placeholder={t.hostServerRemoteCertPlaceholder || '-----BEGIN CERTIFICATE-----\n... (paste agent-cert.pem here) ...\n-----END CERTIFICATE-----'}
            value={newHostCertPem}
            onChange={(e) => setNewHostCertPem(e.target.value)}
            rows={4}
            className="w-full px-3.5 py-2.5 rounded-xl bg-[#1a1a1a] border border-white/10 text-xs font-mono text-white focus:outline-none focus:border-[var(--accent-color)] resize-none"
          />
          <button
            type="button"
            onClick={handleAddHost}
            disabled={!newHostName.trim() || !newHostUrl.trim() || !newHostToken.trim() || !newHostCertPem.trim()}
            className="btn-primary px-4 py-2 rounded-xl text-xs font-bold cursor-pointer active:scale-95 transition disabled:opacity-40"
          >
            {t.btnSave || 'Save'}
          </button>
        </div>
      )}

      {error && (
        <div className="max-w-2xl p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {instance && (
        <div className="max-w-2xl space-y-5">
          {!status?.hasJar ? (
            /* Not prepared yet: EULA + download */
            <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.06] space-y-4">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  {selectedHost ? <Cloud className="w-4 h-4 text-[var(--accent-color)]" /> : <Monitor className="w-4 h-4 text-[var(--accent-color)]" />}
                  <span>{t.hostServerPrepareTitle || 'Set up the server'}</span>
                </h3>
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
                        status.state === 'running'
                          ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]'
                          : status.state === 'starting'
                          ? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)] animate-pulse'
                          : status.state === 'crashed'
                          ? 'bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.6)]'
                          : 'bg-slate-500'
                      }`}
                    />
                    <span className="text-sm font-bold text-white">
                      {status.state === 'running' && (t.hostServerRunning || 'Running')}
                      {status.state === 'starting' && (t.hostServerStatusStarting || 'Starting')}
                      {status.state === 'crashed' && (t.hostServerStatusCrashed || 'Crashed')}
                      {status.state === 'stopped' && (t.hostServerStopped || 'Stopped')}
                    </span>
                  </div>
                  {status.state === 'running' || status.state === 'starting' ? (
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

                {status.state === 'crashed' && (
                  <p className="text-xs text-rose-300/90 leading-relaxed">
                    {t.hostServerCrashedHint || 'The server exited on its own — check the console below for what happened, then press Start to try again.'}
                  </p>
                )}

                {status.state === 'running' && (
                  <div className="flex items-center justify-between p-3 rounded-xl bg-black/40 border border-white/5">
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider mb-0.5">
                        {t.hostServerAddress || 'Address to join'}
                      </div>
                      <div className="text-xs font-mono font-semibold text-white truncate">{displayAddress}</div>
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

                {(status.state === 'stopped' || status.state === 'crashed') && (
                  <RamAllocationField
                    value={maxRam}
                    onChange={(v) => {
                      setMaxRam(v);
                      setMinRam((m) => Math.min(m, v));
                    }}
                    systemInfo={selectedHost ? null : systemInfo}
                    min={1024}
                    step={512}
                  />
                )}
              </div>

              {selectedHost && (
                <button
                  type="button"
                  onClick={handleSyncMods}
                  disabled={isSyncingMods}
                  className="w-full px-4 py-2.5 rounded-xl text-xs font-bold bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 transition disabled:opacity-40"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncingMods ? 'animate-spin' : ''}`} />
                  <span>{isSyncingMods ? t.hostServerSyncingMods || 'Syncing mods...' : t.hostServerSyncMods || 'Sync Mods to This Host'}</span>
                </button>
              )}

              {/* Live console */}
              <div className="rounded-2xl bg-black/60 border border-white/[0.06] overflow-hidden">
                <div className="px-4 py-2.5 border-b border-white/[0.06] flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                    {t.hostServerConsole || 'Server Console'}
                  </span>
                  <button
                    type="button"
                    onClick={() => refreshStatus()}
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
                {(status.state === 'running' || status.state === 'starting') && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSendCommand();
                    }}
                    className="flex items-center gap-2 px-3 py-2.5 border-t border-white/[0.06]"
                  >
                    <input
                      type="text"
                      value={consoleCommand}
                      onChange={(e) => setConsoleCommand(e.target.value)}
                      placeholder={t.hostServerConsoleCommandPlaceholder || 'Type a command (e.g. op Steve)...'}
                      className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-xs font-mono text-white placeholder-slate-600 focus:outline-none focus:border-[var(--accent-color)]"
                    />
                    <button
                      type="submit"
                      disabled={!consoleCommand.trim() || isSendingCommand}
                      className="px-3.5 py-2 rounded-lg text-xs font-bold bg-white/10 hover:bg-white/15 text-white shrink-0 cursor-pointer active:scale-95 transition disabled:opacity-40"
                    >
                      {t.hostServerSendBtn || 'Send'}
                    </button>
                  </form>
                )}
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
