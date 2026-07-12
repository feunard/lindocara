import { describe, expect, it } from "vitest";
import type { MonsterSnapshot, PlayerSnapshot, WorldView } from "../src/shared/protocol.js";
import {
  applyWorldDelta,
  buildWorldDelta,
  countDeltaEntities,
  createWorldCache,
  interpolateSnapshots,
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
  ...overrides,
});

const monster = (overrides: Partial<MonsterSnapshot> = {}): MonsterSnapshot => ({
  id: "monster",
  kind: "goblin",
  species: "goblin_scout",
  x: 200,
  y: 100,
  hp: 40,
  maxHp: 40,
  dead: false,
  ...overrides,
});

const view = (overrides: Partial<WorldView> = {}): WorldView => ({
  players: [player()],
  monsters: [monster()],
  guards: [],
  loot: [{ id: "loot", kind: "gold", amount: 4, x: 210, y: 100 }],
  corpses: [],
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
