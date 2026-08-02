import { describe, expect, it } from "vitest";
import { createCloudCover } from "../src/clouds.js";
import { createHd2dContext } from "../src/context.js";

describe("createCloudCover", () => {
  it("fait dériver la couverture à la vitesse configurée", () => {
    const ctx = createHd2dContext({
      config: { cloudShadow: { scale: 0.011, drift: [0.002, 0.001], softness: 0.4 } },
    });
    const clouds = createCloudCover(ctx);
    clouds.update(2);
    expect(clouds.offset().x).toBeCloseTo(0.004);
    expect(clouds.offset().y).toBeCloseTo(0.002);
  });

  it("garde deux couvertures indépendantes", () => {
    const a = createCloudCover(createHd2dContext());
    const b = createCloudCover(createHd2dContext());
    a.update(5);
    expect(b.offset().x).toBe(0);
  });
});
