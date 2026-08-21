/**
 * A peaceful character turning hostile, which is a PAGE and not a command.
 *
 * `kind` belongs to the event and no command can change what a thing is, but a page already owns
 * appearance, movement, trigger and program, and page selection already re-derives whenever party
 * state changes. So the wrong answer in a dialogue sets a switch, the switch selects the page, and
 * the guard on that page draws its sword. These are the three projections that have to agree about
 * it, from opposite sides: the monster system includes the character, the guard and appearance
 * systems drop it, and it has exactly one body at any moment.
 */

import {
  EMPTY_ADVENTURE_STATE,
  type PartyAdventureState,
} from "@lindocara/engine/adventure-state.js";
import { defaultEventPage, type MapEvent } from "@lindocara/engine/map-events.js";
import type { EditorAssetId } from "@lindocara/engine/tiny-swords-catalog.js";
import { activeAuthoredGuardDefinitions } from "@lindocara/server/world/authored-guard-system.js";
import { activeAuthoredMonsterDefinitions } from "@lindocara/server/world/authored-monster-system.js";
import { describe, expect, it } from "vitest";

const GRID = 16;
const SWITCH = "0007";
const GRAPHIC = "character.factions-knights-troops-pawn.pawn-blue" as EditorAssetId;

/** A villager with a peaceful page and a hostile one behind a switch. */
function villager(kind: "npc" | "guard" = "npc"): MapEvent {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    col: 4,
    row: 6,
    name: "Couillasse",
    ordinal: 1,
    kind,
    species: null,
    patrolRadius: 96,
    monsterMaxHp: 42,
    monsterDamage: 7,
    pages: [
      { ...defaultEventPage(), graphicAssetId: GRAPHIC, trigger: "action" },
      {
        ...defaultEventPage(),
        condSwitchId: SWITCH,
        graphicAssetId: GRAPHIC,
        trigger: "action",
        optHostile: true,
      },
    ],
  };
}

function stateWith(angry: boolean): PartyAdventureState {
  return angry ? { ...EMPTY_ADVENTURE_STATE, switches: { [SWITCH]: true } } : EMPTY_ADVENTURE_STATE;
}

describe("a page can turn a character hostile", () => {
  it("keeps a villager out of the monster simulation while its peaceful page holds", () => {
    expect(activeAuthoredMonsterDefinitions([villager()], stateWith(false), GRID)).toEqual([]);
  });

  it("projects the same villager as a monster once the hostile page is selected", () => {
    const [monster] = activeAuthoredMonsterDefinitions([villager()], stateWith(true), GRID);
    if (!monster) throw new Error("the hostile page produced no monster");

    expect(monster.id).toBe("mon-11111111-1111-4111-8111-111111111111");
    expect(monster.name).toBe("Couillasse");
    // Its own numbers, the ones the editor showed its author, not a species' defaults.
    expect(monster.maxHp).toBe(42);
    expect(monster.damage).toBe(7);
    // And its own face: the page's graphic, never the fallback species' art.
    expect(monster.graphicAssetId).toBe(GRAPHIC);
  });

  it("takes a hostile guard out of the party's own ranks", () => {
    const guard = villager("guard");
    // Peaceful: an ally, and no monster.
    expect(activeAuthoredGuardDefinitions([guard], stateWith(false), GRID)).toHaveLength(1);
    expect(activeAuthoredMonsterDefinitions([guard], stateWith(false), GRID)).toEqual([]);

    // Hostile: a monster, and NOT an ally. Both halves matter - without the exclusion the same
    // character would stand on the map twice, once fighting for the party and once against it.
    expect(activeAuthoredGuardDefinitions([guard], stateWith(true), GRID)).toEqual([]);
    expect(activeAuthoredMonsterDefinitions([guard], stateWith(true), GRID)).toHaveLength(1);
  });

  it("refuses to arm a kind that carries no combat characteristics", () => {
    const anchor: MapEvent = {
      ...villager(),
      kind: "normal",
      patrolRadius: null,
    };
    expect(activeAuthoredMonsterDefinitions([anchor], stateWith(true), GRID)).toEqual([]);
  });
});
