import { playerPortrait } from "@lindocara/renderer/portrait-art.js";
import { describe, expect, it } from "vitest";

describe("Tiny Swords portrait selection", () => {
  it("uses the matching class and faction unit sheet for players", () => {
    expect(playerPortrait("priest", { body: "wayfarer", primaryColor: "violet" })).toMatchObject({
      frames: 6,
      source: expect.stringContaining("units/purple/monk/Idle.png"),
    });
    expect(playerPortrait("rogue", { body: "wayfarer", primaryColor: "violet" })).toMatchObject({
      frames: 6,
      source: expect.stringContaining("Thief_Idle"),
    });
    expect(playerPortrait("peasant", { body: "wayfarer", primaryColor: "ember" })).toMatchObject({
      frames: 8,
      source: expect.stringContaining("Pawn_Idle"),
    });
  });
});
