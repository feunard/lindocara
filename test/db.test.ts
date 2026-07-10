/**
 * The player table is unused by the game today. These tests exist so that the schema, the
 * generated migration, and the Drizzle types cannot silently drift apart before anything
 * depends on them.
 */

import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { createDb, player } from "../src/server/db/index.js";
import { loadOrCreateProfile, saveProfile } from "../src/server/profile.js";
import { isWalkable, spawnPosition, WORLD_LANDMARKS } from "../src/shared/game.js";

describe("player table", () => {
  // This pool does not isolate storage between tests, so rows written by one test are visible
  // to the next. Truncate rather than `reset()` from cloudflare:test: that wipes every
  // binding, Durable Object storage included, and this file has no business doing that.
  afterEach(async () => {
    await env.DB.exec("DELETE FROM player");
  });
  it("is created by the migration", async () => {
    const { results } = await env.DB.prepare(
      "select name from sqlite_master where type = 'table' and name = 'player'",
    ).all();

    expect(results).toHaveLength(1);
  });

  it("has the columns the schema declares", async () => {
    const { results } = await env.DB.prepare("pragma table_info(player)").all<{
      name: string;
      notnull: number;
      pk: number;
    }>();

    const columns = Object.fromEntries(results.map((c) => [c.name, c]));
    expect(Object.keys(columns).sort()).toEqual([
      "appearance",
      "created_at",
      "crystals",
      "gold",
      "hp",
      "id",
      "last_seen_at",
      "level",
      "nick",
      "potions",
      "quest_progress",
      "quest_status",
      "weapon",
      "x",
      "xp",
      "y",
    ]);
    expect(columns.id?.pk).toBe(1);
    expect(columns.nick?.notnull).toBe(1);
  });

  it("indexes nick, but does not make it unique", async () => {
    const { results } = await env.DB.prepare("pragma index_list(player)").all<{
      name: string;
      unique: number;
    }>();

    const nickIndex = results.find((i) => i.name === "player_nick_idx");
    expect(nickIndex).toBeDefined();
    // Nicknames are not identities yet. See the note in schema.ts.
    expect(nickIndex?.unique).toBe(0);
  });

  it("starts empty", async () => {
    const db = createDb(env.DB);
    expect(await db.select().from(player)).toEqual([]);
  });

  it("round-trips a row through Drizzle, defaulting the timestamps", async () => {
    const db = createDb(env.DB);
    const before = Date.now();

    await db.insert(player).values({ id: "11111111-2222-3333-4444-555555555555", nick: "nico" });

    const rows = await db.select().from(player);
    expect(rows).toHaveLength(1);

    const row = rows[0];
    expect(row?.id).toBe("11111111-2222-3333-4444-555555555555");
    expect(row?.nick).toBe("nico");
    expect(row).toMatchObject({
      x: 784,
      y: 450,
      level: 1,
      xp: 0,
      hp: 100,
      potions: 2,
      gold: 0,
      crystals: 0,
      weapon: "rusty_sword",
      questStatus: "available",
      questProgress: 0,
    });

    // `timestamp_ms` mode must hand back Dates, not raw integers.
    expect(row?.createdAt).toBeInstanceOf(Date);
    expect(row?.lastSeenAt).toBeInstanceOf(Date);
    expect(row?.createdAt.getTime()).toBeGreaterThanOrEqual(before - 2000);
  });

  it("rejects a duplicate primary key", async () => {
    const db = createDb(env.DB);
    const row = { id: "same-id", nick: "first" };

    await db.insert(player).values(row);
    await expect(db.insert(player).values({ ...row, nick: "second" })).rejects.toThrow();
  });

  it("creates new profiles at their deterministic plaza spawn", async () => {
    const db = createDb(env.DB);
    const profile = await loadOrCreateProfile(db, "new-profile-id", "newbie");
    expect(profile).toMatchObject(spawnPosition("new-profile-id"));
    expect(isWalkable(profile)).toBe(true);
  });

  it("preserves walkable legacy positions and safely falls back from new blockers", async () => {
    const db = createDb(env.DB);
    await db.insert(player).values({ id: "legacy-valid", nick: "legacy", x: 784, y: 450 });
    expect(await loadOrCreateProfile(db, "legacy-valid", "legacy")).toMatchObject({
      x: 784,
      y: 450,
    });

    const collider = WORLD_LANDMARKS.find((landmark) => landmark.collider)?.collider;
    if (!collider) throw new Error("test world needs a landmark collider");
    await db.insert(player).values({
      id: "legacy-blocked",
      nick: "blocked",
      x: collider.x + 1,
      y: collider.y + 1,
    });
    expect(await loadOrCreateProfile(db, "legacy-blocked", "blocked")).toMatchObject(
      spawnPosition("legacy-blocked"),
    );
  });

  it("persists and restores gameplay progression through the profile service", async () => {
    const db = createDb(env.DB);
    const profile = await loadOrCreateProfile(db, "persistent-id", "hero");
    profile.x = 321;
    profile.y = 432;
    profile.level = 4;
    profile.xp = 37;
    profile.hp = 88;
    profile.inventory.gold = 19;
    profile.inventory.crystals = 3;
    profile.quest.status = "active";
    profile.quest.progress = 2;
    await saveProfile(db, profile);

    const restored = await loadOrCreateProfile(db, "persistent-id", "hero-renamed");
    expect(restored).toMatchObject({
      id: "persistent-id",
      nick: "hero-renamed",
      x: 321,
      y: 432,
      level: 4,
      xp: 37,
      hp: 88,
      inventory: { gold: 19, crystals: 3 },
      quest: { status: "active", progress: 2 },
    });
  });

  // Deliberately last. "starts empty" above runs before any insert, so it would pass even if
  // rows leaked between tests. This one only passes because afterEach truncates — it is the
  // test that actually guards the guarantee.
  it("sees an empty table even after earlier tests inserted rows", async () => {
    const db = createDb(env.DB);
    expect(await db.select().from(player)).toEqual([]);
  });
});
