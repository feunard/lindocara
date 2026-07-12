export interface AudioSettings {
  muted: boolean;
  /** 0–1 multiplier applied to combat and UI samples. */
  sfxVolume: number;
  /** 0–1 multiplier applied to the ambient music bed. */
  ambientVolume: number;
}

const STORAGE_KEY = "lindocara.audio";

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  muted: false,
  sfxVolume: 0.65,
  ambientVolume: 0.45,
};

const listeners = new Set<() => void>();

let settings = loadSettings();

function loadSettings(): AudioSettings {
  if (typeof localStorage === "undefined") return { ...DEFAULT_AUDIO_SETTINGS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_AUDIO_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AudioSettings>;
    return {
      muted: parsed.muted === true,
      sfxVolume: clamp01(parsed.sfxVolume ?? DEFAULT_AUDIO_SETTINGS.sfxVolume),
      ambientVolume: clamp01(parsed.ambientVolume ?? DEFAULT_AUDIO_SETTINGS.ambientVolume),
    };
  } catch {
    return { ...DEFAULT_AUDIO_SETTINGS };
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_AUDIO_SETTINGS.sfxVolume;
  return Math.min(1, Math.max(0, value));
}

function persistSettings(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function notify(): void {
  for (const listener of listeners) listener();
}

export function getAudioSettings(): AudioSettings {
  return settings;
}

export function setAudioSettings(partial: Partial<AudioSettings>): void {
  settings = {
    muted: partial.muted ?? settings.muted,
    sfxVolume: partial.sfxVolume === undefined ? settings.sfxVolume : clamp01(partial.sfxVolume),
    ambientVolume:
      partial.ambientVolume === undefined ? settings.ambientVolume : clamp01(partial.ambientVolume),
  };
  persistSettings();
  notify();
}

export function subscribeAudioSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
