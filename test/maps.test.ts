import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { account, createDb, type Db } from "../src/server/db/index.js";
import {
  BUILTIN_MAP_ID,
  createMap as createOwnedMap,
  deleteMap as deleteOwnedMap,
  firstMap as firstOwnedMap,
  listMaps as listOwnedMaps,
  loadMap,
  type MapInput,
  resolveMapFor as resolveOwnedMapFor,
  setFirstMap as setOwnedFirstMap,
  updateMap as updateOwnedMap,
} from "../src/server/maps.js";
import { MAX_MAP_ELEMENTS } from "../src/shared/map-data.js";

// Exactly the size floor (20x15): small enough to read at a glance, big enough to clear the caps.
// A one-cell water pocket at (1,1)/(2,1) stands in for "the sea" below; everything else is grass.
const MAP_COLS = 20;
const MAP_ROWS = 15;
const TREE = "resource.terrain-resources-wood-trees.tree3" as const;
const TREE_ALT = "resource.terrain-resources-wood-trees.tree4" as const;
const BUSH = "decoration.terrain-decorations-bushes.bushe1" as const;
const STONE = "decoration.terrain-decorations-rocks.rock1" as const;
const STONE_ALT = "decoration.terrain-decorations-rocks.rock2" as const;
const CASTLE = "building.buildings-blue-buildings.castle" as const;
const OWNER = "maps-owner";

const createMap = (db: Db, input: MapInput) => createOwnedMap(db, OWNER, input);
const deleteMap = (db: Db, id: string) => deleteOwnedMap(db, OWNER, id);
const firstMap = (db: Db) => firstOwnedMap(db, OWNER);
const listMaps = (db: Db) => listOwnedMaps(db, OWNER);
const resolveMapFor = (db: Db, zoneId: string) => resolveOwnedMapFor(db, OWNER, zoneId);
const setFirstMap = (db: Db, id: string) => setOwnedFirstMap(db, OWNER, id);
const updateMap = (db: Db, id: string, input: MapInput) => updateOwnedMap(db, OWNER, id, input);
function validBlocks(): string[] {
  const blocks = [".".repeat(MAP_COLS), `.##${".".repeat(MAP_COLS - 3)}`];
  while (blocks.length < MAP_ROWS) blocks.push(".".repeat(MAP_COLS));
  return blocks;
}

const validInput: MapInput = {
  name: "Valid",
  blocks: validBlocks(),
  elements: [],
  spawn: { col: 0, row: 0 },
};

function inputNamed(name: string): MapInput {
  return { ...validInput, name };
}

describe("maps", () => {
  beforeEach(async () => {
    await createDb(env.DB).insert(account).values({
      id: OWNER,
      username: OWNER,
      passwordHash: "h",
      passwordSalt: "s",
      passwordIterations: 1,
    });
  });

  // The pool does not isolate storage between tests. Elements before maps (FK).
  afterEach(async () => {
    await env.DB.exec("DELETE FROM map_element");
    await env.DB.exec("DELETE FROM map");
    await env.DB.exec("DELETE FROM account");
  });

  describe("the floor", () => {
    it("falls back to the built-in when the database has no maps at all", async () => {
      const resolved = await resolveMapFor(createDb(env.DB), "anything");
      expect(resolved.id).toBe(BUILTIN_MAP_ID);
      // The floor must itself be enterable, or it is not a floor.
      expect(resolved.spawn).toEqual({ col: 2, row: 2 });
    });

    it("refuses to delete the last map", async () => {
      const db = createDb(env.DB);
      const only = await createMap(db, validInput);
      await expect(deleteMap(db, only.id)).rejects.toThrow(/last_map/);
      expect(await loadMap(db, only.id)).not.toBe(null);
    });

    it("never lists the built-in — it is not a map you can edit", async () => {
      const db = createDb(env.DB);
      await createMap(db, validInput);
      const listed = await listMaps(db);
      expect(listed.map((entry) => entry.id)).not.toContain(BUILTIN_MAP_ID);
    });
  });

  describe("the front door", () => {
    it("gives the flag to the very first map", async () => {
      const db = createDb(env.DB);
      const one = await createMap(db, validInput);
      expect((await firstMap(db))?.id).toBe(one.id);
    });

    it("does not move the flag when a later map is added", async () => {
      const db = createDb(env.DB);
      const one = await createMap(db, validInput);
      await createMap(db, { ...validInput, name: "Second" });
      expect((await firstMap(db))?.id).toBe(one.id);
    });

    it("hands the flag to a survivor when the flagged map is deleted", async () => {
      const db = createDb(env.DB);
      const one = await createMap(db, validInput);
      const two = await createMap(db, { ...validInput, name: "Second" });
      await deleteMap(db, one.id);
      expect((await firstMap(db))?.id).toBe(two.id);
    });

    it("sends a hero whose map is gone to the front door", async () => {
      const db = createDb(env.DB);
      const one = await createMap(db, validInput);
      const resolved = await resolveMapFor(db, "a-map-that-was-deleted");
      expect(resolved.id).toBe(one.id);
    });

    it("leaves a hero on their own map when it still exists", async () => {
      const db = createDb(env.DB);
      await createMap(db, validInput);
      const mine = await createMap(db, { ...validInput, name: "Mine" });
      expect((await resolveMapFor(db, mine.id)).id).toBe(mine.id);
    });

    it("moves the first-map flag on demand", async () => {
      const db = createDb(env.DB);
      await createMap(db, inputNamed("A")); // auto-flagged
      const b = await createMap(db, inputNamed("B"));
      await setFirstMap(db, b.id);
      const listed = await listMaps(db);
      expect(listed.find((m) => m.id === b.id)?.isFirst).toBe(true);
      expect(listed.filter((m) => m.isFirst)).toHaveLength(1);
    });

    it("keeps exactly one flag when flagging the map that already has it", async () => {
      const db = createDb(env.DB);
      const one = await createMap(db, inputNamed("One")); // auto-flagged
      await createMap(db, inputNamed("Two"));
      await setFirstMap(db, one.id);
      const listed = await listMaps(db);
      expect(listed.find((m) => m.id === one.id)?.isFirst).toBe(true);
      expect(listed.filter((m) => m.isFirst)).toHaveLength(1);
    });

    it("refuses to flag a map that does not exist", async () => {
      const db = createDb(env.DB);
      await expect(setFirstMap(db, "nope")).rejects.toThrow(/^not_found:/);
    });
  });

  describe("input caps", () => {
    it("refuses maps outside the size caps", async () => {
      const db = createDb(env.DB);
      const tiny = { ...validInput, blocks: Array.from({ length: 5 }, () => ".".repeat(5)) };
      await expect(createMap(db, tiny)).rejects.toThrow(/^size:/);
      const huge = { ...validInput, blocks: Array.from({ length: 101 }, () => ".".repeat(101)) };
      await expect(createMap(db, huge)).rejects.toThrow(/^size:/);
    });

    it("refuses a blank or oversized name", async () => {
      const db = createDb(env.DB);
      await expect(createMap(db, { ...validInput, name: "  " })).rejects.toThrow(/^name:/);
      await expect(createMap(db, { ...validInput, name: "x".repeat(49) })).rejects.toThrow(
        /^name:/,
      );
    });

    it("stores a padded name trimmed", async () => {
      const db = createDb(env.DB);
      const created = await createMap(db, { ...validInput, name: "  Padded  " });
      expect(created.name).toBe("Padded");
      expect((await loadMap(db, created.id))?.name).toBe("Padded");
    });

    it("refuses more elements than the element cap", async () => {
      const db = createDb(env.DB);
      // In-bounds so the cap — not bounds or placement — is what fires. Checked before the DB ever
      // sees them, so a body that would 413 with no message becomes a clean `elements:` instead.
      const tooMany = Array.from({ length: MAX_MAP_ELEMENTS + 1 }, (_, i) => ({
        col: i % MAP_COLS,
        row: i % MAP_ROWS,
        assetId: BUSH,
      }));
      await expect(createMap(db, { ...validInput, elements: tooMany })).rejects.toThrow(
        /^elements:/,
      );
    });
  });

  describe("placement is enforced on write, not in the browser", () => {
    it("refuses a tree in the sea", async () => {
      const db = createDb(env.DB);
      await expect(
        createMap(db, { ...validInput, elements: [{ col: 1, row: 1, assetId: TREE }] }),
      ).rejects.toThrow(/placement/);
    });

    it("accepts a stone in the shallows", async () => {
      const db = createDb(env.DB);
      const ok = await createMap(db, {
        ...validInput,
        elements: [{ col: 1, row: 1, assetId: STONE }],
      });
      expect(ok.elements).toHaveLength(1);
    });

    it("refuses a spawn nobody could stand on", async () => {
      const db = createDb(env.DB);
      // In the water...
      await expect(createMap(db, { ...validInput, spawn: { col: 1, row: 1 } })).rejects.toThrow(
        /spawn/,
      );
      // ...and inside a tree, which loads fine and is just as unplayable.
      await expect(
        createMap(db, {
          ...validInput,
          elements: [{ col: 3, row: 3, assetId: TREE }],
          spawn: { col: 3, row: 3 },
        }),
      ).rejects.toThrow(/spawn/);
    });

    it("refuses scenery covering the spawn even when it does not collide", async () => {
      const db = createDb(env.DB);
      await expect(
        createMap(db, {
          ...validInput,
          elements: [{ col: 3, row: 3, assetId: BUSH }],
          spawn: { col: 3, row: 3 },
        }),
      ).rejects.toThrow(/spawn/);
    });

    it("refuses an unknown or non-editor catalogue asset", async () => {
      const db = createDb(env.DB);
      await expect(
        createMap(db, {
          ...validInput,
          elements: [{ col: 4, row: 4, assetId: "ui.cursor.default" as never }],
        }),
      ).rejects.toThrow(/unknown asset/);
    });

    it("refuses a multi-cell building that exceeds the map", async () => {
      const db = createDb(env.DB);
      await expect(
        createMap(db, {
          ...validInput,
          elements: [{ col: MAP_COLS - 1, row: MAP_ROWS - 1, assetId: CASTLE }],
        }),
      ).rejects.toThrow(/bounds/);
    });

    it("refuses overlapping visual footprints", async () => {
      const db = createDb(env.DB);
      await expect(
        createMap(db, {
          ...validInput,
          elements: [
            { col: 4, row: 4, assetId: STONE },
            { col: 4, row: 4, assetId: STONE_ALT },
          ],
        }),
      ).rejects.toThrow(/overlaps/);
    });
  });

  describe("round-tripping", () => {
    it("reads back exactly what was written", async () => {
      const db = createDb(env.DB);
      const created = await createMap(db, {
        ...validInput,
        // Clear of the spawn at (0,0) — a tree standing on it is refused, and rightly so.
        elements: [
          { col: 4, row: 3, assetId: TREE_ALT },
          { col: 1, row: 1, assetId: STONE_ALT },
        ],
      });
      const loaded = await loadMap(db, created.id);
      expect(loaded?.blocks).toEqual(validInput.blocks);
      expect(loaded?.spawn).toEqual(validInput.spawn);
      expect(loaded?.elements).toHaveLength(2);
      expect(loaded?.elements.find((e) => e.assetId === TREE_ALT)?.assetId).toBe(TREE_ALT);
    });

    it("replaces elements wholesale on update", async () => {
      const db = createDb(env.DB);
      const created = await createMap(db, {
        ...validInput,
        elements: [{ col: 4, row: 3, assetId: TREE }],
      });
      await updateMap(db, created.id, {
        ...validInput,
        name: "Renamed",
        elements: [{ col: 3, row: 3, assetId: BUSH }],
      });
      const loaded = await loadMap(db, created.id);
      expect(loaded?.name).toBe("Renamed");
      expect(loaded?.elements).toEqual([{ col: 3, row: 3, assetId: BUSH }]);
    });

    it("converts a legacy row only as part of a successful whole-map update", async () => {
      const db = createDb(env.DB);
      const created = await createMap(db, validInput);
      await env.DB.prepare(
        "INSERT INTO map_element (map_id, col, row, kind, variant) VALUES (?, 4, 3, 'tree', 1)",
      )
        .bind(created.id)
        .run();

      const loaded = await loadMap(db, created.id);
      expect(loaded?.elements).toEqual([{ col: 4, row: 3, assetId: TREE_ALT }]);
      if (!loaded) throw new Error("legacy map missing");

      await expect(updateMap(db, created.id, { ...loaded, name: "" })).rejects.toThrow(/^name:/);
      const untouched = await env.DB.prepare(
        "SELECT kind FROM map_element WHERE map_id = ? AND col = 4 AND row = 3",
      )
        .bind(created.id)
        .first<{ kind: string }>();
      expect(untouched?.kind).toBe("tree");

      await updateMap(db, created.id, { ...loaded, name: "Converted" });
      const converted = await env.DB.prepare(
        "SELECT kind FROM map_element WHERE map_id = ? AND col = 4 AND row = 3",
      )
        .bind(created.id)
        .first<{ kind: string }>();
      expect(converted?.kind).toBe(TREE_ALT);
    });
  });

  // The persistence invariants must survive two writers at once, not just a lone caller. With the old
  // check-then-act code these interleave at their await points and both win; the guarded batches
  // resolve the race in the database. The pool interleaves the two flows (each `await` yields), so the
  // race is real here, not merely proven by construction.
  describe("concurrency", () => {
    it("flags exactly one front door when maps are created concurrently on an empty database", async () => {
      const db = createDb(env.DB);
      await Promise.all([
        createMap(db, inputNamed("A")),
        createMap(db, inputNamed("B")),
        createMap(db, inputNamed("C")),
      ]);
      const listed = await listMaps(db);
      expect(listed).toHaveLength(3);
      expect(listed.filter((m) => m.isFirst)).toHaveLength(1);
    });

    it("keeps exactly one flagged map when the last two are deleted concurrently", async () => {
      const db = createDb(env.DB);
      const a = await createMap(db, inputNamed("A")); // auto-flagged
      const b = await createMap(db, inputNamed("B"));
      const outcomes = await Promise.allSettled([deleteMap(db, a.id), deleteMap(db, b.id)]);

      // Exactly one delete is refused, and it is refused with last_map — not left to zero the world.
      const rejected = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected");
      expect(rejected).toHaveLength(1);
      expect(String(rejected[0]?.reason)).toMatch(/last_map/);

      const listed = await listMaps(db);
      expect(listed).toHaveLength(1);
      expect(listed.filter((m) => m.isFirst)).toHaveLength(1);
    });
  });
});
