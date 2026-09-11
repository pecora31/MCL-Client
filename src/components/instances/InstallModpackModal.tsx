import React, { useState } from 'react';
import {
  X,
  Package,
  FileArchive,
  Layers,
  Cpu,
  HardDrive,
  CheckCircle2,
  AlertCircle,
  Loader2,
  FolderOpen,
} from 'lucide-react';
import type { GameInstance, MrpackManifestSummary } from '../../types';
import { selectMrpackFile, inspectMrpack, installMrpack } from '../../services/api';
import { getTranslation, type Language } from '../../locales/i18n';

interface InstallModpackModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (newInstance: GameInstance) => void;
  language?: Language;
  initialFilePath?: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export const InstallModpackModal: React.FC<InstallModpackModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  language = 'en',
  initialFilePath,
}) => {
  const t = getTranslation(language);
  const [selectedFile, setSelectedFile] = useState<string>('');
  const [manifest, setManifest] = useState<MrpackManifestSummary | null>(null);
  const [customName, setCustomName] = useState<string>('');
  const [isInspecting, setIsInspecting] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inspectPath = async (path: string) => {
    setError(null);
    setIsInspecting(true);
    try {
      const summary = await inspectMrpack(path);
      setManifest(summary);
      setCustomName(summary.name);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || t.inspectMrpackError || 'Failed to inspect modpack file');
      setManifest(null);
    } finally {
      setIsInspecting(false);
    }
  };

  React.useEffect(() => {
    if (isOpen && initialFilePath) {
      setSelectedFile(initialFilePath);
      inspectPath(initialFilePath);
    } else if (isOpen && !initialFilePath) {
      setSelectedFile('');
      setManifest(null);
      setCustomName('');
    }
  }, [isOpen, initialFilePath]);

  if (!isOpen) return null;

  const handlePickFile = async () => {
    setError(null);
    try {
      const path = await selectMrpackFile();
      if (!path) return;
      setSelectedFile(path);
      await inspectPath(path);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || t.inspectMrpackError || 'Failed to inspect modpack file');
      setManifest(null);
    }
  };

  const handleInstall = async () => {
    if (!selectedFile) return;
    setError(null);
    setIsInstalling(true);

    try {
      const newInstance = await installMrpack(selectedFile, customName);
      onSuccess(newInstance);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || t.installMrpackError || 'Error installing modpack');
    } finally {
      setIsInstalling(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="relative w-full max-w-2xl bg-[#121212] border border-white/10 rounded-3xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4.5 border-b border-white/[0.08] bg-[#161616]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center shrink-0">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold font-riot text-white tracking-wide">
                {t.installModpackTitle || 'Install Modpack (.mrpack)'}
              </h3>
              <p className="text-sm text-slate-400 mt-0.5">
                {t.installModpackSub || 'Import Modrinth Modpack package to auto-configure & download'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isInstalling}
            className="w-9 h-9 rounded-xl bg-[#2a2b2f]/90 hover:bg-[#383a40] text-white border border-white/10 shadow-lg flex items-center justify-center transition-all duration-150 active:scale-90 cursor-pointer disabled:opacity-50"
          >
            <X className="w-4.5 h-4.5 text-white" strokeWidth={3} />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-5 overflow-y-auto custom-scrollbar flex-1">
          {/* File Picker Section */}
          <div>
            <label className="block text-[13px] font-bold text-slate-200 uppercase tracking-wider mb-2">
              {t.modpackFileLabel || 'Modpack File (.mrpack)'}
            </label>
            <div className="flex gap-2.5">
              <div
                onClick={!isInstalling ? handlePickFile : undefined}
                className={`flex-1 flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.03] border border-white/10 text-sm text-slate-300 truncate cursor-pointer hover:border-[var(--accent-color)]/50 transition ${
                  isInstalling ? 'opacity-50 cursor-not-allowed' : ''
                }`}
              >
                <FileArchive className="w-5 h-5 text-[var(--accent-color)] shrink-0" />
                <span className="truncate font-medium">
                  {selectedFile || t.selectMrpackPrompt || 'Click to select .mrpack file...'}
                </span>
              </div>
              <button
                onClick={handlePickFile}
                disabled={isInstalling || isInspecting}
                className="btn-secondary px-5 rounded-xl text-sm font-bold flex items-center gap-2 shrink-0 cursor-pointer active:scale-95 transition"
              >
                {isInspecting ? (
                  <Loader2 className="w-4 h-4 animate-spin text-[var(--accent-color)]" />
                ) : (
                  <FolderOpen className="w-4 h-4 text-amber-400" />
                )}
                <span>{t.browseWord || 'Browse...'}</span>
              </button>
            </div>
          </div>

          {/* Error notice */}
          {error && (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Manifest Summary Card (When file is inspected) */}
          {manifest && (
            <div className="space-y-4.5 rounded-2xl bg-white/[0.02] border border-white/[0.08] p-4.5">
              {/* Profile Name Input */}
              <div>
                <label className="block text-[13px] font-bold text-slate-200 uppercase tracking-wider mb-2">
                  {t.profileNameLabel || 'Instance Profile Name'}
                </label>
                <input
                  type="text"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  disabled={isInstalling}
                  placeholder="Modpack Name"
                  className="w-full px-4 py-3 rounded-xl bg-[#141416] border border-white/10 text-white text-base font-semibold focus:border-amber-400 focus:outline-none transition"
                />
              </div>

              {manifest.summary && (
                <p className="text-sm text-slate-400 italic line-clamp-2 leading-relaxed">
                  "{manifest.summary}"
                </p>
              )}

              {/* Grid specs */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5 flex items-center gap-3">
                  <Layers className="w-5 h-5 text-[var(--accent-color)] shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[11px] text-slate-400 uppercase font-bold tracking-wider">Minecraft</div>
                    <div className="text-sm font-bold text-white truncate mt-0.5">{manifest.gameVersion}</div>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5 flex items-center gap-3">
                  <Cpu className="w-5 h-5 text-[var(--accent-color)] shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[11px] text-slate-400 uppercase font-bold tracking-wider">Loader</div>
                    <div className="text-sm font-bold text-white capitalize truncate mt-0.5">
                      {manifest.loader} {manifest.loaderVersion ? `(${manifest.loaderVersion})` : ''}
                    </div>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5 flex items-center gap-3">
                  <Package className="w-5 h-5 text-[var(--accent-color)] shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[11px] text-slate-400 uppercase font-bold tracking-wider">
                      {t.modFilesCountLabel || 'Mod Files'}
                    </div>
                    <div className="text-sm font-bold text-white mt-0.5">{manifest.totalFiles} mods</div>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5 flex items-center gap-3">
                  <HardDrive className="w-5 h-5 text-[var(--accent-color)] shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[11px] text-slate-400 uppercase font-bold tracking-wider">
                      {t.downloadSizeLabel || 'Download Size'}
                    </div>
                    <div className="text-sm font-bold text-white mt-0.5">{formatBytes(manifest.totalSizeBytes)}</div>
                  </div>
                </div>
              </div>

              <div className="text-xs text-slate-400 flex items-center gap-2 pt-1 font-medium">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>
                  {t.autoExtractNotice || 'Automatically extracts overrides/ configs and downloads all required mods.'}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-white/[0.08] flex items-center justify-end gap-3 bg-[#161616]/50">
          <button
            onClick={onClose}
            disabled={isInstalling}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold text-slate-400 hover:text-white transition disabled:opacity-50 cursor-pointer"
          >
            {t.cancel || 'Cancel'}
          </button>

          <button
            onClick={handleInstall}
            disabled={!manifest || isInstalling}
            className="btn-primary px-6 py-2.5 rounded-xl text-sm font-bold font-riot flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-md cursor-pointer active:scale-95 transition"
          >
            {isInstalling ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{t.installingModpack || 'Installing Modpack...'}</span>
              </>
            ) : (
              <>
                <Package className="w-4 h-4" />
                <span>{t.installProfileBtn || 'Install Profile'}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
