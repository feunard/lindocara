import type { Rect } from "@lindocara/engine/game.js";
import { harvestColliderAt } from "@lindocara/engine/harvest.js";
import type { MapEvent } from "@lindocara/engine/map-events.js";

/**
 * Creator tools show a freshly entered map, so every authored resource starts intact. Geometry is
 * projected from the explicit harvest profile shared with the server; artwork is deliberately not
 * consulted.
 */
export function intactHarvestCollider(event: MapEvent): Rect | null {
  if (event.kind !== "harvestable" || !event.harvestProfile) return null;
  return harvestColliderAt(event.harvestProfile, event.col, event.row, "intact");
}

export function intactHarvestColliders(events: readonly MapEvent[]): Rect[] {
  return events.flatMap((event) => {
    const collider = intactHarvestCollider(event);
    return collider ? [collider] : [];
  });
}
