import React, { useSyncExternalStore } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { subscribe, getToasts, dismissToast } from '../../services/toastStore';

const ICONS = {
  success: <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />,
  error: <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />,
  info: <Info className="w-4 h-4 shrink-0 text-amber-400" />,
};

const COLOR_CLASSES = {
  success: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300',
  error: 'bg-red-500/10 border-red-500/30 text-red-300',
  info: 'bg-amber-500/10 border-amber-500/30 text-amber-300',
};

/**
 * Mounted once, at the top level (App.tsx). A notification used to be printed straight into a
 * page's own layout, which shoved everything below it down the moment one appeared — annoying
 * on any page tall enough to scroll. This floats over the page instead, fixed to the top,
 * capped at two at once (the store itself enforces that), so nothing else ever moves.
 */
export const ToastStack: React.FC = () => {
  const toasts = useSyncExternalStore(subscribe, getToasts);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[90] flex flex-col gap-2.5 items-center pointer-events-none w-full max-w-md px-4">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`w-full pointer-events-auto p-3.5 rounded-2xl border shadow-2xl flex items-center justify-between gap-3 text-xs animate-toast-in ${COLOR_CLASSES[toast.type]}`}
          style={{ backdropFilter: 'blur(12px)' }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            {ICONS[toast.type]}
            <span className="truncate">{toast.text}</span>
          </div>
          <button
            onClick={() => dismissToast(toast.id)}
            className="p-1 hover:bg-white/10 rounded-lg transition text-slate-400 hover:text-white cursor-pointer shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
};
