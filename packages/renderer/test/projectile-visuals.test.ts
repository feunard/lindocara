import { PROJECTILE_KINDS } from "@lindocara/engine/protocol.js";
import { describe, expect, it } from "vitest";
import { PROJECTILE_VISUALS, projectileVisual } from "../src/projectile-visuals.js";

describe("HD-2D projectile visuals", () => {
  it("defines a deliberate visual for every protocol projectile", () => {
    expect(Object.keys(PROJECTILE_VISUALS).sort()).toEqual([...PROJECTILE_KINDS].sort());
    for (const kind of PROJECTILE_KINDS) {
      const visual = projectileVisual(kind);
      expect(visual.scale).toBeGreaterThan(0);
      expect(visual.trailLength).toBeGreaterThanOrEqual(0);
    }
  });

  it("does not collapse every projectile family to one shape", () => {
    expect(new Set(PROJECTILE_KINDS.map((kind) => projectileVisual(kind).shape)).size).toBe(5);
  });
});
