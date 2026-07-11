/**
 * End-to-end through the real Durable Object: a real WebSocket, the real tick loop, the
 * real simulation. Nothing here is mocked, so a passing run means a browser would work.
 */

import { env, runInDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { type Attachment, positionFromAttachment } from "../src/server/world.js";
import {
  isWalkable,
  OBSTACLES,
  type PlayerClass,
  QUEST_NPC,
  SAFE_ZONE,
  spawnPosition,
  WORLD_BOUNDARY_DEPTH,
  WORLD_LANDMARKS,
} from "../src/shared/game.js";
import {
  type PlayerSnapshot,
  parseServerMessage,
  type ServerMessage,
} from "../src/shared/protocol.js";
import {
  type Input,
  NO_INPUT,
  PLAYER_SIZE,
  PLAYER_SPEED,
  TICK_DT,
  TICK_MS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "../src/shared/simulation.js";

const ORIGIN = "https://lindocara.test";

interface TestCharacter {
  cookie: string;
  characterId: string;
}

let accountCounter = 0;

interface TestCharacterOptions {
  position?: { x: number; y: number };
  class?: PlayerClass;
  hp?: number;
}

/** Register a fresh account and create one character on it through the real API. */
async function testCharacter(
  name: string,
  options: TestCharacterOptions = {},
): Promise<TestCharacter> {
  const username = `u${++accountCounter}${name}`.toLowerCase().slice(0, 16);
  const registered = await SELF.fetch(`${ORIGIN}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "12345678" }),
  });
  expect(registered.status).toBe(200);
  const pair = registered.headers.get("Set-Cookie")?.split(";")[0];
  if (!pair) throw new Error("no session cookie issued");

  const created = await SELF.fetch(`${ORIGIN}/api/characters`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: pair },
    body: JSON.stringify({ name, appearance: "azure", class: options.class ?? "warrior" }),
  });
  expect(created.status).toBe(200);
  const body = (await created.json()) as { id: string };

  if (options.position) {
    await env.DB.prepare("UPDATE character SET x = ?, y = ? WHERE id = ?")
      .bind(options.position.x, options.position.y, body.id)
      .run();
  }
  if (options.hp !== undefined) {
    await env.DB.prepare("UPDATE character SET hp = ? WHERE id = ?")
      .bind(options.hp, body.id)
      .run();
  }
  return { cookie: pair, characterId: body.id };
}

/**
 * A connected player, recording everything the world tells it.
 *
 * Like a real client it pumps one numbered command per tick, because the server applies at
 * most one per tick and repeats the last intent only briefly before assuming the client died.
 */
class Client {
  readonly received: ServerMessage[] = [];
  closeInfo: { code: number; reason: string } | null = null;
  #socket: WebSocket;
  #input: Input = NO_INPUT;
  #seq = 0;
  #pump: ReturnType<typeof setInterval> | null = null;

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.accept();
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      const message = parseServerMessage(event.data);
      if (message) this.received.push(message);
    });
    socket.addEventListener("close", (event) => {
      this.closeInfo = { code: event.code, reason: event.reason };
      this.stopPump();
    });
  }

  static async join(
    nickname: string,
    options: {
      pump?: boolean;
      position?: { x: number; y: number };
      class?: PlayerClass;
      hp?: number;
    } = {},
  ): Promise<Client> {
    const session = await testCharacter(nickname, options);
    return Client.joinCharacter(session, options);
  }

  /** Join with an already-created character, e.g. one the test needs to keep the cookie for. */
  static async joinCharacter(
    session: TestCharacter,
    options: { pump?: boolean } = {},
  ): Promise<Client> {
    const response = await SELF.fetch(`${ORIGIN}/api/ws?character=${session.characterId}`, {
      headers: { Upgrade: "websocket", Cookie: session.cookie },
    });

    expect(response.status).toBe(101);
    const socket = response.webSocket;
    if (!socket) throw new Error("expected a websocket in the 101 response");

    const client = new Client(socket);
    if (options.pump !== false) client.startPump();
    return client;
  }

  /** Emit the currently-held intent once per tick, exactly as the browser does. */
  startPump(): void {
    if (this.#pump !== null) return;
    this.#pump = setInterval(() => this.sendCommand(this.#input), TICK_MS);
  }

  stopPump(): void {
    if (this.#pump === null) return;
    clearInterval(this.#pump);
    this.#pump = null;
  }

  /** Next sequence number, sent with the given intent. */
  sendCommand(input: Input): number {
    const seq = ++this.#seq;
    this.#socket.send(JSON.stringify({ t: "input", seq, input }));
    return seq;
  }

  /** Send a command with an explicit sequence number, however implausible. */
  sendCommandAt(seq: number, input: Input): void {
    this.#socket.send(JSON.stringify({ t: "input", seq, input }));
  }

  press(direction: "up" | "down" | "left" | "right"): void {
    this.#input = { ...NO_INPUT, [direction]: true };
  }

  release(): void {
    this.#input = { ...NO_INPUT };
  }

  sendRaw(payload: string): void {
    this.#socket.send(payload);
  }

  action(type: "attack" | "interact" | "heal"): void {
    this.#socket.send(JSON.stringify({ t: type }));
  }

  chat(text: string): void {
    this.#socket.send(JSON.stringify({ t: "chat", text }));
  }

  close(): void {
    this.stopPump();
    try {
      this.#socket.close(1000, "done");
    } catch {
      // The server may already have closed an abusive client.
    }
  }

  get welcome() {
    return this.received.find((m) => m.t === "welcome");
  }

  get latestSnapshot() {
    for (let i = this.received.length - 1; i >= 0; i--) {
      const message = this.received[i];
      if (message?.t === "snapshot") return message;
    }
    return undefined;
  }

  get latestState() {
    for (let i = this.received.length - 1; i >= 0; i--) {
      const message = this.received[i];
      if (message?.t === "state") return message.self;
    }
    return this.welcome?.self;
  }

  self(): PlayerSnapshot | undefined {
    const id = this.welcome?.selfId;
    return id ? this.latestSnapshot?.players.find((p) => p.id === id) : undefined;
  }
}

/**
 * Spawn points are spread across the plaza. Always push toward the farther horizontal wall so
 * movement assertions stay independent of which deterministic point an id receives.
 */
function awayFromNearestWall(x: number): { direction: "left" | "right"; sign: 1 | -1 } {
  return x < (WORLD_WIDTH - PLAYER_SIZE) / 2
    ? { direction: "right", sign: 1 }
    : { direction: "left", sign: -1 };
}

/** Poll until `predicate` holds, or fail. Real timers: the world ticks in real time. */
async function until<T>(
  describeIt: string,
  predicate: () => T | undefined | false,
  timeoutMs = 5000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await scheduler.wait(20);
  }
  throw new Error(`timed out waiting for: ${describeIt}`);
}

describe("World", () => {
  it("welcomes a player with the world dimensions and their own id", async () => {
    const client = await Client.join("alice");

    const welcome = await until("welcome", () => client.welcome);
    expect(welcome.selfId).toMatch(/^[0-9a-f-]{36}$/);
    expect(welcome.world).toMatchObject({
      width: WORLD_WIDTH,
      height: WORLD_HEIGHT,
      playerSize: PLAYER_SIZE,
      obstacles: OBSTACLES,
      safeZone: SAFE_ZONE,
      questNpc: QUEST_NPC,
    });
    expect(welcome.monsters.length).toBeGreaterThan(0);
    expect(welcome.self.inventory).toMatchObject({ potions: 2, weapon: "rusty_sword" });
    expect(welcome.players.find((player) => player.id === welcome.selfId)).toMatchObject(
      spawnPosition(welcome.selfId),
    );

    client.close();
  });

  it("refuses a join for a character the session does not own", async () => {
    const alice = await testCharacter("own_a");
    const bob = await testCharacter("own_b");

    const stolen = await SELF.fetch(`${ORIGIN}/api/ws?character=${alice.characterId}`, {
      headers: { Upgrade: "websocket", Cookie: bob.cookie },
    });
    expect(stolen.status).toBe(403);

    const missing = await SELF.fetch(`${ORIGIN}/api/ws`, {
      headers: { Upgrade: "websocket", Cookie: bob.cookie },
    });
    expect(missing.status).toBe(400);
  });

  it("broadcasts snapshots on the tick loop", async () => {
    const client = await Client.join("bob");

    const first = await until("a snapshot", () => client.latestSnapshot);
    const later = await until("a second, later snapshot", () => {
      const snapshot = client.latestSnapshot;
      return snapshot && snapshot.tick > first.tick ? snapshot : undefined;
    });

    expect(later.tick).toBeGreaterThan(first.tick);
    client.close();
  });

  it("moves a square in response to input, and only along the pressed axis", async () => {
    const client = await Client.join("carol");
    await until("welcome", () => client.welcome);

    const start = await until("initial position", () => client.self());
    const { direction, sign } = awayFromNearestWall(start.x);
    client.press(direction);

    const moved = await until(`the square to move ${direction}`, () => {
      const now = client.self();
      return now && sign * (now.x - start.x) > 20 ? now : undefined;
    });

    expect(sign * (moved.x - start.x)).toBeGreaterThan(0);
    expect(moved.y).toBeCloseTo(start.y, 5);

    client.close();
  });

  it("never lets a square cross the authoritative boundary mass", async () => {
    const client = await Client.join("dave", {
      position: { x: WORLD_BOUNDARY_DEPTH + PLAYER_SPEED * TICK_DT, y: 2000 },
    });
    await until("welcome", () => client.welcome);

    client.press("left");
    const pinned = await until(
      "the square to reach the left wall",
      () => {
        const now = client.self();
        return now && now.x === WORLD_BOUNDARY_DEPTH ? now : undefined;
      },
      2_000,
    );

    expect(pinned.x).toBe(WORLD_BOUNDARY_DEPTH);

    // Keep pushing: the wall must hold, not merely be touched once.
    await scheduler.wait(200);
    expect(client.self()?.x).toBe(WORLD_BOUNDARY_DEPTH);

    client.close();
  });

  // The world is a singleton, shared by every test in this file. Assertions are therefore
  // about *which* ids are present, never about how many — a straggler from an earlier test
  // that has not finished disconnecting must not be able to fail an unrelated assertion.
  it("shows both players to each other, then drops one on disconnect", async () => {
    const alice = await Client.join("alice2");
    const bob = await Client.join("bob2");

    const aliceId = (await until("alice's welcome", () => alice.welcome)).selfId;
    const bobId = (await until("bob's welcome", () => bob.welcome)).selfId;

    const together = await until("alice to see bob", () => {
      const players = alice.latestSnapshot?.players;
      if (!players) return undefined;
      const ids = new Set(players.map((p) => p.id));
      return ids.has(aliceId) && ids.has(bobId) ? players : undefined;
    });
    expect(together.find((p) => p.id === bobId)?.nick).toBe("bob2");

    bob.close();

    await until("bob to disappear from alice's view", () => {
      const snapshot = alice.latestSnapshot;
      if (!snapshot) return undefined;
      const ids = new Set(snapshot.players.map((p) => p.id));
      return !ids.has(bobId) && ids.has(aliceId);
    });

    alice.close();
  });

  it("starts the server-owned quest only when interacting near the quest NPC", async () => {
    const client = await Client.join("quester", {
      position: { x: QUEST_NPC.x + 50, y: QUEST_NPC.y },
    });
    await until("welcome", () => client.welcome);
    expect(client.latestState?.quest.status).toBe("available");

    client.action("interact");
    await until("quest state", () =>
      client.latestState?.quest.status === "active" ? client.latestState : undefined,
    );
    expect(client.latestState?.quest.progress).toBe(0);
    client.close();
  });

  it("relays trimmed chat to every connected player", async () => {
    const alice = await Client.join("chat_a");
    const bob = await Client.join("chat_b");
    await until("both welcomes", () => alice.welcome && bob.welcome);

    alice.chat("  hello   world  ");
    const relayed = await until("chat relay", () =>
      bob.received.find((message) => message.t === "chat" && message.from === "chat_a"),
    );
    expect(relayed).toMatchObject({ t: "chat", from: "chat_a", text: "hello world" });
    alice.close();
    bob.close();
  });

  // A Durable Object is rebuilt on deploys and evictions, not only when it hibernates idle.
  // Its in-memory state dies; the hibernatable sockets do not. Without a persisted position
  // every connected player would teleport to a random spawn the moment we ship a new build.
  //
  // The rebuild cannot be simulated end-to-end here: evictDurableObject() waits for in-flight
  // work to drain, and the tick loop never drains. So the two halves are tested separately —
  // the write, here, and the read, in positionFromAttachment below.
  it("persists a moved player's position onto their socket", { timeout: 20_000 }, async () => {
    const client = await Client.join("persist");
    await until("welcome", () => client.welcome);

    // Move, then stand still long enough for a persist tick to capture the resting position.
    client.press("right");
    await scheduler.wait(800);
    client.release();
    await scheduler.wait(1300);

    const resting = await until("a resting position", () => client.self());

    const stub = env.WORLD.get(env.WORLD.idFromName("world"));
    const attachments = await runInDurableObject(stub, (_instance, state) =>
      state.getWebSockets().map((ws) => ws.deserializeAttachment() as Attachment | null),
    );

    const mine = attachments.find((a) => a?.nick === "persist");
    expect(mine).toBeDefined();
    expect(mine?.id).toBe(resting.id);
    expect(mine?.x).toBeCloseTo(resting.x, 1);
    expect(mine?.y).toBeCloseTo(resting.y, 1);

    client.close();
  });

  it("acknowledges the commands it has applied", async () => {
    const client = await Client.join("acker");
    await until("welcome", () => client.welcome);

    // The pump is running, so acks must climb.
    const first = await until("a non-zero ack", () => {
      const self = client.self();
      return self && self.ack > 0 ? self.ack : undefined;
    });

    const later = await until("the ack to advance", () => {
      const self = client.self();
      return self && self.ack > first ? self.ack : undefined;
    });

    expect(later).toBeGreaterThan(first);
    client.close();
  });

  /**
   * The whole point of draining one command per tick. A client that sends many commands at once
   * must not travel 40 ticks' worth of distance — otherwise sending faster is a speed hack.
   */
  it("applies at most one command per tick, so flooding buys no speed", {
    timeout: 10_000,
  }, async () => {
    const client = await Client.join("flooder", { pump: false });
    await until("welcome", () => client.welcome);
    const start = await until("initial position", () => client.self());
    const { direction, sign } = awayFromNearestWall(start.x);

    const flood = 24;
    for (let i = 0; i < flood; i++) client.sendCommand({ ...NO_INPUT, [direction]: true });

    const startTick = client.latestSnapshot?.tick ?? 0;
    const minimumTicks = 4;
    const after = await until("the flooded player to move", () => {
      const snapshot = client.latestSnapshot;
      const self = client.self();
      if (!snapshot || !self) return undefined;
      const tickDelta = snapshot.tick - startTick;
      const travelled = sign * (self.x - start.x);
      return tickDelta >= minimumTicks && travelled > 0 ? self : undefined;
    });
    const afterTick = client.latestSnapshot?.tick ?? startTick;
    const tickDelta = afterTick - startTick;
    const travelled = sign * (after.x - start.x);

    // Generous ceiling: the observed ticks, plus the starvation grace period, plus slack.
    const ceiling = (tickDelta + 6) * PLAYER_SPEED * TICK_DT;
    const ifFloodingWorked = flood * PLAYER_SPEED * TICK_DT;

    expect(travelled).toBeGreaterThan(0);
    expect(travelled).toBeLessThan(ceiling);
    expect(travelled).toBeLessThan(ifFloodingWorked / 2);

    client.close();
  });

  it("ignores a replayed sequence number", async () => {
    const client = await Client.join("replayer", { pump: false });
    await until("welcome", () => client.welcome);
    const start = await until("initial position", () => client.self());
    const { direction, sign } = awayFromNearestWall(start.x);
    const backwards = direction === "right" ? "left" : "right";

    client.sendCommandAt(100, { ...NO_INPUT, [direction]: true });
    const moved = await until("the square to move", () => {
      const self = client.self();
      return self && sign * (self.x - start.x) > 1 ? self : undefined;
    });

    // A stale command, arriving late or replayed by an attacker. It must not be applied.
    client.sendCommandAt(3, { ...NO_INPUT, [backwards]: true });
    await scheduler.wait(400);

    const after = await until("a later snapshot", () => client.self());
    // Never travelled backwards, and the stale sequence never became the acknowledged one.
    expect(sign * (after.x - moved.x)).toBeGreaterThanOrEqual(0);
    expect(after.ack).toBe(100);

    client.close();
  });

  it("stops a square whose client has gone silent", async () => {
    const client = await Client.join("ghost");
    await until("welcome", () => client.welcome);

    const start = await until("initial position", () => client.self());
    const { direction, sign } = awayFromNearestWall(start.x);
    client.press(direction);

    await scheduler.wait(300);
    const beforeSilence = await until("the square to be moving", () => {
      const self = client.self();
      return self && sign * (self.x - start.x) > 20 ? self : undefined;
    });

    // The tab froze: no more commands. The server may coast briefly, then must stop.
    client.stopPump();
    await scheduler.wait(700);

    const settled = await until("a snapshot", () => client.self());
    await scheduler.wait(300);
    const stillSettled = await until("a later snapshot", () => client.self());

    expect(stillSettled.x).toBe(settled.x);

    // It stopped because the server gave up on us, not because it hit a wall.
    expect(settled.x).toBeGreaterThan(0);
    expect(settled.x).toBeLessThan(WORLD_WIDTH - PLAYER_SIZE);

    // Coasting is bounded by the queue depth plus the starvation grace period.
    const coasted = sign * (settled.x - beforeSilence.x);
    expect(coasted).toBeLessThan(18 * PLAYER_SPEED * TICK_DT);

    client.close();
  });

  it("ignores malformed frames instead of dying", async () => {
    const client = await Client.join("mallory");
    await until("welcome", () => client.welcome);
    const before = await until("a snapshot", () => client.latestSnapshot);

    client.sendRaw("not json at all");
    client.sendRaw(JSON.stringify({ t: "input", input: { up: "yes" } }));
    client.sendRaw(JSON.stringify({ t: "teleport", x: 9999, y: 9999 }));

    // The world keeps ticking, and the square never teleports.
    await until("the world to keep ticking", () => {
      const snapshot = client.latestSnapshot;
      return snapshot && snapshot.tick > before.tick + 2;
    });

    const self = await until("to still see ourselves", () => client.self());
    expect(self.x).toBeLessThanOrEqual(WORLD_WIDTH - PLAYER_SIZE);
    expect(self.y).toBeLessThanOrEqual(WORLD_HEIGHT - PLAYER_SIZE);

    client.close();
  });

  it("closes clients that repeatedly send malformed frames", async () => {
    const client = await Client.join("bad_frames");
    await until("welcome", () => client.welcome);
    for (let i = 0; i < 5; i++) client.sendRaw("{broken");
    const closed = await until("policy close", () => client.closeInfo ?? undefined);
    expect(closed.code).toBe(1008);
  });

  it("closes an oversized WebSocket frame", async () => {
    const client = await Client.join("huge_frame");
    await until("welcome", () => client.welcome);
    client.sendRaw("x".repeat(2_049));
    const closed = await until("oversized close", () => client.closeInfo ?? undefined);
    expect(closed.code).toBe(1009);
  });

  it("lets a priest mend the most injured player in range, respecting cooldown", async () => {
    // ~250px from the nearest SPAWN_POINTS grid cell — far enough that a straggler still
    // disconnecting from an earlier test (spawned somewhere on that grid, always inside
    // heal.range 130 of *itself* but not of here) cannot be closer than the wounded ally and
    // steal the cast.
    const priest = await Client.join("mender", { position: { x: 1150, y: 250 }, class: "priest" });
    const wounded = await Client.join("wounded", { position: { x: 1166, y: 250 }, hp: 40 });
    await until("both welcomes", () => priest.welcome && wounded.welcome);

    priest.action("heal");
    await until("the wounded player to be mended", () => {
      // Re-send: belt and suspenders in case the very first cast raced the join.
      priest.action("heal");
      const snapshot = wounded.self();
      return snapshot && snapshot.hp > 40 ? snapshot : undefined;
    });

    const healed = wounded.self();
    expect(healed?.hp).toBe(40 + 35); // healAmountFor(1)

    // Cooldown: an immediate second cast must not double-heal.
    priest.action("heal");
    priest.action("heal");
    await scheduler.wait(200);
    expect(wounded.self()?.hp).toBe(75);

    const cast = priest.received.find((m) => m.t === "event" && m.code === "heal.cast");
    const received = wounded.received.find((m) => m.t === "event" && m.code === "heal.received");
    expect(cast).toMatchObject({ params: { name: "wounded", amount: 35 } });
    expect(received).toMatchObject({ params: { name: "mender", amount: 35 } });

    priest.close();
    wounded.close();
  });

  it("keeps a wounded ally beyond heal.range untouched", async () => {
    const priest = await Client.join("far_healer", {
      position: { x: 784, y: 450 },
      class: "priest",
    });
    // 200px away: past heal.range (130), well inside the snapshot view.
    const wounded = await Client.join("far_wounded", { position: { x: 984, y: 450 }, hp: 40 });
    await until("both welcomes", () => priest.welcome && wounded.welcome);

    priest.action("heal");
    const nobody = await until("heal.nobody", () =>
      priest.received.find((m) => m.t === "event" && m.code === "heal.nobody"),
    );
    expect(nobody).toMatchObject({ tone: "info" });
    expect(wounded.self()?.hp).toBe(40);

    priest.close();
    wounded.close();
  });

  it("blocks a dead priest from casting heal", async () => {
    // road-gloamcap patrols within patrolRadius (75px) of its spawn, well inside
    // MONSTER_AGGRO_RANGE (210), so a player standing on the spawn point aggroes it reliably;
    // hp: 1 plus MONSTER_DAMAGE (9) means the first landed hit kills.
    const priest = await Client.join("dying_priest", {
      position: { x: 1870, y: 820 },
      class: "priest",
      hp: 1,
    });
    await until("welcome", () => priest.welcome);
    await until("the monster to kill the priest", () =>
      priest.self()?.dead ? priest.self() : undefined,
    );

    // Only bring in a healable ally now that the priest is dead. The monster orbits its spawn
    // at a roughly constant distance, so if it had joined earlier there'd be a real chance the
    // patrol phase put the ally closer to the monster than the (stationary) priest, drawing the
    // kill onto the wrong player. Landing the killing blow just reset the monster's own
    // MONSTER_ATTACK_COOLDOWN_MS (900ms), so whichever player it picks next, it cannot land a
    // second hit inside the 300ms this test asserts over — the ally is safe by timing, not
    // position.
    const ally = await Client.join("spared_ally", { position: { x: 1870, y: 920 }, hp: 40 });
    await until("ally welcome", () => ally.welcome);

    // Dead priests must not be able to cast: no cooldown check saves them, the intent is
    // dropped outright — the server never even sends heal.nobody.
    priest.action("heal");
    priest.action("heal");
    await scheduler.wait(300);

    expect(ally.self()?.hp).toBe(40);
    expect(priest.received.some((m) => m.t === "event" && String(m.code).startsWith("heal"))).toBe(
      false,
    );

    priest.close();
    ally.close();
  });

  it("ignores heal intents from non-priests and out-of-range or full-health situations", async () => {
    const warrior = await Client.join("brute", { position: { x: 784, y: 450 } });
    await until("welcome", () => warrior.welcome);
    warrior.action("heal");
    await scheduler.wait(150);
    expect(warrior.received.some((m) => m.t === "event" && String(m.code).startsWith("heal"))).toBe(
      false,
    );

    const priest = await Client.join("lonely", { position: { x: 3000, y: 2200 }, class: "priest" });
    await until("welcome", () => priest.welcome);
    priest.action("heal"); // full HP everywhere near → nobody
    const nobody = await until("heal.nobody", () =>
      priest.received.find((m) => m.t === "event" && m.code === "heal.nobody"),
    );
    expect(nobody).toMatchObject({ tone: "info" });

    warrior.close();
    priest.close();
  });

  it("deleting a connected character kicks its socket", async () => {
    const session = await testCharacter("deleteme");
    const client = await Client.joinCharacter(session);
    await until("welcome", () => client.welcome);

    const deleted = await SELF.fetch(`${ORIGIN}/api/characters/${session.characterId}`, {
      method: "DELETE",
      headers: { Cookie: session.cookie },
    });
    expect(deleted.status).toBe(204);

    const closed = await until("kick close", () => client.closeInfo ?? undefined);
    expect(closed.code).toBe(4002);
  });
});

/** The read half of surviving a rebuild — see the persistence test above. */
describe("positionFromAttachment", () => {
  const inWorld = (position: { x: number; y: number }) => {
    expect(position.x).toBeGreaterThanOrEqual(0);
    expect(position.y).toBeGreaterThanOrEqual(0);
    expect(position.x).toBeLessThanOrEqual(WORLD_WIDTH - PLAYER_SIZE);
    expect(position.y).toBeLessThanOrEqual(WORLD_HEIGHT - PLAYER_SIZE);
    expect(isWalkable(position)).toBe(true);
  };

  it("resumes a persisted position exactly", () => {
    const attachment: Attachment = { id: "a", nick: "n", x: 123.5, y: 456.25 };
    expect(positionFromAttachment(attachment)).toEqual({ x: 123.5, y: 456.25 });
  });

  it("spawns fresh when there is no attachment", () => {
    inWorld(positionFromAttachment(null));
  });

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("spawns fresh rather than trusting a %s coordinate", (_label, bad) => {
    inWorld(positionFromAttachment({ id: "a", nick: "n", x: bad, y: 10 }));
    inWorld(positionFromAttachment({ id: "a", nick: "n", x: 10, y: bad }));
  });

  it("uses the player-specific spawn for blocked and out-of-world attachments", () => {
    const collider = WORLD_LANDMARKS.find((landmark) => landmark.collider)?.collider;
    if (!collider) throw new Error("test world needs a landmark collider");
    const expected = spawnPosition("returning-id");
    expect(
      positionFromAttachment({
        id: "returning-id",
        nick: "n",
        x: collider.x + 1,
        y: collider.y + 1,
      }),
    ).toEqual(expected);
    expect(positionFromAttachment({ id: "returning-id", nick: "n", x: -500, y: 500 })).toEqual(
      expected,
    );
  });
});
