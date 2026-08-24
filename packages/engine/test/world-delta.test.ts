import type {
  MonsterSnapshot,
  PlayerSnapshot,
  SeaGuardianSnapshot,
  WorldEventSnapshot,
  WorldView,
} from "@lindocara/engine/protocol.js";
import {
  applyEventDelta,
  applyWorldDelta,
  buildEventDelta,
  buildWorldDelta,
  countDeltaEntities,
  createWorldCache,
  interpolateSnapshots,
  seedEventCache,
  WORLD_POSITION_DELTA_THRESHOLD,
  worldViewFromCache,
} from "@lindocara/engine/world-delta.js";
import { describe, expect, it } from "vitest";

/**
 * Every fixture below is in TILE units on the ground plane: `x`/`z` are the two ground axes and
 * `y` is elevation, flat at 0 for everything here. The magnitudes shrank with the ruler — a hero
 * two tiles from the origin, not two hundred pixels — and so did
 * `WORLD_POSITION_DELTA_THRESHOLD`, which is why the movement test below states its offsets as
 * multiples of that constant instead of writing out numbers that only meant something in pixels.
 */
const player = (overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot => ({
  id: "player",
  nick: "Player",
  x: 2,
  y: 0,
  z: 2,
  airborne: false,
  swimming: false,
  gliding: false,
  hp: 100,
  maxHp: 100,
  level: 1,
  appearance: { body: "wayfarer", primaryColor: "azure" },
  class: "warrior",
  equipment: { mainHand: "weathered_sword", offHand: "oak_shield" },
  life: "alive",
  facing: { x: 1, z: 0 },
  action: null,
  ...overrides,
});

const monster = (overrides: Partial<MonsterSnapshot> = {}): MonsterSnapshot => ({
  id: "monster",
  name: "",
  kind: "goblin",
  species: "spear_goblin",
  rank: "normal",
  specialTechnique: "none",
  x: 4,
  y: 0,
  z: 2,
  hp: 40,
  maxHp: 40,
  dead: false,
  facing: { x: -1, z: 0 },
  action: null,
  ...overrides,
});

const seaGuardian = (overrides: Partial<SeaGuardianSnapshot> = {}): SeaGuardianSnapshot => ({
  id: "sea-guardian",
  x: -2,
  y: -0.05,
  z: 1,
  facing: { x: 1, z: 0 },
  state: "patrol",
  animationStartedAt: 1_000,
  animationEndsAt: null,
  ...overrides,
});

const view = (overrides: Partial<WorldView> = {}): WorldView => ({
  players: [player()],
  seaGuardians: [],
  monsters: [monster()],
  guards: [],
  loot: [{ id: "loot", kind: "gold", amount: 4, x: 4.5, y: 0, z: 2 }],
  corpses: [],
  projectiles: [],
  ...overrides,
});

describe("differential world state", () => {
  it("sends no unchanged entities and accumulates the movement threshold", () => {
    const cache = createWorldCache(view());
    const still = 2 + WORLD_POSITION_DELTA_THRESHOLD * 0.4;
    const moved = 2 + WORLD_POSITION_DELTA_THRESHOLD * 1.4;
    expect(countDeltaEntities(buildWorldDelta(cache, view()))).toBe(0);
    expect(
      buildWorldDelta(cache, view({ players: [player({ x: still })] })).players.upsert,
    ).toEqual([]);
    expect(
      buildWorldDelta(cache, view({ players: [player({ x: moved })] })).players.upsert,
    ).toEqual([expect.objectContaining({ id: "player", x: moved })]);
  });

  it("upserts visible HP changes even without movement", () => {
    const cache = createWorldCache(view());
    const delta = buildWorldDelta(cache, view({ players: [player({ hp: 72 })] }));
    expect(delta.players.upsert).toEqual([expect.objectContaining({ id: "player", hp: 72 })]);
  });

  it("diffs and interpolates the untargetable sea guardian as its own entity family", () => {
    const cache = createWorldCache(view({ seaGuardians: [seaGuardian()] }));
    const delta = buildWorldDelta(
      cache,
      view({
        seaGuardians: [seaGuardian({ x: 2, state: "attack", animationEndsAt: 1_850 })],
      }),
    );
    expect(delta.seaGuardians.upsert).toEqual([
      expect.objectContaining({ id: "sea-guardian", state: "attack" }),
    ]);
    expect(interpolateSnapshots([seaGuardian()], delta.seaGuardians.upsert, 0.5)[0]?.x).toBe(0);
  });

  it("upserts entering entities and removes entities leaving interest", () => {
    const cache = createWorldCache(view({ monsters: [] }));
    const entered = buildWorldDelta(cache, view());
    expect(entered.monsters.upsert).toEqual([expect.objectContaining({ id: "monster" })]);

    const left = buildWorldDelta(cache, view({ monsters: [] }));
    expect(left.monsters.remove).toEqual(["monster"]);
  });

  it("removes picked loot from the client cache", () => {
    const cache = createWorldCache(view());
    const delta = buildWorldDelta(cache, view({ loot: [] }));
    expect(delta.loot.remove).toEqual(["loot"]);
    expect(applyWorldDelta(createWorldCache(view()), delta)?.loot).toEqual([]);
  });

  it("applies valid deltas and rejects an impossible removal for resynchronization", () => {
    const serverCache = createWorldCache(view());
    const clientCache = createWorldCache(view());
    const next = view({ players: [player({ x: 2.5, airborne: true })], monsters: [] });
    const delta = buildWorldDelta(serverCache, next);
    expect(applyWorldDelta(clientCache, delta)).toEqual(next);
    expect(worldViewFromCache(clientCache)).toEqual(next);

    expect(
      applyWorldDelta(clientCache, {
        players: { upsert: [], remove: ["unknown"] },
        seaGuardians: { upsert: [], remove: [] },
        monsters: { upsert: [], remove: [] },
        guards: { upsert: [], remove: [] },
        loot: { upsert: [], remove: [] },
        corpses: { upsert: [], remove: [] },
        projectiles: { upsert: [], remove: [] },
      }),
    ).toBeNull();
  });

  it("feeds reconstructed remote states into the existing interpolation", () => {
    const cache = createWorldCache(view({ monsters: [monster({ x: 4 })] }));
    const previous = worldViewFromCache(cache);
    const delta = buildWorldDelta(cache, view({ monsters: [monster({ x: 6 })] }));
    const reconstructed = applyWorldDelta(
      createWorldCache(view({ monsters: [monster({ x: 4 })] })),
      delta,
    );
    expect(reconstructed).not.toBeNull();
    expect(interpolateSnapshots(previous.monsters, reconstructed?.monsters ?? [], 0.5)[0]?.x).toBe(
      5,
    );
  });

  it("snaps a monster immediately when the server resets its position", () => {
    const result = interpolateSnapshots(
      [monster({ x: 8, positionRevision: 0 })],
      [monster({ x: 1, positionRevision: 1 })],
      0.1,
    );
    expect(result[0]?.x).toBe(1);
  });

  it("measures a substantially smaller steady-state JSON payload", () => {
    const initial = view();
    const cache = createWorldCache(initial);
    const oldBytes = JSON.stringify({ t: "snapshot", tick: 2, ...initial }).length;
    const deltas = Array.from({ length: 10 }, (_, index) => ({
      t: "world.delta",
      tick: 2 + index * 2,
      ...buildWorldDelta(cache, initial),
    }));
    const averageDeltaBytes =
      deltas.reduce((total, delta) => total + JSON.stringify(delta).length, 0) / deltas.length;
    expect(deltas.filter((delta) => countDeltaEntities(delta) === 0)).toHaveLength(10);
    expect(averageDeltaBytes).toBeLessThan(oldBytes * 0.5);
  });
});

describe("room-scoped event deltas", () => {
  const event = (overrides: Partial<WorldEventSnapshot> = {}): WorldEventSnapshot => ({
    id: "event-a",
    col: 5,
    row: 5,
    graphicAssetId: "building.buildings-black-buildings.archery",
    onTop: false,
    moveSpeed: 3,
    moveFrequency: 3,
    moveAnimation: true,
    directionFixed: false,
    ...overrides,
  });

  it("upserts a new or changed active page and removes a dormant one", () => {
    const cache = createWorldCache();
    seedEventCache(cache, [event()]);
    // Unchanged: no delta.
    expect(buildEventDelta(cache, [event()])).toEqual({ upsert: [], remove: [] });
    // Changed graphic (same id): an upsert, no removal.
    const changed = event({ graphicAssetId: "resource.terrain-resources-wood-trees.tree3" });
    expect(buildEventDelta(cache, [changed])).toEqual({ upsert: [changed], remove: [] });
    // Gone dormant: a removal.
    expect(buildEventDelta(cache, [])).toEqual({ upsert: [], remove: ["event-a"] });
  });

  it("applies a delta into the client baseline, upsert then removal", () => {
    const client = createWorldCache();
    seedEventCache(client, [event()]);
    const changed = event({ graphicAssetId: "resource.terrain-resources-wood-trees.tree3" });
    expect(applyEventDelta(client, { upsert: [changed], remove: [] })).toEqual([changed]);
    expect(applyEventDelta(client, { upsert: [], remove: ["event-a"] })).toEqual([]);
  });

  it("rejects an unknown or duplicate removal so the caller can resync", () => {
    const client = createWorldCache();
    seedEventCache(client, [event()]);
    expect(applyEventDelta(client, { upsert: [], remove: ["ghost"] })).toBeNull();
    expect(applyEventDelta(client, { upsert: [event(), event()], remove: [] })).toBeNull();
  });
});
