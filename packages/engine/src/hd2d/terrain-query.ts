// The terrain queries the hero consumes: this is COLLISION, not rendering. This is why they moved
// into `@lindocara/engine` in S2, authoritative and shared with prediction — kept pure and free of
// any `three` dependency so that on that day movement changed nothing but its address.

/** The lab's five ground materials — two warm (the tropical island), three cold (the northern
 *  island). An exported union rather than `string`: `engine` is the future server authority for
 *  this, and a stringly-typed material would be a liability from the first silent typo — the
 *  compiler must be able to reject `"herb"` outright. `"glace-fine"` (thin ice) is a RULE
 *  material (it gives way under weight): it shares the appearance of `"glace"` until Task 7 gives
 *  it its own cracked-ice visual — see `main.ts`, `atlases`. */
export type TerrainMaterial = "sable" | "herbe" | "neige" | "glace" | "glace-fine";

export interface TerrainQuery {
  /** World height of the ground under a point, or `null` if it is water / off the map. */
  heightAt(wx: number, wz: number): number | null;
  /**
   * Highest ground height under a DISC. Testing a single point would let the character's body
   * sink into cliffs by its half-width — it is a volume that moves, not a point. Water counts as
   * its own level: it is a surface you swim on, not a wall. Off-map is not a wall either — you
   * swim out to open water, it is your breath that brings you back. Never `-Infinity`, including
   * for `r = 0` (a disc degenerated to a point is still a point to test).
   */
  maxHeightAround(wx: number, wz: number, r: number): number;
  /** Level tier (0, 1, 2, ...) under a point, or `null` if it is water / off the map. */
  levelAt(wx: number, wz: number): number | null;
  /** Ground material under a point, or `null` if it is water / off the map. */
  kindAt(wx: number, wz: number): TerrainMaterial | null;
  /** World center of a cell. */
  cellCenter(i: number, j: number): [number, number];
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
}

/**
 * Port of the query methods from the PoC's `terrain.js` (`heightAt`, `maxHeightAround`,
 * `levelAt`, `kindAt`, `cellCenter`), detached from heightmap construction: `island.ts` supplies
 * the cell-indexed accessors, this function only converts them into WORLD-coordinate queries.
 */
export function createTerrainQuery(source: TerrainQuerySource): TerrainQuery {
  const { size, levelHeight, waterLevel, at, kindAt } = source;
  const c = size / 2;
  const toCell = (w: number) => Math.floor(w + c);

  return {
    heightAt(wx, wz) {
      const h = at(toCell(wx), toCell(wz));
      return h === null ? null : h * levelHeight;
    },
    maxHeightAround(wx, wz, r) {
      let max = Number.NEGATIVE_INFINITY;
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
          max = Math.max(max, h === null ? waterLevel : h * levelHeight);
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
    cellCenter(i, j) {
      return [i + 0.5 - c, j + 0.5 - c];
    },
  };
}
