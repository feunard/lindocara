import { describe, expect, it } from "vitest";
import { INTERACTION_RANGE, pointDistance } from "../src/shared/game.js";
import {
  buildRoomKey,
  DEFAULT_INSTANCE_ID,
  DEFAULT_ZONE_ID,
  isValidInstanceId,
  parseRoomKey,
  resolveZoneLocation,
  ZONES,
  type ZoneId,
  zoneDefinition,
} from "../src/shared/zones.js";

describe("zone catalogue", () => {
  it("keeps migrated characters in the deterministic Verdant Reach main room", () => {
    const location = resolveZoneLocation(DEFAULT_ZONE_ID, DEFAULT_INSTANCE_ID);
    expect(location).toMatchObject({
      zoneId: "verdant-reach",
      instanceId: "main",
      roomKey: "verdant-reach:main",
      definition: ZONES["verdant-reach"],
    });
  });

  it("builds and parses unambiguous room keys", () => {
    expect(buildRoomKey("verdant-reach", "raid-1")).toBe("verdant-reach:raid-1");
    expect(parseRoomKey("mmo-test-zone:main")).toMatchObject({
      zoneId: "mmo-test-zone",
      instanceId: "main",
    });
    expect(parseRoomKey("verdant-reach:main:extra")).toBeNull();
  });

  it.each([
    "",
    "Main",
    "main:two",
    "main/two",
    "main_two",
    "-main",
    "main-",
    "a".repeat(33),
  ])("rejects an invalid instance id %j", (instanceId) => {
    expect(isValidInstanceId(instanceId)).toBe(false);
  });

  it("rejects unknown zones instead of silently routing them to Verdant Reach", () => {
    expect(resolveZoneLocation("unknown-zone", "main")).toBeNull();
  });

  // A cached browser bundle can be older than the server: `parseServerMessage` now rejects an
  // unrecognised zoneId at the wire boundary, but `zoneDefinition` is the last line of defence
  // for any caller that reaches it with one anyway — it must degrade, not throw downstream when
  // something reads `.terrain` off `undefined`.
  it("falls back to the default zone for an id it does not recognise, instead of crashing downstream", () => {
    expect(zoneDefinition("nonexistent-zone" as ZoneId)).toBe(ZONES[DEFAULT_ZONE_ID]);
  });
});

describe("the Sunken Isles", () => {
  it("resolves as a room of its own", () => {
    const location = resolveZoneLocation("sunken-isles", "main");
    expect(location?.roomKey).toBe("sunken-isles:main");
    expect(location?.definition.maxPlayers).toBe(16);
  });

  it("carries no gameplay content — it is scenery", () => {
    const zone = ZONES["sunken-isles"];
    expect(zone.monsters).toEqual([]);
    expect(zone.quests).toEqual([]);
    expect(zone.guards).toEqual([]);
  });

  it("pairs its gate with a return that does not land you back inside the gate", () => {
    const gate = ZONES["verdant-reach"].portals.find((p) => p.id === "sunken-isles-gate");
    const back = ZONES["sunken-isles"].portals.find((p) => p.id === "sunken-isles-return");
    expect(gate).toBeDefined();
    expect(back).toBeDefined();
    if (!gate || !back) return;
    expect(gate.destination.zoneId).toBe("sunken-isles");
    expect(back.destination.zoneId).toBe("verdant-reach");
    // Arriving within INTERACTION_RANGE of the gate you just came out of makes the two a revolving
    // door: `#interact` takes the first portal in range, so you would bounce straight back.
    expect(pointDistance(back.destination.spawn, gate)).toBeGreaterThan(INTERACTION_RANGE);
    expect(pointDistance(gate.destination.spawn, back)).toBeGreaterThan(INTERACTION_RANGE);
  });
});
