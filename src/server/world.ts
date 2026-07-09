/**
 * The world: one Durable Object holding every connected player, and the only authority on
 * where each square is.
 *
 * Sockets are accepted through the WebSocket Hibernation API, so an empty world costs
 * nothing. A running `setInterval` keeps the object resident, so the loop only exists
 * while at least one player is connected — the last player to leave shuts it down and the
 * world is free to hibernate.
 */

import { DurableObject } from "cloudflare:workers";
import {
  type ClientMessage,
  encodeServerMessage,
  type PlayerSnapshot,
  parseClientMessage,
  type ServerMessage,
} from "../shared/protocol.js";
import {
  type Input,
  NO_INPUT,
  PLAYER_SIZE,
  step,
  TICK_DT,
  TICK_HZ,
  TICK_MS,
  type Vec2,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "../shared/simulation.js";

/**
 * Rides along with the socket rather than living in `#players`, so it outlives the object.
 *
 * A running `setInterval` prevents idle hibernation, so a world with players in it will not
 * simply doze off. But if the object is ever rebuilt while its hibernatable sockets survive
 * — which is the exact situation the Hibernation API exists for — `#players` is gone and the
 * sockets are not. Carrying the position here lets those players resume where they were
 * instead of being teleported to a fresh spawn.
 *
 * Written at most once a second rather than every tick: 20 writes/second/player to buy back
 * one second of accuracy is a bad trade.
 */
export interface Attachment {
  id: string;
  nick: string;
  x: number;
  y: number;
}

/** ~1s at TICK_HZ. */
const PERSIST_EVERY_TICKS = TICK_HZ;

interface Player {
  id: string;
  nick: string;
  x: number;
  y: number;
  input: Input;
  /** Position has changed since it was last written to the socket attachment. */
  dirty: boolean;
}

function spawnPosition(): Vec2 {
  return {
    x: Math.random() * (WORLD_WIDTH - PLAYER_SIZE),
    y: Math.random() * (WORLD_HEIGHT - PLAYER_SIZE),
  };
}

/**
 * Where a player resumes when the world is rebuilt beneath them. Exported so the rule can
 * be tested directly: an eviction cannot be simulated while the tick loop is running, since
 * eviction waits for in-flight work to drain and the loop never drains.
 */
export function positionFromAttachment(attachment: Attachment | null): Vec2 {
  if (attachment && Number.isFinite(attachment.x) && Number.isFinite(attachment.y)) {
    return { x: attachment.x, y: attachment.y };
  }
  return spawnPosition();
}

export class World extends DurableObject<Env> {
  #players = new Map<WebSocket, Player>();
  #loop: ReturnType<typeof setInterval> | null = null;
  #tick = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    // Being rebuilt: the sockets outlived our memory. Restore each player from what their
    // own socket carries. A player whose position was never persisted spawns fresh.
    for (const ws of ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as Attachment | null;
      if (!attachment) continue;

      this.#players.set(ws, {
        id: attachment.id,
        nick: attachment.nick,
        ...positionFromAttachment(attachment),
        input: NO_INPUT,
        dirty: false,
      });
    }

    if (this.#players.size > 0) this.#startLoop();
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected a websocket upgrade", { status: 426 });
    }

    // The Worker has already verified the signed cookie; it is the only thing that can
    // reach this object, so these headers are trusted.
    const id = request.headers.get("x-player-id");
    const nick = request.headers.get("x-player-nick");
    if (!id || !nick) return new Response("unauthorized", { status: 401 });

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);

    const player: Player = { id, nick, ...spawnPosition(), input: NO_INPUT, dirty: false };
    server.serializeAttachment({ id, nick, x: player.x, y: player.y } satisfies Attachment);
    this.#players.set(server, player);

    this.#send(server, {
      t: "welcome",
      selfId: id,
      world: { width: WORLD_WIDTH, height: WORLD_HEIGHT, playerSize: PLAYER_SIZE },
      players: this.#snapshot(),
    });

    this.#startLoop();
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const player = this.#players.get(ws);
    if (!player) return;

    const message: ClientMessage | null = parseClientMessage(raw);
    // A malformed frame is a client bug or an attack. Drop it; never trust it, never crash.
    if (!message) return;

    player.input = message.input;
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    this.#drop(ws);
    // Complete the closing handshake. 1006 is never a legal code to send back.
    try {
      ws.close(code === 1006 ? 1000 : code, reason);
    } catch {
      // Already closed — nothing to do.
    }
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    this.#drop(ws);
  }

  #drop(ws: WebSocket): void {
    this.#players.delete(ws);
    if (this.#players.size === 0) this.#stopLoop();
  }

  #startLoop(): void {
    if (this.#loop !== null) return;
    this.#loop = setInterval(() => this.#advance(), TICK_MS);
  }

  #stopLoop(): void {
    if (this.#loop === null) return;
    clearInterval(this.#loop);
    this.#loop = null;
  }

  /** One fixed timestep: integrate every player, then tell everyone where everyone is. */
  #advance(): void {
    if (this.#players.size === 0) {
      this.#stopLoop();
      return;
    }

    this.#tick += 1;
    const persisting = this.#tick % PERSIST_EVERY_TICKS === 0;

    for (const [ws, player] of this.#players) {
      const { x, y } = step(player, player.input, TICK_DT);
      if (x !== player.x || y !== player.y) {
        player.x = x;
        player.y = y;
        player.dirty = true;
      }

      // Only a player who actually moved is worth a write.
      if (persisting && player.dirty) {
        const { id, nick } = player;
        ws.serializeAttachment({ id, nick, x, y } satisfies Attachment);
        player.dirty = false;
      }
    }

    this.#broadcast({ t: "snapshot", tick: this.#tick, players: this.#snapshot() });
  }

  #snapshot(): PlayerSnapshot[] {
    return Array.from(this.#players.values(), ({ id, nick, x, y }) => ({
      id,
      nick,
      // Sub-pixel precision is invisible and inflates every frame of every snapshot.
      x: Math.round(x * 100) / 100,
      y: Math.round(y * 100) / 100,
    }));
  }

  #send(ws: WebSocket, message: ServerMessage): void {
    try {
      ws.send(encodeServerMessage(message));
    } catch {
      this.#drop(ws);
    }
  }

  #broadcast(message: ServerMessage): void {
    const payload = encodeServerMessage(message);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(payload);
      } catch {
        this.#drop(ws);
      }
    }
  }
}
