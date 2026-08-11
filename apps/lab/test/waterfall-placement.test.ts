import { describe, expect, it } from "vitest";
import { WATERFALLS, WORLD, ZONES } from "../src/settings.js";
import { generateIsland } from "../src/world/island.js";

const toCell = (w: number) => Math.floor(w + WORLD.size / 2);

describe("the authored fall hangs on a real sheer face", () => {
  const { field } = generateIsland({ size: WORLD.size, seed: WORLD.seed });

  // The test that matters, and the one the first version of this chantier did not have. A fall's
  // x and z are CELL BOUNDARIES, not relief-disc radii: `makeHeightmap` tests cell CENTRES against
  // each disc, so the wall lands on the integer boundary between two cells. Deriving the placement
  // from the radii instead buried the sheet inside the rock — invisible on screen, with every unit
  // test still green, because nothing was asking the terrain where its walls actually are.
  it("has the summit behind the lip and the pool in front of the base", () => {
    for (const w of WATERFALLS) {
      // Behind the lip (north of a south-facing wall) the terrain stands at the top level...
      expect(field.levelAt(toCell(w.x), toCell(w.z - 0.5))).toBe(w.topLevel);
      // ...and in front of the base it is WATER: the plunge pool is cut into the terrain, not laid
      // on top of it, so the sea shows through and the bank gets its own foam. See `isPlungePool`.
      expect(field.levelAt(toCell(w.x), toCell(w.z + w.poolOffset))).toBeNull();
    }
  });

  // A waterfall has to be TALLER than it is wide or it reads as water spilling over a kerb, which
  // is exactly what three 0.9-unit tiers looked like. This pins the proportion, not the numbers.
  it("falls further than it is wide", () => {
    for (const w of WATERFALLS) {
      const drop = (w.topLevel - w.bottomLevel) * WORLD.levelHeight;
      expect(drop).toBeGreaterThan(w.width);
    }
  });

  it("is backed by the summit across its whole width, with no overhang at either end", () => {
    for (const w of WATERFALLS) {
      for (const dx of [-w.width / 2 + 0.1, 0, w.width / 2 - 0.1]) {
        expect(field.levelAt(toCell(w.x + dx), toCell(w.z - 0.5))).toBe(w.topLevel);
      }
    }
  });

  // The pool is a hole cut in the shelf, and it must be ENCLOSED: no pool cell may touch a water
  // cell that is not part of the pool, or the plunge pool drains into the ocean and stops being a
  // pool at all. At the first offset/radius it did exactly that, through a one-cell gap at its
  // southern lip — visible on the baked map, invisible on screen at a glance.
  //
  // Flood-filled from the pool's centre rather than tested at a radius: the pool's cells are
  // whatever the carve produced, and asking the terrain is the only way to be sure.
  it("is enclosed by its own bank and never touches the sea", () => {
    for (const w of WATERFALLS) {
      const start: [number, number] = [toCell(w.x), toCell(w.z + w.poolOffset)];
      expect(field.levelAt(start[0], start[1])).toBeNull();

      const inPool = (i: number, j: number): boolean => {
        const x = i + 0.5 - WORLD.size / 2;
        const z = j + 0.5 - WORLD.size / 2;
        return Math.hypot(x - w.x, z - (w.z + w.poolOffset)) < w.poolRadius;
      };

      const seen = new Set<number>();
      const queue: [number, number][] = [start];
      while (queue.length) {
        const cell = queue.pop();
        if (!cell) break;
        const [i, j] = cell;
        const k = j * WORLD.size + i;
        if (seen.has(k)) continue;
        seen.add(k);
        for (const [di, dj] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const ni = i + di;
          const nj = j + dj;
          const neighbour = field.levelAt(ni, nj);
          if (neighbour !== null) continue; // bank: exactly what we want to find
          // Water next to the pool that is NOT the pool is the sea leaking in.
          expect(inPool(ni, nj)).toBe(true);
          queue.push([ni, nj]);
        }
      }
      expect(seen.size).toBeGreaterThan(0);
    }
  });

  // South, because this camera cannot see any other face: the rig sits due south of its target at
  // yaw 0, so a south-facing wall is seen 38° off normal and an east-facing one EXACTLY edge-on.
  // The first version put three sheets on the east face and they rendered as vertical slivers.
  it("faces south, the only face this camera sees full-on", () => {
    for (const w of WATERFALLS) expect(w.facing).toBe("south");
  });
});

describe("the roar is a held sound, not a zone soundscape", () => {
  // `cascade` borrows the loop infrastructure the way `glisse` does — created once, silent by
  // default, driven frame by frame by its own setter. If a zone ever named it as its `nappe`,
  // `setAmbience` would raise it to full level regardless of distance and the fall would roar
  // across the whole island.
  it("no zone names the roar as its soundscape", () => {
    for (const zone of ZONES) expect(zone.nappe).not.toBe("cascade");
  });
});
