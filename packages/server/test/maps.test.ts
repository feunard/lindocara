import { env } from "cloudflare:test";
import {
  createAuthoredQuestDefinition,
  createManualQuestObjective,
} from "@lindocara/engine/adventure-state.js";
import { MAX_MAP_ELEMENTS, type MapElement } from "@lindocara/engine/map-data.js";
import {
  MAX_EVENTS_PER_MAP,
  MAX_PAGES_PER_EVENT,
  type MapEvent,
  type MapEventPage,
} from "@lindocara/engine/map-events.js";
import { fixedId } from "@lindocara/engine/tileset.js";
import { loadAdventure } from "@lindocara/server/adventures.js";
import { account, createDb, type Db } from "@lindocara/server/db/index.js";
import {
  BUILTIN_MAP_ID,
  deleteMap as deleteOwnedMap,
  firstMap as firstOwnedMap,
  listMapsForAdventure as listOwnedMaps,
  loadMap,
  type MapInput,
  resolveMapFor as resolveOwnedMapFor,
  setFirstMap as setOwnedFirstMap,
  updateMap as updateOwnedMap,
} from "@lindocara/server/maps.js";
import { layeredTerrain } from "@lindocara/testing/map-fixtures.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authorMap, seedAdventure } from "./adventure-fixtures.js";

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

// A map now belongs to one adventure (UX wave #5), created as a template then authored. `createMap`
// here means "author a map in the test's adventure": that keeps every existing assertion — a bad
// input still throws from the authoring `updateMap`, with the same `size:`/`name:`/… codes.
let adventureId = "";

const createMap = (db: Db, input: MapInput) => authorMap(db, OWNER, adventureId, input);
const deleteMap = (db: Db, id: string) => deleteOwnedMap(db, id);
const firstMap = (db: Db) => firstOwnedMap(db, OWNER);
const listMaps = (db: Db) => listOwnedMaps(db, adventureId);
const resolveMapFor = (db: Db, zoneId: string) => resolveOwnedMapFor(db, OWNER, zoneId);
const setFirstMap = (db: Db, id: string) => setOwnedFirstMap(db, id);
const updateMap = (db: Db, id: string, input: MapInput) => updateOwnedMap(db, id, input);
function validBlocks(): string[] {
  const blocks = [".".repeat(MAP_COLS), `.##${".".repeat(MAP_COLS - 3)}`];
  while (blocks.length < MAP_ROWS) blocks.push(".".repeat(MAP_COLS));
  return blocks;
}

const validInput: MapInput = {
  name: "Valid",
  ...layeredTerrain(validBlocks()),
  elements: [],
  spawn: { col: 0, row: 0 },
};

function inputNamed(name: string): MapInput {
  return { ...validInput, name };
}

/** A grid of single-cell rocks big enough to blow past D1's 100-bound-parameter cap on a single
 *  `INSERT` (roughly 20 rows at 5 params each) — up to `MAX_MAP_ELEMENTS`, every cell distinct so
 *  none overlap, all grass so `rock1`'s `allowedTerrain` accepts every cell, and never the spawn. */
function rockGrid(count: number, spawn: { col: number; row: number }): MapElement[] {
  const cols = 20;
  const elements: MapElement[] = [];
  for (let row = 0; elements.length < count; row++) {
    for (let col = 0; col < cols && elements.length < count; col++) {
      if (col === spawn.col && row === spawn.row) continue;
      elements.push({ col, row, offsetX: 0, offsetY: 0, assetId: STONE });
    }
  }
  return elements;
}

function rockGridBlocks(elementCount: number, cols = 20): string[] {
  const rows = Math.ceil((elementCount + 1) / cols) + 1; // +1 spawn cell, +1 row of headroom
  return Array.from({ length: Math.max(rows, MAP_ROWS) }, () => ".".repeat(cols));
}

describe("maps", () => {
  beforeEach(async () => {
    const db = createDb(env.DB);
    await db.insert(account).values({
      id: OWNER,
      username: OWNER,
      passwordHash: "h",
      passwordSalt: "s",
      passwordIterations: 1,
    });
    adventureId = await seedAdventure(db, OWNER);
  });

  // The pool does not isolate storage between tests. Children before parents (FK).
  afterEach(async () => {
    await env.DB.exec("DELETE FROM map_element");
    await env.DB.exec("DELETE FROM map");
    await env.DB.exec("DELETE FROM adventure");
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

    it("refuses the last map of one adventure even when the account owns other maps", async () => {
      const db = createDb(env.DB);
      const only = await createMap(db, validInput);
      const secondAdventure = await seedAdventure(db, OWNER, "Second adventure");
      await authorMap(db, OWNER, secondAdventure, inputNamed("Elsewhere A"));
      await authorMap(db, OWNER, secondAdventure, inputNamed("Elsewhere B"));

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
      const tiny = {
        ...validInput,
        ...layeredTerrain(Array.from({ length: 5 }, () => ".".repeat(5))),
      };
      await expect(createMap(db, tiny)).rejects.toThrow(/^size:/);
      const huge = {
        ...validInput,
        ...layeredTerrain(Array.from({ length: 101 }, () => ".".repeat(101))),
      };
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
        offsetX: 0,
        offsetY: 0,
        assetId: BUSH,
      }));
      await expect(createMap(db, { ...validInput, elements: tooMany })).rejects.toThrow(
        /^elements:/,
      );
    });

    it("refuses a layer id the tileset cannot resolve", async () => {
      const db = createDb(env.DB);
      const [ground, elevation, objects] = validInput.layers;
      if (!ground || !elevation || !objects) throw new Error("fixture missing a layer");
      // One past the last declared fixed tile: in-shape for the id space (a safe integer), but
      // unresolvable against tiny-swords, which is exactly the case `tileIdInTileset` exists to
      // refuse rather than let `bakeCollision` silently treat it as solid terrain.
      const badGround = { ...ground, ids: [fixedId(4), ...ground.ids.slice(1)] };
      await expect(
        createMap(db, { ...validInput, layers: [badGround, elevation, objects] }),
      ).rejects.toThrow(/^layers:/);
    });
  });

  describe("placement is enforced on write, not in the browser", () => {
    it("refuses a tree in the sea", async () => {
      const db = createDb(env.DB);
      await expect(
        createMap(db, {
          ...validInput,
          elements: [{ col: 1, row: 1, offsetX: 0, offsetY: 0, assetId: TREE }],
        }),
      ).rejects.toThrow(/placement/);
    });

    it("accepts a stone in the shallows", async () => {
      const db = createDb(env.DB);
      const ok = await createMap(db, {
        ...validInput,
        elements: [{ col: 1, row: 1, offsetX: 0, offsetY: 0, assetId: STONE }],
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
          elements: [{ col: 3, row: 3, offsetX: 0, offsetY: 0, assetId: TREE }],
          spawn: { col: 3, row: 3 },
        }),
      ).rejects.toThrow(/spawn/);
    });

    it("refuses scenery covering the spawn even when it does not collide", async () => {
      const db = createDb(env.DB);
      await expect(
        createMap(db, {
          ...validInput,
          elements: [{ col: 3, row: 3, offsetX: 0, offsetY: 0, assetId: BUSH }],
          spawn: { col: 3, row: 3 },
        }),
      ).rejects.toThrow(/spawn/);
    });

    it("refuses an unknown or non-editor catalogue asset", async () => {
      const db = createDb(env.DB);
      await expect(
        createMap(db, {
          ...validInput,
          elements: [
            { col: 4, row: 4, offsetX: 0, offsetY: 0, assetId: "ui.cursor.default" as never },
          ],
        }),
      ).rejects.toThrow(/unknown asset/);
    });

    it("refuses a multi-cell building that exceeds the map", async () => {
      const db = createDb(env.DB);
      await expect(
        createMap(db, {
          ...validInput,
          elements: [
            { col: MAP_COLS - 1, row: MAP_ROWS - 1, offsetX: 0, offsetY: 0, assetId: CASTLE },
          ],
        }),
      ).rejects.toThrow(/bounds/);
    });

    it("refuses two elements in the exact same sub-position slot", async () => {
      // Same cell AND same offset collides on the D1 primary key, so it stays rejected — but the
      // rejection is now about the slot, not the visual footprint.
      const db = createDb(env.DB);
      await expect(
        createMap(db, {
          ...validInput,
          elements: [
            { col: 4, row: 4, offsetX: 0, offsetY: 0, assetId: STONE },
            { col: 4, row: 4, offsetX: 0, offsetY: 0, assetId: STONE_ALT },
          ],
        }),
      ).rejects.toThrow(/duplicates another element's slot/);
    });

    it("accepts a stack of decorations in one cell at distinct offsets", async () => {
      // Task 12b: decorations may share a cell at different quarter-cell offsets. Visual-footprint
      // overlap no longer rejects — only an exact slot collision does.
      const db = createDb(env.DB);
      const created = await createMap(db, {
        ...validInput,
        elements: [
          { col: 4, row: 4, offsetX: 0, offsetY: 0, assetId: STONE },
          { col: 4, row: 4, offsetX: 3, offsetY: 1, assetId: STONE_ALT },
        ],
      });
      // Both rows survive the D1 primary key `(mapId, col, row, offsetX, offsetY)` — the whole point.
      const loaded = await loadMap(db, created.id);
      expect(loaded?.elements).toHaveLength(2);
      const offsets = loaded?.elements
        .filter((e) => e.col === 4 && e.row === 4)
        .map((e) => `${e.offsetX},${e.offsetY}`)
        .sort();
      expect(offsets).toEqual(["0,0", "3,1"]);
    });
  });

  describe("round-tripping", () => {
    it("reads back exactly what was written", async () => {
      const db = createDb(env.DB);
      const created = await createMap(db, {
        ...validInput,
        // Clear of the spawn at (0,0) — a tree standing on it is refused, and rightly so.
        elements: [
          { col: 4, row: 3, offsetX: 0, offsetY: 0, assetId: TREE_ALT },
          { col: 1, row: 1, offsetX: 0, offsetY: 0, assetId: STONE_ALT },
        ],
      });
      const loaded = await loadMap(db, created.id);
      expect(loaded?.layers).toEqual(layeredTerrain(validBlocks()).layers);
      expect(loaded?.spawn).toEqual(validInput.spawn);
      expect(loaded?.elements).toHaveLength(2);
      expect(loaded?.elements.find((e) => e.assetId === TREE_ALT)?.assetId).toBe(TREE_ALT);
    });

    it("replaces elements wholesale on update", async () => {
      const db = createDb(env.DB);
      const created = await createMap(db, {
        ...validInput,
        elements: [{ col: 4, row: 3, offsetX: 0, offsetY: 0, assetId: TREE }],
      });
      await updateMap(db, created.id, {
        ...validInput,
        name: "Renamed",
        elements: [{ col: 3, row: 3, offsetX: 0, offsetY: 0, assetId: BUSH }],
      });
      const loaded = await loadMap(db, created.id);
      expect(loaded?.name).toBe("Renamed");
      expect(loaded?.elements).toEqual([{ col: 3, row: 3, offsetX: 0, offsetY: 0, assetId: BUSH }]);
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
      expect(loaded?.elements).toEqual([
        { col: 4, row: 3, offsetX: 0, offsetY: 0, assetId: TREE_ALT },
      ]);
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

    // Regression: D1 refuses a single query bound to more than 100 parameters, and a multi-row
    // `INSERT` into `map_element` binds 5 per row, so an unchunked write topped out around 20
    // elements — far below `MAX_MAP_ELEMENTS`. Bisected against the real Worker and D1: 20 elements
    // succeeded, 21 failed, consistently. This drives the real D1 binding through `createMap` at the
    // actual cap to prove the chunked insert clears it.
    it("creates a map at the element cap, across a chunked D1 insert", async () => {
      const db = createDb(env.DB);
      const spawn = { col: 0, row: 0 };
      const elements = rockGrid(MAX_MAP_ELEMENTS, spawn);
      expect(elements).toHaveLength(MAX_MAP_ELEMENTS);

      const created = await createMap(db, {
        name: "Rocks",
        ...layeredTerrain(rockGridBlocks(MAX_MAP_ELEMENTS)),
        elements,
        spawn,
      });
      expect(created.elements).toHaveLength(MAX_MAP_ELEMENTS);

      const loaded = await loadMap(db, created.id);
      const key = (e: { col: number; row: number; assetId: string }) =>
        `${e.col}:${e.row}:${e.assetId}`;
      expect(loaded?.elements).toHaveLength(MAX_MAP_ELEMENTS);
      expect(new Set(loaded?.elements.map(key))).toEqual(new Set(elements.map(key)));
    });

    // Same defect, the other write path: `updateMap` deletes and reinserts every element, so a
    // fix that only chunked `createMap` would still fail here.
    it("updates a map past the single-statement element limit, across a chunked D1 insert", async () => {
      const db = createDb(env.DB);
      const spawn = { col: 0, row: 0 };
      const small = rockGrid(3, spawn);
      const created = await createMap(db, {
        name: "Small",
        ...layeredTerrain(rockGridBlocks(3)),
        elements: small,
        spawn,
      });

      const grown = rockGrid(60, spawn); // comfortably past the ~20-row single-statement limit
      const updated = await updateMap(db, created.id, {
        ...layeredTerrain(rockGridBlocks(60)),
        name: "Grown",
        elements: grown,
        spawn,
      });
      expect(updated.elements).toHaveLength(60);

      const loaded = await loadMap(db, created.id);
      const key = (e: { col: number; row: number; assetId: string }) =>
        `${e.col}:${e.row}:${e.assetId}`;
      expect(loaded?.elements).toHaveLength(60);
      expect(new Set(loaded?.elements.map(key))).toEqual(new Set(grown.map(key)));
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

    it("lets one same-revision map save win without mixing either writer's child rows", async () => {
      const created = await createMap(createDb(env.DB), inputNamed("Original"));
      const revision = created.revision;
      const writerA: MapInput = {
        ...validInput,
        name: "Writer A",
        elements: [{ col: 3, row: 3, offsetX: 0, offsetY: 0, assetId: STONE }],
      };
      const writerB: MapInput = {
        ...validInput,
        name: "Writer B",
        elements: [{ col: 4, row: 4, offsetX: 0, offsetY: 0, assetId: BUSH }],
      };

      // Separate Drizzle handles model two editor requests. Both carry the same revision; the map
      // row and its wholesale-replaced children must be one compare-and-swap, not two independent
      // writes that can produce Writer A's terrain with Writer B's elements.
      const outcomes = await Promise.allSettled([
        updateOwnedMap(createDb(env.DB), created.id, writerA, undefined, revision),
        updateOwnedMap(createDb(env.DB), created.id, writerB, undefined, revision),
      ]);

      const fulfilled = outcomes.filter(
        (outcome): outcome is PromiseFulfilledResult<Awaited<ReturnType<typeof updateOwnedMap>>> =>
          outcome.status === "fulfilled",
      );
      const rejected = outcomes.filter(
        (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(String(rejected[0]?.reason)).toMatch(/conflict/);

      const winner = fulfilled[0]?.value;
      const loaded = await loadMap(createDb(env.DB), created.id);
      expect(loaded?.revision).toBe(revision + 1);
      expect(loaded?.name).toBe(winner?.name);
      expect(loaded?.elements).toEqual(winner?.elements);
    });
  });

  describe("events", () => {
    function page(overrides: Partial<MapEventPage> = {}): MapEventPage {
      return {
        condSwitchId: null,
        condVariableId: null,
        condVariableMin: null,
        condSelfSwitch: null,
        graphicAssetId: null,
        moveType: "fixed",
        moveSpeed: 3,
        moveFreq: 3,
        optMoveAnim: false,
        optStopAnim: false,
        optDirFix: false,
        optThrough: false,
        optOnTop: false,
        trigger: "action",
        commands: [],
        ...overrides,
      };
    }
    function event(
      col: number,
      row: number,
      ordinal: number,
      pages: readonly MapEventPage[],
    ): MapEvent {
      return {
        id: crypto.randomUUID(),
        col,
        row,
        name: `EV${ordinal}`,
        ordinal,
        kind: "normal",
        species: null,
        patrolRadius: null,
        pages,
      };
    }

    // A single map body sized to hold the events under test, with room to spare.
    function withEvents(events: readonly MapEvent[]): MapInput {
      return { ...validInput, name: "Evented", events };
    }

    it("round-trips events and pages through D1 in ordinal and position order", async () => {
      const db = createDb(env.DB);
      // A page with every field at a non-default value, so a dropped or mis-mapped column shows.
      const rich = page({
        condSwitchId: "0001",
        condVariableId: "0002",
        condVariableMin: 5,
        condSelfSwitch: "B",
        graphicAssetId: TREE,
        moveType: "approach",
        moveSpeed: 4,
        moveFreq: 2,
        optMoveAnim: true,
        optStopAnim: true,
        optDirFix: true,
        optThrough: true,
        optOnTop: true,
        trigger: "player-touch",
      });
      // moveSpeed doubles as a position marker so page order is observable after the round trip.
      const first = event(3, 4, 1, [page({ moveSpeed: 0 }), page({ moveSpeed: 1 }), rich]);
      const second = event(7, 8, 2, [page({ moveSpeed: 5 })]);
      // Deliberately hand them to createMap out of ordinal order; load must still sort by ordinal.
      const created = await createMap(db, withEvents([second, first]));
      expect(created.events).toHaveLength(2);

      const loaded = await loadMap(db, created.id);
      if (!loaded) throw new Error("expected the map to load");
      expect(loaded.events.map((e) => e.ordinal)).toEqual([1, 2]);
      // Page order preserved: the third page of the first event is the rich one.
      expect(loaded.events[0]?.pages.map((p) => p.moveSpeed)).toEqual([0, 1, 4]);
      expect(loaded.events[0]?.pages[2]).toEqual(rich);
      expect(loaded.events[0]).toMatchObject({ id: first.id, col: 3, row: 4, name: "EV1" });
      expect(loaded.events[1]).toMatchObject({ id: second.id, col: 7, row: 8, ordinal: 2 });
    });

    it("saves new map anchors and the graph that binds them in one request", async () => {
      const db = createDb(env.DB);
      const created = await createMap(db, validInput);
      const entry = { ...event(2, 2, 1, [page()]), kind: "entry" as const };
      const exit = { ...event(3, 2, 2, [page()]), kind: "exit" as const };
      const nextMap = withEvents([entry, exit]);
      const nextAdventure = {
        title: "Playable",
        maxPlayers: 4,
        registry: {
          switches: [],
          variables: [],
          quests: [
            {
              ...createAuthoredQuestDefinition("0001", "Map save quest"),
              version: 41,
              acceptance: "automatic" as const,
              completion: "automatic" as const,
              objectives: [createManualQuestObjective("0001", "Step")],
            },
          ],
        },
        graph: {
          start: { mapId: created.id, entryId: entry.id },
          links: [{ mapId: created.id, exitId: exit.id, dest: "end" as const }],
        },
      };

      const updated = await updateOwnedMap(
        db,
        created.id,
        nextMap,
        nextAdventure,
        created.revision,
      );
      expect(updated.revision).toBe(created.revision + 1);
      const storedAdventure = await loadAdventure(db, OWNER, adventureId);
      expect(storedAdventure?.graph).toEqual(nextAdventure.graph);
      expect(storedAdventure?.registry.quests?.[0]?.version).toBe(1);
    });

    // Regression / the tranche-1 D1 bug class: an event INSERT binds 6 params/row and a page INSERT
    // 17, so an unchunked write of the 64-event x 8-page maximum would bind 384 and 8,704 and D1
    // would refuse the whole batch with `D1_ERROR: too many SQL variables`. This drives the real D1
    // binding through `createMap` at that maximum to prove the chunked insert clears it.
    it("creates a map at the 64x8 event/page maximum, across a chunked D1 insert", async () => {
      const db = createDb(env.DB);
      const events = Array.from({ length: MAX_EVENTS_PER_MAP }, (_, i) =>
        event(
          i % MAP_COLS,
          Math.floor(i / MAP_COLS),
          i,
          Array.from({ length: MAX_PAGES_PER_EVENT }, (_, p) => page({ moveSpeed: p % 6 })),
        ),
      );
      const created = await createMap(db, withEvents(events));
      expect(created.events).toHaveLength(MAX_EVENTS_PER_MAP);

      const loaded = await loadMap(db, created.id);
      expect(loaded?.events).toHaveLength(MAX_EVENTS_PER_MAP);
      expect(loaded?.events.every((e) => e.pages.length === MAX_PAGES_PER_EVENT)).toBe(true);
      // Every event's pages come back in position order.
      for (const e of loaded?.events ?? []) {
        expect(e.pages.map((p) => p.moveSpeed)).toEqual(
          Array.from({ length: MAX_PAGES_PER_EVENT }, (_, p) => p % 6),
        );
      }
    });

    // The other write path: updateMap deletes and reinserts events+pages, and the delete cascades to
    // pages, so a fix that only chunked createMap would still fail here.
    it("updates events past the single-statement limit, replacing the old set wholesale", async () => {
      const db = createDb(env.DB);
      const created = await createMap(db, withEvents([event(1, 1, 1, [page()])]));

      const grown = Array.from({ length: 40 }, (_, i) =>
        event(i % MAP_COLS, Math.floor(i / MAP_COLS), i, [page(), page({ moveSpeed: 1 })]),
      );
      const updated = await updateMap(db, created.id, withEvents(grown));
      expect(updated.events).toHaveLength(40);

      const loaded = await loadMap(db, created.id);
      expect(loaded?.events).toHaveLength(40);
      // No stale page rows survived the cascade: exactly 2 pages per event, 80 total.
      expect(loaded?.events.reduce((n, e) => n + e.pages.length, 0)).toBe(80);
    });

    it("rejects more than MAX_EVENTS_PER_MAP events", async () => {
      const db = createDb(env.DB);
      const tooMany = Array.from({ length: MAX_EVENTS_PER_MAP + 1 }, (_, i) =>
        event(i % MAP_COLS, Math.floor(i / MAP_COLS), i, [page()]),
      );
      await expect(createMap(db, withEvents(tooMany))).rejects.toThrow(/events/);
    });

    it("rejects an event whose cell is outside the map", async () => {
      const db = createDb(env.DB);
      const offMap = [event(MAP_COLS + 5, 0, 1, [page()])];
      await expect(createMap(db, withEvents(offMap))).rejects.toThrow(/events/);
    });
  });
});
