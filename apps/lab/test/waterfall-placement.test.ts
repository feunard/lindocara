import { describe, expect, it } from "vitest";
import { WATERFALLS, WEST, WORLD, ZONES } from "../src/settings.js";
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

  // The channel is water, exactly as wide as the fall, and it RUNS TO THE SEA — water that falls
  // has to go somewhere. An earlier version made it a small enclosed disc with a bank all the way
  // round, which is a pond, not a plunge pool.
  it("lands in a channel of water as wide as itself", () => {
    for (const w of WATERFALLS) {
      for (const dx of [-w.width / 2 + 0.2, 0, w.width / 2 - 0.2]) {
        expect(field.levelAt(toCell(w.x + dx), toCell(w.z + w.poolOffset))).toBeNull();
      }
      // And rock immediately outside it, so the channel has banks rather than being open shore.
      expect(
        field.levelAt(toCell(w.x - w.width / 2 - 0.5), toCell(w.z + w.poolOffset)),
      ).not.toBeNull();
      expect(
        field.levelAt(toCell(w.x + w.width / 2 + 0.5), toCell(w.z + w.poolOffset)),
      ).not.toBeNull();
    }
  });

  // Reaching the sea is the point: the channel must be one connected body of water from the foot
  // of the fall out to open ocean, not a puddle that stops short.
  it("connects to the sea", () => {
    for (const w of WATERFALLS) {
      let z = w.z + 0.5;
      let steps = 0;
      while (field.levelAt(toCell(w.x), toCell(z)) === null && steps < 40) {
        z += 1;
        steps += 1;
      }
      // It walked south through water the whole way and left the island's cells entirely.
      expect(steps).toBeGreaterThan(2);
      expect(Math.hypot(w.x - WEST.x, z - WEST.z)).toBeGreaterThan(WEST.r * 0.6);
    }
  });

  // The face is FIVE cells of summit for a THREE-cell fall: one cell of rock flanking the water on
  // each side. A circle is tangent at its own edge, so an earlier shape that aligned the discs'
  // south edges gave a face exactly as wide as the water and no rock beside it at all.
  it("has rock flanking the fall on both sides of the face", () => {
    for (const w of WATERFALLS) {
      expect(field.levelAt(toCell(w.x - w.width / 2 - 0.5), toCell(w.z - 0.5))).toBe(w.topLevel);
      expect(field.levelAt(toCell(w.x + w.width / 2 + 0.5), toCell(w.z - 0.5))).toBe(w.topLevel);
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
