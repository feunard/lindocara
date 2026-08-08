import { describe, expect, it } from "vitest";
import { compileAuthoredMap } from "../src/hd2d/authored-map.js";
import { EMPTY_MARKERS, type MapData } from "../src/map-data.js";
import { defaultEventPage, functionalEvent, type MapEvent } from "../src/map-events.js";
import { emptyLayer } from "../src/tile-layer-codec.js";
import { autotileId } from "../src/tileset.js";
import { GRASS_SLOTS, TINY_SWORDS_TILESET_ID } from "../src/tilesets/tiny-swords.js";

function authored(): MapData {
  const ground = emptyLayer(3, 2);
  ground.ids = [
    autotileId(GRASS_SLOTS[0], 0),
    autotileId(GRASS_SLOTS[1], 0),
    0,
    autotileId(GRASS_SLOTS[2], 0),
    autotileId(GRASS_SLOTS[0], 0),
    autotileId(GRASS_SLOTS[0], 0),
  ];
  return {
    tilesetId: TINY_SWORDS_TILESET_ID,
    cols: 3,
    rows: 2,
    layers: [ground, emptyLayer(3, 2), emptyLayer(3, 2)],
    elements: [
      {
        col: 1,
        row: 1,
        offsetX: 1,
        offsetY: 2,
        assetId: "resource.terrain-resources-wood-trees.tree3",
      },
    ],
    spawn: { col: 0, row: 0 },
    markers: EMPTY_MARKERS,
  };
}

describe("compileAuthoredMap", () => {
  it("compiles rectangular terrain, content and event positions into one square heightfield", () => {
    const page = {
      ...defaultEventPage(),
      graphicAssetId: "resource.terrain-resources-wood-trees.tree3" as const,
    };
    const event: MapEvent = {
      ...functionalEvent({
        id: "11111111-1111-4111-8111-111111111111",
        col: 2,
        row: 1,
        ordinal: 0,
        kind: "npc",
      }),
      pages: [page],
    };

    const compiled = compileAuthoredMap(authored(), [event]);

    expect(compiled.size).toBe(3);
    expect(compiled.levels).toEqual([0, 1, null, 2, 0, 0, null, null, null]);
    expect(compiled.spawns).toEqual([{ name: "default", x: -1, z: -1 }]);
    expect(compiled.elements).toEqual([
      {
        assetId: "resource.terrain-resources-wood-trees.tree3",
        x: 0.25,
        z: 1,
      },
    ]);
    expect(compiled.colliders).not.toHaveLength(0);
    expect(compiled.events).toEqual([
      {
        id: event.id,
        x: 1,
        z: 0,
        graphicAssetId: "resource.terrain-resources-wood-trees.tree3",
      },
    ]);
  });
});
