export type HealthBarMode = "both" | "allies" | "enemies" | "none";

export interface DisplaySettings {
  healthBars: HealthBarMode;
}

const STORAGE_KEY = "lindocara.display";
export const HEALTH_BAR_PROXIMITY = 280;
export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = { healthBars: "both" };

const listeners = new Set<() => void>();
let settings = loadSettings();

function isHealthBarMode(value: unknown): value is HealthBarMode {
  return value === "both" || value === "allies" || value === "enemies" || value === "none";
}

function loadSettings(): DisplaySettings {
  if (typeof localStorage === "undefined") return { ...DEFAULT_DISPLAY_SETTINGS };
  try {
    const parsed = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? "null",
    ) as Partial<DisplaySettings> | null;
    return {
      healthBars: isHealthBarMode(parsed?.healthBars)
        ? parsed.healthBars
        : DEFAULT_DISPLAY_SETTINGS.healthBars,
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
  };
  if (typeof localStorage !== "undefined")
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
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
): boolean {
  return healthBarsEnabled(mode, kind) && distance <= HEALTH_BAR_PROXIMITY;
}
