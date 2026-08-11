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
  it("has the summit behind the lip and open ground in front of the base", () => {
    for (const w of WATERFALLS) {
      // Behind the lip (north of a south-facing wall) the terrain stands at the top level...
      expect(field.levelAt(toCell(w.x), toCell(w.z - 0.5))).toBe(w.topLevel);
      // ...and in front of the base it has dropped all the way to the bottom level.
      expect(field.levelAt(toCell(w.x), toCell(w.z + 0.5))).toBe(w.bottomLevel);
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

  // The pool sits on open ground in front of the cliff — the shelf the camera can see — and the
  // whole disc has to be on it, not half-buried in the rock or hanging over the shore.
  it("lands in a pool that sits entirely on the ground in front of the cliff", () => {
    for (const w of WATERFALLS) {
      expect(w.poolOffset).toBeGreaterThanOrEqual(w.poolRadius * 0.9);
      for (const dz of [-w.poolRadius, 0, w.poolRadius]) {
        for (const dx of [-w.poolRadius, 0, w.poolRadius]) {
          expect(field.levelAt(toCell(w.x + dx), toCell(w.z + w.poolOffset + dz))).toBe(
            w.bottomLevel,
          );
        }
      }
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
