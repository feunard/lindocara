import { starterEquipmentFor } from "@lindocara/engine/character.js";
import { worldView } from "@lindocara/server/world/interest-system.js";
import { SpatialGrid } from "@lindocara/server/world/spatial-grid.js";
import {
  type GroundLoot,
  type MonsterRuntime,
  newPlayer,
  type PlayerRuntime,
} from "@lindocara/server/world/world-runtime.js";
import { describe, expect, it } from "vitest";

function player(id: string, x: number, playerClass: "rogue" | "warrior"): PlayerRuntime {
  const result = newPlayer(
    {
      id,
      nick: id,
      x,
      y: 64,
      level: 10,
      xp: 0,
      hp: 100,
      appearance: { body: "wayfarer", primaryColor: playerClass === "rogue" ? "violet" : "azure" },
      class: playerClass,
      equipment: starterEquipmentFor(playerClass),
      inventory: { potions: 0, gold: 0, crystals: 0 },
      quest: { chapter: "three_offerings", status: "available", progress: 0, target: 3 },
      zoneId: "map-a",
      instanceId: "main",
      sessionEpoch: 1,
      wardRunExpiresAt: null,
      life: "alive",
      corpse: null,
    },
    `connection-${id}`,
    "party-a:map-a",
  );
  result.identityKind = "hero";
  result.partyId = "party-a";
  return result;
}

describe("Rogue stealth interest projection", () => {
  it("never exposes the hidden Rogue position and keeps the Rogue-shaped decoy in AOI", () => {
    const viewer = player("viewer", 32, "warrior");
    const rogue = player("rogue", 1_400, "rogue");
    rogue.rogueStealthUntil = 9_000;
    rogue.rogueSilhouette = { x: 80, y: 64, hp: 45, expiresAt: 6_000 };
    const players = new Map([
      [viewer.connectionId, viewer],
      [rogue.connectionId, rogue],
    ]);
    const playerGrid = new SpatialGrid<PlayerRuntime>(64);
    playerGrid.insert(viewer);
    playerGrid.insert(rogue);
    const context = {
      players,
      monsters: [],
      guards: [],
      loot: [] as GroundLoot[],
      projectiles: [],
      playerGrid,
      monsterGrid: new SpatialGrid<MonsterRuntime>(64),
      lootGrid: new SpatialGrid<GroundLoot>(64),
      navigationDebugAvailable: false,
      now: () => 1_000,
    };

    const remote = worldView(context, viewer).players.find((entry) => entry.id === rogue.id);
    expect(remote).toMatchObject({
      class: "rogue",
      appearance: rogue.appearance,
      x: 80,
      y: 64,
      silhouette: true,
      invisible: false,
    });
    expect(remote?.x).not.toBe(rogue.x);

    rogue.rogueSilhouette = null;
    expect(worldView(context, viewer).players.some((entry) => entry.id === rogue.id)).toBe(false);
    const self = worldView(context, rogue).players.find((entry) => entry.id === rogue.id);
    expect(self).toMatchObject({ x: 1_400, invisible: true });
  });
});
