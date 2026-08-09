/** Tiny Swords sheep identities and the measurements authored by the HD-2D lab. */
export const SHEEP_ASSET_IDS = [
  "resource.terrain-resources-meat-sheep.sheep-idle",
  "resource.resources-sheep.happysheep-idle",
] as const;

export const SHEEP_RENDER_HEIGHT = 1.5;
export const SHEEP_SPEED = 0.85;
export const SHEEP_IDLE_SECONDS = [1.2, 4] as const;
export const SHEEP_WALK_SECONDS = [0.8, 2.2] as const;

const SHEEP_ASSET_ID_SET = new Set<string>(SHEEP_ASSET_IDS);

export function isSheepAssetId(value: unknown): value is (typeof SHEEP_ASSET_IDS)[number] {
  return typeof value === "string" && SHEEP_ASSET_ID_SET.has(value);
}
