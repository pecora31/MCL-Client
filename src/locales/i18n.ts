import en from './langs/en';

export type Language = 'vi' | 'en' | 'zh' | 'ja' | 'ko' | 'de' | 'fr' | 'es';

/** The full key set, defined by the English table every other language is checked against. */
export type Translation = typeof en;

// Only English ships inside the main bundle. The other seven are ~45KB of strings each and the
// app only ever renders one of them, so they load as their own chunks on demand.
const loaders: Record<Exclude<Language, 'en'>, () => Promise<{ default: Partial<Translation> }>> = {
  vi: () => import('./langs/vi'),
  zh: () => import('./langs/zh'),
  ja: () => import('./langs/ja'),
  ko: () => import('./langs/ko'),
  de: () => import('./langs/de'),
  fr: () => import('./langs/fr'),
  es: () => import('./langs/es'),
};

const loaded: Partial<Record<Language, Translation>> = { en };
const inFlight = new Map<Language, Promise<void>>();
const listeners = new Set<() => void>();

/**
 * The table for `lang`, or the English one while that language's chunk is still loading.
 * Components read this while rendering, so it stays synchronous; `subscribeToLanguageLoad` is
 * how the app finds out a real table arrived and it should render again.
 */
export function getTranslation(lang: Language): Translation {
  return loaded[lang] || en;
}

/** Whether `lang` can be rendered right now without falling back to English. */
export function isLanguageLoaded(lang: Language): boolean {
  return loaded[lang] !== undefined;
}

/** Fetches a language's chunk. Resolves immediately for one already in memory. */
export function loadLanguage(lang: Language): Promise<void> {
  if (loaded[lang]) return Promise.resolve();
  const existing = inFlight.get(lang);
  if (existing) return existing;

  const load = loaders[lang as Exclude<Language, 'en'>];
  if (!load) return Promise.resolve();

  const promise = load()
    .then((mod) => {
      // Merged over English rather than used on its own: a translation that is missing a key
      // then shows the English wording instead of rendering nothing at all.
      loaded[lang] = { ...en, ...mod.default };
      listeners.forEach((fn) => fn());
    })
    .catch((err) => {
      // Not fatal — every screen keeps rendering, in English.
      console.warn(`Could not load the ${lang} translations:`, err);
    })
    .finally(() => {
      inFlight.delete(lang);
    });

  inFlight.set(lang, promise);
  return promise;
}

export function subscribeToLanguageLoad(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
