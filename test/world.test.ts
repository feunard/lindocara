/**
 * End-to-end through the real Durable Object: a real WebSocket, the real tick loop, the
 * real simulation. Nothing here is mocked, so a passing run means a browser would work.
 */

import { env, runInDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "../src/server/session.js";
import { type Attachment, positionFromAttachment } from "../src/server/world.js";
import {
  type PlayerSnapshot,
  parseServerMessage,
  type ServerMessage,
} from "../src/shared/protocol.js";
import { PLAYER_SIZE, WORLD_HEIGHT, WORLD_WIDTH } from "../src/shared/simulation.js";

const ORIGIN = "https://lindocara.test";

async function sessionCookie(nickname: string): Promise<string> {
  const response = await SELF.fetch(`${ORIGIN}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname }),
  });
  expect(response.status).toBe(200);

  const token = response.headers.get("Set-Cookie")?.split(";")[0]?.split("=")[1];
  if (!token) throw new Error("no session cookie issued");
  return `${SESSION_COOKIE}=${token}`;
}

/** A connected player, recording everything the world tells it. */
class Client {
  readonly received: ServerMessage[] = [];
  #socket: WebSocket;

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.accept();
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      const message = parseServerMessage(event.data);
      if (message) this.received.push(message);
    });
  }

  static async join(nickname: string): Promise<Client> {
    const response = await SELF.fetch(`${ORIGIN}/api/ws`, {
      headers: { Upgrade: "websocket", Cookie: await sessionCookie(nickname) },
    });

    expect(response.status).toBe(101);
    const socket = response.webSocket;
    if (!socket) throw new Error("expected a websocket in the 101 response");
    return new Client(socket);
  }

  press(direction: "up" | "down" | "left" | "right"): void {
    this.#socket.send(
      JSON.stringify({
        t: "input",
        input: { up: false, down: false, left: false, right: false, [direction]: true },
      }),
    );
  }

  release(): void {
    this.#socket.send(
      JSON.stringify({
        t: "input",
        input: { up: false, down: false, left: false, right: false },
      }),
    );
  }

  sendRaw(payload: string): void {
    this.#socket.send(payload);
  }

  close(): void {
    this.#socket.close(1000, "done");
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

  self(): PlayerSnapshot | undefined {
    const id = this.welcome?.selfId;
    return id ? this.latestSnapshot?.players.find((p) => p.id === id) : undefined;
  }
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
    expect(welcome.world).toEqual({ width: 1600, height: 900, playerSize: 32 });

    client.close();
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
    client.press("right");

    const moved = await until("the square to move right", () => {
      const now = client.self();
      return now && now.x > start.x + 20 ? now : undefined;
    });

    expect(moved.x).toBeGreaterThan(start.x);
    expect(moved.y).toBeCloseTo(start.y, 5);

    client.close();
  });

  // Players spawn at a random x, so walking to the wall takes up to WORLD_WIDTH /
  // PLAYER_SPEED ≈ 6s of real ticking. Vitest's 5s default would flake on an unlucky spawn.
  it("never lets a square leave the world", { timeout: 20_000 }, async () => {
    const client = await Client.join("dave");
    await until("welcome", () => client.welcome);

    client.press("left");
    const pinned = await until(
      "the square to reach the left wall",
      () => {
        const now = client.self();
        return now && now.x === 0 ? now : undefined;
      },
      15_000,
    );

    expect(pinned.x).toBe(0);

    // Keep pushing: the wall must hold, not merely be touched once.
    await scheduler.wait(200);
    expect(client.self()?.x).toBe(0);

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
});

/** The read half of surviving a rebuild — see the persistence test above. */
describe("positionFromAttachment", () => {
  const inWorld = (position: { x: number; y: number }) => {
    expect(position.x).toBeGreaterThanOrEqual(0);
    expect(position.y).toBeGreaterThanOrEqual(0);
    expect(position.x).toBeLessThanOrEqual(WORLD_WIDTH - PLAYER_SIZE);
    expect(position.y).toBeLessThanOrEqual(WORLD_HEIGHT - PLAYER_SIZE);
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
});
