import React, { useState } from 'react';
import { X, Server, Plus, Trash2, Edit2, Wifi, Globe } from 'lucide-react';
import type { SavedServer } from '../../types';
import { getTranslation, type Language } from '../../locales/i18n';

interface ServerManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  servers: SavedServer[];
  activeServerId: string;
  onSelectActiveServer: (id: string) => void;
  onAddServer: (server: Omit<SavedServer, 'id'>) => void;
  onUpdateServer: (server: SavedServer) => void;
  onDeleteServer: (id: string) => void;
  language?: Language;
}

export const ServerManagerModal: React.FC<ServerManagerModalProps> = ({
  isOpen,
  onClose,
  servers,
  activeServerId,
  onSelectActiveServer,
  onAddServer,
  onUpdateServer,
  onDeleteServer,
  language = 'en',
}) => {
  const t = getTranslation(language);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [serverToDelete, setServerToDelete] = useState<SavedServer | null>(null);

  // Form states
  const [name, setName] = useState('');
  const [ip, setIp] = useState('');
  const [port, setPort] = useState(25565);

  if (!isOpen) return null;

  const handleStartAdd = () => {
    setName('');
    setIp('');
    setPort(25565);
    setIsAddingNew(true);
    setEditingId(null);
  };

  const handleStartEdit = (srv: SavedServer) => {
    setName(srv.name);
    setIp(srv.ip);
    setPort(srv.port);
    setEditingId(srv.id);
    setIsAddingNew(false);
  };

  const handleSaveForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !ip.trim()) return;

    if (isAddingNew) {
      onAddServer({
        name: name.trim(),
        ip: ip.trim(),
        port: port || 25565,
      });
      setIsAddingNew(false);
    } else if (editingId) {
      onUpdateServer({
        id: editingId,
        name: name.trim(),
        ip: ip.trim(),
        port: port || 25565,
      });
      setEditingId(null);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
        <div className="w-full max-w-2xl rounded-3xl bg-[#121212] border border-white/10 shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4.5 border-b border-white/[0.08] bg-[#161616]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/30 shadow-md shrink-0">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white font-riot tracking-wide">{t.manageServersTitle || 'Manage Game Servers'}</h2>
              <p className="text-sm text-slate-400 mt-0.5">{t.manageServersSub || 'Add, edit, remove, and select servers for direct in-game connection'}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-[#2a2b2f]/90 hover:bg-[#383a40] text-white border border-white/10 shadow-lg flex items-center justify-center transition-all duration-150 active:scale-90 cursor-pointer"
            title="Close"
          >
            <X className="w-4.5 h-4.5 text-white" strokeWidth={3} />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-5 custom-scrollbar">
          {/* Top Actions */}
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-bold text-slate-200 uppercase tracking-wider">
              {t.savedServersCountLabel || 'Saved Servers'} ({servers.length})
            </span>
            {!isAddingNew && !editingId && (
              <button
                onClick={handleStartAdd}
                className="btn-primary py-2.5 px-4.5 rounded-xl text-sm font-riot font-bold flex items-center gap-2 shadow-md cursor-pointer active:scale-95 transition"
              >
                <Plus className="w-4 h-4" strokeWidth={3} />
                <span>{t.addNewServerBtn || 'Add New Server'}</span>
              </button>
            )}
          </div>

          {/* Inline Add / Edit Form */}
          {(isAddingNew || editingId) && (
            <form onSubmit={handleSaveForm} className="p-4.5 rounded-2xl bg-white/[0.03] border border-amber-500/30 space-y-4 animate-fadeIn">
              <div className="text-[13px] font-bold text-amber-300 uppercase tracking-wider flex items-center gap-2">
                <Globe className="w-4 h-4 text-amber-400" />
                <span>{isAddingNew ? (t.addNewServerHeading || 'Add New Server') : (t.editServerHeading || 'Edit Server Details')}</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">{t.serverDisplayName || 'Display Name'}</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t.serverDisplayNamePlaceholder || 'e.g. Friends Server'}
                    required
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#181818] border border-white/10 text-sm font-semibold text-white focus:outline-none focus:border-amber-400"
                  />
                </div>
                <div className="grid grid-cols-3 gap-2.5">
                  <div className="col-span-2">
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">{t.serverAddressLabel || 'IP Address / Hostname'}</label>
                    <input
                      type="text"
                      value={ip}
                      onChange={(e) => setIp(e.target.value)}
                      placeholder="play.ourserver.mc"
                      required
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#181818] border border-white/10 text-sm font-semibold text-white font-mono focus:outline-none focus:border-amber-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">{t.serverPortLabel || 'Port'}</label>
                    <input
                      type="number"
                      value={port}
                      onChange={(e) => setPort(Number(e.target.value))}
                      className="w-full px-3 py-2.5 rounded-xl bg-[#181818] border border-white/10 text-sm font-semibold text-white font-mono focus:outline-none focus:border-amber-400"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setIsAddingNew(false);
                    setEditingId(null);
                  }}
                  className="px-4 py-2 rounded-xl text-sm font-semibold text-slate-400 hover:text-white transition cursor-pointer"
                >
                  {t.cancel || 'Cancel'}
                </button>
                <button
                  type="submit"
                  className="btn-primary px-5 py-2 rounded-xl text-sm font-bold font-riot shadow-md cursor-pointer active:scale-95"
                >
                  {isAddingNew ? (t.saveServer || 'Save Server') : (t.updateBtn || 'Update')}
                </button>
              </div>
            </form>
          )}

          {/* List of Servers */}
          <div className="space-y-2.5">
            {servers.map((srv) => {
              const isActive = srv.id === activeServerId;

              return (
                <div
                  key={srv.id}
                  onClick={() => onSelectActiveServer(srv.id)}
                  className={`p-4 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-4 ${
                    isActive
                      ? 'bg-amber-500/10 border-amber-500/40 shadow-lg'
                      : 'bg-[#161616] hover:bg-[#1a1a1a] border-white/[0.06] hover:border-white/15'
                  }`}
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div
                      className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 border ${
                        isActive
                          ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                          : 'bg-white/[0.04] text-slate-400 border-white/10'
                      }`}
                    >
                      <Wifi className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white text-base truncate">{srv.name}</span>
                        {isActive && (
                          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500/25 text-amber-300 border border-amber-500/40 font-mono tracking-wider">
                            {t.activeServerTag || 'ACTIVE'}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-400 font-mono mt-0.5 truncate">
                        {srv.ip}{srv.port && srv.port !== 25565 ? `:${srv.port}` : ''}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => handleStartEdit(srv)}
                      className="p-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
                      title={t.editServerTooltip || 'Edit server'}
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setServerToDelete(srv)}
                      className="p-2.5 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition cursor-pointer"
                      title={t.deleteServerTooltip || 'Delete server'}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/[0.08] bg-[#161616] flex justify-between items-center text-xs text-slate-400">
          <span>{t.directConnectTip || '* Enable "Connect on Play" on the home screen to automatically connect when clicking PLAY.'}</span>
          <button
            onClick={onClose}
            className="btn-primary px-6 py-2.5 rounded-xl font-riot font-bold text-sm shadow-md cursor-pointer active:scale-95"
          >
            {t.completeBtn || 'Done'}
          </button>
        </div>
      </div>
    </div>

      {/* Delete Server Confirmation Modal */}
      {serverToDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-md rounded-3xl bg-[#141416] border border-white/10 shadow-2xl p-6 space-y-5 animate-scaleUp">
            {/* Header / Icon */}
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-2xl bg-rose-500/15 text-rose-400 border border-rose-500/30 flex items-center justify-center shrink-0 shadow-lg">
                <Trash2 className="w-6 h-6 stroke-[2]" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white font-riot tracking-wide">
                  {t.deleteServer || 'Delete Server'}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {t.deleteServerConfirm || 'Are you sure you want to delete this server?'}
                </p>
              </div>
            </div>

            {/* Target Server Card Preview */}
            <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/[0.08] flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/[0.04] border border-white/10 flex items-center justify-center text-[var(--accent-color)] shrink-0">
                <Server className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-bold text-sm text-white truncate">
                  {serverToDelete.name}
                </div>
                <div className="text-xs text-slate-400 font-mono truncate mt-0.5">
                  {serverToDelete.ip}{serverToDelete.port && serverToDelete.port !== 25565 ? `:${serverToDelete.port}` : ''}
                </div>
              </div>
            </div>

            {/* Warning description */}
            <p className="text-xs text-slate-400 leading-relaxed">
              {t.deleteServerDesc || 'This will remove the server from your saved list. You can add it back at any time.'}
            </p>

            {/* Actions */}
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setServerToDelete(null)}
                className="flex-1 py-2.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-bold text-slate-300 hover:text-white transition cursor-pointer active:scale-95"
              >
                {t.cancel}
              </button>
              <button
                type="button"
                onClick={() => {
                  onDeleteServer(serverToDelete.id);
                  setServerToDelete(null);
                }}
                className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-rose-950/40 active:scale-95"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{t.btnDeleteAddon}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
