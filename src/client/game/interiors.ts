import { pointDistance } from "../../shared/game.js";
import type { MessageKey } from "../../shared/i18n/index.js";
import type { PlayerSnapshot } from "../../shared/protocol.js";
import { DEFAULT_ZONE_ID, type ZoneId } from "../../shared/zones.js";

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
    const distance = pointDistance(self, door);
    if (distance > nearestDistance) continue;
    nearest = door;
    nearestDistance = distance;
  }
  return nearest;
}
