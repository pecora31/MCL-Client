import React, { useEffect, useRef } from 'react';
import { X, Terminal, Copy, Trash2, Check, Download } from 'lucide-react';
import { getTranslation, type Language } from '../../locales/i18n';

interface ConsoleModalProps {
  isOpen: boolean;
  onClose: () => void;
  logs: string[];
  onClearLogs: () => void;
  onExportLog?: () => void;
  language?: Language;
}

export const ConsoleModal: React.FC<ConsoleModalProps> = ({
  isOpen,
  onClose,
  logs,
  onClearLogs,
  onExportLog,
  language = 'en',
}) => {
  const t = getTranslation(language);
  const [copied, setCopied] = React.useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, isOpen]);

  const handleCopy = () => {
    navigator.clipboard.writeText(logs.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 animate-fadeIn">
      <div className="w-full max-w-4xl h-[650px] rounded-3xl bg-[#090b10] border border-white/10 shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-[#0d1017]">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-bold text-white">{t.consoleTitle || 'Console Logs'}</h3>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition"
              title={t.copyAllLogs || 'Copy all logs'}
            >
              {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            </button>
            {onExportLog && (
              <button
                onClick={onExportLog}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition"
                title="Save this log to a file"
              >
                <Download className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={onClearLogs}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition"
              title={t.clearScreen || 'Clear console'}
            >
              <Trash2 className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-xl bg-[#2a2b2f]/90 hover:bg-[#383a40] text-white border border-white/10 shadow-lg flex items-center justify-center transition-all duration-150 active:scale-90 cursor-pointer"
              title={t.close || 'Close'}
            >
              <X className="w-3.5 h-3.5 text-white" strokeWidth={3} />
            </button>
          </div>
        </div>

        {/* Console output */}
        <div className="flex-1 p-4 overflow-y-auto font-mono text-xs text-slate-300 space-y-1 bg-[#06080e] select-text">
          {logs.length === 0 ? (
            <div className="text-slate-600 italic">{t.noLogsYet || 'No logs yet... Ready to capture game events.'}</div>
          ) : (
            logs.map((log, idx) => {
              const isError = log.includes('ERROR') || log.includes('Exception') || log.includes('Caused by:');
              const isCrash = log.includes('CRASH') || log.includes('crash');
              const isWarn = log.includes('WARN');
              const isInfo = log.includes('INFO');
              const isMCL = log.includes('[MCL]') || log.includes('[MCL/');
              const isJavaSelect = log.includes('[MCL/Java]');

              return (
                <div
                  key={idx}
                  className={`leading-relaxed break-all ${
                    isCrash
                      ? 'text-red-300 bg-red-950/40 px-2 py-0.5 rounded font-bold border-l-2 border-red-500'
                      : isError
                      ? 'text-red-400 bg-red-950/20 px-1 rounded'
                      : isJavaSelect
                      ? 'text-cyan-400'
                      : isMCL
                      ? 'text-[var(--accent-color)]'
                      : isWarn
                      ? 'text-amber-300'
                      : isInfo
                      ? 'text-slate-300'
                      : 'text-slate-400'
                  }`}
                >
                  {log}
                </div>
              );
            })
          )}
          <div ref={endRef} />
        </div>
      </div>
    </div>
  );
};
