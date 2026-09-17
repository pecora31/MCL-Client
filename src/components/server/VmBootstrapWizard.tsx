import React, { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Loader2, X, KeyRound, Server } from 'lucide-react';
import { invokeCommand } from '../../services/api';
import { type RemoteHost } from '../../services/remoteAgent';
import type { BootstrapRequest, BootstrapOutcome, BootstrapProgressEvent, BootstrapCredentialsEvent } from '../../types';
import { getTranslation, type Language } from '../../locales/i18n';

interface VmBootstrapWizardProps {
  language: Language;
  onInstalled: (host: RemoteHost) => void;
  onClose: () => void;
}

type WizardPhase = 'form' | 'running' | 'error' | 'done';

const MAX_LOG_LINES = 500;

const isValidPort = (value: number): boolean => Number.isInteger(value) && value >= 1 && value <= 65535;

export const VmBootstrapWizard: React.FC<VmBootstrapWizardProps> = ({ language, onInstalled, onClose }) => {
  const t = getTranslation(language);
  const [host, setHost] = useState('');
  // Kept as free-form text rather than a number, so clearing the field to type a new value
  // doesn't immediately snap back to a coerced 0 — isValidPort/Number(...) only run at the
  // points that actually need a numeric port (validation, disabling Connect, the request body).
  const [portText, setPortText] = useState('22');
  const [username, setUsername] = useState('ubuntu');
  const [privateKeyPath, setPrivateKeyPath] = useState('');
  const [agentPortText, setAgentPortText] = useState('8642');
  const port = Number(portText);
  const agentPort = Number(agentPortText);
  const [displayName, setDisplayName] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [phase, setPhase] = useState<WizardPhase>('form');
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [isRetrying, setIsRetrying] = useState(false);
  const credentialsRef = useRef<BootstrapOutcome | null>(null);
  const streamIdRef = useRef('');
  const logEndRef = useRef<HTMLDivElement>(null);
  const isMountedRef = useRef(true);
  const runningRef = useRef(false);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [log]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const unlistenProgress = listen<BootstrapProgressEvent>('vm-bootstrap-progress', (event) => {
      if (event.payload.streamId !== streamIdRef.current) return;
      setLog((prev) => {
        const next = [...prev, event.payload.line];
        return next.length > MAX_LOG_LINES ? next.slice(next.length - MAX_LOG_LINES) : next;
      });
    });
    const unlistenCredentials = listen<BootstrapCredentialsEvent>('vm-bootstrap-credentials', (event) => {
      if (event.payload.streamId !== streamIdRef.current) return;
      credentialsRef.current = { url: event.payload.url, token: event.payload.token, certPem: event.payload.certPem };
    });
    return () => {
      unlistenProgress.then((f) => f());
      unlistenCredentials.then((f) => f());
    };
  }, []);

  const pickPrivateKey = async () => {
    const path = await invokeCommand<string | null>('select_file_path', { filterName: null, filterExtensions: null });
    if (path) setPrivateKeyPath(path);
  };

  const finish = (outcome: BootstrapOutcome) => {
    if (!isMountedRef.current) return;
    const newHost: RemoteHost = {
      id: Date.now().toString(),
      name: displayName.trim() || host,
      url: outcome.url,
      token: outcome.token,
      certPem: outcome.certPem,
    };
    setPhase('done');
    onInstalled(newHost);
  };

  const handleStart = async () => {
    if (runningRef.current) return;
    if (!host.trim() || !privateKeyPath || !isValidPort(port) || !isValidPort(agentPort)) return;
    runningRef.current = true;
    setPhase('running');
    setLog([]);
    setError('');
    credentialsRef.current = null;
    streamIdRef.current = Date.now().toString();

    const req: BootstrapRequest = {
      host: host.trim(),
      port,
      username: username.trim() || 'ubuntu',
      privateKeyPath,
      agentPort,
    };

    try {
      const outcome = await invokeCommand<BootstrapOutcome>('vm_bootstrap_start', { streamId: streamIdRef.current, req });
      if (!isMountedRef.current) return;
      finish(outcome);
    } catch (err) {
      if (!isMountedRef.current) return;
      setError(String(err));
      setPhase('error');
    } finally {
      runningRef.current = false;
    }
  };

  const handleRetryVerify = async () => {
    if (runningRef.current) return;
    const creds = credentialsRef.current;
    if (!creds) return;
    runningRef.current = true;
    setIsRetrying(true);
    try {
      await invokeCommand<void>('vm_bootstrap_retry_verify', {
        host: { url: creds.url, token: creds.token, certPem: creds.certPem },
      });
      if (!isMountedRef.current) return;
      finish(creds);
    } catch (err) {
      if (!isMountedRef.current) return;
      setError(String(err));
    } finally {
      runningRef.current = false;
      if (isMountedRef.current) setIsRetrying(false);
    }
  };

  const handleStartOver = () => {
    setError('');
    setLog([]);
    credentialsRef.current = null;
    setPhase('form');
  };

  const handleClose = () => {
    if (phase === 'running') return;
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-2xl bg-[#151515] border border-white/10 flex flex-col overflow-hidden max-h-[85vh]">
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-[var(--accent-color)]" />
            <span className="text-sm font-bold text-white">{t.hostServerBootstrapTitle || 'Set Up a New VM Automatically'}</span>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={phase === 'running'}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-slate-400"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto custom-scrollbar">
          {phase === 'form' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  placeholder={t.hostServerBootstrapHost || 'VM address (e.g. 140.245.125.66)'}
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  className="col-span-2 px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-[var(--accent-color)]"
                />
                <input
                  type="text"
                  placeholder={t.hostServerBootstrapUsername || 'SSH username'}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-[var(--accent-color)]"
                />
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder={t.hostServerBootstrapPortPlaceholder || 'SSH port (default 22)'}
                  value={portText}
                  onChange={(e) => setPortText(e.target.value.replace(/[^0-9]/g, ''))}
                  className="px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-[var(--accent-color)]"
                />
              </div>

              <button
                type="button"
                onClick={pickPrivateKey}
                className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-left flex items-center gap-2 cursor-pointer hover:bg-white/10 transition"
              >
                <KeyRound className="w-4 h-4 text-amber-400 shrink-0" />
                <span className={privateKeyPath ? 'text-white truncate' : 'text-slate-500'}>
                  {privateKeyPath || t.hostServerBootstrapPickKey || 'Choose private key file...'}
                </span>
              </button>

              <input
                type="text"
                placeholder={t.hostServerRemoteNamePlaceholder || 'Name (e.g. My VPS)'}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-[var(--accent-color)]"
              />

              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="text-xs font-semibold text-slate-400 hover:text-white cursor-pointer"
              >
                {showAdvanced ? t.hostServerBootstrapHideAdvanced || 'Hide advanced' : t.hostServerBootstrapShowAdvanced || 'Advanced'}
              </button>
              {showAdvanced && (
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    {t.hostServerBootstrapAgentPort || 'Agent port'}
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="8642"
                    value={agentPortText}
                    onChange={(e) => setAgentPortText(e.target.value.replace(/[^0-9]/g, ''))}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-[var(--accent-color)]"
                  />
                </div>
              )}

              <button
                type="button"
                onClick={handleStart}
                disabled={!host.trim() || !privateKeyPath || !isValidPort(port) || !isValidPort(agentPort)}
                className="w-full btn-primary px-4 py-2.5 rounded-xl text-sm font-bold cursor-pointer active:scale-95 transition disabled:opacity-40"
              >
                {t.hostServerBootstrapConnect || 'Connect & Install'}
              </button>
            </>
          )}

          {(phase === 'running' || phase === 'error') && (
            <>
              <div className="rounded-xl bg-black/60 border border-white/10 h-56 overflow-y-auto custom-scrollbar px-3.5 py-3 font-mono text-[11px] text-slate-300 space-y-1">
                {log.map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
                {phase === 'running' && (
                  <div className="flex items-center gap-1.5 text-slate-500">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>{t.hostServerBootstrapWorking || 'Working...'}</span>
                  </div>
                )}
                <div ref={logEndRef} />
              </div>

              {phase === 'running' && (
                <p className="text-xs text-slate-500">
                  {t.hostServerBootstrapCannotClose || 'Setup is running on the VM. Wait for it to finish.'}
                </p>
              )}

              {phase === 'error' && (
                <>
                  <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-300 text-xs">{error}</div>
                  <div className="flex items-center gap-2">
                    {credentialsRef.current && (
                      <button
                        type="button"
                        onClick={handleRetryVerify}
                        disabled={isRetrying}
                        className="flex-1 btn-primary px-4 py-2.5 rounded-xl text-sm font-bold cursor-pointer active:scale-95 transition disabled:opacity-40 flex items-center justify-center gap-1.5"
                      >
                        {isRetrying && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        <span>{t.hostServerBootstrapRetry || 'Retry'}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleStartOver}
                      className="px-4 py-2.5 rounded-xl text-sm font-semibold bg-white/5 hover:bg-white/10 text-slate-300 cursor-pointer active:scale-95 transition"
                    >
                      {t.hostServerBootstrapStartOver || 'Start Over'}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
