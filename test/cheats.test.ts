import { describe, expect, it } from "vitest";
import type { PlayerProfile } from "../src/server/profile.js";
import { executeCheatCommand } from "../src/server/world/cheat-command-system.js";
import { isPlayerInvulnerable } from "../src/server/world/combat-system.js";
import { newPlayer } from "../src/server/world/world-runtime.js";
import { starterEquipmentFor } from "../src/shared/character.js";
import { CHEAT_COMMAND_SYNTAX, parseCheatCommand } from "../src/shared/cheats.js";
import { maxHpForLevel, PLAYER_CLASSES, type PlayerClass } from "../src/shared/game.js";

function profile(playerClass: PlayerClass): PlayerProfile {
  return {
    id: `cheat-${playerClass}`,
    nick: playerClass,
    x: 12,
    y: 34,
    level: 1,
    xp: 25,
    hp: 10,
    appearance: { body: "wayfarer", primaryColor: "azure" },
    class: playerClass,
    equipment: starterEquipmentFor(playerClass),
    inventory: { potions: 0, gold: 0, crystals: 0 },
    quest: { chapter: "three_offerings", status: "available", progress: 0, target: 3 },
    zoneId: "verdant-reach",
    instanceId: "main",
    sessionEpoch: 1,
    wardRunExpiresAt: null,
    life: "alive",
    corpse: null,
  };
}

describe("local authoritative test commands", () => {
  it("parses exactly levels one through ten and keeps slash commands out of ordinary chat", () => {
    for (let level = 1; level <= 10; level += 1) {
      expect(parseCheatCommand(`/up${level}`)).toEqual({ kind: "level", level });
    }
    expect(parseCheatCommand("hello")).toBeNull();
    expect(parseCheatCommand("/up0")).toEqual({ kind: "unknown" });
    expect(parseCheatCommand("/up11")).toEqual({ kind: "unknown" });
    expect(parseCheatCommand("/cheats")).toEqual({ kind: "help" });
    expect(CHEAT_COMMAND_SYNTAX).toContain("/up1…/up10");
    expect(CHEAT_COMMAND_SYNTAX).toContain("/nodead");
  });

  it("sets level ten for every class without changing the class", () => {
    for (const playerClass of PLAYER_CLASSES) {
      const player = newPlayer(profile(playerClass), "connection", "room");
      const command = parseCheatCommand("/up10");
      if (!command) throw new Error("expected command");

      const result = executeCheatCommand(player, command);

      expect(player.class).toBe(playerClass);
      expect(player.level).toBe(10);
      expect(player.xp).toBe(0);
      expect(player.hp).toBe(maxHpForLevel(10));
      expect(result.event).toMatchObject({ code: "cheat.level", params: { level: 10 } });
    }
  });

  it("toggles session immortality and lets reset return to a neutral test state", () => {
    const player = newPlayer(profile("priest"), "connection", "room");
    const nodead = parseCheatCommand("/nodead");
    const reset = parseCheatCommand("/reset");
    if (!nodead || !reset) throw new Error("expected commands");

    executeCheatCommand(player, nodead);
    expect(isPlayerInvulnerable(player, Date.now())).toBe(true);
    player.hp = 1;
    if (player.resource) player.resource.current = 0;
    player.skillCooldowns = [1, 2, 3, 4, 5];

    executeCheatCommand(player, reset);
    expect(player.cheatInvulnerable).toBe(false);
    expect(player.hp).toBe(maxHpForLevel(player.level));
    expect(player.resource?.current).toBe(player.resource?.max);
    expect(player.skillCooldowns).toEqual([0, 0, 0, 0, 0]);
  });
});
