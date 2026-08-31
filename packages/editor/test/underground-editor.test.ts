import {
  applyTool,
  blankMap,
  type EditorMap,
  removeVerticalStorey,
  toMapData,
  toSaveInput,
} from "@lindocara/editor/game/editor-state.js";
import { decodeMap, mapToQuerySource } from "@lindocara/engine/hd2d/map-data.js";
import { createTerrainQuery } from "@lindocara/engine/hd2d/terrain-query.js";
import { describe, expect, it } from "vitest";

describe("underground editor tools", () => {
  it("deletes one whole selected storey and every access or linked endpoint that depends on it", () => {
    let map: EditorMap = {
      ...blankMap("Storey removal", 12, 12),
      environment: "interior" as const,
      interiorShell: { style: "timber" as const },
    };
    map = applyTool(
      map,
      { kind: "elevation", material: "parquet", step: "keep" },
      4,
      4,
      true,
      "field",
      0,
      0,
      -1,
    ) as EditorMap;
    map = applyTool(
      map,
      { kind: "elevation", material: "parquet", step: "keep" },
      5,
      5,
      true,
      "field",
      0,
      0,
      -2,
    ) as EditorMap;
    map = applyTool(
      map,
      { kind: "elevation", material: "volcan", step: "keep" },
      8,
      8,
      true,
      "field",
      0,
      0,
      1,
    ) as EditorMap;
    map = applyTool(
      map,
      { kind: "element", assetId: "decoration.deco.01" },
      4,
      4,
      true,
      "element",
      0,
      0,
      -1,
    ) as EditorMap;
    map = applyTool(
      map,
      { kind: "event", eventKind: "normal" },
      4,
      4,
      true,
      "event",
      0,
      0,
      -1,
    ) as EditorMap;
    map = applyTool(map, { kind: "event", eventKind: "normal" }, 6, 6, true, "event") as EditorMap;
    map = applyTool(map, { kind: "event", eventKind: "normal" }, 7, 7, true, "event") as EditorMap;
    const upperEvent = map.events.find((event) => event.undergroundDepth === -1);
    const surfaceEvent = map.events.find((event) => event.undergroundDepth === undefined);
    const unrelatedEvent = map.events.find(
      (event) => event.undergroundDepth === undefined && event.id !== surfaceEvent?.id,
    );
    if (!upperEvent || !surfaceEvent || !unrelatedEvent)
      throw new Error("storey event fixture is incomplete");
    map = {
      ...map,
      underground: {
        ...map.underground,
        levels: map.underground?.levels ?? [],
        stairs: [
          { depth: -1, fromDepth: 0, col: 2, row: 2, direction: "east", length: 3, width: 1 },
          { depth: -2, fromDepth: -1, col: 5, row: 5, direction: "east", length: 3, width: 1 },
          { depth: 1, fromDepth: 0, col: 8, row: 8, direction: "east", length: 3, width: 1 },
        ],
        shafts: [{ col: 9, row: 9, width: 1, length: 1, depth: 1 }],
      },
      events: map.events.map((event) =>
        event.id === upperEvent.id
          ? { ...event, linkedEventId: surfaceEvent.id }
          : event.id === surfaceEvent.id
            ? { ...event, linkedEventId: upperEvent.id }
            : event,
      ),
    };

    const removed = removeVerticalStorey(map, -1);
    expect(removed.underground?.levels.map((level) => level.depth)).toEqual([-2, 1]);
    expect(removed.underground?.stairs).toEqual([
      { depth: 1, fromDepth: 0, col: 8, row: 8, direction: "east", length: 3, width: 1 },
    ]);
    expect(removed.underground?.shafts).toEqual([
      { col: 9, row: 9, width: 1, length: 1, depth: 1 },
    ]);
    expect(removed.elements).toHaveLength(0);
    expect(removed.events.map((event) => event.id)).toEqual([unrelatedEvent.id]);
    expect(removeVerticalStorey(removed, -1)).toBe(removed);
  });

  it("digs and refills large blocks as one authored operation", () => {
    const map = blankMap("Deep map", 12, 12);
    const dug = applyTool(
      map,
      {
        kind: "underground",
        operation: "dig",
        depth: 4,
        style: "volcano",
        width: 5,
        length: 3,
        direction: "east",
      },
      2,
      3,
    );
    expect(dug?.underground?.levels).toEqual([
      {
        depth: 4,
        style: "volcano",
        cells: [
          { col: 2, row: 3, length: 5 },
          { col: 2, row: 4, length: 5 },
          { col: 2, row: 5, length: 5 },
        ],
      },
    ]);
    const filled = dug
      ? applyTool(
          dug,
          {
            kind: "underground",
            operation: "fill",
            depth: 4,
            style: "cave",
            width: 5,
            length: 3,
            direction: "east",
          },
          2,
          3,
        )
      : null;
    expect(filled?.underground?.levels).toEqual([]);
  });

  it("keeps a directed tunnel distinct from a rectangular room", () => {
    const map = blankMap("Tunnel", 12, 12);
    const east = applyTool(
      map,
      {
        kind: "underground",
        operation: "tunnel",
        depth: 2,
        style: "cave",
        width: 2,
        length: 6,
        direction: "east",
      },
      2,
      3,
    );
    const south = applyTool(
      map,
      {
        kind: "underground",
        operation: "tunnel",
        depth: 2,
        style: "cave",
        width: 2,
        length: 6,
        direction: "south",
      },
      2,
      3,
    );

    expect(east?.underground?.levels[0]?.cells).toHaveLength(2);
    expect(east?.underground?.levels[0]?.cells[0]?.length).toBe(6);
    expect(south?.underground?.levels[0]?.cells).toHaveLength(6);
    expect(south?.underground?.levels[0]?.cells[0]?.length).toBe(2);
  });

  it("extends a surface flight by three cells for every crossed storey", () => {
    const map = blankMap("Stairs", 12, 12);
    const edited = applyTool(
      map,
      {
        kind: "underground",
        operation: "stairs",
        depth: 2,
        style: "castle",
        width: 1,
        length: 3,
        direction: "south",
      },
      4,
      5,
    );
    expect(edited).not.toBeNull();
    expect(edited?.underground?.levels.map((level) => level.depth)).toEqual([1, 2]);
    expect(edited?.underground?.levels[0]?.cells).toContainEqual({ col: 4, row: 4, length: 1 });
    expect(edited?.underground?.levels[1]?.cells).toContainEqual({ col: 4, row: 3, length: 1 });
    const heightfield = edited ? decodeMap(toSaveInput(edited).heightfield) : null;
    expect(heightfield?.underground?.stairs).toEqual([
      { depth: 2, fromDepth: 0, col: 4, row: 0, direction: "south", length: 6, width: 1 },
    ]);
    expect(heightfield?.ramps?.at(-1)).toMatchObject({ lowHeight: -4.8, highHeight: 0 });
    expect(toMapData(edited ?? map).underground).toEqual(edited?.underground);
  });

  it("connects the selected underground storey to a deeper target without collision gaps", () => {
    const map = blankMap("Deep stairs", 32, 32);
    const edited = applyTool(
      map,
      {
        kind: "underground",
        operation: "stairs",
        depth: 8,
        style: "cave",
        width: 2,
        length: 5,
        direction: "west",
      },
      3,
      3,
      true,
      "field",
      0,
      0,
      3,
    );

    expect(edited?.underground?.stairs).toEqual([
      {
        depth: 8,
        fromDepth: 3,
        col: 3,
        row: 3,
        direction: "west",
        length: 15,
        width: 2,
      },
    ]);
    expect(edited?.underground?.levels.map((level) => level.depth)).toEqual([3, 4, 5, 6, 7, 8]);
    const heightfield = edited ? decodeMap(toSaveInput(edited).heightfield) : null;
    expect(heightfield?.ramps?.at(-1)?.lowHeight).toBeCloseTo(-19.2);
    expect(heightfield?.ramps?.at(-1)?.highHeight).toBeCloseTo(-7.2);
  });

  it("creates a long, traversable 0 to -16 flight instead of a near-vertical drop", () => {
    const map = blankMap("Maximum stairs", 56, 56);
    const edited = applyTool(
      map,
      {
        kind: "underground",
        operation: "stairs",
        depth: 16,
        style: "cave",
        width: 2,
        length: 3,
        direction: "east",
      },
      47,
      3,
    );

    expect(edited?.underground?.stairs[0]).toMatchObject({
      depth: 16,
      fromDepth: 0,
      col: 0,
      length: 48,
      width: 2,
    });
    expect(edited?.underground?.levels.map((level) => level.depth)).toEqual(
      Array.from({ length: 16 }, (_unused, index) => index + 1),
    );
  });

  it("places a basement ascent from its visible low foot over one or several storeys", () => {
    const map = blankMap("Basement ascent", 24, 24);
    const fromMinusThreeToMinusOne = applyTool(
      map,
      {
        kind: "underground",
        operation: "stairs",
        depth: 1,
        style: "castle",
        width: 2,
        length: 3,
        direction: "east",
      },
      2,
      5,
      true,
      "field",
      0,
      0,
      3,
    );
    expect(fromMinusThreeToMinusOne?.underground?.stairs).toEqual([
      {
        depth: 3,
        fromDepth: 1,
        col: 2,
        row: 5,
        direction: "east",
        length: 6,
        width: 2,
      },
    ]);

    const fromMinusThreeToSurface = applyTool(
      map,
      {
        kind: "underground",
        operation: "stairs",
        depth: 0,
        style: "castle",
        width: 2,
        length: 3,
        direction: "east",
      },
      2,
      9,
      true,
      "field",
      0,
      0,
      3,
    );
    expect(fromMinusThreeToSurface?.underground?.stairs).toEqual([
      {
        depth: 3,
        fromDepth: 0,
        col: 2,
        row: 9,
        direction: "east",
        length: 9,
        width: 2,
      },
    ]);
    expect(fromMinusThreeToSurface?.underground?.levels.map((level) => level.depth)).toEqual([
      1, 2, 3,
    ]);
  });

  it("anchors ascending and descending basement placements at opposite visible mouths", () => {
    const map = blankMap("Inverse placement", 20, 20);
    const common = {
      kind: "underground" as const,
      operation: "stairs" as const,
      style: "cave" as const,
      width: 2,
      length: 3,
      direction: "east" as const,
    };
    const descending = applyTool(map, { ...common, depth: 3 }, 7, 5, true, "field", 0, 0, 1);
    const ascending = applyTool(map, { ...common, depth: 1 }, 2, 5, true, "field", 0, 0, 3);

    expect(descending?.underground?.stairs[0]).toEqual(ascending?.underground?.stairs[0]);
  });

  it("creates proportional upper-floor stairs only inside an interior map", () => {
    const exterior = blankMap("Exterior", 24, 24);
    const interior = {
      ...blankMap("Upper floors", 24, 24),
      environment: "interior" as const,
      interiorShell: { style: "timber" as const },
    };
    const tool = {
      kind: "underground" as const,
      operation: "stairs" as const,
      depth: -2,
      style: "timber" as const,
      width: 2,
      length: 3,
      direction: "east" as const,
    };
    const exteriorEdited = applyTool(exterior, tool, 3, 7);
    const edited = applyTool(interior, tool, 3, 7);

    expect(exteriorEdited).toBeNull();
    expect(edited?.underground?.stairs).toEqual([
      {
        depth: 0,
        fromDepth: -2,
        col: 3,
        row: 7,
        direction: "east",
        length: 6,
        width: 2,
      },
    ]);
    expect(edited?.underground?.levels.map((level) => level.depth)).toEqual([-2, -1]);
    const heightfield = edited ? decodeMap(toSaveInput(edited).heightfield) : null;
    expect(heightfield?.underground?.levels.map((level) => level.depth)).toEqual([-2, -1]);
    expect(heightfield?.ramps?.at(-1)).toMatchObject({ lowHeight: 0, highHeight: 4.8 });
  });

  it("authors terrain, liquids, scenery and events independently on an upper floor", () => {
    let edited = {
      ...blankMap("Furnished floor", 12, 12),
      environment: "interior" as const,
      interiorShell: { style: "timber" as const },
    };
    edited = applyTool(
      edited,
      { kind: "elevation", material: "parquet", step: "keep" },
      4,
      4,
      true,
      "field",
      0,
      0,
      -1,
    ) as typeof edited;
    edited = applyTool(
      edited,
      { kind: "block", block: "water" },
      5,
      4,
      true,
      "field",
      0,
      0,
      -1,
    ) as typeof edited;
    edited = applyTool(
      edited,
      { kind: "element", assetId: "decoration.deco.01" },
      4,
      4,
      true,
      "element",
      0,
      0,
      -1,
    ) as typeof edited;
    edited = applyTool(
      edited,
      { kind: "event", eventKind: "normal" },
      5,
      4,
      true,
      "event",
      0,
      0,
      -1,
    ) as typeof edited;

    expect(edited.underground?.levels).toMatchObject([
      {
        depth: -1,
        style: "timber",
        terrain: [
          { col: 4, row: 4, length: 1, material: "parquet" },
          { col: 5, row: 4, length: 1, material: "water" },
        ],
      },
    ]);
    expect(edited.elements[0]?.undergroundDepth).toBe(-1);
    expect(edited.events[0]?.undergroundDepth).toBe(-1);
    const heightfield = decodeMap(toSaveInput(edited).heightfield);
    if (!heightfield) throw new Error("upper-floor heightfield did not decode");
    expect(heightfield?.elements[0]).toMatchObject({ undergroundDepth: -1, y: 2.4 });
    expect(heightfield?.events[0]).toMatchObject({ undergroundDepth: -1, y: 2.4 });
    expect(mapToQuerySource(heightfield).kindAtElevation?.(4, 4, 2.4)).toBe("parquet");
    expect(mapToQuerySource(heightfield).liquidAtElevation?.(5, 4, 2.4)).toBe("water");
  });

  it("grows and removes upper-floor zones with the same block and fill tools as a basement", () => {
    const interior = {
      ...blankMap("Editable floor", 12, 12),
      environment: "interior" as const,
      interiorShell: { style: "castle" as const },
    };
    const built = applyTool(
      interior,
      {
        kind: "underground",
        operation: "dig",
        depth: -1,
        style: "castle",
        width: 4,
        length: 3,
        direction: "east",
      },
      3,
      4,
      true,
      "field",
      0,
      0,
      -1,
    );
    expect(built?.underground?.levels).toEqual([
      {
        depth: -1,
        style: "castle",
        cells: [
          { col: 3, row: 4, length: 4 },
          { col: 3, row: 5, length: 4 },
          { col: 3, row: 6, length: 4 },
        ],
      },
    ]);

    const fillTool = {
      kind: "underground" as const,
      operation: "fill" as const,
      depth: -1,
      style: "castle" as const,
      width: 1,
      length: 1,
      direction: "east" as const,
      shape: "rect" as const,
    };
    const anchored = built ? applyTool(built, fillTool, 3, 4, true, "field", 0, 0, -1) : null;
    const removed = anchored ? applyTool(anchored, fillTool, 4, 6, false, "field", 0, 0, -1) : null;
    const remaining = removed?.underground?.levels[0]?.cells.flatMap((run) =>
      Array.from({ length: run.length }, (_unused, offset) => `${run.col + offset}:${run.row}`),
    );
    expect(remaining).not.toContain("3:4");
    expect(remaining).not.toContain("4:6");
    expect(remaining).toContain("5:4");
    expect(remaining).toContain("6:6");
  });

  it("authors a true surface shaft through every storey and removes it when filled", () => {
    const map = blankMap("Shaft", 12, 12);
    const dug = applyTool(
      map,
      {
        kind: "underground",
        operation: "shaft",
        depth: 4,
        style: "cave",
        width: 2,
        length: 3,
        direction: "east",
      },
      5,
      4,
    );
    expect(dug?.underground?.levels.map((level) => level.depth)).toEqual([1, 2, 3, 4]);
    expect(dug?.underground?.shafts).toEqual([{ col: 5, row: 4, width: 2, length: 3, depth: 4 }]);
    const heightfield = dug ? decodeMap(toSaveInput(dug).heightfield) : null;
    expect(heightfield?.underground?.shafts).toEqual(dug?.underground?.shafts);
    expect(heightfield?.levels[4 * 12 + 5]).toBe(0);

    const filled = dug
      ? applyTool(
          dug,
          {
            kind: "underground",
            operation: "fill",
            depth: 2,
            style: "cave",
            width: 2,
            length: 3,
            direction: "east",
          },
          5,
          4,
        )
      : null;
    expect(filled?.underground?.shafts).toBeUndefined();
  });

  it("authors direct holes and tunnels relative to the selected basement", () => {
    const firstBasement = applyTool(
      blankMap("Relative basement tools", 12, 12),
      {
        kind: "underground",
        operation: "dig",
        depth: 1,
        style: "cave",
        width: 6,
        length: 6,
        direction: "east",
      },
      3,
      3,
    );
    const hole = firstBasement
      ? applyTool(
          firstBasement,
          {
            kind: "underground",
            operation: "shaft",
            depth: 2,
            style: "castle",
            width: 1,
            length: 1,
            direction: "east",
            shape: "pencil",
          },
          5,
          5,
          true,
          "field",
          0,
          0,
          1,
        )
      : null;

    expect(hole?.underground?.shafts).toEqual([
      { col: 5, row: 5, width: 1, length: 1, fromDepth: 1, depth: 2 },
    ]);
    expect(hole?.underground?.levels.map((level) => level.depth)).toEqual([1, 2]);
    expect(hole ? decodeMap(toSaveInput(hole).heightfield)?.underground?.shafts : null).toEqual(
      hole?.underground?.shafts,
    );

    const tunnel = hole
      ? applyTool(
          hole,
          {
            kind: "underground",
            operation: "tunnel",
            depth: 2,
            style: "castle",
            width: 2,
            length: 4,
            direction: "south",
          },
          6,
          5,
          true,
          "field",
          0,
          0,
          2,
        )
      : null;
    const secondLevel = tunnel?.underground?.levels.find((level) => level.depth === 2);
    expect(secondLevel?.cells).toEqual([
      { col: 5, row: 5, length: 3 },
      { col: 6, row: 6, length: 2 },
      { col: 6, row: 7, length: 2 },
      { col: 6, row: 8, length: 2 },
    ]);

    const filled = tunnel
      ? applyTool(
          tunnel,
          {
            kind: "underground",
            operation: "fill",
            depth: 1,
            style: "cave",
            width: 1,
            length: 1,
            direction: "east",
            shape: "pencil",
          },
          5,
          5,
          true,
          "field",
          0,
          0,
          1,
        )
      : null;
    expect(filled?.underground?.shafts).toBeUndefined();
  });

  it("uses one cell by default and supports rectangle and fill shapes for direct holes", () => {
    const tool = {
      kind: "underground" as const,
      operation: "shaft" as const,
      depth: 2,
      style: "cave" as const,
      width: 1,
      length: 1,
      direction: "east" as const,
    };
    const unit = applyTool(blankMap("Unit hole", 12, 12), { ...tool, shape: "pencil" }, 5, 4);
    expect(unit?.underground?.shafts).toEqual([{ col: 5, row: 4, width: 1, length: 1, depth: 2 }]);

    const rectangleStart = applyTool(
      blankMap("Rectangle hole", 12, 12),
      { ...tool, shape: "rect" },
      2,
      3,
      true,
    );
    const rectangle = rectangleStart
      ? applyTool(rectangleStart, { ...tool, shape: "rect" }, 5, 4, false)
      : null;
    expect(rectangle?.underground?.shafts).toEqual([
      { col: 2, row: 3, width: 4, length: 2, depth: 2 },
    ]);

    const filled = applyTool(blankMap("Filled hole", 12, 12), { ...tool, shape: "fill" }, 6, 6);
    expect(filled?.underground?.shafts).toEqual([
      { col: 0, row: 0, width: 12, length: 12, depth: 2 },
    ]);
  });

  it("reuses pencil, rectangle and flood-fill shapes when filling underground rooms", () => {
    const dug = applyTool(
      blankMap("Fill shapes", 12, 12),
      {
        kind: "underground",
        operation: "dig",
        depth: 3,
        style: "cave",
        width: 4,
        length: 4,
        direction: "east",
      },
      3,
      3,
    );
    const fillTool = {
      kind: "underground" as const,
      operation: "fill" as const,
      depth: 3,
      style: "cave" as const,
      width: 1,
      length: 1,
      direction: "east" as const,
      shape: "rect" as const,
    };
    const anchored = dug ? applyTool(dug, fillTool, 3, 3, true, "field", 0, 0, 3) : null;
    const rectangle = anchored
      ? applyTool(anchored, fillTool, 4, 4, false, "field", 0, 0, 3)
      : null;
    expect(rectangle?.underground?.levels[0]?.cells).not.toContainEqual({
      col: 3,
      row: 3,
      length: 4,
    });

    const flooded = rectangle
      ? applyTool(rectangle, { ...fillTool, shape: "fill" }, 5, 3, true, "field", 0, 0, 3)
      : null;
    expect(flooded?.underground?.levels).toEqual([]);
  });

  it("reuses terrain, scenery and event tools per storey without mixing their content", () => {
    const tree = "decoration.terrain-decorations-bushes.bushe1";
    let map = blankMap("Layered content", 12, 12);
    map = applyTool(
      map,
      {
        kind: "underground",
        operation: "dig",
        depth: 3,
        style: "cave",
        width: 4,
        length: 4,
        direction: "east",
      },
      3,
      3,
    ) as typeof map;
    map = applyTool(
      map,
      { kind: "elevation", step: "keep", material: "volcan" },
      4,
      4,
      true,
      "field",
      0,
      0,
      3,
    ) as typeof map;
    map = applyTool(map, { kind: "element", assetId: tree }, 4, 4, true, "element") as typeof map;
    map = applyTool(
      map,
      { kind: "element", assetId: tree },
      4,
      4,
      true,
      "element",
      0,
      0,
      3,
    ) as typeof map;
    map = applyTool(map, { kind: "event", eventKind: "normal" }, 5, 5, true, "event") as typeof map;
    map = applyTool(
      map,
      {
        kind: "event",
        eventKind: "normal",
        preset: "checkpoint",
        selfMapId: "11111111-1111-4111-8111-111111111111",
      },
      5,
      5,
      true,
      "event",
      0,
      0,
      3,
    ) as typeof map;

    expect(map.underground?.levels.find((level) => level.depth === 3)?.terrain).toEqual([
      { col: 4, row: 4, length: 1, material: "volcan" },
    ]);
    expect(map.elements.map((element) => element.undergroundDepth ?? 0)).toEqual([0, 3]);
    expect(map.events.map((event) => event.undergroundDepth ?? 0)).toEqual([0, 3]);
    expect(map.events[1]?.pages[0]?.commands).toEqual([
      {
        t: "setCheckpoint",
        mapId: "11111111-1111-4111-8111-111111111111",
        col: 5,
        row: 5,
        undergroundDepth: 3,
      },
    ]);
    expect(map.elements[0]?.id).toBeUndefined();
    expect(map.elements[1]?.id).toBeDefined();

    const stored = toMapData(map).underground;
    expect(stored?.elementDepths).toEqual([{ id: map.elements[1]?.id, depth: 3 }]);
    expect(stored?.eventDepths).toEqual([{ id: map.events[1]?.id, depth: 3 }]);
    const heightfield = decodeMap(toSaveInput(map).heightfield);
    expect(heightfield?.elements.filter((element) => element.undergroundDepth === 3)).toHaveLength(
      1,
    );
    expect(heightfield?.events.filter((event) => event.undergroundDepth === 3)).toHaveLength(1);
  });

  it("raises underground terrain and places liquids, scenery and events on its true top", () => {
    const tree = "decoration.terrain-decorations-bushes.bushe1";
    let map = applyTool(
      blankMap("Raised basement", 12, 12),
      {
        kind: "underground",
        operation: "dig",
        depth: 3,
        style: "cave",
        width: 4,
        length: 4,
        direction: "east",
      },
      3,
      3,
    );
    if (!map) throw new Error("underground room was refused");
    map = applyTool(
      map,
      { kind: "elevation", step: "raise", material: "volcan" },
      4,
      4,
      true,
      "field",
      0,
      0,
      3,
    );
    if (!map) throw new Error("raised underground terrain was refused");
    map = applyTool(
      map,
      { kind: "elevation", step: "raise", material: "herbe" },
      5,
      4,
      true,
      "field",
      0,
      0,
      3,
    );
    map = map
      ? applyTool(map, { kind: "block", block: "water" }, 5, 4, true, "field", 0, 0, 3)
      : null;
    if (!map) throw new Error("raised underground water was refused");
    map = applyTool(
      map,
      { kind: "elevation", step: "raise", material: "lave" },
      6,
      4,
      true,
      "field",
      0,
      0,
      3,
    );
    if (!map) throw new Error("raised underground lava was refused");
    // Stored row 3 projects its visual foot onto row 4, the raised cell under the cursor.
    map = applyTool(map, { kind: "element", assetId: tree }, 4, 3, true, "element", 0, 0, 3);
    if (!map) throw new Error("underground scenery was refused");
    map = applyTool(map, { kind: "event", eventKind: "normal" }, 4, 4, true, "event", 0, 0, 3);
    if (!map) throw new Error("underground event was refused");

    expect(map.underground?.levels.find((level) => level.depth === 3)?.terrain).toEqual([
      { col: 4, row: 4, length: 1, material: "volcan", elevation: 1 },
      { col: 5, row: 4, length: 1, material: "water", elevation: 1 },
      { col: 6, row: 4, length: 1, material: "lave", elevation: 1 },
    ]);
    expect(
      applyTool(
        map,
        { kind: "elevation", step: "raise", material: "volcan" },
        4,
        4,
        true,
        "field",
        0,
        0,
        3,
      ),
    ).toBeNull();

    const heightfield = decodeMap(toSaveInput(map).heightfield);
    if (!heightfield) throw new Error("compiled underground map was rejected");
    expect(heightfield.elements.find((element) => element.undergroundDepth === 3)?.y).toBeCloseTo(
      -6.3,
    );
    expect(heightfield.events.find((event) => event.undergroundDepth === 3)?.y).toBeCloseTo(-6.3);
    const query = createTerrainQuery(mapToQuerySource(heightfield));
    const water = query.waterLevelAtElevation?.(-0.5, -1.5, -7.2);
    expect(water).toBeCloseTo(-6.3);
    expect(query.liquidAtElevation?.(0.5, -1.5, -7.2)).toBe("lava");
    expect(query.waterLevelAtElevation?.(0.5, -1.5, -7.2)).toBeCloseTo(-6.3);
    expect(query.surfaceAt?.(-1.5, -1.5, -6.1)).toBeCloseTo(-6.3);
  });

  it("attaches runtime events only to real cells on the selected vertical floor", () => {
    let map = applyTool(
      blankMap("Vertical events", 12, 12),
      {
        kind: "underground",
        operation: "dig",
        depth: 2,
        style: "cave",
        width: 3,
        length: 3,
        direction: "east",
      },
      3,
      3,
    );
    if (!map) throw new Error("underground fixture was refused");

    map = applyTool(
      map,
      {
        kind: "event",
        eventKind: "monster",
        species: "spear_goblin",
        patrolRadius: 3,
      },
      4,
      4,
      true,
      "event",
      0,
      0,
      2,
    );
    if (!map) throw new Error("underground monster was refused");

    expect(map.events[0]).toMatchObject({ kind: "monster", col: 4, row: 4, undergroundDepth: 2 });
    expect(
      applyTool(
        map,
        { kind: "event", eventKind: "npc", patrolRadius: 2 },
        9,
        9,
        true,
        "event",
        0,
        0,
        2,
      ),
    ).toBeNull();
  });
});
