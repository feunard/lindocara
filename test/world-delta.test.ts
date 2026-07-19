import { describe, expect, it } from "vitest";
import type {
  MonsterSnapshot,
  PlayerSnapshot,
  WorldEventSnapshot,
  WorldView,
} from "../src/shared/protocol.js";
import {
  applyEventDelta,
  applyWorldDelta,
  buildEventDelta,
  buildWorldDelta,
  countDeltaEntities,
  createWorldCache,
  interpolateSnapshots,
  seedEventCache,
  worldViewFromCache,
} from "../src/shared/world-delta.js";

const player = (overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot => ({
  id: "player",
  nick: "Player",
  x: 100,
  y: 100,
  ack: 1,
  hp: 100,
  maxHp: 100,
  level: 1,
  appearance: { body: "wayfarer", primaryColor: "azure" },
  class: "warrior",
  equipment: { mainHand: "weathered_sword", offHand: "oak_shield" },
  life: "alive",
  facing: { x: 1, y: 0 },
  action: null,
  ...overrides,
});

const monster = (overrides: Partial<MonsterSnapshot> = {}): MonsterSnapshot => ({
  id: "monster",
  kind: "goblin",
  species: "spear_goblin",
  x: 200,
  y: 100,
  hp: 40,
  maxHp: 40,
  dead: false,
  facing: { x: -1, y: 0 },
  action: null,
  ...overrides,
});

const view = (overrides: Partial<WorldView> = {}): WorldView => ({
  players: [player()],
  monsters: [monster()],
  guards: [],
  loot: [{ id: "loot", kind: "gold", amount: 4, x: 210, y: 100 }],
  corpses: [],
  projectiles: [],
  ...overrides,
});

describe("differential world state", () => {
  it("sends no unchanged entities and accumulates the movement threshold", () => {
    const cache = createWorldCache(view());
    expect(countDeltaEntities(buildWorldDelta(cache, view()))).toBe(0);
    expect(
      buildWorldDelta(cache, view({ players: [player({ x: 100.2 })] })).players.upsert,
    ).toEqual([]);
    expect(
      buildWorldDelta(cache, view({ players: [player({ x: 100.7 })] })).players.upsert,
    ).toEqual([expect.objectContaining({ id: "player", x: 100.7 })]);
  });

  it("upserts visible HP changes even without movement", () => {
    const cache = createWorldCache(view());
    const delta = buildWorldDelta(cache, view({ players: [player({ hp: 72 })] }));
    expect(delta.players.upsert).toEqual([expect.objectContaining({ id: "player", hp: 72 })]);
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
    const next = view({ players: [player({ x: 125, ack: 3 })], monsters: [] });
    const delta = buildWorldDelta(serverCache, next);
    expect(applyWorldDelta(clientCache, delta)).toEqual(next);
    expect(worldViewFromCache(clientCache)).toEqual(next);

    expect(
      applyWorldDelta(clientCache, {
        players: { upsert: [], remove: ["unknown"] },
        monsters: { upsert: [], remove: [] },
        guards: { upsert: [], remove: [] },
        loot: { upsert: [], remove: [] },
        corpses: { upsert: [], remove: [] },
        projectiles: { upsert: [], remove: [] },
      }),
    ).toBeNull();
  });

  it("feeds reconstructed remote states into the existing interpolation", () => {
    const cache = createWorldCache(view({ monsters: [monster({ x: 200 })] }));
    const previous = worldViewFromCache(cache);
    const delta = buildWorldDelta(cache, view({ monsters: [monster({ x: 220 })] }));
    const reconstructed = applyWorldDelta(
      createWorldCache(view({ monsters: [monster({ x: 200 })] })),
      delta,
    );
    expect(reconstructed).not.toBeNull();
    expect(interpolateSnapshots(previous.monsters, reconstructed?.monsters ?? [], 0.5)[0]?.x).toBe(
      210,
    );
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
