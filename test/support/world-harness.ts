/**
 * Shared WebSocket harness for World Durable Object integration tests.
 */

import { env, runInDurableObject, SELF } from "cloudflare:test";
import { expect } from "vitest";
import { type PlayerClass, type QuestChapter, spawnPosition } from "../../src/shared/game.js";
import {
  type CorpseSnapshot,
  type PlayerSnapshot,
  parseServerMessage,
  type QuestStatus,
  type ServerMessage,
  type WorldView,
} from "../../src/shared/protocol.js";
import {
  type Input,
  NO_INPUT,
  PLAYER_SIZE,
  TICK_MS,
  WORLD_WIDTH,
} from "../../src/shared/simulation.js";
import {
  applyWorldDelta,
  createWorldCache,
  replaceWorldCache,
  type WorldCache,
} from "../../src/shared/world-delta.js";
import { isKnownZone, zoneDefinition } from "../../src/shared/zones.js";

export const ORIGIN = "https://lindocara.test";
export const VERDANT_ROOM_KEY = "verdant-reach:main";
export const MMO_TEST_ROOM_KEY = "mmo-test-zone:main";

export interface TestCharacter {
  cookie: string;
  characterId: string;
}

let accountCounter = 0;

export interface TestCharacterOptions {
  position?: { x: number; y: number };
  class?: PlayerClass;
  level?: number;
  hp?: number;
  quest?: { chapter: QuestChapter; status: QuestStatus; progress: number };
  wardRunExpiresAt?: number | null;
  zoneId?: string;
  instanceId?: string;
}

/** Register a fresh account and create one character on it through the real API. */
export async function testCharacter(
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
    body: JSON.stringify({
      name,
      appearance: { body: "wayfarer", primaryColor: "azure" },
      class: options.class ?? "warrior",
    }),
  });
  expect(created.status).toBe(200);
  const body = (await created.json()) as { id: string };

  // Zone first, position second: an explicit position must survive a subsequent zone move (the
  // zone write is unconditional so existing tests keep meaning verdant-reach after character
  // creation itself started resolving through D1).
  const zoneId = options.zoneId ?? "verdant-reach";
  const instanceId = options.instanceId ?? "main";
  await env.DB.prepare("UPDATE character SET zone_id = ?, instance_id = ? WHERE id = ?")
    .bind(zoneId, instanceId, body.id)
    .run();
  // Creation itself now spawns on the D1 front door (first map, else builtin) — sane for a
  // brand-new D1-map character, but not for a test pinning the zone back to a catalogue zone:
  // that zone's own terrain is what a restored position gets walkability-checked against, and the
  // D1 front door's spawn point has no reason to land anywhere near it. Give a catalogue-zone
  // character a spawn from its own zone instead, exactly like character creation itself did
  // before it started resolving through D1 — unless the test asks for a specific position.
  if (!options.position && isKnownZone(zoneId)) {
    const seeded = spawnPosition(body.id, zoneDefinition(zoneId).terrain);
    await env.DB.prepare("UPDATE character SET x = ?, y = ? WHERE id = ?")
      .bind(seeded.x, seeded.y, body.id)
      .run();
  }
  if (options.position) {
    await env.DB.prepare("UPDATE character SET x = ?, y = ? WHERE id = ?")
      .bind(options.position.x, options.position.y, body.id)
      .run();
  }
  if (options.level !== undefined) {
    await env.DB.prepare("UPDATE character SET level = ?, hp = ? WHERE id = ?")
      .bind(options.level, 100 + (options.level - 1) * 12, body.id)
      .run();
  }
  if (options.hp !== undefined) {
    await env.DB.prepare("UPDATE character SET hp = ? WHERE id = ?")
      .bind(options.hp, body.id)
      .run();
  }
  if (options.quest) {
    await env.DB.prepare(
      `UPDATE character_quest
       SET quest_id = ?, status = ?, progress = ?,
         accepted_at = CASE WHEN ? = 'available' THEN NULL ELSE unixepoch() * 1000 END
       WHERE character_id = ?`,
    )
      .bind(
        options.quest.chapter,
        options.quest.status,
        options.quest.progress,
        options.quest.status,
        body.id,
      )
      .run();
  }
  if (options.wardRunExpiresAt !== undefined) {
    await env.DB.prepare("UPDATE character_quest SET data = ? WHERE character_id = ?")
      .bind(
        options.wardRunExpiresAt === null
          ? null
          : JSON.stringify({ wardRunExpiresAt: options.wardRunExpiresAt }),
        body.id,
      )
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
export class Client {
  readonly received: ServerMessage[] = [];
  readonly receivedAt: number[] = [];
  closeInfo: { code: number; reason: string } | null = null;
  #socket: WebSocket;
  #input: Input = NO_INPUT;
  #seq = 0;
  #pump: ReturnType<typeof setInterval> | null = null;
  #worldCache: WorldCache = createWorldCache();
  #latestWorld: (WorldView & { tick: number }) | undefined;

  constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.accept();
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      const message = parseServerMessage(event.data);
      if (!message) return;
      this.received.push(message);
      this.receivedAt.push(Date.now());
      if (message.t === "welcome" || message.t === "world.resync") {
        replaceWorldCache(this.#worldCache, message);
        this.#latestWorld = {
          tick: message.tick,
          players: message.players,
          monsters: message.monsters,
          guards: message.guards,
          loot: message.loot,
          corpses: message.corpses,
        };
      } else if (message.t === "world.delta") {
        const view = applyWorldDelta(this.#worldCache, message);
        if (view) this.#latestWorld = { tick: message.tick, ...view };
      }
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
      level?: number;
      hp?: number;
      quest?: NonNullable<TestCharacterOptions["quest"]>;
      zoneId?: string;
      instanceId?: string;
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

  action(type: "attack" | "interact" | "heal", targetId?: string): void {
    try {
      this.#socket.send(
        JSON.stringify(targetId === undefined ? { t: type } : { t: type, targetId }),
      );
    } catch {
      // The server may already have closed the connection.
    }
  }

  /** Let go of the body. Not to be confused with release(), which lets go of the keys. */
  releaseSpirit(): void {
    this.#socket.send(JSON.stringify({ t: "release" }));
  }

  skill(slot: number, targetId?: string): void {
    this.#socket.send(
      JSON.stringify(
        targetId === undefined ? { t: "skill", slot } : { t: "skill", slot, targetId },
      ),
    );
  }

  attemptAfterRevocation(payload: unknown): void {
    try {
      this.#socket.send(JSON.stringify(payload));
    } catch {
      // A browser is also allowed to reject send() once the server close has completed.
    }
  }

  usePotion(): void {
    this.#socket.send(JSON.stringify({ t: "use", item: "potion" }));
  }

  chat(text: string): void {
    this.#socket.send(JSON.stringify({ t: "chat", channel: "local", text }));
  }

  requestResync(): void {
    this.#socket.send(JSON.stringify({ t: "world.resync" }));
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
    return this.#latestWorld;
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

  nearestMonsterId(): string | undefined {
    const self = this.self();
    if (!self) return undefined;
    return this.latestSnapshot?.monsters
      .filter((monster) => !monster.dead)
      .sort(
        (a, b) => Math.hypot(a.x - self.x, a.y - self.y) - Math.hypot(b.x - self.x, b.y - self.y),
      )[0]?.id;
  }

  /** This player's body, if they have left one lying around. */
  corpse(): CorpseSnapshot | undefined {
    const id = this.welcome?.selfId;
    return id ? this.latestSnapshot?.corpses.find((c) => c.id === id) : undefined;
  }
}

/**
 * Spawn points are spread across the plaza. Always push toward the farther horizontal wall so
 * movement assertions stay independent of which deterministic point an id receives.
 */
export function awayFromNearestWall(x: number): { direction: "left" | "right"; sign: 1 | -1 } {
  return x < (WORLD_WIDTH - PLAYER_SIZE) / 2
    ? { direction: "right", sign: 1 }
    : { direction: "left", sign: -1 };
}

/** Poll until `predicate` holds, or fail. Real timers: the world ticks in real time. */
export async function until<T>(
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

/**
 * World Durable Objects are singletons across the whole worker test pool. Wait for a room to
 * drain before tests that assume an empty or nearly-empty room.
 */
export async function waitForRoomSockets(
  roomKey: string,
  maxSockets: number,
  timeoutMs = 15_000,
): Promise<void> {
  const stub = env.WORLD.getByName(roomKey);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const count = await runInDurableObject(
      stub,
      (_instance, state) => state.getWebSockets().length,
    );
    if (count <= maxSockets) return;
    await scheduler.wait(100);
  }
  throw new Error(`timed out waiting for ${roomKey} to have at most ${maxSockets} socket(s)`);
}
