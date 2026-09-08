import React, { useState } from 'react';
import { X, Server, Plus, Trash2, Edit2, Check, Wifi, Globe } from 'lucide-react';
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
      <div className="w-full max-w-2xl rounded-3xl bg-[#121212] border border-white/10 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-7 py-4 border-b border-white/[0.08] bg-[#161616]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/30 shadow-md">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white font-riot tracking-wide">{t.manageServersTitle || 'Manage Game Servers'}</h2>
              <p className="text-xs text-slate-400">{t.manageServersSub || 'Add, edit, remove, and select servers for direct in-game connection'}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 flex items-center justify-center transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-5">
          {/* Top Actions */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
              {t.savedServersCountLabel || 'Saved Servers'} ({servers.length})
            </span>
            {!isAddingNew && !editingId && (
              <button
                onClick={handleStartAdd}
                className="btn-primary py-2 px-4 rounded-xl text-xs font-riot font-bold flex items-center gap-2 shadow-md"
              >
                <Plus className="w-4 h-4" />
                <span>{t.addNewServerBtn || 'Add New Server'}</span>
              </button>
            )}
          </div>

          {/* Inline Add / Edit Form */}
          {(isAddingNew || editingId) && (
            <form onSubmit={handleSaveForm} className="p-4 rounded-2xl bg-white/[0.03] border border-amber-500/30 space-y-4 animate-fadeIn">
              <div className="text-xs font-bold text-amber-300 uppercase tracking-wider flex items-center gap-2">
                <Globe className="w-4 h-4 text-amber-400" />
                <span>{isAddingNew ? (t.addNewServerHeading || 'Add New Server') : (t.editServerHeading || 'Edit Server Details')}</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-1">{t.serverDisplayName || 'Display Name'}</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t.serverDisplayNamePlaceholder || 'e.g. Friends Server'}
                    required
                    className="w-full px-3 py-2 rounded-xl bg-[#181818] border border-white/10 text-xs text-white focus:outline-none focus:border-amber-400"
                  />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">{t.serverAddressLabel || 'IP Address / Hostname'}</label>
                    <input
                      type="text"
                      value={ip}
                      onChange={(e) => setIp(e.target.value)}
                      placeholder="play.ourserver.mc"
                      required
                      className="w-full px-3 py-2 rounded-xl bg-[#181818] border border-white/10 text-xs text-white font-mono focus:outline-none focus:border-amber-400"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">{t.serverPortLabel || 'Port'}</label>
                    <input
                      type="number"
                      value={port}
                      onChange={(e) => setPort(Number(e.target.value))}
                      className="w-full px-2.5 py-2 rounded-xl bg-[#181818] border border-white/10 text-xs text-white font-mono focus:outline-none focus:border-amber-400"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setIsAddingNew(false);
                    setEditingId(null);
                  }}
                  className="px-3.5 py-1.5 rounded-xl text-xs text-slate-400 hover:text-white transition"
                >
                  {t.cancel || 'Cancel'}
                </button>
                <button
                  type="submit"
                  className="btn-primary px-4 py-1.5 rounded-xl text-xs font-bold font-riot shadow"
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
                      className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
                        isActive
                          ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                          : 'bg-white/[0.04] text-slate-400 border-white/10'
                      }`}
                    >
                      <Wifi className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white text-sm truncate">{srv.name}</span>
                        {isActive && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/25 text-amber-300 border border-amber-500/40 font-mono tracking-wider">
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
                      className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition"
                      title={t.editServerTooltip || 'Edit server'}
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    {servers.length > 1 && (
                      <button
                        onClick={() => onDeleteServer(srv.id)}
                        className="p-2 rounded-xl text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition"
                        title={t.deleteServerTooltip || 'Delete server'}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
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
            className="btn-primary px-5 py-2 rounded-xl font-riot font-bold text-xs"
          >
            {t.completeBtn || 'Done'}
          </button>
        </div>
      </div>
    </div>
  );
};
