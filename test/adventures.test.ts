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
import { account, createDb, type Db } from "../src/server/db/index.js";
import { deleteMap as deleteOwnedMap, loadOwnedMap, updateMap } from "../src/server/maps.js";
import type { AdventureGraph } from "../src/shared/adventure.js";
import { EMPTY_REGISTRY } from "../src/shared/adventure-state.js";
import { authorMap, seedAdventure } from "./support/adventure-fixtures.js";
import { layeredTerrain } from "./support/map-fixtures.js";

const COLS = 20;
const ROWS = 15;

function blocks(): string[] {
  const rows: string[] = [];
  while (rows.length < ROWS) rows.push(".".repeat(COLS));
  return rows;
}

function mapInput(name: string) {
  return {
    name,
    ...layeredTerrain(blocks()),
    elements: [],
    spawn: { col: 0, row: 0 },
    markers: {
      entries: [{ id: "door", col: 5, row: 5 }],
      exits: [{ id: "gate", col: 7, row: 7 }],
      monsterSpawns: [],
    },
  };
}

async function seedAccount(id: string): Promise<void> {
  await createDb(env.DB)
    .insert(account)
    .values({ id, username: id, passwordHash: "h", passwordSalt: "s", passwordIterations: 1 });
}

/** A two-map corridor: A.gate -> B.door, B.gate -> end. */
function corridorGraph(mapA: string, mapB: string): AdventureGraph {
  return {
    start: { mapId: mapA, entryId: "door" },
    links: [
      { mapId: mapA, exitId: "gate", dest: { mapId: mapB, entryId: "door" } },
      { mapId: mapB, exitId: "gate", dest: "end" },
    ],
  };
}

/** The whole adventure-first flow: draft, author two maps inside it, save the corridor graph. */
async function buildAdventure(db: Db, owner: string) {
  const advId = await seedAdventure(db, owner, "Donjon");
  const mapA = await authorMap(db, owner, advId, mapInput("A"));
  const mapB = await authorMap(db, owner, advId, mapInput("B"));
  const adv = await updateAdventure(db, owner, advId, {
    title: "Donjon",
    maxPlayers: 2,
    graph: corridorGraph(mapA.id, mapB.id),
  });
  return { advId, mapA, mapB, adv };
}

afterEach(async () => {
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
      { id: advId, title: "Donjon", maxPlayers: 2 },
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
    const mapA = await authorMap(db, "owner", advId, mapInput("A"));
    const mapB = await authorMap(db, "owner", advId, mapInput("B"));

    // B's exit is left unbound (no ending reachable) — refused.
    await expect(
      updateAdventure(db, "owner", advId, {
        title: "Donjon",
        maxPlayers: 2,
        graph: {
          start: { mapId: mapA.id, entryId: "door" },
          links: [{ mapId: mapA.id, exitId: "gate", dest: { mapId: mapB.id, entryId: "door" } }],
        },
      }),
    ).rejects.toThrow(/^graph:/);

    // A graph that names a map the adventure does not own is a foreign reference — refused.
    await expect(
      updateAdventure(db, "owner", advId, {
        title: "Donjon",
        maxPlayers: 2,
        graph: { start: { mapId: "ghostmap", entryId: "door" }, links: [] },
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
    const mapA = await authorMap(db, "owner", advId, mapInput("A"));
    const mapB = await authorMap(db, "owner", advId, mapInput("B"));
    // A spare map with no exits, never wired into the graph: allowed to coexist and to be deleted.
    const spare = await authorMap(db, "owner", advId, {
      ...mapInput("Spare"),
      markers: { entries: [{ id: "door", col: 5, row: 5 }], exits: [], monsterSpawns: [] },
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

describe("marker reference guard", () => {
  it("revalidates the owning adventure before accepting a referenced-map update", async () => {
    const db = createDb(env.DB);
    await seedAccount("owner");
    const advId = await seedAdventure(db, "owner", "Donjon");
    const mapA = await authorMap(db, "owner", advId, mapInput("A"));
    const mapB = await authorMap(db, "owner", advId, mapInput("B"));
    await updateAdventure(db, "owner", advId, {
      title: "Donjon",
      maxPlayers: 2,
      graph: corridorGraph(mapA.id, mapB.id),
    });

    // removing A's bound exit "gate" → refused
    await expect(
      updateMap(db, "owner", mapA.id, {
        ...mapInput("A"),
        markers: { entries: [{ id: "door", col: 5, row: 5 }], exits: [], monsterSpawns: [] },
      }),
    ).rejects.toThrow(/^referenced:/);

    // removing B's entry "door" (destination of A's gate) → refused
    await expect(
      updateMap(db, "owner", mapB.id, {
        ...mapInput("B"),
        markers: { entries: [], exits: [{ id: "gate", col: 7, row: 7 }], monsterSpawns: [] },
      }),
    ).rejects.toThrow(/^referenced:/);

    // adding a marker while keeping the bound ones → allowed
    const grown = await updateMap(db, "owner", mapA.id, {
      ...mapInput("A"),
      markers: {
        entries: [
          { id: "door", col: 5, row: 5 },
          { id: "side", col: 3, row: 3 },
        ],
        exits: [{ id: "gate", col: 7, row: 7 }],
        monsterSpawns: [],
      },
    });
    expect(grown.markers?.entries).toHaveLength(2);

    // A new unbound exit would break the saved graph, so the map change is refused and its monotone
    // revision does not move.
    await expect(
      updateMap(db, "owner", mapA.id, {
        ...mapInput("A"),
        markers: {
          entries: [
            { id: "door", col: 5, row: 5 },
            { id: "side", col: 3, row: 3 },
          ],
          exits: [
            { id: "gate", col: 7, row: 7 },
            { id: "unbound", col: 9, row: 9 },
          ],
          monsterSpawns: [],
        },
      }),
    ).rejects.toThrow(/^referenced:.*unbound/);
    expect((await loadOwnedMap(db, "owner", mapA.id))?.revision).toBe(grown.revision);

    // once the adventure is gone, the map is gone too (cascade), so there is nothing left to guard.
    await deleteAdventure(db, "owner", advId);
    expect(await loadOwnedMap(db, "owner", mapA.id)).toBeNull();
  });
});
