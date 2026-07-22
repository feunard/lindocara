import { playerPortrait } from "@lindocara/renderer/portrait-art.js";
import { describe, expect, it } from "vitest";

describe("Tiny Swords portrait selection", () => {
  it("uses the matching class and faction unit sheet for players", () => {
    expect(playerPortrait("priest", { body: "wayfarer", primaryColor: "violet" })).toMatchObject({
      frames: 6,
      source: expect.stringContaining("units/purple/monk/Idle.png"),
    });
  });
});
