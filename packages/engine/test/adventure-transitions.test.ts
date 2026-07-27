import { mapDataFromBlocks } from "@lindocara/testing/map-fixtures.js";
import { describe, expect, it } from "vitest";
import type { AdventureBundleMap } from "../src/adventure-bundle.js";
import {
  buildAuthoredTransitionGraph,
  reachableTransitionMaps,
} from "../src/adventure-transitions.js";
import type { EventCommand } from "../src/event-commands.js";
import { encodeTileLayer } from "../src/tile-layer-codec.js";

const MAP_A = "11111111-1111-4111-a111-111111111111";
const MAP_B = "22222222-2222-4222-a222-222222222222";
const EVENT = "33333333-3333-4333-a333-333333333333";

function bundleMap(id: string, commands: readonly EventCommand[]): AdventureBundleMap {
  const data = mapDataFromBlocks({
    blocks: ["....", "....", "....", "...."],
    elements: [],
    spawn: { col: 0, row: 0 },
  });
  return {
    id,
    name: id === MAP_A ? "Départ" : "Arrivée",
    tilesetId: data.tilesetId,
    cols: data.cols,
    rows: data.rows,
    layers: data.layers.map(encodeTileLayer),
    elements: data.elements,
    spawn: data.spawn,
    events: [
      {
        id: EVENT,
        col: 1,
        row: 1,
        name: "Passage",
        ordinal: 1,
        kind: "normal",
        species: null,
        patrolRadius: null,
        pages: [
          {
            condSwitchId: null,
            condVariableId: null,
            condVariableMin: null,
            condSelfSwitch: null,
            graphicAssetId: null,
            moveType: "fixed",
            moveSpeed: 4,
            moveFreq: 3,
            optMoveAnim: true,
            optStopAnim: false,
            optDirFix: false,
            optThrough: false,
            optOnTop: false,
            trigger: "action",
            commands,
          },
        ],
      },
    ],
  };
}

describe("authored transition graph", () => {
  it("keeps cross-map passage categories and omits same-map puzzle/recovery jumps", () => {
    const graph = buildAuthoredTransitionGraph([
      bundleMap(MAP_A, [
        { t: "teleport", mapId: MAP_A, col: 2, row: 2, category: "puzzle" },
        { t: "teleport", mapId: MAP_A, col: 1, row: 1, category: "recovery" },
        {
          t: "if",
          cond: { type: "selfSwitch", selfSwitch: "A" },
          then: [{ t: "teleport", mapId: MAP_B, col: 3, row: 4, category: "shortcut" }],
          else: [],
        },
      ]),
      bundleMap(MAP_B, []),
    ]);

    expect(graph.links).toEqual([
      expect.objectContaining({
        sourceMapId: MAP_A,
        destinationMapId: MAP_B,
        sourceName: "Passage",
        category: "shortcut",
      }),
    ]);
    expect([...reachableTransitionMaps(graph, MAP_A)]).toEqual([MAP_A, MAP_B]);
  });
});
