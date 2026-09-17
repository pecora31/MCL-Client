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
  RotateCcw,
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
import { loadP2PRoomHistory, rememberJoinedRoom, forgetP2PRoom, formatRelativeTime, type P2PRoomHistoryEntry } from '../../services/p2pRoomHistory';
import type { P2PHostStatus, P2PClientStatus, P2PMemberInfo } from '../../types';
import { getTranslation, type Language } from '../../locales/i18n';

interface P2PFloatingWidgetProps {
  language: Language;
}

type PopupMode = 'none' | 'create' | 'join';

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

function renderPingBadge(pingMs: number | null | undefined) {
  if (pingMs == null || pingMs === 0) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-mono font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
        <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
        Host
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

export const P2PFloatingWidget: React.FC<P2PFloatingWidgetProps> = ({ language }) => {
  const t = getTranslation(language);
  const currentUsername = readCurrentUsername();

  const [hostStatus, setHostStatus] = useState<P2PHostStatus | null>(null);
  const [clientStatus, setClientStatus] = useState<P2PClientStatus | null>(null);
  const [popup, setPopup] = useState<PopupMode>('none');
  const [isPanelOpen, setIsPanelOpen] = useState(false);
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

  // Close the popup on an outside click, same convenience any popover gets.
  useEffect(() => {
    if (popup === 'none' && !isPanelOpen) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setPopup('none');
        setIsPanelOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [popup, isPanelOpen]);

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
        setJoinError(status.error);
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
      setPopup('none');
      setIsPanelOpen(true);
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
      setIsPanelOpen(false);
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
      setPopup('none');
      setIsPanelOpen(true);
    } catch (err) {
      setJoinError(String(err));
    } finally {
      setIsJoining(false);
    }
  };

  const handleDisconnectClient = async () => {
    try {
      await p2pStopClient();
      await refreshClientStatus();
      setIsPanelOpen(false);
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

  return (
    <div className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-2" ref={panelRef}>
      {/* Popup: create room form */}
      {popup === 'create' && (
        <div className="w-72 p-4 rounded-2xl bg-[#151515] border border-white/10 shadow-2xl space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-white">{t.p2pWidgetCreateTitle || 'Create a Room'}</span>
            <button type="button" onClick={() => setPopup('none')} className="text-slate-400 hover:text-white cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
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

      {/* Popup: join room form + history */}
      {popup === 'join' && (
        <div className="w-80 p-4 rounded-2xl bg-[#151515] border border-white/10 shadow-2xl space-y-3 max-h-[70vh] overflow-y-auto custom-scrollbar">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-white">{t.p2pWidgetJoinTitle || "Join a Friend's Room"}</span>
            <button type="button" onClick={() => setPopup('none')} className="text-slate-400 hover:text-white cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
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

          <div className="pt-2 border-t border-white/10">
            <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider mb-1.5">
              {t.p2pWidgetHistoryTitle || 'Recent rooms'}
            </div>
            {history.length === 0 ? (
              <p className="text-[11px] text-slate-500">{t.p2pWidgetHistoryEmpty || 'No recent rooms.'}</p>
            ) : (
              <div className="space-y-1">
                {history.map((entry) => (
                  <div key={entry.id} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] transition">
                    <div className="min-w-0">
                      <div className="text-[11px] font-semibold text-slate-200 truncate">{entry.roomName}</div>
                      <div className="text-[10px] text-slate-500 truncate">
                        {entry.hostUsername} &middot; {formatRelativeTime(entry.joinedAt, language)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => joinWithTicket(entry.ticket, joinPassword)}
                        disabled={isJoining}
                        className="px-2 py-1 rounded-md text-[10px] font-semibold bg-white/10 hover:bg-white/15 text-white cursor-pointer disabled:opacity-40"
                      >
                        {t.p2pWidgetConnectAgain || 'Connect'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleForget(entry.id)}
                        className="p-1 rounded-md text-slate-500 hover:text-rose-300 hover:bg-rose-500/10 cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Expanded status panel, shown when hosting or connected */}
      {isPanelOpen && isActive && (
        <div className="w-80 p-4 rounded-2xl bg-[#151515] border border-white/10 shadow-2xl space-y-3 max-h-[70vh] overflow-y-auto custom-scrollbar">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <span className={`w-2 h-2 rounded-full ${statusPillColor} animate-pulse shrink-0`} />
              <span className="text-xs font-bold text-white truncate">
                {isHosting ? hostStatus?.roomName || 'MCL Room' : clientStatus?.roomName || 'MCL Room'}
              </span>
            </div>
            <button type="button" onClick={() => setIsPanelOpen(false)} className="text-slate-400 hover:text-white cursor-pointer shrink-0">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {!isHosting && clientStatus?.isReconnecting && (
            <div className="text-[11px] text-amber-300 flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" />
              {t.p2pWidgetReconnectingBadge || 'Reconnecting...'}
            </div>
          )}

          {isHosting && (
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
                  {renderPingBadge(member.pingMs)}
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

      {/* Collapsed row: either the two entry buttons, or a compact status pill */}
      {isActive ? (
        <button
          type="button"
          onClick={() => setIsPanelOpen((v) => !v)}
          className="flex items-center gap-2 px-3.5 py-2.5 rounded-full bg-[#151515] border border-white/10 shadow-2xl cursor-pointer hover:border-white/20 transition"
        >
          <span className={`w-2 h-2 rounded-full ${statusPillColor} animate-pulse`} />
          <span className="text-xs font-bold text-white">
            {isHosting ? hostStatus?.connectedPeersCount ?? 0 : (clientStatus?.members?.length || 2) - 1}
          </span>
          {!isHosting && !clientStatus?.isReconnecting && renderPingBadge(clientStatus?.pingMs)}
          {isHosting && (
            <RotateCcw className={`w-3 h-3 text-slate-500 ${isPanelOpen ? '' : 'hidden'}`} />
          )}
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPopup(popup === 'create' ? 'none' : 'create')}
            className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-full bg-[#151515] border border-white/10 shadow-2xl cursor-pointer hover:border-[var(--accent-color)]/50 transition text-xs font-bold text-white"
          >
            <Globe className="w-3.5 h-3.5 text-[var(--accent-color)]" />
            <span>{t.p2pWidgetCreateRoom || 'Create Room'}</span>
          </button>
          <button
            type="button"
            onClick={() => setPopup(popup === 'join' ? 'none' : 'join')}
            className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-full bg-[#151515] border border-white/10 shadow-2xl cursor-pointer hover:border-[var(--accent-color)]/50 transition text-xs font-bold text-white"
          >
            <Users className="w-3.5 h-3.5 text-[var(--accent-color)]" />
            <span>{t.p2pWidgetJoinRoom || 'Join Room'}</span>
          </button>
        </div>
      )}
    </div>
  );
};
