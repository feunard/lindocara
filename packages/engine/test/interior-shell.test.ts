import {
  INTERIOR_SHELL_WALL_HEIGHT,
  addInteriorShellOpening,
  addInteriorShellInnerWalls,
  filterInteriorShellInnerWalls,
  interiorShellBoundaryRuns,
  interiorShellColliders,
  interiorShellFloorMaterial,
  interiorShellLevels,
  interiorShellOpeningBetween,
  interiorShellOpeningEdgeAt,
  interiorShellRunGroups,
  interiorShellRuns,
  removeInteriorShellOpening,
} from "@lindocara/engine/interior-shell.js";
import { describe, expect, it } from "vitest";

describe("interior shell boundary", () => {
  it("merges a rectangular room into four runs and four authoritative colliders", () => {
    const runs = interiorShellRuns(2, [0, 0, 0, 0]);
    expect(runs).toHaveLength(4);
    expect(runs).toEqual(
      expect.arrayContaining([
        { side: "north", x: 0, z: -1, length: 2, level: 0 },
        { side: "east", x: 1, z: 0, length: 2, level: 0 },
        { side: "south", x: 0, z: 1, length: 2, level: 0 },
        { side: "west", x: -1, z: 0, length: 2, level: 0 },
      ]),
    );

    const colliders = interiorShellColliders(runs, 0.5);
    expect(colliders).toHaveLength(4);
    expect(colliders.every((collider) => collider.top === INTERIOR_SHELL_WALL_HEIGHT)).toBe(true);
    expect(colliders).toContainEqual({
      x: -1,
      z: -1.21,
      w: 2,
      h: 0.42,
      bottom: -0.08,
      top: INTERIOR_SHELL_WALL_HEIGHT,
    });
  });

  it("follows irregular floor edges and encloses an interior void", () => {
    const levels = [0, 0, 0, 0, null, 0, 0, 0, 0];
    const runs = interiorShellRuns(3, levels);
    expect(runs).toHaveLength(8);
    expect(runs.filter((run) => run.length === 3)).toHaveLength(4);
    expect(runs.filter((run) => run.length === 1)).toHaveLength(4);
  });

  it("does not merge adjacent boundary segments at different elevations", () => {
    const runs = interiorShellRuns(2, [0, 1, 0, 1]);
    expect(runs.filter((run) => run.side === "north")).toHaveLength(2);
    const colliders = interiorShellColliders(runs, 0.5);
    expect(colliders.some((collider) => collider.top === INTERIOR_SHELL_WALL_HEIGHT + 0.5)).toBe(
      true,
    );
  });

  it("grows only from the coating's structural floor and keeps enclosed terrain inside", () => {
    const materials = [
      "herbe",
      "herbe",
      "herbe",
      "herbe",
      "herbe",
      "herbe",
      "volcan",
      "volcan",
      "volcan",
      "herbe",
      "herbe",
      "volcan",
      "herbe",
      "volcan",
      "herbe",
      "herbe",
      "volcan",
      "volcan",
      "volcan",
      "herbe",
      "herbe",
      "herbe",
      "herbe",
      "herbe",
      "herbe",
    ] as const;
    const shell = interiorShellLevels(
      5,
      Array.from({ length: 25 }, () => 0),
      materials,
      "volcano",
    );

    expect(shell[0]).toBeNull();
    expect(shell[12]).toBe(0);
    expect(interiorShellRuns(5, shell)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ side: "north", length: 3 }),
        expect.objectContaining({ side: "east", length: 3 }),
        expect.objectContaining({ side: "south", length: 3 }),
        expect.objectContaining({ side: "west", length: 3 }),
      ]),
    );
    expect(interiorShellRuns(5, shell)).toHaveLength(4);
  });

  it("uses existing brushes as explicit structural-floor markers", () => {
    expect(interiorShellFloorMaterial("timber")).toBe("sable");
    expect(interiorShellFloorMaterial("castle")).toBe("sable");
    expect(interiorShellFloorMaterial("cave")).toBe("grotte");
    expect(interiorShellFloorMaterial("mountain")).toBe("montagne");
    expect(interiorShellFloorMaterial("volcano")).toBe("volcan");
    expect(interiorShellFloorMaterial("ice")).toBe("glace");
    expect(interiorShellFloorMaterial("snow")).toBe("neige");
  });

  it("persists compact inner-room masks and builds their perimeter inside the outer room", () => {
    const shell = addInteriorShellInnerWalls({ style: "volcano" }, [
      { col: 1, row: 1 },
      { col: 2, row: 1 },
      { col: 1, row: 2 },
      { col: 2, row: 2 },
    ]);
    expect(shell.innerWalls).toEqual([
      { col: 1, row: 1, length: 2 },
      { col: 1, row: 2, length: 2 },
    ]);

    const runs = interiorShellBoundaryRuns(
      4,
      Array.from({ length: 16 }, () => 0),
      Array.from({ length: 16 }, () => "volcan" as const),
      shell,
    );
    expect(runs).toEqual(
      expect.arrayContaining([
        { side: "north", x: 0, z: -1, length: 2, level: 0 },
        { side: "east", x: 1, z: 0, length: 2, level: 0 },
        { side: "south", x: 0, z: 1, length: 2, level: 0 },
        { side: "west", x: -1, z: 0, length: 2, level: 0 },
      ]),
    );
    expect(runs).toHaveLength(8);
    const groups = interiorShellRunGroups(
      4,
      Array.from({ length: 16 }, () => 0),
      Array.from({ length: 16 }, () => "volcan" as const),
      shell,
    );
    expect(groups.outer).toHaveLength(4);
    expect(groups.inner).toHaveLength(4);
  });

  it("drops inner-room cells as soon as their structural floor is repainted", () => {
    const shell = addInteriorShellInnerWalls({ style: "cave" }, [
      { col: 1, row: 1 },
      { col: 2, row: 1 },
    ]);
    expect(filterInteriorShellInnerWalls(shell, (col) => col === 2).innerWalls).toEqual([
      { col: 2, row: 1, length: 1 },
    ]);
    expect(filterInteriorShellInnerWalls({ ...shell, openOuterWalls: false }, () => false)).toEqual(
      { style: "cave", openOuterWalls: false },
    );
  });

  it("cuts an arbitrary-width passage from rendering and authoritative collision", () => {
    const levels = Array.from({ length: 9 }, () => 0);
    const materials = Array.from({ length: 9 }, () => "volcan" as const);
    const shell = addInteriorShellOpening(
      { style: "volcano" },
      { side: "south", col: 0, row: 2, length: 2 },
    );
    const runs = interiorShellBoundaryRuns(3, levels, materials, shell);

    expect(runs.filter((run) => run.side === "south")).toEqual([
      { side: "south", x: 1, z: 1.5, length: 1, level: 0 },
    ]);
    expect(interiorShellColliders(runs, 0.5)).toHaveLength(4);
    expect(interiorShellOpeningEdgeAt(3, levels, materials, shell, -1, 1.5)).toEqual({
      side: "south",
      col: 0,
      row: 2,
      length: 1,
    });
  });

  it("spans two clicks and can close only part of a wider passage", () => {
    expect(
      interiorShellOpeningBetween(
        { side: "north", col: 4, row: 2, length: 1 },
        { side: "north", col: 1, row: 2, length: 1 },
      ),
    ).toEqual({ side: "north", col: 1, row: 2, length: 4 });
    expect(
      interiorShellOpeningBetween(
        { side: "north", col: 1, row: 2, length: 1 },
        { side: "south", col: 1, row: 2, length: 1 },
      ),
    ).toBeNull();

    const opened = addInteriorShellOpening(
      { style: "castle" },
      { side: "west", col: 2, row: 1, length: 4 },
    );
    const closed = removeInteriorShellOpening(opened, {
      side: "west",
      col: 2,
      row: 2,
      length: 2,
    });
    expect(closed.openings).toEqual([
      { side: "west", col: 2, row: 1, length: 1 },
      { side: "west", col: 2, row: 4, length: 1 },
    ]);
  });
});
