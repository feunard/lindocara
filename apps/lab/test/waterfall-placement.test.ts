import { describe, expect, it } from "vitest";
import { WATERFALLS, WORLD, ZONES } from "../src/settings.js";
import { generateIsland } from "../src/world/island.js";

const toCell = (w: number) => Math.floor(w + WORLD.size / 2);

describe("the authored waterfall drops sit on real terrace walls", () => {
  const { field } = generateIsland({ size: WORLD.size, seed: WORLD.seed });

  it("spans exactly one level each — the only wall height this island has", () => {
    for (const w of WATERFALLS) expect(w.topLevel - w.bottomLevel).toBe(1);
  });

  // The test that matters. A drop's x is a CELL BOUNDARY, not a relief-disc radius: the discs are
  // centred at MOUNTAIN with radii 4.2/3.2/2.2/1.2, but `makeHeightmap` tests cell CENTRES against
  // them, so the wall lands on the integer boundary between two cells. Deriving the placements from
  // the radii instead buried every sheet 0.16 units inside the rock — invisible on screen, with
  // every unit test still green, because nothing was asking the terrain where its walls actually
  // are. This does.
  it("has the terrace above behind the lip and the terrace below in front of the base", () => {
    for (const w of WATERFALLS) {
      expect(field.levelAt(toCell(w.x - 0.5), toCell(w.z))).toBe(w.topLevel);
      expect(field.levelAt(toCell(w.x + 0.5), toCell(w.z))).toBe(w.bottomLevel);
    }
  });

  it("chains: each drop lands on the terrace the next one falls from", () => {
    for (let k = 1; k < WATERFALLS.length; k++) {
      const above = WATERFALLS[k - 1];
      const below = WATERFALLS[k];
      expect(above).toBeDefined();
      expect(below).toBeDefined();
      expect(below?.topLevel).toBe(above?.bottomLevel);
    }
  });

  // The whole width of every sheet must hang on wall, not overhang into open air at its ends.
  it("is backed by the higher terrace across its whole width", () => {
    for (const w of WATERFALLS) {
      for (const dz of [-w.width / 2 + 0.1, 0, w.width / 2 - 0.1]) {
        expect(field.levelAt(toCell(w.x - 0.5), toCell(w.z + dz))).toBe(w.topLevel);
      }
    }
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
