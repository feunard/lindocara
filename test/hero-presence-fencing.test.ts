/**
 * Presence fencing on the hero admission path.
 *
 * These five invariants belong to the *shared* runtime — `HeroPresence` extends `CharacterPresence`
 * and the heartbeat loop in `world/movement-system.ts` never asks which identity it is renewing —
 * so they were ported here from the deleted `mission-2a.test.ts` rather than being re-proved on the
 * legacy `?character=` route: heartbeat-renewal invalidation, post-expiry acquisition fencing the
 * stale room's save, hibernation wake refusing a superseded lease, command-queue cleanup on
 * re-acquisition, and post-revocation action rejection.
 *
 * None of them sleeps through a lease. Expiry is forced with `expireAt()`, which is deterministic,
 * and the heartbeat that notices runs on the short `PRESENCE_HEARTBEAT_MS_OVERRIDE` from
 * vitest.config.ts. mission-2a cost ~59s proving the same things against the real 30s/10s clock.
 */

import { env, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import {
  PRESENCE_HEARTBEAT_MS,
  PRESENCE_TTL_MS,
  presenceTiming,
} from "../src/server/character-presence.js";
import { createDb } from "../src/server/db/index.js";
import { loadHeroProfile, saveHeroProfile } from "../src/server/hero-profile.js";
import type { Attachment } from "../src/server/world.js";
import { WS_CLOSE } from "../src/shared/close-codes.js";
import { NO_INPUT, PLAYER_SPEED, TICK_DT } from "../src/shared/simulation.js";
import {
  Client,
  drainHeroRooms,
  heroRoomKey,
  type TestHero,
  type TestMapBody,
  type TestParty,
  testHero,
  testMapInput,
  testParty,
  until,
} from "./support/world-harness.js";

/** Wide and empty: no monster to move a hero's HP, and an exit far out of accidental reach. */
function fencingMap(name: string): TestMapBody {
  return testMapInput(name, {
    cols: 40,
    rows: 30,
    spawn: { col: 2, row: 2 },
    exit: { col: 38, row: 28 },
  });
}

/** Two maps, so "the old room" can be a genuinely different Durable Object. */
async function seedParty(label: string): Promise<TestParty & { mapA: string; mapB: string }> {
  const party = await testParty(label, {
    maps: [fencingMap(`${label} first`), fencingMap(`${label} second`)],
  });
  const [mapA, mapB] = party.mapIds;
  if (!mapA || !mapB) throw new Error("expected two seeded maps");
  return Object.assign(party, { mapA, mapB });
}

interface HeroRow {
  x: number;
  y: number;
  hp: number;
  level: number;
  xp: number;
  life: string;
  corpse_x: number | null;
  corpse_y: number | null;
  map_id: string;
  session_epoch: number;
}

/**
 * Every column `saveHeroProfile` can write, plus the two the epoch fence guards. A hero persists
 * core stats only — there is no inventory, equipment or quest row to read back.
 */
async function readHeroRow(heroId: string): Promise<HeroRow> {
  const row = await env.DB.prepare(
    `SELECT x, y, hp, level, xp, life, corpse_x, corpse_y, map_id, session_epoch
     FROM hero WHERE id = ?`,
  )
    .bind(heroId)
    .first<HeroRow>();
  if (!row) throw new Error("missing hero row");
  return row;
}

/** The lease a live hero is holding, or a failure that names the hero rather than "undefined". */
async function currentLease(heroId: string) {
  const lease = await env.HERO_PRESENCE.getByName(heroId).current();
  if (!lease) throw new Error(`no presence lease for hero ${heroId}`);
  return lease;
}

/** Force the lease to have expired, without waiting for it. */
async function expireLease(heroId: string): Promise<void> {
  const lease = await currentLease(heroId);
  expect(await env.HERO_PRESENCE.getByName(heroId).expireAt(lease.expiresAt + 1)).toBe(true);
}

/**
 * A revoked socket is inert: every intent it can express is dropped, and none of them reaches D1.
 * The full menu matters — one unguarded branch is one way to keep playing a hero you no longer own.
 */
async function assertRevokedHeroCannotAct(
  revoked: Client,
  heroId: string,
  baseline: HeroRow,
): Promise<void> {
  const receivedBefore = revoked.received.length;

  revoked.attemptAfterRevocation({ t: "input", seq: 999_999, input: { ...NO_INPUT, right: true } });
  revoked.attemptAfterRevocation({ t: "attack" });
  revoked.attemptAfterRevocation({ t: "skill", slot: 1 });
  revoked.attemptAfterRevocation({ t: "heal" });
  revoked.attemptAfterRevocation({ t: "interact" });
  revoked.attemptAfterRevocation({ t: "use", item: "potion" });
  revoked.attemptAfterRevocation({ t: "chat", text: "ghost-after-revoke" });
  revoked.attemptAfterRevocation({ t: "input", seq: 999_998, input: { ...NO_INPUT, left: true } });

  await scheduler.wait(500);

  expect(revoked.received.length).toBe(receivedBefore);
  expect(await readHeroRow(heroId)).toEqual(baseline);
}

afterEach(async () => {
  await drainHeroRooms();
  await env.DB.exec("DELETE FROM hero");
  await env.DB.exec("DELETE FROM party_member");
  await env.DB.exec("DELETE FROM party");
  await env.DB.exec("DELETE FROM adventure_map");
  await env.DB.exec("DELETE FROM adventure");
  await env.DB.exec("DELETE FROM map_element");
  await env.DB.exec("DELETE FROM map");
  await env.DB.exec("DELETE FROM account");
});

describe("presence lease clock", () => {
  /**
   * The whole point of the override is that production does not use it. `wrangler.jsonc` declares
   * neither var, so an empty `Env` is what a deployed Worker actually sees.
   */
  it("falls back to the production constants when no override is bound", () => {
    expect(presenceTiming({} as Env)).toEqual({
      ttlMs: PRESENCE_TTL_MS,
      heartbeatMs: PRESENCE_HEARTBEAT_MS,
    });
  });

  it("ignores an override that is not a positive number", () => {
    const nonsense = {
      PRESENCE_TTL_MS_OVERRIDE: "not-a-number",
      PRESENCE_HEARTBEAT_MS_OVERRIDE: "-1",
    } as Env;
    expect(presenceTiming(nonsense)).toEqual({
      ttlMs: PRESENCE_TTL_MS,
      heartbeatMs: PRESENCE_HEARTBEAT_MS,
    });
  });

  it("uses the short lease this suite is configured with", () => {
    // If this ever reverts to the defaults, every fencing test below silently starts sleeping.
    const timing = presenceTiming(env);
    expect(timing.heartbeatMs).toBeLessThan(PRESENCE_HEARTBEAT_MS);
    expect(timing.ttlMs).toBeLessThan(PRESENCE_TTL_MS);
    expect(timing.ttlMs / timing.heartbeatMs).toBeGreaterThan(
      PRESENCE_TTL_MS / PRESENCE_HEARTBEAT_MS,
    );
  });
});

describe("hero heartbeat and presence expiry", () => {
  it("invalidates a hero room's runtime when its heartbeat cannot renew an expired lease", async () => {
    const party = await seedParty("hbexp");
    const hero = await testHero("Renewer", { party, class: "warrior" });
    const client = await Client.joinHero(hero);
    await until("heartbeat welcome", () => client.welcome);

    await expireLease(hero.heroId);
    const baseline = await readHeroRow(hero.heroId);

    // Nothing else is poking the room: only the tick loop's own heartbeat can notice.
    const closed = await until("heartbeat close", () => client.closeInfo ?? undefined);
    expect(closed.code).toBe(WS_CLOSE.PRESENCE_LOST);

    client.attemptAfterRevocation({ t: "attack" });
    await scheduler.wait(300);
    expect(await readHeroRow(hero.heroId)).toEqual(baseline);
    // The runtime is gone, not merely muted — the room has no player left to persist.
    expect(await env.WORLD.getByName(hero.roomKey).persistCharacter(hero.heroId)).toBeNull();
  }, 15_000);

  it("allows a fresh acquisition after expiry and blocks the old room from saving", async () => {
    const party = await seedParty("freshacq");
    const hero = await testHero("Recovered", { party, class: "warrior" });
    const first = await Client.joinHero(hero);
    await until("expiry welcome", () => first.welcome);
    expect((await readHeroRow(hero.heroId)).session_epoch).toBe(1);

    await expireLease(hero.heroId);
    const lost = await until("expiry close", () => first.closeInfo ?? undefined);
    expect(lost.code).toBe(WS_CLOSE.PRESENCE_LOST);

    // Recover into the *other* map, so the room that lost the lease is a different Durable
    // Object from the one that now owns the hero.
    await env.DB.prepare("UPDATE hero SET map_id = ? WHERE id = ?")
      .bind(party.mapB, hero.heroId)
      .run();
    const recovered = await Client.joinHero({ ...hero, mapId: party.mapB });
    await until("recovered welcome", () => recovered.welcome);
    expect((await readHeroRow(hero.heroId)).session_epoch).toBe(2);

    const authoritative = await readHeroRow(hero.heroId);
    const db = createDb(env.DB);
    const ghost = await loadHeroProfile(db, hero.heroId);
    if (!ghost) throw new Error("missing ghost profile");
    ghost.sessionEpoch = 1;
    ghost.x = 1;
    ghost.y = 1;
    expect(await saveHeroProfile(db, ghost)).toBe(false);
    expect(await readHeroRow(hero.heroId)).toEqual(authoritative);
    // The abandoned room holds no runtime for this hero, so it has nothing to write back either.
    expect(
      await env.WORLD.getByName(heroRoomKey(party.partyId, party.mapA)).persistCharacter(
        hero.heroId,
      ),
    ).toBeNull();
  }, 15_000);
});

describe("hero hibernation reconstruction", () => {
  /**
   * workerd cannot evict a ticking World Durable Object — `evictDurableObject()` waits for the
   * `setInterval` to drain and it never does. So a wake is proved as two halves: the metadata the
   * constructor would read is asserted on the live socket attachment, and the presence gate that
   * constructor calls is asserted to refuse the superseded lease.
   */
  it("refuses a superseded lease instead of silently re-acquiring stale authority", async () => {
    const party = await seedParty("staleLease");
    const hero = await testHero("Sleeper", { party, class: "warrior" });
    const first = await Client.joinHero(hero);
    await until("stale lease welcome", () => first.welcome);

    // Half one: the attachment carries everything `#restoreWebSocket` needs to re-authorize.
    const attachment = await heroAttachment(hero);
    expect(attachment).toMatchObject({
      id: hero.heroId,
      connectionId: expect.any(String),
      sessionEpoch: 1,
      roomKey: hero.roomKey,
      zoneId: hero.mapId,
      identityKind: "hero",
      partyId: hero.partyId,
    });
    const { connectionId, sessionEpoch } = attachment;
    if (!connectionId || !sessionEpoch) throw new Error("attachment missing presence metadata");

    const replacement = await Client.joinHero(hero);
    await until("stale lease replaced", () => first.closeInfo ?? undefined);
    await until("replacement welcome", () => replacement.welcome);

    // Half two: waking on that attachment would call exactly this, and be refused.
    expect(
      await env.HERO_PRESENCE.getByName(hero.heroId).isAuthorized(
        connectionId,
        sessionEpoch,
        hero.roomKey,
      ),
    ).toBe(false);
  }, 15_000);
});

/** The live attachment for a hero, read out of its room's socket set. */
async function heroAttachment(hero: TestHero): Promise<Attachment> {
  const found = await runInDurableObject(env.WORLD.getByName(hero.roomKey), (_instance, state) => {
    for (const ws of state.getWebSockets()) {
      const value = ws.deserializeAttachment() as Attachment | null;
      if (value?.id === hero.heroId) return value;
    }
    return null;
  });
  if (!found) throw new Error("no attachment for the connected hero");
  return found;
}

describe("hero command queue cleanup", () => {
  it("drops a revoked hero's queued commands when another connection acquires presence", async () => {
    const party = await seedParty("queue");
    const hero = await testHero("Queued", { party, class: "warrior" });
    const first = await Client.joinHero(hero, { pump: false });
    await until("queue welcome", () => first.welcome);
    const start = await until("queue start", () => first.self());

    // A whole second of movement, queued in one burst. The server applies one per tick, so almost
    // all of it is still waiting when the lease changes hands.
    for (let seq = 1; seq <= 24; seq++) {
      first.sendCommandAt(seq, { ...NO_INPUT, right: true });
    }

    const replacement = await Client.joinHero(hero, { pump: false });
    const replaced = await until("queue old closed", () => first.closeInfo ?? undefined);
    expect(replaced.code).toBe(WS_CLOSE.CHARACTER_REPLACED);
    await until("queue new welcome", () => replacement.welcome);

    // `invalidatePresence` clears the queue before it saves, so the burst cannot be drained after
    // the fact. Allow the handful of commands that legitimately ran before the replacement landed.
    // `invalidatePresence` clears the queue and drops the runtime out of the tick loop, so the
    // burst cannot be drained after the fact. The bound has to be tight to mean anything: the
    // whole burst is 312px, and in practice the replacement lands before a single command runs.
    // Four commands of tolerance absorbs a slow machine without admitting a drained queue.
    const tolerance = 4 * PLAYER_SPEED * TICK_DT;
    await scheduler.wait(500);
    const travelled = (await readHeroRow(hero.heroId)).x - start.x;
    expect(travelled).toBeLessThanOrEqual(tolerance);
    expect(travelled).toBeLessThan(24 * PLAYER_SPEED * TICK_DT);
  }, 15_000);
});

describe("hero post-revocation commands", () => {
  it("ignores every gameplay action after CHARACTER_REPLACED", async () => {
    const party = await seedParty("replaced");
    const hero = await testHero("Displaced", { party, class: "warrior", level: 5 });
    const old = await Client.joinHero(hero);
    await until("replaced welcome", () => old.welcome);

    const replacement = await Client.joinHero(hero);
    const closed = await until("replaced close", () => old.closeInfo ?? undefined);
    expect(closed.code).toBe(WS_CLOSE.CHARACTER_REPLACED);
    expect(
      old.received.some((message) => message.t === "event" && message.code === "presence.replaced"),
    ).toBe(true);
    await until("replacement welcome", () => replacement.welcome);

    const baseline = await readHeroRow(hero.heroId);
    const before = replacement.self();
    await assertRevokedHeroCannotAct(old, hero.heroId, baseline);
    // The living connection is untouched by the noise its ghost made.
    expect(replacement.self()).toMatchObject({ x: before?.x, y: before?.y });
  }, 15_000);

  it("ignores every gameplay action after PRESENCE_LOST", async () => {
    const party = await seedParty("lost");
    const hero = await testHero("Fenced", { party, class: "warrior" });
    const client = await Client.joinHero(hero);
    await until("lost welcome", () => client.welcome);

    // Someone else advanced the D1 epoch. The room only finds out when it next tries to save.
    await env.DB.prepare("UPDATE hero SET session_epoch = session_epoch + 1 WHERE id = ?")
      .bind(hero.heroId)
      .run();
    expect(await env.WORLD.getByName(hero.roomKey).persistCharacter(hero.heroId)).toBe(false);

    const closed = await until("lost close", () => client.closeInfo ?? undefined);
    expect(closed.code).toBe(WS_CLOSE.PRESENCE_LOST);

    const baseline = await readHeroRow(hero.heroId);
    await assertRevokedHeroCannotAct(client, hero.heroId, baseline);
    expect(await env.WORLD.getByName(hero.roomKey).persistCharacter(hero.heroId)).toBeNull();
  }, 15_000);
});
