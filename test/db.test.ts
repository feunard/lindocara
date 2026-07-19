/**
 * Schema tests: the generated migration, the Drizzle types, and the tables cannot silently
 * drift apart. Service-level behavior (accounts, characters) is tested alongside in Task 3.
 */

import { env } from "cloudflare:test";
import { asc, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { createAccount, verifyCredentials } from "../src/server/accounts.js";
import {
  characterOwnedBy,
  createCharacter,
  deleteCharacter,
  listCharacters,
  MAX_CHARACTERS_PER_ACCOUNT,
} from "../src/server/characters.js";
import {
  account,
  character,
  createDb,
  map,
  mapElement,
  mapEvent,
  mapEventPage,
} from "../src/server/db/index.js";
import { BUILTIN_MAP } from "../src/server/maps.js";
import { acquireSessionEpoch, loadProfile, saveProfile } from "../src/server/profile.js";
import { starterEquipmentFor } from "../src/shared/character.js";
import { mapSpawnPoint } from "../src/shared/map-data.js";
import { TINY_SWORDS_TILESET_ID } from "../src/shared/tilesets/tiny-swords.js";

describe("account and character tables", () => {
  // The pool does not isolate storage between tests. Truncate children before parents (FK).
  afterEach(async () => {
    await env.DB.exec("DELETE FROM character");
    await env.DB.exec("DELETE FROM account");
  });

  it("creates both tables and drops player", async () => {
    const { results } = await env.DB.prepare(
      "select name from sqlite_master where type = 'table' and name in ('account', 'character', 'player')",
    ).all<{ name: string }>();
    const names = results.map((r) => r.name).sort();
    expect(names).toEqual(["account", "character"]);
  });

  it("has the account columns the schema declares", async () => {
    const { results } = await env.DB.prepare("pragma table_info(account)").all<{
      name: string;
      notnull: number;
      pk: number;
    }>();
    const columns = Object.fromEntries(results.map((c) => [c.name, c]));
    expect(Object.keys(columns).sort()).toEqual([
      "created_at",
      "id",
      "last_seen_at",
      "password_hash",
      "password_iterations",
      "password_salt",
      "username",
    ]);
    expect(columns.id?.pk).toBe(1);
    expect(columns.username?.notnull).toBe(1);
  });

  it("enforces unique usernames", async () => {
    const db = createDb(env.DB);
    const row = {
      id: "a1",
      username: "nico",
      passwordHash: "h",
      passwordSalt: "s",
      passwordIterations: 1,
    };
    await db.insert(account).values(row);
    await expect(db.insert(account).values({ ...row, id: "a2" })).rejects.toThrow();
  });

  it("has the character columns the schema declares", async () => {
    const { results } = await env.DB.prepare("pragma table_info(character)").all<{
      name: string;
    }>();
    expect(results.map((c) => c.name).sort()).toEqual([
      "account_id",
      "appearance",
      "appearance_body",
      "appearance_primary_color",
      "class",
      "corpse_x",
      "corpse_y",
      "created_at",
      "crystals",
      "gold",
      "hp",
      "id",
      "instance_id",
      "last_seen_at",
      "level",
      "life",
      "main_hand",
      "name",
      "off_hand",
      "persistence_version",
      "potions",
      "quest_chapter",
      "quest_progress",
      "quest_status",
      "resource_current",
      "session_epoch",
      "ward_run_expires_at",
      "weapon",
      "x",
      "xp",
      "y",
      "zone_id",
    ]);
  });

  it("round-trips a character through Drizzle, defaulting the game columns", async () => {
    const db = createDb(env.DB);
    await db.insert(account).values({
      id: "acct-1",
      username: "owner",
      passwordHash: "h",
      passwordSalt: "s",
      passwordIterations: 1,
    });
    await db.insert(character).values({ id: "char-1", accountId: "acct-1", name: "Hero" });

    const rows = await db.select().from(character);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "char-1",
      accountId: "acct-1",
      name: "Hero",
      x: 784,
      y: 450,
      level: 1,
      xp: 0,
      hp: 100,
      appearance: "azure",
      appearanceBody: "wayfarer",
      appearancePrimaryColor: "azure",
      class: "warrior",
      potions: 2,
      gold: 0,
      crystals: 0,
      weapon: "rusty_sword",
      mainHand: "weathered_sword",
      offHand: null,
      questStatus: "available",
      questChapter: "three_offerings",
      questProgress: 0,
      zoneId: "verdant-reach",
      instanceId: "main",
      sessionEpoch: 0,
      wardRunExpiresAt: null,
      resourceCurrent: null,
    });
    expect(rows[0]?.createdAt).toBeInstanceOf(Date);
  });

  it("gives characters a class column defaulting to warrior", async () => {
    const { results } = await env.DB.prepare("pragma table_info(character)").all<{
      name: string;
    }>();
    expect(results.map((c) => c.name)).toContain("class");

    const db = createDb(env.DB);
    await db.insert(account).values({
      id: "acct-cls",
      username: "classowner",
      passwordHash: "h",
      passwordSalt: "s",
      passwordIterations: 1,
    });
    await db.insert(character).values({ id: "char-cls", accountId: "acct-cls", name: "Old" });
    const profile = await loadProfile(db, "char-cls");
    expect(profile?.class).toBe("warrior");
    expect(profile?.appearance).toEqual({
      body: "wayfarer",
      primaryColor: "azure",
    });
    expect(profile?.equipment).toEqual(starterEquipmentFor("warrior"));
  });

  it("repairs safe starter equipment defaults for legacy rows from their class", async () => {
    const db = createDb(env.DB);
    await db.insert(account).values({
      id: "acct-legacy",
      username: "legacyowner",
      passwordHash: "h",
      passwordSalt: "s",
      passwordIterations: 1,
    });
    await db.insert(character).values([
      { id: "legacy-warrior", accountId: "acct-legacy", name: "OldWarrior", class: "warrior" },
      { id: "legacy-ranger", accountId: "acct-legacy", name: "OldRanger", class: "ranger" },
      { id: "legacy-priest", accountId: "acct-legacy", name: "OldPriest", class: "priest" },
    ]);

    for (const playerClass of ["warrior", "ranger", "priest"] as const) {
      const profile = await loadProfile(db, `legacy-${playerClass}`);
      expect(profile?.appearance).toEqual({
        body: "wayfarer",
        primaryColor: "azure",
      });
      expect(profile?.equipment).toEqual(starterEquipmentFor(playerClass));
    }
  });

  it("loadProfile returns null for an unknown character and never creates", async () => {
    const db = createDb(env.DB);
    expect(await loadProfile(db, "no-such-character")).toBeNull();
    expect(await db.select().from(character)).toEqual([]);
  });

  it("persists and restores progression through the profile service", async () => {
    const db = createDb(env.DB);
    await db.insert(account).values({
      id: "acct-2",
      username: "owner2",
      passwordHash: "h",
      passwordSalt: "s",
      passwordIterations: 1,
    });
    await db.insert(character).values({ id: "char-2", accountId: "acct-2", name: "Hero2" });

    const profile = await loadProfile(db, "char-2");
    if (!profile) throw new Error("expected a profile");
    profile.x = 321;
    profile.y = 432;
    profile.level = 4;
    profile.xp = 37;
    profile.hp = 88;
    profile.inventory.gold = 19;
    profile.appearance = {
      body: "wayfarer",
      primaryColor: "violet",
    };
    profile.quest.status = "active";
    profile.quest.progress = 2;
    expect(await saveProfile(db, profile)).toBe(true);

    const restored = await loadProfile(db, "char-2");
    expect(restored).toMatchObject({
      id: "char-2",
      nick: "Hero2",
      x: 321,
      y: 432,
      level: 4,
      xp: 37,
      hp: 88,
      inventory: { gold: 19 },
      appearance: { body: "wayfarer", primaryColor: "violet" },
      equipment: starterEquipmentFor("warrior"),
      quest: { status: "active", progress: 2 },
    });
  });

  it("persists priest mana without creating resources for other classes", async () => {
    const db = createDb(env.DB);
    await db.insert(account).values({
      id: "acct-mana",
      username: "manaowner",
      passwordHash: "h",
      passwordSalt: "s",
      passwordIterations: 1,
    });
    await db.insert(character).values([
      { id: "char-mana", accountId: "acct-mana", name: "Mender", class: "priest" },
      { id: "char-no-mana", accountId: "acct-mana", name: "Fighter", class: "warrior" },
    ]);

    const priest = await loadProfile(db, "char-mana");
    if (!priest?.resource) throw new Error("expected priest mana");
    priest.resource.current = 37;
    expect(await saveProfile(db, priest)).toBe(true);

    expect((await loadProfile(db, "char-mana"))?.resource).toEqual({
      kind: "mana",
      current: 37,
      max: 100,
    });
    expect((await loadProfile(db, "char-no-mana"))?.resource).toBeUndefined();
  });

  it("fences stale position and progression saves with the session epoch", async () => {
    const db = createDb(env.DB);
    await db.insert(account).values({
      id: "acct-epoch",
      username: "epochowner",
      passwordHash: "h",
      passwordSalt: "s",
      passwordIterations: 1,
    });
    await db.insert(character).values({
      id: "char-epoch",
      accountId: "acct-epoch",
      name: "EpochHero",
      x: 300,
      y: 400,
      xp: 5,
    });

    const old = await loadProfile(db, "char-epoch");
    if (!old) throw new Error("missing old profile");
    expect(await acquireSessionEpoch(db, old.id)).toBe(1);
    const first = await loadProfile(db, old.id);
    if (!first) throw new Error("missing first epoch");

    expect(await acquireSessionEpoch(db, old.id)).toBe(2);
    const current = await loadProfile(db, old.id);
    if (!current) throw new Error("missing current epoch");
    current.x = 700;
    current.y = 1100;
    current.xp = 77;
    expect(await saveProfile(db, current)).toBe(true);

    first.x = 111;
    first.y = 222;
    first.xp = 999;
    expect(await saveProfile(db, first)).toBe(false);
    old.x = 10;
    old.xp = 1000;
    expect(await saveProfile(db, old)).toBe(false);

    expect(await loadProfile(db, old.id)).toMatchObject({
      x: 700,
      y: 1100,
      xp: 77,
      sessionEpoch: 2,
    });
  });
});

describe("accounts service", () => {
  afterEach(async () => {
    await env.DB.exec("DELETE FROM character");
    await env.DB.exec("DELETE FROM account");
  });

  it("creates an account and verifies its credentials", async () => {
    const db = createDb(env.DB);
    const created = await createAccount(db, "Nico", "a good password");
    if (created === "username_taken") throw new Error("unexpected collision");
    expect(created.username).toBe("nico"); // stored lowercase

    expect(await verifyCredentials(db, "nico", "a good password")).toMatchObject({
      id: created.id,
    });
    // Login is case-insensitive on the username…
    expect(await verifyCredentials(db, "NICO", "a good password")).toMatchObject({
      id: created.id,
    });
    // …but never on the password.
    expect(await verifyCredentials(db, "nico", "A good password")).toBeNull();
    expect(await verifyCredentials(db, "stranger", "a good password")).toBeNull();
  });

  it("rejects a duplicate username case-insensitively", async () => {
    const db = createDb(env.DB);
    await createAccount(db, "nico", "a good password");
    expect(await createAccount(db, "NiCo", "another password")).toBe("username_taken");
  });
});

describe("characters service", () => {
  afterEach(async () => {
    await env.DB.exec("DELETE FROM character");
    await env.DB.exec("DELETE FROM account");
  });

  async function owner(username = "owner"): Promise<string> {
    const created = await createAccount(createDb(env.DB), username, "a good password");
    if (created === "username_taken") throw new Error("test account collision");
    return created.id;
  }

  it("creates up to the cap, then refuses", async () => {
    const db = createDb(env.DB);
    const accountId = await owner();
    for (let i = 0; i < MAX_CHARACTERS_PER_ACCOUNT; i++) {
      const created = await createCharacter(
        db,
        accountId,
        `Hero${i}`,
        {
          body: "wayfarer",
          primaryColor: "ember",
        },
        "warrior",
      );
      expect(created).toMatchObject({
        name: `Hero${i}`,
        appearance: { body: "wayfarer", primaryColor: "ember" },
        equipment: starterEquipmentFor("warrior"),
        level: 1,
      });
    }
    expect(
      await createCharacter(
        db,
        accountId,
        "OneTooMany",
        {
          body: "wayfarer",
          primaryColor: "moss",
        },
        "warrior",
      ),
    ).toBe("limit_reached");
    expect(await listCharacters(db, accountId)).toHaveLength(MAX_CHARACTERS_PER_ACCOUNT);
  });

  it("spawns a new character at its deterministic plaza spawn", async () => {
    const db = createDb(env.DB);
    const created = await createCharacter(
      db,
      await owner(),
      "Fresh",
      {
        body: "wayfarer",
        primaryColor: "azure",
      },
      "warrior",
    );
    if (created === "limit_reached") throw new Error("unexpected cap");
    const row = await loadProfile(db, created.id);
    // Creation resolves through D1 (Task 3): first map, else the built-in floor. No maps exist in
    // this file's fixtures, so a fresh character lands on the built-in floor's own spawn — not a
    // hash-based verdant-reach plaza point.
    expect(row).toMatchObject(mapSpawnPoint(BUILTIN_MAP));
  });

  it("scopes list, ownership, and delete to the owning account", async () => {
    const db = createDb(env.DB);
    const alice = await owner("alice");
    const bob = await owner("bob");
    const created = await createCharacter(
      db,
      alice,
      "AliceHero",
      {
        body: "wayfarer",
        primaryColor: "violet",
      },
      "warrior",
    );
    if (created === "limit_reached") throw new Error("unexpected cap");

    expect(await listCharacters(db, bob)).toEqual([]);
    expect(await characterOwnedBy(db, alice, created.id)).toMatchObject({ id: created.id });
    expect(await characterOwnedBy(db, bob, created.id)).toBeNull();

    expect(await deleteCharacter(db, bob, created.id)).toBe(false);
    expect(await deleteCharacter(db, alice, created.id)).toBe(true);
    expect(await listCharacters(db, alice)).toEqual([]);
  });
});

describe("the map tables", () => {
  // The pool does not isolate storage between tests. Elements before maps (FK).
  afterEach(async () => {
    await env.DB.exec("DELETE FROM map_element");
    await env.DB.exec("DELETE FROM map");
  });

  async function seedMap(id: string): Promise<void> {
    await createDb(env.DB)
      .insert(map)
      .values({
        id,
        name: "Test",
        cols: 4,
        rows: 4,
        tilesetId: TINY_SWORDS_TILESET_ID,
        layers: JSON.stringify(["0*16", "0*16", "0*16"]),
        spawnCol: 0,
        spawnRow: 0,
      });
  }

  // "You can't set another tree on it" is the primary key, not a check anyone has to remember.
  it("refuses two elements on one cell", async () => {
    const db = createDb(env.DB);
    await seedMap("map-pk");
    await db.insert(mapElement).values({ mapId: "map-pk", col: 1, row: 1, kind: "tree" });
    await expect(
      db.insert(mapElement).values({ mapId: "map-pk", col: 1, row: 1, kind: "bush" }),
    ).rejects.toThrow();
  });

  it("allows the same cell on a different map", async () => {
    const db = createDb(env.DB);
    await seedMap("map-a");
    await seedMap("map-b");
    await db.insert(mapElement).values({ mapId: "map-a", col: 1, row: 1, kind: "tree" });
    await db.insert(mapElement).values({ mapId: "map-b", col: 1, row: 1, kind: "tree" });
    const all = await db.select().from(mapElement);
    expect(all.length).toBe(2);
  });

  it("takes a map's elements with it when the map goes", async () => {
    const db = createDb(env.DB);
    await seedMap("map-cascade");
    await db.insert(mapElement).values({ mapId: "map-cascade", col: 0, row: 0, kind: "tree" });
    await db.delete(map).where(eq(map.id, "map-cascade"));
    const left = await db.select().from(mapElement).where(eq(mapElement.mapId, "map-cascade"));
    expect(left).toEqual([]);
  });
});

describe("the map event tables", () => {
  // Children before parents (FK): pages, then events, then the map (and its elements).
  afterEach(async () => {
    await env.DB.exec("DELETE FROM map_event_page");
    await env.DB.exec("DELETE FROM map_event");
    await env.DB.exec("DELETE FROM map_element");
    await env.DB.exec("DELETE FROM map");
  });

  async function seedMap(id: string): Promise<void> {
    await createDb(env.DB)
      .insert(map)
      .values({
        id,
        name: "Test",
        cols: 8,
        rows: 8,
        tilesetId: TINY_SWORDS_TILESET_ID,
        layers: JSON.stringify(["0*64", "0*64", "0*64"]),
        spawnCol: 0,
        spawnRow: 0,
      });
  }

  function pageValues(id: string, eventId: string, position: number) {
    return {
      id,
      eventId,
      position,
      condSwitchId: null,
      condVariableId: null,
      condVariableMin: null,
      condSelfSwitch: null,
      graphicAssetId: null,
      moveType: "fixed" as const,
      moveSpeed: 3,
      moveFreq: 3,
      optMoveAnim: false,
      optStopAnim: false,
      optDirFix: false,
      optThrough: false,
      optOnTop: false,
      trigger: "action" as const,
    };
  }

  it("inserts an event and its ordered pages", async () => {
    const db = createDb(env.DB);
    await seedMap("map-ev");
    await db
      .insert(mapEvent)
      .values({ id: "ev-1", mapId: "map-ev", col: 2, row: 3, name: "Sign", ordinal: 1 });
    await db
      .insert(mapEventPage)
      .values([pageValues("pg-1a", "ev-1", 0), pageValues("pg-1b", "ev-1", 1)]);

    const events = await db.select().from(mapEvent).where(eq(mapEvent.mapId, "map-ev"));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ id: "ev-1", col: 2, row: 3, name: "Sign", ordinal: 1 });
    const pages = await db
      .select()
      .from(mapEventPage)
      .where(eq(mapEventPage.eventId, "ev-1"))
      .orderBy(asc(mapEventPage.position));
    expect(pages.map((p) => p.position)).toEqual([0, 1]);
    // Booleans round-trip through the 0/1 integer columns.
    expect(pages[0]).toMatchObject({ moveType: "fixed", trigger: "action", optOnTop: false });
  });

  it("cascades a map delete through its events and their pages", async () => {
    const db = createDb(env.DB);
    await seedMap("map-cascade-ev");
    await db
      .insert(mapEvent)
      .values({ id: "ev-c", mapId: "map-cascade-ev", col: 1, row: 1, name: "C", ordinal: 1 });
    await db.insert(mapEventPage).values(pageValues("pg-c", "ev-c", 0));

    await db.delete(map).where(eq(map.id, "map-cascade-ev"));

    expect(await db.select().from(mapEvent).where(eq(mapEvent.mapId, "map-cascade-ev"))).toEqual(
      [],
    );
    expect(await db.select().from(mapEventPage).where(eq(mapEventPage.eventId, "ev-c"))).toEqual(
      [],
    );
  });

  it("cascades an event delete through its pages", async () => {
    const db = createDb(env.DB);
    await seedMap("map-ev-cascade");
    await db
      .insert(mapEvent)
      .values({ id: "ev-d", mapId: "map-ev-cascade", col: 4, row: 4, name: "D", ordinal: 1 });
    await db.insert(mapEventPage).values(pageValues("pg-d", "ev-d", 0));

    await db.delete(mapEvent).where(eq(mapEvent.id, "ev-d"));

    expect(await db.select().from(mapEventPage).where(eq(mapEventPage.eventId, "ev-d"))).toEqual(
      [],
    );
  });

  it("refuses two events on one cell", async () => {
    const db = createDb(env.DB);
    await seedMap("map-cell");
    await db
      .insert(mapEvent)
      .values({ id: "ev-a", mapId: "map-cell", col: 2, row: 2, name: "A", ordinal: 1 });
    await expect(
      db
        .insert(mapEvent)
        .values({ id: "ev-b", mapId: "map-cell", col: 2, row: 2, name: "B", ordinal: 2 }),
    ).rejects.toThrow();
  });

  it("allows the same cell on a different map", async () => {
    const db = createDb(env.DB);
    await seedMap("map-x");
    await seedMap("map-y");
    await db
      .insert(mapEvent)
      .values({ id: "ev-x", mapId: "map-x", col: 2, row: 2, name: "X", ordinal: 1 });
    await db
      .insert(mapEvent)
      .values({ id: "ev-y", mapId: "map-y", col: 2, row: 2, name: "Y", ordinal: 1 });
    expect(await db.select().from(mapEvent)).toHaveLength(2);
  });

  it("refuses two pages at one position within an event", async () => {
    const db = createDb(env.DB);
    await seedMap("map-pos");
    await db
      .insert(mapEvent)
      .values({ id: "ev-p", mapId: "map-pos", col: 0, row: 0, name: "P", ordinal: 1 });
    await db.insert(mapEventPage).values(pageValues("pg-p1", "ev-p", 0));
    await expect(db.insert(mapEventPage).values(pageValues("pg-p2", "ev-p", 0))).rejects.toThrow();
  });
});
