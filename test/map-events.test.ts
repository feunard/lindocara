/**
 * `parseMapEvents` off the wire, and `validateEventName` on its own: totality (every malformed
 * field lands on null, never a throw), bounds, duplicate cells and the two mutation-proof
 * branches called out in the plan (duplicate-cell rejection, bounds rejection).
 */
import { describe, expect, it } from "vitest";
import {
  EVENT_NAME_MAX,
  MAX_EVENTS_PER_MAP,
  MAX_PAGES_PER_EVENT,
  type MapEvent,
  type MapEventPage,
  parseMapEvents,
  validateEventName,
} from "../src/shared/map-events.js";

const COLS = 10;
const ROWS = 10;

const GOOD_ASSET_ID = "building.buildings-black-buildings.archery";
const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";

function page(overrides: Partial<MapEventPage> = {}): MapEventPage {
  return {
    condSwitchId: null,
    condVariableId: null,
    condVariableMin: null,
    condSelfSwitch: null,
    graphicAssetId: null,
    moveType: "fixed",
    moveSpeed: 3,
    moveFreq: 2,
    optMoveAnim: false,
    optStopAnim: false,
    optDirFix: false,
    optThrough: false,
    optOnTop: false,
    trigger: "action",
    ...overrides,
  };
}

function fullPage(): MapEventPage {
  return page({
    condSwitchId: "0001",
    condVariableId: "0002",
    condVariableMin: 5,
    condSelfSwitch: "A",
    graphicAssetId: GOOD_ASSET_ID,
    moveType: "random",
    moveSpeed: 5,
    moveFreq: 4,
    optMoveAnim: true,
    optStopAnim: true,
    optDirFix: true,
    optThrough: true,
    optOnTop: true,
    trigger: "parallel",
  });
}

function event(overrides: Partial<MapEvent> = {}): MapEvent {
  return {
    id: ID_A,
    col: 1,
    row: 1,
    name: "Guard",
    ordinal: 0,
    pages: [page()],
    ...overrides,
  };
}

describe("validateEventName", () => {
  it("trims and accepts a name within bounds", () => {
    expect(validateEventName("  Guard  ")).toBe("Guard");
  });

  it("accepts an empty name — the ordinal chip is the real label", () => {
    expect(validateEventName("")).toBe("");
    expect(validateEventName("   ")).toBe("");
  });

  it("rejects a non-string or an overlong name", () => {
    expect(validateEventName(42)).toBeNull();
    expect(validateEventName(null)).toBeNull();
    expect(validateEventName("x".repeat(EVENT_NAME_MAX + 1))).toBeNull();
  });

  it("accepts exactly the maximum length", () => {
    expect(validateEventName("x".repeat(EVENT_NAME_MAX))).toBe("x".repeat(EVENT_NAME_MAX));
  });
});

describe("parseMapEvents: good payloads round-trip unchanged", () => {
  it("round-trips a minimal event", () => {
    const events = [event()];
    expect(parseMapEvents(events, COLS, ROWS)).toEqual(events);
  });

  it("round-trips an event with every field populated, across two pages", () => {
    const events = [event({ id: ID_B, pages: [page(), fullPage()] })];
    expect(parseMapEvents(events, COLS, ROWS)).toEqual(events);
  });

  it("defaults nothing: an absent/empty array round-trips as empty", () => {
    expect(parseMapEvents([], COLS, ROWS)).toEqual([]);
  });

  it("accepts up to MAX_EVENTS_PER_MAP events", () => {
    const events = Array.from({ length: MAX_EVENTS_PER_MAP }, (_, i) =>
      event({
        id: `${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`,
        col: i % COLS,
        row: Math.floor(i / COLS),
        ordinal: i,
      }),
    );
    expect(parseMapEvents(events, COLS, ROWS)).toEqual(events);
  });

  it("accepts up to MAX_PAGES_PER_EVENT pages", () => {
    const events = [event({ pages: Array.from({ length: MAX_PAGES_PER_EVENT }, () => page()) })];
    expect(parseMapEvents(events, COLS, ROWS)?.[0]?.pages).toHaveLength(MAX_PAGES_PER_EVENT);
  });
});

describe("parseMapEvents: totality — every malformed field lands on null, never a throw", () => {
  const cases: Record<string, unknown> = {
    "non-array root": { not: "an array" },
    "non-object entry": [42],
    "null entry": [null],
    "malformed uuid": [event({ id: "not-a-uuid" })],
    "uuid with an invalid variant nibble": [event({ id: "11111111-1111-4111-7111-111111111111" })],
    "duplicate id across two events": [
      event({ id: ID_A, col: 1, row: 1 }),
      event({ id: ID_A, col: 2, row: 2 }),
    ],
    "out-of-bounds col": [event({ col: COLS })],
    "out-of-bounds row": [event({ row: ROWS })],
    "negative col": [event({ col: -1 })],
    "non-integer col": [event({ col: 1.5 })],
    "duplicate cell across two events": [
      event({ id: ID_A, col: 3, row: 3 }),
      event({ id: ID_B, col: 3, row: 3 }),
    ],
    "over-long name": [event({ name: "x".repeat(EVENT_NAME_MAX + 1) })],
    "non-string name": [event({ name: 42 as unknown as string })],
    "non-integer ordinal": [event({ ordinal: 1.5 })],
    "negative ordinal": [event({ ordinal: -1 })],
    "zero pages": [event({ pages: [] })],
    "nine pages": [event({ pages: Array.from({ length: MAX_PAGES_PER_EVENT + 1 }, () => page()) })],
    "non-array pages": [event({ pages: "nope" as unknown as MapEventPage[] })],
    "malformed page entry": [event({ pages: [null as unknown as MapEventPage] })],
    "bad trigger": [event({ pages: [page({ trigger: "on-touch" as never })] })],
    "bad move type": [event({ pages: [page({ moveType: "teleport" as never })] })],
    "move speed below range": [event({ pages: [page({ moveSpeed: -1 })] })],
    "move speed above range": [event({ pages: [page({ moveSpeed: 6 })] })],
    "move freq above range": [event({ pages: [page({ moveFreq: 5 })] })],
    "non-integer move speed": [event({ pages: [page({ moveSpeed: 2.5 })] })],
    "unknown asset id": [event({ pages: [page({ graphicAssetId: "nope.nope" as never })] })],
    "bad self-switch": [event({ pages: [page({ condSelfSwitch: "E" as never })] })],
    "malformed switch id": [event({ pages: [page({ condSwitchId: "12" })] })],
    "malformed variable id": [event({ pages: [page({ condVariableId: "abcd" })] })],
    "variable id without threshold": [
      event({ pages: [page({ condVariableId: "0001", condVariableMin: null })] }),
    ],
    "variable threshold without id": [
      event({ pages: [page({ condVariableId: null, condVariableMin: 3 })] }),
    ],
    "negative variable threshold": [
      event({ pages: [page({ condVariableId: "0001", condVariableMin: -1 })] }),
    ],
    "non-boolean option": [event({ pages: [page({ optMoveAnim: "yes" as unknown as boolean })] })],
    "too many events": Array.from({ length: MAX_EVENTS_PER_MAP + 1 }, (_, i) =>
      event({
        id: `${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`,
        col: i % COLS,
        row: Math.floor(i / COLS),
        ordinal: i,
      }),
    ),
  };

  for (const [name, value] of Object.entries(cases)) {
    it(`rejects: ${name}`, () => {
      expect(parseMapEvents(value, COLS, ROWS)).toBeNull();
    });
  }
});

describe("mutation proofs", () => {
  it("the duplicate-cell case actually depends on the duplicate-cell check", () => {
    // Sanity: two events on different cells with otherwise-identical shape parse fine, so the
    // rejection above is specifically about the shared cell, not some other field.
    const distinct = [event({ id: ID_A, col: 3, row: 3 }), event({ id: ID_B, col: 4, row: 4 })];
    expect(parseMapEvents(distinct, COLS, ROWS)).toEqual(distinct);
  });

  it("the bounds case actually depends on the bounds check", () => {
    // Sanity: the same event just inside the map parses fine, so the rejection above is
    // specifically about being out of bounds, not some other field.
    const inBounds = [event({ col: COLS - 1, row: ROWS - 1 })];
    expect(parseMapEvents(inBounds, COLS, ROWS)).toEqual(inBounds);
  });
});
