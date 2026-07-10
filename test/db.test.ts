/**
 * Schema tests: the generated migration, the Drizzle types, and the tables cannot silently
 * drift apart. Service-level behavior (accounts, characters) is tested alongside in Task 3.
 */

import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { account, character, createDb } from "../src/server/db/index.js";
import { loadProfile, saveProfile } from "../src/server/profile.js";

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
      "created_at",
      "crystals",
      "gold",
      "hp",
      "id",
      "last_seen_at",
      "level",
      "name",
      "potions",
      "quest_progress",
      "quest_status",
      "weapon",
      "x",
      "xp",
      "y",
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
      potions: 2,
      gold: 0,
      crystals: 0,
      weapon: "rusty_sword",
      questStatus: "available",
      questProgress: 0,
    });
    expect(rows[0]?.createdAt).toBeInstanceOf(Date);
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
    profile.quest.status = "active";
    profile.quest.progress = 2;
    await saveProfile(db, profile);

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
      quest: { status: "active", progress: 2 },
    });
  });
});
