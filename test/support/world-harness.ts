/**
 * Shared WebSocket harness for World Durable Object integration tests.
 */

import { env, runInDurableObject, SELF } from "cloudflare:test";
import { expect } from "vitest";
import type { AdventureGraph } from "../../src/shared/adventure.js";
import { type PlayerClass, type QuestChapter, spawnPosition } from "../../src/shared/game.js";
import type { MapElement, MapMarkers } from "../../src/shared/map-data.js";
import type { MapEvent } from "../../src/shared/map-events.js";
import type { PartyColor } from "../../src/shared/party.js";
import { PARTY_COLORS } from "../../src/shared/party.js";
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
import { TILE_SIZE } from "../../src/shared/tilemap.js";
import {
  applyWorldDelta,
  createWorldCache,
  replaceWorldCache,
  type WorldCache,
} from "../../src/shared/world-delta.js";
import { isKnownZone, zoneDefinition } from "../../src/shared/zones.js";
import { layeredWireTerrain } from "./map-fixtures.js";

export const ORIGIN = "https://lindocara.test";
export const VERDANT_ROOM_KEY = "verdant-reach:main";
export const MMO_TEST_ROOM_KEY = "mmo-test-zone:main";

/** An account and the session cookie it was issued. Both fixtures start here. */
export interface TestAccount {
  cookie: string;
  accountId: string;
}

export interface TestCharacter extends TestAccount {
  characterId: string;
}

let accountCounter = 0;

/** Register a fresh account through the real API and keep the cookie it issued. */
export async function testAccount(label: string): Promise<TestAccount> {
  const username = `u${++accountCounter}${label}`.toLowerCase().slice(0, 16);
  const registered = await SELF.fetch(`${ORIGIN}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "12345678" }),
  });
  expect(registered.status).toBe(200);
  const body = (await registered.clone().json()) as { id: string };
  const pair = registered.headers.get("Set-Cookie")?.split(";")[0];
  if (!pair) throw new Error("no session cookie issued");
  return { cookie: pair, accountId: body.id };
}

/** POST JSON as an authenticated account, asserting the status the API promises. */
async function postAs<T>(
  account: TestAccount,
  path: string,
  body: unknown,
  expectedStatus: number,
): Promise<T> {
  const response = await SELF.fetch(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: account.cookie },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(expectedStatus);
  return (await response.json()) as T;
}

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
  const account = await testAccount(name);
  const body = await postAs<{ id: string }>(
    account,
    "/api/characters",
    {
      name,
      appearance: { body: "wayfarer", primaryColor: "azure" },
      class: options.class ?? "warrior",
    },
    200,
  );

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
  return { ...account, characterId: body.id };
}

// ---------------------------------------------------------------------------
// Hero fixtures: account -> maps -> adventure -> party -> hero, all through /api/*.
// ---------------------------------------------------------------------------

export const TEST_MAP_COLS = 40;
export const TEST_MAP_ROWS = 30;
/** The entry an adventure starts on, and therefore where `createHero` places a new hero. */
export const TEST_ENTRY_ID = "door";
/** The exit bound to "end". Far from the spawn: standing on it wins the adventure. */
export const TEST_EXIT_ID = "finish";

/** The `POST /api/maps` body a test authors. */
export interface TestMapBody {
  name: string;
  tilesetId: string;
  cols: number;
  rows: number;
  layers: string[];
  elements: MapElement[];
  events: MapEvent[];
  spawn: { col: number; row: number };
  markers: MapMarkers;
}

export interface TestMapOptions {
  cols?: number;
  rows?: number;
  spawn?: { col: number; row: number };
  exit?: { col: number; row: number };
  monsterSpawns?: MapMarkers["monsterSpawns"];
  /** Authored events placed on the map — appearance-only, evaluated server-side. */
  events?: MapEvent[];
}

/** The pixel centre of a tile — where entries, exits and spawns actually put a hero. */
export function tileCentre(col: number, row: number): { x: number; y: number } {
  return { x: col * TILE_SIZE + TILE_SIZE / 2, y: row * TILE_SIZE + TILE_SIZE / 2 };
}

/**
 * An open playable map with one entry (on the spawn) and one exit in the far corner. A map with
 * no exit cannot be part of a valid adventure — the graph must be able to reach an ending.
 *
 * This is an HTTP *body*, not a `MapInput`: its three layers are the run-length encoded strings the
 * wire carries, which `parseMapData` on the server turns back into `TileLayer`s.
 */
export function testMapInput(name: string, options: TestMapOptions = {}): TestMapBody {
  const cols = options.cols ?? TEST_MAP_COLS;
  const rows = options.rows ?? TEST_MAP_ROWS;
  const spawn = options.spawn ?? { col: Math.floor(cols / 2), row: Math.floor(rows / 2) };
  const exit = options.exit ?? { col: cols - 2, row: rows - 2 };
  return {
    name,
    ...layeredWireTerrain(Array.from({ length: rows }, () => ".".repeat(cols))),
    elements: [],
    events: options.events ?? [],
    spawn,
    markers: {
      entries: [{ id: TEST_ENTRY_ID, ...spawn }],
      exits: [{ id: TEST_EXIT_ID, ...exit }],
      monsterSpawns: options.monsterSpawns ?? [],
    },
  };
}

export interface TestPartyOptions {
  /** Reuse an account as the host instead of registering a new one. */
  host?: TestAccount;
  /** Open a second party on an adventure that already exists — two saves of one story. */
  adventure?: Pick<TestParty, "adventureId" | "mapIds" | "startMapId">;
  /** The adventure's maps, in order. Defaults to one `testMapInput`. */
  maps?: readonly TestMapBody[];
  /** Built once the maps have ids. Defaults to "start on the first map, its exit ends it". */
  graph?: (mapIds: readonly string[]) => AdventureGraph;
  maxPlayers?: number;
  /** The host's party colour. Defaults to blue, i.e. the azure appearance. */
  color?: PartyColor;
}

export interface TestParty {
  host: TestAccount;
  adventureId: string;
  partyId: string;
  /** The adventure's maps, in the order they were created. */
  mapIds: string[];
  startMapId: string;
  /** The room the adventure starts in. Every map has its own room. */
  roomKey: string;
  members: { accountId: string; color: PartyColor }[];
}

export interface TestHero extends TestAccount {
  heroId: string;
  partyId: string;
  adventureId: string;
  /** The map this hero will be admitted to, and the room key that follows from it. */
  mapId: string;
  roomKey: string;
  party: TestParty;
}

export interface TestHeroOptions extends TestPartyOptions {
  /** Put the hero in an existing party — the only way two heroes share a room. */
  party?: TestParty;
  /** Reuse an account. It joins `party` if it is not a member yet. */
  account?: TestAccount;
  /** The colour this account takes in the party. Defaults to the first free one. */
  color?: PartyColor;
  class?: PlayerClass;
  /** Start on a member map other than the adventure's start map. */
  mapId?: string;
  position?: { x: number; y: number };
  level?: number;
  xp?: number;
  hp?: number;
}

/** Every room a hero fixture has minted, so `drainHeroRooms()` knows what to wait for. */
const heroRooms = new Set<string>();
const heroClients: Client[] = [];

/** A hero's room is owned by its party, not by the map: two parties never share a simulation. */
export function heroRoomKey(partyId: string, mapId: string): string {
  return `${partyId}:${mapId}`;
}

function defaultGraph(mapIds: readonly string[]): AdventureGraph {
  const [start] = mapIds;
  if (!start) throw new Error("an adventure needs at least one map");
  const last = mapIds[mapIds.length - 1];
  if (!last) throw new Error("an adventure needs at least one map");
  // One corridor: each map's exit leads to the next map's entry, and the last one ends it.
  const links = mapIds.map((mapId, index) => {
    const next = mapIds[index + 1];
    return {
      mapId,
      exitId: TEST_EXIT_ID,
      dest: next ? { mapId: next, entryId: TEST_ENTRY_ID } : ("end" as const),
    };
  });
  return { start: { mapId: start, entryId: TEST_ENTRY_ID }, links };
}

/** Register a host, author its maps and adventure, and open a party on it. */
export async function testParty(label: string, options: TestPartyOptions = {}): Promise<TestParty> {
  const host = options.host ?? (await testAccount(label));
  const authored = options.adventure ?? (await testAdventure(host, label, options));
  const color = options.color ?? "blue";
  const party = await postAs<{ id: string }>(
    host,
    "/api/parties",
    { adventureId: authored.adventureId, name: null, color },
    201,
  );
  for (const mapId of authored.mapIds) heroRooms.add(heroRoomKey(party.id, mapId));
  return {
    host,
    ...authored,
    partyId: party.id,
    roomKey: heroRoomKey(party.id, authored.startMapId),
    members: [{ accountId: host.accountId, color }],
  };
}

/** Author the maps and the adventure graph over them. A party is one playthrough of this. */
async function testAdventure(
  host: TestAccount,
  label: string,
  options: TestPartyOptions,
): Promise<Pick<TestParty, "adventureId" | "mapIds" | "startMapId">> {
  const inputs = options.maps ?? [testMapInput(`${label} ground`)];
  const mapIds: string[] = [];
  for (const input of inputs) {
    const map = await postAs<{ id: string }>(host, "/api/maps", input, 201);
    mapIds.push(map.id);
  }
  const graph = (options.graph ?? defaultGraph)(mapIds);
  const adventure = await postAs<{ id: string }>(
    host,
    "/api/adventures",
    {
      title: `${label} adventure`.slice(0, 48),
      maxPlayers: options.maxPlayers ?? 4,
      mapIds,
      graph,
    },
    201,
  );
  return { adventureId: adventure.id, mapIds, startMapId: graph.start.mapId };
}

/** Add an account to a party, tolerating a membership it already has. */
export async function joinTestParty(
  party: TestParty,
  account: TestAccount,
  color?: PartyColor,
): Promise<PartyColor> {
  const known = party.members.find((member) => member.accountId === account.accountId);
  if (known) return known.color;
  const taken = new Set(party.members.map((member) => member.color));
  const free = color ?? PARTY_COLORS.find((candidate) => !taken.has(candidate));
  if (!free) throw new Error("no free party colour left");
  const response = await SELF.fetch(`${ORIGIN}/api/parties/${party.partyId}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: account.cookie },
    body: JSON.stringify({ color: free }),
  });
  expect(response.status).toBe(204);
  party.members.push({ accountId: account.accountId, color: free });
  return free;
}

/**
 * The hero equivalent of `testCharacter`: a full party fixture and one hero in it, provisioned
 * through the real API and then nudged in D1 exactly like the character fixture is.
 */
export async function testHero(name: string, options: TestHeroOptions = {}): Promise<TestHero> {
  const party = options.party ?? (await testParty(name, options));
  // A party we just made is ours: use its host. Joining someone else's needs a second account.
  const account = options.account ?? (options.party ? await testAccount(name) : party.host);
  await joinTestParty(party, account, options.color);
  const created = await postAs<{ id: string }>(
    account,
    `/api/parties/${party.partyId}/heroes`,
    { name, class: options.class ?? "warrior" },
    201,
  );

  const mapId = options.mapId ?? party.startMapId;
  if (mapId !== party.startMapId) {
    await env.DB.prepare("UPDATE hero SET map_id = ? WHERE id = ?").bind(mapId, created.id).run();
  }
  if (options.position) {
    await env.DB.prepare("UPDATE hero SET x = ?, y = ? WHERE id = ?")
      .bind(options.position.x, options.position.y, created.id)
      .run();
  }
  if (options.level !== undefined) {
    await env.DB.prepare("UPDATE hero SET level = ?, hp = ? WHERE id = ?")
      .bind(options.level, 100 + (options.level - 1) * 12, created.id)
      .run();
  }
  if (options.xp !== undefined) {
    await env.DB.prepare("UPDATE hero SET xp = ? WHERE id = ?").bind(options.xp, created.id).run();
  }
  if (options.hp !== undefined) {
    await env.DB.prepare("UPDATE hero SET hp = ? WHERE id = ?").bind(options.hp, created.id).run();
  }
  heroRooms.add(heroRoomKey(party.partyId, mapId));
  return {
    ...account,
    heroId: created.id,
    partyId: party.partyId,
    adventureId: party.adventureId,
    mapId,
    roomKey: heroRoomKey(party.partyId, mapId),
    party,
  };
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
          projectiles: message.projectiles,
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
    return Client.#upgrade(`/api/ws?character=${session.characterId}`, session.cookie, options);
  }

  /** Provision a whole party fixture and admit one hero into its adventure's start room. */
  static async hero(name: string, options: TestHeroOptions & { pump?: boolean } = {}) {
    const hero = await testHero(name, options);
    return Client.joinHero(hero, options);
  }

  /** Admit an already-created hero: `/api/ws?party=&hero=`, the live admission route. */
  static async joinHero(hero: TestHero, options: { pump?: boolean } = {}): Promise<Client> {
    const client = await Client.#upgrade(
      `/api/ws?party=${hero.partyId}&hero=${hero.heroId}`,
      hero.cookie,
      options,
    );
    // A hero can be handed off to another map mid-test, so track the client rather than the room:
    // `drainHeroRooms()` waits on every room its party could have loaded.
    heroClients.push(client);
    return client;
  }

  static async #upgrade(
    path: string,
    cookie: string,
    options: { pump?: boolean },
  ): Promise<Client> {
    const response = await SELF.fetch(`${ORIGIN}${path}`, {
      headers: { Upgrade: "websocket", Cookie: cookie },
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

  action(type: "attack" | "interact"): void {
    try {
      this.#socket.send(JSON.stringify({ t: type }));
    } catch {
      // The server may already have closed the connection.
    }
  }

  /** Let go of the body. Not to be confused with release(), which lets go of the keys. */
  releaseSpirit(): void {
    this.#socket.send(JSON.stringify({ t: "release" }));
  }

  skill(slot: number): void {
    this.#socket.send(JSON.stringify({ t: "skill", slot }));
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

  partyChat(text: string): void {
    this.#socket.send(JSON.stringify({ t: "chat", channel: "party", text }));
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
    if (count <= maxSockets) {
      const diagnostics = await stub.roomDiagnostics();
      if (
        diagnostics.playerIds.length <= maxSockets &&
        (maxSockets > 0 || diagnostics.pendingSaves === 0)
      )
        return;
    }
    await scheduler.wait(100);
  }
  throw new Error(`timed out waiting for ${roomKey} to have at most ${maxSockets} socket(s)`);
}

/**
 * Close every hero client and wait for every room a hero fixture minted to empty.
 *
 * World Durable Objects are process-wide singletons, so a hero straggling into the next test is a
 * cross-test failure waiting to happen. Call this in `afterEach` of any file using `testHero`,
 * before truncating the tables the room is still saving into.
 */
export async function drainHeroRooms(timeoutMs = 15_000): Promise<void> {
  for (const client of heroClients.splice(0)) client.close();
  const rooms = [...heroRooms];
  heroRooms.clear();
  for (const roomKey of rooms) await waitForRoomSockets(roomKey, 0, timeoutMs);
}
