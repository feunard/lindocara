import { describe, expect, it } from "vitest";
import { monsterPortrait, playerPortrait } from "../../src/client/game/portrait-art.js";

describe("Tiny Swords portrait selection", () => {
  it("uses the matching class and faction unit sheet for players", () => {
    expect(playerPortrait("priest", { body: "wayfarer", primaryColor: "violet" })).toMatchObject({
      kind: "unit",
      frames: 6,
      source: expect.stringContaining("units/purple/monk/Idle.png"),
    });
  });

  it("uses dedicated enemy-pack avatars for every monster family", () => {
    expect(monsterPortrait("spear_goblin")).toMatchObject({
      kind: "enemy",
      frames: 1,
      source: expect.stringContaining("Spear%20Goblin.png"),
    });
    expect(monsterPortrait("gnoll_marauder").source).toContain("Enemy%20Avatars_10.png");
    expect(monsterPortrait("skull_guard").source).toContain("Enemy%20Avatars_01.png");
    expect(monsterPortrait("minotaur_brute").source).toContain("Enemy%20Avatars_09.png");
    expect(monsterPortrait("mire_troll").source).toContain("Enemy%20Avatars_16.png");
  });
});
