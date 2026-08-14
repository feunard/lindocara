import { distanceToBuildingCollider } from "@lindocara/engine/buildings.js";
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
        distanceToBuildingCollider(self, building.collider) <= INTERACTION_RANGE,
    )
    .sort(
      (left, right) =>
        distanceToBuildingCollider(self, left.collider) -
        distanceToBuildingCollider(self, right.collider),
    )[0];
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
  if (
    context.worldSize > 0 &&
    context.events.some(
      (event) =>
        event.interactive === true &&
        groundDistance(self, authoredCellCentreGround(event, context.worldSize)) <=
          INTERACTION_RANGE,
    )
  ) {
    return true;
  }
  if (context.corpses.some((corpse) => groundDistance(self, corpse) <= INTERACTION_RANGE)) {
    return true;
  }
  if (nearestInteractiveBuilding(self, context.buildings)) return true;
  return context.camps.some(
    (camp) => camp.expiresAt > context.now && groundDistance(self, camp) <= INTERACTION_RANGE,
  );
}
