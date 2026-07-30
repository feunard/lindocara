/**
 * Locale core: the current locale, the translate function and the change subscription. No React
 * here — the renderer needs `t`/`onLocaleChange` to draw in-world text, and the renderer package
 * must stay React-free. The client's i18n module re-exports these and adds the React `useLocale`
 * hook plus a `setLocale` that flushes React synchronously.
 */

import {
  dictionaries,
  format,
  type Locale,
  type MessageKey,
} from "@lindocara/engine/i18n/index.js";

const STORAGE_KEY = "lindocara_locale";
const listeners = new Set<() => void>();

function detectLocale(): Locale {
  // Guarded like `input-settings.ts`'s `loadSettings`/`firstConnectedGamepad`: this module is now
  // reachable from a Node import (the Alepha server entry statically imports the `$page` tree,
  // which imports the screens, which import `t` from here) with `ssr: false` on the root layout —
  // the component never renders server-side, but the module still has to EVALUATE without a DOM.
  if (typeof localStorage === "undefined" || typeof navigator === "undefined") return "en";
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "en" || stored === "fr") return stored;
  return navigator.language.toLowerCase().startsWith("fr") ? "fr" : "en";
}

let current: Locale = detectLocale();

export function currentLocale(): Locale {
  return current;
}

export function t(key: MessageKey, params?: Record<string, string | number>): string {
  // An unknown key prints verbatim. For a D1 map the server sends the map's raw name as
  // `zoneNameKey` — not an i18n key — so printing the "key" is exactly the map's name, never
  // "undefined".
  const table = dictionaries[current] as Record<string, string | undefined>;
  return format(table[key] ?? key, params);
}

/**
 * Apply a new locale and notify subscribers. `notify` wraps the listener loop so the client can
 * pass React's `flushSync` (applying the toggle in the same tick) without the renderer importing
 * React. Default: run the listeners directly.
 */
export function applyLocale(
  locale: Locale,
  notify: (run: () => void) => void = (run) => run(),
): void {
  if (locale === current) return;
  current = locale;
  localStorage.setItem(STORAGE_KEY, locale);
  document.documentElement.lang = locale;
  notify(() => {
    for (const listener of listeners) listener();
  });
}

export function onLocaleChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
