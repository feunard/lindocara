import { describe, expect, it } from "vitest";
import { nextMapName } from "../src/shared/map-naming.js";

describe("nextMapName", () => {
  it("names the first map Map1 and counts up as maps are created", () => {
    expect(nextMapName([])).toBe("Map1");
    expect(nextMapName(["Map1"])).toBe("Map2");
    expect(nextMapName(["Map1", "Map2"])).toBe("Map3");
  });

  it("skips numbers already taken, returning the lowest free MapN", () => {
    // A gap is filled: Map1 and Map3 exist, so Map2 is the lowest free slot.
    expect(nextMapName(["Map1", "Map3"])).toBe("Map2");
    // The author renamed a map to "Map2" by hand: the next default skips it.
    expect(nextMapName(["Map1", "Map2", "Verdant Reach"])).toBe("Map3");
  });

  it("ignores names that are not of the MapN shape", () => {
    expect(nextMapName(["Verdant Reach", "Frostfen"])).toBe("Map1");
  });
});
