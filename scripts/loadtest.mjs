import process from "node:process";
import WebSocket from "ws";

const SCENARIOS = new Set(["idle", "movement", "combat", "mixed", "reconnect", "zone-transition"]);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const PRODUCTION_HOST = "lindocara.alepha.dev";
const PASSWORD = process.env.LINDOCARA_LOADTEST_PASSWORD ?? "LindoLoad-Local-2026";
const PARTY_SIZE = 4;
const PARTY_COLORS = ["blue", "red", "yellow", "purple"];
const LOAD_MAP_TWO = "LoadMap2";
const LOAD_END_EVENT = "loadtest-end";
const RECONNECT_DELAY_MS = 250;

function argumentsOf(argv) {
  const values = new Map();
  for (const argument of argv) {
    if (!argument.startsWith("--")) continue;
    const separator = argument.indexOf("=");
    values.set(
      separator === -1 ? argument.slice(2) : argument.slice(2, separator),
      separator === -1 ? "true" : argument.slice(separator + 1),
    );
  }
  return values;
}

function positiveInteger(value, fallback, name, maximum) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  }
  return parsed;
}

function configuration(argv) {
  const args = argumentsOf(argv);
  const target = new URL(args.get("target") ?? "http://localhost:5173");
  const scenario = args.get("scenario") ?? "mixed";
  if (!SCENARIOS.has(scenario)) throw new Error(`unknown scenario: ${scenario}`);
  if (!LOCAL_HOSTS.has(target.hostname) && args.get("allow-remote") !== "true") {
    throw new Error("remote targets require --allow-remote=true");
  }
  if (target.hostname === PRODUCTION_HOST && args.get("allow-production") !== "true") {
    throw new Error("the production host requires --allow-production=true");
  }
  return {
    players: positiveInteger(args.get("players"), 10, "players", 500),
    durationSeconds: positiveInteger(args.get("duration"), 60, "duration", 3_600),
    scenario,
    target,
    prefix: (args.get("prefix") ?? "load").replaceAll(/[^a-z0-9]/gi, "").slice(0, 6) || "load",
  };
}

async function requestJson(target, path, init = {}, cookie) {
  const headers = { "Content-Type": "application/json", ...init.headers };
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(new URL(path, target), { ...init, headers });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  return { response, body };
}

function sessionCookie(response) {
  return response.headers.get("set-cookie")?.split(";", 1)[0] ?? null;
}

function requestFailure(operation, result) {
  const code = typeof result.body?.error === "string" ? `: ${result.body.error}` : "";
  return new Error(`${operation} failed (${result.response.status}${code})`);
}

async function authenticateVirtualPlayer(config, index) {
  const suffix = String(index).padStart(3, "0");
  const username = `${config.prefix}${suffix}`.slice(0, 16);
  const credentials = JSON.stringify({ username, password: PASSWORD });
  let auth = await requestJson(config.target, "/api/register", {
    method: "POST",
    body: credentials,
  });
  if (auth.response.status === 409) {
    auth = await requestJson(config.target, "/api/session", { method: "POST", body: credentials });
  }
  if (!auth.response.ok) throw new Error(`authentication failed (${auth.response.status})`);
  const cookie = sessionCookie(auth.response);
  if (!cookie) throw new Error("authentication response omitted the session cookie");
  return { index, suffix, username, cookie };
}

async function adventureById(config, account, adventureId) {
  const result = await requestJson(
    config.target,
    `/api/adventures/${encodeURIComponent(adventureId)}`,
    { method: "GET" },
    account.cookie,
  );
  if (!result.response.ok || typeof result.body?.id !== "string") {
    throw requestFailure("adventure read", result);
  }
  return result.body;
}

async function mapById(config, account, mapId) {
  const result = await requestJson(
    config.target,
    `/api/maps/${encodeURIComponent(mapId)}`,
    { method: "GET" },
    account.cookie,
  );
  if (!result.response.ok || typeof result.body?.id !== "string") {
    throw requestFailure("map read", result);
  }
  return result.body;
}

function mapSaveBody(map) {
  return {
    name: map.name,
    tilesetId: map.tilesetId,
    cols: map.cols,
    rows: map.rows,
    layers: map.layers,
    elements: map.elements,
    spawn: map.spawn,
    markers: map.markers,
    events: map.events,
  };
}

function eventCell(map, offsets) {
  const occupied = new Set((map.events ?? []).map((event) => `${event.col}:${event.row}`));
  for (const [dx, dy] of offsets) {
    const col = map.spawn.col + dx;
    const row = map.spawn.row + dy;
    if (col < 0 || col >= map.cols || row < 0 || row >= map.rows) continue;
    if (!occupied.has(`${col}:${row}`)) return { col, row };
  }
  throw new Error(`load-test map ${map.id} has no free event cell near its spawn`);
}

function functionalEvent(map, { name, kind, cell, species = null, patrolRadius = null }) {
  const templatePage = map.events?.[0]?.pages?.[0];
  if (!templatePage) throw new Error(`load-test map ${map.id} has no functional event page`);
  const page = structuredClone(templatePage);
  page.commands = [];
  return {
    id: crypto.randomUUID(),
    ...cell,
    name,
    ordinal: Math.max(0, ...(map.events ?? []).map((event) => event.ordinal ?? 0)) + 1,
    kind,
    species: kind === "monster" ? species : null,
    patrolRadius: kind === "monster" ? patrolRadius : null,
    pages: [page],
  };
}

function ensureNamedEvent(map, definition) {
  const existing = (map.events ?? []).find((event) => event.name === definition.name);
  if (existing) {
    if (existing.kind !== definition.kind) {
      throw new Error(
        `load-test event ${definition.name} has kind ${existing.kind}, expected ${definition.kind}`,
      );
    }
    return { event: existing, changed: false };
  }
  const event = functionalEvent(map, definition);
  map.events = [...(map.events ?? []), event];
  return { event, changed: true };
}

function ensureCombatEvents(map, role) {
  let changed = false;
  for (const [number, offsets] of [
    [
      1,
      [
        [1, 0],
        [1, 1],
        [-1, 0],
      ],
    ],
    [
      2,
      [
        [0, 1],
        [-1, 1],
        [0, -1],
      ],
    ],
  ]) {
    const ensured = ensureNamedEvent(map, {
      name: `loadtest-${role}-mob-${number}`,
      kind: "monster",
      cell: eventCell(map, offsets),
      species: "spear_goblin",
      patrolRadius: 96,
    });
    changed ||= ensured.changed;
  }
  return changed;
}

async function saveMap(config, account, map) {
  const result = await requestJson(
    config.target,
    `/api/maps/${encodeURIComponent(map.id)}`,
    { method: "PUT", body: JSON.stringify(mapSaveBody(map)) },
    account.cookie,
  );
  if (!result.response.ok || typeof result.body?.id !== "string") {
    throw requestFailure("map update", result);
  }
  return result.body;
}

function graphHasLoadLoop(graph, mapOne, mapTwo, endEvent) {
  if (graph?.start?.mapId !== mapOne.id) return false;
  const exitsOne = (mapOne.events ?? []).filter((event) => event.kind === "exit");
  const exitsTwo = (mapTwo.events ?? []).filter((event) => event.kind === "exit");
  const toTwo = graph.links?.some(
    (link) =>
      link.mapId === mapOne.id &&
      exitsOne.some((event) => event.id === link.exitId) &&
      link.dest?.mapId === mapTwo.id,
  );
  const toOne = graph.links?.some(
    (link) =>
      link.mapId === mapTwo.id &&
      exitsTwo.some((event) => event.id === link.exitId) &&
      link.dest?.mapId === mapOne.id,
  );
  const toEnd = graph.links?.some(
    (link) => link.mapId === mapTwo.id && link.exitId === endEvent.id && link.dest === "end",
  );
  return Boolean(toTwo && toOne && toEnd);
}

function eventCentre(event) {
  return { x: event.col * 64 + 32, y: event.row * 64 + 32 };
}

async function ensureLoadAdventure(config, host, cohortIndex) {
  const cohort = String(cohortIndex).padStart(3, "0");
  const title = `Loadtest ${config.prefix} ${config.scenario} ${cohort}`;
  const listed = await requestJson(
    config.target,
    "/api/adventures",
    { method: "GET" },
    host.cookie,
  );
  if (!listed.response.ok || !Array.isArray(listed.body)) {
    throw requestFailure("adventure listing", listed);
  }
  let adventureId = listed.body.find((item) => item.title === title)?.id;
  if (typeof adventureId !== "string") {
    const created = await requestJson(
      config.target,
      "/api/adventures",
      { method: "POST", body: JSON.stringify({ title, maxPlayers: PARTY_SIZE }) },
      host.cookie,
    );
    if (!created.response.ok || typeof created.body?.id !== "string") {
      throw requestFailure("adventure creation", created);
    }
    adventureId = created.body.id;
  }

  let adventure = await adventureById(config, host, adventureId);
  let mapOne = adventure.graph?.start?.mapId
    ? await mapById(config, host, adventure.graph.start.mapId)
    : null;
  const mapsResult = await requestJson(
    config.target,
    `/api/maps?adventure=${encodeURIComponent(adventureId)}`,
    { method: "GET" },
    host.cookie,
  );
  if (!mapsResult.response.ok || !Array.isArray(mapsResult.body)) {
    throw requestFailure("map listing", mapsResult);
  }
  if (!mapOne && mapsResult.body[0]?.id)
    mapOne = await mapById(config, host, mapsResult.body[0].id);
  if (!mapOne) throw new Error(`load-test adventure ${adventureId} has no first map`);
  const mapTwoSummary = mapsResult.body.find((map) => map.name === LOAD_MAP_TWO);
  let mapTwo = mapTwoSummary?.id ? await mapById(config, host, mapTwoSummary.id) : null;
  let endEvent = mapTwo?.events?.find(
    (event) => event.kind === "exit" && event.name === LOAD_END_EVENT,
  );
  const configured =
    mapTwo && endEvent && graphHasLoadLoop(adventure.graph, mapOne, mapTwo, endEvent);

  if (!configured) {
    const draft = await requestJson(
      config.target,
      `/api/adventures/${encodeURIComponent(adventureId)}`,
      {
        method: "PUT",
        body: JSON.stringify({ title, maxPlayers: PARTY_SIZE, graph: { start: null, links: [] } }),
      },
      host.cookie,
    );
    if (!draft.response.ok) {
      throw new Error(
        `${requestFailure("load-test adventure reset", draft).message}; use a fresh --prefix if an incompatible saved party already references it`,
      );
    }
    adventure = draft.body;
    if (!mapTwo) {
      const createdMap = await requestJson(
        config.target,
        "/api/maps",
        { method: "POST", body: JSON.stringify({ adventureId, name: LOAD_MAP_TWO }) },
        host.cookie,
      );
      if (!createdMap.response.ok || typeof createdMap.body?.id !== "string") {
        throw requestFailure("second map creation", createdMap);
      }
      mapTwo = createdMap.body;
    }
    const ensuredEnd = ensureNamedEvent(mapTwo, {
      name: LOAD_END_EVENT,
      kind: "exit",
      cell: eventCell(mapTwo, [
        [2, -2],
        [2, 0],
        [-2, 0],
      ]),
    });
    endEvent = ensuredEnd.event;
  }

  const mapOneChanged = ensureCombatEvents(mapOne, "a");
  const mapTwoChanged = ensureCombatEvents(mapTwo, "b");
  if (mapOneChanged) mapOne = await saveMap(config, host, mapOne);
  if (mapTwoChanged || !configured) mapTwo = await saveMap(config, host, mapTwo);

  const entryOne = mapOne.events.find((event) => event.kind === "entry");
  const exitOne = mapOne.events.find((event) => event.kind === "exit");
  const entryTwo = mapTwo.events.find((event) => event.kind === "entry");
  endEvent = mapTwo.events.find((event) => event.kind === "exit" && event.name === LOAD_END_EVENT);
  const returnExit = mapTwo.events.find(
    (event) => event.kind === "exit" && event.id !== endEvent?.id,
  );
  if (!entryOne || !exitOne || !entryTwo || !returnExit || !endEvent) {
    throw new Error(`load-test adventure ${adventureId} is missing a transition anchor`);
  }
  const graph = {
    start: { mapId: mapOne.id, entryId: entryOne.id },
    links: [
      { mapId: mapOne.id, exitId: exitOne.id, dest: { mapId: mapTwo.id, entryId: entryTwo.id } },
      { mapId: mapTwo.id, exitId: returnExit.id, dest: { mapId: mapOne.id, entryId: entryOne.id } },
      { mapId: mapTwo.id, exitId: endEvent.id, dest: "end" },
    ],
  };
  if (!graphHasLoadLoop(adventure.graph, mapOne, mapTwo, endEvent)) {
    const updated = await requestJson(
      config.target,
      `/api/adventures/${encodeURIComponent(adventureId)}`,
      { method: "PUT", body: JSON.stringify({ title, maxPlayers: PARTY_SIZE, graph }) },
      host.cookie,
    );
    if (!updated.response.ok) throw requestFailure("adventure graph update", updated);
  }
  return {
    adventureId,
    transitionTargets: {
      [mapOne.id]: eventCentre(exitOne),
      [mapTwo.id]: eventCentre(returnExit),
    },
  };
}

async function listParties(config, account) {
  const parties = [];
  let cursor = null;
  for (let page = 0; page < 20; page++) {
    const suffix = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    const result = await requestJson(config.target, `/api/parties${suffix}`, {}, account.cookie);
    if (!result.response.ok) throw requestFailure("party listing", result);
    if (Array.isArray(result.body)) return result.body;
    if (!Array.isArray(result.body?.items)) throw new Error("party listing returned a bad page");
    parties.push(...result.body.items);
    if (!result.body.nextCursor) return parties;
    cursor = result.body.nextCursor;
  }
  return parties;
}

async function ensureLoadParty(config, host, cohortIndex, adventureId) {
  const name = `Load ${config.prefix} ${config.scenario} ${String(cohortIndex).padStart(3, "0")}`;
  const listed = await listParties(config, host);
  let party = listed.find(
    (item) => item.mine && item.adventureId === adventureId && item.name === name,
  );
  if (!party) {
    const created = await requestJson(
      config.target,
      "/api/parties",
      {
        method: "POST",
        body: JSON.stringify({ adventureId, name, color: PARTY_COLORS[0] }),
      },
      host.cookie,
    );
    if (!created.response.ok || typeof created.body?.id !== "string") {
      throw requestFailure("party creation", created);
    }
    party = created.body;
  }
  return party;
}

async function provisionPartyHero(config, account, slot, partyId, transitionTargets) {
  if (slot > 0) {
    const joined = await requestJson(
      config.target,
      `/api/parties/${encodeURIComponent(partyId)}/join`,
      { method: "POST", body: JSON.stringify({ color: PARTY_COLORS[slot] }) },
      account.cookie,
    );
    const alreadyJoined =
      joined.response.status === 409 && joined.body?.error === "party_already_member";
    if (!joined.response.ok && !alreadyJoined) throw requestFailure("party join", joined);
  }

  const heroPath = `/api/parties/${encodeURIComponent(partyId)}/heroes`;
  const listed = await requestJson(config.target, heroPath, { method: "GET" }, account.cookie);
  if (!listed.response.ok || !Array.isArray(listed.body)) {
    throw requestFailure("hero listing", listed);
  }
  const heroName = `Load${account.suffix}`;
  let hero = listed.body.find((item) => item.name === heroName) ?? listed.body[0];
  if (!hero) {
    const classes = ["warrior", "ranger", "priest"];
    const created = await requestJson(
      config.target,
      heroPath,
      {
        method: "POST",
        body: JSON.stringify({
          name: heroName,
          class: classes[account.index % classes.length],
        }),
      },
      account.cookie,
    );
    if (!created.response.ok || typeof created.body?.id !== "string") {
      throw requestFailure("hero creation", created);
    }
    hero = created.body;
  }
  if (typeof hero.id !== "string") throw new Error("hero has no id");
  return {
    index: account.index,
    username: account.username,
    cookie: account.cookie,
    partyId,
    heroId: hero.id,
    transitionTargets,
  };
}

async function provisionCohort(config, authenticated, cohortIndex) {
  const host = authenticated[0];
  if (!host?.ok) {
    throw new Error(`cohort host authentication failed: ${host?.error ?? "unknown error"}`);
  }
  const route = await ensureLoadAdventure(config, host.value, cohortIndex);
  const party = await ensureLoadParty(config, host.value, cohortIndex, route.adventureId);
  return Promise.all(
    authenticated.map(async (result, slot) => {
      if (!result?.ok) return result;
      try {
        return {
          ok: true,
          value: await provisionPartyHero(
            config,
            result.value,
            slot,
            party.id,
            route.transitionTargets,
          ),
        };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }),
  );
}

async function mapConcurrent(count, concurrency, operation) {
  const results = new Array(count);
  let next = 0;
  async function worker() {
    for (;;) {
      const index = next++;
      if (index >= count) return;
      try {
        results[index] = { ok: true, value: await operation(index) };
      } catch (error) {
        results[index] = {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(count, concurrency) }, () => worker()));
  return results;
}

function percentile(values, ratio) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function navigationPath(world, start, target) {
  const cellSize = 64;
  const playerSize = world.playerSize ?? 32;
  const columns = Math.ceil(world.width / cellSize);
  const rows = Math.ceil(world.height / cellSize);
  const cellOf = (point) => ({
    column: Math.max(0, Math.min(columns - 1, Math.floor(point.x / cellSize))),
    row: Math.max(0, Math.min(rows - 1, Math.floor(point.y / cellSize))),
  });
  const keyOf = (column, row) => row * columns + column;
  const pointOf = (column, row) => ({
    x: Math.min(world.width - playerSize, column * cellSize),
    y: Math.min(world.height - playerSize, row * cellSize),
  });
  const walkable = (column, row) => {
    const point = pointOf(column, row);
    return !(world.obstacles ?? []).some(
      (obstacle) =>
        point.x < obstacle.x + obstacle.width &&
        point.x + playerSize > obstacle.x &&
        point.y < obstacle.y + obstacle.height &&
        point.y + playerSize > obstacle.y,
    );
  };
  const startCell = cellOf(start);
  const targetCell = cellOf(target);
  const startKey = keyOf(startCell.column, startCell.row);
  const targetKey = keyOf(targetCell.column, targetCell.row);
  const queue = [startCell];
  const parents = new Map([[startKey, null]]);
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    const currentKey = keyOf(current.column, current.row);
    if (currentKey === targetKey) break;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const column = current.column + dx;
      const row = current.row + dy;
      if (column < 0 || row < 0 || column >= columns || row >= rows) continue;
      const key = keyOf(column, row);
      if (parents.has(key) || (!walkable(column, row) && key !== targetKey)) continue;
      parents.set(key, currentKey);
      queue.push({ column, row });
    }
  }
  if (!parents.has(targetKey)) return [target];
  const reversed = [];
  let key = targetKey;
  while (key !== startKey) {
    const row = Math.floor(key / columns);
    reversed.push(pointOf(key % columns, row));
    const parent = parents.get(key);
    if (parent === null || parent === undefined) break;
    key = parent;
  }
  return reversed.reverse();
}

class LoadMetrics {
  constructor(requested) {
    this.requested = requested;
    this.connectedIds = new Set();
    this.currentlyConnected = 0;
    this.peakConnected = 0;
    this.connectionFailures = 0;
    this.unexpectedDisconnects = 0;
    this.messages = 0;
    this.bytes = 0;
    this.maxMessageBytes = 0;
    this.ackLatencies = [];
    this.transitions = 0;
    this.reconnections = 0;
    this.protocolErrors = 0;
  }

  opened(id) {
    this.connectedIds.add(id);
    this.currentlyConnected += 1;
    this.peakConnected = Math.max(this.peakConnected, this.currentlyConnected);
  }

  closed() {
    this.currentlyConnected = Math.max(0, this.currentlyConnected - 1);
  }
}

class VirtualPlayer {
  constructor(identity, config, metrics) {
    this.identity = identity;
    this.config = config;
    this.metrics = metrics;
    this.socket = null;
    this.seq = 0;
    this.sentAt = new Map();
    this.selfId = identity.heroId;
    this.position = null;
    this.monsters = new Map();
    this.transitionTarget = null;
    this.world = null;
    this.route = [];
    this.routeIndex = 0;
    this.zone = null;
    this.direction = { up: false, down: false, left: false, right: true };
    this.directionChangedAt = 0;
    this.lastAttackAt = 0;
    this.lastSkillAt = 0;
    this.lastChatAt = 0;
    this.closing = false;
    this.reconnecting = false;
    this.actionTimer = null;
  }

  websocketUrl() {
    const url = new URL(
      `/api/ws?party=${encodeURIComponent(this.identity.partyId)}&hero=${encodeURIComponent(this.identity.heroId)}`,
      this.config.target,
    );
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url;
  }

  connect(timeoutMs = 8_000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let welcomed = false;
      let failedBeforeWelcome = false;
      const socket = new WebSocket(this.websocketUrl(), {
        headers: { Cookie: this.identity.cookie },
      });
      this.socket = socket;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        failedBeforeWelcome = true;
        socket.terminate();
        reject(new Error("websocket welcome timed out"));
      }, timeoutMs);
      socket.on("message", (data) => {
        const bytes = data.byteLength;
        this.metrics.messages += 1;
        this.metrics.bytes += bytes;
        this.metrics.maxMessageBytes = Math.max(this.metrics.maxMessageBytes, bytes);
        let message;
        try {
          message = JSON.parse(data.toString());
        } catch {
          this.metrics.protocolErrors += 1;
          return;
        }
        if (!message || typeof message.t !== "string") {
          this.metrics.protocolErrors += 1;
          return;
        }
        this.receive(message);
        if (message.t === "event" && message.code === "room.full" && !settled) {
          settled = true;
          failedBeforeWelcome = true;
          clearTimeout(timeout);
          reject(new Error("room capacity reached"));
          return;
        }
        if (message.t === "welcome" && !settled) {
          settled = true;
          welcomed = true;
          clearTimeout(timeout);
          this.metrics.opened(this.identity.heroId);
          resolve();
        }
      });
      socket.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(error);
      });
      socket.on("close", (code) => {
        clearTimeout(timeout);
        if (!settled) {
          settled = true;
          reject(new Error(`websocket closed before welcome (${code})`));
          return;
        }
        if (welcomed) this.metrics.closed();
        const transition = code === 4008;
        if (!this.closing && !this.reconnecting && !transition && !failedBeforeWelcome) {
          this.metrics.unexpectedDisconnects += 1;
        }
        if (!this.closing && transition) {
          this.reconnecting = true;
          setTimeout(() => {
            if (this.closing) {
              this.reconnecting = false;
              return;
            }
            this.connect()
              .catch((error) => {
                if (this.closing) return;
                this.metrics.connectionFailures += 1;
                console.error(
                  `transition reconnect ${this.identity.index} failed: ${error instanceof Error ? error.message : String(error)}`,
                );
              })
              .finally(() => {
                this.reconnecting = false;
              });
          }, RECONNECT_DELAY_MS);
        }
      });
    });
  }

  receive(message) {
    if (message.t === "welcome") {
      const previousZone = this.zone;
      this.zone = message.world?.zoneId ?? null;
      if (previousZone && this.zone && previousZone !== this.zone) this.metrics.transitions += 1;
      this.world = message.world ?? null;
      this.transitionTarget = this.zone
        ? (this.identity.transitionTargets[this.zone] ?? null)
        : null;
      this.selfId = message.selfId ?? this.selfId;
      this.replaceWorld(message);
      if (this.world && this.transitionTarget && this.position) {
        this.route = navigationPath(this.world, this.position, this.transitionTarget);
        this.routeIndex = 0;
      }
      this.ackFrom(message.players);
      return;
    }
    if (message.t === "world.resync") {
      this.replaceWorld(message);
      this.ackFrom(message.players);
      return;
    }
    if (message.t === "world.delta") {
      this.applyMonsterDelta(message.monsters);
      this.ackFrom(message.players?.upsert);
    }
  }

  replaceWorld(message) {
    this.monsters.clear();
    for (const monster of message.monsters ?? []) this.monsters.set(monster.id, monster);
    const self = (message.players ?? []).find((player) => player.id === this.selfId);
    if (self) this.position = { x: self.x, y: self.y };
  }

  applyMonsterDelta(delta) {
    for (const monster of delta?.upsert ?? []) this.monsters.set(monster.id, monster);
    for (const id of delta?.remove ?? []) this.monsters.delete(id);
  }

  ackFrom(players) {
    const self = (players ?? []).find((player) => player.id === this.selfId);
    if (!self) return;
    this.position = { x: self.x, y: self.y };
    if (!Number.isSafeInteger(self.ack)) return;
    const acknowledgedAt = performance.now();
    for (const [seq, sentAt] of this.sentAt) {
      if (seq > self.ack) continue;
      this.metrics.ackLatencies.push(acknowledgedAt - sentAt);
      this.sentAt.delete(seq);
    }
  }

  send(message) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  sendInput(input) {
    const seq = ++this.seq;
    if (this.send({ t: "input", seq, input })) this.sentAt.set(seq, performance.now());
  }

  nearestMonsterDirection() {
    if (!this.position) return this.direction;
    let target = null;
    let distance = Number.POSITIVE_INFINITY;
    for (const monster of this.monsters.values()) {
      if (monster.dead) continue;
      const current = Math.hypot(monster.x - this.position.x, monster.y - this.position.y);
      if (current < distance) {
        distance = current;
        target = monster;
      }
    }
    return target ? this.towards(target) : this.direction;
  }

  towards(target) {
    if (!this.position) return this.direction;
    const dx = target.x - this.position.x;
    const dy = target.y - this.position.y;
    return {
      up: dy < -18,
      down: dy > 18,
      left: dx < -18,
      right: dx > 18,
    };
  }

  tick(now) {
    const scenario = this.config.scenario;
    if (scenario === "idle" || scenario === "reconnect") return;
    if (scenario === "zone-transition" && this.transitionTarget) {
      let waypoint = this.route[this.routeIndex] ?? this.transitionTarget;
      while (
        this.position &&
        this.routeIndex < this.route.length &&
        Math.hypot(waypoint.x - this.position.x, waypoint.y - this.position.y) < 36
      ) {
        this.routeIndex += 1;
        waypoint = this.route[this.routeIndex] ?? this.transitionTarget;
      }
      this.direction = this.towards(waypoint);
    } else if (scenario === "combat") this.direction = this.nearestMonsterDirection();
    else if (now - this.directionChangedAt > 1_500) {
      const directions = [
        { up: true, down: false, left: false, right: false },
        { up: false, down: true, left: false, right: false },
        { up: false, down: false, left: true, right: false },
        { up: false, down: false, left: false, right: true },
      ];
      this.direction =
        directions[(this.identity.index + Math.floor(now / 1_500)) % directions.length];
      this.directionChangedAt = now;
    }
    this.sendInput(this.direction);

    if ((scenario === "combat" || scenario === "mixed") && now - this.lastAttackAt > 800) {
      this.send({ t: "attack" });
      this.lastAttackAt = now;
    }
    if ((scenario === "combat" || scenario === "mixed") && now - this.lastSkillAt > 2_000) {
      this.send({ t: "skill", slot: 1 });
      this.lastSkillAt = now;
    }
    if (scenario === "mixed" && now - this.lastChatAt > 9_000 + this.identity.index * 17) {
      this.send({ t: "chat", channel: "local", text: `load ${this.identity.index}` });
      this.lastChatAt = now;
    }
  }

  start() {
    this.actionTimer = setInterval(() => this.tick(Date.now()), 50);
  }

  forceReconnect() {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.reconnecting = true;
    this.socket.close(1000, "loadtest reconnect");
    setTimeout(() => {
      if (this.closing) {
        this.reconnecting = false;
        return;
      }
      this.connect()
        .then(() => {
          this.metrics.reconnections += 1;
        })
        .catch((error) => {
          if (this.closing) return;
          this.metrics.connectionFailures += 1;
          console.error(
            `forced reconnect ${this.identity.index} failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        })
        .finally(() => {
          this.reconnecting = false;
        });
    }, RECONNECT_DELAY_MS);
  }

  stop() {
    this.closing = true;
    if (this.actionTimer) clearInterval(this.actionTimer);
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.close(1000, "loadtest complete");
    else if (this.socket?.readyState === WebSocket.CONNECTING) this.socket.terminate();
  }
}

async function main() {
  const config = configuration(process.argv.slice(2));
  console.log(
    `LindoCara load test: ${config.players} players, ${config.durationSeconds}s, ${config.scenario}, ${config.target.origin}`,
  );
  const setupStartedAt = performance.now();
  const authenticated = await mapConcurrent(config.players, 5, (index) =>
    authenticateVirtualPlayer(config, index),
  );
  const cohortCount = Math.ceil(config.players / PARTY_SIZE);
  const cohorts = await mapConcurrent(cohortCount, 3, async (cohortIndex) => {
    const start = cohortIndex * PARTY_SIZE;
    return provisionCohort(config, authenticated.slice(start, start + PARTY_SIZE), cohortIndex);
  });
  const provisioned = new Array(config.players);
  for (let cohortIndex = 0; cohortIndex < cohorts.length; cohortIndex++) {
    const start = cohortIndex * PARTY_SIZE;
    const cohort = cohorts[cohortIndex];
    if (cohort?.ok) {
      for (let slot = 0; slot < cohort.value.length; slot++) {
        provisioned[start + slot] = cohort.value[slot];
      }
      continue;
    }
    for (let slot = 0; slot < Math.min(PARTY_SIZE, config.players - start); slot++) {
      provisioned[start + slot] = {
        ok: false,
        error: cohort?.error ?? "unknown cohort provisioning error",
      };
    }
  }
  const metrics = new LoadMetrics(config.players);
  const identities = [];
  for (const result of provisioned) {
    if (result?.ok) identities.push(result.value);
    else {
      metrics.connectionFailures += 1;
      console.error(`provisioning failed: ${result?.error ?? "unknown error"}`);
    }
  }
  const players = identities.map((identity) => new VirtualPlayer(identity, config, metrics));
  await mapConcurrent(players.length, 10, async (index) => {
    try {
      await players[index].connect();
    } catch (error) {
      metrics.connectionFailures += 1;
      console.error(
        `connection ${index} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });

  const scenarioStartedAt = performance.now();
  for (const player of players) player.start();
  let reconnectTimer = null;
  if (config.scenario === "reconnect") {
    reconnectTimer = setTimeout(
      () => {
        players.forEach((player, index) => {
          setTimeout(() => player.forceReconnect(), index * 20);
        });
      },
      (config.durationSeconds * 1_000) / 2,
    );
  }
  await new Promise((resolve) => setTimeout(resolve, config.durationSeconds * 1_000));
  if (reconnectTimer) clearTimeout(reconnectTimer);
  for (const player of players) player.stop();
  await new Promise((resolve) => setTimeout(resolve, 300));
  const endedAt = performance.now();
  const actualSeconds = (endedAt - scenarioStartedAt) / 1_000;
  const averageMessage = metrics.messages === 0 ? 0 : metrics.bytes / metrics.messages;
  const averageAck =
    metrics.ackLatencies.length === 0
      ? 0
      : metrics.ackLatencies.reduce((sum, value) => sum + value, 0) / metrics.ackLatencies.length;
  const report = {
    scenario: config.scenario,
    target: config.target.origin,
    playersRequested: config.players,
    playersConnected: metrics.connectedIds.size,
    peakConnected: metrics.peakConnected,
    connectionFailures: metrics.connectionFailures,
    unexpectedDisconnects: metrics.unexpectedDisconnects,
    successRatePercent: round((metrics.connectedIds.size / config.players) * 100),
    messagesReceived: metrics.messages,
    messagesPerSecond: round(metrics.messages / actualSeconds),
    bytesReceived: metrics.bytes,
    bytesPerSecond: round(metrics.bytes / actualSeconds),
    averageMessageBytes: round(averageMessage),
    maxMessageBytes: metrics.maxMessageBytes,
    acknowledgementLatencyMs: {
      samples: metrics.ackLatencies.length,
      average: round(averageAck),
      p95: round(percentile(metrics.ackLatencies, 0.95)),
      max: round(metrics.ackLatencies.length === 0 ? 0 : Math.max(...metrics.ackLatencies)),
    },
    successfulTransitions: metrics.transitions,
    successfulReconnects: metrics.reconnections,
    protocolErrors: metrics.protocolErrors,
    setupSeconds: round((scenarioStartedAt - setupStartedAt) / 1_000),
    actualDurationSeconds: round(actualSeconds),
  };
  console.log(JSON.stringify(report, null, 2));
  if (
    metrics.connectedIds.size === 0 ||
    (config.scenario === "reconnect" && metrics.reconnections === 0) ||
    (config.scenario === "zone-transition" && metrics.transitions === 0)
  ) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
