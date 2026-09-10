import React, { useState } from 'react';
import { Trash2, AlertTriangle, Check, ShieldAlert, Layers, HardDrive } from 'lucide-react';
import type { GameInstance } from '../../types';
import { getTranslation, type Language } from '../../locales/i18n';

interface DeleteProfileModalProps {
  isOpen: boolean;
  instance: GameInstance | null;
  allInstances: GameInstance[];
  onClose: () => void;
  onConfirmDelete: (instanceId: string, deleteVersionFiles: boolean) => Promise<void>;
  language: Language;
}

export const DeleteProfileModal: React.FC<DeleteProfileModalProps> = ({
  isOpen,
  instance,
  allInstances,
  onClose,
  onConfirmDelete,
  language,
}) => {
  const t = getTranslation(language);

  // Find if other profiles depend on this Minecraft version
  const dependentProfiles = instance
    ? allInstances.filter((i) => i.id !== instance.id && i.gameVersion === instance.gameVersion)
    : [];

  const hasDependencies = dependentProfiles.length > 0;

  // If no dependencies, default to thorough delete (true); otherwise false for safety
  const [deleteVersionFiles, setDeleteVersionFiles] = useState(!hasDependencies);
  const [isDeleting, setIsDeleting] = useState(false);

  // Reset checkbox state when modal opens or instance changes
  React.useEffect(() => {
    if (instance) {
      const deps = allInstances.filter((i) => i.id !== instance.id && i.gameVersion === instance.gameVersion);
      setDeleteVersionFiles(deps.length === 0);
      setIsDeleting(false);
    }
  }, [instance, allInstances]);

  if (!isOpen || !instance) return null;

  const handleDelete = async () => {
    try {
      setIsDeleting(true);
      await onConfirmDelete(instance.id, deleteVersionFiles);
      onClose();
    } catch (err) {
      console.error('Failed to delete instance:', err);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="glass-panel w-full max-w-lg rounded-3xl border border-red-500/20 shadow-2xl overflow-hidden animate-scaleUp">
        {/* Modal Header */}
        <div className="p-6 border-b border-white/5 flex items-center gap-4 bg-red-500/[0.03]">
          <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400 shrink-0">
            <Trash2 className="w-6 h-6" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold font-riot text-white tracking-wide">{t.modalDeleteProfileTitle}</h2>
            <p className="text-xs text-slate-400 mt-0.5">{t.modalDeleteProfileSub}</p>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {/* Target Profile Card */}
          <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center font-riot font-bold">
                <Layers className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h4 className="text-sm font-bold text-white truncate">{instance.name}</h4>
                <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5 font-medium">
                  <span>MC {instance.gameVersion}</span>
                  <span>•</span>
                  <span className="uppercase text-amber-400 font-semibold">{instance.loader}</span>
                </div>
              </div>
            </div>

            <div className="text-right shrink-0">
              <span className="text-[11px] px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-slate-300 font-medium">
                {instance.maxRam / 1024} GB RAM
              </span>
            </div>
          </div>

          {/* Primary Deletion Warning */}
          <div className="p-3.5 rounded-2xl bg-red-500/10 border border-red-500/20 text-xs text-red-300 flex items-start gap-3">
            <ShieldAlert className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <div className="leading-relaxed">
              <strong className="font-semibold text-red-200">{t.deleteProfileWarningPermanent || 'Permanently delete profile data: '}</strong>
              {t.deleteProfileWarning}
            </div>
          </div>

          {/* Thorough Deletion Section */}
          <div className="p-4 rounded-2xl bg-black/30 border border-white/5 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
              <HardDrive className="w-4 h-4 text-amber-400" />
              <span>{t.thoroughDeleteTitle}</span>
            </div>

            <label className="flex items-start gap-3 cursor-pointer group">
              <div className="pt-0.5">
                <input
                  type="checkbox"
                  checked={deleteVersionFiles}
                  onChange={(e) => setDeleteVersionFiles(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-700 text-amber-500 focus:ring-amber-500/20 bg-slate-900 cursor-pointer"
                />
              </div>
              <div className="text-xs leading-snug">
                <span className="font-semibold text-slate-200 group-hover:text-white transition">
                  {t.deleteVersionJarOption} <strong className="text-amber-400">{instance.gameVersion}</strong>
                </span>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {t.deleteProfileJarDesc || 'Delete client JAR file (~30MB) and JSON configs downloaded for this version.'}
                </p>
              </div>
            </label>

            {/* Smart Dependency Warning */}
            {deleteVersionFiles && hasDependencies && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-300 flex items-start gap-2.5 animate-fadeIn">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div className="leading-relaxed">
                  {t.deleteVersionWarningInUse.replace(
                    '{profiles}',
                    dependentProfiles.map((p) => `"${p.name}"`).join(', ')
                  )}
                </div>
              </div>
            )}

            {deleteVersionFiles && !hasDependencies && (
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-[11px] text-emerald-300 flex items-start gap-2.5 animate-fadeIn">
                <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div className="leading-relaxed">{t.deleteVersionSafe}</div>
              </div>
            )}
          </div>
        </div>

        {/* Modal Actions */}
        <div className="p-6 border-t border-white/5 flex items-center justify-end gap-3 bg-white/[0.01]">
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="px-5 py-2.5 rounded-xl border border-white/10 hover:bg-white/5 text-xs font-semibold text-slate-300 transition"
          >
            {t.btnCancel}
          </button>

          <button
            type="button"
            onClick={handleDelete}
            disabled={isDeleting}
            className="px-6 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-xs font-bold font-riot flex items-center gap-2 shadow-lg shadow-red-500/20 transition disabled:opacity-50 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{isDeleting ? t.deletingProfile : t.btnDeleteProfile}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
