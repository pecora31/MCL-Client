// Persistence helpers for the launcher's mcl_* localStorage keys.

export function readStoredJson<T>(key: string, fallback: T): T {
  try {
    const saved = localStorage.getItem(key);
    return saved ? (JSON.parse(saved) as T) : fallback;
  } catch (err) {
    console.warn(`Discarding corrupted localStorage entry "${key}":`, err);
    return fallback;
  }
}

// Custom backgrounds are stored inline as data URIs, so writes can exceed the storage quota
export function writeStoredJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn(`Failed to persist localStorage entry "${key}":`, err);
  }
}

// Bump when the shape of persisted mcl_* data changes, and add the matching step below.
const STORAGE_SCHEMA_VERSION = 3;

function dropStoredEntriesById(key: string, ids: string[]) {
  const raw = localStorage.getItem(key);
  if (!raw) return;
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return;
    const kept = list.filter((item) => !ids.includes(item?.id));
    if (kept.length !== list.length) {
      localStorage.setItem(key, JSON.stringify(kept));
    }
  } catch {
    // Unreadable lists are discarded by readStoredJson anyway
  }
}

export function runStorageMigrations() {
  try {
    const raw = localStorage.getItem('mcl_schema_version');
    let stored: number;
    if (raw !== null) {
      stored = Number(raw);
    } else {
      // Unstamped data predates versioning; only an empty store is a fresh install
      const hasExistingData = Object.keys(localStorage).some((key) => key.startsWith('mcl_'));
      stored = hasExistingData ? 1 : STORAGE_SCHEMA_VERSION;
    }

    if (stored > STORAGE_SCHEMA_VERSION) {
      console.warn(`Local data comes from a newer launcher (v${stored}); leaving it untouched.`);
      return;
    }

    // Steps run in order, each upgrading from the version before it.
    if (stored < 2) {
      // The language moved out of settings; mcl_lang is the only source now
      const rawSettings = localStorage.getItem('mcl_settings');
      if (rawSettings) {
        try {
          const parsed = JSON.parse(rawSettings);
          if (parsed && typeof parsed === 'object' && 'language' in parsed) {
            if (!localStorage.getItem('mcl_lang')) {
              localStorage.setItem('mcl_lang', parsed.language);
            }
            delete parsed.language;
            localStorage.setItem('mcl_settings', JSON.stringify(parsed));
          }
        } catch {
          // Unreadable settings are discarded by readStoredJson anyway
        }
      }
    }

    if (stored < 3) {
      // Early builds seeded sample profiles and servers with fixed ids, while
      // anything the user creates carries a timestamp suffix
      const sampleInstanceIds = ['server-instance-01', 'instance-vanilla-latest', 'instance-forge-1201'];
      const sampleServerIds = ['srv-01', 'srv-02'];
      dropStoredEntriesById('mcl_instances', sampleInstanceIds);
      dropStoredEntriesById('mcl_servers', sampleServerIds);
      const activeServer = localStorage.getItem('mcl_active_server');
      if (activeServer && sampleServerIds.includes(activeServer)) {
        localStorage.removeItem('mcl_active_server');
      }
    }

    localStorage.setItem('mcl_schema_version', String(STORAGE_SCHEMA_VERSION));
  } catch (err) {
    console.warn('Storage migration skipped:', err);
  }
}
