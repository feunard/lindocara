/** Spatial index cell edge. Close to the entity radii while keeping queries to few cells. */
export const SPATIAL_CELL_SIZE = 256;

export const PLAYER_VISIBILITY_RADIUS = 900;
export const MONSTER_VISIBILITY_RADIUS = 850;
export const LOOT_VISIBILITY_RADIUS = 650;
export const GUARD_VISIBILITY_RADIUS = 900;
export const CORPSE_VISIBILITY_RADIUS = 900;

/** Existing entities remain visible this far beyond their enter radius to prevent edge flicker. */
export const INTEREST_HYSTERESIS = 96;

export const SPATIAL_EVENT_RADIUS = 850;
export const LOCAL_CHAT_RADIUS = 700;

export const CHAT_CHANNELS = ["local", "party", "guild", "global", "whisper"] as const;
export type ChatChannel = (typeof CHAT_CHANNELS)[number];
