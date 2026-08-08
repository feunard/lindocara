import { MAX_HEIGHTFIELD_SIZE } from "@lindocara/engine/hd2d/map-data.js";
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
  vy: -2.5,
  facing: { x: 1, z: 0 },
  airborne: false,
  swimming: false,
  gliding: false,
  displacement: 4,
} as const;

describe("the move message", () => {
  it("accepts a well-formed position", () => {
    expect(parseClientMessage(JSON.stringify(wellFormed))).toEqual({
      t: "move",
      x: 3.5,
      y: 1,
      z: -2.25,
      vy: -2.5,
      facing: { x: 1, z: 0 },
      airborne: false,
      swimming: false,
      gliding: false,
      displacement: 4,
    });
  });

  it("drops a frame whose position is not finite", () => {
    // `1e999` is how an infinity actually crosses a JSON wire — `JSON.stringify(Infinity)` writes
    // `null`, so the raw text is the only honest way to state this case.
    const raw = '{"t":"move","x":1e999,"y":0,"z":0,"facing":{"x":1,"z":0},';
    expect(
      parseClientMessage(
        `${raw}"vy":0,"airborne":false,"swimming":false,"gliding":false,"displacement":0}`,
      ),
    ).toBeNull();
    expect(parseClientMessage(JSON.stringify({ ...wellFormed, z: Number.NaN }))).toBeNull();
  });

  it("drops a frame missing or corrupting its vertical velocity", () => {
    const { vy: _omitted, ...withoutVelocity } = wellFormed;
    expect(parseClientMessage(JSON.stringify(withoutVelocity))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ ...wellFormed, vy: Number.NaN }))).toBeNull();
    expect(
      parseClientMessage(JSON.stringify({ ...wellFormed, vy: MOVE_COORDINATE_LIMIT + 1 })),
    ).toBeNull();
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
   * The bound above is only honest because a heightfield's side is itself bounded. Pinned here,
   * beside the constant that derives from it, so raising one without the other fails loudly rather
   * than silently dropping every frame from a legitimately larger map.
   */
  it("derives its bound from the largest grid a heightfield may declare", () => {
    expect(MOVE_COORDINATE_LIMIT).toBe(MAX_HEIGHTFIELD_SIZE / 2);
  });

  /**
   * `facing` is a unit heading on the GROUND plane. Left unpinned, a later refactor swapping
   * `isDirection` for the laxer `isPosition` would accept both cases below and nothing would fail:
   * a zero-length heading (a client that has not moved yet) and an `{x, y}` pair (the half-converted
   * sender the third axis exists to catch) would both be read as a direction.
   */
  it("drops a frame whose facing is not a ground unit heading", () => {
    expect(
      parseClientMessage(JSON.stringify({ ...wellFormed, facing: { x: 0, z: 0 } })),
    ).toBeNull();
    expect(
      parseClientMessage(JSON.stringify({ ...wellFormed, facing: { x: 0, y: 1 } })),
    ).toBeNull();
    expect(
      parseClientMessage(JSON.stringify({ ...wellFormed, facing: { x: 3, z: 4 } })),
    ).toBeNull();
  });

  it("drops a frame carrying a key the message does not define", () => {
    // `seq` in particular: the retired sequenced command must not survive as a stowaway on a `move`.
    expect(parseClientMessage(JSON.stringify({ ...wellFormed, seq: 7 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ ...wellFormed, hp: 999 }))).toBeNull();
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

  /**
   * The echoed displacement stamp (`SelfState.displacement`) is what tells a report computed before
   * a server-authored displacement from one computed after it. It is under the same absent-key rule
   * as the flags above, and for a sharper reason: read as zero, a client that never sends it would
   * be permanently below the room's counter and permanently unable to move — or, on a hero the room
   * has never displaced, permanently exempt from the check.
   *
   * It grants no authority either. Only the room raises the counter; a client can echo a value it
   * was never given, and the room's equality check refuses it (`world-room-displacement.test.ts`).
   * The parser's job is only to insist the field is a real count.
   */
  it("drops a frame missing the displacement stamp rather than defaulting it", () => {
    const { displacement: _omitted, ...withoutStamp } = wellFormed;
    expect(parseClientMessage(JSON.stringify(withoutStamp))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ ...wellFormed, displacement: null }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ ...wellFormed, displacement: "4" }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ ...wellFormed, displacement: -1 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ ...wellFormed, displacement: 1.5 }))).toBeNull();
    // Zero is a real count — the stamp of a hero the room has not moved — and must survive.
    expect(parseClientMessage(JSON.stringify({ ...wellFormed, displacement: 0 }))).not.toBeNull();
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
