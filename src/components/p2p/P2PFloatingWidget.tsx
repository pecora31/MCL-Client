import React, { useEffect, useRef, useState } from 'react';
import {
  Globe,
  Users,
  X,
  Copy,
  Check,
  Power,
  Loader2,
  Trash2,
  Lock,
  Unlock,
  UserX,
  AlertCircle,
  Menu,
  Plus,
  ArrowLeft,
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
import { loadP2PRoomHistory, rememberJoinedRoom, forgetP2PRoom, forgetP2PRoomByTicket, formatRelativeTime, type P2PRoomHistoryEntry } from '../../services/p2pRoomHistory';
import type { P2PHostStatus, P2PClientStatus, P2PMemberInfo } from '../../types';
import { getTranslation, type Language } from '../../locales/i18n';

interface P2PFloatingWidgetProps {
  language: Language;
}

/** Everything the drop-up panel can show; toggling the main button always returns here first. */
type PanelView = 'closed' | 'list' | 'chooser' | 'create' | 'join' | 'active';

function readCurrentUsername(): string {
  try {
    const raw = localStorage.getItem('mcl_account');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.username) return parsed.username as string;
    }
  } catch {
    // Fallback below
  }
  return 'Player';
}

// A null/zero ping used to be treated as "this must be the host" — it isn't; it's also what a
// client's own self-entry and a just-joined member (ping not measured yet) report. Who is
// actually hosting is `member.isHost`, straight from the backend, not inferred from a number.
function renderPingBadge(pingMs: number | null | undefined, isHost: boolean) {
  if (isHost) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-mono font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
        <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
        Host
      </span>
    );
  }
  if (pingMs == null || pingMs === 0) {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-mono font-bold bg-white/5 text-slate-400 border border-white/10">
        &mdash;
      </span>
    );
  }
  const colorClass =
    pingMs < 45
      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
      : pingMs < 90
      ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
      : 'bg-rose-500/15 text-rose-300 border-rose-500/30';
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-mono font-bold border ${colorClass}`}>
      {pingMs.toFixed(0)} ms
    </span>
  );
}

/** Discord's server rail avatars: no per-room image exists here, so a color+initial stands in for one. */
const AVATAR_COLORS = [
  'bg-rose-500/20 text-rose-300 border-rose-500/30',
  'bg-amber-500/20 text-amber-300 border-amber-500/30',
  'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  'bg-sky-500/20 text-sky-300 border-sky-500/30',
  'bg-violet-500/20 text-violet-300 border-violet-500/30',
  'bg-pink-500/20 text-pink-300 border-pink-500/30',
  'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  'bg-orange-500/20 text-orange-300 border-orange-500/30',
];

function avatarColorClass(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function avatarLetter(name: string): string {
  return (name.trim()[0] || '?').toUpperCase();
}

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

  useEffect(() => {
    setHistory(loadP2PRoomHistory());
    refreshHostStatus();
    refreshClientStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isActive) return;
    const interval = setInterval(() => {
      if (isHosting) refreshHostStatus();
      if (isClientActive) refreshClientStatus();
    }, 2500);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHosting, isClientActive]);

  // Close the panel on an outside click, same convenience any popover gets.
  useEffect(() => {
    if (view === 'closed') return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setView('closed');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
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
        // This exact ticket can never succeed again — leaving it in history would just be a
        // trap the next time the player tries it, so it's removed the moment it's confirmed dead.
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

  const handleForget = (id: string) => {
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
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => setView('list')}
        title={t.p2pWidgetBackTooltip || 'Back'}
        className="p-1 -ml-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 cursor-pointer transition"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
      </button>
      <span className="text-xs font-bold text-white">{title}</span>
    </div>
  );

  return (
    <div className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-2" ref={panelRef}>
      {/* Icon rail: the active room (if any), room history, and a "+" to create or join */}
      {view === 'list' && (
        <div className="flex flex-col items-center gap-2 p-2 rounded-2xl bg-[#151515] border border-white/10 shadow-2xl max-h-[70vh] overflow-y-auto custom-scrollbar">
          <div className="flex items-center justify-between w-full px-1">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{t.p2pWidgetYourRooms || 'Your Rooms'}</span>
            <button type="button" onClick={() => setView('closed')} className="text-slate-500 hover:text-white cursor-pointer">
              <X className="w-3 h-3" />
            </button>
          </div>

          {isActive && (
            <button
              type="button"
              onClick={() => setView('active')}
              title={activeRoomName}
              className={`relative shrink-0 w-11 h-11 rounded-2xl flex items-center justify-center font-bold text-sm border-2 border-[var(--accent-color)] cursor-pointer transition hover:brightness-110 ${avatarColorClass(
                activeRoomName
              )}`}
            >
              {avatarLetter(activeRoomName)}
              <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full ${statusPillColor} border-2 border-[#151515] animate-pulse`} />
            </button>
          )}

          {isActive && history.length > 0 && <div className="w-8 h-px bg-white/10 shrink-0" />}

          {history.map((entry) => (
            <div key={entry.id} className="relative group shrink-0">
              <button
                type="button"
                onClick={() => joinWithTicket(entry.ticket, joinPassword)}
                disabled={isJoining}
                title={`${entry.roomName} · ${entry.hostUsername} · ${formatRelativeTime(entry.joinedAt, language)}`}
                className={`w-11 h-11 rounded-2xl flex items-center justify-center font-bold text-sm border cursor-pointer transition hover:brightness-110 disabled:opacity-40 ${avatarColorClass(
                  entry.id
                )}`}
              >
                {avatarLetter(entry.roomName)}
              </button>
              <button
                type="button"
                onClick={() => handleForget(entry.id)}
                className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-500 hover:bg-rose-400 text-white opacity-0 group-hover:opacity-100 flex items-center justify-center cursor-pointer transition"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          ))}

          {joinError && (
            <div className="w-full p-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-[10px] flex items-start gap-1.5">
              <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
              <span>{joinError}</span>
            </div>
          )}

          <button
            type="button"
            onClick={() => setView('chooser')}
            title={t.p2pWidgetAddRoomTooltip || 'Create or Join Room'}
            className="shrink-0 w-11 h-11 rounded-2xl border-2 border-dashed border-white/20 hover:border-[var(--accent-color)] text-slate-400 hover:text-[var(--accent-color)] flex items-center justify-center cursor-pointer transition"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Chooser: pick create or join, reached from the "+" icon */}
      {view === 'chooser' && (
        <div className="w-64 p-3 rounded-2xl bg-[#151515] border border-white/10 shadow-2xl space-y-2">
          <BackHeader title={t.p2pWidgetAddRoomTooltip || 'Create or Join Room'} />
          <button
            type="button"
            onClick={() => setView('create')}
            className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-[var(--accent-color)]/50 transition text-xs font-bold text-white cursor-pointer"
          >
            <Globe className="w-3.5 h-3.5 text-[var(--accent-color)]" />
            <span>{t.p2pWidgetCreateRoom || 'Create Room'}</span>
          </button>
          <button
            type="button"
            onClick={() => setView('join')}
            className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-[var(--accent-color)]/50 transition text-xs font-bold text-white cursor-pointer"
          >
            <Users className="w-3.5 h-3.5 text-[var(--accent-color)]" />
            <span>{t.p2pWidgetJoinRoom || 'Join Room'}</span>
          </button>
        </div>
      )}

      {/* Create room form */}
      {view === 'create' && (
        <div className="w-72 p-4 rounded-2xl bg-[#151515] border border-white/10 shadow-2xl space-y-3">
          <BackHeader title={t.p2pWidgetCreateTitle || 'Create a Room'} />
          <input
            type="text"
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            placeholder={t.p2pWidgetRoomNamePlaceholder || 'Room name'}
            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-white focus:outline-none focus:border-[var(--accent-color)]"
          />
          <input
            type="password"
            value={hostPassword}
            onChange={(e) => setHostPassword(e.target.value)}
            placeholder={t.p2pWidgetPasswordOptionalPlaceholder || 'Password (optional)'}
            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-white focus:outline-none focus:border-[var(--accent-color)]"
          />
          <input
            type="text"
            inputMode="numeric"
            value={hostPortText}
            onChange={(e) => setHostPortText(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder={t.p2pWidgetPortPlaceholder || 'Minecraft server port (default 25565)'}
            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-white focus:outline-none focus:border-[var(--accent-color)]"
          />
          {createError && (
            <div className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-[11px] flex items-start gap-1.5">
              <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
              <span>{createError}</span>
            </div>
          )}
          <button
            type="button"
            onClick={handleCreateRoom}
            disabled={isStartingHost}
            className="w-full btn-primary px-3 py-2 rounded-lg text-xs font-bold cursor-pointer active:scale-95 transition disabled:opacity-40 flex items-center justify-center gap-1.5"
          >
            {isStartingHost && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <span>{isStartingHost ? t.p2pWidgetCreatingBtn || 'Creating...' : t.p2pWidgetCreateBtn || 'Create Room'}</span>
          </button>
        </div>
      )}

      {/* Join room form */}
      {view === 'join' && (
        <div className="w-80 p-4 rounded-2xl bg-[#151515] border border-white/10 shadow-2xl space-y-3">
          <BackHeader title={t.p2pWidgetJoinTitle || "Join a Friend's Room"} />
          <input
            type="text"
            value={joinTicket}
            onChange={(e) => setJoinTicket(e.target.value)}
            placeholder={t.p2pWidgetTicketPlaceholder || 'Paste the room ticket here...'}
            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs font-mono text-white focus:outline-none focus:border-[var(--accent-color)]"
          />
          <input
            type="password"
            value={joinPassword}
            onChange={(e) => setJoinPassword(e.target.value)}
            placeholder={t.p2pWidgetPasswordPlaceholder || 'Password (if the room has one)'}
            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-white focus:outline-none focus:border-[var(--accent-color)]"
          />
          {joinError && (
            <div className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-[11px] flex items-start gap-1.5">
              <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
              <span>{joinError}</span>
            </div>
          )}
          <button
            type="button"
            onClick={() => joinWithTicket(joinTicket, joinPassword)}
            disabled={!joinTicket.trim() || isJoining}
            className="w-full btn-primary px-3 py-2 rounded-lg text-xs font-bold cursor-pointer active:scale-95 transition disabled:opacity-40 flex items-center justify-center gap-1.5"
          >
            {isJoining && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <span>{isJoining ? t.p2pWidgetJoiningBtn || 'Connecting...' : t.p2pWidgetJoinBtn || 'Join Room'}</span>
          </button>
        </div>
      )}

      {/* Expanded status panel for the active room */}
      {view === 'active' && isActive && (
        <div className="w-80 p-4 rounded-2xl bg-[#151515] border border-white/10 shadow-2xl space-y-3 max-h-[70vh] overflow-y-auto custom-scrollbar">
          <div className="flex items-center justify-between">
            <BackHeader title={activeRoomName} />
            <span className={`w-2 h-2 rounded-full ${statusPillColor} animate-pulse shrink-0`} />
          </div>

          {!isHosting && clientStatus?.isReconnecting && (
            <div className="text-[11px] text-amber-300 flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" />
              {t.p2pWidgetReconnectingBadge || 'Reconnecting...'}
            </div>
          )}

          {isHosting && (
            <>
              <div className="p-2 rounded-lg bg-black/40 border border-white/5">
                <div className="text-[9px] uppercase text-slate-500 tracking-wider">
                  {t.p2pWidgetForwardingLabel || 'Forwarding to (must match your Minecraft server)'}
                </div>
                <div className="text-[11px] font-mono text-emerald-300 truncate">127.0.0.1:{hostStatus?.targetPort}</div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={hostStatus?.ticket || ''}
                  className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-black/50 border border-white/10 text-[10px] font-mono text-emerald-300 select-all focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleCopyAddress}
                  className="p-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white cursor-pointer shrink-0"
                  title={t.p2pWidgetCopyBtn || 'Copy'}
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </>
          )}

          {!isHosting && clientStatus?.isConnected && (
            <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-black/40 border border-white/5">
              <div className="min-w-0">
                <div className="text-[9px] uppercase text-slate-500 tracking-wider">{t.p2pWidgetAddressLabel || 'Address to join in Minecraft'}</div>
                <div className="text-[11px] font-mono text-emerald-300 truncate">127.0.0.1:{clientStatus.localPort}</div>
              </div>
              <button
                type="button"
                onClick={handleCopyAddress}
                className="p-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white cursor-pointer shrink-0"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          )}

          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-[10px] uppercase font-bold text-slate-500 tracking-wider">
              <Users className="w-3 h-3" />
              <span>
                {t.p2pWidgetMembersLabel || 'Players'} (
                {(isHosting ? hostStatus?.members?.length : clientStatus?.members?.length) || 1})
              </span>
            </div>
            {(isHosting ? hostStatus?.members : clientStatus?.members)?.map((member: P2PMemberInfo) => (
              <div key={member.nodeId} className="flex items-center justify-between gap-2 py-1">
                <span className="text-[11px] text-slate-200 truncate">
                  {member.username}
                  {member.isHost && <span className="ml-1 text-[9px] text-slate-500">({t.p2pWidgetHostBadge || 'Host'})</span>}
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                  {renderPingBadge(member.pingMs, member.isHost)}
                  {isHosting && !member.isHost && (
                    <button
                      type="button"
                      onClick={() => handleKick(member.nodeId)}
                      disabled={kickingNodeId === member.nodeId}
                      className="p-1 rounded-md text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 cursor-pointer"
                      title={t.p2pWidgetKickTooltip || 'Kick player'}
                    >
                      {kickingNodeId === member.nodeId ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserX className="w-3 h-3" />}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 pt-1">
            {isHosting && (
              <button
                type="button"
                onClick={handleToggleLock}
                className="flex-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200 flex items-center justify-center gap-1.5 cursor-pointer"
              >
                {hostStatus?.isLocked ? <Unlock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                <span>{hostStatus?.isLocked ? t.p2pWidgetUnlockBtn || 'Unlock' : t.p2pWidgetLockBtn || 'Lock room'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={isHosting ? handleStopHost : handleDisconnectClient}
              className="flex-1 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Power className="w-3 h-3" />
              <span>{isHosting ? t.p2pWidgetCloseRoomBtn || 'Close Room' : t.p2pWidgetLeaveRoomBtn || 'Leave Room'}</span>
            </button>
          </div>
        </div>
      )}

      {/* One entry point for everything: room history, a way to create/join, and — when active — a live status badge */}
      <button
        type="button"
        onClick={() => setView((v) => (v === 'closed' ? 'list' : 'closed'))}
        className="flex items-center gap-2 px-3.5 py-2.5 rounded-full bg-[#151515] border border-white/10 shadow-2xl cursor-pointer hover:border-white/20 transition"
      >
        <Menu className="w-3.5 h-3.5 text-[var(--accent-color)]" />
        <span className="text-xs font-bold text-white">{t.p2pWidgetYourRooms || 'Your Rooms'}</span>
        {isActive && (
          <span className="flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full ${statusPillColor} animate-pulse`} />
            <span className="text-xs font-bold text-white">
              {isHosting ? hostStatus?.connectedPeersCount ?? 0 : (clientStatus?.members?.length || 2) - 1}
            </span>
          </span>
        )}
      </button>
    </div>
  );
};
