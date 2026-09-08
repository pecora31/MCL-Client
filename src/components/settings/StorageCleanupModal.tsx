import React, { useState, useEffect } from 'react';
import { HardDrive, Trash2, CheckCircle2, RefreshCw, X, Folder, AlertCircle, BrushCleaning, Sparkles, Check } from 'lucide-react';
import type { StorageCleanupScanResult, StorageCleanupReport } from '../../types';
import { invokeCommand } from '../../services/api';
import { getTranslation, type Language } from '../../locales/i18n';

interface StorageCleanupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCleanSuccess?: (bytesFreed: number) => void;
  language: Language;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export const StorageCleanupModal: React.FC<StorageCleanupModalProps> = ({
  isOpen,
  onClose,
  onCleanSuccess,
  language,
}) => {
  const t = getTranslation(language);

  const [scanResult, setScanResult] = useState<StorageCleanupScanResult | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);
  const [report, setReport] = useState<StorageCleanupReport | null>(null);

  // Selection toggles
  const [cleanVersions, setCleanVersions] = useState(true);
  const [cleanCache, setCleanCache] = useState(true);
  const [cleanOrphans, setCleanOrphans] = useState(true);

  useEffect(() => {
    if (isOpen) {
      handleScan();
      setReport(null);
    }
  }, [isOpen]);

  const handleScan = async () => {
    if (isScanning) return;
    setIsScanning(true);
    try {
      const result = await invokeCommand<StorageCleanupScanResult>('scan_storage_cleanup');
      setScanResult(result);
    } catch (err) {
      console.error('Failed to scan storage:', err);
    } finally {
      setIsScanning(false);
    }
  };

  const handleExecuteClean = async () => {
    if (!scanResult) return;
    setIsCleaning(true);
    try {
      const res = await invokeCommand<StorageCleanupReport>('execute_storage_cleanup', {
        cleanVersions,
        cleanCache,
        cleanOrphanedInstances: cleanOrphans,
      });
      setReport(res);
      if (onCleanSuccess) {
        onCleanSuccess(res.bytesFreed);
      }
      // Rescan in background to update stats
      const updatedScan = await invokeCommand<StorageCleanupScanResult>('scan_storage_cleanup');
      setScanResult(updatedScan);
    } catch (err) {
      console.error('Failed to clean storage:', err);
    } finally {
      setIsCleaning(false);
    }
  };

  if (!isOpen) return null;

  const totalSelectedBytes =
    (cleanVersions && scanResult ? scanResult.unusedVersions.reduce((acc, v) => acc + v.sizeBytes, 0) : 0) +
    (cleanOrphans && scanResult ? scanResult.orphanedInstancesBytes : 0) +
    (cleanCache && scanResult ? scanResult.tempCacheBytes : 0);

  const hasAnyCleanable =
    scanResult &&
    (scanResult.unusedVersions.length > 0 ||
      scanResult.orphanedInstances.length > 0 ||
      scanResult.tempCacheBytes > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fadeIn">
      <div
        className="w-full max-w-xl rounded-3xl border-2 border-white/[0.08] shadow-[0_32px_80px_-12px_rgba(0,0,0,0.9)] overflow-hidden flex flex-col min-h-[500px] max-h-[90vh] animate-scaleUp"
        style={{ background: 'rgba(12,12,14,0.96)', fontFamily: "'Plus Jakarta Sans', 'Inter', sans-serif" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-5 flex items-start justify-between border-b border-white/[0.04]">
          <div className="flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-[var(--accent-color)]/10 border border-[var(--accent-color)]/20 flex items-center justify-center text-[var(--accent-color)] shrink-0 mt-0.5">
              <BrushCleaning className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white tracking-wide leading-tight">
                {t.cleanStorageModalTitle || 'Clean Unused Versions & Cache'}
              </h2>
              <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                {t.cleanStorageModalSub || 'Reclaim disk space by safely removing unused resources and temporary files'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white flex items-center justify-center transition cursor-pointer active:scale-95 shrink-0"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="px-6 py-4 overflow-y-auto space-y-4 custom-scrollbar flex-1 min-h-[320px]">
          {/* Storage Root Information */}
          {scanResult && (
            <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-white/[0.02] border border-white/[0.06] text-xs text-slate-400 font-mono truncate">
              <Folder className="w-4 h-4 text-[var(--accent-color)] shrink-0" />
              <span className="truncate">{scanResult.storageRoot}</span>
            </div>
          )}

          {/* Success Banner if Cleanup Was Executed */}
          {report && (
            <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 flex items-start gap-3 animate-fadeIn">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <h4 className="text-xs font-bold text-emerald-200">{t.cleanSuccessTitle}</h4>
                <p className="text-xs mt-0.5">{report.message}</p>
              </div>
            </div>
          )}

          {/* Initial Scan Loading State (only when there's no data at all yet) */}
          {!scanResult && isScanning ? (
            <div className="min-h-[260px] flex flex-col items-center justify-center space-y-3 text-slate-400">
              <RefreshCw className="w-8 h-8 text-[var(--accent-color)] animate-spin" />
              <p className="text-xs font-semibold">{t.scanningStorage}</p>
            </div>
          ) : !hasAnyCleanable && !report ? (
            <div className="min-h-[260px] flex flex-col items-center justify-center space-y-3 text-center">
              <div className="w-12 h-12 rounded-2xl bg-white/[0.03] border border-white/[0.08] flex items-center justify-center text-emerald-400">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white">{t.reclaimableSpaceLabel || 'Reclaimable Space'}</h4>
                <p className="text-xs text-slate-400 mt-1 max-w-sm">{t.noCleanableFound}</p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Category 1: Unused Versions */}
              <div
                className={`p-4 rounded-2xl border transition-all duration-150 ${
                  cleanVersions ? 'bg-white/[0.03] border-white/10' : 'bg-white/[0.01] border-white/[0.04] opacity-50'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <label className="flex items-start gap-3 cursor-pointer select-none min-w-0 flex-1">
                    <input
                      type="checkbox"
                      checked={cleanVersions}
                      onChange={(e) => setCleanVersions(e.target.checked)}
                      disabled={!scanResult || scanResult.unusedVersions.length === 0}
                      className="w-4 h-4 mt-0.5 rounded border-white/20 text-[var(--accent-color)] focus:ring-0 bg-black/40 cursor-pointer accent-[var(--accent-color)]"
                    />
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-white flex items-center gap-2">
                        <span>{t.cleanUnusedVersionsTitle}</span>
                        {scanResult && (
                          <span className="text-[10px] px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-slate-300 font-mono font-bold">
                            {scanResult.unusedVersions.length} {t.versionsUnit || 'versions'}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">{t.cleanUnusedVersionsDesc}</p>
                    </div>
                  </label>

                  <span className="text-xs font-mono font-bold text-[var(--accent-light)] shrink-0">
                    {formatBytes(scanResult ? scanResult.unusedVersions.reduce((acc, v) => acc + v.sizeBytes, 0) : 0)}
                  </span>
                </div>

                {/* Sublist of unused versions */}
                {scanResult && scanResult.unusedVersions.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-white/5 space-y-1.5">
                    {scanResult.unusedVersions.map((v) => (
                      <div
                        key={v.version}
                        className="flex items-center justify-between text-[11px] px-2.5 py-1.5 rounded-lg bg-black/40 border border-white/5 text-slate-300 font-mono"
                      >
                        <span>Minecraft {v.version}</span>
                        <span className="text-slate-400">{formatBytes(v.sizeBytes)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Category 2: Orphaned Instances */}
              {scanResult && scanResult.orphanedInstances.length > 0 && (
                <div
                  className={`p-4 rounded-2xl border transition-all duration-150 ${
                    cleanOrphans ? 'bg-white/[0.03] border-white/10' : 'bg-white/[0.01] border-white/[0.04] opacity-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <label className="flex items-start gap-3 cursor-pointer select-none min-w-0 flex-1">
                      <input
                        type="checkbox"
                        checked={cleanOrphans}
                        onChange={(e) => setCleanOrphans(e.target.checked)}
                        className="w-4 h-4 mt-0.5 rounded border-white/20 text-[var(--accent-color)] focus:ring-0 bg-black/40 cursor-pointer accent-[var(--accent-color)]"
                      />
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-white flex items-center gap-2">
                          <span>{t.cleanOrphanedInstancesTitle}</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-slate-300 font-mono font-bold">
                            {scanResult.orphanedInstances.length} {t.foldersUnit || 'folders'}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">{t.cleanOrphanedInstancesDesc}</p>
                      </div>
                    </label>

                    <span className="text-xs font-mono font-bold text-[var(--accent-light)] shrink-0">
                      {formatBytes(scanResult.orphanedInstancesBytes)}
                    </span>
                  </div>
                </div>
              )}

              {/* Category 3: Temporary Cache and Logs */}
              <div
                className={`p-4 rounded-2xl border transition-all duration-150 ${
                  cleanCache ? 'bg-white/[0.03] border-white/10' : 'bg-white/[0.01] border-white/[0.04] opacity-50'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <label className="flex items-start gap-3 cursor-pointer select-none min-w-0 flex-1">
                    <input
                      type="checkbox"
                      checked={cleanCache}
                      onChange={(e) => setCleanCache(e.target.checked)}
                      disabled={!scanResult || scanResult.tempCacheBytes === 0}
                      className="w-4 h-4 mt-0.5 rounded border-white/20 text-[var(--accent-color)] focus:ring-0 bg-black/40 cursor-pointer accent-[var(--accent-color)]"
                    />
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-white">
                        <span>{t.cleanTempCacheTitle}</span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">{t.cleanTempCacheDesc}</p>
                    </div>
                  </label>

                  <span className="text-xs font-mono font-bold text-[var(--accent-light)] shrink-0">
                    {formatBytes(scanResult ? scanResult.tempCacheBytes : 0)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/[0.04] flex items-center justify-between gap-4">
          <div className="text-xs text-slate-400 flex items-center gap-2">
            <span>{t.reclaimableEstimate || 'Estimated reclaimable space:'}</span>
            <span className="font-mono font-bold text-[var(--accent-light)] text-sm">{formatBytes(totalSelectedBytes)}</span>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={handleScan}
              disabled={isScanning || isCleaning}
              className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 flex items-center justify-center transition cursor-pointer active:scale-95 disabled:opacity-40"
              title={t.rescanBtn || 'Rescan'}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin text-[var(--accent-color)]' : ''}`} />
            </button>

            <button
              type="button"
              onClick={handleExecuteClean}
              disabled={isCleaning || isScanning || totalSelectedBytes === 0}
              className="px-5 py-2.5 rounded-xl font-bold text-xs bg-[var(--accent-color)] hover:bg-[var(--accent-hover)] text-slate-950 flex items-center gap-2 transition cursor-pointer active:scale-95 disabled:opacity-40"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{isCleaning ? t.cleaning : t.btnStartClean}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
