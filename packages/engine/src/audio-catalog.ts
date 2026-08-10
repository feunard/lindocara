/**
 * The authored audio catalogue.
 *
 * IDs, roles and public URLs live in the platform-free engine so the editor, Worker and browser
 * agree on the only values that may be persisted or sent over the wire. The files themselves are
 * served by the client package from `public/assets/lindocara/audio/`.
 */
import {
  GENERATED_MUSIC_TRACKS,
  LINDOCARA_MUSIC_DNA,
  MUSIC_PROFILES,
} from "./music-catalog.generated.js";

export { LINDOCARA_MUSIC_DNA, MUSIC_PROFILES };

/**
 * Music is ours alone: every track here is generated in-house with the studio's music lane, so
 * the catalogue carries no third-party licence obligation. The third-party OpenGameArt music that
 * used to live here was removed with its files; only `AMBIENCE_TRACKS` below is still borrowed.
 * Legacy captions/seeds are in `audio/CREDITS.md`; profile generations are reproducibly recorded
 * in `studio/musics/generations.json` and compiled into `music-catalog.generated.ts`.
 */
const LEGACY_MUSIC_TRACKS = [
  {
    id: "plain-1",
    title: "Sunlit Plain",
    author: "lindocara",
    src: "/assets/lindocara/audio/plain_1.mp3",
  },
  {
    id: "forest-1",
    title: "Deep Forest I",
    author: "lindocara",
    src: "/assets/lindocara/audio/forest_1.mp3",
  },
  {
    id: "forest-2",
    title: "Deep Forest II",
    author: "lindocara",
    src: "/assets/lindocara/audio/forest_2.mp3",
  },
  {
    id: "boss-1",
    title: "Boss Confrontation",
    author: "lindocara",
    src: "/assets/lindocara/audio/boss_1.mp3",
  },
  {
    id: "menu-1",
    title: "Menu Bed I",
    author: "lindocara",
    src: "/assets/lindocara/audio/menu_1.mp3",
  },
  {
    id: "menu-2",
    title: "Menu Bed II",
    author: "lindocara",
    src: "/assets/lindocara/audio/menu_2.mp3",
  },
] as const;

export const MUSIC_TRACKS = [...LEGACY_MUSIC_TRACKS, ...GENERATED_MUSIC_TRACKS] as const;

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
export type MusicProfileId = (typeof MUSIC_PROFILES)[number]["id"];

export const MUSIC_SITUATIONS = [
  "exploration",
  "night",
  "discovery",
  "danger",
  "combat",
  "boss",
] as const;
export type MusicSituation = (typeof MUSIC_SITUATIONS)[number];

export const MUSIC_PROFILE_FIELDS = [
  "explorationProfile",
  "nightProfile",
  "discoveryProfile",
  "dangerProfile",
  "combatProfile",
  "bossProfile",
] as const;
export type MusicProfileField = (typeof MUSIC_PROFILE_FIELDS)[number];

const SITUATION_PROFILE_FIELDS = {
  exploration: "explorationProfile",
  night: "nightProfile",
  discovery: "discoveryProfile",
  danger: "dangerProfile",
  combat: "combatProfile",
  boss: "bossProfile",
} as const satisfies Record<MusicSituation, MusicProfileField>;

export interface AdventureAudioConfig {
  /** Legacy single-track exploration fallback. Profiles take precedence when configured. */
  music: MusicTrackId | null;
  /** Environmental bed mixed below music. `null` deliberately leaves the ambience channel silent. */
  ambience: AmbienceTrackId | null;
  /** Legacy single-track danger/combat fallback. Profiles take precedence when configured. */
  combatMusic: MusicTrackId | null;
  explorationProfile: MusicProfileId | null;
  nightProfile: MusicProfileId | null;
  discoveryProfile: MusicProfileId | null;
  dangerProfile: MusicProfileId | null;
  combatProfile: MusicProfileId | null;
  bossProfile: MusicProfileId | null;
}

/**
 * A missing map field inherits the adventure value; `null` is an explicit silence override.
 * Optional fields survive JSON storage naturally because `JSON.stringify` omits `undefined`.
 */
export interface MapAudioConfig {
  music?: MusicTrackId | null;
  ambience?: AmbienceTrackId | null;
  combatMusic?: MusicTrackId | null;
  explorationProfile?: MusicProfileId | null;
  nightProfile?: MusicProfileId | null;
  discoveryProfile?: MusicProfileId | null;
  dangerProfile?: MusicProfileId | null;
  combatProfile?: MusicProfileId | null;
  bossProfile?: MusicProfileId | null;
}

export const DEFAULT_ADVENTURE_AUDIO: AdventureAudioConfig = {
  music: null,
  ambience: "forest-ambience",
  combatMusic: null,
  explorationProfile: "exploration",
  nightProfile: "night",
  discoveryProfile: "discovery",
  dangerProfile: "danger",
  combatProfile: "combat",
  bossProfile: "boss",
};

export const EMPTY_MAP_AUDIO: MapAudioConfig = {};

const MUSIC_IDS = new Set<string>(MUSIC_TRACKS.map((track) => track.id));
const AMBIENCE_IDS = new Set<string>(AMBIENCE_TRACKS.map((track) => track.id));
const MUSIC_PROFILE_IDS = new Set<string>(MUSIC_PROFILES.map((item) => item.id));

export function isMusicTrackId(value: unknown): value is MusicTrackId {
  return typeof value === "string" && MUSIC_IDS.has(value);
}

export function isAmbienceTrackId(value: unknown): value is AmbienceTrackId {
  return typeof value === "string" && AMBIENCE_IDS.has(value);
}

export function isMusicProfileId(value: unknown): value is MusicProfileId {
  return typeof value === "string" && MUSIC_PROFILE_IDS.has(value);
}

export function musicTrack(id: MusicTrackId | null) {
  return id === null ? null : (MUSIC_TRACKS.find((track) => track.id === id) ?? null);
}

export function ambienceTrack(id: AmbienceTrackId | null) {
  return id === null ? null : (AMBIENCE_TRACKS.find((track) => track.id === id) ?? null);
}

export function musicProfile(id: MusicProfileId | null) {
  return id === null ? null : (MUSIC_PROFILES.find((item) => item.id === id) ?? null);
}

function parseAdventureProfile(
  record: Record<string, unknown>,
  field: MusicProfileField,
): MusicProfileId | null | undefined {
  if (!Object.hasOwn(record, field)) return undefined;
  const value = record[field];
  if (value !== null && !isMusicProfileId(value)) return undefined;
  return value;
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
  const parsedProfiles = Object.fromEntries(
    MUSIC_PROFILE_FIELDS.map((field) => [field, parseAdventureProfile(record, field)]),
  ) as Record<MusicProfileField, MusicProfileId | null | undefined>;
  for (const field of MUSIC_PROFILE_FIELDS) {
    if (Object.hasOwn(record, field) && parsedProfiles[field] === undefined) return null;
  }
  const profileOrDefault = (field: MusicProfileField): MusicProfileId | null =>
    parsedProfiles[field] === undefined ? DEFAULT_ADVENTURE_AUDIO[field] : parsedProfiles[field];
  // Old payloads used only direct tracks. Honour those explicit choices; otherwise introduce the
  // new defaults so every historical adventure gains a complete dynamic soundtrack automatically.
  const explorationProfile =
    parsedProfiles.explorationProfile === undefined
      ? music === null
        ? DEFAULT_ADVENTURE_AUDIO.explorationProfile
        : null
      : parsedProfiles.explorationProfile;
  const combatProfile =
    parsedProfiles.combatProfile === undefined
      ? combatMusic === null
        ? DEFAULT_ADVENTURE_AUDIO.combatProfile
        : null
      : parsedProfiles.combatProfile;
  return {
    music,
    ambience,
    combatMusic,
    explorationProfile,
    nightProfile: profileOrDefault("nightProfile"),
    discoveryProfile: profileOrDefault("discoveryProfile"),
    dangerProfile: profileOrDefault("dangerProfile"),
    combatProfile,
    bossProfile: profileOrDefault("bossProfile"),
  };
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
  for (const field of MUSIC_PROFILE_FIELDS) {
    const value = record[field];
    if (value === undefined) continue;
    if (value !== null && !isMusicProfileId(value)) return null;
    parsed[field] = value;
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
    explorationProfile:
      map.explorationProfile !== undefined
        ? map.explorationProfile
        : map.music !== undefined
          ? null
          : adventure.explorationProfile,
    nightProfile: map.nightProfile === undefined ? adventure.nightProfile : map.nightProfile,
    discoveryProfile:
      map.discoveryProfile === undefined ? adventure.discoveryProfile : map.discoveryProfile,
    dangerProfile:
      map.dangerProfile !== undefined
        ? map.dangerProfile
        : map.combatMusic !== undefined
          ? null
          : adventure.dangerProfile,
    combatProfile:
      map.combatProfile !== undefined
        ? map.combatProfile
        : map.combatMusic !== undefined
          ? null
          : adventure.combatProfile,
    bossProfile:
      map.bossProfile !== undefined
        ? map.bossProfile
        : map.combatMusic !== undefined
          ? null
          : adventure.bossProfile,
  };
}

export interface DynamicMusicState {
  nightWeight: number;
  discovery: boolean;
  danger: boolean;
  combat: boolean;
  boss: boolean;
}

const MUSIC_STATE_RULES = [
  { situation: "boss", active: (state: DynamicMusicState) => state.boss },
  { situation: "combat", active: (state: DynamicMusicState) => state.combat },
  { situation: "danger", active: (state: DynamicMusicState) => state.danger },
  { situation: "discovery", active: (state: DynamicMusicState) => state.discovery },
  { situation: "night", active: (state: DynamicMusicState) => state.nightWeight >= 0.58 },
  { situation: "exploration", active: () => true },
] as const satisfies readonly {
  situation: MusicSituation;
  active(state: DynamicMusicState): boolean;
}[];

export function selectMusicSituation(state: DynamicMusicState): MusicSituation {
  return MUSIC_STATE_RULES.find((rule) => rule.active(state))?.situation ?? "exploration";
}

export function musicTracksForProfile(profileId: MusicProfileId | null) {
  const selected = musicProfile(profileId);
  if (!selected) return [];
  const generated = MUSIC_TRACKS.filter(
    (track) => "profile" in track && track.profile === profileId,
  );
  if (generated.length > 0) return generated;
  return selected.fallbackTrackIds.flatMap((id) => {
    const track = MUSIC_TRACKS.find((candidate) => candidate.id === id);
    return track ? [track] : [];
  });
}

export function musicTracksForSituation(audio: AdventureAudioConfig, situation: MusicSituation) {
  const profileId = audio[SITUATION_PROFILE_FIELDS[situation]];
  if (profileId !== null) {
    const tracks = musicTracksForProfile(profileId);
    if (tracks.length > 0) return tracks;
  }
  const legacyId =
    situation === "exploration" || situation === "night" || situation === "discovery"
      ? audio.music
      : audio.combatMusic;
  const track = musicTrack(legacyId);
  return track ? [track] : [];
}

export function musicTransitionMs(audio: AdventureAudioConfig, situation: MusicSituation): number {
  return musicProfile(audio[SITUATION_PROFILE_FIELDS[situation]])?.transitionMs ?? 650;
}
