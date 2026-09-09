import React, { useState } from 'react';
import { Share2, Copy, Check, X, Download, Loader2, AlertTriangle } from 'lucide-react';
import type { GameInstance, ImportProgress, ShareManifest } from '../../types';
import { createShareCode, fetchShareManifest, installSharedAddons } from '../../services/shareCodes';
import { getTranslation, type Language } from '../../locales/i18n';

interface ShareProfileModalProps {
  isOpen: boolean;
  mode: 'share' | 'import';
  instance?: GameInstance;
  curseForgeApiKey?: string;
  onClose: () => void;
  onImported: (manifest: ShareManifest) => Promise<string>;
  language: Language;
}

export const ShareProfileModal: React.FC<ShareProfileModalProps> = ({
  isOpen,
  mode,
  instance,
  curseForgeApiKey,
  onClose,
  onImported,
  language,
}) => {
  const t = getTranslation(language);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [untracked, setUntracked] = useState<string[]>([]);
  const [expiresInDays, setExpiresInDays] = useState(0);
  const [inputCode, setInputCode] = useState('');
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [failed, setFailed] = useState<string[] | null>(null);

  if (!isOpen) return null;

  const reset = () => {
    setBusy(false);
    setError(null);
    setCode('');
    setCopied(false);
    setUntracked([]);
    setInputCode('');
    setProgress(null);
    setFailed(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const handleShare = async () => {
    if (!instance) return;
    setBusy(true);
    setError(null);
    try {
      const result = await createShareCode(instance.id);
      setCode(result.code);
      setExpiresInDays(result.expiresInDays);
      setUntracked(result.untracked);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.warn('Clipboard unavailable:', err);
    }
  };

  const handleImport = async () => {
    setBusy(true);
    setError(null);
    setFailed(null);
    try {
      const manifest = await fetchShareManifest(inputCode);
      // The profile is created first so the addons have somewhere to land.
      const instanceId = await onImported(manifest);
      const result = await installSharedAddons(
        instanceId,
        manifest,
        curseForgeApiKey,
        setProgress
      );
      setFailed(result.failed);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  };

  const isShare = mode === 'share';

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-6 animate-fadeIn">
      <div className="w-full max-w-md minimal-panel rounded-2xl border border-white/10 shadow-2xl overflow-hidden">
        <div className="flex items-start justify-between gap-4 p-5 border-b border-white/[0.06]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--accent-color)]/15 border border-[var(--accent-color)]/30 flex items-center justify-center shrink-0">
              {isShare ? (
                <Share2 className="w-5 h-5 text-[var(--accent-color)]" />
              ) : (
                <Download className="w-5 h-5 text-[var(--accent-color)]" />
              )}
            </div>
            <div>
              <h2 className="text-base font-bold text-white font-riot tracking-wide">
                {isShare ? t.shareTitle || 'Share this profile' : t.importTitle || 'Import a profile'}
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {isShare
                  ? t.shareSub || 'Sends the mod list, not the files.'
                  : t.importSub || 'Enter the code you were given.'}
              </p>
            </div>
          </div>
          <button
            onClick={close}
            className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/10 transition cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <p className="text-xs text-rose-200 leading-snug">{error}</p>
            </div>
          )}

          {isShare && !code && (
            <>
              <p className="text-xs text-slate-300 leading-relaxed">
                {t.shareExplain ||
                  'Creates a short code your friends can enter to rebuild this profile: same version, same loader, same mods. The mods download from Modrinth and CurseForge on their machine.'}
              </p>
              <button
                onClick={handleShare}
                disabled={busy}
                className="btn-primary w-full py-2.5 rounded-xl text-xs font-bold font-riot flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Share2 className="w-3.5 h-3.5" />}
                <span>{t.shareCreate || 'Create share code'}</span>
              </button>
            </>
          )}

          {isShare && code && (
            <>
              <div className="p-4 rounded-xl bg-black/40 border border-white/10 text-center">
                <div className="font-mono text-2xl font-bold text-white tracking-[0.3em] select-all">
                  {code}
                </div>
                <p className="text-[11px] text-slate-500 mt-2">
                  {(t.shareExpires || 'Expires in {n} days').replace('{n}', String(expiresInDays))}
                </p>
              </div>
              <button
                onClick={handleCopy}
                className="w-full py-2.5 rounded-xl text-xs font-bold bg-white/10 hover:bg-white/20 border border-white/10 text-white transition flex items-center justify-center gap-2 cursor-pointer"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? t.shareCopied || 'Copied' : t.shareCopy || 'Copy code'}</span>
              </button>

              {untracked.length > 0 && (
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 space-y-1.5">
                  <div className="flex items-center gap-2 text-[11px] font-semibold text-amber-300">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>
                      {(t.shareUntracked || '{n} file(s) cannot be shared').replace(
                        '{n}',
                        String(untracked.length)
                      )}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-snug">
                    {t.shareUntrackedWhy ||
                      'These were added by hand rather than installed from a store, so there is nowhere to download them from. Send them separately.'}
                  </p>
                  <div className="max-h-20 overflow-y-auto custom-scrollbar">
                    {untracked.map((name) => (
                      <div key={name} className="text-[10px] font-mono text-slate-500 truncate">
                        {name}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {!isShare && failed === null && (
            <>
              <input
                value={inputCode}
                onChange={(e) => setInputCode(e.target.value.toUpperCase())}
                placeholder="ABC2345"
                maxLength={7}
                disabled={busy}
                className="w-full px-3.5 py-3 rounded-xl bg-[#1a1a1a] border border-white/10 text-center font-mono text-lg tracking-[0.3em] text-white focus:outline-none focus:border-[var(--accent-color)] disabled:opacity-50"
              />

              {progress && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span className="truncate">{progress.currentName}</span>
                    <span className="font-mono shrink-0 ml-2">
                      {progress.done}/{progress.total}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className="h-full bg-[var(--accent-color)] transition-all duration-200"
                      style={{
                        width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              <button
                onClick={handleImport}
                disabled={busy || inputCode.trim().length !== 7}
                className="btn-primary w-full py-2.5 rounded-xl text-xs font-bold font-riot flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                <span>{t.importStart || 'Import profile'}</span>
              </button>
            </>
          )}

          {!isShare && failed !== null && (
            <div className="space-y-3">
              <div className="flex items-center gap-2.5 text-xs text-emerald-300">
                <Check className="w-4 h-4" />
                <span>{t.importDone || 'Profile created.'}</span>
              </div>
              {failed.length > 0 && (
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 space-y-1.5">
                  <p className="text-[11px] text-amber-200 leading-snug">
                    {(t.importFailed || '{n} addon(s) could not be installed and need adding by hand.').replace(
                      '{n}',
                      String(failed.length)
                    )}
                  </p>
                  <div className="max-h-24 overflow-y-auto custom-scrollbar">
                    {failed.map((name) => (
                      <div key={name} className="text-[10px] font-mono text-slate-500 truncate">
                        {name}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <button
                onClick={close}
                className="btn-primary w-full py-2.5 rounded-xl text-xs font-bold font-riot cursor-pointer"
              >
                {t.importClose || 'Done'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
