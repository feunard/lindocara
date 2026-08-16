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

/** Tile units, grid centre as origin: `x`/`z` ground, `y` elevation. All three travel or none do. */
const HANDOFF_POSITION = { x: 11, y: 2, z: 22 };

describe("handoff", () => {
  test("moves the map and all three axes, returning sessionEpoch + 1 under the correct fence", async () => {
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
      // Three distinct values, one per axis: `x`/`z` are the two GROUND axes and `y` is elevation.
      // A handoff that dropped or swapped one would still typecheck — every axis is a `number` —
      // so the fixture has to make each one individually identifiable.
      ...HANDOFF_POSITION,
    })) as { sessionEpoch: number } | null;

    expect(result).toEqual({ sessionEpoch: acquired.sessionEpoch + 1 });

    const row = await probe.heroes.findById(heroId);
    expect(row).toMatchObject({
      mapId: "next-map",
      ...HANDOFF_POSITION,
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
      ...HANDOFF_POSITION,
    });

    expect(result).toBeNull();

    const after = await probe.heroes.findById(heroId);
    expect(after).toEqual(before);
  });

  test("a building handoff restores and consumes the exact exterior return point", async () => {
    const { heroId, mapId } = await newHero("handoffinterior");
    const acquired = (await presenceRoom.room.call(heroId, "acquire", {
      connectionId: "conn-1",
      roomKey: "party:exterior",
      zoneId: mapId,
      instanceId: "main",
    })) as { sessionEpoch: number };
    const exterior = { mapId, x: 1.375, y: 0.9, z: -2.625 };

    const entered = (await presenceRoom.room.call(heroId, "handoff", {
      connectionId: "conn-1",
      sessionEpoch: acquired.sessionEpoch,
      mapId: "interior-map",
      x: 0,
      y: 0,
      z: 0,
      storeInteriorReturn: exterior,
    })) as { sessionEpoch: number };
    const exited = (await presenceRoom.room.call(heroId, "handoff", {
      connectionId: "conn-1",
      sessionEpoch: entered.sessionEpoch,
      mapId,
      x: 9,
      y: 9,
      z: 9,
      restoreInteriorReturn: true,
    })) as { sessionEpoch: number };

    expect(await probe.heroes.findById(heroId)).toMatchObject(exterior);

    await presenceRoom.room.call(heroId, "handoff", {
      connectionId: "conn-1",
      sessionEpoch: exited.sessionEpoch,
      mapId: "interior-map",
      x: 0,
      y: 0,
      z: 0,
    });
    await presenceRoom.room.call(heroId, "handoff", {
      connectionId: "conn-1",
      sessionEpoch: exited.sessionEpoch + 1,
      mapId,
      x: 4,
      y: 5,
      z: 6,
      restoreInteriorReturn: true,
    });
    expect(await probe.heroes.findById(heroId)).toMatchObject({ mapId, x: 4, y: 5, z: 6 });
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

describe("cooldown promotion", () => {
  test("a still-active cooldown survives a reconnect (new acquire, new connection)", async () => {
    const { heroId } = await newHero("promoteacquire");
    let now = 1_000_000;
    presenceRoom.now = () => now;

    const first = (await presenceRoom.room.call(heroId, "acquire", {
      connectionId: "conn-1",
      roomKey: "party:map",
      zoneId: "map",
      instanceId: "main",
    })) as { sessionEpoch: number };

    const cooldowns = { ...emptyCombatCooldowns(), attackUntil: now + 100 };
    const checkpointed = await presenceRoom.room.call(
      heroId,
      "checkpointCooldowns",
      "conn-1",
      first.sessionEpoch,
      cooldowns,
    );
    expect(checkpointed).toBe(true);

    // Reconnect from a DIFFERENT connection, still well inside the cooldown's window.
    now += 10;
    const second = (await presenceRoom.room.call(heroId, "acquire", {
      connectionId: "conn-2",
      roomKey: "party:map",
      zoneId: "map",
      instanceId: "main",
    })) as { sessionEpoch: number };
    expect(second.sessionEpoch).toBe(first.sessionEpoch + 1);

    // The old connection is dead (lost the race), but the cooldown itself must still be there
    // under the NEW lease — a reconnect must not be a free cooldown reset.
    const readBack = await presenceRoom.room.call(
      heroId,
      "readCooldowns",
      "conn-2",
      second.sessionEpoch,
    );
    expect(readBack).toEqual(cooldowns);
  });

  test("a still-active cooldown survives a map handoff", async () => {
    const { heroId, mapId } = await newHero("promotehandoff");
    let now = 2_000_000;
    presenceRoom.now = () => now;

    const acquired = (await presenceRoom.room.call(heroId, "acquire", {
      connectionId: "conn-1",
      roomKey: "party:map",
      zoneId: mapId,
      instanceId: "main",
    })) as { sessionEpoch: number };

    const cooldowns = { ...emptyCombatCooldowns(), attackUntil: now + 100 };
    const checkpointed = await presenceRoom.room.call(
      heroId,
      "checkpointCooldowns",
      "conn-1",
      acquired.sessionEpoch,
      cooldowns,
    );
    expect(checkpointed).toBe(true);

    now += 10;
    const handedOff = (await presenceRoom.room.call(heroId, "handoff", {
      connectionId: "conn-1",
      sessionEpoch: acquired.sessionEpoch,
      mapId: "next-map",
      ...HANDOFF_POSITION,
    })) as { sessionEpoch: number };
    expect(handedOff.sessionEpoch).toBe(acquired.sessionEpoch + 1);

    const readBack = await presenceRoom.room.call(
      heroId,
      "readCooldowns",
      "conn-1",
      handedOff.sessionEpoch,
    );
    expect(readBack).toEqual(cooldowns);
  });

  test("an already-expired entry is dropped during promotion, not carried forward", async () => {
    const { heroId } = await newHero("promoteexpired");
    let now = 3_000_000;
    presenceRoom.now = () => now;

    const first = (await presenceRoom.room.call(heroId, "acquire", {
      connectionId: "conn-1",
      roomKey: "party:map",
      zoneId: "map",
      instanceId: "main",
    })) as { sessionEpoch: number };

    const cooldowns = { ...emptyCombatCooldowns(), attackUntil: now + 100 };
    await presenceRoom.room.call(
      heroId,
      "checkpointCooldowns",
      "conn-1",
      first.sessionEpoch,
      cooldowns,
    );

    // Advance well past the checkpointed deadline before the next acquire.
    now += 200;
    const second = (await presenceRoom.room.call(heroId, "acquire", {
      connectionId: "conn-2",
      roomKey: "party:map",
      zoneId: "map",
      instanceId: "main",
    })) as { sessionEpoch: number };

    const readBack = await presenceRoom.room.call(
      heroId,
      "readCooldowns",
      "conn-2",
      second.sessionEpoch,
    );
    expect(readBack).toEqual(emptyCombatCooldowns());
  });
});
