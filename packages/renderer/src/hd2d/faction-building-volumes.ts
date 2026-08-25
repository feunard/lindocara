import type { BuildingFaction, BuildingVolumeDimensions } from "@lindocara/engine/buildings.js";
import type { FactionBuildingArchetype } from "@lindocara/engine/faction-buildings.js";
import * as THREE from "three";

import { buildBeastfolkBuildingVolume } from "./beastfolk-building-volumes.js";
import { buildGoblinBuildingVolume } from "./goblin-building-volumes.js";
import { buildOrcTrollBuildingVolume } from "./orc-troll-building-volumes.js";
import { buildWildTribeBuildingVolume } from "./wild-tribe-building-volumes.js";

/**
 * Source materials shared by the renderer boundary. Every faction module derives its own textured
 * palette and owns every architectural composition it builds.
 */
export interface FactionBuildingMaterials {
  wall: THREE.Material;
  stone: THREE.Material;
  stoneShade: THREE.Material;
  wood: THREE.Material;
  deck: THREE.Material;
  outline: THREE.Material;
  blue: THREE.Material;
  roof: THREE.Material;
  window: THREE.Material;
  canvas: THREE.Material;
  metal: THREE.Material;
  accent: THREE.Material;
  bone: THREE.Material;
  cloth: THREE.Material;
  foliage: THREE.Material;
  factionPrimary?: THREE.Texture | undefined;
  factionDetail?: THREE.Texture | undefined;
}

type NonHumanFaction = Exclude<BuildingFaction, "human">;

export const FACTION_BUILDING_DESIGN_NAMES = {
  goblin: {
    "housing-a": "crooked-hut",
    "housing-b": "fungus-burrow",
    "command-a": "boss-den",
    "command-b": "scrap-keep",
    "training-a": "stab-yard",
    "training-b": "sling-range",
    "community-a": "feast-shack",
    "community-b": "shaman-hollow",
    "daily-life-a": "tinker-shed",
    "daily-life-b": "scavenger-store",
  },
  "orc-troll": {
    "housing-a": "orc-longhouse",
    "housing-b": "troll-rock-hut",
    "command-a": "warchief-hall",
    "command-b": "skull-fort",
    "training-a": "war-pit",
    "training-b": "boulder-range",
    "community-a": "clan-hearth",
    "community-b": "smoke-lodge",
    "daily-life-a": "war-forge",
    "daily-life-b": "beast-pen",
  },
  beastfolk: {
    "housing-a": "hide-lodge",
    "housing-b": "elevated-nest",
    "command-a": "totem-hall",
    "command-b": "moon-den",
    "training-a": "hunter-ring",
    "training-b": "claw-yard",
    "community-a": "communal-hollow",
    "community-b": "healer-hut",
    "daily-life-a": "tannery",
    "daily-life-b": "gatherer-store",
  },
  "wild-tribe": {
    "housing-a": "reed-hut",
    "housing-b": "hide-tent",
    "command-a": "ancestor-hall",
    "command-b": "bone-tower",
    "training-a": "spear-circle",
    "training-b": "trial-pit",
    "community-a": "fire-lodge",
    "community-b": "spirit-hut",
    "daily-life-a": "drying-house",
    "daily-life-b": "craft-shelter",
  },
} as const satisfies Record<NonHumanFaction, Record<FactionBuildingArchetype, string>>;

export function buildFactionBuildingVolume(
  root: THREE.Group,
  size: BuildingVolumeDimensions,
  materials: FactionBuildingMaterials,
  faction: NonHumanFaction,
  archetype: FactionBuildingArchetype,
): void {
  const design = new THREE.Group();
  design.name = `design-${faction}-${FACTION_BUILDING_DESIGN_NAMES[faction][archetype]}`;
  root.add(design);
  switch (faction) {
    case "goblin":
      buildGoblinBuildingVolume(design, size, materials, archetype);
      break;
    case "orc-troll":
      buildOrcTrollBuildingVolume(design, size, materials, archetype);
      break;
    case "beastfolk":
      buildBeastfolkBuildingVolume(design, size, materials, archetype);
      break;
    case "wild-tribe":
      buildWildTribeBuildingVolume(design, size, materials, archetype);
      break;
  }
}
