/**
 * The tick composition, in tile units — the behaviours a mechanical `y` → `z` rename would satisfy
 * the compiler about while quietly losing. `worldTick.ts` is where every system meets, so each case
 * here pins one thing that has no other guard:
 *
 * 1. **an authored cell index becomes a GRID-CENTRED ground point.** `eventCellCentre` answers in
 *    the editor's pixel, top-left space; a teleport reading it lands thousands of tiles off a
 *    64-tile grid, and every proximity clause measuring against it stops rejecting anything.
 * 2. **a body's box is centred on its position.** A pixel position was a 32 px box's top-left
 *    corner; a tile-unit one is the centre. Keep the corner anchoring and an event's contact
 *    trigger fires half a body late in one direction and half a body early in the other.
 * 3. **an authored teleport is grounded on where it LANDS, not on a step.** That is deliberate — an
 *    author placed the destination — but `canStand`'s disc and the collider index still have to
 *    accept it, and the collider half is the one a relief-only conversion silently drops.
 * 4. **a released ghost lands somewhere standable, away from its own corpse, with three axes.**
 *    Releasing on top of your own body reclaims it on the next tick, and a two-axis landing
 *    typechecks while leaving the ghost's elevation at whatever it died holding.
 */

import { EMPTY_ADVENTURE_STATE } from "@lindocara/engine/adventure-state.js";
import { starterEquipmentFor } from "@lindocara/engine/character.js";
import { CORPSE_RECLAIM_RANGE } from "@lindocara/engine/death.js";
import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import { DEFAULT_ZONE_NAVIGATION } from "@lindocara/engine/navigation.js";
import type { ZoneDefinition } from "@lindocara/engine/zones.js";
import { describe, expect, it } from "vitest";
import { activeEventCentre, touchesEventCell } from "../src/api/realtime/worldEvents.ts";
import { createWorldRoomState } from "../src/api/realtime/worldState.ts";
import {
  handleRelease,
  killPlayer,
  teleportSameMap,
  type WorldGlue,
  type WorldTickDeps,
} from "../src/api/realtime/worldTick.ts";
import {
  BODY_RADIUS,
  canStand,
  groundUnder,
  type ZoneTerrain,
  zoneTerrainFromHeightfield,
} from "../src/world/terrain-access.js";
import { newPlayer, type PlayerRuntime } from "../src/world/world-runtime.js";

const SIZE = 16;
const HALF = SIZE / 2;
const LEVEL_HEIGHT = 0.5;
const PARTY_ID = "party-a";
const MAP_ID = "map-a";
const HERO_ID = "hero-1";
const NOW = 1_000;

/** Every cell from row `PLATEAU_ROW` southwards is one tier up; `MAX_STEP` is 0, so it is a wall. */
const PLATEAU_ROW = 12;

/** The world point at the centre of cell `(col, row)`, in tile units, grid centre as origin. */
function atCell(col: number, row: number): { x: number; z: number } {
  return { x: col + 0.5 - HALF, z: row + 0.5 - HALF };
}

function terrain(colliders: MapData["colliders"] = []): ZoneTerrain {
  const levels: (number | null)[] = [];
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      void col;
      levels.push(row >= PLATEAU_ROW ? 1 : 0);
    }
  }
  const map: MapData = {
    version: 1,
    size: SIZE,
    levelHeight: LEVEL_HEIGHT,
    waterLevel: -0.25,
    levels,
    materials: new Array(SIZE * SIZE).fill("herbe"),
    colliders,
    spawns: [],
    elements: [],
    events: [],
  };
  return zoneTerrainFromHeightfield(map);
}

function definitionWith(
  built: ZoneTerrain,
  spawn: { x: number; z: number } | null,
): ZoneDefinition {
  return {
    id: MAP_ID,
    nameKey: "zone.verdant_reach.name",
    type: "open_world",
    defaultInstanceId: "main",
    maxPlayers: 4,
    terrain: built,
    quests: [],
    questSites: [],
    monsters: [],
    guards: [],
    portals: [],
    navigation: DEFAULT_ZONE_NAVIGATION,
    events: [],
    ...(spawn ? { spawns: [{ name: "entry", x: spawn.x, z: spawn.z }] } : {}),
  };
}

function hero(x: number, z: number): PlayerRuntime {
  const player = newPlayer(
    {
      id: HERO_ID,
      nick: "Mira",
      x,
      y: 0,
      z,
      level: 1,
      xp: 0,
      hp: 100,
      appearance: { body: "wayfarer", primaryColor: "azure" },
      class: "warrior",
      equipment: starterEquipmentFor("warrior"),
      inventory: { potions: 0, gold: 0, crystals: 0 },
      quest: { chapter: "three_offerings", status: "available", progress: 0, target: 3 },
      zoneId: MAP_ID,
      instanceId: "main",
      sessionEpoch: 1,
      wardRunExpiresAt: null,
      life: "alive",
      corpse: null,
    },
    "connection",
    `${PARTY_ID}:${MAP_ID}`,
  );
  player.identityKind = "hero";
  player.partyId = PARTY_ID;
  return player;
}

function glue(
  built: ZoneTerrain,
  player: PlayerRuntime,
  spawn: { x: number; z: number } | null = null,
): WorldGlue {
  const definition = definitionWith(built, spawn);
  const state = createWorldRoomState(
    `${PARTY_ID}:${MAP_ID}`,
    { partyId: PARTY_ID, mapId: MAP_ID },
    { zoneId: MAP_ID, instanceId: "main", roomKey: `${PARTY_ID}:${MAP_ID}`, definition },
  );
  state.adventureState = { state: EMPTY_ADVENTURE_STATE, version: 0 };
  state.players.set("connection", player);
  state.connectionIdByHeroId.set(HERO_ID, "connection");
  state.playerGrid.insert(player);
  const deps: WorldTickDeps = {
    now: () => NOW,
    send: () => {},
    waitUntil: () => {},
    renewPresence: async () => {},
    savePlayer: async () => true,
    presenceHeartbeatMs: 10_000,
    navigationDebugAvailable: false,
    markPermanentMonsterDefeated: () => {},
    recordQuestEvent: () => {},
    broadcastToParty: () => {},
    applyStateChanges: async () => {},
    acceptAuthoredQuest: async () => ({ ok: false, reason: "party" }),
    abandonAuthoredQuest: async () => ({ ok: false, reason: "party" }),
    completeAuthoredQuest: async () => ({ ok: false, reason: "party" }),
    completeAdventure: async () => {},
    cheatsEnabled: false,
    transitionAdventureExit: () => {},
    teleportCrossMap: () => {},
    claimQuestReward: async () => false,
    reserveHarvestNode: async () => ({ ok: false, reason: "invalid" }),
    hitHarvestNode: async () => ({ ok: false, reason: "reservation" }),
    cancelHarvestNode: async () => false,
    consumePotion: async () => null,
  };
  return { state, deps };
}

describe("an authored teleport, in tile units", () => {
  it("lands on the grid-centred centre of the authored cell", () => {
    const built = terrain();
    const player = hero(0, 0);
    const w = glue(built, player);

    expect(teleportSameMap(w, player, 3, 5, "event-1")).toBe("teleported");

    // The whole point: cell (3, 5) is at (-4.5, -2.5), not at the pixel (224, 352). A conversion
    // that kept `eventCellCentre` typechecks and puts the hero hundreds of tiles off a 16-tile map.
    expect(player.x).toBeCloseTo(atCell(3, 5).x, 10);
    expect(player.z).toBeCloseTo(atCell(3, 5).z, 10);
    // All three axes travel: `y` is the ground the terrain reports under the landing.
    expect(player.y).toBe(0);
  });

  it("re-derives the elevation from the ground it lands on", () => {
    // On flat level-0 ground `y: 0` cannot tell "read from the terrain" from "hard-coded 0".
    // A cell in the plateau's interior can. It is also the one place a teleport deliberately
    // differs from a step: an AUTHORED destination is grounded on where it lands, so high ground an
    // author chose is reachable even though `MAX_STEP` is 0 and nothing walks up to it.
    const built = terrain();
    const player = hero(0, 0);
    const w = glue(built, player);

    expect(teleportSameMap(w, player, 8, 14, "event-1")).toBe("teleported");
    expect(player.y).toBe(LEVEL_HEIGHT);
  });

  it("refuses a cell off the grid rather than snapping a hero into the void", () => {
    const built = terrain();
    const player = hero(0, 0);
    const w = glue(built, player);

    // `SIZE` is one past the last index. A bounds test written as a rectangle anchored at zero —
    // the pixel model's — would still accept this, because the grid now runs from `-SIZE/2`.
    expect(teleportSameMap(w, player, SIZE, 2, "event-1")).toBe("first-refusal");
    expect(teleportSameMap(w, player, -1, 2, "event-2")).toBe("first-refusal");
    expect(player.x).toBe(0);
    expect(player.z).toBe(0);
  });

  it("refuses a cell a body could not stand in", () => {
    // A prop filling cell (3, 5). The destination is inside the grid and on flat ground, so only
    // the collider index can refuse it — which is the half of `canStand` a relief-only conversion
    // would have dropped, since the two used to live in one pixel `isWalkable` call.
    const cell = atCell(3, 5);
    const built = terrain([{ x: cell.x - 0.5, z: cell.z - 0.5, w: 1, h: 1 }]);
    const player = hero(0, 0);
    const w = glue(built, player);

    expect(canStand(built, cell.x, cell.z, BODY_RADIUS, 0)).toBe(false);
    expect(teleportSameMap(w, player, 3, 5, "event-1")).toBe("first-refusal");
    expect(player.x).toBe(0);
    expect(player.z).toBe(0);
    // A second refusal of the same (event, reason) is logged only once.
    expect(teleportSameMap(w, player, 3, 5, "event-1")).toBe("repeat-refusal");
  });

  it("clears the movement queue so no buffered command replays past the snap", () => {
    const built = terrain();
    const player = hero(0, 0);
    player.queue.push({ seq: 1, input: { up: false, down: true, left: false, right: false } });
    const w = glue(built, player);

    expect(teleportSameMap(w, player, 3, 5, "event-1")).toBe("teleported");
    expect(player.queue).toHaveLength(0);
  });
});

describe("an authored event's cell, in tile units", () => {
  const event = { id: "ev-1", col: 4, row: 6, kind: "normal" as const };

  it("has its centre on the grid-centred ground plane", () => {
    const built = terrain();
    const w = glue(built, hero(0, 0));
    const centre = activeEventCentre(w.state, event);
    expect(centre.x).toBeCloseTo(atCell(4, 6).x, 10);
    expect(centre.z).toBeCloseTo(atCell(4, 6).z, 10);
    expect(centre.y).toBe(0);
  });

  it("is touched by a body centred on its position, not anchored at a corner", () => {
    const built = terrain();
    const w = glue(built, hero(0, 0));
    const centre = atCell(4, 6);

    // Standing dead centre: touching, obviously.
    expect(touchesEventCell(w.state, centre, event, 0)).toBe(true);

    // Just outside the cell's western edge by slightly LESS than a body radius: the body still
    // overlaps, because the position is its centre. Anchoring the box at the position (the pixel
    // model) would report a miss here and a spurious hit a whole body-width to the east.
    const west = { x: centre.x - 0.5 - BODY_RADIUS * 0.9, z: centre.z };
    expect(touchesEventCell(w.state, west, event, 0)).toBe(true);

    // And a body clear of the cell by more than its own radius does not touch it.
    const clear = { x: centre.x - 0.5 - BODY_RADIUS * 1.1, z: centre.z };
    expect(touchesEventCell(w.state, clear, event, 0)).toBe(false);

    // The tolerance is a real ground distance, so it reopens exactly that gap.
    expect(touchesEventCell(w.state, clear, event, BODY_RADIUS * 0.2)).toBe(true);
  });
});

describe("releasing a spirit", () => {
  it("leaves the body where it fell, with all three axes", () => {
    const built = terrain();
    const player = hero(2.25, -3.5);
    const w = glue(built, player);

    killPlayer(w, "connection", player);

    expect(player.life).toBe("corpse");
    expect(player.corpse).toEqual({ x: 2.25, y: 0, z: -3.5 });
  });

  it("puts the ghost on the map's authored spawn", () => {
    const built = terrain();
    const player = hero(2.5, -3.5);
    const spawn = { x: -1.5, z: -1.5 };
    const w = glue(built, player, spawn);

    killPlayer(w, "connection", player);
    handleRelease(w, "connection", player);

    expect(player.life).toBe("ghost");
    expect(player.x).toBeCloseTo(spawn.x, 10);
    expect(player.z).toBeCloseTo(spawn.z, 10);
    expect(player.y).toBe(0);
  });

  it("never releases on top of the corpse, which would reclaim it on the next tick", () => {
    const built = terrain();
    // Dying exactly on the map's only spirit anchor.
    const spawn = { x: -1.5, z: -1.5 };
    const player = hero(spawn.x, spawn.z);
    const w = glue(built, player, spawn);

    killPlayer(w, "connection", player);
    handleRelease(w, "connection", player);

    const corpse = { x: spawn.x, z: spawn.z };
    expect(Math.hypot(player.x - corpse.x, player.z - corpse.z)).toBeGreaterThan(
      CORPSE_RECLAIM_RANGE,
    );
    // …and the ghost is somewhere a body could actually be standing, with its elevation read from
    // the ground rather than carried over from wherever it died.
    expect(
      canStand(built, player.x, player.z, BODY_RADIUS, groundUnder(built, player.x, player.z)),
    ).toBe(true);
    expect(player.y).toBe(groundUnder(built, player.x, player.z));
  });

  it("is one-way: a ghost cannot release again", () => {
    const built = terrain();
    const player = hero(2.5, -3.5);
    const w = glue(built, player, { x: -1.5, z: -1.5 });

    killPlayer(w, "connection", player);
    handleRelease(w, "connection", player);
    const landed = { x: player.x, z: player.z };
    handleRelease(w, "connection", player);

    expect(player.life).toBe("ghost");
    expect({ x: player.x, z: player.z }).toEqual(landed);
  });
});
