/**
 * Deterministic combat invariants for the Alepha world room, the tranche-β counterpart of
 * `world-room-movement.test.ts`: the REAL `WorldRoom` option bag hosted in a bare `RoomEngine`
 * (FakeClock idiom) against real D1 rows created through the ordinary HTTP flow. Timing-sensitive
 * combat assertions drive the exported `worldTick` functions directly with a controlled `now` —
 * the same shape as the legacy isolated-system suite (`test/world-systems.test.ts`) — while
 * wire-visible invariants (chat AOI, personal-loot deltas, the attack intent) go through the
 * engine's real join/message path.
 *
 * Pinned here, ported from the legacy invariant suite:
 * 1. attack consumes its cooldown even on a miss;
 * 2. a monster's strike direction freezes at wind-up and damages only actors inside the capsule
 *    at the active frame;
 * 3. a guard kill grants NO player XP/loot and sets the respawn state directly;
 * 4. monsters skip players who are not `alive` (the corpse run stays winnable);
 * 5. personal loot is omitted from another player's delta (AOI + ownerId);
 * 6. local chat reaches only in-AOI players; oversized chat is dropped;
 * 7. one tick advances players before monsters before guards (composed-state probe, no mocks).
 */

import { MONSTER_ACTIONS, MONSTER_SPECIAL_ACTIONS } from "@lindocara/engine/combat-actions.js";
import {
  ATTACK_COOLDOWN_MS,
  MONSTER_AGGRO_RANGE,
  MONSTER_RESPAWN_MS,
  type MonsterSpawn,
  maxHpForLevel,
  pointDistance,
} from "@lindocara/engine/game.js";
import {
  encodeServerMessage,
  parseServerMessage,
  type ServerMessage,
} from "@lindocara/engine/protocol.js";
import { PLAYER_SPEED, TICK_DT } from "@lindocara/engine/simulation.js";
import { projectileOrigin, spawnProjectile } from "@lindocara/server/world/projectile-system.js";
import {
  CHAT_MAX_LENGTH,
  type CombatActionRuntime,
  createGuards,
  createMonsters,
  type PlayerRuntime,
} from "@lindocara/server/world/world-runtime.js";
import { UserController } from "alepha/api/users";
import { ServerProvider } from "alepha/server";
import { type RoomClock, RoomEngine, type RoomSocket } from "alepha/websocket";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { WorldRoom } from "../src/api/realtime/WorldRoom.ts";
import type { WorldRoomState } from "../src/api/realtime/worldState.ts";
import {
  advanceWorldTick,
  resolveMonsterAction,
  startMonsterAttack,
  startPlayerAction,
  type WorldGlue,
  type WorldTickDeps,
} from "../src/api/realtime/worldTick.ts";
import { createTestApp } from "./helpers.ts";

const PASSWORD = "Sup3rSecret";
const TICK_MS = 50;

/** The RoomEngine.spec FakeClock: intervals fire once per `advance` of their period. */
class FakeClock implements RoomClock {
  protected ms = 0;
  protected handlers = new Map<number, () => void>();
  protected nextId = 1;

  setInterval(fn: () => void): unknown {
    const id = this.nextId;
    this.nextId += 1;
    this.handlers.set(id, fn);
    return id;
  }

  clearInterval(handle: unknown): void {
    this.handlers.delete(handle as number);
  }

  now(): number {
    return this.ms;
  }

  advance(ms: number): void {
    this.ms += ms;
    for (const fn of [...this.handlers.values()]) fn();
  }
}

interface FakeSocket extends RoomSocket {
  sent: string[];
  closed?: { code?: number; reason?: string };
}

function fakeSocket(userId: string, heroId: string): FakeSocket {
  const sent: string[] = [];
  const socket: FakeSocket = {
    id: `c-${heroId}`,
    userId,
    query: { hero: heroId },
    data: {},
    sent,
    closed: undefined,
    sendRaw: (data: string) => {
      sent.push(data);
    },
    close: (code?: number, reason?: string) => {
      socket.closed = { code, reason };
    },
  };
  return socket;
}

let alepha: ReturnType<typeof createTestApp>;
let hostname: string;
let userCount = 0;

beforeEach(async () => {
  alepha = createTestApp();
  await alepha.start();
  hostname = alepha.inject(ServerProvider).hostname;
});

afterEach(async () => {
  await alepha.stop();
});

async function registerAndLogin(prefix: string): Promise<{ token: string; userId: string }> {
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
  const whoami = await fetch(`${hostname}/api/whoami`, {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  });
  const me = (await whoami.json()) as { id: string };
  return { token: tokens.access_token, userId: me.id };
}

function authedFetch(token: string) {
  return (path: string, body?: unknown) =>
    fetch(`${hostname}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
}

interface Fixture {
  userId: string;
  roomId: string;
  partyId: string;
  heroId: string;
}

async function newPlayableHero(prefix: string, heroClass = "warrior"): Promise<Fixture> {
  const { token, userId } = await registerAndLogin(prefix);
  const authed = authedFetch(token);
  const adventureResponse = await authed("/api/adventures", { title: "Donjon", maxPlayers: 4 });
  expect(adventureResponse.status).toBe(201);
  const adventure = (await adventureResponse.json()) as { id: string; defaultMap: { id: string } };
  const partyResponse = await authed("/api/parties", { adventureId: adventure.id });
  expect(partyResponse.status).toBe(201);
  const partyId = ((await partyResponse.json()) as { id: string }).id;
  const heroResponse = await authed(`/api/parties/${partyId}/heroes`, {
    name: "Mira",
    class: heroClass,
  });
  expect(heroResponse.status).toBe(201);
  const heroId = ((await heroResponse.json()) as { id: string }).id;
  return { userId, roomId: `${partyId}:${adventure.defaultMap.id}`, partyId, heroId };
}

/** A second account joins the host's party and creates its own hero — two heroes, one room. */
async function joinAsSecondHero(
  host: Fixture,
  prefix: string,
): Promise<{ userId: string; heroId: string }> {
  const { token, userId } = await registerAndLogin(prefix);
  const authed = authedFetch(token);
  const joinResponse = await authed(`/api/parties/${host.partyId}/join`);
  expect(joinResponse.status).toBe(204);
  const heroResponse = await authed(`/api/parties/${host.partyId}/heroes`, {
    name: "Liin",
    class: "warrior",
  });
  expect(heroResponse.status).toBe(201);
  const heroId = ((await heroResponse.json()) as { id: string }).id;
  return { userId, heroId };
}

/** Hosts the real WorldRoom options in a bare engine driven by the fake clock. */
function createEngine(roomId: string, clock: FakeClock) {
  const worldRoom = alepha.inject(WorldRoom);
  return new RoomEngine({
    roomId,
    clock,
    options: worldRoom.roomOptions,
    validate: () => {},
  });
}

/** `RoomEngine.state` is protected only at compile time; the invariants below assert on the real
 *  room state (players, monsters, loot) the way the legacy workerd suite asserts on the real DO. */
function roomState(engine: object): WorldRoomState {
  return (engine as unknown as { state: WorldRoomState }).state;
}

function playerOf(state: WorldRoomState, heroId: string): PlayerRuntime {
  const connectionId = state.connectionIdByHeroId.get(heroId);
  const player = connectionId === undefined ? undefined : state.players.get(connectionId);
  if (!player) throw new Error(`hero ${heroId} is not in the room`);
  return player;
}

/**
 * A recording `WorldGlue` over the engine's real state, with a test-controlled clock — every
 * cross-boundary seam is inert, exactly the Task 6/7/8 stub shape `WorldRoom.glue()` wires.
 */
function testGlue(
  state: WorldRoomState,
  now: () => number,
): { w: WorldGlue; sent: Map<string, ServerMessage[]> } {
  const sent = new Map<string, ServerMessage[]>();
  const deps: WorldTickDeps = {
    now,
    send: (connectionId, message) => {
      const list = sent.get(connectionId);
      if (list) list.push(message);
      else sent.set(connectionId, [message]);
    },
    waitUntil: () => {},
    renewPresence: async () => {},
    savePlayer: async () => true,
    presenceHeartbeatMs: 10_000,
    navigationDebugAvailable: false,
    markPermanentMonsterDefeated: () => {},
    recordQuestEvent: () => {},
    broadcastToParty: () => {},
    applyStateChanges: async () => {},
    acceptAuthoredQuest: async () => ({ ok: false, reason: "party" }),
    abandonAuthoredQuest: async () => ({ ok: false, reason: "party" }),
    completeAuthoredQuest: async () => ({ ok: false, reason: "party" }),
    completeAdventure: async () => {},
    cheatsEnabled: false,
    transitionAdventureExit: () => {},
    teleportCrossMap: () => {},
    claimQuestReward: async () => false,
    reserveHarvestNode: async () => ({ ok: false, reason: "party" }),
    hitHarvestNode: async () => ({ ok: false, reason: "party" }),
    cancelHarvestNode: async () => false,
    claimHarvestGold: async () => false,
    consumePotion: async () => null,
  };
  return { w: { state, deps }, sent };
}

function sentTo(sent: Map<string, ServerMessage[]>, heroId: string): ServerMessage[] {
  return sent.get(`c-${heroId}`) ?? [];
}

function seedMonster(
  state: WorldRoomState,
  id: string,
  x: number,
  y: number,
  overrides: Partial<Pick<MonsterSpawn, "maxHp" | "species" | "kind" | "attackProfile">> = {},
) {
  const [monster] = createMonsters([
    {
      id,
      kind: "goblin",
      species: "torch_goblin",
      zone: "route",
      x,
      y,
      patrolRadius: 0,
      ...overrides,
    },
  ]);
  if (!monster) throw new Error("seed produced no monster");
  state.monsters.push(monster);
  state.monsterGrid.insert(monster);
  return monster;
}

function seedGuard(state: WorldRoomState, id: string, x: number, y: number) {
  const [guard] = createGuards([{ id, x, y, patrolRadius: 120 }]);
  if (!guard) throw new Error("seed produced no guard");
  state.guards.push(guard);
  return guard;
}

describe("world room combat (FakeClock)", () => {
  test("disconnect removes a Peasant harvest channel from the real room", async () => {
    const { userId, roomId, heroId } = await newPlayableHero("harvleave", "peasant");
    const clock = new FakeClock();
    const engine = createEngine(roomId, clock);
    const socket = fakeSocket(userId, heroId);
    await engine.join(socket);
    const state = roomState(engine);
    state.harvestJobs.set(heroId, {
      id: crypto.randomUUID(),
      heroId,
      connectionId: socket.id,
      slot: 1,
      tool: "axe",
      targetKind: "map_event",
      targetRuntimeId: "11111111-1111-4111-8111-111111111111",
      nodeId: "11111111-1111-4111-8111-111111111111",
      generation: 0,
      direction: { x: 1, y: 0 },
      startedAt: 1_000,
      completesAt: 2_000,
      committing: false,
    });

    await engine.leave(socket.id);

    expect(state.harvestJobs.size).toBe(0);
    expect(state.connectionIdByHeroId.has(heroId)).toBe(false);
    engine.dispose();
  });

  test("map-authored ability locks are enforced by the room authority", async () => {
    const { userId, roomId, heroId } = await newPlayableHero("abilitylock");
    const clock = new FakeClock();
    const engine = createEngine(roomId, clock);
    await engine.join(fakeSocket(userId, heroId));
    const state = roomState(engine);
    const player = playerOf(state, heroId);
    const settings = state.location?.definition.heroSettings;
    if (!settings) throw new Error("authored map did not carry hero settings");
    settings.classes.warrior.disabledSkills = [1, 3];
    const { w, sent } = testGlue(state, () => Date.now() + 1_000);

    expect(startPlayerAction(w, `c-${heroId}`, player, 1)).toBe(false);
    expect(player.lastAttackAt).toBe(0);
    expect(sentTo(sent, heroId)).toContainEqual({
      t: "event",
      code: "skill.disabled",
      params: { skill: "cleave" },
      tone: "info",
    });
    engine.dispose();
  });

  test("Dance Master opens its free reactivation only after the dance sequence ends", async () => {
    const { userId, roomId, heroId } = await newPlayableHero("dancemaster", "rogue");
    const clock = new FakeClock();
    const engine = createEngine(roomId, clock);
    await engine.join(fakeSocket(userId, heroId));
    const state = roomState(engine);
    const player = playerOf(state, heroId);
    player.level = 10;
    player.talents = [
      "rogue.shadow_dance.force",
      "rogue.shadow_dance.reach",
      "rogue.shadow_dance.readiness",
      "rogue.shadow_dance.dark_harvest",
      "rogue.shadow_dance.dance_master",
    ];
    player.facing = { x: 1, y: 0 };
    seedMonster(state, "dance-mark", player.x + 120, player.y, { maxHp: 5_000 });
    let t = Date.now() + 1_000;
    const { w } = testGlue(state, () => t);
    expect(startPlayerAction(w, `c-${heroId}`, player, 5)).toBe(true);
    const impactAt = player.action?.impactAt;
    if (impactAt === undefined) throw new Error("missing Shadow Dance impact");
    const cooldownUntil = player.skillCooldowns[4];
    t = impactAt;
    advanceWorldTick(w);
    const mark = player.rogueDanceMarks[0];
    if (!mark) throw new Error("missing Dance Master mark");
    expect(mark.availableAt).toBe(player.rogueShadowDanceInvulnerableUntil);
    expect(mark.expiresAt).toBe(mark.availableAt + 2_000);

    const danceLanding = { x: player.x, y: player.y };
    player.x -= 100;
    state.playerGrid.update(player, danceLanding);
    const repositionOrigin = { x: player.x, y: player.y };

    expect(startPlayerAction(w, `c-${heroId}`, player, 5)).toBe(false);
    expect(player).toMatchObject(repositionOrigin);
    expect(player.rogueDanceMarks).toEqual([mark]);

    t = mark.availableAt;
    expect(startPlayerAction(w, `c-${heroId}`, player, 5)).toBe(true);
    expect(pointDistance(player, repositionOrigin)).toBeGreaterThan(20);
    expect(player.rogueDanceMarks).toEqual([]);
    expect(player.skillCooldowns[4]).toBe(cooldownUntil);
    engine.dispose();
  });

  test("Polarity Orb preserves Mercy's nearest-corpse resurrection", async () => {
    const host = await newPlayableHero("orbmercy", "priest");
    const ally = await joinAsSecondHero(host, "orbmercyally");
    const clock = new FakeClock();
    const engine = createEngine(host.roomId, clock);
    await engine.join(fakeSocket(host.userId, host.heroId));
    await engine.join(fakeSocket(ally.userId, ally.heroId));
    const state = roomState(engine);
    const priest = playerOf(state, host.heroId);
    const corpse = playerOf(state, ally.heroId);
    priest.level = 10;
    priest.talents = ["priest.divine_nova.mercy", "priest.divine_nova.polarity_orb"];
    corpse.life = "corpse";
    corpse.hp = 0;
    corpse.x = priest.x + 20;
    corpse.y = priest.y;
    corpse.corpse = { x: corpse.x, y: corpse.y };

    let t = Date.now() + 1_000;
    const { w } = testGlue(state, () => t);
    expect(startPlayerAction(w, `c-${host.heroId}`, priest, 5)).toBe(true);
    const impactAt = priest.action?.impactAt;
    if (impactAt === undefined) throw new Error("missing Divine Nova impact");
    t = impactAt;
    advanceWorldTick(w);

    expect(state.polarityOrbs).toHaveLength(1);
    expect(corpse.life).toBe("alive");
    expect(corpse.corpse).toBeNull();
    expect(corpse.hp).toBeGreaterThan(0);
    engine.dispose();
  });

  test("attack consumes its cooldown even on a miss", async () => {
    const { userId, roomId, heroId } = await newPlayableHero("attackmiss");
    const clock = new FakeClock();
    const engine = createEngine(roomId, clock);
    const socket = fakeSocket(userId, heroId);
    await engine.join(socket);
    const state = roomState(engine);
    const player = playerOf(state, heroId);
    expect(state.monsters).toHaveLength(0); // nothing to hit: the swing below MUST miss

    let t = Date.now() + 1_000;
    const { w, sent } = testGlue(state, () => t);
    const connectionId = `c-${heroId}`;

    expect(startPlayerAction(w, connectionId, player, 1)).toBe(true);
    const castAt = t;
    // The cooldown is spent the moment the action is ACCEPTED, before anything resolves.
    expect(player.lastAttackAt).toBe(castAt);

    // Resolve the active frame with no target in range: a miss is valid and refunds nothing.
    t = castAt + MONSTER_ACTIONS.torch_goblin.anticipationMs + 400; // well past impact + recovery
    advanceWorldTick(w);
    expect(player.lastAttackAt).toBe(castAt);
    const hits = sentTo(sent, heroId).filter(
      (message) => message.t === "event" && message.code === "combat.hit",
    );
    expect(hits).toHaveLength(0);

    // Inside the cooldown window (action long recovered) a second attack is refused...
    t = castAt + ATTACK_COOLDOWN_MS - 1;
    expect(startPlayerAction(w, connectionId, player, 1)).toBe(false);
    expect(player.lastAttackAt).toBe(castAt);
    // ...and accepted again once the cooldown lapses.
    t = castAt + ATTACK_COOLDOWN_MS + 400;
    expect(startPlayerAction(w, connectionId, player, 1)).toBe(true);
    expect(player.lastAttackAt).toBe(t);
    engine.dispose();
  });

  test("a monster's strike direction freezes at wind-up and damages only actors in the capsule at the active frame", async () => {
    const host = await newPlayableHero("windup");
    const guest = await joinAsSecondHero(host, "windupguest");
    const clock = new FakeClock();
    const engine = createEngine(host.roomId, clock);
    await engine.join(fakeSocket(host.userId, host.heroId));
    await engine.join(fakeSocket(guest.userId, guest.heroId));
    const state = roomState(engine);
    const target = playerOf(state, host.heroId); // the wind-up's chosen target
    const bystander = playerOf(state, guest.heroId);

    let t = Date.now() + 1_000;
    const { w, sent } = testGlue(state, () => t);

    // The monster winds up eastward at the target standing inside its reach.
    const monster = seedMonster(state, "freeze-1", target.x - 40, target.y);
    bystander.x = monster.x;
    bystander.y = monster.y - 400; // far north: outside the capsule at wind-up
    startMonsterAttack(w, monster, target, t);
    const action = monster.action;
    if (!action) throw new Error("wind-up did not start an action");
    const frozenDirection = { ...action.direction };
    expect(frozenDirection.x).toBeCloseTo(1);
    expect(frozenDirection.y).toBeCloseTo(0);

    // During anticipation the TARGET escapes and the BYSTANDER walks into the frozen capsule.
    target.x = monster.x + 500;
    bystander.x = monster.x + 40;
    bystander.y = monster.y;
    const maxHp = maxHpForLevel(1);
    expect(target.hp).toBe(maxHp);
    expect(bystander.hp).toBe(maxHp);

    t += MONSTER_ACTIONS.torch_goblin.anticipationMs;
    expect(t).toBeGreaterThanOrEqual(action.impactAt);
    resolveMonsterAction(w, monster, action, t);

    // Direction stayed frozen: it never re-aimed at where the target went.
    expect(action.direction).toEqual(frozenDirection);
    expect(monster.facing).toEqual(frozenDirection);
    // Only the actor inside the capsule at the active frame is damaged.
    expect(bystander.hp).toBeLessThan(maxHp);
    expect(target.hp).toBe(maxHp);
    const hurt = sentTo(sent, guest.heroId).filter(
      (message) => message.t === "event" && message.code === "combat.hurt",
    );
    expect(hurt).toHaveLength(1);
    expect(sentTo(sent, host.heroId).some((m) => m.t === "event" && m.code === "combat.hurt")).toBe(
      false,
    );
    engine.dispose();
  });

  test("a shaman resolves its attack as a server-authored magic projectile", async () => {
    const { userId, roomId, heroId } = await newPlayableHero("shamanbolt");
    const clock = new FakeClock();
    const engine = createEngine(roomId, clock);
    await engine.join(fakeSocket(userId, heroId));
    const state = roomState(engine);
    const target = playerOf(state, heroId);
    const t = Date.now() + 1_000;
    const { w } = testGlue(state, () => t);
    const monster = seedMonster(state, "shaman-ranged", target.x - 180, target.y, {
      species: "hex_shaman",
      kind: "shaman",
    });

    startMonsterAttack(w, monster, target, t);
    const action = monster.action;
    if (!action) throw new Error("shaman wind-up did not start");
    resolveMonsterAction(w, monster, action, action.impactAt);

    expect(target.hp).toBe(maxHpForLevel(1));
    expect(state.projectiles).toEqual([
      expect.objectContaining({
        ownerId: monster.id,
        kind: "hex_orb",
        targetFilter: "players_and_guards",
        power: monster.damage,
      }),
    ]);
    engine.dispose();
  });

  test("an explicit arrow profile fires once on acceptance regardless of appearance", async () => {
    const { userId, roomId, heroId } = await newPlayableHero("profilearrow");
    const clock = new FakeClock();
    const engine = createEngine(roomId, clock);
    await engine.join(fakeSocket(userId, heroId));
    const state = roomState(engine);
    const target = playerOf(state, heroId);
    const now = Date.now() + 1_000;
    const { w, sent } = testGlue(state, () => now);
    const monster = seedMonster(state, "explicit-archer", target.x - 180, target.y, {
      species: "spear_goblin",
      attackProfile: "arrow",
    });
    monster.graphicAssetId = null;

    startMonsterAttack(w, monster, target, now);
    const action = monster.action;
    if (!action) throw new Error("archer attack did not start");
    expect(action.impactAt).toBe(now);
    expect(state.projectiles).toHaveLength(0);

    advanceWorldTick(w);

    expect(state.projectiles).toEqual([
      expect.objectContaining({
        actionId: action.id,
        ownerId: monster.id,
        kind: "arrow",
        targetFilter: "players_and_guards",
      }),
    ]);
    expect(
      sentTo(sent, heroId).filter(
        (message) => message.t === "animation" && message.actionId === action.id,
      ),
    ).toEqual([
      expect.objectContaining({
        t: "animation",
        startedAt: now,
        impactAt: now,
        recoveryEndsAt: now + 620,
      }),
    ]);

    // The action's resolved flag, not a timer-specific workaround, owns the single spawn.
    advanceWorldTick(w);
    expect(state.projectiles).toHaveLength(1);
    expect(state.projectiles[0]?.actionId).toBe(action.id);
    engine.dispose();
  });

  test("enemy projectiles use the shared guard damage rule exactly once", async () => {
    const { userId, roomId, heroId } = await newPlayableHero("guardproj");
    const clock = new FakeClock();
    const engine = createEngine(roomId, clock);
    await engine.join(fakeSocket(userId, heroId));
    const state = roomState(engine);
    const player = playerOf(state, heroId);
    const combatOrigin = { x: player.x, y: player.y };
    player.x += 600;
    const monster = seedMonster(state, "guard-projectile-owner", combatOrigin.x, combatOrigin.y);
    const guard = seedGuard(state, "projectile-target-guard", combatOrigin.x + 40, combatOrigin.y);
    let now = Date.now() + 1_000;
    const { w } = testGlue(state, () => now);

    const launchAtGuard = (power: number) => {
      const projectile = spawnProjectile(state.projectiles, {
        actionId: crypto.randomUUID(),
        owner: monster,
        roomKey: state.roomKey,
        origin: projectileOrigin(monster, { x: 1, y: 0 }, 5),
        direction: { x: 1, y: 0 },
        definition: { kind: "arrow", speed: 540, radius: 5, pierce: 0 },
        range: 300,
        power,
        targetFilter: "players_and_guards",
        sourceSkillId: "monster_ranged_attack",
        basic: true,
        now,
      });
      if (!projectile) throw new Error("enemy projectile fixture rejected");
      monster.deadUntil = Number.POSITIVE_INFINITY;
      now += TICK_MS;
      advanceWorldTick(w);
    };

    guard.hp = 30;
    launchAtGuard(17);
    expect(guard.hp).toBe(13);
    now += TICK_MS;
    advanceWorldTick(w);
    expect(guard.hp).toBe(13);

    launchAtGuard(99);
    expect(guard.hp).toBe(1);
    expect(state.guards).toContain(guard);

    guard.hp = 5;
    monster.deadUntil = 0;
    monster.action = null;
    monster.attackProfile = "melee";
    startMonsterAttack(w, monster, guard, now);
    const action = monster.action as CombatActionRuntime | null;
    if (!action) throw new Error("melee guard attack did not start");
    resolveMonsterAction(w, monster, action, action.impactAt);
    expect(guard.hp).toBe(1);
    expect(state.guards).toContain(guard);
    engine.dispose();
  });

  test("elite and boss special wind-ups remain valid on the client wire", async () => {
    const { userId, roomId, heroId } = await newPlayableHero("bosswire");
    const clock = new FakeClock();
    const engine = createEngine(roomId, clock);
    await engine.join(fakeSocket(userId, heroId));
    const state = roomState(engine);
    const target = playerOf(state, heroId);
    const monsters = createMonsters([
      {
        id: "elite-wire-1",
        name: "ELITE",
        kind: "troll",
        species: "gate_troll",
        zone: "gate",
        x: target.x - 40,
        y: target.y,
        patrolRadius: 10,
        rank: "elite",
        maxHp: 900,
        damage: 45,
        speed: 120,
        xp: 900,
        weakness: "none",
        weaknessPercent: 150,
        specialTechnique: "troll_quake",
      },
      {
        id: "boss-wire-1",
        name: "BOSS",
        kind: "troll",
        species: "gate_troll",
        zone: "gate",
        x: target.x - 40,
        y: target.y,
        patrolRadius: 10,
        rank: "boss",
        maxHp: 2_000,
        damage: 70,
        speed: 150,
        xp: 2_000,
        weakness: "none",
        weaknessPercent: 150,
        specialTechnique: "troll_quake",
      },
    ]);
    expect(monsters).toHaveLength(2);
    for (const monster of monsters) {
      state.monsters.push(monster);
      state.monsterGrid.insert(monster);
    }

    const t = Date.now() + 1_000;
    const { w, sent } = testGlue(state, () => t);
    for (const monster of monsters) startMonsterAttack(w, monster, target, t);

    expect(monsters.map((monster) => monster.action)).toEqual([
      expect.objectContaining({ kind: "monster_attack", skillId: "troll_quake" }),
      expect.objectContaining({ kind: "monster_attack", skillId: "troll_quake" }),
    ]);
    const animations = sentTo(sent, heroId).filter(
      (message) => message.t === "animation" && message.skillId === "troll_quake",
    );
    expect(animations).toHaveLength(2);
    for (const animation of animations) {
      expect(animation).toMatchObject({
        t: "animation",
        actorKind: "monster",
        action: "skill",
        skillId: "troll_quake",
      });
      expect(parseServerMessage(encodeServerMessage(animation))).toMatchObject({
        t: "animation",
        actorKind: "monster",
        skillId: "troll_quake",
      });
    }
    engine.dispose();
  });

  test("a heavy special emits one typed impact on its unchanged authoritative damage tick", async () => {
    const { userId, roomId, heroId } = await newPlayableHero("quakeimpact");
    const clock = new FakeClock();
    const engine = createEngine(roomId, clock);
    await engine.join(fakeSocket(userId, heroId));
    const state = roomState(engine);
    const target = playerOf(state, heroId);
    const monster = seedMonster(state, "quake-impact-1", target.x - 40, target.y, {
      species: "gate_troll",
      kind: "troll",
    });
    monster.specialTechnique = "troll_quake";
    monster.damage = 20;
    monster.nextSpecialAt = 0;
    let now = Date.now() + 1_000;
    const { w, sent } = testGlue(state, () => now);
    const hpBefore = target.hp;

    startMonsterAttack(w, monster, target, now);
    const action = monster.action;
    if (!action) throw new Error("troll quake did not start");
    expect(action.skillId).toBe("troll_quake");
    expect(action.impactAt).toBe(now + MONSTER_SPECIAL_ACTIONS.troll_quake.anticipationMs);
    expect(
      sentTo(sent, heroId).filter((message) => message.t === "monster.special_impact"),
    ).toHaveLength(0);

    now = action.impactAt;
    advanceWorldTick(w);

    expect(target.hp).toBe(
      hpBefore - Math.round(monster.damage * MONSTER_SPECIAL_ACTIONS.troll_quake.damageMultiplier),
    );
    const impacts = sentTo(sent, heroId).filter(
      (message) => message.t === "monster.special_impact" && message.actionId === action.id,
    );
    expect(impacts).toEqual([
      {
        t: "monster.special_impact",
        actionId: action.id,
        actorId: monster.id,
        technique: "troll_quake",
        x: monster.x + 16,
        y: monster.y + 16,
        direction: action.direction,
        impactAt: now,
      },
    ]);
    expect(parseServerMessage(encodeServerMessage(impacts[0] as ServerMessage))).toEqual(
      impacts[0],
    );
    expect(
      sentTo(sent, heroId).filter(
        (message) => message.t === "event" && message.code === "combat.hurt",
      ),
    ).toEqual([
      expect.objectContaining({
        params: expect.objectContaining({ technique: "troll_quake" }),
      }),
    ]);

    advanceWorldTick(w);
    expect(
      sentTo(sent, heroId).filter(
        (message) => message.t === "monster.special_impact" && message.actionId === action.id,
      ),
    ).toHaveLength(1);
    expect(target.hp).toBe(
      hpBefore - Math.round(monster.damage * MONSTER_SPECIAL_ACTIONS.troll_quake.damageMultiplier),
    );
    engine.dispose();
  });

  test("a guard kill grants no player XP or loot and sets the respawn state directly", async () => {
    const { userId, roomId, heroId } = await newPlayableHero("guardkill");
    const clock = new FakeClock();
    const engine = createEngine(roomId, clock);
    await engine.join(fakeSocket(userId, heroId));
    const state = roomState(engine);
    const player = playerOf(state, heroId);
    const xpBefore = player.xp;

    // Monster and guard together, the hero far outside aggro range: only the guard can kill.
    const monster = seedMonster(state, "guarded-1", player.x - 600, player.y);
    monster.respawnDelayMs = 42_000;
    seedGuard(state, "guard-1", monster.x, monster.y + 40);
    expect(pointDistance(monster, player)).toBeGreaterThan(MONSTER_AGGRO_RANGE);

    const t = Date.now() + 1_000;
    const { w, sent } = testGlue(state, () => t);
    advanceWorldTick(w);

    // Killed by GUARD_DAMAGE, respawn state set directly — never the reward path.
    expect(monster.hp).toBe(0);
    expect(monster.deadUntil).toBe(t + 42_000);
    expect(monster.rewardsGranted).toBe(false);
    expect(state.loot).toHaveLength(0);
    expect(player.xp).toBe(xpBefore);
    const rewardMessages = sentTo(sent, heroId).filter(
      (message) =>
        message.t === "event" &&
        (message.code === "monster.defeated" || message.code === "level_up"),
    );
    expect(rewardMessages).toHaveLength(0);
    engine.dispose();
  });

  test("monsters skip players who are not alive", async () => {
    const { userId, roomId, heroId } = await newPlayableHero("corpserun");
    const clock = new FakeClock();
    const engine = createEngine(roomId, clock);
    await engine.join(fakeSocket(userId, heroId));
    const state = roomState(engine);
    const player = playerOf(state, heroId);

    // A monster parked right on top of a corpse: close enough to strike anything alive.
    const monster = seedMonster(state, "camper-1", player.x + 30, player.y);
    player.life = "corpse";
    player.corpse = { x: player.x, y: player.y };
    const hpBefore = player.hp;

    let t = Date.now() + 1_000;
    const { w } = testGlue(state, () => t);
    for (let tick = 0; tick < 5; tick += 1) {
      t += TICK_MS;
      advanceWorldTick(w);
    }
    // No threat, no wind-up, no damage: the corpse run stays winnable.
    expect(monster.threat.size).toBe(0);
    expect(monster.action).toBeNull();
    expect(player.hp).toBe(hpBefore);

    // Positive control: the same setup with a LIVING player is attacked on the very next tick.
    player.life = "alive";
    player.corpse = null;
    t += TICK_MS;
    advanceWorldTick(w);
    expect(monster.threat.has(heroId)).toBe(true);
    expect(monster.action).not.toBeNull();
    engine.dispose();
  });

  test("personal loot is omitted from another player's delta", async () => {
    const host = await newPlayableHero("lootowner");
    const guest = await joinAsSecondHero(host, "lootpeer");
    const clock = new FakeClock();
    const engine = createEngine(host.roomId, clock);
    const hostSocket = fakeSocket(host.userId, host.heroId);
    const guestSocket = fakeSocket(guest.userId, guest.heroId);
    await engine.join(hostSocket);
    await engine.join(guestSocket);
    const state = roomState(engine);
    const owner = playerOf(state, host.heroId);

    // Personal loot inside BOTH players' loot AOI (650px) but outside pickup range (46px).
    const lootId = "personal-loot-1";
    const item = {
      id: lootId,
      kind: "gold" as const,
      amount: 4,
      x: owner.x + 200,
      y: owner.y,
      expiresAt: Date.now() + 60_000,
      ownerId: owner.id,
    };
    state.loot.push(item);
    state.lootGrid.insert(item);

    for (let tick = 0; tick < 4; tick += 1) clock.advance(TICK_MS);

    const hostDeltas = hostSocket.sent.filter((raw) => raw.includes('"world.delta"'));
    const guestFrames = guestSocket.sent;
    expect(hostDeltas.some((raw) => raw.includes(lootId))).toBe(true);
    expect(guestFrames.some((raw) => raw.includes(lootId))).toBe(false);
    engine.dispose();
  });

  test("local chat reaches only in-AOI players and oversized chat is dropped", async () => {
    const host = await newPlayableHero("chatnear");
    const guest = await joinAsSecondHero(host, "chatfar");
    const clock = new FakeClock();
    const engine = createEngine(host.roomId, clock);
    const hostSocket = fakeSocket(host.userId, host.heroId);
    const guestSocket = fakeSocket(guest.userId, guest.heroId);
    await engine.join(hostSocket);
    await engine.join(guestSocket);
    const state = roomState(engine);
    const speaker = playerOf(state, host.heroId);
    const listener = playerOf(state, guest.heroId);

    // Same spot first: local chat reaches both sides.
    await engine.message(hostSocket.id, { t: "chat", channel: "local", text: "par ici" });
    expect(hostSocket.sent.some((raw) => raw.includes("par ici"))).toBe(true);
    expect(guestSocket.sent.some((raw) => raw.includes("par ici"))).toBe(true);

    // Move the listener beyond LOCAL_CHAT_RADIUS (700px): the next line no longer reaches them.
    const previous = { x: listener.x, y: listener.y };
    listener.x = speaker.x - 2_000;
    state.playerGrid.update(listener, previous);
    await engine.message(hostSocket.id, { t: "chat", channel: "local", text: "trop loin" });
    expect(hostSocket.sent.some((raw) => raw.includes("trop loin"))).toBe(true);
    expect(guestSocket.sent.some((raw) => raw.includes("trop loin"))).toBe(false);

    // Oversized chat is rejected outright — nobody receives it, not even the sender.
    const oversized = "x".repeat(CHAT_MAX_LENGTH + 1);
    await engine.message(hostSocket.id, { t: "chat", channel: "local", text: oversized });
    expect(hostSocket.sent.some((raw) => raw.includes(oversized))).toBe(false);
    engine.dispose();
  });

  test("one tick advances players before monsters before guards", async () => {
    const { userId, roomId, heroId } = await newPlayableHero("tickorder");
    const clock = new FakeClock();
    const engine = createEngine(roomId, clock);
    await engine.join(fakeSocket(userId, heroId));
    const state = roomState(engine);
    const player = playerOf(state, heroId);

    // Probe A (players → monsters): the hero starts just OUTSIDE M1's aggro radius and has one
    // queued eastward command whose movement lands INSIDE it. M1 acquires threat this very tick
    // only if movement was applied before the monster pass read positions.
    const moved = PLAYER_SPEED * TICK_DT;
    const m1 = seedMonster(
      state,
      "order-aggro",
      player.x + MONSTER_AGGRO_RANGE + moved / 2,
      player.y,
    );
    expect(pointDistance(m1, player)).toBeGreaterThan(MONSTER_AGGRO_RANGE);
    player.queue.push({
      seq: player.lastSeq + 1,
      input: { up: false, down: false, left: false, right: true },
    });
    player.lastSeq += 1;

    // Probe B (monsters → guards): M2 stands at strike range of the hero with a guard beside it.
    // The monster pass starts M2's wind-up (an `animation` broadcast); the guard pass then kills
    // M2 in the same tick, cancelling the action. Had guards run first, M2 would already be dead
    // when the monster pass ran and no wind-up could ever have been observed.
    const m2 = seedMonster(state, "order-victim", player.x - 30, player.y);
    seedGuard(state, "order-guard", m2.x, m2.y + 40);

    const t = Date.now() + 1_000;
    const { w, sent } = testGlue(state, () => t);
    expect(m1.threat.has(heroId)).toBe(false);
    advanceWorldTick(w);

    // Players before monsters: this tick's movement is what put the hero inside M1's aggro ring.
    expect(pointDistance(m1, player)).toBeLessThan(MONSTER_AGGRO_RANGE);
    expect(m1.threat.has(heroId)).toBe(true);

    // Monsters before guards: the wind-up happened (broadcast while M2 was alive), THEN the guard
    // kill landed and cancelled it — all inside one tick.
    const windUps = sentTo(sent, heroId).filter(
      (message) => message.t === "animation" && message.actorId === m2.id,
    );
    expect(windUps).toHaveLength(1);
    expect(m2.deadUntil).toBe(t + MONSTER_RESPAWN_MS);
    expect(m2.action).toBeNull();
    engine.dispose();
  });
});
