import type { ZoneBuildingDefinition } from "@lindocara/engine/buildings.js";
import { circleIntersectsArc, type FrontalArc } from "@lindocara/engine/directional-combat.js";
import type { GroundVector } from "@lindocara/engine/ground.js";
import type { WorldBuildingSnapshot } from "@lindocara/engine/protocol.js";

export interface BuildingRuntime extends ZoneBuildingDefinition {
  hp: number;
  destroyed: boolean;
}

export interface BuildingDamageResult {
  actualDamage: number;
  destroyed: boolean;
}

export function createBuildings(
  definitions: readonly ZoneBuildingDefinition[] = [],
): BuildingRuntime[] {
  return definitions.map((definition) => ({
    ...definition,
    collider: { ...definition.collider },
    hp: definition.maxHp,
    destroyed: false,
  }));
}

export function buildingSnapshot(building: BuildingRuntime): WorldBuildingSnapshot {
  return {
    id: building.id,
    x: building.x,
    z: building.z,
    graphicAssetId: building.destroyed ? building.destroyedAssetId : building.standingAssetId,
    destroyedAssetId: building.destroyedAssetId,
    ...(building.orientation ? { orientation: building.orientation } : {}),
    ...(building.dimensions ? { dimensions: building.dimensions } : {}),
    hp: building.hp,
    maxHp: building.maxHp,
    destructible: building.destructible,
    destroyed: building.destroyed,
    interactive: Boolean(building.interiorMapId) && !building.destroyed,
    collider: { ...building.collider },
  };
}

export function damageBuilding(
  building: BuildingRuntime,
  power: number,
): BuildingDamageResult | null {
  if (!building.destructible || building.destroyed) return null;
  const damage = Math.max(1, Math.round(power));
  const actualDamage = Math.min(building.hp, damage);
  building.hp -= actualDamage;
  building.destroyed = building.hp === 0;
  return { actualDamage, destroyed: building.destroyed };
}

function buildingCircle(building: BuildingRuntime): {
  center: GroundVector;
  radius: number;
} {
  const { x, z, w, h } = building.collider;
  return {
    center: { x: x + w / 2, z: z + h / 2 },
    radius: Math.hypot(w, h) / 2,
  };
}

export function buildingIntersectsArc(building: BuildingRuntime, arc: FrontalArc): boolean {
  return !building.destroyed && circleIntersectsArc(buildingCircle(building), arc);
}

export function buildingWithinRadius(
  building: BuildingRuntime,
  center: GroundVector,
  radius: number,
): boolean {
  if (building.destroyed) return false;
  const circle = buildingCircle(building);
  return (
    Math.hypot(circle.center.x - center.x, circle.center.z - center.z) <=
    Math.max(0, radius) + circle.radius
  );
}

/** Locate the solid footprint which stopped a projectile at its swept boundary. */
export function buildingAtImpact(
  buildings: readonly BuildingRuntime[],
  point: GroundVector,
  padding: number,
): BuildingRuntime | null {
  const margin = Math.max(0, padding) + 1e-4;
  return (
    buildings.find((building) => {
      if (building.destroyed) return false;
      const { x, z, w, h } = building.collider;
      return (
        point.x >= x - margin &&
        point.x <= x + w + margin &&
        point.z >= z - margin &&
        point.z <= z + h + margin
      );
    }) ?? null
  );
}
