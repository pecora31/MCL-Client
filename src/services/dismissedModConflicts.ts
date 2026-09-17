// Lets a player silence a specific mod-conflict warning for good, scoped to the profile and the
// exact mod pair it's about. This exists because the conflict checker reads mod metadata, and a
// dependency installed by hand (outside MCL's own mod search) can be present and working while
// still not matching what the metadata declares — a false positive the player can already see
// is wrong every time they launch, with no way to tell MCL "I know, stop asking".
import type { ModConflict } from '../types';

const STORAGE_KEY = 'mcl_dismissed_mod_conflicts';

function conflictKey(instanceId: string, conflict: ModConflict): string {
  return `${instanceId}::${conflict.kind}::${conflict.fileName}::${conflict.targetId}`;
}

function loadDismissedKeys(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveDismissedKeys(keys: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...keys]));
  } catch {
    // Best-effort only — losing this list just means the warning comes back.
  }
}

export function filterDismissedConflicts(instanceId: string, conflicts: ModConflict[]): ModConflict[] {
  const dismissed = loadDismissedKeys();
  return conflicts.filter((c) => !dismissed.has(conflictKey(instanceId, c)));
}

export function dismissConflicts(instanceId: string, conflicts: ModConflict[]): void {
  const keys = loadDismissedKeys();
  for (const c of conflicts) keys.add(conflictKey(instanceId, c));
  saveDismissedKeys(keys);
}
