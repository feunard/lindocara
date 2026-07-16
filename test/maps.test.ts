import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { createDb } from "../src/server/db/index.js";
import {
  BUILTIN_MAP_ID,
  createMap,
  deleteMap,
  firstMap,
  listMaps,
  loadMap,
  type MapInput,
  resolveMapFor,
  setFirstMap,
  updateMap,
} from "../src/server/maps.js";

// Exactly the size floor (20x15): small enough to read at a glance, big enough to clear the caps.
// A one-cell water pocket at (1,1)/(2,1) stands in for "the sea" below; everything else is grass.
const MAP_COLS = 20;
const MAP_ROWS = 15;
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
  // The pool does not isolate storage between tests. Elements before maps (FK).
  afterEach(async () => {
    await env.DB.exec("DELETE FROM map_element");
    await env.DB.exec("DELETE FROM map");
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
  });

  describe("placement is enforced on write, not in the browser", () => {
    it("refuses a tree in the sea", async () => {
      const db = createDb(env.DB);
      await expect(
        createMap(db, { ...validInput, elements: [{ col: 1, row: 1, kind: "tree", variant: 0 }] }),
      ).rejects.toThrow(/placement/);
    });

    it("accepts a stone in the shallows", async () => {
      const db = createDb(env.DB);
      const ok = await createMap(db, {
        ...validInput,
        elements: [{ col: 1, row: 1, kind: "stone", variant: 0 }],
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
          elements: [{ col: 0, row: 0, kind: "tree", variant: 0 }],
          spawn: { col: 0, row: 0 },
        }),
      ).rejects.toThrow(/spawn/);
    });

    it("lets a hero spawn on a bush, which does not collide", async () => {
      const db = createDb(env.DB);
      const ok = await createMap(db, {
        ...validInput,
        elements: [{ col: 0, row: 0, kind: "bush", variant: 0 }],
        spawn: { col: 0, row: 0 },
      });
      expect(ok.id).toBeTruthy();
    });
  });

  describe("round-tripping", () => {
    it("reads back exactly what was written", async () => {
      const db = createDb(env.DB);
      const created = await createMap(db, {
        ...validInput,
        // Clear of the spawn at (0,0) — a tree standing on it is refused, and rightly so.
        elements: [
          { col: 2, row: 0, kind: "tree", variant: 2 },
          { col: 1, row: 1, kind: "stone", variant: 1 },
        ],
      });
      const loaded = await loadMap(db, created.id);
      expect(loaded?.blocks).toEqual(validInput.blocks);
      expect(loaded?.spawn).toEqual(validInput.spawn);
      expect(loaded?.elements).toHaveLength(2);
      expect(loaded?.elements.find((e) => e.kind === "tree")?.variant).toBe(2);
    });

    it("replaces elements wholesale on update", async () => {
      const db = createDb(env.DB);
      const created = await createMap(db, {
        ...validInput,
        elements: [{ col: 2, row: 0, kind: "tree", variant: 0 }],
      });
      await updateMap(db, created.id, {
        ...validInput,
        name: "Renamed",
        elements: [{ col: 3, row: 3, kind: "bush", variant: 0 }],
      });
      const loaded = await loadMap(db, created.id);
      expect(loaded?.name).toBe("Renamed");
      expect(loaded?.elements).toEqual([{ col: 3, row: 3, kind: "bush", variant: 0 }]);
    });
  });
});
