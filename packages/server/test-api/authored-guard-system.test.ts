import type { PartyAdventureState } from "@lindocara/engine/adventure-state.js";
import { defaultEventPage, functionalEvent, type MapEvent } from "@lindocara/engine/map-events.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import { DEFAULT_GUARD_APPEARANCE_ASSET_ID } from "@lindocara/engine/tiny-swords-catalog.js";
import { describe, expect, it } from "vitest";

import {
  activeAuthoredGuardDefinitions,
  reconcileActiveGuards,
} from "../src/world/authored-guard-system.js";
import { createGuards } from "../src/world/world-runtime.js";

const GUARD_EVENT_ID = "11111111-1111-4111-8111-111111111111";

function state(switches: Record<string, boolean> = {}): PartyAdventureState {
  return { switches, variables: {}, selfSwitches: {} };
}

function conditionalGuard(): MapEvent {
  const event = functionalEvent({
    id: GUARD_EVENT_ID,
    col: 7,
    row: 9,
    ordinal: 1,
    kind: "guard",
    name: "Renforts des Bois",
    patrolRadius: 160,
  });
  return {
    ...event,
    pages: [
      {
        ...defaultEventPage(),
        condSwitchId: "0041",
        graphicAssetId: DEFAULT_GUARD_APPEARANCE_ASSET_ID,
      },
    ],
  };
}

const GRID_SIZE = 32;

describe("authored guard projection", () => {
  it("creates a reinforcement only while its conditional page holds", () => {
    const event = conditionalGuard();

    // Grid size 32: the authored cell (7, 9) becomes (7.5 - 16, 9.5 - 16) in tile units.
    expect(activeAuthoredGuardDefinitions([event], state(), GRID_SIZE)).toEqual([]);
    expect(activeAuthoredGuardDefinitions([event], state({ "0041": true }), GRID_SIZE)).toEqual([
      {
        id: `guard-${GUARD_EVENT_ID}`,
        x: 7.5 - GRID_SIZE / 2,
        y: 0,
        z: 9.5 - GRID_SIZE / 2,
        patrolRadius: 160 / TILE_SIZE,
        graphicAssetId: DEFAULT_GUARD_APPEARANCE_ASSET_ID,
        graphicTint: 0xffffff,
      },
    ]);
  });

  it("preserves live combat state, adds new guards, and drops withdrawn ones", () => {
    const retained = createGuards([
      { id: "retained", x: 64 / TILE_SIZE, y: 0, z: 64 / TILE_SIZE, patrolRadius: 96 / TILE_SIZE },
    ])[0];
    const withdrawn = createGuards([
      {
        id: "withdrawn",
        x: 128 / TILE_SIZE,
        y: 0,
        z: 64 / TILE_SIZE,
        patrolRadius: 96 / TILE_SIZE,
      },
    ])[0];
    if (!retained || !withdrawn) throw new Error("guard fixture creation failed");
    retained.hp = 73;
    retained.x = 80 / TILE_SIZE;

    const next = reconcileActiveGuards(
      [retained, withdrawn],
      [
        {
          id: "retained",
          x: 64 / TILE_SIZE,
          y: 0,
          z: 64 / TILE_SIZE,
          patrolRadius: 144 / TILE_SIZE,
          graphicAssetId: DEFAULT_GUARD_APPEARANCE_ASSET_ID,
        },
        { id: "new", x: 192 / TILE_SIZE, y: 0, z: 64 / TILE_SIZE, patrolRadius: 96 / TILE_SIZE },
      ],
    );

    expect(next.map((guard) => guard.id)).toEqual(["retained", "new"]);
    expect(next[0]).toMatchObject({
      hp: 73,
      x: 80 / TILE_SIZE,
      homeX: 64 / TILE_SIZE,
      homeZ: 64 / TILE_SIZE,
      patrolRadius: 144 / TILE_SIZE,
      graphicAssetId: DEFAULT_GUARD_APPEARANCE_ASSET_ID,
      graphicTint: 0xffffff,
    });
    expect(next[1]).toMatchObject({
      hp: next[1]?.maxHp,
      x: 192 / TILE_SIZE,
      z: 64 / TILE_SIZE,
    });
  });
});
