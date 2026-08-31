import {
  BUILDING_INTERIOR_COLS,
  BUILDING_INTERIOR_ROWS,
  createBuildingInteriorInput,
} from "@lindocara/engine/building-interior.js";
import { compileAuthoredMap } from "@lindocara/engine/hd2d/authored-map.js";
import { EMPTY_MARKERS } from "@lindocara/engine/map-data.js";
import {
  LINDOCARA_BUILDING_ASSET_IDS,
  LINDOCARA_INTERIOR_ASSET_IDS,
} from "@lindocara/engine/tiny-swords-catalog.js";
import { describe, expect, it } from "vitest";

describe("building interior template", () => {
  it("is a playable ordinary map with editable props and an interior return event", () => {
    const exteriorMapId = "337fef22-4a43-469b-a831-439e65866aec";
    const input = createBuildingInteriorInput({
      name: "Maison · Intérieur",
      exteriorMapId,
      exitEventId: "f2c15465-6f9d-4ef5-80dd-e508c3642111",
      returnCol: 10,
      returnRow: 8,
      buildingAssetId: "building.lindocara.house",
    });

    expect(input).toMatchObject({
      cols: BUILDING_INTERIOR_COLS,
      rows: BUILDING_INTERIOR_ROWS,
      environment: "interior",
      interiorShell: { style: "timber" },
      dayNightCycle: false,
    });
    expect(input.elements).toHaveLength(5);
    expect(input.spawn).toEqual({ col: 14, row: BUILDING_INTERIOR_ROWS - 3 });
    expect(input.events?.[0]).toMatchObject({
      col: 14,
      row: BUILDING_INTERIOR_ROWS - 2,
      showMarker: false,
      pages: [{ graphicAssetId: LINDOCARA_INTERIOR_ASSET_IDS.doorTimber }],
    });
    expect(input.events?.[0]?.pages[0]?.commands).toEqual([
      expect.objectContaining({
        t: "teleport",
        mapId: exteriorMapId,
        col: 10,
        row: 8,
        category: "interior",
      }),
    ]);
    const compiled = compileAuthoredMap(
      {
        environment: input.environment ?? "exterior",
        ...(input.interiorShell ? { interiorShell: input.interiorShell } : {}),
        tilesetId: input.tilesetId,
        cols: input.cols,
        rows: input.rows,
        layers: [...input.layers],
        elements: [...input.elements],
        spawn: input.spawn,
        markers: input.markers ?? EMPTY_MARKERS,
      },
      input.events ?? [],
    );
    expect(compiled.spawns).toHaveLength(1);
    expect(compiled.environment).toBe("interior");
    expect(compiled.interiorShell).toEqual({ style: "timber" });
    expect(compiled.levels[0]).toBeNull();
    expect(compiled.colliders.length).toBeGreaterThanOrEqual(4);
  });

  it("uses a stone door and centres it on a castle facade", () => {
    const input = createBuildingInteriorInput({
      name: "Château · Intérieur",
      exteriorMapId: "337fef22-4a43-469b-a831-439e65866aec",
      exitEventId: "f2c15465-6f9d-4ef5-80dd-e508c3642111",
      returnCol: 10,
      returnRow: 8,
      buildingAssetId: LINDOCARA_BUILDING_ASSET_IDS.castle,
    });

    expect(input.events?.[0]).toMatchObject({
      col: Math.floor(BUILDING_INTERIOR_COLS / 2),
      row: BUILDING_INTERIOR_ROWS - 2,
      pages: [{ graphicAssetId: LINDOCARA_INTERIOR_ASSET_IDS.doorStone }],
    });
  });
});
