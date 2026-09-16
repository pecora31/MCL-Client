import React, { useState, useEffect, useMemo } from 'react';
import {
  Globe,
  Users,
  Copy,
  Check,
  Zap,
  Power,
  Play,
  AlertCircle,
  Loader2,
  Lock,
  Unlock,
  Shield,
  ShieldCheck,
  Eye,
  EyeOff,
  UserX,
  Radio,
  Signal,
  Wifi,
  Sparkles,
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
import type { GameInstance, P2PHostStatus, P2PClientStatus, P2PMemberInfo } from '../../types';
import type { Language } from '../../locales/i18n';

interface P2PDirectConnectCardProps {
  language: Language;
  activeInstance: GameInstance | null;
  serverPort?: number;
  onLaunchGame?: (instance: GameInstance, serverAddress?: string) => void;
}

export const P2PDirectConnectCard: React.FC<P2PDirectConnectCardProps> = ({
  language,
  activeInstance,
  serverPort = 25565,
  onLaunchGame,
}) => {
  const isVi = language === 'vi';
  const [activeTab, setActiveTab] = useState<'host' | 'join'>('host');

  // Active user name from account storage
  const currentUsername = useMemo(() => {
    try {
      const raw = localStorage.getItem('mcl_account');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.username) return parsed.username;
      }
    } catch {
      // Fallback
    }
    return 'Player';
  }, []);

  // Host setup form states
  const [hostRoomName, setHostRoomName] = useState('MCL Adventure Room');
  const [hostPassword, setHostPassword] = useState('');
  const [showHostPassword, setShowHostPassword] = useState(false);
  const [hostPort, setHostPort] = useState(serverPort);

  // Host active state
  const [hostStatus, setHostStatus] = useState<P2PHostStatus | null>(null);
  const [isStartingHost, setIsStartingHost] = useState(false);
  const [isStoppingHost, setIsStoppingHost] = useState(false);
  const [isTogglingLock, setIsTogglingLock] = useState(false);
  const [kickingNodeId, setKickingNodeId] = useState<string | null>(null);
  const [ticketCopied, setTicketCopied] = useState(false);

  // Client / Join state
  const [clientStatus, setClientStatus] = useState<P2PClientStatus | null>(null);
  const [inputTicket, setInputTicket] = useState('');
  const [inputPassword, setInputPassword] = useState('');
  const [showJoinPassword, setShowJoinPassword] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [joinError, setJoinError] = useState('');

  // Initial status check
  useEffect(() => {
    refreshHostStatus();
    refreshClientStatus();
  }, []);

  // server.properties is read after this card first mounts, so the server's real port arrives
  // a moment later than the default this started with. Left alone once a room is open, so it
  // never moves the port out from under a tunnel that is already forwarding.
  useEffect(() => {
    if (hostStatus?.isRunning) return;
    setHostPort(serverPort);
  }, [serverPort, hostStatus?.isRunning]);

  // Polling when active to refresh member list & ping. Keeps polling through a reconnect too,
  // not just while fully connected, otherwise the UI would never learn whether the reconnect
  // watchdog succeeded or gave up.
  useEffect(() => {
    const isClientActive = clientStatus?.isConnected || clientStatus?.isReconnecting;
    const isP2PActive = hostStatus?.isRunning || isClientActive;
    if (!isP2PActive) return;

    const interval = setInterval(() => {
      if (hostStatus?.isRunning) refreshHostStatus();
      if (isClientActive) refreshClientStatus();
    }, 2500);

    return () => clearInterval(interval);
  }, [hostStatus?.isRunning, clientStatus?.isConnected, clientStatus?.isReconnecting]);

  const refreshHostStatus = async () => {
    try {
      const status = await p2pGetHostStatus();
      setHostStatus(status);
    } catch {
      // Browser preview fallback
    }
  };

  const refreshClientStatus = async () => {
    try {
      const status = await p2pGetClientStatus();
      // A reconnect that ultimately gave up reports itself this way: not connected, not
      // reconnecting anymore, with a one-shot error explaining why. Surface it once here since
      // by this point the card has already switched back to the join form.
      if (!status.isConnected && !status.isReconnecting && status.error) {
        setJoinError(status.error);
      }
      setClientStatus(status);
    } catch {
      // Browser preview fallback
    }
  };

  const handleStartHost = async () => {
    setIsStartingHost(true);
    try {
      const status = await p2pStartHost(
        hostRoomName.trim() || 'MCL Room',
        currentUsername,
        hostPassword ? hostPassword : undefined,
        hostPort || serverPort
      );
      setHostStatus(status);
    } catch (err) {
      console.error('Failed to start P2P host:', err);
    } finally {
      setIsStartingHost(false);
    }
  };

  const handleStopHost = async () => {
    setIsStoppingHost(true);
    try {
      await p2pStopHost();
      await refreshHostStatus();
    } catch (err) {
      console.error('Failed to stop P2P host:', err);
    } finally {
      setIsStoppingHost(false);
    }
  };

  const handleToggleLock = async () => {
    setIsTogglingLock(true);
    try {
      await p2pToggleLock();
      await refreshHostStatus();
    } catch (err) {
      console.error('Failed to toggle room lock:', err);
    } finally {
      setIsTogglingLock(false);
    }
  };

  const handleKickPeer = async (nodeId: string, memberName: string) => {
    const confirmMsg = isVi
      ? `Bạn có chắc muốn kích người chơi "${memberName}" ra khỏi phòng?`
      : `Are you sure you want to kick "${memberName}" from the room?`;
    if (!window.confirm(confirmMsg)) return;

    setKickingNodeId(nodeId);
    try {
      await p2pKickPeer(nodeId);
      await refreshHostStatus();
    } catch (err) {
      console.error('Failed to kick peer:', err);
    } finally {
      setKickingNodeId(null);
    }
  };

  const handleCopyTicket = () => {
    if (!hostStatus?.ticket) return;
    navigator.clipboard.writeText(hostStatus.ticket);
    setTicketCopied(true);
    setTimeout(() => setTicketCopied(false), 2500);
  };

  const handleConnectClient = async () => {
    const ticket = inputTicket.trim();
    if (!ticket) return;
    setIsJoining(true);
    setJoinError('');

    try {
      const status = await p2pStartClient(
        ticket,
        currentUsername,
        inputPassword ? inputPassword : undefined
      );
      setClientStatus(status);
      if (status.error) {
        setJoinError(status.error);
      }
    } catch (err) {
      setJoinError(String(err));
    } finally {
      setIsJoining(false);
    }
  };

  const handleDisconnectClient = async () => {
    setIsDisconnecting(true);
    try {
      await p2pStopClient();
      await refreshClientStatus();
      setJoinError('');
    } catch (err) {
      console.error('Failed to disconnect client:', err);
    } finally {
      setIsDisconnecting(false);
    }
  };

  const handlePlayNow = () => {
    if (!clientStatus?.localPort) return;
    const address = `127.0.0.1:${clientStatus.localPort}`;
    if (activeInstance && onLaunchGame) {
      onLaunchGame(activeInstance, address);
    } else {
      navigator.clipboard.writeText(address);
      setTicketCopied(true);
      setTimeout(() => setTicketCopied(false), 2000);
    }
  };

  const renderPingBadge = (pingMs: number | null | undefined) => {
    if (pingMs == null || pingMs === 0) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span>Host (0 ms)</span>
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
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border ${colorClass}`}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            pingMs < 45 ? 'bg-emerald-400' : pingMs < 90 ? 'bg-amber-400' : 'bg-rose-400'
          }`}
        />
        <span>{pingMs.toFixed(0)} ms</span>
      </span>
    );
  };

  return (
    <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/[0.08] backdrop-blur-md space-y-6 shadow-xl relative overflow-hidden">
      {/* Background glow decoration */}
      <div className="absolute top-0 right-0 w-72 h-72 bg-[var(--accent-color)]/5 rounded-full blur-3xl pointer-events-none" />

      {/* Header with Title & Badge */}
      <div className="flex items-center justify-between relative z-10">
        <div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[var(--accent-color)]/10 border border-[var(--accent-color)]/25 text-[var(--accent-color)] text-xs font-semibold mb-1.5 tracking-wide">
            <Zap className="w-3.5 h-3.5 fill-current" />
            <span>{isVi ? 'Chơi Chung Trực Tiếp' : 'Play Together Directly'}</span>
          </div>
          <h3 className="text-lg font-bold text-white tracking-normal flex items-center gap-2">
            <span>{isVi ? 'Phòng Chơi Chung' : 'Shared Room'}</span>
            <span className="text-xs px-2 py-0.5 rounded-md bg-white/10 text-slate-300 font-normal">
              {isVi ? 'Không cần mở port' : 'No port forwarding'}
            </span>
          </h3>
          <p className="text-xs text-slate-400 mt-0.5 max-w-xl leading-relaxed">
            {isVi
              ? 'Kết nối trực tiếp giữa các máy tính không cần mở port modem, không cần cài Radmin/Hamachi, độ trễ cực thấp chuẩn LAN.'
              : 'Direct peer-to-peer connection without port forwarding or VPNs. Near-LAN low latency gaming.'}
          </p>
        </div>
      </div>

      {/* Mode Navigation Tabs */}
      <div className="flex items-center gap-2 p-1 rounded-xl bg-black/40 border border-white/5 w-fit relative z-10">
        <button
          type="button"
          onClick={() => setActiveTab('host')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition cursor-pointer ${
            activeTab === 'host'
              ? 'bg-[var(--accent-color)] text-black shadow-lg shadow-[var(--accent-glow)]'
              : 'text-slate-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <Globe className="w-3.5 h-3.5" />
          <span>{isVi ? 'Tạo Phòng (Host)' : 'Create Room (Host)'}</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('join')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition cursor-pointer ${
            activeTab === 'join'
              ? 'bg-[var(--accent-color)] text-black shadow-lg shadow-[var(--accent-glow)]'
              : 'text-slate-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>{isVi ? 'Vào Phòng (Join)' : 'Join Room'}</span>
        </button>
      </div>

      {/* ======================================================== */}
      {/* HOST TAB CONTENT */}
      {/* ======================================================== */}
      {activeTab === 'host' && (
        <div className="space-y-5 relative z-10">
          {!hostStatus?.isRunning ? (
            /* Creation Form */
            <div className="p-5 rounded-2xl bg-black/40 border border-white/5 space-y-4">
              <div className="flex items-center gap-2 text-sm font-bold text-white border-b border-white/5 pb-3">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>{isVi ? 'Cấu Hình Phòng Chơi' : 'Room Configuration'}</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Room Name */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    {isVi ? 'Tên phòng hiển thị' : 'Room Name'}
                  </label>
                  <input
                    type="text"
                    value={hostRoomName}
                    onChange={(e) => setHostRoomName(e.target.value)}
                    placeholder={isVi ? 'Ví dụ: Survival SMP 1.21' : 'e.g. Survival SMP 1.21'}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-xs text-white focus:outline-none focus:border-[var(--accent-color)]"
                  />
                </div>

                {/* Freestyle Password */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5 text-amber-400" />
                      <span>{isVi ? 'Mật khẩu phòng' : 'Room Password'}</span>
                    </label>
                    <span className="text-[10px] text-slate-400">
                      {isVi ? 'Không bắt buộc' : 'Optional'}
                    </span>
                  </div>
                  <div className="relative">
                    <input
                      type={showHostPassword ? 'text' : 'password'}
                      value={hostPassword}
                      onChange={(e) => setHostPassword(e.target.value)}
                      placeholder={
                        isVi
                          ? 'Bất kỳ ký tự nào trên bàn phím...'
                          : 'Any keyboard characters or leave empty...'
                      }
                      className="w-full px-3.5 py-2.5 pr-10 rounded-xl bg-white/5 border border-white/10 text-xs text-white focus:outline-none focus:border-[var(--accent-color)]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowHostPassword(!showHostPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition cursor-pointer"
                    >
                      {showHostPassword ? (
                        <EyeOff className="w-3.5 h-3.5" />
                      ) : (
                        <Eye className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Server Target Port */}
              <div className="pt-2 flex items-center justify-between">
                <div className="text-xs text-slate-400">
                  <span>{isVi ? 'Cổng server Minecraft:' : 'Minecraft server port:'} </span>
                  <span className="font-mono text-white font-bold">{hostPort}</span>
                </div>

                <button
                  type="button"
                  onClick={handleStartHost}
                  disabled={isStartingHost}
                  className="btn-primary px-6 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer active:scale-95 transition disabled:opacity-50 shadow-lg shadow-[var(--accent-glow)]"
                >
                  {isStartingHost ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Radio className="w-4 h-4" />
                  )}
                  <span>{isStartingHost ? (isVi ? 'Đang tạo phòng...' : 'Starting...') : (isVi ? 'Khởi Tạo Phòng' : 'Create Room')}</span>
                </button>
              </div>
            </div>
          ) : (
            /* Active Host Hub (Radmin / Hamachi style) */
            <div className="space-y-4">
              {/* Room Status Top Banner */}
              <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="w-3 h-3 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.8)] animate-pulse" />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-white">
                          {hostStatus.roomName || 'MCL Room'}
                        </span>
                        {hostStatus.isLocked ? (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30 flex items-center gap-1">
                            <Lock className="w-3 h-3" />
                            <span>{isVi ? 'Đã Khóa' : 'Locked'}</span>
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                            <Unlock className="w-3 h-3" />
                            <span>{isVi ? 'Đang Mở' : 'Open'}</span>
                          </span>
                        )}
                        {hostStatus.hasPassword ? (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                            <Lock className="w-3 h-3" />
                            <span>{isVi ? 'Có Mật Khẩu' : 'Password Protected'}</span>
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-white/10 text-slate-300 border border-white/15">
                            {isVi ? 'Không Mật Khẩu' : 'No Password'}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        {isVi ? 'Đang chuyển tiếp cổng' : 'Forwarding port'}:{' '}
                        <span className="font-mono text-emerald-300">{hostStatus.targetPort}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleToggleLock}
                      disabled={isTogglingLock}
                      className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200 flex items-center gap-1.5 cursor-pointer active:scale-95 transition"
                    >
                      {hostStatus.isLocked ? (
                        <>
                          <Unlock className="w-3.5 h-3.5 text-emerald-400" />
                          <span>{isVi ? 'Mở Khóa Phòng' : 'Unlock Room'}</span>
                        </>
                      ) : (
                        <>
                          <Lock className="w-3.5 h-3.5 text-amber-400" />
                          <span>{isVi ? 'Khóa Phòng' : 'Lock Room'}</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={handleStopHost}
                      disabled={isStoppingHost}
                      className="px-3 py-1.5 rounded-xl text-xs font-bold bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 flex items-center gap-1.5 cursor-pointer active:scale-95 transition"
                    >
                      <Power className="w-3.5 h-3.5" />
                      <span>{isVi ? 'Đóng Phòng' : 'Close Room'}</span>
                    </button>
                  </div>
                </div>

                {/* Ticket Box */}
                <div className="pt-2">
                  <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider mb-1.5 flex items-center gap-1.5">
                    <Sparkles className="w-3 h-3 text-[var(--accent-color)]" />
                    <span>{isVi ? 'MÃ PHÒNG (GỬI CHO BẠN BÈ)' : 'ROOM CODE (SHARE WITH FRIENDS)'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={hostStatus.ticket || ''}
                      className="flex-1 px-3.5 py-2.5 rounded-xl bg-black/70 border border-white/15 text-xs font-mono text-emerald-300 select-all focus:outline-none shadow-inner"
                    />
                    <button
                      type="button"
                      onClick={handleCopyTicket}
                      className="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs flex items-center gap-1.5 shrink-0 cursor-pointer active:scale-95 transition shadow-lg shadow-emerald-500/20"
                    >
                      {ticketCopied ? (
                        <Check className="w-3.5 h-3.5" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {ticketCopied
                          ? isVi
                            ? 'Đã Chép!'
                            : 'Copied!'
                          : isVi
                          ? 'Sao Chép'
                          : 'Copy Ticket'}
                      </span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Radmin-Style Connected Members Table */}
              <div className="p-4 rounded-2xl bg-black/40 border border-white/5 space-y-3">
                <div className="flex items-center justify-between border-b border-white/5 pb-2.5">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-[var(--accent-color)]" />
                    <span className="text-xs font-bold text-white uppercase tracking-wider">
                      {isVi ? 'Danh Sách Người Chơi' : 'Connected Players'} (
                      {hostStatus.members?.length || 1})
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-400">
                    {isVi ? 'Cập nhật ping trực tiếp' : 'Real-time ping updates'}
                  </span>
                </div>

                <div className="divide-y divide-white/5">
                  {hostStatus.members?.map((member: P2PMemberInfo) => (
                    <div
                      key={member.nodeId}
                      className="py-2.5 flex items-center justify-between gap-3 group"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {/* Player Avatar */}
                        <img
                          src={`https://minotar.net/helm/${encodeURIComponent(
                            member.username
                          )}/48.png`}
                          alt={member.username}
                          onError={(e) => {
                            (e.target as HTMLElement).style.display = 'none';
                          }}
                          className="w-8 h-8 rounded-lg bg-black/50 border border-white/10 shrink-0"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-white truncate">
                              {member.username}
                            </span>
                            {member.isHost ? (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[var(--accent-color)]/20 text-[var(--accent-color)] border border-[var(--accent-color)]/30">
                                {isVi ? 'Chủ phòng' : 'Host'}
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-white/10 text-slate-300">
                                {isVi ? 'Người chơi' : 'Member'}
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] font-mono text-slate-500 truncate">
                            ID: {member.nodeId.slice(0, 12)}...
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        {renderPingBadge(member.pingMs)}

                        {!member.isHost && (
                          <button
                            type="button"
                            onClick={() => handleKickPeer(member.nodeId, member.username)}
                            disabled={kickingNodeId === member.nodeId}
                            className="opacity-60 group-hover:opacity-100 p-1.5 rounded-lg text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 transition cursor-pointer"
                            title={isVi ? 'Kích người chơi này' : 'Kick player'}
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
            </div>
          )}
        </div>
      )}

      {/* ======================================================== */}
      {/* JOIN TAB CONTENT */}
      {/* ======================================================== */}
      {activeTab === 'join' && (
        <div className="space-y-4 relative z-10">
          {!clientStatus?.isConnected ? (
            /* Join Form */
            <div className="p-5 rounded-2xl bg-black/40 border border-white/5 space-y-4">
              <div className="text-xs text-slate-300 font-semibold">
                {isVi
                  ? 'Dán mã phòng và nhập mật khẩu (nếu phòng có mật khẩu) để kết nối trực tiếp.'
                  : 'Paste the room ticket and enter the password (if required) to connect.'}
              </div>

              {/* Room Ticket Input */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  {isVi ? 'Mã phòng' : 'Room code'}
                </label>
                <input
                  type="text"
                  placeholder={
                    isVi ? 'Dán mã phòng bạn bè gửi vào đây...' : 'Paste room ticket here...'
                  }
                  value={inputTicket}
                  onChange={(e) => setInputTicket(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-xs font-mono text-white focus:outline-none focus:border-[var(--accent-color)]"
                />
              </div>

              {/* Room Password Input */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-amber-400" />
                    <span>{isVi ? 'Mật khẩu phòng' : 'Room Password'}</span>
                  </label>
                  <span className="text-[10px] text-slate-400">
                    {isVi ? 'Để trống nếu phòng mở' : 'Leave empty if open'}
                  </span>
                </div>
                <div className="relative">
                  <input
                    type={showJoinPassword ? 'text' : 'password'}
                    value={inputPassword}
                    onChange={(e) => setInputPassword(e.target.value)}
                    placeholder={
                      isVi
                        ? 'Nhập mật khẩu do chủ phòng đặt (nếu có)...'
                        : 'Enter room password (if protected)...'
                    }
                    className="w-full px-3.5 py-2.5 pr-10 rounded-xl bg-white/5 border border-white/10 text-xs text-white focus:outline-none focus:border-[var(--accent-color)]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowJoinPassword(!showJoinPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition cursor-pointer"
                  >
                    {showJoinPassword ? (
                      <EyeOff className="w-3.5 h-3.5" />
                    ) : (
                      <Eye className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>

              {joinError && (
                <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-300 text-xs flex items-center gap-2.5">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                  <span>{joinError}</span>
                </div>
              )}

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={handleConnectClient}
                  disabled={!inputTicket.trim() || isJoining}
                  className="btn-primary px-6 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer active:scale-95 transition disabled:opacity-40 shadow-lg shadow-[var(--accent-glow)]"
                >
                  {isJoining ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Wifi className="w-4 h-4" />
                  )}
                  <span>
                    {isJoining
                      ? isVi
                        ? 'Đang xác thực & kết nối...'
                        : 'Connecting...'
                      : isVi
                      ? 'Tham Gia Phòng'
                      : 'Join Room'}
                  </span>
                </button>
              </div>
            </div>
          ) : (
            /* Active Connected Client Hub */
            <div
              className={`p-5 rounded-2xl border space-y-4 ${
                clientStatus.isReconnecting
                  ? 'bg-amber-500/10 border-amber-500/25'
                  : 'bg-emerald-500/10 border-emerald-500/25'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span
                    className={`w-3 h-3 rounded-full animate-pulse ${
                      clientStatus.isReconnecting
                        ? 'bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.8)]'
                        : 'bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.8)]'
                    }`}
                  />
                  <div>
                    <div className="text-sm font-bold text-white flex items-center gap-2">
                      <span>{clientStatus.roomName || 'MCL Room'}</span>
                      <span className="text-xs font-normal text-emerald-300">
                        ({isVi ? 'Chủ phòng' : 'Host'}: {clientStatus.hostUsername || 'Host'})
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-2">
                      {clientStatus.isReconnecting ? (
                        <span className="text-amber-300 flex items-center gap-1.5">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          {isVi ? 'Mất kết nối, đang tự động nối lại...' : 'Connection lost, reconnecting...'}
                        </span>
                      ) : (
                        <span>{isVi ? 'Đã kết nối trực tiếp P2P' : 'Direct P2P connected'}</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {!clientStatus.isReconnecting && renderPingBadge(clientStatus.pingMs)}

                  <button
                    type="button"
                    onClick={handleDisconnectClient}
                    disabled={isDisconnecting}
                    className="px-3 py-1.5 rounded-xl text-xs font-semibold text-rose-300 hover:bg-rose-500/15 border border-rose-500/20 transition cursor-pointer flex items-center gap-1.5"
                  >
                    <Power className="w-3.5 h-3.5" />
                    <span>{isVi ? 'Rời Phòng' : 'Leave Room'}</span>
                  </button>
                </div>
              </div>

              {/* Local Proxy Address & Launch Game Button */}
              <div className="flex flex-wrap items-center justify-between p-3.5 rounded-xl bg-black/50 border border-white/5 gap-3">
                <div>
                  <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider mb-0.5">
                    {isVi ? 'Địa chỉ để vào game' : 'Address to join in Minecraft'}
                  </div>
                  <div className="text-xs font-mono font-bold text-emerald-300">
                    127.0.0.1:{clientStatus.localPort}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(`127.0.0.1:${clientStatus.localPort}`);
                      setTicketCopied(true);
                      setTimeout(() => setTicketCopied(false), 2000);
                    }}
                    className="px-3.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-slate-200 flex items-center gap-1.5 transition cursor-pointer shrink-0 active:scale-95"
                  >
                    {ticketCopied ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {ticketCopied ? (isVi ? 'Đã Chép' : 'Copied') : isVi ? 'Sao Chép' : 'Copy'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={handlePlayNow}
                    className="btn-primary px-4 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer active:scale-95 transition shadow-md shadow-[var(--accent-glow)]"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>{isVi ? 'Vào Game Ngay' : 'Play Now'}</span>
                  </button>
                </div>
              </div>

              {/* Radmin-Style Connected Members Table */}
              <div className="p-4 rounded-xl bg-black/40 border border-white/5 space-y-3">
                <div className="flex items-center justify-between border-b border-white/5 pb-2">
                  <div className="flex items-center gap-2">
                    <Users className="w-3.5 h-3.5 text-[var(--accent-color)]" />
                    <span className="text-xs font-bold text-white uppercase tracking-wider">
                      {isVi ? 'Người chơi cùng phòng' : 'Players in Room'} (
                      {clientStatus.members?.length || 1})
                    </span>
                  </div>
                </div>

                <div className="divide-y divide-white/5">
                  {clientStatus.members?.map((member: P2PMemberInfo) => (
                    <div
                      key={member.nodeId}
                      className="py-2 flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <img
                          src={`https://minotar.net/helm/${encodeURIComponent(
                            member.username
                          )}/48.png`}
                          alt={member.username}
                          onError={(e) => {
                            (e.target as HTMLElement).style.display = 'none';
                          }}
                          className="w-7 h-7 rounded-lg bg-black/50 border border-white/10 shrink-0"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-white truncate">
                              {member.username}
                            </span>
                            {member.isHost && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[var(--accent-color)]/20 text-[var(--accent-color)] border border-[var(--accent-color)]/30">
                                {isVi ? 'Chủ phòng' : 'Host'}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="shrink-0">{renderPingBadge(member.pingMs)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
