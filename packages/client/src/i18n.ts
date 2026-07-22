/**
 * Locale state for the client. The core (t, currentLocale, onLocaleChange, applyLocale) lives in
 * the renderer package so in-world text can be drawn without pulling React into the renderer;
 * this module re-exports it and adds the React `useLocale` hook and a `setLocale` that flushes
 * synchronously. First visit: browser language (fr* → French). The FR/EN toggle persists to
 * localStorage and re-renders live — no reload.
 */

import type { Locale } from "@lindocara/engine/i18n/index.js";
import { applyLocale, currentLocale, onLocaleChange } from "@lindocara/renderer/locale.js";
import { useSyncExternalStore } from "react";
import { flushSync } from "react-dom";

export type { Locale, MessageKey } from "@lindocara/engine/i18n/index.js";
export { currentLocale, onLocaleChange, t } from "@lindocara/renderer/locale.js";

export function setLocale(locale: Locale): void {
  // React 18+ defers updates from outside its own event handlers to a microtask, even for
  // useSyncExternalStore subscribers. flushSync makes the toggle apply in the same tick it is
  // called in, so every mounted screen re-translates immediately, not one tick later.
  applyLocale(locale, flushSync);
}

/** React subscription to the locale — components re-render on toggle. */
export function useLocale(): Locale {
  return useSyncExternalStore(onLocaleChange, currentLocale);
}
