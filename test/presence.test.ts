import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { account, character, createDb } from "../src/server/db/index.js";
import { loadProfile, saveProfile } from "../src/server/profile.js";

async function characterFixture(label: string): Promise<string> {
  const suffix = crypto.randomUUID();
  const accountId = `account-${suffix}`;
  const characterId = `character-${suffix}`;
  const db = createDb(env.DB);
  await db.insert(account).values({
    id: accountId,
    username: `${label}-${suffix}`.slice(0, 32),
    passwordHash: "h",
    passwordSalt: "s",
    passwordIterations: 1,
  });
  await db.insert(character).values({ id: characterId, accountId, name: label });
  return characterId;
}

function request(characterId: string, connectionId: string, roomKey = "world") {
  return {
    characterId,
    connectionId,
    roomKey,
    zoneId: "verdant-reach",
    instanceId: "main",
  };
}

describe("CharacterPresence", () => {
  afterEach(async () => {
    await env.DB.exec("DELETE FROM character");
    await env.DB.exec("DELETE FROM account");
  });

  it("grants one authoritative lease and stores its epoch in D1", async () => {
    const characterId = await characterFixture("presence");
    const presence = env.CHARACTER_PRESENCE.getByName(characterId);
    const lease = await presence.acquire(request(characterId, crypto.randomUUID()));

    expect(lease).toMatchObject({
      characterId,
      sessionEpoch: 1,
      roomKey: "world",
      zoneId: "verdant-reach",
      instanceId: "main",
    });
    expect(await presence.isAuthorized(lease.connectionId, lease.sessionEpoch, "world")).toBe(true);
    expect((await loadProfile(createDb(env.DB), characterId))?.sessionEpoch).toBe(1);
  });

  it("serializes rapid tab acquisitions and authorizes only the newest epoch", async () => {
    const characterId = await characterFixture("tabs");
    const presence = env.CHARACTER_PRESENCE.getByName(characterId);
    const firstConnection = crypto.randomUUID();
    const secondConnection = crypto.randomUUID();
    const [first, second] = await Promise.all([
      presence.acquire(request(characterId, firstConnection)),
      presence.acquire(request(characterId, secondConnection)),
    ]);

    expect(second.sessionEpoch).toBe(first.sessionEpoch + 1);
    expect(await presence.isAuthorized(firstConnection, first.sessionEpoch, "world")).toBe(false);
    expect(await presence.isAuthorized(secondConnection, second.sessionEpoch, "world")).toBe(true);
  });

  it("rejects a late save from the lease replaced by another room", async () => {
    const characterId = await characterFixture("fenced");
    const presence = env.CHARACTER_PRESENCE.getByName(characterId);
    const first = await presence.acquire(request(characterId, crypto.randomUUID(), "world"));
    const stale = await loadProfile(createDb(env.DB), characterId);
    if (!stale) throw new Error("missing stale profile");
    stale.x = 111;
    stale.y = 222;
    stale.xp = 999;

    const currentLease = await presence.acquire(
      request(characterId, crypto.randomUUID(), "simulated-second-room"),
    );
    expect(currentLease.sessionEpoch).toBe(first.sessionEpoch + 1);
    const current = await loadProfile(createDb(env.DB), characterId);
    if (!current) throw new Error("missing current profile");
    current.x = 800;
    current.y = 900;
    current.xp = 42;
    expect(await saveProfile(createDb(env.DB), current)).toBe(true);
    expect(await saveProfile(createDb(env.DB), stale)).toBe(false);
    expect(await loadProfile(createDb(env.DB), characterId)).toMatchObject({
      x: 800,
      y: 900,
      xp: 42,
      sessionEpoch: currentLease.sessionEpoch,
    });
  });

  it("expires a vanished lease without sleeping and allows recovery", async () => {
    const characterId = await characterFixture("expiry");
    const presence = env.CHARACTER_PRESENCE.getByName(characterId);
    const first = await presence.acquire(request(characterId, crypto.randomUUID()));

    expect(await presence.expireAt(first.expiresAt - 1)).toBe(false);
    expect(await presence.expireAt(first.expiresAt + 1)).toBe(true);
    expect(await presence.current()).toBeNull();

    const recovered = await presence.acquire(request(characterId, crypto.randomUUID()));
    expect(recovered.sessionEpoch).toBe(first.sessionEpoch + 1);
    expect(
      await presence.isAuthorized(recovered.connectionId, recovered.sessionEpoch, "world"),
    ).toBe(true);
  });

  it("renews and voluntarily releases only the matching connection", async () => {
    const characterId = await characterFixture("release");
    const presence = env.CHARACTER_PRESENCE.getByName(characterId);
    const lease = await presence.acquire(request(characterId, crypto.randomUUID()));
    expect(await presence.renew(lease.connectionId, lease.sessionEpoch)).toBe(true);
    expect(await presence.release("wrong-connection", lease.sessionEpoch)).toBe(false);
    expect(await presence.release(lease.connectionId, lease.sessionEpoch)).toBe(true);
    expect(await presence.current()).toBeNull();
  });

  it("keeps different characters independent", async () => {
    const aliceId = await characterFixture("alice");
    const bobId = await characterFixture("bob");
    const alice = env.CHARACTER_PRESENCE.getByName(aliceId);
    const bob = env.CHARACTER_PRESENCE.getByName(bobId);
    const aliceLease = await alice.acquire(request(aliceId, crypto.randomUUID()));
    const bobLease = await bob.acquire(request(bobId, crypto.randomUUID()));

    await alice.acquire(request(aliceId, crypto.randomUUID()));
    expect(await bob.isAuthorized(bobLease.connectionId, bobLease.sessionEpoch, "world")).toBe(
      true,
    );
    expect(
      await alice.isAuthorized(aliceLease.connectionId, aliceLease.sessionEpoch, "world"),
    ).toBe(false);
  });
});
