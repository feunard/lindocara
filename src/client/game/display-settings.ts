export type HealthBarMode = "both" | "allies" | "enemies" | "none";

export interface DisplaySettings {
  healthBars: HealthBarMode;
  /** Draws the tile grid the world actually collides against. Off by default: it is a debug view,
   *  not decoration. */
  grid: boolean;
}

const STORAGE_KEY = "lindocara.display";
export const HEALTH_BAR_PROXIMITY = 280;
export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = { healthBars: "both", grid: false };

const listeners = new Set<() => void>();
let settings = loadSettings();

interface DisplayStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function displayStorage(): DisplayStorage | undefined {
  const candidate = (globalThis as { localStorage?: unknown }).localStorage;
  if (
    !candidate ||
    typeof candidate !== "object" ||
    !("getItem" in candidate) ||
    !("setItem" in candidate) ||
    typeof candidate.getItem !== "function" ||
    typeof candidate.setItem !== "function"
  ) {
    return undefined;
  }
  return candidate as DisplayStorage;
}

function isHealthBarMode(value: unknown): value is HealthBarMode {
  return value === "both" || value === "allies" || value === "enemies" || value === "none";
}

function loadSettings(): DisplaySettings {
  const storage = displayStorage();
  if (!storage) return { ...DEFAULT_DISPLAY_SETTINGS };
  try {
    const parsed = JSON.parse(
      storage.getItem(STORAGE_KEY) ?? "null",
    ) as Partial<DisplaySettings> | null;
    return {
      healthBars: isHealthBarMode(parsed?.healthBars)
        ? parsed.healthBars
        : DEFAULT_DISPLAY_SETTINGS.healthBars,
      grid: typeof parsed?.grid === "boolean" ? parsed.grid : DEFAULT_DISPLAY_SETTINGS.grid,
    };
  } catch {
    return { ...DEFAULT_DISPLAY_SETTINGS };
  }
}

export function getDisplaySettings(): DisplaySettings {
  return settings;
}

export function setDisplaySettings(partial: Partial<DisplaySettings>): void {
  settings = {
    healthBars: isHealthBarMode(partial.healthBars) ? partial.healthBars : settings.healthBars,
    grid: typeof partial.grid === "boolean" ? partial.grid : settings.grid,
  };
  displayStorage()?.setItem(STORAGE_KEY, JSON.stringify(settings));
  for (const listener of listeners) listener();
}

export function subscribeDisplaySettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function healthBarsEnabled(mode: HealthBarMode, kind: "ally" | "enemy"): boolean {
  return mode === "both" || mode === (kind === "ally" ? "allies" : "enemies");
}

export function shouldShowHealthBar(
  mode: HealthBarMode,
  kind: "ally" | "enemy",
  distance: number,
  targeted = false,
): boolean {
  return targeted || (healthBarsEnabled(mode, kind) && distance <= HEALTH_BAR_PROXIMITY);
}
