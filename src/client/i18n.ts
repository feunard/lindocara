/**
 * Locale state and DOM application. First visit: browser language (fr* → French). The
 * FR/EN toggle persists to localStorage and re-renders live — no reload.
 */

import { useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { dictionaries, format, type Locale, type MessageKey } from "../shared/i18n/index.js";

const STORAGE_KEY = "lindocara_locale";
const listeners = new Set<() => void>();

function detectLocale(): Locale {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "en" || stored === "fr") return stored;
  return navigator.language.toLowerCase().startsWith("fr") ? "fr" : "en";
}

let current: Locale = detectLocale();

export function currentLocale(): Locale {
  return current;
}

export function t(key: MessageKey, params?: Record<string, string | number>): string {
  return format(dictionaries[current][key], params);
}

export function setLocale(locale: Locale): void {
  if (locale === current) return;
  current = locale;
  localStorage.setItem(STORAGE_KEY, locale);
  document.documentElement.lang = locale;
  // React 18+ defers updates from outside its own event handlers to a microtask, even for
  // useSyncExternalStore subscribers. flushSync makes the toggle apply in the same tick it
  // is called in, so every mounted screen re-translates immediately, not one tick later.
  flushSync(() => {
    for (const listener of listeners) listener();
  });
}

export function onLocaleChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React subscription to the locale — components re-render on toggle. */
export function useLocale(): Locale {
  return useSyncExternalStore(onLocaleChange, currentLocale);
}

/**
 * `data-i18n="key"` sets textContent. `data-i18n-attr="attr:key;attr2:key2"` sets
 * attributes (placeholders, aria-labels, titles).
 */
export function applyStaticText(root: ParentNode = document): void {
  for (const element of root.querySelectorAll<HTMLElement>("[data-i18n]")) {
    const key = element.dataset.i18n;
    if (key) element.textContent = t(key as MessageKey);
  }
  for (const element of root.querySelectorAll<HTMLElement>("[data-i18n-attr]")) {
    for (const pair of (element.dataset.i18nAttr ?? "").split(";")) {
      const colon = pair.indexOf(":");
      if (colon <= 0) continue;
      element.setAttribute(pair.slice(0, colon), t(pair.slice(colon + 1) as MessageKey));
    }
  }
}

/** Stamp <html lang>, and apply the initial pass. Call once at boot. */
export function initLocale(): void {
  document.documentElement.lang = current;
  onLocaleChange(() => applyStaticText());
  applyStaticText();
}
