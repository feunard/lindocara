import type { MessageKey } from "@lindocara/engine/i18n/index.js";
import type { PlayerSnapshot } from "@lindocara/engine/protocol.js";
import { DEFAULT_ZONE_ID, type ZoneId } from "@lindocara/engine/zones.js";

export interface InteriorDoor {
  id: string;
  nameKey: MessageKey;
  x: number;
  y: number;
  copyKey: MessageKey;
}

export const INTERIOR_RANGE = 54;
export const INTERIORS: readonly InteriorDoor[] = [
  {
    id: "crossing-hall",
    nameKey: "interior.crossing-hall.name",
    x: 910,
    y: 490,
    copyKey: "interior.crossing-hall.copy",
  },
  {
    id: "lantern-house",
    nameKey: "interior.lantern-house.name",
    x: 1235,
    y: 500,
    copyKey: "interior.lantern-house.copy",
  },
  {
    id: "wayfarer-rest",
    nameKey: "interior.wayfarer-rest.name",
    x: 510,
    y: 1055,
    copyKey: "interior.wayfarer-rest.copy",
  },
  {
    id: "bramblewick-farm",
    nameKey: "interior.bramblewick-farm.name",
    x: 1960,
    y: 2070,
    copyKey: "interior.bramblewick-farm.copy",
  },
] as const;

export function nearestInterior(
  self: PlayerSnapshot | undefined,
  zoneId: ZoneId,
): InteriorDoor | undefined {
  // Every door is a fixed Verdant Reach coordinate. A D1 map (or any other zone) has none, so a blank
  // user map must not sprout a walkable "Look inside Crossing Hall" prompt where those pixels happen
  // to land.
  if (!self || zoneId !== DEFAULT_ZONE_ID) return undefined;
  let nearest: InteriorDoor | undefined;
  let nearestDistance = INTERIOR_RANGE;
  for (const door of INTERIORS) {
    // Verdant Reach's doors are pixel `Vec2` catalogue content whose `y` is a GROUND axis, while
    // `self` is a tile-unit body whose `y` is its ELEVATION — so the two ground axes are `self.z`
    // and `door.y`, and reading `self.y` here would measure a height against a distance. The whole
    // loop is dead on every live room (the guard above refuses any map that is not the compiled
    // default, and no room is ever built from one); the hypotenuse is spelled out rather than
    // borrowed from a ground helper precisely so it cannot be mistaken for a converted call site.
    const distance = Math.hypot(self.x - door.x, self.z - door.y);
    if (distance > nearestDistance) continue;
    nearest = door;
    nearestDistance = distance;
  }
  return nearest;
}
