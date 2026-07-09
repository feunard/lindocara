import { describe, expect, it } from "vitest";
import { resolveTerrain } from "../src/shared/game.js";
import { prunePending, reconcile } from "../src/shared/prediction.js";
import type { Command } from "../src/shared/protocol.js";
import { type Input, NO_INPUT, step, TICK_DT, type Vec2 } from "../src/shared/simulation.js";

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

  it("respects the world walls while replaying", () => {
    const atWall: Vec2 = { x: 0, y: 0 };
    const commands = [command(1, { left: true }), command(2, { up: true })];

    expect(reconcile(atWall, commands)).toEqual({ x: 0, y: 0 });
  });

  it("does not mutate the authoritative position it is handed", () => {
    const authoritative = { x: 100, y: 100 };
    reconcile(authoritative, [command(1, { right: true })]);
    expect(authoritative).toEqual({ x: 100, y: 100 });
  });
});
