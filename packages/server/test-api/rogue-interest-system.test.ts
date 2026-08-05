import { starterEquipmentFor } from "@lindocara/engine/character.js";
import { SPATIAL_CELL_SIZE } from "@lindocara/engine/interest.js";
import { worldView } from "@lindocara/server/world/interest-system.js";
import { SpatialGrid } from "@lindocara/server/world/spatial-grid.js";
import {
  type GroundLoot,
  type MonsterRuntime,
  newPlayer,
  type PlayerRuntime,
} from "@lindocara/server/world/world-runtime.js";
import { describe, expect, it } from "vitest";

/**
 * A hero at ground `x`, on flat level-0 ground. Everything here is TILE UNITS with the grid centre
 * as origin: `x`/`z` are the ground axes, `y` is elevation.
 */
function player(id: string, x: number, playerClass: "rogue" | "warrior"): PlayerRuntime {
  const result = newPlayer(
    {
      id,
      nick: id,
      x,
      y: 0,
      z: 1,
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

/**
 * Well beyond `PLAYER_VISIBILITY_RADIUS + INTEREST_HYSTERESIS` (about 15.6 tiles), so the hidden
 * Rogue's own position could never keep it in the viewer's AOI on its own — only the decoy can.
 */
const FAR_AWAY_X = 22;

/** Two tiles from the viewer: comfortably inside the same bound. */
const DECOY_X = 2.5;

describe("Rogue stealth interest projection", () => {
  it("never exposes the hidden Rogue position and keeps the Rogue-shaped decoy in AOI", () => {
    const viewer = player("viewer", 0.5, "warrior");
    const rogue = player("rogue", FAR_AWAY_X, "rogue");
    rogue.rogueStealthUntil = 9_000;
    rogue.rogueSilhouette = { x: DECOY_X, y: 0, z: 1, hp: 45, expiresAt: 6_000 };
    const players = new Map([
      [viewer.connectionId, viewer],
      [rogue.connectionId, rogue],
    ]);
    const playerGrid = new SpatialGrid<PlayerRuntime>(SPATIAL_CELL_SIZE);
    playerGrid.insert(viewer);
    playerGrid.insert(rogue);
    const context = {
      players,
      monsters: [],
      guards: [],
      loot: [] as GroundLoot[],
      projectiles: [],
      playerGrid,
      monsterGrid: new SpatialGrid<MonsterRuntime>(SPATIAL_CELL_SIZE),
      lootGrid: new SpatialGrid<GroundLoot>(SPATIAL_CELL_SIZE),
      navigationDebugAvailable: false,
      now: () => 1_000,
    };

    const remote = worldView(context, viewer).players.find((entry) => entry.id === rogue.id);
    expect(remote).toMatchObject({
      class: "rogue",
      appearance: rogue.appearance,
      x: DECOY_X,
      y: 0,
      z: 1,
      silhouette: true,
      invisible: false,
    });
    expect(remote?.x).not.toBe(rogue.x);

    rogue.rogueSilhouette = null;
    expect(worldView(context, viewer).players.some((entry) => entry.id === rogue.id)).toBe(false);
    const self = worldView(context, rogue).players.find((entry) => entry.id === rogue.id);
    expect(self).toMatchObject({ x: FAR_AWAY_X, invisible: true });
  });
});
