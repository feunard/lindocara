/**
 * `PresenceRoom` — the headless per-hero lease room — against a real hero row created through
 * the ordinary HTTP flow (register, login, create an adventure, create a party, create a hero),
 * same idiom as `heroes.test.ts`. Every test calls room methods the way `WorldRoom` (Task 4+)
 * will: `alepha.inject(PresenceRoom).room.call(heroId, "<method>", ...)`.
 *
 * `presenceRoom.now` is reassigned directly (a plain field, not a constructor arg — see
 * `PresenceRoom`'s own docblock) to advance virtual time past the 30s TTL without a real sleep.
 */

import { emptyCombatCooldowns } from "@lindocara/engine/cooldowns.js";
import { UserController } from "alepha/api/users";
import { $repository } from "alepha/orm";
import { ServerProvider } from "alepha/server";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { heroes } from "../src/api/entities/heroes.ts";
import { PRESENCE_TTL_MS, PresenceRoom } from "../src/api/realtime/PresenceRoom.ts";
import { createTestApp } from "./helpers.ts";

const PASSWORD = "Sup3rSecret";

class SeedProbe {
  heroes = $repository(heroes);
}

let alepha: ReturnType<typeof createTestApp>;
let probe: SeedProbe;
let presenceRoom: PresenceRoom;
let hostname: string;
let userCount = 0;

beforeEach(async () => {
  alepha = createTestApp();
  probe = alepha.inject(SeedProbe);
  presenceRoom = alepha.inject(PresenceRoom);
  await alepha.start();
  hostname = alepha.inject(ServerProvider).hostname;
});

afterEach(async () => {
  await alepha.stop();
});

async function registerAndLogin(prefix: string): Promise<{ token: string }> {
  userCount += 1;
  const username = `${prefix}${userCount}`;
  const users = alepha.inject(UserController);
  const intent = await users.createRegistrationIntent.fetch({
    body: { username, password: PASSWORD },
  });
  await users.createUserFromIntent.fetch({ body: { intentId: intent.data.intentId } });
  const login = await fetch(`${hostname}/_auth/token?provider=credentials`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  const tokens = (await login.json()) as { access_token: string };
  return { token: tokens.access_token };
}

function authedFetch(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${hostname}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
}

async function newPlayableAdventureWithMap(
  token: string,
): Promise<{ adventureId: string; mapId: string }> {
  const response = await authedFetch("/api/adventures", token, {
    method: "POST",
    body: JSON.stringify({ title: "Donjon", maxPlayers: 4 }),
  });
  expect(response.status).toBe(201);
  const created = (await response.json()) as { id: string; defaultMap: { id: string } };
  return { adventureId: created.id, mapId: created.defaultMap.id };
}

async function newParty(token: string, adventureId: string): Promise<string> {
  const response = await authedFetch("/api/parties", token, {
    method: "POST",
    body: JSON.stringify({ adventureId }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

/** Creates one fresh hero end-to-end and returns its id plus the map it spawned on. */
async function newHero(prefix: string): Promise<{ heroId: string; mapId: string }> {
  const { token } = await registerAndLogin(prefix);
  const { adventureId, mapId } = await newPlayableAdventureWithMap(token);
  const partyId = await newParty(token, adventureId);
  const response = await authedFetch(`/api/parties/${partyId}/heroes`, token, {
    method: "POST",
    body: JSON.stringify({ name: "Mira", class: "priest" }),
  });
  expect(response.status).toBe(201);
  const hero = (await response.json()) as { id: string };
  return { heroId: hero.id, mapId };
}

describe("acquire", () => {
  test("bumps the D1 epoch and installs the lease", async () => {
    const { heroId } = await newHero("acquirebump");
    const before = await probe.heroes.findById(heroId);
    expect(before?.sessionEpoch).toBe(0);

    const result = (await presenceRoom.room.call(heroId, "acquire", {
      connectionId: "conn-1",
      roomKey: "party:map",
      zoneId: "map",
      instanceId: "main",
    })) as { sessionEpoch: number } | null;

    expect(result).toEqual({ sessionEpoch: 1 });

    const after = await probe.heroes.findById(heroId);
    expect(after?.sessionEpoch).toBe(1);
  });

  test("a second acquire invalidates the first connection's authorization", async () => {
    const { heroId } = await newHero("acquiretwice");

    const first = (await presenceRoom.room.call(heroId, "acquire", {
      connectionId: "conn-1",
      roomKey: "party:map",
      zoneId: "map",
      instanceId: "main",
    })) as { sessionEpoch: number };

    const authorizedBeforeSecond = await presenceRoom.room.call(
      heroId,
      "isAuthorized",
      "conn-1",
      first.sessionEpoch,
      "party:map",
    );
    expect(authorizedBeforeSecond).toBe(true);

    const second = (await presenceRoom.room.call(heroId, "acquire", {
      connectionId: "conn-2",
      roomKey: "party:map",
      zoneId: "map",
      instanceId: "main",
    })) as { sessionEpoch: number };

    expect(second.sessionEpoch).toBe(first.sessionEpoch + 1);

    const firstStillAuthorized = await presenceRoom.room.call(
      heroId,
      "isAuthorized",
      "conn-1",
      first.sessionEpoch,
      "party:map",
    );
    expect(firstStillAuthorized).toBe(false);

    const secondAuthorized = await presenceRoom.room.call(
      heroId,
      "isAuthorized",
      "conn-2",
      second.sessionEpoch,
      "party:map",
    );
    expect(secondAuthorized).toBe(true);
  });
});

describe("renew", () => {
  test("extends the lease, and a lapsed lease fails isAuthorized without a real sleep", async () => {
    const { heroId } = await newHero("renewlapse");
    let now = 1_000_000;
    presenceRoom.now = () => now;

    const acquired = (await presenceRoom.room.call(heroId, "acquire", {
      connectionId: "conn-1",
      roomKey: "party:map",
      zoneId: "map",
      instanceId: "main",
    })) as { sessionEpoch: number };

    // Advance to just before the original expiry and renew — must still succeed.
    now += PRESENCE_TTL_MS - 1;
    const renewed = await presenceRoom.room.call(heroId, "renew", "conn-1", acquired.sessionEpoch);
    expect(renewed).toBe(true);

    // Renewal pushed expiry to (now + TTL); confirm authorization still holds just under that.
    now += PRESENCE_TTL_MS - 1;
    const stillAuthorized = await presenceRoom.room.call(
      heroId,
      "isAuthorized",
      "conn-1",
      acquired.sessionEpoch,
      "party:map",
    );
    expect(stillAuthorized).toBe(true);

    // Now lapse it for real: past the renewed expiry, with no further renew.
    now += 2;
    const lapsed = await presenceRoom.room.call(
      heroId,
      "isAuthorized",
      "conn-1",
      acquired.sessionEpoch,
      "party:map",
    );
    expect(lapsed).toBe(false);

    // A lapsed lease can no longer be renewed either.
    const renewAfterLapse = await presenceRoom.room.call(
      heroId,
      "renew",
      "conn-1",
      acquired.sessionEpoch,
    );
    expect(renewAfterLapse).toBe(false);
  });
});

describe("handoff", () => {
  test("moves map/x/y and returns sessionEpoch + 1 under the correct fence", async () => {
    const { heroId, mapId } = await newHero("handoffok");
    const acquired = (await presenceRoom.room.call(heroId, "acquire", {
      connectionId: "conn-1",
      roomKey: "party:map",
      zoneId: mapId,
      instanceId: "main",
    })) as { sessionEpoch: number };

    const result = (await presenceRoom.room.call(heroId, "handoff", {
      connectionId: "conn-1",
      sessionEpoch: acquired.sessionEpoch,
      mapId: "next-map",
      x: 111,
      y: 222,
    })) as { sessionEpoch: number } | null;

    expect(result).toEqual({ sessionEpoch: acquired.sessionEpoch + 1 });

    const row = await probe.heroes.findById(heroId);
    expect(row).toMatchObject({
      mapId: "next-map",
      x: 111,
      y: 222,
      sessionEpoch: acquired.sessionEpoch + 1,
    });
  });

  test("a stale epoch returns null and changes no row", async () => {
    const { heroId, mapId } = await newHero("handoffstale");
    const acquired = (await presenceRoom.room.call(heroId, "acquire", {
      connectionId: "conn-1",
      roomKey: "party:map",
      zoneId: mapId,
      instanceId: "main",
    })) as { sessionEpoch: number };

    const before = await probe.heroes.findById(heroId);

    const staleEpoch = acquired.sessionEpoch - 1;
    const result = await presenceRoom.room.call(heroId, "handoff", {
      connectionId: "conn-1",
      sessionEpoch: staleEpoch,
      mapId: "next-map",
      x: 111,
      y: 222,
    });

    expect(result).toBeNull();

    const after = await probe.heroes.findById(heroId);
    expect(after).toEqual(before);
  });
});

describe("cooldown checkpoints", () => {
  test("round-trip under the right connection; a stale connection is refused", async () => {
    const { heroId } = await newHero("cooldownok");
    const acquired = (await presenceRoom.room.call(heroId, "acquire", {
      connectionId: "conn-1",
      roomKey: "party:map",
      zoneId: "map",
      instanceId: "main",
    })) as { sessionEpoch: number };

    // `normalizeCombatCooldowns` bounds a deadline to at most `ATTACK_COOLDOWN_MS` (325ms) ahead
    // of `now` — see `packages/engine/src/cooldowns.ts`'s `boundedDeadline` — so this stays well
    // under that ceiling.
    const cooldowns = {
      ...emptyCombatCooldowns(),
      attackUntil: Date.now() + 100,
    };

    const checkpointed = await presenceRoom.room.call(
      heroId,
      "checkpointCooldowns",
      "conn-1",
      acquired.sessionEpoch,
      cooldowns,
    );
    expect(checkpointed).toBe(true);

    const readBack = await presenceRoom.room.call(
      heroId,
      "readCooldowns",
      "conn-1",
      acquired.sessionEpoch,
    );
    expect(readBack).toEqual(cooldowns);

    // A stale connectionId (never granted this lease) is refused outright.
    const stale = await presenceRoom.room.call(
      heroId,
      "readCooldowns",
      "conn-ghost",
      acquired.sessionEpoch,
    );
    expect(stale).toBeNull();

    // A checkpoint attempt under a stale connection changes nothing and reports failure.
    const staleCheckpoint = await presenceRoom.room.call(
      heroId,
      "checkpointCooldowns",
      "conn-ghost",
      acquired.sessionEpoch,
      cooldowns,
    );
    expect(staleCheckpoint).toBe(false);
    const stillReadable = await presenceRoom.room.call(
      heroId,
      "readCooldowns",
      "conn-1",
      acquired.sessionEpoch,
    );
    expect(stillReadable).toEqual(cooldowns);
  });

  test("readCooldowns returns empty (not null) for an authorized holder with no checkpoint yet", async () => {
    const { heroId } = await newHero("cooldownempty");
    const acquired = (await presenceRoom.room.call(heroId, "acquire", {
      connectionId: "conn-1",
      roomKey: "party:map",
      zoneId: "map",
      instanceId: "main",
    })) as { sessionEpoch: number };

    const readBack = await presenceRoom.room.call(
      heroId,
      "readCooldowns",
      "conn-1",
      acquired.sessionEpoch,
    );
    expect(readBack).toEqual(emptyCombatCooldowns());
  });
});
