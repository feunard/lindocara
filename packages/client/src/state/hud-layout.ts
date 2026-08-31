/**
 * Persistent, viewport-relative placement for the in-game HUD widgets.
 *
 * This module intentionally has no React or Alepha dependency. The game loop reads the edit flag
 * to pause movement/actions, while React subscribes through `useSyncExternalStore` in the HUD
 * components. Pointer movement is only written here while the explicit editor is open, so this is
 * not part of the 60 Hz zustand bridge.
 */

export const HUD_LAYOUT_STORAGE_KEY = "lindocara.hud.layout.v1";

export const HUD_WIDGET_IDS = [
  "hero",
  "quests",
  "chat",
  "quick-items",
  "peasant-resources",
  "skill-2",
  "skill-3",
  "skill-4",
  "skill-5",
  "xp",
  "minimap",
] as const;

export type HudWidgetId = (typeof HUD_WIDGET_IDS)[number];

export interface HudWidgetPlacement {
  /** Widget centre as a fraction of the viewport width. */
  x: number;
  /** Widget centre as a fraction of the viewport height. */
  y: number;
  /** Uniform visual scale. */
  scale: number;
}

export type HudLayout = Record<HudWidgetId, HudWidgetPlacement>;

export interface HudLayoutSnapshot {
  editing: boolean;
  layout: HudLayout;
}

interface PersistedHudLayout {
  version: 1;
  widgets: Partial<Record<HudWidgetId, HudWidgetPlacement>>;
}

const MIN_POSITION = 0.01;
const MAX_POSITION = 0.99;
const DEFAULT_VIEWPORT = { width: 1280, height: 720 };
const listeners = new Set<() => void>();

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function viewportSize(): { width: number; height: number } {
  if (typeof window === "undefined") return DEFAULT_VIEWPORT;
  return {
    width: Math.max(320, window.innerWidth),
    height: Math.max(480, window.innerHeight),
  };
}

function placement(x: number, y: number, scale = 1): HudWidgetPlacement {
  return { x, y, scale };
}

/** Defaults reproduce the existing corner/dock anchors while adapting to narrow viewports. */
export function defaultHudLayout(
  viewport: { width: number; height: number } = viewportSize(),
): HudLayout {
  const width = Math.max(320, viewport.width);
  const height = Math.max(480, viewport.height);
  const heroWidth = Math.min(320, width - 24);
  const heroCenterX = 12 + heroWidth / 2;
  const heroCenterY = 70;
  const questWidth = Math.min(256, width - 24);
  const questScale = 0.9;
  const questCenterY = Math.min(height - 96, Math.max(250, height * 0.3));
  const chatWidth = Math.min(504, width - 24);
  const chatHeight = Math.min(330, height - 160);
  const dockOffset = Math.min(190, width * 0.24);
  const quickCenterX = width / 2 - dockOffset;
  const skillCenterX = width / 2 + dockOffset;
  const minimapRadius = 88;
  const resourceWidth = Math.min(256, width - 24);

  return {
    hero: placement(heroCenterX / width, heroCenterY / height),
    quests: placement(
      (12 + (questWidth * questScale) / 2) / width,
      questCenterY / height,
      questScale,
    ),
    chat: placement((12 + chatWidth / 2) / width, (height - 97 - chatHeight / 2) / height),
    "quick-items": placement(quickCenterX / width, (height - 135) / height),
    "peasant-resources": placement(
      (width - 12 - resourceWidth / 2) / width,
      Math.max(180, height * 0.5) / height,
      0.82,
    ),
    "skill-2": placement((skillCenterX + 50) / width, (height - 135) / height),
    "skill-3": placement(skillCenterX / width, (height - 85) / height),
    "skill-4": placement((skillCenterX - 50) / width, (height - 135) / height),
    "skill-5": placement(skillCenterX / width, (height - 185) / height),
    xp: placement(0.5, (height - 36) / height),
    minimap: placement((width - 12 - minimapRadius) / width, (12 + minimapRadius) / height),
  };
}

export function hudWidgetScaleLimits(id: HudWidgetId): { min: number; max: number } {
  return id.startsWith("skill-") ? { min: 0.65, max: 2.25 } : { min: 0.6, max: 1.8 };
}

export function normalizeHudWidgetPlacement(
  id: HudWidgetId,
  value: HudWidgetPlacement,
): HudWidgetPlacement {
  const limits = hudWidgetScaleLimits(id);
  return {
    x: clamp(Number.isFinite(value.x) ? value.x : 0.5, MIN_POSITION, MAX_POSITION),
    y: clamp(Number.isFinite(value.y) ? value.y : 0.5, MIN_POSITION, MAX_POSITION),
    scale: clamp(Number.isFinite(value.scale) ? value.scale : 1, limits.min, limits.max),
  };
}

function cloneLayout(layout: HudLayout): HudLayout {
  return Object.fromEntries(
    HUD_WIDGET_IDS.map((id) => [id, { ...layout[id] }]),
  ) as unknown as HudLayout;
}

function isPlacement(value: unknown): value is HudWidgetPlacement {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<HudWidgetPlacement>;
  return (
    typeof candidate.x === "number" &&
    Number.isFinite(candidate.x) &&
    typeof candidate.y === "number" &&
    Number.isFinite(candidate.y) &&
    typeof candidate.scale === "number" &&
    Number.isFinite(candidate.scale)
  );
}

export function parseHudLayout(raw: string | null, defaults = defaultHudLayout()): HudLayout {
  if (!raw) return cloneLayout(defaults);
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return cloneLayout(defaults);
    const persisted = parsed as Partial<PersistedHudLayout>;
    if (persisted.version !== 1 || typeof persisted.widgets !== "object") {
      return cloneLayout(defaults);
    }
    const next = cloneLayout(defaults);
    for (const id of HUD_WIDGET_IDS) {
      const candidate = persisted.widgets?.[id];
      if (isPlacement(candidate)) next[id] = normalizeHudWidgetPlacement(id, candidate);
    }
    return next;
  } catch {
    return cloneLayout(defaults);
  }
}

function readStoredLayout(): HudLayout {
  const defaults = defaultHudLayout();
  if (typeof localStorage === "undefined") return defaults;
  try {
    return parseHudLayout(localStorage.getItem(HUD_LAYOUT_STORAGE_KEY), defaults);
  } catch {
    return defaults;
  }
}

function persistLayout(layout: HudLayout): void {
  if (typeof localStorage === "undefined") return;
  try {
    const value: PersistedHudLayout = { version: 1, widgets: layout };
    localStorage.setItem(HUD_LAYOUT_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // A locked-down/private browser may refuse storage; the saved in-memory layout still applies.
  }
}

let loaded = false;
let savedLayout = defaultHudLayout(DEFAULT_VIEWPORT);
let draftLayout = cloneLayout(savedLayout);
let snapshot: HudLayoutSnapshot = { editing: false, layout: savedLayout };

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  savedLayout = readStoredLayout();
  draftLayout = cloneLayout(savedLayout);
  snapshot = { editing: false, layout: savedLayout };
}

function publish(editing: boolean, layout: HudLayout): void {
  snapshot = { editing, layout };
  for (const listener of listeners) listener();
}

export function subscribeHudLayout(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getHudLayoutSnapshot(): HudLayoutSnapshot {
  ensureLoaded();
  return snapshot;
}

export function getServerHudLayoutSnapshot(): HudLayoutSnapshot {
  return snapshot;
}

export function isHudLayoutEditing(): boolean {
  return getHudLayoutSnapshot().editing;
}

export function beginHudLayoutEdit(): void {
  ensureLoaded();
  draftLayout = cloneLayout(savedLayout);
  publish(true, draftLayout);
}

export function updateHudWidget(id: HudWidgetId, value: HudWidgetPlacement): void {
  ensureLoaded();
  if (!snapshot.editing) return;
  draftLayout = { ...draftLayout, [id]: normalizeHudWidgetPlacement(id, value) };
  publish(true, draftLayout);
}

export function resetHudLayoutDraft(): void {
  ensureLoaded();
  if (!snapshot.editing) return;
  draftLayout = defaultHudLayout();
  publish(true, draftLayout);
}

export function saveHudLayoutEdit(): void {
  ensureLoaded();
  if (!snapshot.editing) return;
  savedLayout = cloneLayout(draftLayout);
  persistLayout(savedLayout);
  publish(false, savedLayout);
}

export function cancelHudLayoutEdit(): void {
  ensureLoaded();
  if (!snapshot.editing) return;
  draftLayout = cloneLayout(savedLayout);
  publish(false, savedLayout);
}

/** Re-read storage and leave edit mode. Also gives tests a deterministic module-state reset. */
export function reloadHudLayout(): void {
  loaded = true;
  savedLayout = readStoredLayout();
  draftLayout = cloneLayout(savedLayout);
  publish(false, savedLayout);
}
