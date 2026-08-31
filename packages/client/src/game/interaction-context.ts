import {
  BUILDING_DOOR_INTERACTION_RANGE,
  type BuildingDoorPlacement,
  distanceToBuildingDoor,
} from "@lindocara/engine/buildings.js";
import { INTERACTION_RANGE } from "@lindocara/engine/game.js";
import { groundDistance } from "@lindocara/engine/ground.js";
import { authoredCellCentreGround } from "@lindocara/engine/map-events.js";
import type {
  CorpseSnapshot,
  PeasantCampVisual,
  PlayerSnapshot,
  WorldBuildingSnapshot,
  WorldEventSnapshot,
} from "@lindocara/engine/protocol.js";

const INTERACTIVE_PROMPTS = new Set([
  "prompt.merchant",
  "prompt.look_inside",
  "prompt.swear",
  "prompt.claim",
  "prompt.speak",
  "prompt.quest_site",
  "prompt.enter_building",
  "prompt.interact_event",
]);

export interface InteractionContext {
  self: PlayerSnapshot | undefined;
  worldSize: number;
  events: readonly WorldEventSnapshot[];
  corpses: readonly CorpseSnapshot[];
  camps: readonly PeasantCampVisual[];
  buildings: readonly WorldBuildingSnapshot[];
  promptKey?: string | undefined;
  interiorNearby: boolean;
  interactionOpen: boolean;
  now: number;
}

function doorPlacement(building: WorldBuildingSnapshot): BuildingDoorPlacement {
  return {
    x: building.x,
    z: building.z,
    assetId: building.graphicAssetId,
    ...(building.orientation === undefined ? {} : { orientation: building.orientation }),
    ...(building.rotation === undefined ? {} : { rotation: building.rotation }),
    ...(building.dimensions ? { dimensions: building.dimensions } : {}),
  };
}

export function nearestInteractiveBuilding(
  self: PlayerSnapshot | undefined,
  buildings: readonly WorldBuildingSnapshot[],
): WorldBuildingSnapshot | undefined {
  if (self?.life !== "alive") return undefined;
  return buildings
    .filter(
      (building) =>
        building.interactive &&
        !building.destroyed &&
        distanceToBuildingDoor(self, doorPlacement(building)) <= BUILDING_DOOR_INTERACTION_RANGE,
    )
    .sort(
      (left, right) =>
        distanceToBuildingDoor(self, doorPlacement(left)) -
        distanceToBuildingDoor(self, doorPlacement(right)),
    )[0];
}

/**
 * The nearest authored event whose ACTIVE page takes the interact action, and only within reach.
 *
 * `interactive` is server-selected from that active page, so a decorative or automatic event never
 * qualifies, and the range is the same `INTERACTION_RANGE` the room re-checks when the intent
 * actually arrives. Like everything in this file it decides what to SHOW and never what happens.
 *
 * Nearest rather than first: two events can overlap a hero, and the prompt has to name one of them
 * the same way twice rather than following array order.
 */
export function nearestInteractiveEvent(
  self: PlayerSnapshot | undefined,
  events: readonly WorldEventSnapshot[],
  worldSize: number,
): WorldEventSnapshot | undefined {
  if (self?.life !== "alive" || worldSize <= 0) return undefined;
  let nearest: WorldEventSnapshot | undefined;
  let shortest = INTERACTION_RANGE;
  for (const event of events) {
    // Harvest nodes use the Peasant's contextual basic attack. They never consume the shared
    // interact/jump button, even if an older room snapshot incorrectly advertised the bit.
    if (event.interactive !== true || event.harvest) continue;
    const centre = authoredCellCentreGround(event, worldSize);
    const eventY = event.y ?? centre.y;
    if (Math.abs(self.y - eventY) > 0.85) continue;
    const distance = groundDistance(self, centre);
    if (distance <= shortest) {
      nearest = event;
      shortest = distance;
    }
  }
  return nearest;
}

/**
 * Client-side context for sharing the south face button between jump and interact. This never
 * decides an outcome: the room still rechecks range, page, party, line-of-sight and availability
 * when the interact intent arrives. The wire's `interactive` bit is server-selected from the
 * active authored page, so automatic/decorative events do not steal the jump button.
 */
export function hasNearbyInteraction(context: InteractionContext): boolean {
  const self = context.self;
  if (self?.life !== "alive") return false;
  if (
    context.interactionOpen ||
    context.interiorNearby ||
    (context.promptKey && INTERACTIVE_PROMPTS.has(context.promptKey))
  ) {
    return true;
  }
  if (nearestInteractiveEvent(self, context.events, context.worldSize)) return true;
  if (context.corpses.some((corpse) => groundDistance(self, corpse) <= INTERACTION_RANGE)) {
    return true;
  }
  if (nearestInteractiveBuilding(self, context.buildings)) return true;
  return context.camps.some(
    (camp) => camp.expiresAt > context.now && groundDistance(self, camp) <= INTERACTION_RANGE,
  );
}
