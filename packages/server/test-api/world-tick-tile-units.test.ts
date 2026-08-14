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
 * 4. **releasing resurrects at the map entry, alive, grounded, and with all three axes.** A
 *    two-axis landing typechecks while leaving elevation at whatever height the hero died holding.
 * 5. **every server-authored teleport writes BOTH ground axes.** `WorldPosition`'s ground pair is
 *    `x`/`z` and its `y` is elevation, so `player.x = d.x; player.y = d.y;` — the pixel shape,
 *    verbatim — typechecks perfectly, moves the body along ONE ground axis and leaves it at a
 *    position `canStand` never validated. Two of these shipped and were caught in review; each
 *    destination below therefore differs from its origin on **both** ground axes, which is the only
 *    arrangement that can tell an arrival apart from a half-arrival.
 */

import { EMPTY_ADVENTURE_STATE } from "@lindocara/engine/adventure-state.js";
import { starterEquipmentFor } from "@lindocara/engine/character.js";
import { resurrectHp } from "@lindocara/engine/death.js";
import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import { DEFAULT_ZONE_NAVIGATION } from "@lindocara/engine/navigation.js";
import {
  BODY_RADIUS,
  canStand,
  groundUnder,
  type ZoneTerrain,
  zoneTerrainFromHeightfield,
} from "@lindocara/engine/terrain-access.js";
import type { ZoneDefinition } from "@lindocara/engine/zones.js";
import { describe, expect, it } from "vitest";
import { activeEventCentre, touchesEventCell } from "../src/api/realtime/worldEvents.ts";
import { createWorldRoomState } from "../src/api/realtime/worldState.ts";
import {
  applyReportedMove,
  handleRelease,
  killPlayer,
  startPlayerAction,
  teleportSameMap,
  type WorldGlue,
  type WorldTickDeps,
} from "../src/api/realtime/worldTick.ts";
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
    enterBuilding: () => {},
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

  it("refuses a reported position that describes no point on this map", () => {
    const built = terrain();
    const player = hero(0, 0);
    const w = glue(built, player);
    const report = {
      t: "move" as const,
      y: 0,
      vy: 0,
      facing: { x: 1, z: 0 },
      airborne: false,
      swimming: false,
      gliding: false,
      // The stamp the room currently holds: this test is about the BOUNDS, so its frames must be
      // current — a stale echo would be dropped by the other guard and prove nothing here.
      displacement: player.displacement,
    };

    // Inside the wire's own ±128-tile bound (`MOVE_COORDINATE_LIMIT`) and far off THIS 16-cell
    // grid: only the room knows which grid it owns, so only the room can refuse this.
    applyReportedMove(w, "connection", player, { ...report, x: 100, z: 0 });
    expect(player.x).toBe(0);
    applyReportedMove(w, "connection", player, { ...report, x: 0, z: -100 });
    expect(player.z).toBe(0);
    // Elevation shares the rule: no relief on a grid this size reaches a hundred units up.
    applyReportedMove(w, "connection", player, { ...report, x: 0, y: 100, z: 0 });
    expect(player.y).toBe(0);

    // A point ON the grid is stored as reported, all three axes — the server gave up deciding
    // where a hero is, not whether the position is a position at all.
    applyReportedMove(w, "connection", player, { ...report, x: 2, y: LEVEL_HEIGHT, z: -3 });
    expect(player.x).toBe(2);
    expect(player.y).toBe(LEVEL_HEIGHT);
    expect(player.z).toBe(-3);
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
  it("leaves the body where it fell until release, with all three axes", () => {
    const built = terrain();
    const player = hero(2.25, -3.5);
    const w = glue(built, player);

    killPlayer(w, "connection", player);

    expect(player.life).toBe("corpse");
    expect(player.corpse).toEqual({ x: 2.25, y: 0, z: -3.5 });
  });

  it("resurrects alive on the map's authored entry point", () => {
    const built = terrain();
    const player = hero(2.5, -3.5);
    const spawn = { x: -1.5, z: -1.5 };
    const w = glue(built, player, spawn);

    killPlayer(w, "connection", player);
    handleRelease(w, "connection", player);

    expect(player).toMatchObject({
      life: "alive",
      corpse: null,
      hp: resurrectHp(player.level),
      x: spawn.x,
      y: groundUnder(built, spawn.x, spawn.z),
      z: spawn.z,
    });
  });

  it("resurrects directly even when the hero died on the entry point", () => {
    const built = terrain();
    const spawn = { x: -1.5, z: -1.5 };
    const player = hero(spawn.x, spawn.z);
    const w = glue(built, player, spawn);

    killPlayer(w, "connection", player);
    handleRelease(w, "connection", player);

    expect(player).toMatchObject({ life: "alive", corpse: null, x: spawn.x, z: spawn.z });
  });

  it("ignores another release after the hero is already alive", () => {
    const built = terrain();
    const player = hero(2.5, -3.5);
    const w = glue(built, player, { x: -1.5, z: -1.5 });

    killPlayer(w, "connection", player);
    handleRelease(w, "connection", player);
    const landed = { x: player.x, y: player.y, z: player.z, hp: player.hp };
    handleRelease(w, "connection", player);

    expect(player.life).toBe("alive");
    expect({ x: player.x, y: player.y, z: player.z, hp: player.hp }).toEqual(landed);
  });

  it("uses the standable entry fallback instead of resurrecting inside an obstacle", () => {
    const built = terrain([{ x: -1.5, z: -1.5, w: 3, h: 3 }]);
    const player = hero(4.5, 4.5);
    const w = glue(built, player, null);
    expect(canStand(built, 0, 0, BODY_RADIUS, groundUnder(built, 0, 0))).toBe(false);

    killPlayer(w, "connection", player);
    handleRelease(w, "connection", player);

    expect(player.life).toBe("alive");
    expect(player.corpse).toBeNull();
    expect(
      canStand(built, player.x, player.z, BODY_RADIUS, groundUnder(built, player.x, player.z)),
    ).toBe(true);
  });
});

/**
 * The two dropped-`z` regressions review caught, each pinned by a destination that differs from
 * the origin on BOTH ground axes. A destination that moves only in `x` is passed by
 * `player.x = d.x; player.y = d.y;` — the exact bug — so a single-axis fixture proves nothing.
 */
describe("a server-authored teleport writes both ground axes", () => {
  it("moves the rogue's shadow return along x AND z, to the level it planned", () => {
    const built = terrain();
    const player = hero(1.5, 1.5);
    player.class = "rogue";
    player.level = 10;
    player.equipment = starterEquipmentFor("rogue");
    // Read straight off the runtime: `talentEffects` is a set lookup over `player.talents`.
    player.talents = ["rogue.shadow_step.shadow_return"];
    const remembered = { x: -3.5, y: 0, z: -2.5, expiresAt: NOW + 10_000 };
    player.rogueShadowReturn = remembered;
    const w = glue(built, player);

    expect(startPlayerAction(w, "connection", player, 2)).toBe(true);

    expect(player.x).toBeCloseTo(remembered.x, 10);
    expect(player.z).toBeCloseTo(remembered.z, 10);
    expect(player.y).toBe(groundUnder(built, remembered.x, remembered.z));
    expect(player.rogueShadowReturn).toBeNull();
  });

  it("carries a hero through a Pas de Lumen gate along x AND z", () => {
    const built = terrain();
    // The gate's mouth, and an exit two tiles away on both ground axes.
    const from = { x: 1.5, y: 0, z: 1.5 };
    const to = { x: -2.5, y: 0, z: -2.5 };
    const player = hero(from.x, from.z);
    player.class = "priest";
    player.equipment = starterEquipmentFor("priest");
    const w = glue(built, player);
    w.state.lumenPortals.push({
      id: "portal-1",
      ownerId: HERO_ID,
      from,
      to,
      startedAt: NOW,
      expiresAt: NOW + 10_000,
      triggerRadius: 1,
      usedPlayerIds: new Set(),
      // Empty rather than the owner: the hero is standing in the mouth already, and the
      // waiting-for-exit latch exists to stop that bouncing them the instant the gate opens.
      waitingForExitIds: new Set(),
      healingPower: 0,
    });

    // The gate fires on the movement edge, and the edge is now a reported position.
    applyReportedMove(w, "connection", player, {
      t: "move",
      x: from.x + 0.25,
      y: from.y,
      z: from.z,
      vy: 0,
      facing: { x: 1, z: 0 },
      airborne: false,
      swimming: false,
      gliding: false,
      displacement: player.displacement,
    });

    expect(player.x).toBeCloseTo(to.x, 10);
    expect(player.z).toBeCloseTo(to.z, 10);
    expect(player.y).toBe(groundUnder(built, to.x, to.z));
  });
});
