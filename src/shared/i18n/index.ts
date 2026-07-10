/**
 * Dictionary data and pure formatting. Platform-free: the client renders these; the server
 * only ever sends keys and params (protocol event codes), never translated text.
 */

import { en } from "./en.js";
import { fr } from "./fr.js";

export type MessageKey = keyof typeof en;
export type Locale = "en" | "fr";

export const dictionaries: Record<Locale, Record<MessageKey, string>> = { en, fr };

/** Replace `{token}` with params[token]; unknown tokens stay visible so bugs are legible. */
export function format(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}
