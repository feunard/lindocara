/**
 * The pure algorithm behind migration 0021 (UX wave #5): every map attributed to exactly one
 * adventure. Single-ref attribution, multi-ref duplication (children copied + graph rewritten), and
 * orphan drop are all exercised here against plain data — the SQL mirrors this planner.
 */

import {
  type OwnershipPlanInput,
  planOwnershipMigration,
} from "@lindocara/server/map-ownership-migrate.js";
import { describe, expect, it } from "vitest";

/** A deterministic id source: "n1", "n2", … so a test can assert exact ids. */
function counter(): () => string {
  let n = 0;
  return () => `n${++n}`;
}

function graph(startMapId: string, links: { mapId: string; dest: string }[]): string {
  return JSON.stringify({
    start: { mapId: startMapId, entryId: "door" },
    links: links.map((link) => ({
      mapId: link.mapId,
      exitId: "gate",
      dest: link.dest === "end" ? "end" : { mapId: link.dest, entryId: "door" },
    })),
  });
}

describe("planOwnershipMigration", () => {
  it("attributes a single-reference map to its one adventure", () => {
    const input: OwnershipPlanInput = {
      mapIds: ["mapA", "mapB"],
      memberships: [
        { adventureId: "advX", mapId: "mapA", position: 0 },
        { adventureId: "advX", mapId: "mapB", position: 1 },
      ],
      adventureGraphs: new Map([["advX", graph("mapA", [{ mapId: "mapA", dest: "end" }])]]),
      elements: [],
      events: [],
    };
    const plan = planOwnershipMigration(input, counter());
    expect(plan.attributions).toEqual([
      { mapId: "mapA", adventureId: "advX" },
      { mapId: "mapB", adventureId: "advX" },
    ]);
    expect(plan.duplicates).toEqual([]);
    expect(plan.droppedMapIds).toEqual([]);
    expect(plan.graphRewrites).toEqual([]);
  });

  it("duplicates a multi-referenced map per extra adventure, copying children and rewriting the graph", () => {
    const input: OwnershipPlanInput = {
      mapIds: ["shared"],
      // Referenced by TWO adventures; "advA" is primary (lowest id), "advB" gets the copy.
      memberships: [
        { adventureId: "advB", mapId: "shared", position: 3 },
        { adventureId: "advA", mapId: "shared", position: 0 },
      ],
      adventureGraphs: new Map([
        ["advA", graph("shared", [{ mapId: "shared", dest: "end" }])],
        ["advB", graph("shared", [{ mapId: "shared", dest: "end" }])],
      ]),
      elements: [{ mapId: "shared", col: 2, row: 2, kind: "tree", variant: 0 }],
      events: [
        { id: "ev1", mapId: "shared", col: 4, row: 4, name: "Gate", ordinal: 0, pageCount: 2 },
      ],
    };
    const plan = planOwnershipMigration(input, counter());

    // The original stays with the primary adventure.
    expect(plan.attributions).toEqual([{ mapId: "shared", adventureId: "advA" }]);

    // The extra adventure gets one duplicated map, with a fresh id and preserved position.
    expect(plan.duplicates).toHaveLength(1);
    const dup = plan.duplicates[0];
    if (!dup) throw new Error("expected a duplicate");
    expect(dup.sourceMapId).toBe("shared");
    expect(dup.adventureId).toBe("advB");
    expect(dup.position).toBe(3);
    expect(dup.newMapId).toBe("n1");

    // CHILDREN TRAVEL: elements re-parented onto the copy, events copied with a fresh id.
    expect(dup.elements).toEqual([{ mapId: "n1", col: 2, row: 2, kind: "tree", variant: 0 }]);
    expect(dup.events).toEqual([
      { id: "n2", mapId: "n1", col: 4, row: 4, name: "Gate", ordinal: 0, pageCount: 2 },
    ]);

    // advB's graph now points at the copy; advA's graph is untouched (no rewrite emitted for it).
    expect(plan.graphRewrites).toEqual([
      { adventureId: "advB", graph: graph("n1", [{ mapId: "n1", dest: "end" }]) },
    ]);
    expect(plan.droppedMapIds).toEqual([]);
  });

  it("drops a map no adventure references", () => {
    const input: OwnershipPlanInput = {
      mapIds: ["kept", "orphan"],
      memberships: [{ adventureId: "advX", mapId: "kept", position: 0 }],
      adventureGraphs: new Map([["advX", graph("kept", [{ mapId: "kept", dest: "end" }])]]),
      elements: [],
      events: [],
    };
    const plan = planOwnershipMigration(input, counter());
    expect(plan.attributions).toEqual([{ mapId: "kept", adventureId: "advX" }]);
    expect(plan.droppedMapIds).toEqual(["orphan"]);
    expect(plan.duplicates).toEqual([]);
  });
});
