/**
 * The adventures boundary: ownership-scoped CRUD, graph validation against member-map markers,
 * and membership rows kept in step. Same truncation discipline as db.test.ts (children first).
 */
import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import {
  createAdventure,
  deleteAdventure,
  listAdventures,
  loadAdventure,
  updateAdventure,
} from "../src/server/adventures.js";
import { account, createDb } from "../src/server/db/index.js";
import { createMap, type MapInput } from "../src/server/maps.js";
import type { AdventureInput } from "../src/shared/adventure.js";

const COLS = 20;
const ROWS = 15;

function blocks(): string[] {
  const rows: string[] = [];
  while (rows.length < ROWS) rows.push(".".repeat(COLS));
  return rows;
}

function mapInput(name: string): MapInput {
  return {
    name,
    blocks: blocks(),
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

function inputFor(mapIds: string[]): AdventureInput {
  const [a, b] = mapIds;
  if (!a || !b) throw new Error("expected two maps");
  return {
    title: "Donjon",
    maxPlayers: 2,
    mapIds,
    graph: {
      start: { mapId: a, entryId: "door" },
      links: [
        { mapId: a, exitId: "gate", dest: { mapId: b, entryId: "door" } },
        { mapId: b, exitId: "gate", dest: "end" },
      ],
    },
  };
}

afterEach(async () => {
  await env.DB.exec("DELETE FROM adventure_map");
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
    const mapA = await createMap(db, mapInput("A"));
    const mapB = await createMap(db, mapInput("B"));

    const created = await createAdventure(db, "owner", inputFor([mapA.id, mapB.id]));
    expect(created).toMatchObject({
      accountId: "owner",
      title: "Donjon",
      maxPlayers: 2,
      version: 1,
    });
    expect(created.mapIds).toEqual([mapA.id, mapB.id]);

    expect(await listAdventures(db, "owner")).toEqual([
      { id: created.id, title: "Donjon", maxPlayers: 2 },
    ]);
    expect(await listAdventures(db, "rival")).toEqual([]);
    expect(await loadAdventure(db, "rival", created.id)).toBeNull();

    const loaded = await loadAdventure(db, "owner", created.id);
    expect(loaded?.graph.links).toHaveLength(2);
  });

  it("validates the graph against the member maps' markers", async () => {
    const db = createDb(env.DB);
    await seedAccount("owner");
    const mapA = await createMap(db, mapInput("A"));
    const mapB = await createMap(db, mapInput("B"));
    const bad = inputFor([mapA.id, mapB.id]);
    bad.graph = { ...bad.graph, links: [bad.graph.links[0] as never] };
    await expect(createAdventure(db, "owner", bad)).rejects.toThrow(/^graph:/);
    await expect(
      createAdventure(db, "owner", { ...inputFor([mapA.id, mapB.id]), mapIds: [mapA.id, "ghost"] }),
    ).rejects.toThrow(/^maps:/);
  });

  it("updates in place and refuses foreign or missing adventures", async () => {
    const db = createDb(env.DB);
    await seedAccount("owner");
    await seedAccount("rival");
    const mapA = await createMap(db, mapInput("A"));
    const mapB = await createMap(db, mapInput("B"));
    const created = await createAdventure(db, "owner", inputFor([mapA.id, mapB.id]));

    const renamed = await updateAdventure(db, "owner", created.id, {
      ...inputFor([mapA.id, mapB.id]),
      title: "Renamed",
    });
    expect(renamed.title).toBe("Renamed");

    await expect(
      updateAdventure(db, "rival", created.id, inputFor([mapA.id, mapB.id])),
    ).rejects.toThrow(/^not_found:/);
    await expect(deleteAdventure(db, "rival", created.id)).rejects.toThrow(/^not_found:/);

    await deleteAdventure(db, "owner", created.id);
    expect(await loadAdventure(db, "owner", created.id)).toBeNull();
  });
});
