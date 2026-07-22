import { sameRenderedMap } from "@lindocara/renderer/map-render-cache.js";
import { describe, expect, it } from "vitest";

describe("renderer map cache identity", () => {
  it("reuses an unchanged map across reconnects", () => {
    expect(sameRenderedMap({ mapId: "map-a", revision: 7 }, { mapId: "map-a", revision: 7 })).toBe(
      true,
    );
  });

  it("forces a rebuild when the same map id has a new revision", () => {
    expect(sameRenderedMap({ mapId: "map-a", revision: 7 }, { mapId: "map-a", revision: 8 })).toBe(
      false,
    );
  });
});
