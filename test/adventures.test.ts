/**
 * The adventures boundary under the UX-wave 1-adventure model: a map belongs to one adventure, so an
 * adventure is created as a draft and its maps are authored inside it, then the graph is saved over
 * them. Ownership-scoped CRUD, implicit-membership graph validation, and the map guards all live
 * here. Same truncation discipline as db.test.ts (children first).
 */
import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import {
  createAdventure,
  deleteAdventure,
  listAdventures,
  loadAdventure,
  updateAdventure,
  updateAdventureRegistry,
} from "../src/server/adventures.js";
import { account, createDb, type Db, party } from "../src/server/db/index.js";
import { deleteMap as deleteOwnedMap, loadOwnedMap, updateMap } from "../src/server/maps.js";
import type { AdventureGraph } from "../src/shared/adventure.js";
import { EMPTY_REGISTRY } from "../src/shared/adventure-state.js";
import { EMPTY_MARKERS } from "../src/shared/map-data.js";
import {
  entryEvents,
  exitEvents,
  functionalEvent,
  type MapEvent,
} from "../src/shared/map-events.js";
import { authorMap, seedAdventure } from "./support/adventure-fixtures.js";
import { layeredTerrain } from "./support/map-fixtures.js";

const COLS = 20;
const ROWS = 15;

// UX wave #12: the graph binds entry/exit EVENT uuids. These are stable across re-authoring a map so
// a graph bound to them keeps matching when the marker-guard test rewrites a map's events.
const ENTRY_A = "aaaaaaaa-0000-4000-8000-000000000001";
const EXIT_A = "aaaaaaaa-0000-4000-8000-000000000002";
const SIDE_A = "aaaaaaaa-0000-4000-8000-000000000003";
const ENTRY_B = "bbbbbbbb-0000-4000-8000-000000000001";
const EXIT_B = "bbbbbbbb-0000-4000-8000-000000000002";

function blocks(): string[] {
  const rows: string[] = [];
  while (rows.length < ROWS) rows.push(".".repeat(COLS));
  return rows;
}

function ev(id: string, kind: "entry" | "exit", col: number, row: number): MapEvent {
  return functionalEvent({ id, col, row, ordinal: 0, kind });
}

/** A map body carrying explicit entry/exit events (default: entry@5,5 + exit@7,7). */
function mapInput(
  name: string,
  events: MapEvent[] = [ev(ENTRY_A, "entry", 5, 5), ev(EXIT_A, "exit", 7, 7)],
) {
  return {
    name,
    ...layeredTerrain(blocks()),
    elements: [],
    spawn: { col: 0, row: 0 },
    markers: EMPTY_MARKERS,
    events,
  };
}

/** Map A's events, map B's events — distinct uuids so the two rows never collide on the event pk. */
function eventsA(extra: MapEvent[] = []): MapEvent[] {
  return [ev(ENTRY_A, "entry", 5, 5), ev(EXIT_A, "exit", 7, 7), ...extra];
}
function eventsB(): MapEvent[] {
  return [ev(ENTRY_B, "entry", 5, 5), ev(EXIT_B, "exit", 7, 7)];
}

async function seedAccount(id: string): Promise<void> {
  await createDb(env.DB)
    .insert(account)
    .values({ id, username: id, passwordHash: "h", passwordSalt: "s", passwordIterations: 1 });
}

/** A two-map corridor: A.exit -> B.entry, B.exit -> end (bound by event uuids). */
function corridorGraph(mapA: string, mapB: string): AdventureGraph {
  return {
    start: { mapId: mapA, entryId: ENTRY_A },
    links: [
      { mapId: mapA, exitId: EXIT_A, dest: { mapId: mapB, entryId: ENTRY_B } },
      { mapId: mapB, exitId: EXIT_B, dest: "end" },
    ],
  };
}

/** The whole adventure-first flow: draft, author two maps inside it, save the corridor graph. */
async function buildAdventure(db: Db, owner: string) {
  const advId = await seedAdventure(db, owner, "Donjon");
  const mapA = await authorMap(db, owner, advId, mapInput("A", eventsA()));
  const mapB = await authorMap(db, owner, advId, mapInput("B", eventsB()));
  const adv = await updateAdventure(db, owner, advId, {
    title: "Donjon",
    maxPlayers: 2,
    graph: corridorGraph(mapA.id, mapB.id),
  });
  return { advId, mapA, mapB, adv };
}

afterEach(async () => {
  // Parties (FK-restrict onto adventure) must go before the adventures they pin.
  await env.DB.exec("DELETE FROM party_member");
  await env.DB.exec("DELETE FROM party");
  await env.DB.exec("DELETE FROM adventure");
  await env.DB.exec("DELETE FROM map_element");
  await env.DB.exec("DELETE FROM map");
  await env.DB.exec("DELETE FROM character");
  await env.DB.exec("DELETE FROM account");
});

describe("adventure CRUD", () => {
  it("round-trips an adventure and scopes it to its owner", async () => {
    const db = createDb(env.DB);
    await seedAccount("owner");
    await seedAccount("rival");
    const { advId, mapA, mapB, adv } = await buildAdventure(db, "owner");

    expect(adv).toMatchObject({ accountId: "owner", title: "Donjon", maxPlayers: 2, version: 1 });
    expect(adv.mapIds).toEqual([mapA.id, mapB.id]);

    expect(await listAdventures(db, "owner")).toEqual([
      { id: advId, title: "Donjon", maxPlayers: 2, mapCount: 2, playable: true },
    ]);
    expect(await listAdventures(db, "rival")).toEqual([]);
    expect(await loadAdventure(db, "rival", advId)).toBeNull();

    const loaded = await loadAdventure(db, "owner", advId);
    expect(loaded?.graph.links).toHaveLength(2);
  });

  it("a freshly created adventure is an empty draft", async () => {
    const db = createDb(env.DB);
    await seedAccount("owner");
    const created = await createAdventure(db, "owner", { title: "Fresh", maxPlayers: 3 });
    expect(created).toMatchObject({ title: "Fresh", maxPlayers: 3, mapIds: [] });
    expect(created.graph).toEqual({ start: null, links: [] });
  });

  it("validates the graph against the owned maps' markers", async () => {
    const db = createDb(env.DB);
    await seedAccount("owner");
    const advId = await seedAdventure(db, "owner");
    const mapA = await authorMap(db, "owner", advId, mapInput("A", eventsA()));
    const mapB = await authorMap(db, "owner", advId, mapInput("B", eventsB()));

    // B's exit is left unbound (no ending reachable): partial wiring is a valid save now, not refused.
    const partial = await updateAdventure(db, "owner", advId, {
      title: "Donjon",
      maxPlayers: 2,
      graph: {
        start: { mapId: mapA.id, entryId: ENTRY_A },
        links: [{ mapId: mapA.id, exitId: EXIT_A, dest: { mapId: mapB.id, entryId: ENTRY_B } }],
      },
    });
    expect(partial.graph.start).toEqual({ mapId: mapA.id, entryId: ENTRY_A });

    // A graph that names a map the adventure does not own is a foreign reference — refused.
    await expect(
      updateAdventure(db, "owner", advId, {
        title: "Donjon",
        maxPlayers: 2,
        graph: { start: { mapId: "ghostmap", entryId: ENTRY_A }, links: [] },
      }),
    ).rejects.toThrow(/^graph:/);
  });

  it("updates in place and refuses foreign or missing adventures", async () => {
    const db = createDb(env.DB);
    await seedAccount("owner");
    await seedAccount("rival");
    const { advId, mapA, mapB } = await buildAdventure(db, "owner");

    const renamed = await updateAdventure(db, "owner", advId, {
      title: "Renamed",
      maxPlayers: 2,
      graph: corridorGraph(mapA.id, mapB.id),
    });
    expect(renamed.title).toBe("Renamed");

    await expect(
      updateAdventure(db, "rival", advId, {
        title: "Steal",
        maxPlayers: 2,
        graph: corridorGraph(mapA.id, mapB.id),
      }),
    ).rejects.toThrow(/^not_found:/);
    await expect(deleteAdventure(db, "rival", advId)).rejects.toThrow(/^not_found:/);

    await deleteAdventure(db, "owner", advId);
    expect(await loadAdventure(db, "owner", advId)).toBeNull();
    // Deleting the adventure cascades to its maps.
    expect(await loadOwnedMap(db, "owner", mapA.id)).toBeNull();
  });

  it("refuses moving the start while a party still references the adventure (in_use)", async () => {
    const db = createDb(env.DB);
    await seedAccount("owner");
    const { advId, mapA, mapB, adv } = await buildAdventure(db, "owner");
    // A live party pins where its heroes spawn.
    await db.insert(party).values({
      id: "party-in-use",
      adventureId: advId,
      adventureVersion: adv.version,
      maxPlayers: adv.maxPlayers,
      hostAccountId: "owner",
      name: null,
      status: "open",
    });

    // Nulling the start is refused while the party exists.
    await expect(
      updateAdventure(db, "owner", advId, {
        title: "Donjon",
        maxPlayers: 2,
        graph: { start: null, links: [] },
      }),
    ).rejects.toThrow(/^in_use:/);

    // Editing that leaves the start where it is (a rename) is still allowed mid-play.
    const renamed = await updateAdventure(db, "owner", advId, {
      title: "Renamed mid-play",
      maxPlayers: 2,
      graph: corridorGraph(mapA.id, mapB.id),
    });
    expect(renamed.title).toBe("Renamed mid-play");
  });
});

describe("adventure registry", () => {
  it("a freshly created adventure starts with the empty registry", async () => {
    const db = createDb(env.DB);
    await seedAccount("owner");
    const created = await createAdventure(db, "owner", { title: "Reg", maxPlayers: 4 });
    expect(created.registry).toEqual(EMPTY_REGISTRY);
    expect((await loadAdventure(db, "owner", created.id))?.registry).toEqual(EMPTY_REGISTRY);
  });

  it("updateAdventureRegistry validates, persists and round-trips through GET", async () => {
    const db = createDb(env.DB);
    await seedAccount("owner");
    const created = await createAdventure(db, "owner", { title: "Reg", maxPlayers: 4 });

    const registry = {
      switches: [{ id: "0001", name: "Porte ouverte" }],
      variables: [{ id: "0001", name: "Or" }],
    };
    const returned = await updateAdventureRegistry(db, "owner", created.id, registry);
    expect(returned).toEqual(registry);
    expect((await loadAdventure(db, "owner", created.id))?.registry).toEqual(registry);
  });

  it("rejects a malformed registry and leaves the stored one untouched", async () => {
    const db = createDb(env.DB);
    await seedAccount("owner");
    const created = await createAdventure(db, "owner", { title: "Reg", maxPlayers: 4 });
    const registry = { switches: [{ id: "0001", name: "Porte ouverte" }], variables: [] };
    await updateAdventureRegistry(db, "owner", created.id, registry);

    await expect(
      updateAdventureRegistry(db, "owner", created.id, { switches: "nope", variables: [] }),
    ).rejects.toThrow(/^registry:/);
    expect((await loadAdventure(db, "owner", created.id))?.registry).toEqual(registry);
  });

  it("refuses updating a foreign or missing adventure's registry", async () => {
    const db = createDb(env.DB);
    await seedAccount("owner");
    await seedAccount("rival");
    const created = await createAdventure(db, "owner", { title: "Reg", maxPlayers: 4 });

    await expect(updateAdventureRegistry(db, "rival", created.id, EMPTY_REGISTRY)).rejects.toThrow(
      /^not_found:/,
    );
    await expect(updateAdventureRegistry(db, "owner", "ghost-id", EMPTY_REGISTRY)).rejects.toThrow(
      /^not_found:/,
    );
  });

  it("createAdventure persists a registry carried on the input", async () => {
    const db = createDb(env.DB);
    await seedAccount("owner");
    const registry = { switches: [{ id: "0001", name: "Porte" }], variables: [] };
    const created = await createAdventure(db, "owner", {
      title: "Reg",
      maxPlayers: 4,
      registry,
    });
    expect(created.registry).toEqual(registry);
    expect((await loadAdventure(db, "owner", created.id))?.registry).toEqual(registry);
  });

  it("the adventure PUT carries the registry end to end, and omitting it preserves the stored one", async () => {
    const db = createDb(env.DB);
    await seedAccount("owner");
    const { advId, mapA, mapB } = await buildAdventure(db, "owner");

    const registry = {
      switches: [{ id: "0001", name: "Porte" }],
      variables: [{ id: "0001", name: "Or" }],
    };
    await updateAdventure(db, "owner", advId, {
      title: "Donjon",
      maxPlayers: 2,
      graph: corridorGraph(mapA.id, mapB.id),
      registry,
    });
    expect((await loadAdventure(db, "owner", advId))?.registry).toEqual(registry);

    await updateAdventure(db, "owner", advId, {
      title: "Renommé",
      maxPlayers: 2,
      graph: corridorGraph(mapA.id, mapB.id),
    });
    const loaded = await loadAdventure(db, "owner", advId);
    expect(loaded?.title).toBe("Renommé");
    expect(loaded?.registry).toEqual(registry);
  });
});

describe("map deletion guard", () => {
  it("refuses deleting a map the adventure's graph references, frees an unwired one", async () => {
    const db = createDb(env.DB);
    await seedAccount("owner");
    const advId = await seedAdventure(db, "owner", "Donjon");
    const mapA = await authorMap(db, "owner", advId, mapInput("A", eventsA()));
    const mapB = await authorMap(db, "owner", advId, mapInput("B", eventsB()));
    // A spare map with no exits, never wired into the graph: allowed to coexist and to be deleted.
    const spare = await authorMap(db, "owner", advId, {
      ...mapInput("Spare", [ev("cccccccc-0000-4000-8000-000000000001", "entry", 5, 5)]),
    });
    await updateAdventure(db, "owner", advId, {
      title: "Donjon",
      maxPlayers: 2,
      graph: corridorGraph(mapA.id, mapB.id),
    });

    await expect(deleteOwnedMap(db, "owner", mapA.id)).rejects.toThrow(/^referenced:/);
    await deleteOwnedMap(db, "owner", spare.id); // unwired maps still delete
  });
});

describe("map edits after the graph teardown", () => {
  it("no longer guards a plain map edit against the stored graph, and preserves that graph", async () => {
    // The map-save graph-integrity guard only runs when a legacy/test writer explicitly re-seeds the
    // graph. A normal `updateMap` (no `proposedAdventure`) never touches the stored graph now, so an
    // edit that would once have broken a bound reference is accepted — the runtime routing is
    // defensive, and the author has no UI to re-author the graph anyway.
    const db = createDb(env.DB);
    await seedAccount("owner");
    const advId = await seedAdventure(db, "owner", "Donjon");
    const mapA = await authorMap(db, "owner", advId, mapInput("A", eventsA()));
    const mapB = await authorMap(db, "owner", advId, mapInput("B", eventsB()));
    const graph = corridorGraph(mapA.id, mapB.id);
    await updateAdventure(db, "owner", advId, { title: "Donjon", maxPlayers: 2, graph });

    // Removing A's previously-bound exit event is now ACCEPTED (the guard is gone for plain edits).
    const trimmed = await updateMap(
      db,
      "owner",
      mapA.id,
      mapInput("A", [ev(ENTRY_A, "entry", 5, 5)]),
    );
    expect(exitEvents(trimmed.events)).toHaveLength(0);

    // Removing B's entry (A's exit destination) is likewise accepted.
    await updateMap(db, "owner", mapB.id, mapInput("B", [ev(EXIT_B, "exit", 7, 7)]));

    // The stored graph is untouched by those map edits — the runtime still reads it for compat routing.
    const reloaded = await loadAdventure(db, "owner", advId);
    expect(reloaded?.graph).toEqual(graph);

    // Growing the event set still works, and the revision moves monotonically.
    const grown = await updateMap(
      db,
      "owner",
      mapA.id,
      mapInput("A", eventsA([ev(SIDE_A, "entry", 3, 3)])),
    );
    expect(entryEvents(grown.events)).toHaveLength(2);

    // once the adventure is gone, the map is gone too (cascade).
    await deleteAdventure(db, "owner", advId);
    expect(await loadOwnedMap(db, "owner", mapA.id)).toBeNull();
  });
});
