import process from "node:process";
import WebSocket from "ws";

const SCENARIOS = new Set(["idle", "movement", "combat", "mixed", "reconnect", "zone-transition"]);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const PRODUCTION_HOST = "lindocara.alepha.dev";
const PASSWORD = process.env.LINDOCARA_LOADTEST_PASSWORD ?? "LindoLoad-Local-2026";

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

async function provisionVirtualPlayer(config, index) {
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

  const listed = await requestJson(config.target, "/api/characters", { method: "GET" }, cookie);
  if (!listed.response.ok || !Array.isArray(listed.body)) {
    throw new Error(`character listing failed (${listed.response.status})`);
  }
  let character = listed.body[0];
  if (!character) {
    const classes = ["warrior", "ranger", "priest"];
    const created = await requestJson(
      config.target,
      "/api/characters",
      {
        method: "POST",
        body: JSON.stringify({
          name: `Load${suffix}`,
          class: classes[index % classes.length],
          appearance: { body: "wayfarer", primaryColor: "azure" },
        }),
      },
      cookie,
    );
    if (!created.response.ok || typeof created.body?.id !== "string") {
      throw new Error(`character creation failed (${created.response.status})`);
    }
    character = created.body;
  }
  if (typeof character.id !== "string") throw new Error("character has no id");
  return { index, username, cookie, characterId: character.id };
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
    this.selfId = identity.characterId;
    this.position = null;
    this.monsters = new Map();
    this.portal = null;
    this.world = null;
    this.route = [];
    this.routeIndex = 0;
    this.zone = null;
    this.direction = { up: false, down: false, left: false, right: true };
    this.directionChangedAt = 0;
    this.lastAttackAt = 0;
    this.lastSkillAt = 0;
    this.lastChatAt = 0;
    this.lastInteractAt = 0;
    this.closing = false;
    this.reconnecting = false;
    this.actionTimer = null;
  }

  websocketUrl() {
    const url = new URL(
      `/api/ws?character=${encodeURIComponent(this.identity.characterId)}`,
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
          this.metrics.opened(this.identity.characterId);
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
              .catch(() => {
                this.metrics.connectionFailures += 1;
              })
              .finally(() => {
                this.reconnecting = false;
              });
          }, 150);
        }
      });
    });
  }

  receive(message) {
    if (message.t === "welcome") {
      const previousZone = this.zone;
      this.zone = message.world?.zoneNameKey ?? null;
      if (previousZone && this.zone && previousZone !== this.zone) this.metrics.transitions += 1;
      this.portal = Array.isArray(message.world?.portals)
        ? (message.world.portals[0] ?? null)
        : null;
      this.world = message.world ?? null;
      this.selfId = message.selfId ?? this.selfId;
      this.replaceWorld(message);
      if (this.world && this.portal && this.position) {
        this.route = navigationPath(this.world, this.position, this.portal);
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
    if (scenario === "zone-transition" && this.portal) {
      let waypoint = this.route[this.routeIndex] ?? this.portal;
      while (
        this.position &&
        this.routeIndex < this.route.length &&
        Math.hypot(waypoint.x - this.position.x, waypoint.y - this.position.y) < 36
      ) {
        this.routeIndex += 1;
        waypoint = this.route[this.routeIndex] ?? this.portal;
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
    if (
      scenario === "zone-transition" &&
      this.position &&
      this.portal &&
      Math.hypot(this.portal.x - this.position.x, this.portal.y - this.position.y) < 72 &&
      now - this.lastInteractAt > 1_200
    ) {
      this.send({ t: "interact" });
      this.lastInteractAt = now;
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
      this.connect()
        .catch(() => {
          this.metrics.connectionFailures += 1;
        })
        .finally(() => {
          this.reconnecting = false;
        });
    }, 150);
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
  const provisioned = await mapConcurrent(config.players, 5, (index) =>
    provisionVirtualPlayer(config, index),
  );
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
    protocolErrors: metrics.protocolErrors,
    setupSeconds: round((scenarioStartedAt - setupStartedAt) / 1_000),
    actualDurationSeconds: round(actualSeconds),
  };
  console.log(JSON.stringify(report, null, 2));
  if (metrics.connectedIds.size === 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
