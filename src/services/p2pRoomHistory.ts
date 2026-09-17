// Local-only memory of rooms this player has joined via someone else's ticket. P2P rooms have
// no server-side state at all (see PRIVACY.md), so this is purely a client-side convenience —
// nothing here is synced or visible to anyone else, and it only ever remembers rooms *joined*,
// never rooms this player hosted (a hosted room isn't a thing you'd "reconnect to" the same way).
import type { Language } from '../locales/i18n';

export interface P2PRoomHistoryEntry {
  id: string;
  roomName: string;
  hostUsername: string;
  ticket: string;
  joinedAt: number;
}

const STORAGE_KEY = 'mcl_p2p_room_history';
const MAX_ENTRIES = 20;

export function loadP2PRoomHistory(): P2PRoomHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as P2PRoomHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function saveP2PRoomHistory(entries: P2PRoomHistoryEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Best-effort only — losing this list costs nothing but the convenience it provides.
  }
}

/** Moves this room to the front of history (deduped by ticket), trimming to the most recent. */
export function rememberJoinedRoom(entry: { roomName: string; hostUsername: string; ticket: string }): P2PRoomHistoryEntry[] {
  const rest = loadP2PRoomHistory().filter((e) => e.ticket !== entry.ticket);
  const next = [{ id: `${Date.now()}`, joinedAt: Date.now(), ...entry }, ...rest].slice(0, MAX_ENTRIES);
  saveP2PRoomHistory(next);
  return next;
}

export function forgetP2PRoom(id: string): P2PRoomHistoryEntry[] {
  const next = loadP2PRoomHistory().filter((e) => e.id !== id);
  saveP2PRoomHistory(next);
  return next;
}

/**
 * Same idea, keyed by ticket instead of id — for when a reconnect attempt is what discovers the
 * entry is dead (the host rejected it as a stale invite for a room that no longer runs), rather
 * than the player explicitly deleting it. Without this, a room that can never succeed again sits
 * in the list indefinitely with nothing distinguishing it from one that still works.
 */
export function forgetP2PRoomByTicket(ticket: string): P2PRoomHistoryEntry[] {
  const next = loadP2PRoomHistory().filter((e) => e.ticket !== ticket);
  saveP2PRoomHistory(next);
  return next;
}

export function formatRelativeTime(timestampMs: number, language: Language): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000));
  const isVi = language === 'vi';
  if (seconds < 60) return isVi ? 'Vừa xong' : 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return isVi ? `${minutes} phút trước` : `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return isVi ? `${hours} giờ trước` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return isVi ? `${days} ngày trước` : `${days}d ago`;
}
