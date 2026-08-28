export interface CameraSettings {
  /** Multiplier for the automatic movement-heading follow in 360-degree mode. */
  followSpeed: number;
  /** Mouse/right-stick horizontal orbit sensitivity multiplier. */
  horizontalSensitivity: number;
  /** Mouse/right-stick vertical pitch sensitivity multiplier. */
  verticalSensitivity: number;
}

const STORAGE_KEY = "lindocara.camera";
export const CAMERA_SETTING_MIN = 0.25;
export const CAMERA_SETTING_MAX = 2;
export const DEFAULT_CAMERA_SETTINGS: CameraSettings = {
  followSpeed: 1,
  horizontalSensitivity: 1,
  verticalSensitivity: 1,
};

const listeners = new Set<() => void>();

function normalized(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(CAMERA_SETTING_MIN, Math.min(CAMERA_SETTING_MAX, value));
}

function loadSettings(): CameraSettings {
  try {
    const parsed = JSON.parse(
      globalThis.localStorage?.getItem(STORAGE_KEY) ?? "null",
    ) as Partial<CameraSettings> | null;
    return {
      followSpeed: normalized(parsed?.followSpeed, DEFAULT_CAMERA_SETTINGS.followSpeed),
      horizontalSensitivity: normalized(
        parsed?.horizontalSensitivity,
        DEFAULT_CAMERA_SETTINGS.horizontalSensitivity,
      ),
      verticalSensitivity: normalized(
        parsed?.verticalSensitivity,
        DEFAULT_CAMERA_SETTINGS.verticalSensitivity,
      ),
    };
  } catch {
    return { ...DEFAULT_CAMERA_SETTINGS };
  }
}

let settings = loadSettings();

export function getCameraSettings(): CameraSettings {
  return settings;
}

export function setCameraSettings(partial: Partial<CameraSettings>): void {
  settings = {
    followSpeed: normalized(partial.followSpeed, settings.followSpeed),
    horizontalSensitivity: normalized(
      partial.horizontalSensitivity,
      settings.horizontalSensitivity,
    ),
    verticalSensitivity: normalized(partial.verticalSensitivity, settings.verticalSensitivity),
  };
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private/disabled storage still keeps the live in-memory preference.
  }
  for (const listener of listeners) listener();
}

export function subscribeCameraSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
