import { speedForLife } from "@lindocara/engine/death.js";
import { CLASS_STATS } from "@lindocara/engine/game.js";
import { groundOf, planarOf, type WorldPosition } from "@lindocara/engine/ground.js";
import type { ColliderRect } from "@lindocara/engine/hd2d/collider-index.js";
import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import { predictStep, prunePending, reconcile } from "@lindocara/engine/prediction.js";
import type { Command } from "@lindocara/engine/protocol.js";
import { type Input, NO_INPUT, PLAYER_SPEED, step, TICK_DT } from "@lindocara/engine/simulation.js";
import {
  groundUnder,
  resolveGroundMovement,
  type ZoneTerrain,
  zoneTerrainFromHeightfield,
} from "@lindocara/engine/terrain-access.js";
import { describe, expect, it } from "vitest";

const input = (partial: Partial<Input>): Input => ({ ...NO_INPUT, ...partial });
const command = (seq: number, partial: Partial<Input>): Command => ({ seq, input: input(partial) });

const SIZE = 16;
const LEVEL_HEIGHT = 0.5;
const HALF = SIZE / 2;

/**
 * A heightfield, in TILE units with the grid centre as the origin — the only terrain there is now.
 *
 * `levelAt` decides each cell's tier: `null` is water (and off-grid ground a body may not stand
 * on), a number is a tier `levelHeight` tall. `toCell = floor(w + size/2)`, so cell row `j` covers
 * `z ∈ [j - size/2, j - size/2 + 1)`.
 */
function terrain(
  options: {
    levelAt?: (col: number, row: number) => number | null;
    colliders?: readonly ColliderRect[];
    size?: number;
  } = {},
): ZoneTerrain {
  const size = options.size ?? SIZE;
  const levelAt = options.levelAt ?? (() => 0);
  const levels: (number | null)[] = [];
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) levels.push(levelAt(col, row));
  }
  const map: MapData = {
    version: 1,
    size,
    levelHeight: LEVEL_HEIGHT,
    waterLevel: -0.25,
    levels,
    materials: new Array(size * size).fill("herbe"),
    colliders: options.colliders ?? [],
    spawns: [],
    elements: [],
    events: [],
  };
  return zoneTerrainFromHeightfield(map);
}

/** Flat, entirely walkable level-0 ground. Nothing here can stop a square except the grid's edge. */
const FLAT = terrain();

/**
 * The server's own movement, for exactly one command — copied from `advancePlayers`
 * (`packages/server/src/world/movement-system.ts`) rather than from `predictStep`, because a
 * reference implementation that called the function under test would prove nothing.
 *
 * It is the same four calls in the same order: `step` with `bounds: null` (a tile grid is centred
 * on the origin, so the pixel world's rectangle clamp would fence off its whole western and
 * northern halves), `groundUnder` read from where the body IS, `resolveGroundMovement` for the
 * collision, then `groundUnder` again under where it landed. If this helper and `predictStep` ever
 * stop agreeing, the client and the server disagree about motion — which is the entire property
 * this suite exists to pin.
 */
function serverStep(position: WorldPosition, one: Command, built: ZoneTerrain, speed: number) {
  const desired = groundOf(step(planarOf(position), one.input, TICK_DT, speed, null));
  const groundY = groundUnder(built, position.x, position.z, position.y);
  const moved = resolveGroundMovement(built, position, desired, groundY);
  return { x: moved.x, y: groundUnder(built, moved.x, moved.z, position.y), z: moved.z };
}

/** The server applying one command per tick, from `origin`, against `built`. */
function serverRun(
  origin: WorldPosition,
  commands: readonly Command[],
  built: ZoneTerrain,
  speed: number = PLAYER_SPEED,
): WorldPosition {
  let position = origin;
  for (const one of commands) position = serverStep(position, one, built, speed);
  return position;
}

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
  const origin: WorldPosition = { x: 0, y: 0, z: 0 };

  it("returns the authoritative position when nothing is in flight", () => {
    expect(reconcile(origin, [], FLAT)).toEqual(origin);
  });

  it("replays a single pending command", () => {
    const pending = [command(1, { right: true })];
    expect(reconcile(origin, pending, FLAT)).toEqual(serverRun(origin, pending, FLAT));
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

    const server = serverRun(origin, commands, FLAT);
    // …and the square actually travelled, or the equality below holds on a hero that never moved.
    expect(server).not.toEqual(origin);

    // The client, reconciling from a server position that predates all of them.
    expect(reconcile(origin, commands, FLAT)).toEqual(server);
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
    const server = serverRun(origin, commands, FLAT, ghostSpeed);

    expect(reconcile(origin, commands, FLAT, "ghost")).toEqual(server);
    // And the living replay must NOT land there — otherwise this test proves nothing.
    expect(reconcile(origin, commands, FLAT, "alive")).not.toEqual(server);
  });

  it.each([
    "warrior",
    "ranger",
    "priest",
    "rogue",
  ] as const)("replays %s movement at the same class speed as the server", (playerClass) => {
    const commands = [command(1, { right: true }), command(2, { right: true })];
    const server = serverRun(origin, commands, FLAT, CLASS_STATS[playerClass].movementSpeed);
    expect(reconcile(origin, commands, FLAT, "alive", playerClass)).toEqual(server);
  });

  /**
   * The grid's edge replaces the pixel world's rectangle walls: a heightfield is `size` cells
   * square and centred on the origin, so its north-west corner is at `(-8, -8)` and `heightAt` is
   * `null` beyond it. `canStand` refuses that ground, so a square pressed into the corner stays
   * put — and it must stay put on BOTH sides, at exactly the same coordinate.
   */
  it("respects the grid's edge while replaying", () => {
    const atCorner: WorldPosition = { x: -HALF, y: 0, z: -HALF };
    const commands = [command(1, { left: true }), command(2, { up: true })];

    expect(reconcile(atCorner, commands, FLAT)).toEqual(serverRun(atCorner, commands, FLAT));
    expect(reconcile(atCorner, commands, FLAT)).toEqual(atCorner);
  });

  it("chains multiple replays the same way the server applies one command per tick", () => {
    const start: WorldPosition = { x: 1, y: 0, z: 0 };
    const batches = [
      [command(1, { right: true })],
      [command(2, { right: true }), command(3, { down: true })],
    ];
    let position: WorldPosition = start;
    for (const batch of batches) position = reconcile(position, batch, FLAT);

    let server: WorldPosition = start;
    for (const batch of batches) server = serverRun(server, batch, FLAT);
    expect(position).toEqual(server);
  });

  it("does not mutate the authoritative position it is handed", () => {
    const authoritative: WorldPosition = { x: 1, y: 0, z: 1 };
    reconcile(authoritative, [command(1, { right: true })], FLAT);
    expect(authoritative).toEqual({ x: 1, y: 0, z: 1 });
  });
});

describe("prediction against the terrain it is handed", () => {
  // `terrain` is a required parameter of both `predictStep` and `reconcile` precisely so a caller
  // cannot predict against a room it is not standing in (see prediction.ts). These two grids differ
  // in exactly one cell — the one immediately east of the origin — so a prediction that quietly
  // used the wrong one lands somewhere the other refuses. In the pixel world this pinned "don't
  // default to Verdant Reach"; a heightfield has no default at all, and what is left to prove is
  // that the terrain handed in is the terrain collided against.
  const open = terrain();
  const walled = terrain({ levelAt: (col) => (col === HALF ? 2 : 0) });
  const oneTick = PLAYER_SPEED * TICK_DT;
  // Just west of the raised cell — which covers `x ∈ [0, 1)` — and far enough out that the body's
  // 0.25 disc is clear of it before the step, so the refusal below is the cliff and not the escape
  // hatch a body already overlapping geometry gets.
  const origin: WorldPosition = { x: -0.3, y: 0, z: 0.5 };

  it("predictStep advances on open ground and is refused by the same cell raised", () => {
    expect(predictStep(origin, command(1, { right: true }), open)).toEqual({
      x: -0.3 + oneTick,
      y: 0,
      z: 0.5,
    });
    // The cliff is two tiers up and `MAX_STEP` is 0: the eastward half is refused outright.
    expect(predictStep(origin, command(1, { right: true }), walled)).toEqual(origin);
  });

  it("reconcile replays pending commands against the terrain it is given", () => {
    const pending = [command(1, { right: true })];
    expect(reconcile(origin, pending, open, "alive")).toEqual(serverRun(origin, pending, open));
    expect(reconcile(origin, pending, walled, "alive")).toEqual(serverRun(origin, pending, walled));
    expect(reconcile(origin, pending, open, "alive")).not.toEqual(
      reconcile(origin, pending, walled, "alive"),
    );
  });
});

describe("prediction against a sub-cell collider", () => {
  // Flat level-0 ground everywhere, one half-tile prop east of the origin: nothing in the relief
  // blocks anything, so if the client and server land in different places it can ONLY be about the
  // collider. This is the sub-cell sibling of "lands exactly where the server will": props are
  // collision, and a collider one side applies and the other does not is a silent desync that draws
  // the square short of the server forever, with nothing in the protocol to complain.
  const rect: ColliderRect = { x: 3, z: -0.5, w: 0.5, h: 1 };
  const propped = terrain({ colliders: [rect] });
  const open = terrain();
  // Start on the prop's own z-band so a rightward run walks straight into its western face.
  const start: WorldPosition = { x: 0, y: 0, z: 0 };
  // Enough commands to actually reach the rect and a few to spare, derived rather than written out
  // so a change to `PLAYER_SPEED` cannot silently stop the run short of the prop — the test would
  // still pass, and prove nothing.
  const commandCount = Math.ceil((rect.x - start.x) / (PLAYER_SPEED * TICK_DT)) + 4;
  const commands = Array.from({ length: commandCount }, (_, index) =>
    command(index + 1, { right: true }),
  );

  it("replays commands identically against a sub-cell collider", () => {
    const server = serverRun(start, commands, propped);
    const client = reconcile(start, commands, propped, "alive");

    expect(client.x).toBeCloseTo(server.x, 10);
    expect(client.z).toBeCloseTo(server.z, 10);
    expect(client.y).toBe(server.y);

    // …and the collider actually stopped the square, or the equality above proves nothing: it
    // would hold just as well on an empty world where both sides walk clean through. The server
    // must land short of the collider's western face, and an identical run on the SAME relief with
    // no prop must reach further east — that gap IS the collider doing its job.
    const unobstructed = serverRun(start, commands, open);
    expect(server.x).toBeLessThan(rect.x);
    expect(unobstructed.x).toBeGreaterThan(server.x);
    expect(unobstructed.x).toBeGreaterThan(rect.x);
  });
});

describe("predictStep west and north of the origin", () => {
  // `step()`'s own `bounds` parameter defaults to `VERDANT_REACH_BOUNDS` (packages/engine/src/
  // simulation.ts), whose clamp pins both axes to `>= 0`. A tile grid is CENTRED on the origin, so
  // half of every map is negative — a `predictStep` that forgot to pass `bounds: null` would jam
  // any square at `x = 0` or `z = 0` and refuse to let it walk into the western or northern half of
  // the world at all. That is the same bug the pixel-world version of this test pinned with a zone
  // wider than Verdant Reach; centring the grid just made it far cheaper to expose.
  const oneTick = PLAYER_SPEED * TICK_DT;

  it("keeps walking into the negative half of the grid", () => {
    const nearOrigin: WorldPosition = { x: 0.5 * oneTick, y: 0, z: 0.5 * oneTick };
    const moved = predictStep(nearOrigin, command(1, { left: true, up: true }), FLAT);

    expect(moved.x).toBeLessThan(0);
    expect(moved.z).toBeLessThan(0);
    expect(moved).toEqual(serverRun(nearOrigin, [command(1, { left: true, up: true })], FLAT));
  });
});
