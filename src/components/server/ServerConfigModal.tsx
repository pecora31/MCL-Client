import React, { useState } from 'react';
import { X, Settings2, FolderOpen, AlertCircle, Save, Check } from 'lucide-react';
import { invokeCommand, isTauri } from '../../services/api';
import type { ServerPropertiesSummary } from '../../types';
import { getTranslation, type Language } from '../../locales/i18n';
import { Checkbox } from '../common/Checkbox';
import { CustomSelect, type SelectOption } from '../common/CustomSelect';

interface ServerConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  language: Language;
}

/**
 * A friendly editor for the handful of server.properties settings people actually change —
 * online-mode above all, the one that silently blocks every offline-account friend group
 * from joining. Works on any server folder already on disk; MCL neither runs nor needs to
 * know about the server otherwise. Writing only touches the lines this form owns — every
 * other setting and comment in the file is left exactly as it was (see server_config.rs).
 */
export const ServerConfigModal: React.FC<ServerConfigModalProps> = ({ isOpen, onClose, language }) => {
  const t = getTranslation(language);
  const [folder, setFolder] = useState('');
  const [summary, setSummary] = useState<ServerPropertiesSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const difficultyOptions: SelectOption<ServerPropertiesSummary['difficulty']>[] = [
    { value: 'peaceful', label: t.difficultyPeaceful || 'Peaceful' },
    { value: 'easy', label: t.difficultyEasy || 'Easy' },
    { value: 'normal', label: t.difficultyNormal || 'Normal' },
    { value: 'hard', label: t.difficultyHard || 'Hard' },
  ];

  const handlePickFolder = async () => {
    setError('');
    setSaved(false);
    if (!isTauri()) {
      setError(t.serverConfigNoNativePicker || 'Folder picking needs the desktop app.');
      return;
    }
    try {
      const chosen = await invokeCommand<string | null>('select_folder', { defaultPath: folder || undefined });
      if (!chosen) return;
      setFolder(chosen);
      setIsLoading(true);
      const result = await invokeCommand<ServerPropertiesSummary>('read_server_properties', { dir: chosen });
      setSummary(result);
    } catch (err) {
      setSummary(null);
      setError(
        t.serverConfigNotFound ||
          "No server.properties in that folder. Pick the folder that has your server's run file in it."
      );
      console.warn('Could not read server.properties:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    if (!summary) return;
    setIsSaving(true);
    setError('');
    try {
      await invokeCommand('write_server_properties', { dir: folder, summary });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(t.serverConfigSaveFailed || 'Could not save server.properties.');
      console.warn('Could not write server.properties:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const update = (patch: Partial<ServerPropertiesSummary>) =>
    setSummary((prev) => (prev ? { ...prev, ...patch } : prev));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn" onClick={onClose}>
      <div
        className="w-full max-w-xl rounded-3xl border border-white/10 shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-scaleUp bg-[#121212]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4.5 flex items-center justify-between border-b border-white/[0.08] bg-[#161616]">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center shrink-0">
              <Settings2 className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold font-riot text-white tracking-wide leading-tight">
                {t.serverConfigTitle || 'Server Config'}
              </h2>
              <p className="text-sm text-slate-400 mt-0.5 leading-relaxed">
                {t.serverConfigSub || "Edit a server's online-mode and a few other common settings"}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-[#2a2b2f]/90 hover:bg-[#383a40] text-white border border-white/10 shadow-lg flex items-center justify-center transition-all duration-150 active:scale-90 cursor-pointer shrink-0"
            title={t.close || 'Close'}
          >
            <X className="w-4.5 h-4.5 text-white" strokeWidth={3} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 overflow-y-auto space-y-4 custom-scrollbar flex-1">
          {/* Folder picker */}
          <div>
            <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
              {t.serverConfigFolderLabel || 'Server Folder'}
            </label>
            <button
              type="button"
              onClick={handlePickFolder}
              disabled={isLoading}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.03] border border-white/10 text-sm text-slate-300 truncate cursor-pointer hover:border-[var(--accent-color)]/50 transition disabled:opacity-50"
            >
              <FolderOpen className="w-5 h-5 text-[var(--accent-color)] shrink-0" />
              <span className="truncate font-medium">
                {folder || t.serverConfigFolderPrompt || 'Click to select your server folder...'}
              </span>
            </button>
          </div>

          {isLoading && (
            <p className="text-sm text-slate-400 text-center py-2">{t.serverConfigReading || 'Reading server.properties...'}</p>
          )}

          {error && (
            <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm flex items-start gap-2.5">
              <AlertCircle className="w-4.5 h-4.5 text-red-400 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {summary && (
            <div className="space-y-3 animate-fadeIn">
              <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06]">
                <Checkbox checked={summary.onlineMode} onChange={(v) => update({ onlineMode: v })} align="start">
                  <div>
                    <div className="text-sm font-bold text-white">{t.serverConfigOnlineMode || 'Require a Microsoft account'}</div>
                    <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                      {t.serverConfigOnlineModeDesc ||
                        "Off lets offline accounts join — turn this off for a group all using offline accounts, or no one can connect."}
                    </p>
                  </div>
                </Checkbox>
              </div>

              <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-3.5">
                <Checkbox checked={summary.pvp} onChange={(v) => update({ pvp: v })}>
                  <span className="text-sm font-semibold text-white">{t.serverConfigPvp || 'Players can fight each other'}</span>
                </Checkbox>
                <Checkbox checked={summary.whiteList} onChange={(v) => update({ whiteList: v })}>
                  <span className="text-sm font-semibold text-white">{t.serverConfigWhitelist || 'Only allow listed players'}</span>
                </Checkbox>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                    {t.serverConfigDifficulty || 'Difficulty'}
                  </label>
                  <CustomSelect value={summary.difficulty} onChange={(v) => update({ difficulty: v })} options={difficultyOptions} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                    {t.serverConfigMaxPlayers || 'Max Players'}
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={summary.maxPlayers}
                    onChange={(e) => update({ maxPlayers: Math.max(1, Number(e.target.value) || 1) })}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#1a1a1a] border border-white/10 text-sm text-white focus:outline-none focus:border-[var(--accent-color)]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                  {t.serverConfigMotd || 'Server Description (MOTD)'}
                </label>
                <input
                  type="text"
                  value={summary.motd}
                  onChange={(e) => update({ motd: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#1a1a1a] border border-white/10 text-sm text-white focus:outline-none focus:border-[var(--accent-color)]"
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {summary && (
          <div className="px-6 py-4 border-t border-white/[0.08] bg-[#161616]/50 flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              {t.serverConfigRestartHint || 'Restart the server for changes to take effect.'}
            </p>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="btn-primary px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 cursor-pointer active:scale-95 transition disabled:opacity-50 shrink-0"
            >
              {saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
              <span>{saved ? t.saved || 'Saved' : isSaving ? t.saving || 'Saving...' : t.btnSave || 'Save'}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ServerConfigModal;
