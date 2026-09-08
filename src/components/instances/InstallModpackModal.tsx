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
      <div className="relative w-full max-w-lg bg-[#141414] border border-white/10 rounded-3xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[var(--accent-color)]/10 border border-[var(--accent-color)]/20 flex items-center justify-center text-[var(--accent-color)]">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white tracking-wide">
                {t.installModpackTitle || 'Install Modpack (.mrpack)'}
              </h3>
              <p className="text-xs text-slate-400">
                {t.installModpackSub || 'Import Modrinth Modpack package to auto-configure & download'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isInstalling}
            className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-5">
          {/* File Picker Section */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              {t.modpackFileLabel || 'Modpack File (.mrpack)'}
            </label>
            <div className="flex gap-2">
              <div
                onClick={!isInstalling ? handlePickFile : undefined}
                className={`flex-1 flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-white/[0.03] border border-white/10 text-xs text-slate-300 truncate cursor-pointer hover:border-[var(--accent-color)]/50 transition ${
                  isInstalling ? 'opacity-50 cursor-not-allowed' : ''
                }`}
              >
                <FileArchive className="w-4 h-4 text-[var(--accent-color)] shrink-0" />
                <span className="truncate">
                  {selectedFile || t.selectMrpackPrompt || 'Click to select .mrpack file...'}
                </span>
              </div>
              <button
                onClick={handlePickFile}
                disabled={isInstalling || isInspecting}
                className="btn-secondary px-4 rounded-2xl text-xs font-bold flex items-center gap-1.5 shrink-0"
              >
                {isInspecting ? (
                  <Loader2 className="w-4 h-4 animate-spin text-[var(--accent-color)]" />
                ) : (
                  <FolderOpen className="w-4 h-4" />
                )}
                <span>{t.browseWord || 'Browse...'}</span>
              </button>
            </div>
          </div>

          {/* Error notice */}
          {error && (
            <div className="p-3.5 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Manifest Summary Card (When file is inspected) */}
          {manifest && (
            <div className="space-y-4 rounded-2xl bg-white/[0.02] border border-white/[0.08] p-4">
              {/* Profile Name Input */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                  {t.profileNameLabel || 'Instance Profile Name'}
                </label>
                <input
                  type="text"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  disabled={isInstalling}
                  placeholder="Modpack Name"
                  className="w-full px-4 py-2.5 rounded-xl bg-black/40 border border-white/10 text-white text-xs font-medium focus:border-[var(--accent-color)] focus:outline-none transition"
                />
              </div>

              {manifest.summary && (
                <p className="text-xs text-slate-400 italic line-clamp-2">
                  "{manifest.summary}"
                </p>
              )}

              {/* Grid specs */}
              <div className="grid grid-cols-2 gap-2.5 pt-1">
                <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5 flex items-center gap-2.5">
                  <Layers className="w-4 h-4 text-[var(--accent-color)] shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Minecraft</div>
                    <div className="text-xs font-bold text-white truncate">{manifest.gameVersion}</div>
                  </div>
                </div>

                <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5 flex items-center gap-2.5">
                  <Cpu className="w-4 h-4 text-[var(--accent-color)] shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Loader</div>
                    <div className="text-xs font-bold text-white capitalize truncate">
                      {manifest.loader} {manifest.loaderVersion ? `(${manifest.loaderVersion})` : ''}
                    </div>
                  </div>
                </div>

                <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5 flex items-center gap-2.5">
                  <Package className="w-4 h-4 text-[var(--accent-color)] shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">
                      {t.modFilesCountLabel || 'Mod Files'}
                    </div>
                    <div className="text-xs font-bold text-white">{manifest.totalFiles} mods</div>
                  </div>
                </div>

                <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5 flex items-center gap-2.5">
                  <HardDrive className="w-4 h-4 text-[var(--accent-color)] shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">
                      {t.downloadSizeLabel || 'Download Size'}
                    </div>
                    <div className="text-xs font-bold text-white">{formatBytes(manifest.totalSizeBytes)}</div>
                  </div>
                </div>
              </div>

              <div className="text-[11px] text-slate-400 flex items-center gap-1.5 pt-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-[var(--accent-color)]" />
                <span>
                  {t.autoExtractNotice || 'Automatically extracts overrides/ configs and downloads all required mods.'}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-6 border-t border-white/5 flex items-center justify-end gap-3 bg-white/[0.01]">
          <button
            onClick={onClose}
            disabled={isInstalling}
            className="btn-secondary px-5 py-2.5 rounded-2xl text-xs font-bold text-slate-400 hover:text-white transition disabled:opacity-50"
          >
            {t.cancel || 'Cancel'}
          </button>

          <button
            onClick={handleInstall}
            disabled={!manifest || isInstalling}
            className="btn-primary px-6 py-2.5 rounded-2xl text-xs font-bold flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition"
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
