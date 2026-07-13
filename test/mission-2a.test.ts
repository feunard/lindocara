/**
 * Mission 2A integration proofs: two World Durable Objects, presence epochs, post-revocation
 * command rejection, queue cleanup, stale D1 saves, heartbeat expiry, hibernation limits, ward_run.
 */

import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { PRESENCE_HEARTBEAT_MS } from "../src/server/character-presence.js";
import { createDb } from "../src/server/db/index.js";
import { loadProfile, saveProfile } from "../src/server/profile.js";
import type { Attachment } from "../src/server/world.js";
import { WS_CLOSE } from "../src/shared/close-codes.js";
import { QUEST_NPC, QUEST_SITES } from "../src/shared/game.js";
import { NO_INPUT, PLAYER_SPEED, TICK_DT } from "../src/shared/simulation.js";
import {
  Client,
  MMO_TEST_ROOM_KEY,
  type TestCharacter,
  testCharacter,
  until,
  VERDANT_ROOM_KEY,
  waitForRoomSockets,
} from "./support/world-harness.js";

const ROOM_A_KEY = VERDANT_ROOM_KEY;
const ROOM_B_KEY = MMO_TEST_ROOM_KEY;
const D1_SAVE_WAIT_MS = 5_500;

interface CharacterRow {
  x: number;
  y: number;
  hp: number;
  level: number;
  xp: number;
  gold: number;
  crystals: number;
  potions: number;
  main_hand: string;
  off_hand: string;
  quest_status: string;
  quest_chapter: string;
  quest_progress: number;
  zone_id: string;
  instance_id: string;
  session_epoch: number;
  ward_run_expires_at: number | null;
}

async function readCharacterRow(characterId: string): Promise<CharacterRow> {
  const row = await env.DB.prepare(
    `SELECT c.x, c.y, c.hp, c.level, c.xp, c.gold, c.crystals,
            COALESCE(p.quantity, 0) AS potions,
            main_item.item_definition_id AS main_hand,
            off_item.item_definition_id AS off_hand,
            q.status AS quest_status,
            q.quest_id AS quest_chapter,
            q.progress AS quest_progress,
            c.zone_id, c.instance_id, c.session_epoch,
            json_extract(q.data, '$.wardRunExpiresAt') AS ward_run_expires_at
     FROM character c
     LEFT JOIN character_item p
       ON p.character_id = c.id AND p.item_definition_id = 'health_potion'
     LEFT JOIN character_equipment main_equipment
       ON main_equipment.character_id = c.id AND main_equipment.slot = 'main_hand'
     LEFT JOIN character_item main_item ON main_item.id = main_equipment.character_item_id
     LEFT JOIN character_equipment off_equipment
       ON off_equipment.character_id = c.id AND off_equipment.slot = 'off_hand'
     LEFT JOIN character_item off_item ON off_item.id = off_equipment.character_item_id
     LEFT JOIN character_quest q ON q.rowid = (
       SELECT candidate.rowid FROM character_quest candidate
       WHERE candidate.character_id = c.id
       ORDER BY
         CASE WHEN candidate.status = 'completed' THEN 1 ELSE 0 END,
         CASE candidate.quest_id
           WHEN 'three_offerings' THEN 1 WHEN 'bone_choir' THEN 2
           WHEN 'mire_runes' THEN 3 WHEN 'ward_run' THEN 4 ELSE 99 END
       LIMIT 1
     )
     WHERE c.id = ?`,
  )
    .bind(characterId)
    .first<CharacterRow>();
  if (!row) throw new Error("missing character row");
  return row;
}

async function joinPersistedZone(
  session: TestCharacter,
  zoneId: string,
  instanceId = "main",
  pump = true,
): Promise<Client> {
  if (zoneId === "mmo-test-zone") await waitForRoomSockets(MMO_TEST_ROOM_KEY, 0);
  await env.DB.prepare("UPDATE character SET zone_id = ?, instance_id = ? WHERE id = ?")
    .bind(zoneId, instanceId, session.characterId)
    .run();
  return Client.joinCharacter(session, { pump });
}

async function assertRevokedConnectionCannotAct(
  revoked: Client,
  characterId: string,
  baseline: CharacterRow,
  options: { puzzleInteract?: boolean; lootMove?: boolean } = {},
): Promise<void> {
  const receivedBefore = revoked.received.length;

  revoked.attemptAfterRevocation({
    t: "input",
    seq: 999_999,
    input: { ...NO_INPUT, right: true },
  });
  revoked.attemptAfterRevocation({ t: "attack" });
  revoked.attemptAfterRevocation({ t: "skill", slot: 1 });
  revoked.attemptAfterRevocation({ t: "heal" });
  revoked.attemptAfterRevocation({ t: "interact" });
  if (options.puzzleInteract) revoked.attemptAfterRevocation({ t: "interact" });
  revoked.attemptAfterRevocation({ t: "use", item: "potion" });
  revoked.attemptAfterRevocation({ t: "chat", text: "ghost-after-revoke" });
  if (options.lootMove) {
    revoked.attemptAfterRevocation({
      t: "input",
      seq: 999_998,
      input: { ...NO_INPUT, left: true },
    });
  }

  await scheduler.wait(500);

  expect(revoked.received.length).toBe(receivedBefore);
  expect(await readCharacterRow(characterId)).toEqual(baseline);
}

describe("Mission 2A — canonical two-World E2E", () => {
  it("moves authoritative state across two World Durable Objects and fences a late Room A save", {
    timeout: 30_000,
  }, async () => {
    const roomA = env.WORLD.getByName(ROOM_A_KEY);
    const roomB = env.WORLD.getByName(ROOM_B_KEY);
    expect(roomA.id.toString()).not.toBe(roomB.id.toString());

    const session = await testCharacter("m2a_e2e", {
      position: { x: QUEST_NPC.x + 50, y: QUEST_NPC.y },
      hp: 55,
      level: 3,
    });
    await env.DB.prepare("UPDATE character SET gold = ?, crystals = ?, xp = ? WHERE id = ?")
      .bind(7, 2, 14, session.characterId)
      .run();

    const clientA = await Client.joinCharacter(session);
    await until("Room A welcome", () => clientA.welcome);

    const epochA = await env.DB.prepare("SELECT session_epoch FROM character WHERE id = ?")
      .bind(session.characterId)
      .first<{ session_epoch: number }>();
    expect(epochA?.session_epoch).toBe(1);

    clientA.action("interact");
    await until("Room A quest active", () =>
      clientA.latestState?.quest.status === "active" ? clientA.latestState : undefined,
    );
    clientA.usePotion();
    await until("Room A potion used", () =>
      clientA.latestState?.inventory.potions === 1 && clientA.self()?.hp === 100
        ? clientA.latestState
        : undefined,
    );

    const beforeMove = await until("Room A position before move", () => clientA.self());
    clientA.press("right");
    await until("Room A moved", () => {
      const self = clientA.self();
      return self && self.x > beforeMove.x + 12 ? self : undefined;
    });
    clientA.release();
    await scheduler.wait(300);

    const staleProfile = await loadProfile(createDb(env.DB), session.characterId);
    if (!staleProfile) throw new Error("missing stale profile");
    staleProfile.x = 42;
    staleProfile.y = 84;
    staleProfile.hp = 11;
    staleProfile.level = 99;
    staleProfile.xp = 888;
    staleProfile.inventory = { gold: 111, crystals: 99, potions: 9 };
    staleProfile.equipment = { mainHand: "hunter_bow", offHand: null };
    staleProfile.quest = {
      chapter: "three_offerings",
      status: "active",
      progress: 9,
      target: 3,
    };
    staleProfile.zoneId = "verdant-reach";
    staleProfile.instanceId = "main";
    staleProfile.wardRunExpiresAt = Date.now() + 60_000;

    const clientB = await joinPersistedZone(session, "mmo-test-zone");
    const oldClosed = await until("Room A socket closed", () => clientA.closeInfo ?? undefined);
    expect(oldClosed.code).toBe(WS_CLOSE.CHARACTER_REPLACED);
    expect(
      clientA.received.some(
        (message) => message.t === "event" && message.code === "presence.replaced",
      ),
    ).toBe(true);

    const welcomeB = await until("Room B welcome", () => clientB.welcome);
    expect(welcomeB.world).toMatchObject({ width: 640, height: 480 });

    const epochB = await env.DB.prepare("SELECT session_epoch FROM character WHERE id = ?")
      .bind(session.characterId)
      .first<{ session_epoch: number }>();
    expect(epochB?.session_epoch).toBe(2);

    const startB = await until("Room B start position", () => clientB.self());
    const moveRight = startB.x < 280;
    clientB.press(moveRight ? "right" : "left");
    await until("Room B moved", () => {
      const self = clientB.self();
      if (!self) return undefined;
      const delta = moveRight ? self.x - startB.x : startB.x - self.x;
      return delta > 8 ? self : undefined;
    });
    clientB.release();
    clientB.stopPump();

    await scheduler.wait(D1_SAVE_WAIT_MS);

    const authoritative = await readCharacterRow(session.characterId);
    expect(authoritative.session_epoch).toBe(2);
    expect(authoritative.zone_id).toBe("mmo-test-zone");
    expect(authoritative.instance_id).toBe("main");
    expect(authoritative.gold).toBe(7);
    expect(authoritative.crystals).toBe(2);
    expect(authoritative.potions).toBe(1);
    expect(authoritative.quest_status).toBe("active");
    expect(authoritative.quest_progress).toBe(0);
    expect(Math.abs(authoritative.x - startB.x)).toBeGreaterThan(8);

    expect(await saveProfile(createDb(env.DB), staleProfile)).toBe(false);
    expect(await roomA.persistCharacter(session.characterId)).toBeNull();

    const playersOnA = await runInDurableObject(roomA, (_instance, state) =>
      state
        .getWebSockets()
        .map((ws) => ws.deserializeAttachment() as Attachment | null)
        .filter((attachment) => attachment?.id === session.characterId),
    );
    expect(playersOnA).toEqual([]);

    expect(await readCharacterRow(session.characterId)).toEqual(authoritative);

    clientB.close();
  });
});

describe("Mission 2A — stale save field fence", () => {
  it("rejects a stale profile that would overwrite every persisted character column", async () => {
    const session = await testCharacter("m2a_stale_fields", {
      position: { x: 400, y: 500 },
      level: 2,
      quest: { chapter: "three_offerings", status: "active", progress: 1 },
    });
    await env.DB.prepare("UPDATE character SET gold = ?, crystals = ?, xp = ? WHERE id = ?")
      .bind(3, 1, 10, session.characterId)
      .run();
    await env.DB.prepare("UPDATE character_quest SET data = ? WHERE character_id = ?")
      .bind(JSON.stringify({ wardRunExpiresAt: Date.now() + 30_000 }), session.characterId)
      .run();

    const clientA = await Client.joinCharacter(session);
    await until("stale fields welcome", () => clientA.welcome);

    const stale = await loadProfile(createDb(env.DB), session.characterId);
    if (!stale) throw new Error("missing stale profile");
    stale.x = 11;
    stale.y = 22;
    stale.hp = 33;
    stale.level = 44;
    stale.xp = 55;
    stale.inventory = { gold: 66, crystals: 77, potions: 88 };
    stale.equipment = { mainHand: "hunter_bow", offHand: null };
    stale.quest = { chapter: "mire_runes", status: "active", progress: 99, target: 4 };
    stale.zoneId = "verdant-reach";
    stale.instanceId = "raid-1";
    stale.wardRunExpiresAt = Date.now() + 120_000;

    const clientB = await joinPersistedZone(session, "mmo-test-zone");
    await until("stale fields replaced", () => clientA.closeInfo ?? undefined);

    const current = await loadProfile(createDb(env.DB), session.characterId);
    if (!current) throw new Error("missing current profile");
    current.x = 900;
    current.y = 1000;
    current.hp = 88;
    current.level = 5;
    current.xp = 77;
    current.inventory = { gold: 19, crystals: 4, potions: 1 };
    current.equipment = { mainHand: "weathered_sword", offHand: "oak_shield" };
    current.quest = { chapter: "three_offerings", status: "active", progress: 2, target: 3 };
    current.zoneId = "mmo-test-zone";
    current.instanceId = "main";
    current.wardRunExpiresAt = null;
    expect(await saveProfile(createDb(env.DB), current)).toBe(true);
    expect(await saveProfile(createDb(env.DB), stale)).toBe(false);

    const row = await readCharacterRow(session.characterId);
    expect(row).toEqual({
      x: 900,
      y: 1000,
      hp: 88,
      level: 5,
      xp: 77,
      gold: 19,
      crystals: 4,
      potions: 1,
      main_hand: "weathered_sword",
      off_hand: "oak_shield",
      quest_status: "active",
      quest_chapter: "three_offerings",
      quest_progress: 2,
      zone_id: "mmo-test-zone",
      instance_id: "main",
      session_epoch: current.sessionEpoch,
      ward_run_expires_at: null,
    });

    clientA.close();
    clientB.close();
  });
});

describe("Mission 2A — post-revocation commands", () => {
  it("ignores every gameplay action after CHARACTER_REPLACED", { timeout: 15_000 }, async () => {
    const puzzleSite = QUEST_SITES.find(
      (candidate) => candidate.chapter === "mire_runes" && candidate.order === 3,
    );
    if (!puzzleSite) throw new Error("mire rune fixture missing");

    const session = await testCharacter("m2a_post_replace", {
      class: "priest",
      position: { x: puzzleSite.x + 30, y: puzzleSite.y },
      quest: { chapter: "mire_runes", status: "active", progress: 2 },
      level: 10,
    });
    await env.DB.prepare("UPDATE character SET gold = ?, crystals = ? WHERE id = ?")
      .bind(4, 1, session.characterId)
      .run();

    const old = await Client.joinCharacter(session);
    await until("post replace welcome", () => old.welcome);
    const replacement = await Client.joinCharacter(session);
    await until("post replace close", () => old.closeInfo ?? undefined);
    expect(old.closeInfo?.code).toBe(WS_CLOSE.CHARACTER_REPLACED);
    await until("replacement welcome", () => replacement.welcome);

    await scheduler.wait(D1_SAVE_WAIT_MS);
    const baseline = await readCharacterRow(session.characterId);
    const replacementSelf = replacement.self();

    await assertRevokedConnectionCannotAct(old, session.characterId, baseline, {
      puzzleInteract: true,
      lootMove: true,
    });
    expect(replacement.self()).toMatchObject({
      x: replacementSelf?.x,
      y: replacementSelf?.y,
    });

    replacement.close();
  });

  it("ignores every gameplay action after PRESENCE_LOST", { timeout: 15_000 }, async () => {
    const session = await testCharacter("m2a_post_lost", {
      position: { x: QUEST_NPC.x + 40, y: QUEST_NPC.y },
    });
    const client = await Client.joinCharacter(session);
    await until("post lost welcome", () => client.welcome);
    client.action("interact");
    await until("post lost quest", () =>
      client.latestState?.quest.status === "active" ? client.latestState : undefined,
    );

    await env.DB.prepare("UPDATE character SET session_epoch = session_epoch + 1 WHERE id = ?")
      .bind(session.characterId)
      .run();
    expect(await env.WORLD.getByName(ROOM_A_KEY).persistCharacter(session.characterId)).toBe(false);
    const closed = await until("post lost close", () => client.closeInfo ?? undefined);
    expect(closed.code).toBe(WS_CLOSE.PRESENCE_LOST);

    const baseline = await readCharacterRow(session.characterId);
    await assertRevokedConnectionCannotAct(client, session.characterId, baseline, {
      puzzleInteract: true,
    });
    expect(await env.WORLD.getByName(ROOM_A_KEY).persistCharacter(session.characterId)).toBeNull();
    client.close();
  });
});

describe("Mission 2A — command queue cleanup", () => {
  it("drops queued Room A commands when Room B acquires presence", {
    timeout: 20_000,
  }, async () => {
    const session = await testCharacter("m2a_queue");
    const clientA = await Client.joinCharacter(session, { pump: false });
    await until("queue welcome", () => clientA.welcome);
    const startX = (await until("queue start", () => clientA.self())).x;

    for (let seq = 1; seq <= 24; seq++) {
      clientA.sendCommandAt(seq, { ...NO_INPUT, right: true });
    }

    const clientB = await joinPersistedZone(session, "mmo-test-zone", "main", false);
    await until("queue old closed", () => clientA.closeInfo ?? undefined);
    await until("queue new welcome", () => clientB.welcome);
    clientB.close();

    const maxTravelIfExecuted = startX + 24 * PLAYER_SPEED * TICK_DT + PLAYER_SPEED * TICK_DT * 6;
    await scheduler.wait(500);
    const row = await readCharacterRow(session.characterId);
    expect(row.x).toBeLessThan(maxTravelIfExecuted);
    expect(await env.WORLD.getByName(ROOM_A_KEY).persistCharacter(session.characterId)).toBeNull();
  });
});

describe("Mission 2A — heartbeat and presence expiry", () => {
  it("renews an active lease through the presence coordinator", async () => {
    const characterId = await testCharacter("m2a_renew").then((s) => s.characterId);
    const presence = env.CHARACTER_PRESENCE.getByName(characterId);
    const lease = await presence.acquire({
      characterId,
      connectionId: crypto.randomUUID(),
      roomKey: ROOM_A_KEY,
      zoneId: "verdant-reach",
      instanceId: "main",
    });
    expect(await presence.renew(lease.connectionId, lease.sessionEpoch)).toBe(true);
    const current = await presence.current();
    expect(current?.expiresAt).toBeGreaterThan(lease.expiresAt);
  });

  it("refuses renewal after another connection acquires the lease", async () => {
    const characterId = await testCharacter("m2a_renew_fail").then((s) => s.characterId);
    const presence = env.CHARACTER_PRESENCE.getByName(characterId);
    const first = await presence.acquire({
      characterId,
      connectionId: crypto.randomUUID(),
      roomKey: ROOM_A_KEY,
      zoneId: "verdant-reach",
      instanceId: "main",
    });
    await presence.acquire({
      characterId,
      connectionId: crypto.randomUUID(),
      roomKey: ROOM_B_KEY,
      zoneId: "mmo-test-zone",
      instanceId: "main",
    });
    expect(await presence.renew(first.connectionId, first.sessionEpoch)).toBe(false);
  });

  it("invalidates a World runtime when its heartbeat cannot renew an expired lease", {
    timeout: 20_000,
  }, async () => {
    const session = await testCharacter("m2a_hb_expire");
    const client = await Client.joinCharacter(session);
    await until("heartbeat welcome", () => client.welcome);

    const lease = await env.CHARACTER_PRESENCE.getByName(session.characterId).current();
    if (!lease) throw new Error("missing lease");
    expect(
      await env.CHARACTER_PRESENCE.getByName(session.characterId).expireAt(lease.expiresAt + 1),
    ).toBe(true);

    const baseline = await readCharacterRow(session.characterId);
    await scheduler.wait(PRESENCE_HEARTBEAT_MS + 500);

    const closed = await until("heartbeat close", () => client.closeInfo ?? undefined);
    expect(closed.code).toBe(WS_CLOSE.PRESENCE_LOST);

    client.attemptAfterRevocation({ t: "attack" });
    await scheduler.wait(300);
    expect(await readCharacterRow(session.characterId)).toEqual(baseline);
    expect(await env.WORLD.getByName(ROOM_A_KEY).persistCharacter(session.characterId)).toBeNull();
    client.close();
  });

  it("allows a fresh acquisition after expiry and blocks the old room from saving", {
    timeout: 25_000,
  }, async () => {
    const session = await testCharacter("m2a_exp");
    const first = await Client.joinCharacter(session);
    await until("expire acquire welcome", () => first.welcome);

    const lease = await env.CHARACTER_PRESENCE.getByName(session.characterId).current();
    if (!lease) throw new Error("missing lease");
    expect(
      await env.CHARACTER_PRESENCE.getByName(session.characterId).expireAt(lease.expiresAt + 1),
    ).toBe(true);
    await scheduler.wait(PRESENCE_HEARTBEAT_MS + 500);
    expect(first.closeInfo?.code).toBe(WS_CLOSE.PRESENCE_LOST);

    const recovered = await Client.joinCharacter(session);
    await until("expire acquire rejoin", () => recovered.welcome);
    expect(
      (
        await env.DB.prepare("SELECT session_epoch FROM character WHERE id = ?")
          .bind(session.characterId)
          .first<{ session_epoch: number }>()
      )?.session_epoch,
    ).toBe(2);

    await scheduler.wait(D1_SAVE_WAIT_MS);
    const authoritative = await readCharacterRow(session.characterId);
    expect(await env.WORLD.getByName(ROOM_A_KEY).persistCharacter(session.characterId)).toBe(true);
    const ghost = await loadProfile(createDb(env.DB), session.characterId);
    if (!ghost) throw new Error("missing ghost profile");
    ghost.sessionEpoch = 1;
    ghost.x = 1;
    expect(await saveProfile(createDb(env.DB), ghost)).toBe(false);
    expect(await readCharacterRow(session.characterId)).toEqual(authoritative);

    first.close();
    recovered.close();
  });
});

describe("Mission 2A — hibernation reconstruction", () => {
  /**
   * workerd cannot safely evict a ticking World DO (see AGENTS.md). Full hibernation cycles are
   * therefore not replayed here. These tests cover the attachment metadata the constructor needs
   * and the presence gate that rejects superseded leases.
   */
  it("persists connectionId, sessionEpoch, and roomKey on websocket attachments", async () => {
    const session = await testCharacter("m2a_attach");
    const client = await Client.joinCharacter(session);
    await until("attach welcome", () => client.welcome);
    client.press("right");
    await scheduler.wait(1_200);
    client.release();

    const attachment = await runInDurableObject(
      env.WORLD.getByName(ROOM_A_KEY),
      (_instance, state) => {
        const sockets = state.getWebSockets();
        for (const ws of sockets) {
          const value = ws.deserializeAttachment() as Attachment | null;
          if (value?.id === session.characterId) return value;
        }
        return null;
      },
    );
    expect(attachment).toMatchObject({
      id: session.characterId,
      connectionId: expect.any(String),
      sessionEpoch: 1,
      roomKey: ROOM_A_KEY,
      zoneId: "verdant-reach",
      instanceId: "main",
    });
    expect(attachment?.x).toBeGreaterThan(0);

    client.close();
  });

  it("refuses a superseded lease instead of silently re-acquiring stale authority", async () => {
    const session = await testCharacter("m2a_stale_lease");
    const first = await Client.joinCharacter(session);
    await until("stale lease welcome", () => first.welcome);

    const attachment = await runInDurableObject(
      env.WORLD.getByName(ROOM_A_KEY),
      (_instance, state) => {
        for (const ws of state.getWebSockets()) {
          const value = ws.deserializeAttachment() as Attachment | null;
          if (value?.id === session.characterId) return value;
        }
        return null;
      },
    );
    if (!attachment?.connectionId || !attachment.sessionEpoch) {
      throw new Error("attachment missing presence metadata");
    }

    await Client.joinCharacter(session);
    await until("stale lease replaced", () => first.closeInfo ?? undefined);

    const presence = env.CHARACTER_PRESENCE.getByName(session.characterId);
    expect(
      await presence.isAuthorized(attachment.connectionId, attachment.sessionEpoch, ROOM_A_KEY),
    ).toBe(false);

    first.close();
  });
});

describe("Mission 2A — ward_run", () => {
  it("activates once, persists an absolute deadline across two rooms, and cannot be restarted", {
    timeout: 25_000,
  }, async () => {
    const ward = QUEST_SITES.find(
      (candidate) => candidate.chapter === "ward_run" && candidate.order === 0,
    );
    if (!ward) throw new Error("ward fixture missing");

    const session = await testCharacter("m2a_ward_cross", {
      position: { x: ward.x + 30, y: ward.y },
      quest: { chapter: "ward_run", status: "active", progress: 0 },
    });

    const roomA = env.WORLD.getByName(ROOM_A_KEY);
    const roomB = env.WORLD.getByName(ROOM_B_KEY);
    expect(roomA.id.toString()).not.toBe(roomB.id.toString());

    const clientA = await Client.joinCharacter(session);
    await until("ward cross welcome", () => clientA.welcome);
    clientA.action("interact");
    const deadline = await until("ward cross timer", () =>
      clientA.latestState?.quest.timerEndsAt ? clientA.latestState.quest.timerEndsAt : undefined,
    );
    expect(
      clientA.received.filter(
        (message) => message.t === "event" && message.code === "quest.run_started",
      ).length,
    ).toBe(1);
    await scheduler.wait(200);
    expect(clientA.latestState?.quest.timerEndsAt).toBe(deadline);

    await scheduler.wait(D1_SAVE_WAIT_MS);
    const persistedA = await readCharacterRow(session.characterId);
    expect(persistedA.ward_run_expires_at).toBe(deadline);

    const clientB = await joinPersistedZone(session, "mmo-test-zone");
    await until("ward cross replaced", () => clientA.closeInfo ?? undefined);
    const welcomeB = await until("ward cross room B", () => clientB.welcome);
    expect(welcomeB.self.quest.timerEndsAt).toBe(deadline);

    clientA.attemptAfterRevocation({ t: "interact" });
    await scheduler.wait(200);
    expect(clientB.latestState?.quest.timerEndsAt).toBe(deadline);

    await scheduler.wait(D1_SAVE_WAIT_MS);
    const persistedB = await readCharacterRow(session.characterId);
    expect(persistedB.ward_run_expires_at).toBe(deadline);
    expect(persistedB.session_epoch).toBe(2);
    expect(await roomA.persistCharacter(session.characterId)).toBeNull();

    clientB.close();
  });

  it("clears an elapsed ward run on reconnect without duplicating timer effects", {
    timeout: 15_000,
  }, async () => {
    const expiredAt = Date.now() - 2_000;
    const session = await testCharacter("m2a_wd_exp", {
      quest: { chapter: "ward_run", status: "active", progress: 2 },
      wardRunExpiresAt: expiredAt,
    });

    const client = await Client.joinCharacter(session);
    const welcome = await until("ward elapsed welcome", () => client.welcome);
    expect(welcome.self.quest.timerEndsAt).toBeUndefined();
    expect(welcome.self.quest.progress).toBe(0);

    const replacement = await Client.joinCharacter(session);
    await until("ward elapsed replaced", () => client.closeInfo ?? undefined);
    const secondWelcome = await until("ward elapsed second", () => replacement.welcome);
    expect(secondWelcome.self.quest.timerEndsAt).toBeUndefined();
    expect(secondWelcome.self.quest.progress).toBe(0);

    await scheduler.wait(D1_SAVE_WAIT_MS);
    const row = await readCharacterRow(session.characterId);
    expect(row.ward_run_expires_at).toBeNull();
    expect(row.quest_progress).toBe(0);

    replacement.close();
  });
});
