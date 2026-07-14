import { describe, expect, it } from "vitest";
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
