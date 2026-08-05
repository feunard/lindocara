import { MOVE_COORDINATE_LIMIT, parseClientMessage } from "@lindocara/engine/protocol.js";
import { describe, expect, it } from "vitest";

/**
 * The movement half of the wire is inverted: the client reports where its hero IS, in tile units
 * with the grid centre as origin, instead of sending a sequenced input the server re-simulates.
 *
 * Authority moving does NOT relax the parser. Everything below is asserted through the real
 * `parseClientMessage` — a test that reached for `JSON.parse` would prove only that the fixture is
 * valid JSON, which is exactly how an unjoinable room shipped once already.
 */
const wellFormed = {
  t: "move",
  // Ground axes are `x`/`z`; `y` is ELEVATION. A `{x, y}` ground literal typechecks and puts the
  // world on its side, so every case here carries all three.
  x: 3.5,
  y: 1,
  z: -2.25,
  facing: { x: 1, z: 0 },
  airborne: false,
  swimming: false,
  gliding: false,
} as const;

describe("the move message", () => {
  it("accepts a well-formed position", () => {
    expect(parseClientMessage(JSON.stringify(wellFormed))).toEqual({
      t: "move",
      x: 3.5,
      y: 1,
      z: -2.25,
      facing: { x: 1, z: 0 },
      airborne: false,
      swimming: false,
      gliding: false,
    });
  });

  it("drops a frame whose position is not finite", () => {
    // `1e999` is how an infinity actually crosses a JSON wire — `JSON.stringify(Infinity)` writes
    // `null`, so the raw text is the only honest way to state this case.
    const raw = '{"t":"move","x":1e999,"y":0,"z":0,"facing":{"x":1,"z":0},';
    expect(
      parseClientMessage(`${raw}"airborne":false,"swimming":false,"gliding":false}`),
    ).toBeNull();
    expect(parseClientMessage(JSON.stringify({ ...wellFormed, z: Number.NaN }))).toBeNull();
  });

  it("drops a frame whose position is off the map", () => {
    for (const axis of ["x", "y", "z"] as const) {
      expect(
        parseClientMessage(JSON.stringify({ ...wellFormed, [axis]: MOVE_COORDINATE_LIMIT + 1 })),
      ).toBeNull();
      expect(
        parseClientMessage(JSON.stringify({ ...wellFormed, [axis]: -MOVE_COORDINATE_LIMIT - 1 })),
      ).toBeNull();
    }
    expect(
      parseClientMessage(JSON.stringify({ ...wellFormed, x: MOVE_COORDINATE_LIMIT })),
    ).not.toBeNull();
  });

  /**
   * The rule this repo already follows everywhere else on the wire: an absent key is MALFORMED, not
   * a default. `WorldInfo.heightfield` refuses an absent/`null` field, and the map-events design
   * makes a client emit an explicit `null` rather than omit a condition so "no condition" stays
   * distinguishable from "malformed". A defaulted `swimming: false` would put a drowning hero on
   * dry land with nothing in the logs.
   */
  it("drops a frame missing a state flag rather than defaulting it", () => {
    for (const flag of ["airborne", "swimming", "gliding"] as const) {
      const { [flag]: _omitted, ...withoutFlag } = wellFormed;
      expect(parseClientMessage(JSON.stringify(withoutFlag))).toBeNull();
      expect(parseClientMessage(JSON.stringify({ ...wellFormed, [flag]: "yes" }))).toBeNull();
    }
  });

  it("no longer accepts the retired sequenced input intent", () => {
    expect(
      parseClientMessage(
        JSON.stringify({
          t: "input",
          seq: 7,
          input: { up: true, down: false, left: false, right: true },
        }),
      ),
    ).toBeNull();
  });
});
