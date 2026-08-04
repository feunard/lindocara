import { welcomeFixture } from "@lindocara/testing/map-fixtures.js";
import { describe, expect, it } from "vitest";
import { encodeMap, type MapData } from "../src/hd2d/map-data.js";
import { parseServerMessage } from "../src/protocol.js";

const map: MapData = {
  version: 1,
  size: 2,
  levelHeight: 0.5,
  waterLevel: 0,
  levels: [0, 0, 0, 0],
  materials: ["herbe", "herbe", "herbe", "herbe"],
  colliders: [],
  spawns: [],
  elements: [],
  events: [],
};

describe("WorldInfo.heightfield", () => {
  it("accepts a welcome carrying a valid encoded heightfield", () => {
    const message = welcomeFixture({ heightfield: encodeMap(map) });
    const parsed = parseServerMessage(JSON.stringify(message));
    expect(parsed?.t).toBe("welcome");
  });

  it("accepts an explicit null", () => {
    const parsed = parseServerMessage(JSON.stringify(welcomeFixture({ heightfield: null })));
    expect(parsed?.t).toBe("welcome");
  });

  it("drops a frame whose heightfield does not decode", () => {
    const message = welcomeFixture({ heightfield: '{"version":1,"size":-4}' });
    expect(parseServerMessage(JSON.stringify(message))).toBeNull();
  });

  it("drops a frame whose heightfield is not a string", () => {
    const message = welcomeFixture({ heightfield: 7 });
    expect(parseServerMessage(JSON.stringify(message))).toBeNull();
  });
});
