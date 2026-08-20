import { parseServerMessage } from "@lindocara/engine/protocol.js";
import { describe, expect, it } from "vitest";

const building = {
  id: "building-1",
  x: 2.5,
  z: -1,
  graphicAssetId: "building.factions-knights-buildings-house.house-blue",
  destroyedAssetId: "building.factions-knights-buildings-house.house-destroyed",
  orientation: 2,
  hp: 900,
  maxHp: 900,
  destructible: true,
  destroyed: false,
  interactive: true,
  collider: { x: 1.5, z: -2, w: 2, h: 2 },
};

describe("building state on the wire", () => {
  it("accepts an exact authoritative building update", () => {
    expect(parseServerMessage(JSON.stringify({ t: "building.state", building }))).toEqual({
      t: "building.state",
      building,
    });
  });

  it("carries an author-resized footprint and rejects off-grid dimensions", () => {
    const resized = { ...building, dimensions: { width: 5, depth: 3.125 } };
    expect(parseServerMessage(JSON.stringify({ t: "building.state", building: resized }))).toEqual({
      t: "building.state",
      building: resized,
    });
    expect(
      parseServerMessage(
        JSON.stringify({
          t: "building.state",
          building: { ...building, dimensions: { width: 5.1, depth: 3 } },
        }),
      ),
    ).toBeNull();
  });

  it("rejects incoherent health, unknown art and extra outcome fields", () => {
    expect(
      parseServerMessage(
        JSON.stringify({
          t: "building.state",
          building: { ...building, hp: 0, destroyed: false },
        }),
      ),
    ).toBeNull();
    expect(
      parseServerMessage(
        JSON.stringify({ t: "building.state", building: { ...building, orientation: 9 } }),
      ),
    ).toBeNull();
    expect(
      parseServerMessage(
        JSON.stringify({
          t: "building.state",
          building: { ...building, graphicAssetId: "invented-building" },
        }),
      ),
    ).toBeNull();
    expect(
      parseServerMessage(
        JSON.stringify({ t: "building.state", building: { ...building, damage: 999 } }),
      ),
    ).toBeNull();
  });
});
