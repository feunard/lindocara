import { describe, expect, it } from "vitest";
import { speedForLife } from "../src/shared/death.js";
import { resolveTerrain } from "../src/shared/game.js";
import { predictStep, prunePending, reconcile } from "../src/shared/prediction.js";
import type { Command } from "../src/shared/protocol.js";
import { type Input, NO_INPUT, step, TICK_DT, type Vec2 } from "../src/shared/simulation.js";
import { TEST_ZONE_TERRAIN } from "../src/shared/zones.js";

const input = (partial: Partial<Input>): Input => ({ ...NO_INPUT, ...partial });
const command = (seq: number, partial: Partial<Input>): Command => ({ seq, input: input(partial) });

describe("prunePending", () => {
  const pending = [command(1, {}), command(2, {}), command(3, {}), command(4, {})];

  it("drops everything the server has applied", () => {
    expect(prunePending(pending, 2).map((c) => c.seq)).toEqual([3, 4]);
  });

  it("keeps everything when nothing is acknowledged", () => {
    expect(prunePending(pending, 0)).toHaveLength(4);
  });

  it("empties when the server has caught up", () => {
    expect(prunePending(pending, 4)).toEqual([]);
  });

  it("does not mutate its input", () => {
    prunePending(pending, 3);
    expect(pending).toHaveLength(4);
  });
});

describe("reconcile", () => {
  const origin: Vec2 = { x: 400, y: 400 };

  it("returns the authoritative position when nothing is in flight", () => {
    expect(reconcile(origin, [])).toEqual(origin);
  });

  it("replays a single pending command", () => {
    const pending = [command(1, { right: true })];
    expect(reconcile(origin, pending)).toEqual(
      resolveTerrain(origin, step(origin, input({ right: true }), TICK_DT)),
    );
  });

  /**
   * The property that makes prediction correct: replaying the commands the server has not
   * seen, on top of the position it reported, lands exactly where the server will land once
   * it has processed them. If this ever fails, the client and server disagree about motion.
   */
  it("lands exactly where the server will, once it applies the same commands", () => {
    const commands = [
      command(1, { right: true }),
      command(2, { right: true }),
      command(3, { right: true, down: true }),
      command(4, { down: true }),
      command(5, {}),
    ];

    // The server, applying one command per tick from the same starting point.
    let server: Vec2 = origin;
    for (const c of commands) server = resolveTerrain(server, step(server, c.input, TICK_DT));

    // The client, reconciling from a server position that predates all of them.
    expect(reconcile(origin, commands)).toEqual(server);
  });

  /**
   * The same property, for a ghost. A ghost moves faster than the living, so replay has to
   * know which you are — replaying a ghost's commands at living speed would leave the client
   * drawing its own spirit permanently short of where the server has actually put it, and
   * nothing in the protocol would ever complain.
   */
  it("lands where the server will for a ghost too, at ghost speed", () => {
    const commands = [
      command(1, { right: true }),
      command(2, { right: true, down: true }),
      command(3, { down: true }),
    ];
    const ghostSpeed = speedForLife("ghost");

    let server: Vec2 = origin;
    for (const c of commands) {
      server = resolveTerrain(server, step(server, c.input, TICK_DT, ghostSpeed));
    }

    expect(reconcile(origin, commands, "ghost")).toEqual(server);
    // And the living replay must NOT land there — otherwise this test proves nothing.
    expect(reconcile(origin, commands, "alive")).not.toEqual(server);
  });

  it("respects the world walls while replaying", () => {
    const atWall: Vec2 = { x: 0, y: 0 };
    const commands = [command(1, { left: true }), command(2, { up: true })];

    expect(reconcile(atWall, commands)).toEqual({ x: 0, y: 0 });
  });

  it("chains multiple replays the same way the server applies one command per tick", () => {
    let position: Vec2 = { x: 500, y: 400 };
    const batches = [
      [command(1, { right: true })],
      [command(2, { right: true }), command(3, { down: true })],
    ];
    for (const batch of batches) {
      position = reconcile(position, batch);
    }
    let server: Vec2 = { x: 500, y: 400 };
    for (const batch of batches) {
      for (const c of batch) server = resolveTerrain(server, step(server, c.input, TICK_DT));
    }
    expect(position).toEqual(server);
  });

  it("does not mutate the authoritative position it is handed", () => {
    const authoritative = { x: 100, y: 100 };
    reconcile(authoritative, [command(1, { right: true })]);
    expect(authoritative).toEqual({ x: 100, y: 100 });
  });
});

describe("prediction against a non-default zone's geometry", () => {
  // (160, 160) is mmo-test-zone's arrival spawn (see zones.ts's TEST_ZONE_SPAWNS). It is open
  // grass there in MMO_TEST_ZONE_TILES. The identically numbered cell in Verdant Reach's own
  // tilemap — VERDANT_REACH_TERRAIN, `resolveTerrain`'s and `reconcile`'s default geometry — is
  // `forest`, which is solid. A caller that predicts in mmo-test-zone without passing that zone's
  // own geometry collides against Verdant Reach's tilemap instead of the room the player is
  // actually standing in.
  const arrivalSpawn: Vec2 = { x: 160, y: 160 };

  it("predictStep moves in mmo-test-zone when given that zone's geometry explicitly", () => {
    const moved = predictStep(
      arrivalSpawn,
      command(1, { right: true }),
      undefined,
      TEST_ZONE_TERRAIN,
    );
    expect(moved).toEqual({ x: 173, y: 160 });
  });

  it("reconcile replays pending commands against the zone geometry it is given", () => {
    const pending = [command(1, { right: true })];
    const server = resolveTerrain(
      arrivalSpawn,
      step(arrivalSpawn, input({ right: true }), TICK_DT),
      TEST_ZONE_TERRAIN,
    );
    expect(server).toEqual({ x: 173, y: 160 });
    expect(reconcile(arrivalSpawn, pending, "alive", TEST_ZONE_TERRAIN)).toEqual(server);
  });

  it("without an explicit geometry, prediction silently defaults to Verdant Reach and refuses to move here", () => {
    // This is the bug pinned: dropping the geometry argument (the client's mistake before the
    // fix) lands on VERDANT_REACH_TERRAIN, whose (160, 160) is forest — solid — so the square
    // never leaves the spawn point even though the real zone's tile there is open ground.
    const pending = [command(1, { right: true })];
    expect(reconcile(arrivalSpawn, pending)).toEqual(arrivalSpawn);
  });
});
