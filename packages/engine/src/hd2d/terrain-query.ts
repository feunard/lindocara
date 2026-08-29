// The terrain queries the hero consumes: this is COLLISION, not rendering. This is why they moved
// into `@lindocara/engine` in S2, authoritative and shared with prediction — kept pure and free of
// any `three` dependency so that on that day movement changed nothing but its address.

import {
  type ColliderRect,
  colliderContainsPoint,
  colliderOverlapsDisc,
  colliderSurfaceHeightAt,
  colliderSurfaceHeightNear,
} from "./collider-index.js";

/** The four ground materials — two warm (the tropical island), two cold (the northern island). An
 *  exported union rather than `string`: `engine` is the future server authority for this, and a
 *  stringly-typed material would be a liability from the first silent typo — the compiler must be
 *  able to reject `"herb"` outright.
 *
 *  There WAS a fifth, `"glace-fine"` (thin ice), which cracked and gave way underfoot. The
 *  mechanic is gone; ice is just ice. Stored maps painted with it are still accepted and read as
 *  `"glace"` — see `decodeMap` — so no authored map had to be migrated, and none became
 *  unjoinable. */
export type TerrainMaterial =
  | "sable"
  | "herbe"
  | "neige"
  | "glace"
  | "grotte"
  | "montagne"
  | "volcan"
  | "lave";

export type TerrainLiquid = "water" | "lava";

/** Which way a ramp CLIMBS: `east`/`west` slope along x, `north`/`south` along z. All four exist
 *  because a cliff runs in any direction and an author should not have to rebuild the hill to get
 *  a way up it. */
export type RampDirection = "east" | "west" | "north" | "south";

/**
 * The four, as data. `decodeMap` has to test a direction it read out of a stored string against
 * them, and a union alone cannot be tested at runtime: the parser spelled out `"east"`/`"west"`
 * instead and kept refusing every north/south ramp long after the type had grown to four, so a map
 * with a staircase up a north-facing bank saved fine and then would not decode.
 */
export const RAMP_DIRECTIONS: readonly RampDirection[] = ["east", "west", "north", "south"];

/** Whether an arbitrary value is one of the four directions a stored ramp may climb. */
export function isRampDirection(value: unknown): value is RampDirection {
  return typeof value === "string" && (RAMP_DIRECTIONS as readonly string[]).includes(value);
}

/** Whether a ramp's slope runs along the x axis (`east`/`west`) or the z axis. The one place that
 *  question is answered; every reader of a ramp's geometry asks it rather than testing a direction
 *  against a hardcoded axis. */
export function rampAlongX(direction: RampDirection): boolean {
  return direction === "east" || direction === "west";
}

/** An authored staircase. Its rectangle covers the low bank; `direction` names the edge that meets
 * the immediately higher plateau. Collision samples it as a continuous slope, and so does the
 * renderer: `meshStairs` builds the same slope this describes, off the same `progress` convention,
 * so what is drawn and what is walked cannot disagree. */
export interface TerrainRamp {
  x: number;
  z: number;
  width: number;
  depth: number;
  direction: RampDirection;
  lowLevel: number;
  /** Absolute endpoints for multi-storey ramps. Legacy terrain stairs derive them from lowLevel. */
  lowHeight?: number;
  highHeight?: number;
}

export interface TerrainRampSample extends TerrainRamp {
  height: number;
  progress: number;
  lowHeight: number;
  highHeight: number;
}

export type TerrainPlatform = ColliderRect;

export interface TerrainQuery {
  /** World height of the ground under a point, or `null` if it is water / off the map. */
  heightAt(wx: number, wz: number): number | null;
  /** Highest ground or authored platform not above the moving body's current ceiling. */
  surfaceAt?(wx: number, wz: number, ceilingY: number): number | null;
  /** Highest finite platform touched by a body's footprint and not above its current ceiling. */
  platformSurfaceAround?(wx: number, wz: number, radius: number, ceilingY: number): number | null;
  /**
   * Highest ground height under a DISC. Testing a single point would let the character's body
   * sink into cliffs by its half-width — it is a volume that moves, not a point. Water counts as
   * its own level: it is a surface you swim on, not a wall. Off-map is not a wall either — you
   * swim out to open water, it is your breath that brings you back. Never `-Infinity`, including
   * for `r = 0` (a disc degenerated to a point is still a point to test).
   */
  maxHeightAround(wx: number, wz: number, r: number, ceilingY?: number): number;
  /** Level tier (0, 1, 2, ...) under a point, or `null` if it is water / off the map. */
  levelAt(wx: number, wz: number): number | null;
  /** Ground material under a point, or `null` if it is water / off the map. */
  kindAt(wx: number, wz: number): TerrainMaterial | null;
  /** Liquid occupying the cell: open water (including off-map sea), lava, or dry terrain. */
  liquidAt(wx: number, wz: number): TerrainLiquid | null;
  /** Stair slope under a point, if any. */
  rampAt(wx: number, wz: number): TerrainRampSample | null;
  /** Whether one grounded movement segment follows a stair corridor or crosses one endpoint. */
  canTraverseRamp(fromX: number, fromZ: number, toX: number, toZ: number, radius: number): boolean;
  /**
   * Destination height while both ends of a grounded segment remain on the same authored roof.
   * `null` prevents a wall approach from being mistaken for permission to climb the building.
   */
  platformHeightAlong?(
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
    radius: number,
    groundY: number,
  ): number | null;
  /** World center of a cell. */
  cellCenter(i: number, j: number): [number, number];
  /**
   * World height of the water surface at a point.
   *
   * Almost always the world's own sea. The exception is water at ELEVATION — a spring on a summit,
   * a pool part-way up a cliff — which the movement rule has to be able to find, or the hero would
   * swim at sea level inside a mountain. A map with no elevated water answers the same constant
   * everywhere and behaves exactly as it did before this existed.
   */
  waterLevelAt(wx: number, wz: number): number;
}

/** What `createTerrainQuery` needs: the same CELL-indexed accessors as `HeightField` (see
 *  `island.ts`), plus the two scale constants `HeightField` is missing — it stays in raw level
 *  tiers, these queries answer in world units. */
export interface TerrainQuerySource {
  /** Grid side, in cells. */
  size: number;
  /** Height of one level tier, in world units. */
  levelHeight: number;
  /** World height of the water plane. */
  waterLevel: number;
  /** Level tier of cell (i, j), or `null` off-grid / water. */
  at(i: number, j: number): number | null;
  /** Material of cell (i, j), or `null` off-grid / water. */
  kindAt(i: number, j: number): TerrainMaterial | null;
  /** Explicit liquid kind. Optional so legacy maps still infer sea from absent ground and lava
   * from its retired ground-material encoding. */
  liquidAt?(i: number, j: number): TerrainLiquid | null;
  /** Authored liquid surface tier, or `null` for the world's global sea / dry terrain. */
  liquidLevelAt?(i: number, j: number): number | null;
  /** For a WATER cell, the LEVEL tier its surface sits at — or `null`/absent for the world's sea.
   *  See `TerrainQuery.waterLevelAt`. */
  waterAt?(i: number, j: number): number | null;
  ramps?: readonly TerrainRamp[];
  platforms?: readonly TerrainPlatform[];
}

function rampSampleAt(
  ramps: readonly TerrainRamp[],
  levelHeight: number,
  wx: number,
  wz: number,
): TerrainRampSample | null {
  const epsilon = 1e-6;
  for (const ramp of ramps) {
    if (
      wx < ramp.x - epsilon ||
      wx > ramp.x + ramp.width + epsilon ||
      wz < ramp.z - epsilon ||
      wz > ramp.z + ramp.depth + epsilon
    ) {
      continue;
    }
    // The slope runs along ONE axis and is flat across the other, so which coordinate to read is
    // the direction's own question. `east`/`south` climb toward the axis's positive end; `west`
    // and `north` are the same ramp walked the other way.
    const alongX = rampAlongX(ramp.direction);
    const along = alongX
      ? THREELESS_CLAMP((wx - ramp.x) / ramp.width)
      : THREELESS_CLAMP((wz - ramp.z) / ramp.depth);
    const progress = ramp.direction === "east" || ramp.direction === "south" ? along : 1 - along;
    const lowHeight = ramp.lowHeight ?? ramp.lowLevel * levelHeight;
    const highHeight = ramp.highHeight ?? (ramp.lowLevel + 1) * levelHeight;
    return {
      ...ramp,
      progress,
      lowHeight,
      highHeight,
      height: lowHeight + progress * (highHeight - lowHeight),
    };
  }
  return null;
}

const THREELESS_CLAMP = (value: number): number => Math.max(0, Math.min(1, value));

/**
 * Port of the query methods from the PoC's `terrain.js` (`heightAt`, `maxHeightAround`,
 * `levelAt`, `kindAt`, `cellCenter`), detached from heightmap construction: `island.ts` supplies
 * the cell-indexed accessors, this function only converts them into WORLD-coordinate queries.
 */
export function createTerrainQuery(source: TerrainQuerySource): TerrainQuery {
  const {
    size,
    levelHeight,
    waterLevel,
    at,
    kindAt,
    liquidAt: sourceLiquidAt,
    liquidLevelAt,
    waterAt,
    ramps = [],
    platforms = [],
  } = source;
  const c = size / 2;
  const toCell = (w: number) => Math.floor(w + c);
  const groundHeightAt = (wx: number, wz: number): number | null => {
    const ramp = rampSampleAt(ramps, levelHeight, wx, wz);
    if (ramp) return ramp.height;
    const h = at(toCell(wx), toCell(wz));
    return h === null ? null : h * levelHeight;
  };
  const cellLiquidAt = (i: number, j: number): TerrainLiquid | null => {
    const explicit = sourceLiquidAt?.(i, j);
    if (explicit) return explicit;
    // Backward compatibility for heightfields produced before liquids had their own grid.
    if (kindAt(i, j) === "lave") return "lava";
    return at(i, j) === null ? "water" : null;
  };
  const liquidAt = (wx: number, wz: number): TerrainLiquid | null => {
    const i = toCell(wx);
    const j = toCell(wz);
    return cellLiquidAt(i, j);
  };
  const platformAt = (wx: number, wz: number, ceilingY: number): number | null => {
    let top: number | null = null;
    for (const platform of platforms) {
      const height = colliderSurfaceHeightAt(platform, wx, wz);
      if (height === null || height > ceilingY + 1e-3) continue;
      top = top === null ? height : Math.max(top, height);
    }
    return top;
  };

  return {
    heightAt(wx, wz) {
      return groundHeightAt(wx, wz);
    },
    surfaceAt(wx, wz, ceilingY) {
      const ground = groundHeightAt(wx, wz);
      const platform = platformAt(wx, wz, ceilingY);
      const reachableGround = ground !== null && ground <= ceilingY + 1e-3 ? ground : null;
      if (platform === null) return reachableGround;
      return reachableGround === null ? platform : Math.max(reachableGround, platform);
    },
    platformSurfaceAround(wx, wz, radius, ceilingY) {
      let surface: number | null = null;
      for (const platform of platforms) {
        if (!colliderOverlapsDisc(platform, wx, wz, radius)) continue;
        if (platform.support === "center" && !colliderContainsPoint(platform, wx, wz)) continue;
        const height = colliderSurfaceHeightNear(platform, wx, wz);
        if (height === null || height > ceilingY + 1e-3) continue;
        surface = surface === null ? height : Math.max(surface, height);
      }
      return surface;
    },
    maxHeightAround(wx, wz, r, ceilingY) {
      let max = Number.NEGATIVE_INFINITY;
      const centreGround = ceilingY === undefined ? null : groundHeightAt(wx, wz);
      const beneathSurface =
        ceilingY !== undefined &&
        platformAt(wx, wz, ceilingY) !== null &&
        centreGround !== null &&
        centreGround > ceilingY + 1e-3;
      for (let j = toCell(wz - r); j <= toCell(wz + r); j++) {
        for (let i = toCell(wx - r); i <= toCell(wx + r); i++) {
          // Point of the cell closest to the center: a cell only grazed by the corner of the
          // bounding box doesn't count.
          const nx = Math.min(Math.max(wx, i - c), i + 1 - c);
          const nz = Math.min(Math.max(wz, j - c), j + 1 - c);
          // Strictly FARTHER than `r` is excluded — not "at `r` or more": with `r = 0`, the
          // queried point is itself at distance 0 from the cell that contains it (`nx === wx`,
          // `nz === wz`), so `>= r*r` (0 >= 0) wrongly excluded it and the loop would never find a
          // cell again, returning `-Infinity` — breaking the JSDoc promise above the moment
          // `r = 0`, latent for as long as only `HERO.radius = 0.3` ever called this function.
          if ((nx - wx) ** 2 + (nz - wz) ** 2 > r * r) continue;
          const h = at(i, j);
          const liquidLevel = liquidLevelAt?.(i, j);
          const candidate =
            h === null
              ? liquidLevel === null || liquidLevel === undefined
                ? waterLevel
                : liquidLevel * levelHeight
              : h * levelHeight;
          if (!beneathSurface || candidate <= (ceilingY ?? Number.POSITIVE_INFINITY) + 1e-3)
            max = Math.max(max, candidate);
        }
      }
      if (ceilingY !== undefined) {
        for (const platform of platforms) {
          if (!colliderOverlapsDisc(platform, wx, wz, r)) continue;
          const height = colliderSurfaceHeightNear(platform, wx, wz);
          if (height !== null && height <= ceilingY + 1e-3) max = Math.max(max, height);
        }
      }
      return max;
    },
    levelAt(wx, wz) {
      return at(toCell(wx), toCell(wz));
    },
    kindAt(wx, wz) {
      return kindAt(toCell(wx), toCell(wz));
    },
    liquidAt,
    rampAt(wx, wz) {
      return rampSampleAt(ramps, levelHeight, wx, wz);
    },
    canTraverseRamp(fromX, fromZ, toX, toZ, radius) {
      const from = rampSampleAt(ramps, levelHeight, fromX, fromZ);
      const to = rampSampleAt(ramps, levelHeight, toX, toZ);
      const ramp = to ?? from;
      if (!ramp) return false;
      // The body must stay within the ramp's WIDTH, which is the axis the slope does not run along.
      // Reading z for an east/west ramp and x for a north/south one is the same rule, asked of the
      // right axis rather than of a hardcoded one.
      const alongX = rampAlongX(ramp.direction);
      const acrossFrom = alongX ? fromZ : fromX;
      const acrossTo = alongX ? toZ : toX;
      const acrossOrigin = alongX ? ramp.z : ramp.x;
      const acrossSpan = alongX ? ramp.depth : ramp.width;
      const corridorMin = acrossOrigin + radius;
      const corridorMax = acrossOrigin + acrossSpan - radius;
      if (
        acrossFrom < corridorMin ||
        acrossFrom > corridorMax ||
        acrossTo < corridorMin ||
        acrossTo > corridorMax
      ) {
        return false;
      }
      const near = Math.max(0.08, radius);
      if (from && to && from.x === to.x && from.z === to.z) return true;
      if (from && to) {
        const touchesAlong = alongX
          ? Math.abs(from.x + from.width - to.x) <= near ||
            Math.abs(to.x + to.width - from.x) <= near
          : Math.abs(from.z + from.depth - to.z) <= near ||
            Math.abs(to.z + to.depth - from.z) <= near;
        const joinsHeight =
          Math.abs(from.highHeight - to.lowHeight) <= 1e-3 ||
          Math.abs(to.highHeight - from.lowHeight) <= 1e-3;
        return from.direction === to.direction && touchesAlong && joinsHeight;
      }
      const alongOrigin = alongX ? ramp.x : ramp.z;
      const alongSpan = alongX ? ramp.width : ramp.depth;
      const climbsPositive = ramp.direction === "east" || ramp.direction === "south";
      const lowEdge = climbsPositive ? alongOrigin : alongOrigin + alongSpan;
      const highEdge = climbsPositive ? alongOrigin + alongSpan : alongOrigin;
      const alongFrom = alongX ? fromX : fromZ;
      const alongTo = alongX ? toX : toZ;
      if (to && !from) {
        return Math.abs(alongFrom - lowEdge) <= near || Math.abs(alongFrom - highEdge) <= near;
      }
      if (from && !to) {
        return Math.abs(alongTo - lowEdge) <= near || Math.abs(alongTo - highEdge) <= near;
      }
      return false;
    },
    platformHeightAlong(fromX, fromZ, toX, toZ, _radius, groundY) {
      let destination: number | null = null;
      for (const platform of platforms) {
        // The footprint centre must remain on one roof. Requiring the complete body disc to fit
        // made the last quarter-tile of every eave unusable and froze the hero after a legitimate
        // edge landing. Merely leaning against a wall still grants nothing: the source centre is
        // outside, or its local roof height does not match `groundY`.
        if (
          !colliderContainsPoint(platform, fromX, fromZ) ||
          !colliderContainsPoint(platform, toX, toZ)
        ) {
          continue;
        }
        const fromHeight = colliderSurfaceHeightAt(platform, fromX, fromZ);
        const toHeight = colliderSurfaceHeightAt(platform, toX, toZ);
        if (fromHeight === null || toHeight === null || Math.abs(fromHeight - groundY) > 0.08) {
          continue;
        }
        destination = destination === null ? toHeight : Math.max(destination, toHeight);
      }
      return destination;
    },
    cellCenter(i, j) {
      return [i + 0.5 - c, j + 0.5 - c];
    },
    waterLevelAt(wx, wz) {
      const i = toCell(wx);
      const j = toCell(wz);
      const liquidLevel = liquidLevelAt?.(i, j);
      if (liquidLevel !== null && liquidLevel !== undefined) return liquidLevel * levelHeight;
      if (cellLiquidAt(i, j) === "lava") {
        const legacyLevel = at(i, j);
        if (legacyLevel !== null) return legacyLevel * levelHeight;
      }
      const w = waterAt?.(i, j);
      return w === null || w === undefined ? waterLevel : w * levelHeight;
    },
  };
}
