/**
 * Maps are stored as three tile layers, not a block grid.
 *
 * The round-trip is the load-bearing one: the layer ids that came out of D1 must be the ids that
 * went in, id for id. Anything weaker — a length check, a "not null" — would still pass if
 * `decodeLayers` quietly minted empty layers on every load, which is exactly the failure the
 * column's degrade-to-empty policy can hide.
 */
import { env } from "cloudflare:test";
import { layersFromBlocks } from "@lindocara/engine/map-migrate.js";
import { TINY_SWORDS_TILESET_ID } from "@lindocara/engine/tilesets/tiny-swords.js";
import { createAccount } from "@lindocara/server/accounts.js";
import { createDb } from "@lindocara/server/db/index.js";
import { loadMap, updateMap, validateMapInput } from "@lindocara/server/maps.js";
import { afterEach, describe, expect, it } from "vitest";
import { authorMap, seedAdventure } from "./adventure-fixtures.js";

// The size floor (20x15), with a solid water border so the ground layer is not uniformly one id —
// a run-length round-trip over a single run would pass even if the runs were rebuilt wrongly.
const BLOCKS = [
  "####################",
  ...Array.from({ length: 13 }, () => "#..................#"),
  "####################",
];

function input(name: string) {
  const migrated = layersFromBlocks(BLOCKS);
  return {
    name,
    tilesetId: TINY_SWORDS_TILESET_ID,
    cols: migrated.cols,
    rows: migrated.rows,
    layers: migrated.layers,
    elements: [],
    spawn: { col: 2, row: 2 },
  };
}

async function owner(username: string): Promise<string> {
  const account = await createAccount(createDb(env.DB), username, "correct horse battery");
  if (account === "username_taken") throw new Error("unexpected username collision");
  return account.id;
}

describe("maps stored as layers", () => {
  // The pool does not isolate storage between tests. Children before parents.
  afterEach(async () => {
    await env.DB.exec("DELETE FROM map_element");
    await env.DB.exec("DELETE FROM map");
    await env.DB.exec("DELETE FROM account");
  });

  it("round-trips layers through D1", async () => {
    const db = createDb(env.DB);
    const accountId = await owner("layers-owner");
    const adventureId = await seedAdventure(db, accountId);
    const created = await authorMap(db, accountId, adventureId, input("Riverwood"));
    const loaded = await loadMap(db, created.id);

    expect(loaded?.tilesetId).toBe(TINY_SWORDS_TILESET_ID);
    expect(loaded?.cols).toBe(20);
    expect(loaded?.rows).toBe(15);
    expect(loaded?.layers).toHaveLength(3);
    // Id for id, on every layer — not a length or a truthiness check.
    expect(loaded?.layers.map((layer) => layer.ids)).toEqual(
      created.layers.map((layer) => layer.ids),
    );
    // And the ground is genuinely the migrated terrain, not a blank layer that happens to be the
    // right size: the border cells are empty and the interior is not.
    const ground = loaded?.layers[0];
    expect(ground?.ids[0]).toBe(0);
    expect(ground?.ids[1 * 20 + 1]).not.toBe(0);
  });

  it("bumps the revision on a successful update", async () => {
    const db = createDb(env.DB);
    const accountId = await owner("layers-rev");
    const adventureId = await seedAdventure(db, accountId);
    const created = await authorMap(db, accountId, adventureId, input("Riverwood"));
    const updated = await updateMap(db, accountId, created.id, input("Riverwood II"));
    expect(updated.revision).toBe(created.revision + 1);
  });

  it("refuses a spawn on a cell no hero can stand on", () => {
    expect(() => validateMapInput({ ...input("Bad"), spawn: { col: 0, row: 0 } })).toThrow(/spawn/);
  });

  it("refuses a layer count that is not three", () => {
    const bad = input("Bad");
    expect(() => validateMapInput({ ...bad, layers: bad.layers.slice(0, 2) })).toThrow(/layers/);
  });

  it("refuses a layer whose size disagrees with the map's", () => {
    const bad = input("Bad");
    const shrunk = { cols: 19, rows: 15, ids: new Array<number>(19 * 15).fill(0) };
    expect(() => validateMapInput({ ...bad, layers: [shrunk, shrunk, shrunk] })).toThrow(/layers/);
  });

  it("refuses a layer whose declared cols x rows disagree with its actual ids count", () => {
    // `cols`/`rows` match the map — the check above would let this through — but `ids` is one
    // cell short. Sliced from a real, working layer (not a fresh all-zero array) so a decode that
    // silently treats the missing tail as EMPTY_TILE cannot accidentally still leave the map
    // playable and hide the bug.
    const bad = input("Bad");
    const [ground, elevation, objects] = bad.layers;
    if (!ground || !elevation || !objects) throw new Error("expected three layers");
    const truncated = { cols: ground.cols, rows: ground.rows, ids: ground.ids.slice(0, -1) };
    expect(() => validateMapInput({ ...bad, layers: [truncated, elevation, objects] })).toThrow(
      /layers/,
    );
  });

  it("refuses an unknown tileset", () => {
    expect(() => validateMapInput({ ...input("Bad"), tilesetId: "not-a-tileset" })).toThrow(
      /tileset/,
    );
  });
});
