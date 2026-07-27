/**
 * The authored audio catalogue.
 *
 * IDs, roles and public URLs live in the platform-free engine so the editor, Worker and browser
 * agree on the only values that may be persisted or sent over the wire. The files themselves are
 * served by the client package from `public/assets/lindocara/audio/`.
 */

export const MUSIC_TRACKS = [
  {
    id: "field-of-dreams",
    title: "The Field of Dreams",
    author: "pauliuw",
    src: "/assets/lindocara/audio/title-theme.mp3",
  },
  {
    id: "new-sunrise",
    title: "New Sunrise",
    author: "nene",
    src: "/assets/lindocara/audio/title-theme-epic.mp3",
  },
  {
    id: "town-theme",
    title: "Town Theme RPG",
    author: "cynicmusic",
    src: "/assets/lindocara/audio/town-theme.mp3",
  },
  {
    id: "bards-tale",
    title: "Medieval: The Bard's Tale",
    author: "RandomMind",
    src: "/assets/lindocara/audio/bards-tale.mp3",
  },
  {
    id: "cave-theme",
    title: "Cave Theme",
    author: "Brandon75689",
    src: "/assets/lindocara/audio/cave-theme.ogg",
  },
  {
    id: "dungeon-ambience",
    title: "Dungeon Ambience",
    author: "yd",
    src: "/assets/lindocara/audio/dungeon-ambience.ogg",
  },
  {
    id: "battle-theme",
    title: "Battle Theme A",
    author: "cynicmusic",
    src: "/assets/lindocara/audio/battle-theme.mp3",
  },
] as const;

export const AMBIENCE_TRACKS = [
  {
    id: "forest-ambience",
    title: "Forest Ambience",
    author: "TinyWorlds",
    src: "/assets/lindocara/audio/gloamwood-ambience.mp3",
  },
  {
    id: "swamp-ambience",
    title: "Swamp Environment Audio",
    author: "LokiF",
    src: "/assets/lindocara/audio/swamp-ambience.ogg",
  },
] as const;

export type MusicTrackId = (typeof MUSIC_TRACKS)[number]["id"];
export type AmbienceTrackId = (typeof AMBIENCE_TRACKS)[number]["id"];

export interface AdventureAudioConfig {
  /** Exploration music. `null` deliberately leaves the music channel silent. */
  music: MusicTrackId | null;
  /** Environmental bed mixed below music. `null` deliberately leaves the ambience channel silent. */
  ambience: AmbienceTrackId | null;
  /** Music selected for recent combat activity. `null` keeps exploration music during combat. */
  combatMusic: MusicTrackId | null;
}

/**
 * A missing map field inherits the adventure value; `null` is an explicit silence override.
 * Optional fields survive JSON storage naturally because `JSON.stringify` omits `undefined`.
 */
export interface MapAudioConfig {
  music?: MusicTrackId | null;
  ambience?: AmbienceTrackId | null;
  combatMusic?: MusicTrackId | null;
}

export const DEFAULT_ADVENTURE_AUDIO: AdventureAudioConfig = {
  music: null,
  ambience: "forest-ambience",
  combatMusic: null,
};

export const EMPTY_MAP_AUDIO: MapAudioConfig = {};

const MUSIC_IDS = new Set<string>(MUSIC_TRACKS.map((track) => track.id));
const AMBIENCE_IDS = new Set<string>(AMBIENCE_TRACKS.map((track) => track.id));

export function isMusicTrackId(value: unknown): value is MusicTrackId {
  return typeof value === "string" && MUSIC_IDS.has(value);
}

export function isAmbienceTrackId(value: unknown): value is AmbienceTrackId {
  return typeof value === "string" && AMBIENCE_IDS.has(value);
}

export function musicTrack(id: MusicTrackId | null) {
  return id === null ? null : (MUSIC_TRACKS.find((track) => track.id === id) ?? null);
}

export function ambienceTrack(id: AmbienceTrackId | null) {
  return id === null ? null : (AMBIENCE_TRACKS.find((track) => track.id === id) ?? null);
}

export function parseAdventureAudioConfig(value: unknown): AdventureAudioConfig | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const music = record.music ?? null;
  const ambience = record.ambience ?? null;
  const combatMusic = record.combatMusic ?? null;
  if (music !== null && !isMusicTrackId(music)) return null;
  if (ambience !== null && !isAmbienceTrackId(ambience)) return null;
  if (combatMusic !== null && !isMusicTrackId(combatMusic)) return null;
  return { music, ambience, combatMusic };
}

export function parseMapAudioConfig(value: unknown): MapAudioConfig | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const parsed: MapAudioConfig = {};
  if (record.music !== undefined) {
    if (record.music !== null && !isMusicTrackId(record.music)) return null;
    parsed.music = record.music;
  }
  if (record.ambience !== undefined) {
    if (record.ambience !== null && !isAmbienceTrackId(record.ambience)) return null;
    parsed.ambience = record.ambience;
  }
  if (record.combatMusic !== undefined) {
    if (record.combatMusic !== null && !isMusicTrackId(record.combatMusic)) return null;
    parsed.combatMusic = record.combatMusic;
  }
  return parsed;
}

export function resolveMapAudio(
  adventure: AdventureAudioConfig,
  map: MapAudioConfig,
): AdventureAudioConfig {
  return {
    music: map.music === undefined ? adventure.music : map.music,
    ambience: map.ambience === undefined ? adventure.ambience : map.ambience,
    combatMusic: map.combatMusic === undefined ? adventure.combatMusic : map.combatMusic,
  };
}
