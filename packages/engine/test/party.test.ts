import {
  isPartyColor,
  PARTY_COLORS,
  parseCreatePartyInput,
  parseJoinPartyInput,
} from "@lindocara/engine/party.js";
import { describe, expect, it } from "vitest";

describe("party colours", () => {
  it("are exactly the four hero colours, never black", () => {
    expect([...PARTY_COLORS]).toEqual(["blue", "red", "yellow", "purple"]);
    expect(isPartyColor("blue")).toBe(true);
    expect(isPartyColor("purple")).toBe(true);
    expect(isPartyColor("black")).toBe(false);
    expect(isPartyColor(2)).toBe(false);
    expect(isPartyColor(null)).toBe(false);
  });
});

describe("parseCreatePartyInput", () => {
  it("accepts an adventure id with optional name and colour, defaulting both", () => {
    expect(parseCreatePartyInput({ adventureId: "adv-1" })).toEqual({
      adventureId: "adv-1",
      name: null,
      color: "blue",
    });
    expect(parseCreatePartyInput({ adventureId: "adv-1", name: "Donjon", color: "red" })).toEqual({
      adventureId: "adv-1",
      name: "Donjon",
      color: "red",
    });
    expect(parseCreatePartyInput({ adventureId: "adv-1", name: "   " })).toEqual({
      adventureId: "adv-1",
      name: null,
      color: "blue",
    });
  });

  it("rejects malformed bodies", () => {
    const bad: unknown[] = [
      null,
      "adv",
      {},
      { adventureId: 7 },
      { adventureId: "bad id!" },
      { adventureId: "adv-1", color: "black" },
      { adventureId: "adv-1", name: "x".repeat(49) },
    ];
    for (const value of bad) expect(parseCreatePartyInput(value)).toBeNull();
  });
});

describe("parseJoinPartyInput", () => {
  it("accepts a valid colour and rejects everything else", () => {
    expect(parseJoinPartyInput({ color: "yellow" })).toEqual({ color: "yellow" });
    for (const value of [null, {}, { color: "black" }, { color: 1 }]) {
      expect(parseJoinPartyInput(value)).toBeNull();
    }
  });
});
