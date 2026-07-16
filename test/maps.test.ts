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
  updateMap,
} from "../src/server/maps.js";

const SMALL: MapInput = {
  name: "Small",
  blocks: ["....", ".##.", "....", "...."],
  elements: [],
  spawn: { col: 0, row: 0 },
};

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
      const only = await createMap(db, SMALL);
      await expect(deleteMap(db, only.id)).rejects.toThrow(/last_map/);
      expect(await loadMap(db, only.id)).not.toBe(null);
    });

    it("never lists the built-in — it is not a map you can edit", async () => {
      const db = createDb(env.DB);
      await createMap(db, SMALL);
      const listed = await listMaps(db);
      expect(listed.map((entry) => entry.id)).not.toContain(BUILTIN_MAP_ID);
    });
  });

  describe("the front door", () => {
    it("gives the flag to the very first map", async () => {
      const db = createDb(env.DB);
      const one = await createMap(db, SMALL);
      expect((await firstMap(db))?.id).toBe(one.id);
    });

    it("does not move the flag when a later map is added", async () => {
      const db = createDb(env.DB);
      const one = await createMap(db, SMALL);
      await createMap(db, { ...SMALL, name: "Second" });
      expect((await firstMap(db))?.id).toBe(one.id);
    });

    it("hands the flag to a survivor when the flagged map is deleted", async () => {
      const db = createDb(env.DB);
      const one = await createMap(db, SMALL);
      const two = await createMap(db, { ...SMALL, name: "Second" });
      await deleteMap(db, one.id);
      expect((await firstMap(db))?.id).toBe(two.id);
    });

    it("sends a hero whose map is gone to the front door", async () => {
      const db = createDb(env.DB);
      const one = await createMap(db, SMALL);
      const resolved = await resolveMapFor(db, "a-map-that-was-deleted");
      expect(resolved.id).toBe(one.id);
    });

    it("leaves a hero on their own map when it still exists", async () => {
      const db = createDb(env.DB);
      await createMap(db, SMALL);
      const mine = await createMap(db, { ...SMALL, name: "Mine" });
      expect((await resolveMapFor(db, mine.id)).id).toBe(mine.id);
    });
  });

  describe("placement is enforced on write, not in the browser", () => {
    it("refuses a tree in the sea", async () => {
      const db = createDb(env.DB);
      await expect(
        createMap(db, { ...SMALL, elements: [{ col: 1, row: 1, kind: "tree", variant: 0 }] }),
      ).rejects.toThrow(/placement/);
    });

    it("accepts a stone in the shallows", async () => {
      const db = createDb(env.DB);
      const ok = await createMap(db, {
        ...SMALL,
        elements: [{ col: 1, row: 1, kind: "stone", variant: 0 }],
      });
      expect(ok.elements).toHaveLength(1);
    });

    it("refuses a spawn nobody could stand on", async () => {
      const db = createDb(env.DB);
      // In the water...
      await expect(createMap(db, { ...SMALL, spawn: { col: 1, row: 1 } })).rejects.toThrow(/spawn/);
      // ...and inside a tree, which loads fine and is just as unplayable.
      await expect(
        createMap(db, {
          ...SMALL,
          elements: [{ col: 0, row: 0, kind: "tree", variant: 0 }],
          spawn: { col: 0, row: 0 },
        }),
      ).rejects.toThrow(/spawn/);
    });

    it("lets a hero spawn on a bush, which does not collide", async () => {
      const db = createDb(env.DB);
      const ok = await createMap(db, {
        ...SMALL,
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
        ...SMALL,
        // Clear of the spawn at (0,0) — a tree standing on it is refused, and rightly so.
        elements: [
          { col: 2, row: 0, kind: "tree", variant: 2 },
          { col: 1, row: 1, kind: "stone", variant: 1 },
        ],
      });
      const loaded = await loadMap(db, created.id);
      expect(loaded?.blocks).toEqual(SMALL.blocks);
      expect(loaded?.spawn).toEqual(SMALL.spawn);
      expect(loaded?.elements).toHaveLength(2);
      expect(loaded?.elements.find((e) => e.kind === "tree")?.variant).toBe(2);
    });

    it("replaces elements wholesale on update", async () => {
      const db = createDb(env.DB);
      const created = await createMap(db, {
        ...SMALL,
        elements: [{ col: 2, row: 0, kind: "tree", variant: 0 }],
      });
      await updateMap(db, created.id, {
        ...SMALL,
        name: "Renamed",
        elements: [{ col: 3, row: 3, kind: "bush", variant: 0 }],
      });
      const loaded = await loadMap(db, created.id);
      expect(loaded?.name).toBe("Renamed");
      expect(loaded?.elements).toEqual([{ col: 3, row: 3, kind: "bush", variant: 0 }]);
    });
  });
});
