import React, { useEffect, useRef, useState } from 'react';
import {
  Radio,
  Users,
  User,
  X,
  Copy,
  Check,
  Power,
  Loader2,
  Lock,
  Unlock,
  UserX,
  AlertCircle,
  Plus,
  ArrowLeft,
  Sparkles,
  Globe,
  Trash2,
} from 'lucide-react';
import {
  p2pStartHost,
  p2pStopHost,
  p2pGetHostStatus,
  p2pKickPeer,
  p2pToggleLock,
  p2pStartClient,
  p2pStopClient,
  p2pGetClientStatus,
} from '../../services/api';
import {
  loadP2PRoomHistory,
  rememberJoinedRoom,
  forgetP2PRoom,
  forgetP2PRoomByTicket,
  formatRelativeTime,
  type P2PRoomHistoryEntry,
} from '../../services/p2pRoomHistory';
import type { P2PHostStatus, P2PClientStatus, P2PMemberInfo, Account } from '../../types';
import { getTranslation, type Language } from '../../locales/i18n';

interface P2PFloatingWidgetProps {
  language: Language;
}

type PanelView = 'closed' | 'list' | 'create' | 'join' | 'active';

function readCurrentAccount(): Account | null {
  try {
    const raw = localStorage.getItem('mcl_account');
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {
    // Fallback below
  }
  return null;
}

function readCurrentUsername(): string {
  return readCurrentAccount()?.username || 'Player';
}

function renderPingBadge(pingMs: number | null | undefined, isHost: boolean) {
  if (isHost || pingMs == null || pingMs === 0) {
    return null;
  }
  const colorClass =
    pingMs < 45
      ? 'text-emerald-400'
      : pingMs < 90
      ? 'text-amber-400'
      : 'text-rose-400';
  return (
    <span className={`text-[10px] font-mono font-medium ${colorClass}`}>
      {pingMs.toFixed(0)} ms
    </span>
  );
}

function avatarLetter(name: string): string {
  return (name.trim()[0] || '?').toUpperCase();
}

/** Player Avatar: custom profile avatar if set, else clean default User icon */
const PlayerAvatar: React.FC<{ username: string; size?: number }> = ({ username, size = 28 }) => {
  const account = readCurrentAccount();
  const isMe = account && username.trim().toLowerCase() === account.username.trim().toLowerCase();
  const customAvatar = isMe ? account.avatarCustom : undefined;

  if (customAvatar) {
    return (
      <img
        src={customAvatar}
        alt={username}
        className="rounded-lg shrink-0 object-cover bg-black/60 border border-white/10"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <div
      className="rounded-lg flex items-center justify-center shrink-0 select-none bg-white/5 text-slate-300 border border-white/10"
      style={{ width: size, height: size }}
    >
      <User className="w-3.5 h-3.5 text-slate-300" />
    </div>
  );
};

export const P2PFloatingWidget: React.FC<P2PFloatingWidgetProps> = ({ language }) => {
  const t = getTranslation(language);
  const currentUsername = readCurrentUsername();

  const [hostStatus, setHostStatus] = useState<P2PHostStatus | null>(null);
  const [clientStatus, setClientStatus] = useState<P2PClientStatus | null>(null);
  const [view, setView] = useState<PanelView>('closed');
  const [history, setHistory] = useState<P2PRoomHistoryEntry[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);

  const [roomName, setRoomName] = useState('MCL Room');
  const [hostPassword, setHostPassword] = useState('');
  const [hostPortText, setHostPortText] = useState('25565');
  const [isStartingHost, setIsStartingHost] = useState(false);
  const [createError, setCreateError] = useState('');

  const [joinTicket, setJoinTicket] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [joinError, setJoinError] = useState('');

  const [copied, setCopied] = useState(false);
  const [kickingNodeId, setKickingNodeId] = useState<string | null>(null);

  const isHosting = !!hostStatus?.isRunning;
  const isClientActive = !!(clientStatus?.isConnected || clientStatus?.isReconnecting);
  const isActive = isHosting || isClientActive;
  const activeRoomName = isHosting ? hostStatus?.roomName || 'MCL Room' : clientStatus?.roomName || 'MCL Room';
  const peerCount = isHosting
    ? hostStatus?.connectedPeersCount ?? 0
    : (clientStatus?.members?.length || 1) - 1;

  useEffect(() => {
    setHistory(loadP2PRoomHistory());
    refreshHostStatus();
    refreshClientStatus();
  }, []);

  useEffect(() => {
    if (!isActive) return;
    const interval = setInterval(() => {
      if (isHosting) refreshHostStatus();
      if (isClientActive) refreshClientStatus();
    }, 2500);
    return () => clearInterval(interval);
  }, [isHosting, isClientActive]);

  // Close the panel on outside click or Escape key
  useEffect(() => {
    if (view === 'closed') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setView('closed');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [view]);

  const refreshHostStatus = async () => {
    try {
      setHostStatus(await p2pGetHostStatus());
    } catch {
      // Browser preview fallback
    }
  };

  const refreshClientStatus = async () => {
    try {
      const status = await p2pGetClientStatus();
      setClientStatus(status);
      if (!status.isConnected && !status.isReconnecting && status.error) {
        const staleMarker = 'STALE_TICKET::';
        setJoinError(
          status.error.includes(staleMarker)
            ? status.error.slice(status.error.indexOf(staleMarker) + staleMarker.length)
            : status.error
        );
      }
    } catch {
      // Browser preview fallback
    }
  };

  const handleCreateRoom = async () => {
    setIsStartingHost(true);
    setCreateError('');
    try {
      const port = Number(hostPortText) || 25565;
      const status = await p2pStartHost(roomName.trim() || 'MCL Room', currentUsername, hostPassword || undefined, port);
      setHostStatus(status);
      setView('active');
    } catch (err) {
      setCreateError(String(err));
    } finally {
      setIsStartingHost(false);
    }
  };

  const handleStopHost = async () => {
    try {
      await p2pStopHost();
      await refreshHostStatus();
      setView('closed');
    } catch {
      // ignore
    }
  };

  const handleToggleLock = async () => {
    try {
      await p2pToggleLock();
      await refreshHostStatus();
    } catch {
      // ignore
    }
  };

  const handleKick = async (nodeId: string) => {
    setKickingNodeId(nodeId);
    try {
      await p2pKickPeer(nodeId);
      await refreshHostStatus();
    } finally {
      setKickingNodeId(null);
    }
  };

  const joinWithTicket = async (ticket: string, password?: string) => {
    if (!ticket.trim()) return;
    setIsJoining(true);
    setJoinError('');
    try {
      const status = await p2pStartClient(ticket.trim(), currentUsername, password || undefined);
      setClientStatus(status);
      if (status.error) {
        setJoinError(status.error);
        return;
      }
      setHistory(
        rememberJoinedRoom({
          roomName: status.roomName || 'MCL Room',
          hostUsername: status.hostUsername || 'Host',
          ticket: ticket.trim(),
        })
      );
      setView('active');
    } catch (err) {
      const message = String(err);
      const staleMarker = 'STALE_TICKET::';
      if (message.includes(staleMarker)) {
        setHistory(forgetP2PRoomByTicket(ticket.trim()));
        setJoinError(message.slice(message.indexOf(staleMarker) + staleMarker.length));
      } else {
        setJoinError(message);
      }
    } finally {
      setIsJoining(false);
    }
  };

  const handleDisconnectClient = async () => {
    try {
      await p2pStopClient();
      await refreshClientStatus();
      setView('closed');
    } catch {
      // ignore
    }
  };

  const handleForget = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setHistory(forgetP2PRoom(id));
  };

  const handleCopyAddress = () => {
    const text = isHosting ? hostStatus?.ticket || '' : `127.0.0.1:${clientStatus?.localPort ?? ''}`;
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const statusPillColor = clientStatus?.isReconnecting ? 'bg-amber-400' : 'bg-emerald-400';

  const BackHeader: React.FC<{ title: string }> = ({ title }) => (
    <div className="flex items-center gap-2 pb-1">
      <button
        type="button"
        onClick={() => setView('list')}
        title={t.p2pWidgetBackTooltip || 'Quay lại'}
        className="p-1 -ml-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 cursor-pointer transition"
      >
        <ArrowLeft className="w-4 h-4" />
      </button>
      <h4 className="text-sm font-bold text-white leading-tight">{title}</h4>
    </div>
  );

  return (
    <>
      {/* ========================================================================= */}
      {/* 1. SIDEBAR TRIGGER ICON (Standardized with other sidebar items)           */}
      {/* ========================================================================= */}
      <div className="relative group flex items-center justify-center w-full h-12 shrink-0">
        <button
          type="button"
          onClick={() => setView((v) => (v === 'closed' ? (isActive ? 'active' : 'list') : 'closed'))}
          title={isActive ? `${activeRoomName} (${isHosting ? 'Host' : 'Connected'})` : (t.p2pWidgetTitle || 'Phòng Chơi P2P')}
          aria-label="P2P Multiplayer Room"
          className={`relative z-10 w-12 h-12 rounded-xl flex items-center justify-center transition-colors duration-150 border-none outline-none cursor-pointer ${
            view !== 'closed'
              ? 'text-[var(--accent-color)] bg-white/10'
              : 'text-slate-400 hover:text-white hover:bg-white/[0.05]'
          }`}
        >
          <Users className="w-6 h-6" />

          {/* Active Presence Dot (static solid, no breathing) */}
          {isActive && (
            <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-emerald-400" />
          )}

          {/* Badge count if connected peers */}
          {isActive && peerCount > 0 && (
            <span className="absolute -bottom-1 -right-1 px-1.5 py-0.2 rounded-full bg-emerald-500 text-[9px] font-mono font-bold text-black shadow-sm">
              {peerCount}
            </span>
          )}
        </button>

        {/* Pure CSS Tooltip (Matching Sidebar tooltip standard) */}
        {view === 'closed' && (
          <div className="absolute left-[88px] px-3.5 py-1.5 rounded-lg bg-[#161616] border border-white/10 text-xs font-semibold text-white shadow-2xl whitespace-nowrap z-[60] pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-100">
            {isActive ? `${activeRoomName} (${peerCount})` : (t.p2pWidgetYourRooms || 'Phòng Chơi P2P')}
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* 2. DISCORD-STYLE MINI HUB FLYOUT PANEL (Positioned right beside Sidebar)  */}
      {/* ========================================================================= */}
      {view !== 'closed' && (
        <>
          {/* Invisible Backdrop to dismiss when clicking anywhere outside */}
          <div
            className="fixed inset-0 z-[88] bg-transparent"
            onClick={() => setView('closed')}
            aria-hidden="true"
          />

          <div
            ref={panelRef}
            className="fixed left-[88px] bottom-3 z-[89] w-[360px] select-none flex flex-col justify-end pointer-events-none"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="pointer-events-auto w-full rounded-2xl bg-[#121212] border border-white/10 shadow-[0_24px_60px_rgba(0,0,0,0.85)] p-4 text-slate-100 space-y-3.5 animate-fadeIn">
              {/* =================================================================== */}
              {/* VIEW 1: HUB / DISCOVERY / RECENT ROOMS (Default List)              */}
              {/* =================================================================== */}
              {view === 'list' && (
                <div className="space-y-3">
                  {/* Top Header */}
                  <div className="flex items-center justify-between pb-1">
                    <h4 className="text-sm font-bold text-white">
                      {t.p2pWidgetYourRooms || 'Phòng Chơi P2P'}
                    </h4>
                    <button
                      type="button"
                      onClick={() => setView('closed')}
                      className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Active Room Quick Banner (if currently in a room) */}
                  {isActive && (
                    <div
                      onClick={() => setView('active')}
                      className="p-2.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/5 transition cursor-pointer flex items-center justify-between group"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs bg-white/5 border border-white/10 text-emerald-400 shrink-0">
                          {avatarLetter(activeRoomName)}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-white truncate">
                            <span className="truncate">{activeRoomName}</span>
                          </div>
                          <div className="text-[10px] text-slate-400">
                            {isHosting ? `Chủ phòng · ${peerCount} bạn chơi` : 'Đang trong phòng'}
                          </div>
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded-lg bg-white/5 hover:bg-white/10 text-[11px] font-medium text-slate-300 transition shrink-0 border border-white/5">
                        Mở &rarr;
                      </span>
                    </div>
                  )}

                  {/* 2 Quick Action Buttons: Create & Join */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setView('create')}
                      className="py-2.5 px-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-[var(--accent-color)]/50 transition font-bold text-xs text-white text-center cursor-pointer"
                    >
                      {t.p2pWidgetCreateRoom || 'Tạo Phòng'}
                    </button>

                    <button
                      type="button"
                      onClick={() => setView('join')}
                      className="py-2.5 px-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-[var(--accent-color)]/50 transition font-bold text-xs text-white text-center cursor-pointer"
                    >
                      {t.p2pWidgetJoinRoom || 'Vào Phòng'}
                    </button>
                  </div>

                  {/* Recent Rooms List */}
                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-400 px-1">
                      <span>{t.p2pWidgetHistoryTitle || 'Phòng Gần Đây'}</span>
                      <span>({history.length})</span>
                    </div>

                    {history.length === 0 ? (
                      <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5 text-center text-slate-500 text-xs">
                        {t.p2pWidgetHistoryEmpty || 'Chưa có phòng nào gần đây.'}
                      </div>
                    ) : (
                      <div className="max-h-56 overflow-y-auto custom-scrollbar space-y-1.5 pr-0.5">
                        {history.map((entry) => (
                          <div
                            key={entry.id}
                            onClick={() => joinWithTicket(entry.ticket, joinPassword)}
                            className="p-2.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/5 transition flex items-center justify-between group cursor-pointer"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 bg-white/5 border border-white/10 text-slate-300">
                                {avatarLetter(entry.roomName)}
                              </div>
                              <div className="min-w-0">
                                <div className="text-xs font-bold text-white truncate">{entry.roomName}</div>
                                <div className="text-[10px] text-slate-400 truncate">
                                  {entry.hostUsername} • {formatRelativeTime(entry.joinedAt, language)}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                              <button
                                type="button"
                                onClick={(e) => handleForget(entry.id, e)}
                                className="p-1 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition cursor-pointer"
                                title={t.p2pWidgetForget || 'Xoá'}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {joinError && (
                    <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{joinError}</span>
                    </div>
                  )}
                </div>
              )}

              {/* =================================================================== */}
              {/* VIEW 2: CREATE ROOM (Tạo Phòng Mới)                                */}
              {/* =================================================================== */}
              {view === 'create' && (
                <div className="space-y-3.5">
                  <BackHeader title={t.p2pWidgetCreateTitle || 'Tạo Phòng'} />

                  <div className="space-y-2.5">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                        {t.p2pWidgetRoomNamePlaceholder || 'Tên phòng'}
                      </label>
                      <input
                        type="text"
                        value={roomName}
                        onChange={(e) => setRoomName(e.target.value)}
                        placeholder="Ví dụ: Sinh Tồn"
                        className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-xs text-white focus:outline-none focus:border-[var(--accent-color)] placeholder-slate-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                        {t.p2pWidgetPasswordOptionalPlaceholder || 'Mật khẩu (tuỳ chọn)'}
                      </label>
                      <input
                        type="password"
                        value={hostPassword}
                        onChange={(e) => setHostPassword(e.target.value)}
                        placeholder="Để trống nếu không đặt mật khẩu"
                        className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-xs text-white focus:outline-none focus:border-[var(--accent-color)] placeholder-slate-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                        Cổng Minecraft (Port)
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={hostPortText}
                        onChange={(e) => setHostPortText(e.target.value.replace(/[^0-9]/g, ''))}
                        placeholder="25565"
                        className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-xs font-mono text-white focus:outline-none focus:border-[var(--accent-color)] placeholder-slate-500"
                      />
                    </div>
                  </div>

                  {createError && (
                    <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{createError}</span>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleCreateRoom}
                    disabled={isStartingHost}
                    className="w-full btn-primary px-4 py-2.5 rounded-xl text-xs font-bold cursor-pointer transition disabled:opacity-40 flex items-center justify-center gap-2 shadow-lg"
                  >
                    {isStartingHost ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>{t.p2pWidgetCreatingBtn || 'Đang tạo phòng...'}</span>
                      </>
                    ) : (
                      <span>{t.p2pWidgetCreateBtn || 'Tạo Phòng'}</span>
                    )}
                  </button>
                </div>
              )}

              {/* =================================================================== */}
              {/* VIEW 3: JOIN ROOM (Vào Phòng Bằng Mã Ticket)                        */}
              {/* =================================================================== */}
              {view === 'join' && (
                <div className="space-y-3.5">
                  <BackHeader title={t.p2pWidgetJoinTitle || 'Vào Phòng'} />

                  <div className="space-y-2.5">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                        Mã phòng (Ticket)
                      </label>
                      <textarea
                        rows={3}
                        value={joinTicket}
                        onChange={(e) => setJoinTicket(e.target.value)}
                        placeholder={t.p2pWidgetTicketPlaceholder || 'Dán mã phòng vào đây...'}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-xs font-mono text-emerald-300 focus:outline-none focus:border-[var(--accent-color)] placeholder-slate-500 resize-none break-all"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                        Mật khẩu (tuỳ chọn)
                      </label>
                      <input
                        type="password"
                        value={joinPassword}
                        onChange={(e) => setJoinPassword(e.target.value)}
                        placeholder="Để trống nếu không có mật khẩu"
                        className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-xs text-white focus:outline-none focus:border-[var(--accent-color)] placeholder-slate-500"
                      />
                    </div>
                  </div>

                  {joinError && (
                    <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{joinError}</span>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => joinWithTicket(joinTicket, joinPassword)}
                    disabled={!joinTicket.trim() || isJoining}
                    className="w-full btn-primary px-4 py-2.5 rounded-xl text-xs font-bold cursor-pointer transition disabled:opacity-40 flex items-center justify-center gap-2 shadow-lg"
                  >
                    {isJoining ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>{t.p2pWidgetJoiningBtn || 'Đang vào phòng...'}</span>
                      </>
                    ) : (
                      <span>{t.p2pWidgetJoinBtn || 'Vào Phòng'}</span>
                    )}
                  </button>
                </div>
              )}

              {/* =================================================================== */}
              {/* VIEW 4: ACTIVE ROOM (Lobby Style Active View)                       */}
              {/* =================================================================== */}
              {view === 'active' && isActive && (
                <div className="space-y-3.5">
                  {/* Active Header */}
                  <div className="flex items-center justify-between pb-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <button
                        type="button"
                        onClick={() => setView('list')}
                        className="p-1 -ml-1 rounded-lg text-slate-400 hover:text-white transition cursor-pointer"
                        title="Quay về danh sách"
                      >
                        <ArrowLeft className="w-4 h-4" />
                      </button>
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-white truncate">
                          <span className="truncate">{activeRoomName}</span>
                        </div>
                        <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mt-0.5">
                          <span>{isHosting ? 'Chủ phòng' : 'Khách'}</span>
                          {hostStatus?.isLocked && (
                            <span className="flex items-center gap-1 text-rose-400 font-medium text-[10px]">
                              • <Lock className="w-2.5 h-2.5 inline" /> Đã khóa
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {isHosting && (
                        <button
                          type="button"
                          onClick={handleToggleLock}
                          className={`p-1.5 rounded-xl border transition cursor-pointer ${
                            hostStatus?.isLocked
                              ? 'bg-rose-500/10 border-rose-500/20 text-rose-300'
                              : 'bg-white/5 border-white/5 text-slate-400 hover:text-white hover:bg-white/10'
                          }`}
                          title={hostStatus?.isLocked ? 'Mở khóa phòng' : 'Khóa phòng (chặn người mới)'}
                        >
                          {hostStatus?.isLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setView('closed')}
                        className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Reconnecting alert if applicable */}
                  {!isHosting && clientStatus?.isReconnecting && (
                    <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                      <span>{t.p2pWidgetReconnectingBadge || 'Đang tự động kết nối lại...'}</span>
                    </div>
                  )}

                  {/* Connection Details Box */}
                  {isHosting ? (
                    <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5 space-y-2">
                      <div className="flex items-center justify-between text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                        <span>Mã Phòng Chia Sẻ (Ticket)</span>
                        <span className="text-emerald-400 font-mono">127.0.0.1:{hostStatus?.targetPort}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          readOnly
                          value={hostStatus?.ticket || ''}
                          className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-black/40 border border-white/5 text-[10px] font-mono text-emerald-300 select-all focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={handleCopyAddress}
                          className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 text-xs font-semibold text-white flex items-center gap-1 transition cursor-pointer shrink-0"
                        >
                          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-slate-300" />}
                          <span>{copied ? 'Đã Chép!' : 'Chép Mã'}</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    clientStatus?.isConnected && (
                      <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                            Địa Chỉ Vào Minecraft
                          </div>
                          <div className="text-xs font-mono font-bold text-emerald-400 mt-0.5 truncate">
                            127.0.0.1:{clientStatus.localPort}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={handleCopyAddress}
                          className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 text-xs font-semibold text-white flex items-center gap-1 transition cursor-pointer shrink-0"
                        >
                          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-slate-300" />}
                          <span>{copied ? 'Đã Chép!' : 'Chép IP'}</span>
                        </button>
                      </div>
                    )
                  )}

                  {/* Member List */}
                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-400 px-1">
                      <span className="flex items-center gap-1.5">
                        <Users className="w-3 h-3 text-[var(--accent-color)]" />
                        <span>{t.p2pWidgetMembersLabel || 'Người Chơi Trong Phòng'}</span>
                      </span>
                      <span>({(isHosting ? hostStatus?.members?.length : clientStatus?.members?.length) || 1})</span>
                    </div>

                    <div className="max-h-48 overflow-y-auto custom-scrollbar space-y-1.5 pr-0.5">
                      {(isHosting ? hostStatus?.members : clientStatus?.members)?.map((member: P2PMemberInfo) => (
                        <div
                          key={member.nodeId}
                          className="p-2 rounded-xl bg-white/[0.03] border border-white/5 flex items-center justify-between gap-2 group"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <PlayerAvatar username={member.username} size={28} />
                            <div className="min-w-0">
                              <div className="text-xs font-bold text-white truncate flex items-center gap-1.5">
                                <span className="truncate">{member.username}</span>
                                {member.isHost && (
                                  <span className="text-[10px] text-slate-400 font-medium shrink-0">
                                    Host
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {renderPingBadge(member.pingMs, member.isHost)}
                            {isHosting && !member.isHost && (
                              <button
                                type="button"
                                onClick={() => handleKick(member.nodeId)}
                                disabled={kickingNodeId === member.nodeId}
                                className="p-1 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/15 opacity-0 group-hover:opacity-100 transition cursor-pointer"
                                title={t.p2pWidgetKickTooltip || 'Kích người chơi này'}
                              >
                                {kickingNodeId === member.nodeId ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <UserX className="w-3.5 h-3.5" />
                                )}
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Bottom Actions: Leave / Stop Room */}
                  <div className="pt-1.5">
                    <button
                      type="button"
                      onClick={isHosting ? handleStopHost : handleDisconnectClient}
                      className="w-full px-4 py-2.5 rounded-xl text-xs font-bold bg-white/5 hover:bg-white/10 border border-white/10 text-white flex items-center justify-center gap-2 transition cursor-pointer"
                    >
                      <Power className="w-3.5 h-3.5 text-slate-400" />
                      <span>{isHosting ? t.p2pWidgetCloseRoomBtn || 'Đóng Phòng Chơi' : t.p2pWidgetLeaveRoomBtn || 'Rời Khỏi Phòng'}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
};
