/**
 * The pure planner behind the markers -> typed-events migration (UX wave #12 / Task 5). Mirrors
 * `map-ownership-migrate.test.ts`: the deterministic `mintId` lets the attribution and graph-rewrite
 * rules be pinned without a database. The live-runtime equivalence proof lives in the runtime test.
 */

import type { MapMarkers } from "@lindocara/engine/map-data.js";
import { describe, expect, it } from "vitest";
import {
  type MarkerMigrationInput,
  planMarkerEventMigration,
} from "../src/server/map-marker-event-migrate.js";

function counter(): () => string {
  let n = 0;
  return () => `evt-${++n}`;
}

const emptyMarkers: MapMarkers = { entries: [], exits: [], monsterSpawns: [] };

describe("planMarkerEventMigration", () => {
  it("turns a map's markers into entry/exit/monster events, and rewrites the graph to their uuids", () => {
    const markers: MapMarkers = {
      entries: [{ id: "door", label: "Front", col: 2, row: 2 }],
      exits: [{ id: "finish", col: 4, row: 2 }],
      monsterSpawns: [{ col: 10, row: 8, species: "spear_goblin", patrolRadius: 192 }],
    };
    const input: MarkerMigrationInput = {
      maps: [{ id: "m1", adventureId: "adv", markers, nextOrdinal: 1, hasFunctionalEvents: false }],
      adventureGraphs: new Map([
        [
          "adv",
          JSON.stringify({
            start: { mapId: "m1", entryId: "door" },
            links: [{ mapId: "m1", exitId: "finish", dest: "end" }],
          }),
        ],
      ]),
    };

    const plan = planMarkerEventMigration(input, counter());
    const events = plan.eventsByMap.get("m1");
    expect(events).toHaveLength(3);
    expect(events?.[0]).toMatchObject({
      id: "evt-1",
      kind: "entry",
      col: 2,
      row: 2,
      name: "Front",
    });
    expect(events?.[1]).toMatchObject({ id: "evt-2", kind: "exit", col: 4, row: 2 });
    expect(events?.[2]).toMatchObject({
      id: "evt-3",
      kind: "monster",
      col: 10,
      row: 8,
      species: "spear_goblin",
      patrolRadius: 192,
    });

    const rewritten = JSON.parse(plan.graphRewrites.get("adv") ?? "{}");
    expect(rewritten.start.entryId).toBe("evt-1");
    expect(rewritten.links[0].exitId).toBe("evt-2");
  });

  it("resolves a marker id shared across two maps per-map, never a blind string swap", () => {
    const markers = (): MapMarkers => ({
      entries: [{ id: "door", col: 1, row: 1 }],
      exits: [{ id: "finish", col: 2, row: 2 }],
      monsterSpawns: [],
    });
    const input: MarkerMigrationInput = {
      maps: [
        {
          id: "m1",
          adventureId: "adv",
          markers: markers(),
          nextOrdinal: 1,
          hasFunctionalEvents: false,
        },
        {
          id: "m2",
          adventureId: "adv",
          markers: markers(),
          nextOrdinal: 1,
          hasFunctionalEvents: false,
        },
      ],
      adventureGraphs: new Map([
        [
          "adv",
          JSON.stringify({
            start: { mapId: "m1", entryId: "door" },
            links: [
              { mapId: "m1", exitId: "finish", dest: { mapId: "m2", entryId: "door" } },
              { mapId: "m2", exitId: "finish", dest: "end" },
            ],
          }),
        ],
      ]),
    };

    const plan = planMarkerEventMigration(input, counter());
    const rewritten = JSON.parse(plan.graphRewrites.get("adv") ?? "{}");
    const m1Entry = plan.eventsByMap.get("m1")?.[0]?.id;
    const m2Entry = plan.eventsByMap.get("m2")?.[0]?.id;
    expect(m1Entry).not.toBe(m2Entry);
    // start binds m1's "door", the dest binds m2's "door" — two different uuids for the same slug.
    expect(rewritten.start.entryId).toBe(m1Entry);
    expect(rewritten.links[0].dest.entryId).toBe(m2Entry);
  });

  it("skips a map that already has functional events (idempotent) and one with no markers", () => {
    const input: MarkerMigrationInput = {
      maps: [
        {
          id: "already",
          adventureId: "adv",
          markers: {
            entries: [{ id: "door", col: 1, row: 1 }],
            exits: [],
            monsterSpawns: [],
          },
          nextOrdinal: 5,
          hasFunctionalEvents: true,
        },
        {
          id: "bare",
          adventureId: "adv",
          markers: emptyMarkers,
          nextOrdinal: 1,
          hasFunctionalEvents: false,
        },
      ],
      adventureGraphs: new Map([
        ["adv", JSON.stringify({ start: { mapId: "already", entryId: "door" }, links: [] })],
      ]),
    };

    const plan = planMarkerEventMigration(input, counter());
    expect(plan.eventsByMap.size).toBe(0);
    // Nothing changed, so no graph rewrite is emitted (the anchor "door" is left as it was).
    expect(plan.graphRewrites.size).toBe(0);
  });

  it("seeds new ordinals past the map's existing max so they never collide", () => {
    const input: MarkerMigrationInput = {
      maps: [
        {
          id: "m1",
          adventureId: "adv",
          markers: {
            entries: [{ id: "door", col: 1, row: 1 }],
            exits: [{ id: "finish", col: 2, row: 2 }],
            monsterSpawns: [],
          },
          nextOrdinal: 7,
          hasFunctionalEvents: false,
        },
      ],
      adventureGraphs: new Map(),
    };
    const plan = planMarkerEventMigration(input, counter());
    expect(plan.eventsByMap.get("m1")?.map((event) => event.ordinal)).toEqual([7, 8]);
  });
});
