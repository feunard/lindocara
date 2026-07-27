/**
 * The pure planner behind the exits -> teleport-events migration. Mirrors
 * `map-marker-event-migrate.test.ts`: the conversion and graph-rewrite rules are pinned here without
 * a database; the live-runtime proof (a migrated exit still moves a hero) lives in the runtime test.
 */

import { functionalEvent, type MapEvent } from "@lindocara/engine/map-events.js";
import {
  type ExitMigrationInput,
  planExitTeleportMigration,
} from "@lindocara/server/exit-teleport-migrate.js";
import { describe, expect, it } from "vitest";

const MAP_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MAP_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EXIT_ID = "11111111-1111-4111-8111-111111111111";
const ENTRY_ID = "22222222-2222-4222-8222-222222222222";

function exitEvent(id: string, col: number, row: number, name = ""): MapEvent {
  return functionalEvent({ id, col, row, ordinal: 1, kind: "exit", name });
}

function entryEvent(id: string, col: number, row: number): MapEvent {
  return functionalEvent({ id, col, row, ordinal: 1, kind: "entry" });
}

/** Map A carries one exit; map B carries the entry it is bound to. */
function twoMapInput(dest: unknown): ExitMigrationInput {
  return {
    maps: [
      {
        id: MAP_A,
        adventureId: "adv",
        events: [exitEvent(EXIT_ID, 4, 2, "Vers le pont")],
        spawn: { col: 1, row: 1 },
      },
      {
        id: MAP_B,
        adventureId: "adv",
        events: [entryEvent(ENTRY_ID, 7, 9)],
        spawn: { col: 3, row: 3 },
      },
    ],
    adventureGraphs: new Map([
      ["adv", JSON.stringify({ start: null, links: [{ mapId: MAP_A, exitId: EXIT_ID, dest }] })],
    ]),
  };
}

describe("planExitTeleportMigration", () => {
  it("turns a bound exit into a player-touch teleport onto the destination entry's cell", () => {
    const plan = planExitTeleportMigration(twoMapInput({ mapId: MAP_B, entryId: ENTRY_ID }));

    expect(plan.converted).toBe(1);
    expect(plan.skipped).toEqual([]);
    const events = plan.rewrittenEvents.get(MAP_A);
    const migrated = events?.[0];
    expect(migrated?.kind).toBe("normal");
    // Identity, cell, ordinal and the author's own label all survive: this is the same event with a
    // program, not a replacement the author has to find and rename.
    expect(migrated?.id).toBe(EXIT_ID);
    expect(migrated?.col).toBe(4);
    expect(migrated?.row).toBe(2);
    expect(migrated?.name).toBe("Vers le pont");
    // `player-touch` is the exit's own semantics — `#detectAdventureExits` fired on standing in it.
    expect(migrated?.pages[0]?.trigger).toBe("player-touch");
    expect(migrated?.pages[0]?.commands).toEqual([
      { t: "teleport", mapId: MAP_B, col: 7, row: 9, category: "geographic" },
    ]);
  });

  it("falls back to the destination map's spawn when its entry event is gone", () => {
    const input = twoMapInput({ mapId: MAP_B, entryId: ENTRY_ID });
    const mapB = input.maps[1];
    if (!mapB) throw new Error("fixture needs map B");
    const withoutEntry: ExitMigrationInput = {
      ...input,
      maps: [input.maps[0], { ...mapB, events: [] }].filter((m) => m !== undefined),
    };
    const plan = planExitTeleportMigration(withoutEntry);

    // The same fallback `resolveAdventureStart` already applies, so a deleted anchor degrades to a
    // walkable cell rather than to a teleport the runtime would silently refuse.
    expect(plan.rewrittenEvents.get(MAP_A)?.[0]?.pages[0]?.commands).toEqual([
      { t: "teleport", mapId: MAP_B, col: 3, row: 3, category: "geographic" },
    ]);
  });

  it('turns an exit bound to "end" into endAdventure', () => {
    const plan = planExitTeleportMigration(twoMapInput("end"));
    expect(plan.rewrittenEvents.get(MAP_A)?.[0]?.pages[0]?.commands).toEqual([
      { t: "endAdventure" },
    ]);
  });

  it("drops only the migrated links from the graph and keeps the start", () => {
    const input: ExitMigrationInput = {
      maps: [
        {
          id: MAP_A,
          adventureId: "adv",
          events: [exitEvent(EXIT_ID, 4, 2)],
          spawn: { col: 1, row: 1 },
        },
      ],
      adventureGraphs: new Map([
        [
          "adv",
          JSON.stringify({
            start: { mapId: MAP_A, entryId: ENTRY_ID },
            links: [
              { mapId: MAP_A, exitId: EXIT_ID, dest: "end" },
              // A link for an exit that is not in this run's maps must survive untouched.
              { mapId: MAP_B, exitId: ENTRY_ID, dest: "end" },
            ],
          }),
        ],
      ]),
    };
    const plan = planExitTeleportMigration(input);
    const rewritten = plan.graphRewrites.get("adv");
    expect(rewritten).toBeDefined();
    const graph = JSON.parse(rewritten ?? "{}");
    expect(graph.start).toEqual({ mapId: MAP_A, entryId: ENTRY_ID });
    expect(graph.links).toEqual([{ mapId: MAP_B, exitId: ENTRY_ID, dest: "end" }]);
  });

  it("leaves an unbound exit alone rather than inventing a destination for it", () => {
    const input: ExitMigrationInput = {
      maps: [
        {
          id: MAP_A,
          adventureId: "adv",
          events: [exitEvent(EXIT_ID, 4, 2)],
          spawn: { col: 1, row: 1 },
        },
      ],
      adventureGraphs: new Map([["adv", JSON.stringify({ start: null, links: [] })]]),
    };
    const plan = planExitTeleportMigration(input);

    // It moves nobody today; authoring a teleport for it would add behaviour the adventure never had.
    expect(plan.converted).toBe(0);
    expect(plan.rewrittenEvents.size).toBe(0);
    expect(plan.graphRewrites.size).toBe(0);
    expect(plan.skipped).toEqual([{ mapId: MAP_A, eventId: EXIT_ID, reason: "no_link" }]);
  });

  it("refuses a link whose destination map is not in the adventure", () => {
    const input: ExitMigrationInput = {
      maps: [
        {
          id: MAP_A,
          adventureId: "adv",
          events: [exitEvent(EXIT_ID, 4, 2)],
          spawn: { col: 1, row: 1 },
        },
      ],
      adventureGraphs: new Map([
        [
          "adv",
          JSON.stringify({
            start: null,
            links: [{ mapId: MAP_A, exitId: EXIT_ID, dest: { mapId: MAP_B, entryId: ENTRY_ID } }],
          }),
        ],
      ]),
    };
    const plan = planExitTeleportMigration(input);
    expect(plan.converted).toBe(0);
    expect(plan.skipped).toEqual([
      { mapId: MAP_A, eventId: EXIT_ID, reason: "unknown_destination_map" },
    ]);
  });

  it("is idempotent: a second pass over migrated maps finds nothing to do", () => {
    const first = planExitTeleportMigration(twoMapInput({ mapId: MAP_B, entryId: ENTRY_ID }));
    const migratedEvents = first.rewrittenEvents.get(MAP_A);
    expect(migratedEvents).toBeDefined();

    const second = planExitTeleportMigration({
      maps: [
        {
          id: MAP_A,
          adventureId: "adv",
          events: migratedEvents ?? [],
          spawn: { col: 1, row: 1 },
        },
        {
          id: MAP_B,
          adventureId: "adv",
          events: [entryEvent(ENTRY_ID, 7, 9)],
          spawn: { col: 3, row: 3 },
        },
      ],
      adventureGraphs: new Map([
        ["adv", first.graphRewrites.get("adv") ?? JSON.stringify({ start: null, links: [] })],
      ]),
    });
    expect(second.converted).toBe(0);
    expect(second.rewrittenEvents.size).toBe(0);
    expect(second.skipped).toEqual([]);
  });

  it("never destroys a graph it could not parse", () => {
    const input: ExitMigrationInput = {
      maps: [
        {
          id: MAP_A,
          adventureId: "adv",
          events: [exitEvent(EXIT_ID, 4, 2)],
          spawn: { col: 1, row: 1 },
        },
      ],
      adventureGraphs: new Map([["adv", "{ this is not json"]]),
    };
    const plan = planExitTeleportMigration(input);
    expect(plan.graphRewrites.size).toBe(0);
    expect(plan.converted).toBe(0);
    expect(plan.skipped).toEqual([{ mapId: MAP_A, eventId: EXIT_ID, reason: "no_link" }]);
  });
});
