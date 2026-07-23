import {
  ADVENTURE_TEST_SESSION_TTL_MS,
  parseCreateAdventureTestSessionInput,
} from "@lindocara/engine/adventure-test.js";
import { describe, expect, it } from "vitest";

describe("adventure playtest input", () => {
  it("accepts the global start or an authored map with a real hero class", () => {
    expect(
      parseCreateAdventureTestSessionInput({ startMapId: null, heroClass: "warrior" }),
    ).toEqual({ startMapId: null, heroClass: "warrior" });
    expect(
      parseCreateAdventureTestSessionInput({
        startMapId: "a68d10ea-621d-45eb-a6d4-739221f23111",
        heroClass: "priest",
      }),
    ).toEqual({
      startMapId: "a68d10ea-621d-45eb-a6d4-739221f23111",
      heroClass: "priest",
    });
    expect(ADVENTURE_TEST_SESSION_TTL_MS).toBeGreaterThan(60_000);
  });

  it.each([
    null,
    {},
    { startMapId: undefined, heroClass: "warrior" },
    { startMapId: "technical-id", heroClass: "warrior" },
    { startMapId: null, heroClass: "mage" },
  ])("rejects malformed input %#", (value) => {
    expect(parseCreateAdventureTestSessionInput(value)).toBeNull();
  });
});
