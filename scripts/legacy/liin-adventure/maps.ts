import type { AdventureBundleMap } from "@lindocara/engine/adventure-bundle.js";
import type { EventCommand, TransitionCategory } from "@lindocara/engine/event-commands.js";
import type { MonsterSpecies, MonsterTuning } from "@lindocara/engine/game.js";
import type { MapElement } from "@lindocara/engine/map-data.js";
import type { MapEventPage } from "@lindocara/engine/map-events.js";
import {
  activity,
  addVar,
  bundleMap,
  cell,
  choice,
  createEventFactory,
  element,
  GRAPHICS,
  ifSwitch,
  ifVariable,
  type MapKey,
  page,
  type StoryRefs,
  safeElements,
  say,
  setVar,
  switchOn,
  teleport,
  terrainLayers,
} from "./campaign.js";

type Factory = ReturnType<typeof createEventFactory>;

const BUILDINGS = {
  blueArchery: "building.buildings-blue-buildings.archery",
  blueCastle: "building.buildings-blue-buildings.castle",
  blueBarracks: "building.buildings-blue-buildings.barracks",
  blueHouse1: "building.buildings-blue-buildings.house1",
  blueHouse2: "building.buildings-blue-buildings.house2",
  blueHouse3: "building.buildings-blue-buildings.house3",
  blueMonastery: "building.buildings-blue-buildings.monastery",
  blueTower: "building.buildings-blue-buildings.tower",
  yellowHouse1: "building.buildings-yellow-buildings.house1",
  yellowHouse2: "building.buildings-yellow-buildings.house2",
  yellowHouse3: "building.buildings-yellow-buildings.house3",
  yellowBarracks: "building.buildings-yellow-buildings.barracks",
  yellowMonastery: "building.buildings-yellow-buildings.monastery",
  yellowTower: "building.buildings-yellow-buildings.tower",
  blackCastle: "building.buildings-black-buildings.castle",
  blackBarracks: "building.buildings-black-buildings.barracks",
  blackHouse1: "building.buildings-black-buildings.house1",
  blackHouse2: "building.buildings-black-buildings.house2",
  blackHouse3: "building.buildings-black-buildings.house3",
  blackTower: "building.buildings-black-buildings.tower",
  redBarracks: "building.buildings-red-buildings.barracks",
  redHouse1: "building.buildings-red-buildings.house1",
  redHouse2: "building.buildings-red-buildings.house2",
  redHouse3: "building.buildings-red-buildings.house3",
  redTower: "building.buildings-red-buildings.tower",
  purpleBarracks: "building.buildings-purple-buildings.barracks",
  purpleMonastery: "building.buildings-purple-buildings.monastery",
  purpleHouse1: "building.buildings-purple-buildings.house1",
  purpleHouse2: "building.buildings-purple-buildings.house2",
  purpleHouse3: "building.buildings-purple-buildings.house3",
  purpleTower: "building.buildings-purple-buildings.tower",
  constructionHouse: "building.factions-knights-buildings-house.house-construction",
  constructionTower: "building.factions-knights-buildings-tower.tower-construction",
  ruinedHouse: "building.factions-knights-buildings-house.house-destroyed",
  ruinedTower: "building.factions-knights-buildings-tower.tower-destroyed",
  ruinedCastle: "building.factions-knights-buildings-castle.castle-destroyed",
  goblinHouse: "building.factions-goblins-buildings-wood-house.goblin-house",
  ruinedGoblinHouse: "building.factions-goblins-buildings-wood-house.goblin-house-destroyed",
  ruinedGoblinTower: "building.factions-goblins-buildings-wood-tower.wood-tower-destroyed",
} as const;

const SCENERY = {
  bridgeHorizontal: "terrain.bridge.wood.horizontal",
  bridgeVertical: "terrain.bridge.wood.vertical",
  tool1: "resource.terrain-resources-tools.tool-01",
  tool2: "resource.terrain-resources-tools.tool-02",
  tool3: "resource.terrain-resources-tools.tool-03",
  tool4: "resource.terrain-resources-tools.tool-04",
  wood: "resource.terrain-resources-wood-wood-resource.wood-resource",
  gold: "resource.terrain-resources-gold-gold-resource.gold-resource",
  meat: "resource.terrain-resources-meat-meat-resource.meat-resource",
  resourceWood: "resource.resources-resources.w-idle",
  resourceGold: "resource.resources-resources.g-idle",
  resourceMeat: "resource.resources-resources.m-idle",
  mushroomSmall: "decoration.deco.01",
  mushroomMedium: "decoration.deco.02",
  mushroomLarge: "decoration.deco.03",
  stoneSmall: "decoration.deco.04",
  stoneMedium: "decoration.deco.05",
  stoneLarge: "decoration.deco.06",
  plantSmall: "decoration.deco.07",
  plantMedium: "decoration.deco.08",
  plantLarge: "decoration.deco.09",
  plantShoot: "decoration.deco.10",
  reeds: "decoration.deco.11",
  pumpkinSingle: "decoration.deco.12",
  pumpkinPatch: "decoration.deco.13",
  boneLarge: "decoration.deco.14",
  boneSmall: "decoration.deco.15",
  memorial: "decoration.deco.16",
  notice: "decoration.deco.17",
  scarecrow: "decoration.deco.18",
  marketRed: "decoration.deco.12",
  marketBlue: "decoration.deco.13",
  bush1: "decoration.terrain-decorations-bushes.bushe1",
  bush2: "decoration.terrain-decorations-bushes.bushe2",
  bush3: "decoration.terrain-decorations-bushes.bushe3",
  bush4: "decoration.terrain-decorations-bushes.bushe4",
  rock1: "decoration.terrain-decorations-rocks.rock1",
  rock2: "decoration.terrain-decorations-rocks.rock2",
  rock3: "decoration.terrain-decorations-rocks.rock3",
  rock4: "decoration.terrain-decorations-rocks.rock4",
  waterRock1: "decoration.terrain-decorations-rocks-in-the-water.water-rocks-01",
  waterRock2: "decoration.terrain-decorations-rocks-in-the-water.water-rocks-02",
  waterRock3: "decoration.terrain-decorations-rocks-in-the-water.water-rocks-03",
  waterRock4: "decoration.terrain-decorations-rocks-in-the-water.water-rocks-04",
  waterOutcrop1: "terrain.terrain-water-rocks.rocks-01",
  waterOutcrop2: "terrain.terrain-water-rocks.rocks-02",
  waterOutcrop3: "terrain.terrain-water-rocks.rocks-03",
  waterOutcrop4: "terrain.terrain-water-rocks.rocks-04",
  waterSplash: "effect.particle-fx.water-splash",
  duck: "decoration.terrain-decorations-rubber-duck.rubber-duck",
  tree1: "resource.terrain-resources-wood-trees.tree1",
  tree2: "resource.terrain-resources-wood-trees.tree2",
  tree3: "resource.terrain-resources-wood-trees.tree3",
  tree4: "resource.terrain-resources-wood-trees.tree4",
  stump1: "resource.terrain-resources-wood-trees.stump-1",
  stump2: "resource.terrain-resources-wood-trees.stump-2",
  stump3: "resource.terrain-resources-wood-trees.stump-3",
  stump4: "resource.terrain-resources-wood-trees.stump-4",
  goldStone1: "resource.terrain-resources-gold-gold-stones.gold-stone-1",
  goldStone2: "resource.terrain-resources-gold-gold-stones.gold-stone-2",
  goldStone3: "resource.terrain-resources-gold-gold-stones.gold-stone-3",
  goldStone4: "resource.terrain-resources-gold-gold-stones.gold-stone-4",
  goldStone5: "resource.terrain-resources-gold-gold-stones.gold-stone-5",
  goldStone6: "resource.terrain-resources-gold-gold-stones.gold-stone-6",
  cloud1: "decoration.terrain-decorations-clouds.clouds-01",
  cloud2: "decoration.terrain-decorations-clouds.clouds-02",
  cloud3: "decoration.terrain-decorations-clouds.clouds-03",
  cloud4: "decoration.terrain-decorations-clouds.clouds-04",
  cloud5: "decoration.terrain-decorations-clouds.clouds-05",
  cloud6: "decoration.terrain-decorations-clouds.clouds-06",
  cloud7: "decoration.terrain-decorations-clouds.clouds-07",
  cloud8: "decoration.terrain-decorations-clouds.clouds-08",
} as const;

const REGIONAL_COMPOSITIONS: Readonly<Partial<Record<MapKey, readonly MapElement[]>>> = {
  prologue: [
    element(SCENERY.tree1, 6, 8),
    element(SCENERY.tree2, 12, 7),
    element(SCENERY.stump1, 15, 31),
    element(SCENERY.wood, 18, 33),
    element(SCENERY.tool2, 13, 30),
    element(SCENERY.rock1, 21, 8),
    element(SCENERY.rock4, 34, 36),
    element(SCENERY.bush2, 38, 34),
    element(SCENERY.tree4, 53, 25),
  ],
  faubourg: [
    element(BUILDINGS.redHouse1, 8, 34),
    element(BUILDINGS.redHouse2, 15, 36),
    element(BUILDINGS.constructionHouse, 24, 34),
    element(BUILDINGS.redBarracks, 34, 9),
    element(BUILDINGS.redTower, 55, 18),
    element(SCENERY.wood, 12, 28),
    element(SCENERY.wood, 16, 29),
    element(SCENERY.tool1, 21, 31),
    element(SCENERY.tool3, 24, 30),
    element(SCENERY.bridgeHorizontal, 28, 18),
    element(SCENERY.rock2, 48, 24),
  ],
  relay: [
    element(BUILDINGS.blueHouse1, 9, 31),
    element(BUILDINGS.yellowHouse1, 18, 34),
    element(BUILDINGS.purpleHouse1, 36, 31),
    element(BUILDINGS.blackHouse1, 48, 26),
    element(BUILDINGS.yellowTower, 53, 12),
    element(SCENERY.gold, 17, 18),
    element(SCENERY.meat, 25, 18),
    element(SCENERY.wood, 33, 20),
    element(SCENERY.tool2, 40, 20),
    element(SCENERY.tree2, 7, 8),
    element(SCENERY.tree4, 52, 35),
  ],
  woods: [
    // Sève settlement and nourishing grove.
    element(BUILDINGS.yellowHouse1, 8, 30),
    element(BUILDINGS.yellowHouse2, 13, 27),
    element(BUILDINGS.yellowTower, 18, 24),
    element(SCENERY.tree1, 5, 8),
    element(SCENERY.tree2, 10, 10),
    element(SCENERY.tree3, 16, 8),
    element(SCENERY.tree4, 21, 12),
    element(SCENERY.bush1, 12, 20),
    element(SCENERY.bush3, 18, 19),
    // Écorce settlement and managed cutting ground.
    element(BUILDINGS.purpleHouse1, 39, 35),
    element(BUILDINGS.purpleHouse2, 47, 34),
    element(BUILDINGS.purpleTower, 53, 29),
    element(SCENERY.tree4, 35, 7),
    element(SCENERY.tree3, 42, 6),
    element(SCENERY.stump1, 31, 25),
    element(SCENERY.stump2, 34, 27),
    element(SCENERY.stump3, 37, 26),
    element(SCENERY.wood, 40, 28),
    element(SCENERY.tool4, 43, 28),
    // The old road stays visible between both territories.
    element(SCENERY.rock1, 27, 31),
    element(SCENERY.rock3, 30, 34),
    // Dense perimeter groves leave the old road and both settlements as readable clearings.
    element(SCENERY.tree2, 4, 5),
    element(SCENERY.tree1, 9, 4),
    element(SCENERY.tree4, 14, 5),
    element(SCENERY.tree3, 19, 4),
    element(SCENERY.tree2, 24, 6),
    element(SCENERY.tree1, 29, 4),
    element(SCENERY.tree4, 52, 5),
    element(SCENERY.tree3, 56, 8),
    element(SCENERY.tree1, 4, 14),
    element(SCENERY.tree2, 5, 20),
    element(SCENERY.tree4, 7, 25),
    element(SCENERY.tree3, 4, 31),
    element(SCENERY.tree2, 9, 39),
    element(SCENERY.tree4, 20, 18),
    element(SCENERY.tree1, 23, 17),
    element(SCENERY.tree3, 29, 10),
    element(SCENERY.tree2, 30, 17),
    element(SCENERY.tree4, 54, 14),
    element(SCENERY.tree1, 55, 20),
    element(SCENERY.tree3, 52, 26),
    element(SCENERY.tree2, 56, 31),
    element(SCENERY.tree4, 54, 39),
    element(SCENERY.tree1, 14, 41),
    element(SCENERY.tree3, 21, 40),
    element(SCENERY.tree2, 27, 41),
    element(SCENERY.tree4, 34, 40),
    element(SCENERY.tree1, 42, 41),
    element(SCENERY.tree3, 48, 40),
    // Layered tree walls shape two clearings and leave the central old road readable.
    element(SCENERY.tree1, 3, 3),
    element(SCENERY.tree3, 7, 3),
    element(SCENERY.tree2, 12, 2),
    element(SCENERY.tree4, 17, 3),
    element(SCENERY.tree1, 22, 2),
    element(SCENERY.tree3, 27, 4),
    element(SCENERY.tree2, 33, 2),
    element(SCENERY.tree4, 38, 3),
    element(SCENERY.tree1, 44, 2),
    element(SCENERY.tree3, 49, 3),
    element(SCENERY.tree2, 55, 2),
    element(SCENERY.tree4, 58, 6),
    element(SCENERY.tree3, 3, 10),
    element(SCENERY.tree1, 3, 18),
    element(SCENERY.tree4, 3, 26),
    element(SCENERY.tree2, 3, 36),
    element(SCENERY.tree1, 58, 13),
    element(SCENERY.tree3, 58, 22),
    element(SCENERY.tree4, 58, 29),
    element(SCENERY.tree2, 58, 37),
    element(SCENERY.tree4, 6, 13),
    element(SCENERY.tree2, 10, 15),
    element(SCENERY.tree1, 15, 14),
    element(SCENERY.tree3, 19, 16),
    element(SCENERY.tree4, 7, 20),
    element(SCENERY.tree2, 12, 23),
    element(SCENERY.tree1, 18, 22),
    element(SCENERY.tree3, 22, 20),
    element(SCENERY.tree2, 37, 11),
    element(SCENERY.tree4, 42, 12),
    element(SCENERY.tree1, 47, 14),
    element(SCENERY.tree3, 52, 17),
    element(SCENERY.tree2, 39, 20),
    element(SCENERY.tree4, 45, 22),
    element(SCENERY.tree1, 51, 24),
    element(SCENERY.tree3, 23, 35),
    element(SCENERY.tree1, 29, 38),
    element(SCENERY.tree4, 35, 35),
    element(SCENERY.tree2, 40, 37),
    element(SCENERY.bridgeVertical, 9, 10),
    element(SCENERY.bridgeVertical, 30, 27),
  ],
  roots: [
    element(BUILDINGS.yellowMonastery, 11, 31),
    element(BUILDINGS.purpleMonastery, 52, 20),
    element(SCENERY.tree4, 6, 8),
    element(SCENERY.tree3, 14, 8),
    element(SCENERY.tree1, 25, 7),
    element(SCENERY.tree2, 52, 20),
    element(SCENERY.memorial, 28, 28),
    element(SCENERY.bridgeVertical, 29, 20),
    element(SCENERY.rock4, 48, 32),
  ],
  marsh: [
    element(BUILDINGS.ruinedHouse, 22, 35),
    element(BUILDINGS.ruinedHouse, 38, 34),
    element(BUILDINGS.ruinedTower, 52, 14),
    element(SCENERY.bridgeVertical, 28, 8),
    element(SCENERY.bridgeVertical, 17, 21),
    element(SCENERY.bridgeVertical, 44, 20),
    element(SCENERY.bridgeVertical, 29, 32),
    element(SCENERY.waterRock1, 7, 9),
    element(SCENERY.waterRock2, 38, 9),
    element(SCENERY.tree3, 6, 17),
    element(SCENERY.tree4, 31, 28),
    element(SCENERY.tree3, 53, 29),
    element(SCENERY.reeds, 10, 24),
    element(SCENERY.reeds, 36, 22),
  ],
  archives: [
    element(BUILDINGS.ruinedHouse, 8, 32),
    element(BUILDINGS.ruinedHouse, 19, 35),
    element(BUILDINGS.blackHouse3, 31, 31),
    element(BUILDINGS.purpleHouse3, 47, 33),
    element(SCENERY.bridgeHorizontal, 21, 29),
    element(SCENERY.bridgeHorizontal, 36, 19),
    element(SCENERY.bridgeHorizontal, 46, 26),
    element(SCENERY.waterRock1, 22, 12),
    element(SCENERY.waterRock2, 38, 30),
  ],
  citadel: [
    element(BUILDINGS.blueTower, 5, 15),
    element(BUILDINGS.blueBarracks, 13, 13),
    element(BUILDINGS.redBarracks, 24, 29),
    element(BUILDINGS.redHouse1, 31, 34),
    element(BUILDINGS.blackBarracks, 41, 28),
    element(BUILDINGS.blackHouse1, 48, 31),
    element(BUILDINGS.blackTower, 55, 13),
    element(SCENERY.tool1, 17, 34),
    element(SCENERY.tool2, 35, 33),
    element(SCENERY.gold, 38, 30),
    element(SCENERY.meat, 45, 30),
    element(BUILDINGS.blueHouse3, 16, 8),
    element(BUILDINGS.blueHouse1, 7, 38),
    element(BUILDINGS.blueHouse2, 15, 40),
    element(BUILDINGS.redHouse2, 24, 39),
    element(BUILDINGS.redTower, 32, 40),
    element(BUILDINGS.blackHouse2, 42, 40),
    element(BUILDINGS.blackHouse3, 50, 39),
    // Visible gateways over the defensive channels.
    element(SCENERY.bridgeVertical, 11, 18),
    element(SCENERY.bridgeVertical, 30, 18),
    element(SCENERY.bridgeVertical, 49, 18),
    element(SCENERY.bridgeHorizontal, 19, 12),
    element(SCENERY.bridgeHorizontal, 38, 31),
    // Blue outer court: gatehouse, archery yard and quarters.
    element(BUILDINGS.blueTower, 5, 6),
    element(BUILDINGS.blueTower, 16, 6),
    element(BUILDINGS.blueArchery, 10, 22),
    element(BUILDINGS.blueHouse2, 6, 24),
    element(BUILDINGS.blueHouse3, 16, 24),
    // Red conscript court around the infirmary and stores.
    element(BUILDINGS.redTower, 21, 27),
    element(BUILDINGS.redHouse2, 23, 35),
    element(BUILDINGS.redHouse3, 32, 36),
    element(SCENERY.meat, 27, 32),
    element(SCENERY.wood, 34, 31),
    // Black inner court and raised command keep.
    element(BUILDINGS.blackTower, 41, 23),
    element(BUILDINGS.blackHouse3, 52, 35),
    element(BUILDINGS.blackCastle, 49, 9),
    element(BUILDINGS.constructionTower, 40, 12),
    element(BUILDINGS.constructionTower, 56, 12),
    element(SCENERY.gold, 46, 31),
  ],
  fort: [
    element(BUILDINGS.blackTower, 5, 32),
    element(BUILDINGS.blackBarracks, 12, 30),
    element(BUILDINGS.blackHouse3, 23, 35),
    element(BUILDINGS.blueHouse1, 31, 34),
    element(BUILDINGS.redHouse1, 40, 34),
    element(BUILDINGS.blackTower, 54, 12),
    element(SCENERY.meat, 16, 28),
    element(SCENERY.wood, 24, 29),
    element(SCENERY.gold, 33, 29),
    element(SCENERY.tool3, 42, 29),
  ],
  sanctuary: [
    element(BUILDINGS.yellowHouse1, 8, 31),
    element(BUILDINGS.yellowHouse2, 17, 32),
    element(BUILDINGS.yellowMonastery, 28, 31),
    element(BUILDINGS.purpleMonastery, 44, 13),
    element(SCENERY.tree1, 7, 9),
    element(SCENERY.tree2, 12, 10),
    element(SCENERY.tree3, 17, 9),
    element(SCENERY.meat, 20, 17),
    element(SCENERY.gold, 25, 18),
    element(SCENERY.tool2, 31, 29),
    element(SCENERY.memorial, 38, 30),
  ],
  crypt: [
    element(BUILDINGS.ruinedTower, 8, 31),
    element(BUILDINGS.blackHouse1, 27, 28),
    element(BUILDINGS.blackTower, 52, 15),
    element(SCENERY.memorial, 10, 14),
    element(SCENERY.memorial, 25, 12),
    element(SCENERY.memorial, 39, 18),
    element(SCENERY.rock2, 18, 8),
    element(SCENERY.rock4, 45, 31),
  ],
  war: [
    element(BUILDINGS.ruinedTower, 8, 30),
    element(BUILDINGS.ruinedHouse, 14, 34),
    element(BUILDINGS.constructionTower, 24, 32),
    element(BUILDINGS.ruinedCastle, 31, 18),
    element(BUILDINGS.ruinedHouse, 40, 33),
    element(BUILDINGS.ruinedTower, 51, 29),
    element(SCENERY.wood, 17, 25),
    element(SCENERY.tool1, 22, 27),
    element(SCENERY.tool4, 37, 26),
    element(SCENERY.rock1, 12, 11),
    element(SCENERY.rock4, 48, 11),
  ],
  galleries: [
    element(BUILDINGS.ruinedHouse, 8, 33),
    element(BUILDINGS.blackHouse2, 24, 34),
    element(BUILDINGS.blackTower, 48, 13),
    element(SCENERY.tool1, 13, 29),
    element(SCENERY.tool2, 24, 28),
    element(SCENERY.tool3, 34, 30),
    element(SCENERY.gold, 39, 26),
    element(SCENERY.rock2, 9, 11),
    element(SCENERY.rock4, 28, 9),
  ],
  heart: [
    element(BUILDINGS.ruinedCastle, 26, 31),
    element(BUILDINGS.blackTower, 51, 15),
    element(SCENERY.memorial, 13, 28),
    element(SCENERY.memorial, 24, 24),
    element(SCENERY.memorial, 38, 30),
    element(SCENERY.rock1, 8, 10),
    element(SCENERY.rock4, 45, 30),
  ],
  epilogue: [
    element(BUILDINGS.yellowHouse2, 8, 32),
    element(BUILDINGS.blueHouse2, 30, 36),
    element(BUILDINGS.purpleHouse1, 27, 33),
    element(BUILDINGS.redHouse1, 38, 32),
    element(SCENERY.tree1, 6, 9),
    element(SCENERY.tree2, 14, 9),
    element(SCENERY.tree3, 40, 10),
    element(SCENERY.meat, 18, 29),
    element(SCENERY.wood, 23, 30),
    element(SCENERY.gold, 28, 29),
  ],
};

/**
 * Hand-authored secondary compositions. Each group supports a readable local function; this is
 * intentionally data per region rather than a coordinate scatter shared by every map.
 */
const REGIONAL_DETAIL_COMPOSITIONS: Readonly<Partial<Record<MapKey, readonly MapElement[]>>> = {
  prologue: [
    // Northern lookout grove and the high-path reward approach.
    element(SCENERY.tree3, 39, 5),
    element(SCENERY.tree1, 46, 6),
    element(SCENERY.bush1, 41, 9),
    element(SCENERY.bush4, 45, 10),
    element(SCENERY.rock2, 49, 8),
    element(SCENERY.cloud1, 41, 7),
    // Trampled verge and dropped supplies make the attacked convoy a worked scene.
    element(SCENERY.mushroomSmall, 10, 31),
    element(SCENERY.mushroomMedium, 15, 33),
    element(SCENERY.plantLarge, 19, 31),
    element(SCENERY.meat, 22, 34),
    element(SCENERY.tool1, 16, 28),
    element(SCENERY.wood, 24, 30),
    element(SCENERY.stump4, 26, 28),
    // Roadside copses frame the danger pockets while leaving the road visible.
    element(SCENERY.tree2, 5, 16),
    element(SCENERY.tree4, 10, 18),
    element(SCENERY.bush2, 13, 20),
    element(SCENERY.tree1, 45, 21),
    element(SCENERY.tree3, 52, 24),
    element(SCENERY.bush3, 49, 27),
    element(SCENERY.rock3, 35, 25),
    element(SCENERY.rock1, 23, 13),
  ],
  aubeval: [
    // Market produce, public notices and the provisioning lane.
    element(SCENERY.pumpkinPatch, 17, 31),
    element(SCENERY.pumpkinSingle, 20, 31, 2, 0),
    element(SCENERY.plantSmall, 23, 31, 1, 1),
    element(SCENERY.plantMedium, 26, 31, 3, 0),
    element(SCENERY.resourceMeat, 30, 33),
    element(SCENERY.resourceWood, 34, 33),
    element(SCENERY.meat, 37, 34),
    element(SCENERY.wood, 40, 34),
    // Rich northern gardens contrast with the flooded lower quarter.
    element(SCENERY.tree1, 9, 8),
    element(SCENERY.tree2, 15, 7),
    element(SCENERY.bush1, 12, 11),
    element(SCENERY.bush3, 18, 11),
    element(SCENERY.tree4, 42, 8),
    element(SCENERY.bush4, 46, 11),
    element(SCENERY.cloud2, 17, 6),
    // Dike maintenance yard and low-quarter salvage.
    element(SCENERY.tool4, 47, 26),
    element(SCENERY.tool2, 51, 27),
    element(SCENERY.stump2, 45, 30),
    element(SCENERY.reeds, 8, 36),
    element(SCENERY.pumpkinSingle, 12, 37),
    element(SCENERY.rock4, 50, 34),
  ],
  faubourg: [
    // Refugee lane and requisition yard.
    element(SCENERY.pumpkinSingle, 7, 31, 1, 0),
    element(SCENERY.pumpkinPatch, 11, 30),
    element(SCENERY.stoneSmall, 15, 31, 3, 1),
    element(SCENERY.plantLarge, 19, 33),
    element(SCENERY.meat, 22, 33),
    element(SCENERY.wood, 27, 32),
    element(SCENERY.tool2, 30, 31),
    // Burned orchard around the raider camp.
    element(SCENERY.tree1, 7, 8),
    element(SCENERY.stump1, 12, 10),
    element(SCENERY.stump3, 17, 8),
    element(SCENERY.tree3, 22, 11),
    element(SCENERY.bush2, 10, 15),
    element(SCENERY.rock1, 18, 15),
    element(BUILDINGS.ruinedGoblinHouse, 38, 12),
    element(SCENERY.cloud3, 42, 7),
    // Fortified approach and wreckage funnel the eastern fight.
    element(BUILDINGS.ruinedGoblinTower, 45, 19),
    element(SCENERY.stoneLarge, 39, 25),
    element(SCENERY.plantSmall, 43, 26),
    element(SCENERY.rock3, 48, 29),
    element(SCENERY.bush4, 51, 32),
  ],
  relay: [
    // Four-camp supply court.
    element(SCENERY.pumpkinPatch, 14, 26),
    element(SCENERY.pumpkinSingle, 19, 26, 2, 1),
    element(SCENERY.resourceMeat, 24, 27),
    element(SCENERY.resourceWood, 29, 27),
    element(SCENERY.plantLarge, 34, 26),
    element(SCENERY.plantShoot, 39, 27),
    element(SCENERY.tool1, 18, 22),
    element(SCENERY.tool3, 37, 22),
    // Road orchards and a sheltered travellers' edge.
    element(SCENERY.tree1, 6, 12),
    element(SCENERY.tree3, 11, 14),
    element(SCENERY.tree2, 48, 10),
    element(SCENERY.tree4, 53, 15),
    element(SCENERY.bush1, 8, 18),
    element(SCENERY.bush3, 50, 20),
    element(SCENERY.rock2, 26, 10),
    element(SCENERY.cloud4, 29, 6),
    element(SCENERY.stump4, 44, 30),
    element(SCENERY.wood, 47, 31),
  ],
  woods: [
    // Ground vegetation thickens the nourishing grove without closing its paths.
    element(SCENERY.bush1, 7, 11, 1, 0),
    element(SCENERY.bush2, 11, 13, 2, 1),
    element(SCENERY.bush3, 16, 16, 0, 2),
    element(SCENERY.bush4, 21, 10, 3, 1),
    element(SCENERY.bush2, 24, 25, 1, 2),
    element(SCENERY.bush1, 29, 29, 2, 0),
    // The logging frontier gains tools, marked stumps and stored timber.
    element(SCENERY.stump4, 34, 24),
    element(SCENERY.stump1, 38, 25),
    element(SCENERY.stump2, 42, 27),
    element(SCENERY.tool1, 36, 29),
    element(SCENERY.tool3, 41, 30),
    element(SCENERY.wood, 46, 29),
    element(SCENERY.reeds, 49, 27),
    element(SCENERY.scarecrow, 52, 31),
    // Two high cloud banks make the canopy region distinct at a glance.
    element(SCENERY.cloud5, 16, 7),
    element(SCENERY.cloud6, 45, 9),
  ],
  roots: [
    // Ringed sacred grove around the ritual halls.
    element(SCENERY.tree1, 5, 13),
    element(SCENERY.tree2, 9, 18),
    element(SCENERY.tree3, 7, 25),
    element(SCENERY.tree4, 16, 10),
    element(SCENERY.tree2, 22, 12),
    element(SCENERY.tree1, 38, 10),
    element(SCENERY.tree3, 47, 13),
    element(SCENERY.tree4, 53, 25),
    element(SCENERY.bush1, 13, 19),
    element(SCENERY.bush2, 21, 24),
    element(SCENERY.bush3, 39, 24),
    element(SCENERY.bush4, 47, 29),
    // Offerings and stones mark the three ritual stages.
    element(SCENERY.plantSmall, 20, 29),
    element(SCENERY.plantMedium, 29, 26),
    element(SCENERY.plantShoot, 38, 29),
    element(SCENERY.rock1, 24, 16),
    element(SCENERY.rock2, 29, 15),
    element(SCENERY.rock3, 34, 16),
    element(SCENERY.cloud7, 30, 7),
  ],
  marsh: [
    // Drowned village remnants on separate islands.
    element(BUILDINGS.ruinedHouse, 9, 16),
    element(BUILDINGS.ruinedHouse, 47, 25),
    element(BUILDINGS.ruinedGoblinHouse, 28, 13),
    element(SCENERY.mushroomSmall, 13, 31),
    element(SCENERY.mushroomMedium, 24, 34),
    element(SCENERY.reeds, 41, 30),
    // Water channels carry recognisable navigation marks.
    element(SCENERY.waterRock3, 15, 8),
    element(SCENERY.waterRock4, 47, 9),
    element(SCENERY.waterRock1, 9, 22),
    element(SCENERY.waterRock2, 51, 20),
    element(SCENERY.duck, 33, 17),
    element(SCENERY.reeds, 14, 25),
    element(SCENERY.reeds, 22, 18),
    element(SCENERY.reeds, 43, 16),
    element(SCENERY.reeds, 49, 29),
    // Wind-broken trees define the safer high islands.
    element(SCENERY.tree1, 7, 31),
    element(SCENERY.tree2, 20, 29),
    element(SCENERY.tree4, 39, 31),
    element(SCENERY.stump2, 50, 33),
    element(SCENERY.cloud8, 31, 7),
  ],
  archives: [
    // Broken reading halls, shelves and recovered stores.
    element(BUILDINGS.ruinedHouse, 12, 19),
    element(BUILDINGS.ruinedHouse, 42, 17),
    element(SCENERY.mushroomLarge, 10, 29),
    element(SCENERY.stoneSmall, 15, 28),
    element(SCENERY.stoneMedium, 20, 27),
    element(SCENERY.stoneLarge, 26, 29),
    element(SCENERY.plantSmall, 33, 28),
    element(SCENERY.plantMedium, 40, 29),
    element(SCENERY.plantLarge, 47, 29),
    // Chronology chambers use stone and metal deposits as repeated wayfinding.
    element(SCENERY.rock1, 8, 12),
    element(SCENERY.rock2, 17, 14),
    element(SCENERY.rock3, 28, 11),
    element(SCENERY.rock4, 42, 13),
    element(SCENERY.goldStone1, 13, 20),
    element(SCENERY.goldStone3, 31, 20),
    element(SCENERY.goldStone5, 46, 21),
    element(SCENERY.tool1, 21, 34),
    element(SCENERY.tool4, 39, 34),
  ],
  citadel: [
    // Outer court drill ground and guard supply line.
    element(SCENERY.stoneSmall, 7, 29, 1, 1),
    element(SCENERY.stoneMedium, 11, 29, 2, 0),
    element(SCENERY.stoneLarge, 15, 30),
    element(SCENERY.tool3, 18, 27),
    element(SCENERY.wood, 21, 28),
    // Conscript court infirmary and ration stores.
    element(SCENERY.pumpkinSingle, 25, 30, 2, 1),
    element(SCENERY.pumpkinPatch, 29, 31),
    element(SCENERY.resourceMeat, 33, 30),
    element(SCENERY.meat, 36, 29),
    element(SCENERY.tool2, 28, 26),
    // Inner command court reserves and captured records.
    element(SCENERY.boneLarge, 42, 29, 1, 0),
    element(SCENERY.boneSmall, 46, 29, 3, 1),
    element(SCENERY.stoneSmall, 50, 30, 2, 2),
    element(SCENERY.gold, 53, 28),
    element(BUILDINGS.blackTower, 57, 22),
  ],
  fort: [
    // Barracks yard with visible stores and maintenance.
    element(SCENERY.stoneSmall, 8, 27, 1, 1),
    element(SCENERY.stoneMedium, 12, 27, 3, 0),
    element(SCENERY.stoneMedium, 16, 25),
    element(SCENERY.pumpkinPatch, 20, 27),
    element(SCENERY.tool1, 24, 26),
    element(SCENERY.tool4, 28, 26),
    element(SCENERY.wood, 32, 27),
    element(SCENERY.meat, 36, 27),
    // Two defended wall sectors and the archive approach.
    element(BUILDINGS.blackTower, 6, 11),
    element(BUILDINGS.blackTower, 18, 10),
    element(BUILDINGS.redTower, 40, 11),
    element(SCENERY.stoneLarge, 42, 23),
    element(SCENERY.plantSmall, 47, 24),
    element(SCENERY.goldStone2, 35, 20),
    element(SCENERY.goldStone4, 39, 21),
    element(SCENERY.rock1, 7, 34),
    element(SCENERY.rock3, 49, 34),
  ],
  sanctuary: [
    // Food and medicine garden around the public dispensary.
    element(SCENERY.tree1, 6, 14),
    element(SCENERY.tree2, 11, 16),
    element(SCENERY.tree3, 17, 14),
    element(SCENERY.bush1, 8, 20),
    element(SCENERY.bush2, 13, 21),
    element(SCENERY.bush3, 18, 20),
    element(SCENERY.meat, 22, 23),
    element(SCENERY.mushroomLarge, 10, 28),
    element(SCENERY.stoneSmall, 15, 28),
    // Lumen works and the monastery service court.
    element(SCENERY.goldStone1, 29, 18),
    element(SCENERY.goldStone2, 32, 18),
    element(SCENERY.goldStone5, 35, 18),
    element(SCENERY.tool1, 31, 23),
    element(SCENERY.tool3, 36, 24),
    element(SCENERY.plantSmall, 40, 27),
    element(SCENERY.plantMedium, 45, 28),
    element(SCENERY.tree4, 50, 17),
    element(SCENERY.bush4, 48, 23),
    element(SCENERY.cloud2, 29, 7),
  ],
  crypt: [
    // Funeral avenue and collapsed side chapels.
    element(SCENERY.memorial, 8, 20),
    element(SCENERY.memorial, 15, 18),
    element(SCENERY.memorial, 22, 20),
    element(SCENERY.memorial, 31, 18),
    element(SCENERY.memorial, 39, 20),
    element(BUILDINGS.ruinedHouse, 12, 30),
    element(BUILDINGS.ruinedHouse, 43, 30),
    element(SCENERY.mushroomSmall, 18, 28),
    element(SCENERY.mushroomMedium, 23, 28),
    element(SCENERY.stoneLarge, 34, 28),
    element(SCENERY.plantLarge, 39, 29),
    // Rock falls divide combat rooms without pretending to be walls.
    element(SCENERY.rock1, 8, 8),
    element(SCENERY.rock2, 14, 10),
    element(SCENERY.rock3, 22, 8),
    element(SCENERY.rock4, 34, 9),
    element(SCENERY.rock2, 42, 11),
    element(SCENERY.goldStone3, 26, 14),
    element(SCENERY.goldStone6, 30, 14),
  ],
  war: [
    // Western field hospital and broken supply lane.
    element(SCENERY.plantSmall, 7, 28, 1, 0),
    element(SCENERY.plantMedium, 11, 29, 2, 1),
    element(SCENERY.pumpkinSingle, 15, 28, 3, 0),
    element(SCENERY.meat, 19, 29),
    element(SCENERY.wood, 23, 28),
    element(SCENERY.tool2, 17, 24),
    // Central barricade is visibly fought over.
    element(BUILDINGS.ruinedGoblinHouse, 25, 23),
    element(BUILDINGS.ruinedGoblinTower, 30, 12),
    element(SCENERY.boneLarge, 27, 27, 1, 1),
    element(SCENERY.boneSmall, 31, 26, 3, 0),
    element(SCENERY.memorial, 35, 27),
    element(SCENERY.rock2, 28, 31),
    element(SCENERY.rock3, 34, 31),
    // Eastern siege reserve and scorched grove.
    element(SCENERY.plantLarge, 40, 28),
    element(SCENERY.plantShoot, 44, 28),
    element(SCENERY.tool4, 48, 27),
    element(SCENERY.stump1, 42, 10),
    element(SCENERY.stump2, 47, 9),
    element(SCENERY.stump4, 52, 11),
    element(SCENERY.tree3, 55, 15),
    element(SCENERY.cloud3, 31, 6),
  ],
  galleries: [
    // Extraction workshops at the lower gallery.
    element(SCENERY.tool4, 8, 29),
    element(SCENERY.tool1, 12, 27),
    element(SCENERY.mushroomSmall, 16, 30),
    element(SCENERY.mushroomMedium, 20, 29),
    element(SCENERY.wood, 24, 30),
    element(SCENERY.plantLarge, 29, 29),
    // Mineral seams guide the optional upper route.
    element(SCENERY.goldStone1, 8, 13),
    element(SCENERY.goldStone2, 13, 11),
    element(SCENERY.goldStone3, 19, 13),
    element(SCENERY.goldStone4, 27, 10),
    element(SCENERY.goldStone5, 35, 12),
    element(SCENERY.goldStone6, 44, 10),
    element(SCENERY.gold, 48, 16),
    // Cave-ins create readable rooms around the hostile line.
    element(SCENERY.rock1, 10, 20),
    element(SCENERY.rock2, 18, 22),
    element(SCENERY.rock3, 31, 20),
    element(SCENERY.rock4, 43, 22),
    element(BUILDINGS.ruinedHouse, 39, 31),
  ],
  heart: [
    // Six witness stations ring the decision floor.
    element(SCENERY.memorial, 8, 22),
    element(SCENERY.memorial, 16, 18),
    element(SCENERY.memorial, 23, 15),
    element(SCENERY.memorial, 33, 15),
    element(SCENERY.memorial, 41, 18),
    element(SCENERY.memorial, 49, 22),
    element(SCENERY.stoneMedium, 13, 29),
    element(SCENERY.stoneLarge, 20, 27),
    element(SCENERY.plantSmall, 29, 25),
    element(SCENERY.plantMedium, 38, 27),
    element(SCENERY.plantLarge, 45, 29),
    // Fractured source deposits identify the dangerous inner ring.
    element(SCENERY.goldStone1, 19, 11),
    element(SCENERY.goldStone2, 24, 9),
    element(SCENERY.goldStone3, 29, 8),
    element(SCENERY.goldStone4, 34, 9),
    element(SCENERY.goldStone5, 39, 11),
    element(SCENERY.rock2, 11, 12),
    element(SCENERY.rock4, 47, 13),
  ],
  epilogue: [
    // Rebuilt common market and readable regional stores.
    element(SCENERY.pumpkinPatch, 14, 28),
    element(SCENERY.pumpkinSingle, 18, 28, 2, 1),
    element(SCENERY.resourceWood, 22, 28),
    element(SCENERY.resourceMeat, 26, 28),
    element(SCENERY.plantLarge, 30, 28, 1, 0),
    element(SCENERY.plantShoot, 34, 28, 3, 1),
    element(SCENERY.tool2, 39, 28),
    // Memorial orchard gives the short epilogue exploration texture.
    element(SCENERY.tree1, 6, 15),
    element(SCENERY.tree2, 11, 17),
    element(SCENERY.tree3, 17, 15),
    element(SCENERY.tree4, 23, 17),
    element(SCENERY.tree1, 37, 16),
    element(SCENERY.tree2, 44, 14),
    element(SCENERY.tree3, 51, 17),
    element(SCENERY.bush1, 8, 22),
    element(SCENERY.bush2, 15, 21),
    element(SCENERY.bush3, 41, 22),
    element(SCENERY.bush4, 49, 23),
    element(SCENERY.memorial, 28, 18),
    element(SCENERY.cloud4, 29, 7),
  ],
};

/** Additional compositions selected after reviewing the full-map renders, focused on visible voids. */
const VISUAL_REVIEW_COMPOSITIONS: Readonly<Partial<Record<MapKey, readonly MapElement[]>>> = {
  prologue: [
    // Western roadside hedge.
    element(SCENERY.tree1, 5, 6),
    element(SCENERY.tree4, 10, 11),
    element(SCENERY.tree2, 5, 24),
    element(SCENERY.bush1, 9, 27),
    element(SCENERY.bush3, 15, 24),
    // Eastern ditch occupation.
    element(SCENERY.tree3, 50, 8),
    element(SCENERY.tree2, 54, 15),
    element(SCENERY.tree4, 50, 31),
    element(SCENERY.bush2, 45, 17),
    element(SCENERY.bush4, 52, 35),
    // Mid-road stones make the two combat pockets legible.
    element(SCENERY.rock1, 18, 20),
    element(SCENERY.rock2, 24, 22),
    element(SCENERY.rock3, 38, 22),
    element(SCENERY.rock4, 44, 25),
    // Tree walls narrow the route into a travelled corridor rather than an open lawn.
    element(SCENERY.tree3, 4, 13),
    element(SCENERY.tree2, 12, 4),
    element(SCENERY.tree1, 18, 8),
    element(SCENERY.tree4, 24, 6),
    element(SCENERY.tree2, 4, 33),
    element(SCENERY.tree3, 12, 38),
    element(SCENERY.tree1, 20, 39),
    element(SCENERY.tree4, 36, 4),
    element(SCENERY.tree1, 44, 5),
    element(SCENERY.tree3, 55, 10),
    element(SCENERY.tree2, 56, 20),
    element(SCENERY.tree4, 54, 38),
    element(SCENERY.bush2, 20, 11),
    element(SCENERY.bush4, 36, 10),
    element(SCENERY.bush1, 44, 29),
  ],
  faubourg: [
    // Ruined northern ward.
    element(BUILDINGS.ruinedHouse, 10, 16),
    element(BUILDINGS.ruinedHouse, 20, 18),
    element(BUILDINGS.ruinedTower, 31, 11),
    element(SCENERY.stump2, 7, 21),
    element(SCENERY.stump4, 25, 21),
    element(SCENERY.rock2, 34, 17),
    // Debris trail between the evacuation camp and the eastern rempart.
    element(SCENERY.mushroomLarge, 28, 35),
    element(SCENERY.stoneSmall, 34, 33),
    element(SCENERY.plantMedium, 39, 35),
    element(SCENERY.wood, 45, 34),
    element(SCENERY.bush1, 48, 17),
    element(SCENERY.bush3, 52, 27),
  ],
  relay: [
    // Northern windbreaks define the four incoming roads.
    element(SCENERY.tree1, 15, 7),
    element(SCENERY.tree2, 22, 9),
    element(SCENERY.tree3, 36, 8),
    element(SCENERY.tree4, 45, 7),
    element(SCENERY.bush1, 18, 13),
    element(SCENERY.bush2, 28, 12),
    element(SCENERY.bush3, 40, 13),
    // Southern campsite is dense enough to read as a halt.
    element(SCENERY.mushroomSmall, 9, 36),
    element(SCENERY.mushroomMedium, 14, 37),
    element(SCENERY.plantSmall, 24, 35),
    element(SCENERY.plantMedium, 32, 36),
    element(SCENERY.meat, 40, 35),
    element(SCENERY.stump3, 49, 34),
    element(SCENERY.rock4, 53, 28),
  ],
  roots: [
    // Dense western grove around the first chamber approach.
    element(SCENERY.tree4, 5, 6),
    element(SCENERY.tree2, 11, 6),
    element(SCENERY.tree1, 17, 7),
    element(SCENERY.tree3, 6, 20),
    element(SCENERY.tree1, 12, 24),
    element(SCENERY.tree4, 18, 29),
    element(SCENERY.bush1, 9, 13),
    element(SCENERY.bush3, 15, 17),
    // Eastern witness garden.
    element(SCENERY.tree2, 43, 7),
    element(SCENERY.tree3, 50, 9),
    element(SCENERY.tree1, 46, 19),
    element(SCENERY.tree4, 51, 33),
    element(SCENERY.bush2, 43, 29),
    element(SCENERY.bush4, 49, 24),
    element(SCENERY.rock4, 29, 35),
  ],
  marsh: [
    // Reed beds and drowned fence line across the southern islands.
    element(SCENERY.reeds, 6, 34),
    element(SCENERY.reeds, 18, 35),
    element(SCENERY.reeds, 31, 35),
    element(SCENERY.reeds, 45, 35),
    element(SCENERY.waterRock3, 12, 20),
    element(SCENERY.waterRock4, 27, 24),
    element(SCENERY.waterRock1, 40, 24),
    element(SCENERY.waterRock2, 53, 23),
    // Additional drowned homes define the old village axis.
    element(BUILDINGS.ruinedHouse, 15, 29),
    element(BUILDINGS.ruinedHouse, 33, 30),
    element(BUILDINGS.ruinedTower, 45, 12),
    element(SCENERY.tree2, 55, 34),
  ],
  archives: [
    // Side reading cells fill the large blank wings without adding combat.
    element(BUILDINGS.ruinedHouse, 8, 18),
    element(BUILDINGS.blackHouse2, 18, 24),
    element(BUILDINGS.purpleHouse2, 42, 24),
    element(BUILDINGS.ruinedHouse, 51, 18),
    element(SCENERY.plantShoot, 12, 34),
    element(SCENERY.reeds, 17, 32),
    element(SCENERY.boneSmall, 23, 34),
    element(SCENERY.mushroomLarge, 37, 34),
    element(SCENERY.stoneSmall, 43, 32),
    element(SCENERY.stoneMedium, 49, 34),
    element(SCENERY.rock2, 25, 16),
    element(SCENERY.rock4, 36, 16),
  ],
  fort: [
    // Central parade court and visible intendance.
    element(BUILDINGS.blackHouse1, 8, 21),
    element(BUILDINGS.blackHouse2, 17, 21),
    element(BUILDINGS.redHouse2, 39, 21),
    element(BUILDINGS.blueHouse2, 48, 21),
    element(SCENERY.stoneLarge, 12, 31),
    element(SCENERY.stoneSmall, 18, 31),
    element(SCENERY.plantSmall, 38, 31),
    element(SCENERY.plantMedium, 44, 31),
    // Fortification line around the elevated command sector.
    element(BUILDINGS.blackTower, 6, 7),
    element(BUILDINGS.blackTower, 18, 7),
    element(BUILDINGS.blackTower, 31, 8),
    element(BUILDINGS.blackTower, 48, 8),
    element(SCENERY.wood, 29, 33),
    element(SCENERY.gold, 34, 33),
  ],
  sanctuary: [
    // Eastern herb gardens and service residences.
    element(BUILDINGS.yellowHouse3, 39, 32),
    element(BUILDINGS.yellowHouse1, 49, 31),
    element(SCENERY.tree1, 38, 17),
    element(SCENERY.tree2, 44, 19),
    element(SCENERY.tree3, 51, 23),
    element(SCENERY.bush1, 37, 26),
    element(SCENERY.bush2, 43, 27),
    element(SCENERY.bush3, 49, 27),
    // Public courtyard furniture.
    element(SCENERY.mushroomSmall, 8, 35),
    element(SCENERY.mushroomMedium, 13, 34),
    element(SCENERY.stoneMedium, 19, 35),
    element(SCENERY.plantLarge, 25, 34),
    element(SCENERY.plantShoot, 31, 35),
    element(SCENERY.tool4, 35, 32),
  ],
  crypt: [
    // Outer ossuary cells.
    element(BUILDINGS.ruinedHouse, 7, 18),
    element(BUILDINGS.ruinedHouse, 18, 23),
    element(BUILDINGS.ruinedHouse, 40, 23),
    element(BUILDINGS.ruinedTower, 51, 20),
    element(SCENERY.memorial, 12, 25),
    element(SCENERY.memorial, 25, 26),
    element(SCENERY.memorial, 36, 26),
    element(SCENERY.memorial, 48, 25),
    // Rubble lines around the central crypt.
    element(SCENERY.rock1, 20, 15),
    element(SCENERY.rock2, 25, 17),
    element(SCENERY.rock3, 34, 17),
    element(SCENERY.rock4, 40, 15),
    element(SCENERY.boneLarge, 29, 31),
  ],
  war: [
    // Western and eastern trench debris.
    element(BUILDINGS.ruinedHouse, 7, 18),
    element(BUILDINGS.ruinedTower, 15, 16),
    element(SCENERY.stump1, 8, 10),
    element(SCENERY.stump3, 18, 10),
    element(SCENERY.stoneSmall, 10, 24),
    element(SCENERY.stoneMedium, 16, 24),
    element(BUILDINGS.ruinedHouse, 43, 17),
    element(BUILDINGS.ruinedTower, 53, 18),
    element(SCENERY.stump2, 44, 9),
    element(SCENERY.stump4, 54, 10),
    element(SCENERY.plantShoot, 45, 24),
    element(SCENERY.reeds, 51, 24),
    // Contested centre and recovery path.
    element(SCENERY.rock1, 23, 12),
    element(SCENERY.rock2, 27, 17),
    element(SCENERY.rock3, 34, 17),
    element(SCENERY.rock4, 39, 12),
    element(SCENERY.wood, 27, 34),
    element(SCENERY.meat, 34, 34),
  ],
  galleries: [
    // Dense mineral galleries around the central race line.
    element(SCENERY.goldStone1, 7, 20),
    element(SCENERY.goldStone2, 12, 23),
    element(SCENERY.goldStone3, 17, 19),
    element(SCENERY.goldStone4, 23, 22),
    element(SCENERY.goldStone5, 37, 20),
    element(SCENERY.goldStone6, 43, 23),
    element(SCENERY.goldStone1, 49, 19),
    element(SCENERY.rock1, 8, 8),
    element(SCENERY.rock2, 17, 9),
    element(SCENERY.rock3, 29, 12),
    element(SCENERY.rock4, 42, 8),
    element(SCENERY.stoneMedium, 14, 33),
    element(SCENERY.stoneLarge, 31, 33),
    element(SCENERY.plantMedium, 45, 32),
  ],
  heart: [
    // Broken outer ring.
    element(SCENERY.rock1, 7, 18),
    element(SCENERY.rock2, 12, 22),
    element(SCENERY.rock3, 18, 25),
    element(SCENERY.rock4, 41, 25),
    element(SCENERY.rock2, 47, 22),
    element(SCENERY.rock3, 52, 18),
    element(SCENERY.goldStone6, 12, 12),
    element(SCENERY.goldStone5, 46, 12),
    element(SCENERY.mushroomSmall, 9, 31),
    element(SCENERY.mushroomMedium, 17, 32),
    element(SCENERY.plantShoot, 41, 32),
    element(SCENERY.reeds, 49, 31),
  ],
  epilogue: [
    // Orchard paths close the remaining central void.
    element(SCENERY.tree4, 9, 25),
    element(SCENERY.tree1, 19, 23),
    element(SCENERY.tree2, 39, 24),
    element(SCENERY.tree3, 48, 27),
    element(SCENERY.bush1, 13, 26),
    element(SCENERY.bush2, 24, 24),
    element(SCENERY.bush3, 34, 25),
    element(SCENERY.bush4, 44, 26),
    element(SCENERY.rock1, 7, 31),
    element(SCENERY.rock2, 19, 32),
    element(SCENERY.rock3, 41, 31),
    element(SCENERY.rock4, 52, 32),
  ],
};

/**
 * Small catalogue sprites are named only by number upstream. These compositions use their inspected
 * subjects deliberately and exploit quarter-cell offsets to form local clusters instead of one
 * generic full-cell scatter.
 */
const CATALOG_DETAIL_COMPOSITIONS: Readonly<Partial<Record<MapKey, readonly MapElement[]>>> = {
  prologue: [
    // Damp western verge.
    element(SCENERY.mushroomSmall, 7, 16, 0, 1),
    element(SCENERY.mushroomMedium, 7, 16, 2, 2),
    element(SCENERY.mushroomLarge, 8, 17, 1, 0),
    element(SCENERY.plantSmall, 10, 18, 3, 1),
    element(SCENERY.plantShoot, 11, 18, 0, 2),
    // Junction and trampled ambush edge.
    element(SCENERY.notice, 29, 34),
    element(SCENERY.stoneSmall, 31, 33, 1, 2),
    element(SCENERY.stoneMedium, 32, 33, 3, 0),
    element(SCENERY.plantMedium, 41, 28, 2, 1),
    element(SCENERY.plantLarge, 42, 28, 0, 2),
  ],
  aubeval: [
    // Market garden and low-quarter produce.
    element(SCENERY.pumpkinSingle, 21, 22, 0, 1),
    element(SCENERY.pumpkinSingle, 21, 22, 3, 2),
    element(SCENERY.pumpkinPatch, 23, 22, 1, 0),
    element(SCENERY.plantSmall, 25, 23, 2, 1),
    element(SCENERY.plantMedium, 26, 23, 0, 2),
    element(SCENERY.scarecrow, 8, 31),
    // Dike survey marks and public wayfinding.
    element(SCENERY.notice, 29, 20),
    element(SCENERY.stoneSmall, 45, 27, 1, 1),
    element(SCENERY.stoneLarge, 47, 27, 3, 0),
    element(SCENERY.reeds, 11, 34, 2, 2),
  ],
  faubourg: [
    // Damp orchard regrowth.
    element(SCENERY.mushroomSmall, 9, 14, 1, 0),
    element(SCENERY.mushroomMedium, 9, 14, 3, 2),
    element(SCENERY.mushroomLarge, 11, 15, 0, 1),
    element(SCENERY.plantShoot, 13, 16, 2, 0),
    // Remains and warning line around the occupied eastern approach.
    element(SCENERY.boneLarge, 42, 19, 1, 1),
    element(SCENERY.boneSmall, 43, 19, 3, 0),
    element(SCENERY.memorial, 45, 21),
    element(SCENERY.stoneSmall, 47, 23, 0, 2),
    element(SCENERY.stoneLarge, 49, 24, 2, 1),
    element(SCENERY.notice, 31, 30),
  ],
  relay: [
    // Worked southern field beside the traveller camps.
    element(SCENERY.scarecrow, 8, 28),
    element(SCENERY.pumpkinSingle, 10, 29, 1, 1),
    element(SCENERY.pumpkinSingle, 10, 29, 3, 2),
    element(SCENERY.pumpkinPatch, 12, 29),
    element(SCENERY.plantSmall, 14, 29, 2, 0),
    // Sheltered fungal grove and central road sign.
    element(SCENERY.mushroomSmall, 48, 30, 0, 1),
    element(SCENERY.mushroomMedium, 48, 30, 2, 2),
    element(SCENERY.mushroomLarge, 50, 31, 1, 0),
    element(SCENERY.plantLarge, 52, 30, 3, 1),
    element(SCENERY.notice, 29, 18),
  ],
  woods: [
    // Sève feeding grove.
    element(SCENERY.mushroomSmall, 9, 19, 0, 1),
    element(SCENERY.mushroomMedium, 9, 19, 2, 2),
    element(SCENERY.mushroomLarge, 11, 20, 1, 0),
    element(SCENERY.plantSmall, 13, 19, 3, 1),
    element(SCENERY.plantMedium, 15, 20, 0, 2),
    // Écorce cutting boundary and the marked old road.
    element(SCENERY.mushroomSmall, 43, 29, 1, 2),
    element(SCENERY.mushroomMedium, 44, 29, 3, 0),
    element(SCENERY.plantLarge, 46, 30, 0, 1),
    element(SCENERY.resourceWood, 49, 28),
    element(SCENERY.notice, 27, 9),
  ],
  roots: [
    // Living offerings around both witness gardens.
    element(SCENERY.mushroomSmall, 12, 22, 0, 1),
    element(SCENERY.mushroomMedium, 12, 22, 2, 2),
    element(SCENERY.mushroomLarge, 14, 23, 1, 0),
    element(SCENERY.plantSmall, 17, 24, 3, 1),
    element(SCENERY.mushroomSmall, 43, 23, 1, 2),
    element(SCENERY.mushroomMedium, 44, 23, 3, 0),
    element(SCENERY.plantMedium, 46, 24, 0, 1),
    element(SCENERY.plantLarge, 48, 25, 2, 2),
    element(SCENERY.stoneSmall, 28, 28, 1, 1),
    element(SCENERY.stoneMedium, 30, 28, 3, 0),
  ],
  marsh: [
    // Fungal islet and dense reed beds.
    element(SCENERY.mushroomSmall, 7, 32, 0, 1),
    element(SCENERY.mushroomMedium, 7, 32, 2, 2),
    element(SCENERY.mushroomLarge, 9, 33, 1, 0),
    element(SCENERY.reeds, 18, 29, 3, 1),
    element(SCENERY.reeds, 39, 29, 0, 2),
    // Large animated outcrops identify the four main channels.
    element(SCENERY.waterOutcrop1, 5, 9),
    element(SCENERY.waterOutcrop2, 22, 8),
    element(SCENERY.waterOutcrop3, 38, 9),
    element(SCENERY.waterOutcrop4, 53, 10),
    element(SCENERY.waterSplash, 31, 33),
  ],
  archives: [
    // Damp shelves have fungal growth; the collapsed wing holds human remains.
    element(SCENERY.mushroomSmall, 11, 30, 0, 1),
    element(SCENERY.mushroomMedium, 11, 30, 2, 2),
    element(SCENERY.mushroomLarge, 13, 31, 1, 0),
    element(SCENERY.reeds, 15, 31, 3, 1),
    element(SCENERY.boneLarge, 41, 31, 0, 2),
    element(SCENERY.boneSmall, 42, 31, 2, 1),
    element(SCENERY.memorial, 45, 30),
    element(SCENERY.stoneSmall, 28, 27, 1, 2),
    element(SCENERY.stoneMedium, 30, 27, 3, 0),
  ],
  citadel: [
    // Intendance court.
    element(SCENERY.pumpkinSingle, 24, 31, 0, 1),
    element(SCENERY.pumpkinSingle, 24, 31, 3, 2),
    element(SCENERY.pumpkinPatch, 26, 31),
    element(SCENERY.resourceMeat, 29, 30),
    element(SCENERY.resourceWood, 33, 30),
    // Cell yard and signed court boundaries.
    element(SCENERY.boneLarge, 44, 27, 1, 1),
    element(SCENERY.boneSmall, 45, 27, 3, 0),
    element(SCENERY.memorial, 47, 28),
  ],
  fort: [
    // Reserve yard and prison edge.
    element(SCENERY.pumpkinSingle, 19, 28, 0, 1),
    element(SCENERY.pumpkinPatch, 21, 28),
    element(SCENERY.resourceWood, 25, 28),
    element(SCENERY.resourceMeat, 30, 28),
    element(SCENERY.boneLarge, 42, 25, 1, 2),
    element(SCENERY.boneSmall, 43, 25, 3, 0),
    element(SCENERY.memorial, 45, 26),
    element(SCENERY.stoneSmall, 34, 24, 0, 1),
    element(SCENERY.stoneLarge, 36, 24, 2, 2),
  ],
  sanctuary: [
    // Dispensary herb and fungal gardens.
    element(SCENERY.mushroomSmall, 8, 26, 0, 1),
    element(SCENERY.mushroomMedium, 8, 26, 2, 2),
    element(SCENERY.mushroomLarge, 10, 27, 1, 0),
    element(SCENERY.plantSmall, 13, 27, 3, 1),
    element(SCENERY.plantMedium, 15, 28, 0, 2),
    element(SCENERY.plantLarge, 17, 27, 2, 1),
    element(SCENERY.pumpkinSingle, 43, 29, 1, 2),
    element(SCENERY.pumpkinPatch, 45, 29),
    element(SCENERY.resourceMeat, 48, 29),
  ],
  crypt: [
    // Ossuary clusters and damp crypt growth.
    element(SCENERY.boneLarge, 18, 26, 0, 1),
    element(SCENERY.boneSmall, 18, 26, 3, 2),
    element(SCENERY.boneLarge, 35, 26, 1, 0),
    element(SCENERY.boneSmall, 36, 26, 2, 2),
    element(SCENERY.mushroomSmall, 10, 30, 0, 1),
    element(SCENERY.mushroomMedium, 10, 30, 2, 2),
    element(SCENERY.mushroomLarge, 12, 31, 1, 0),
    element(SCENERY.reeds, 40, 30, 3, 1),
    element(SCENERY.tool4, 14, 29),
    element(SCENERY.memorial, 28, 24),
  ],
  war: [
    // The contested centre shows losses rather than generic vegetation.
    element(SCENERY.boneLarge, 25, 25, 0, 1),
    element(SCENERY.boneSmall, 25, 25, 3, 2),
    element(SCENERY.boneLarge, 36, 25, 1, 0),
    element(SCENERY.boneSmall, 37, 25, 2, 2),
    element(SCENERY.memorial, 30, 27),
    element(SCENERY.stoneSmall, 28, 29, 1, 1),
    element(SCENERY.stoneLarge, 33, 29, 3, 0),
    element(SCENERY.resourceMeat, 12, 30),
    element(SCENERY.resourceWood, 48, 30),
  ],
  galleries: [
    // Fungal pockets and discarded remains reward side-gallery inspection.
    element(SCENERY.mushroomSmall, 9, 28, 0, 1),
    element(SCENERY.mushroomMedium, 9, 28, 2, 2),
    element(SCENERY.mushroomLarge, 11, 29, 1, 0),
    element(SCENERY.mushroomSmall, 40, 29, 1, 2),
    element(SCENERY.mushroomMedium, 41, 29, 3, 0),
    element(SCENERY.boneLarge, 25, 30, 0, 1),
    element(SCENERY.boneSmall, 26, 30, 2, 2),
    element(SCENERY.resourceGold, 47, 16),
    element(SCENERY.stoneSmall, 30, 22, 1, 1),
    element(SCENERY.stoneMedium, 32, 22, 3, 0),
  ],
  heart: [
    // The witness ring is littered with old remains and mineral fragments.
    element(SCENERY.waterOutcrop2, 6, 13),
    element(SCENERY.waterOutcrop4, 44, 13),
    element(SCENERY.boneLarge, 11, 28, 0, 1),
    element(SCENERY.boneSmall, 12, 28, 3, 2),
    element(SCENERY.boneLarge, 43, 28, 1, 0),
    element(SCENERY.boneSmall, 44, 28, 2, 2),
    element(SCENERY.memorial, 27, 29),
    element(SCENERY.stoneSmall, 22, 26, 1, 1),
    element(SCENERY.stoneMedium, 29, 25, 3, 0),
    element(SCENERY.stoneLarge, 36, 26, 0, 2),
    element(SCENERY.mushroomSmall, 8, 31, 2, 1),
    element(SCENERY.mushroomMedium, 48, 31, 1, 2),
  ],
  epilogue: [
    // Reclaimed orchard and common field.
    element(SCENERY.mushroomSmall, 10, 24, 0, 1),
    element(SCENERY.mushroomMedium, 10, 24, 2, 2),
    element(SCENERY.mushroomLarge, 12, 25, 1, 0),
    element(SCENERY.pumpkinSingle, 35, 27, 1, 1),
    element(SCENERY.pumpkinSingle, 35, 27, 3, 2),
    element(SCENERY.pumpkinPatch, 37, 27),
    element(SCENERY.scarecrow, 40, 28),
    element(SCENERY.plantSmall, 43, 28, 0, 1),
    element(SCENERY.plantLarge, 45, 29, 2, 2),
  ],
};

function npc(
  factory: Factory,
  key: string,
  name: string,
  col: number,
  row: number,
  graphic: MapEventPage["graphicAssetId"],
  lines: readonly string[],
): void {
  const living = graphic?.startsWith("character.") ?? false;
  factory.normal(key, name, cell(col, row), graphic, [
    page(
      lines.map((line) => say(name, line)),
      {
        graphicAssetId: graphic,
        moveType: living ? "custom" : "fixed",
        moveSpeed: living ? 2 : 0,
        moveFreq: living ? 2 : 0,
        optMoveAnim: living,
      },
    ),
  ]);
}

function ambientNpc(
  factory: Factory,
  key: string,
  name: string,
  col: number,
  row: number,
  graphic: MapEventPage["graphicAssetId"],
  line: string,
  moveType: MapEventPage["moveType"] = "custom",
  conditionSwitchId: string | null = null,
): void {
  const active = page([say(name, line)], {
    condSwitchId: conditionSwitchId,
    graphicAssetId: graphic,
    moveType,
    moveSpeed: moveType === "fixed" ? 2 : 3,
    moveFreq: moveType === "fixed" ? 1 : 3,
    optMoveAnim: moveType !== "fixed",
  });
  factory.normal(
    key,
    name,
    cell(col, row),
    conditionSwitchId === null ? graphic : null,
    conditionSwitchId === null ? [active] : [page([], { graphicAssetId: null }), active],
  );
}

function once(
  factory: Factory,
  key: string,
  name: string,
  col: number,
  row: number,
  graphic: MapEventPage["graphicAssetId"],
  commands: readonly EventCommand[],
  after: string,
): void {
  factory.normal(key, name, cell(col, row), graphic, [
    page([...commands, { t: "setSelfSwitch", selfSwitch: "A", value: true }], {
      graphicAssetId: graphic,
    }),
    page([say(name, after)], {
      condSelfSwitch: "A",
      graphicAssetId: graphic,
    }),
  ]);
}

function explorationCache(
  factory: Factory,
  key: string,
  name: string,
  col: number,
  row: number,
  discovery: string,
  gold: number,
): void {
  once(
    factory,
    key,
    name,
    col,
    row,
    GRAPHICS.rune,
    [
      say(null, discovery),
      { t: "changeGold", amount: gold },
      { t: "changeItems", itemId: "health_potion", count: 1 },
      addVar("0011", 1),
    ],
    `Le repère « ${name} » est désormais noté dans votre carnet.`,
  );
}

function portal(
  factory: Factory,
  key: string,
  name: string,
  col: number,
  row: number,
  destination: { map: MapKey; col: number; row: number },
  unlockSwitches: readonly string[],
  locked: string,
  category: TransitionCategory = "geographic",
  graphicAssetId: MapEventPage["graphicAssetId"] = GRAPHICS.rune,
  departure = "",
): void {
  const unlocked = page(
    [
      ...(departure.length > 0 ? [say(null, departure)] : []),
      teleport(destination.map, destination.col, destination.row, category),
    ],
    { graphicAssetId },
  );
  factory.normal(
    key,
    name,
    cell(col, row),
    graphicAssetId,
    unlockSwitches.length === 0
      ? [unlocked]
      : [
          page([say(null, locked)], { graphicAssetId }),
          ...unlockSwitches.map((switchId) => ({ ...unlocked, condSwitchId: switchId })),
        ],
  );
}

function monsterPack(
  factory: Factory,
  key: string,
  name: string,
  species: MonsterSpecies,
  positions: readonly { col: number; row: number }[],
  tuning: Partial<MonsterTuning> = {},
): void {
  positions.forEach((position, index) => {
    factory.monster(`${key}-${index + 1}`, `${name} ${index + 1}`, position, species, tuning);
  });
}

function mapElements(
  theme: Parameters<typeof safeElements>[0],
  key: MapKey,
  factory: Factory,
  spawn: { col: number; row: number },
  authored: readonly MapElement[],
): MapElement[] {
  return safeElements(theme, factory.events, spawn, [
    ...authored,
    ...(REGIONAL_COMPOSITIONS[key] ?? []),
    ...(REGIONAL_DETAIL_COMPOSITIONS[key] ?? []),
    ...(VISUAL_REVIEW_COMPOSITIONS[key] ?? []),
    ...(CATALOG_DETAIL_COMPOSITIONS[key] ?? []),
  ]);
}

function buildPrologue(refs: StoryRefs): AdventureBundleMap {
  const e = createEventFactory("prologue", refs);
  const spawn = cell(5, 38);
  npc(e, "lyra", "Lyra", 9, 35, GRAPHICS.lyra, [
    "Le convoi a été frappé au tournant. Iven respire encore ; aidez-le avant de fouiller les roues.",
    "Ensuite, voyez le registre avec Osric. Vos noms manquent. Je veux savoir si c’est une erreur ou un acte.",
  ]);
  once(
    e,
    "wounded-carter",
    "Iven",
    13,
    32,
    GRAPHICS.refugee,
    [
      say(
        "Iven",
        "Ils ont pris ma sœur au relais. Le soldat a barré son nom, puis m’a rendu la feuille comme si elle n’avait jamais voyagé avec nous.",
      ),
      activity("disparus_signales"),
      switchOn("0002"),
      addVar("0009", 1),
    ],
    "Je garde la feuille barrée. Rapportez-moi mieux qu’une rumeur, même si ce que vous trouvez ne ramène pas ma sœur.",
  );
  once(
    e,
    "broken-register",
    "Registre fendu",
    21,
    27,
    GRAPHICS.rune,
    [
      say(
        "Registre",
        "La page compte neuf voyageurs. Quatre lignes ont été grattées avec une lame, mais le total au bas de la colonne n’a pas changé.",
      ),
      activity("registre_brise"),
      switchOn("0001"),
      addVar("0001", 1),
      addVar("0011", 1),
    ],
    "Le compte reste neuf. Les quatre noms effacés ne reviennent pas sous la lumière.",
  );
  e.normal("source-scar", "Éclat d’Aube", cell(34, 21), GRAPHICS.source, [
    page(
      [
        say(
          null,
          "L’eau dorée reste sous la pierre. Il manque encore le témoignage du blessé et la preuve comptable laissée près de la charrette.",
        ),
      ],
      { graphicAssetId: GRAPHICS.rune },
    ),
    page(
      [
        say(
          null,
          "Une eau dorée remonte contre la pente. À votre approche, elle prononce un prénom que personne dans le groupe ne reconnaît.",
        ),
        choice("Que faire de l’éclat ?", [
          {
            label: "Le toucher malgré le risque",
            body: [
              say(
                null,
                "Le froid emporte l’image d’une chambre d’enfant. Vous savez qu’elle vous appartenait sans pouvoir en retrouver la porte.",
              ),
              addVar("0001", 1),
              addVar("0008", 1),
            ],
          },
          {
            label: "Refuser le prélèvement",
            body: [
              say(
                "Lyra",
                "L’eau s’est arrêtée quand vous avez dit non. Les sceaux de la Couronne n’accordent jamais ce droit.",
              ),
              addVar("0003", 1),
              addVar("0004", 1),
            ],
          },
        ]),
        activity("source_reconnait"),
        switchOn("0003"),
        { t: "setSelfSwitch", selfSwitch: "A", value: true },
      ],
      {
        condSwitchId: "0001",
        condVariableId: "0009",
        condVariableMin: 1,
        graphicAssetId: GRAPHICS.source,
      },
    ),
    page(
      [
        say(
          null,
          "L’éclat demeure immobile. Le prénom entendu ne correspond à aucun nom du registre.",
        ),
      ],
      { condSelfSwitch: "A", graphicAssetId: GRAPHICS.source },
    ),
  ]);
  npc(e, "crown-clerk", "Greffier Osric", 25, 33, GRAPHICS.monkYellow, [
    "J’ai essayé les registres civils, militaires et funéraires. Vos visages sont présents sur une planche de convoi, mais les cases des noms sont vides.",
    "Je peux vous faire entrer comme témoins de Lyra. Sans elle, la porte vous classera comme biens sans propriétaire.",
  ]);
  npc(e, "varos-prism", "Sceau de Varos", 43, 15, GRAPHICS.varos, [
    "La porte vous refuse. Mon sceau, lui, vous voit. Voilà le seul fait dont je sois certain.",
    "Entrez. Regardez les vannes avant d’écouter ceux qui parlent en mon nom.",
  ]);
  npc(e, "mile-stone", "Borne arrachée", 29, 37, GRAPHICS.rune, [
    "Quatre emblèmes restent lisibles : vanne valéenne, feuille du Bois, saule du Marais et brasier cendrier. Aubeval a été retaillé par-dessus les trois autres.",
  ]);
  portal(
    e,
    "to-aubeval",
    "Porte de la digue",
    54,
    8,
    { map: "aubeval", col: 5, row: 37 },
    ["0003"],
    "Le sceau réclame un nom enregistré. L’Éclat d’Aube, plus bas sur la route, a réagi à votre présence.",
    "geographic",
    GRAPHICS.soldierBlue,
    "Le garde abaisse la chaîne. La Porte de la digue mène au quartier occidental d’Aubeval.",
  );
  monsterPack(e, "road-ghouls", "Affamé du fossé", "spear_goblin", [
    cell(17, 20),
    cell(25, 16),
    cell(39, 28),
    cell(47, 20),
  ]);
  explorationCache(
    e,
    "ridge-cache",
    "Sacoche du belvédère",
    43,
    5,
    "Le sentier haut mène à une sacoche oubliée : une ration, un tonique et le croquis d'un chariot absent du registre.",
    20,
  );
  return bundleMap(
    "prologue",
    "Route des Bornes arrachées",
    terrainLayers("prologue", {
      water: [
        { col: 28, row: 2, width: 4, height: 34 },
        { col: 10, row: 17, width: 12, height: 3 },
        { col: 42, row: 31, width: 12, height: 3 },
      ],
      carve: [
        { col: 28, row: 20, width: 4, height: 5 },
        { col: 16, row: 17, width: 4, height: 3 },
        { col: 47, row: 31, width: 4, height: 3 },
      ],
    }),
    spawn,
    e.events,
    mapElements("road", "prologue", e, spawn, [
      element(BUILDINGS.ruinedHouse, 10, 28),
      element(BUILDINGS.ruinedTower, 45, 11),
      element(BUILDINGS.yellowHouse1, 48, 35),
    ]),
  );
}

function buildAubeval(refs: StoryRefs): AdventureBundleMap {
  const e = createEventFactory("aubeval", refs);
  const spawn = cell(5, 37);
  npc(e, "lyra", "Lyra", 9, 36, GRAPHICS.lyra, [
    "Varkesh a découvert les convois. Puis il a pendu deux officiers et muré une rue. Aucun camp ne vous racontera sa moitié honteuse.",
    "Commencez au livre des convois, sur la terrasse des archives. Revenez avec une copie que Neria pourra défendre devant la place.",
  ]);
  npc(e, "farmer", "Mara des digues", 16, 34, GRAPHICS.villager, [
    "La Source a sauvé nos semis deux printemps de suite. Cette année, mon fils a oublié le visage de sa mère après la bénédiction des champs.",
    "Je ne demande pas que vous fermiez l’eau. Je demande qu’on cesse d’appeler cela gratuit.",
  ]);
  npc(e, "soldier", "Caporal Joss", 24, 13, GRAPHICS.soldierBlue, [
    "La troisième vanne tient avec deux madriers. Si elle cède, le marché est sous l’eau avant que la cloche finisse de sonner.",
    "Mes ordres disent de garder les archives. Mes hommes gardent surtout leurs familles dans le quartier bas.",
  ]);
  npc(e, "council-herald", "Héraut du Conseil", 39, 10, GRAPHICS.monkPurple, [
    "Avis du Conseil : Varkesh a enlevé les disparus pour grossir son armée. Toute preuve contraire doit être remise aux archives pour authentification.",
    "La peine pour diffusion d’un registre non certifié reste l’emprisonnement jusqu’à la fin de l’urgence.",
  ]);
  e.normal("convoy-ledger", "Livre des convois", cell(46, 17), GRAPHICS.rune, [
    page(
      [
        say(
          "Neria",
          "Les dates correspondent aux baisses d’eau et aux maisons réquisitionnées. Trois signatures sont authentiques ; la quatrième a été ajoutée après coup.",
        ),
        choice("Que faire de la copie vérifiée ?", [
          {
            label: "La publier au marché",
            body: [
              switchOn("0004"),
              addVar("0003", 2),
              addVar("0001", 1),
              addVar("0009", 2),
              say(
                "Neria",
                "La foule saura ce soir. Le Conseil perdra le contrôle du récit, et peut-être celui des vannes.",
              ),
            ],
          },
          {
            label: "La confier à Lyra",
            body: [
              switchOn("0005"),
              addVar("0002", 2),
              addVar("0004", 1),
              addVar("0006", 2),
              addVar("0009", 2),
              say(
                "Lyra",
                "Je ferai arrêter les signataires avant l’annonce. Ils appelleront cela un coup d’État ; je devrai peut-être leur donner raison.",
              ),
            ],
          },
        ]),
        activity("preuve_convois"),
        switchOn("0041"),
        addVar("0007", 1),
        { t: "setSelfSwitch", selfSwitch: "A", value: true },
      ],
      { graphicAssetId: GRAPHICS.rune },
    ),
    page(
      [
        say(
          "Neria",
          "La copie circule désormais selon votre décision. L’original reste caché derrière la table des taxes.",
        ),
      ],
      { condSelfSwitch: "A", graphicAssetId: GRAPHICS.rune },
    ),
  ]);
  e.normal("dike-choice", "Vanne des Tisserands", cell(21, 24), GRAPHICS.artisan, [
    page(
      [
        say(
          "Maître Harel",
          "Je peux fermer la brèche à la main avec vingt ouvriers, mais nous perdrons les maisons basses. La Source la scellerait vite ; elle réclame un nom.",
        ),
        choice("Comment sauver la digue ?", [
          {
            label: "Organiser les ouvriers et évacuer",
            body: [
              switchOn("0063"),
              addVar("0010", 2),
              addVar("0003", 1),
              addVar("0008", 1),
              activity("digue_sans_miracle"),
            ],
          },
          {
            label: "Accepter le prix proposé par la Source",
            body: [
              switchOn("0063"),
              addVar("0002", 1),
              addVar("0008", 2),
              addVar("0017", 1),
              addVar("0005", 1),
              activity("digue_sans_miracle"),
              say(
                null,
                "La pierre se referme. Harel cherche le nom de son apprenti et ne trouve plus que le métier : charpentier.",
              ),
            ],
          },
        ]),
        { t: "setSelfSwitch", selfSwitch: "A", value: true },
      ],
      { graphicAssetId: GRAPHICS.artisan },
    ),
    page(
      [
        say(
          "Maître Harel",
          "La vanne tient. Le quartier se souviendra aussi de la manière dont elle a été sauvée.",
        ),
      ],
      { condSelfSwitch: "A", graphicAssetId: GRAPHICS.artisan },
    ),
  ]);
  once(
    e,
    "missing-houses",
    "Plan des maisons saisies",
    34,
    31,
    GRAPHICS.rune,
    [
      say(
        null,
        "Sept maisons ont été vidées la même nuit. Les reçus de réquisition portent des numéros de chariot, mais aucun nom d’habitant.",
      ),
      switchOn("0062"),
      addVar("0010", 1),
      activity("maisons_requisitionnees"),
    ],
    "Les numéros des sept chariots sont copiés dans votre carnet.",
  );
  e.normal("varos-courier", "Courrier de Varos", cell(32, 9), GRAPHICS.varos, [
    page(
      [
        say(
          "Courrier",
          "Les Mesureurs de Varos ont détourné cette nuit la Source vers la digue nord. Deux cents personnes vivent parce qu’il a choisi sans les consulter.",
        ),
        choice("Répondre au courrier ?", [
          {
            label: "Reconnaître les vies sauvées",
            body: [
              addVar("0005", 1),
              addVar("0002", 1),
              say(
                "Courrier",
                "Je transmettrai vos mots entiers, pas seulement la partie utile à mon maître.",
              ),
            ],
          },
          {
            label: "Exiger le registre du prix",
            body: [
              addVar("0001", 1),
              addVar("0003", 1),
              addVar("0009", 1),
              say("Courrier", "Il refusera. Mais il saura que vous avez posé la bonne question."),
            ],
          },
        ]),
        { t: "setSelfSwitch", selfSwitch: "A", value: true },
      ],
      { graphicAssetId: GRAPHICS.varos },
    ),
    page(
      [
        say(
          "Courrier",
          "La réponse est partie. Les soldats de Varos ont aussi envoyé du grain au quartier nord.",
        ),
      ],
      { condSelfSwitch: "A", graphicAssetId: GRAPHICS.varos },
    ),
  ]);
  npc(e, "memorial", "Neria", 44, 35, GRAPHICS.monkYellow, [
    "Le mémorial donne quatre-vingt-deux noms. Mon registre en compte cent dix-neuf. Le Conseil dit que les autres n’étaient pas citoyens.",
    "Je recopie les métiers quand le nom manque. Ce n’est pas une identité ; c’est de quoi prouver que le Conseil a supprimé une personne.",
  ]);
  ambientNpc(
    e,
    "west-gate-guard",
    "Garde de la porte",
    6,
    37,
    GRAPHICS.soldierBlue,
    "Deux voyageurs entrent, trois noms sortent des registres. Je note maintenant les visages.",
    "fixed",
  );
  ambientNpc(
    e,
    "barracks-patrol",
    "Patrouille de Joss",
    17,
    15,
    GRAPHICS.soldierBlue,
    "Porte, armurerie, digue, puis retour. Joss ne veut plus d'une garde immobile.",
  );
  ambientNpc(
    e,
    "market-grain",
    "Olia la grainière",
    22,
    21,
    GRAPHICS.merchant,
    "Le prix du seigle change à chaque sonnerie. Celui de l'eau n'est jamais affiché.",
  );
  ambientNpc(
    e,
    "market-fish",
    "Ruel le pêcheur",
    25,
    21,
    GRAPHICS.villager,
    "Mes poissons nagent dans les rues avant d'arriver sur l'étal. Ça économise une charrette.",
  );
  ambientNpc(
    e,
    "market-carrier",
    "Porteuse du marché",
    31,
    23,
    GRAPHICS.refugee,
    "Écartez-vous de la balance. Les sacs ont plus de droits que moi, mais moins de jambes.",
  );
  ambientNpc(
    e,
    "dike-tools",
    "Ouvrier aux madriers",
    17,
    25,
    GRAPHICS.artisan,
    "Je prends un madrier, je cale la vanne, je reviens. Si je cours, courez aussi.",
  );
  ambientNpc(
    e,
    "dike-valve",
    "Vannière Siloé",
    23,
    27,
    GRAPHICS.artisan,
    "Trois tours à gauche, un coup de maillet. La ville tient sur des gestes qu'elle ne regarde pas.",
  );
  ambientNpc(
    e,
    "dike-runner",
    "Coursier des digues",
    16,
    28,
    GRAPHICS.child,
    "Harel dit que je suis trop petit pour la vanne. Pas pour porter ses messages.",
  );
  ambientNpc(
    e,
    "low-quarter-washer",
    "Lavandière du bas",
    35,
    34,
    GRAPHICS.villager,
    "Dans le quartier haut, ils appellent ça une crue. Ici, c'est le mobilier.",
  );
  ambientNpc(
    e,
    "low-quarter-carpenter",
    "Charpentier réquisitionné",
    40,
    32,
    GRAPHICS.woodcutter,
    "Je répare une maison le matin et je la marque à saisir l'après-midi. Même craie, deux couleurs.",
    "fixed",
  );
  ambientNpc(
    e,
    "upper-steward",
    "Intendant des terrasses",
    35,
    13,
    GRAPHICS.monkPurple,
    "Le Conseil reçoit sur les hauteurs. L'humidité y devient soudain une statistique.",
    "fixed",
  );
  ambientNpc(
    e,
    "archive-runner",
    "Clerc des archives",
    49,
    13,
    GRAPHICS.monkYellow,
    "Je porte les copies par l'escalier. Les originaux, eux, ne descendent jamais.",
  );
  ambientNpc(
    e,
    "published-reader",
    "Lectrice du registre",
    25,
    18,
    GRAPHICS.villager,
    "Ma voisine est dans la colonne des charges, pas dans celle des habitants. Je veux savoir qui a décidé.",
    "fixed",
    "0004",
  );
  ambientNpc(
    e,
    "published-argument",
    "Boulanger en colère",
    30,
    18,
    GRAPHICS.artisan,
    "Ils ont pris mon four pour les convois. Cette fois, la place entière l'a lu.",
    "custom",
    "0004",
  );
  ambientNpc(
    e,
    "confidential-arrest",
    "Officier de Lyra",
    34,
    14,
    GRAPHICS.soldierBlue,
    "Les bureaux sont consignés. Le Conseil dira que Lyra protège la ville de ses propres archives.",
    "fixed",
    "0005",
  );
  ambientNpc(
    e,
    "confidential-clerk",
    "Greffier retenu",
    33,
    13,
    GRAPHICS.monkPurple,
    "Je signerai ma déposition, mais pas la version que votre capitaine a déjà préparée.",
    "fixed",
    "0005",
  );
  ambientNpc(
    e,
    "faubourg-refugee-a",
    "Famille du Four",
    10,
    31,
    GRAPHICS.refugee,
    "On nous a donné deux couvertures et l'ancien dépôt de sel. Nous sommes vivants. Nous sommes aussi furieux.",
    "custom",
    "0010",
  );
  ambientNpc(
    e,
    "faubourg-refugee-b",
    "Réfugiée du faubourg",
    16,
    30,
    GRAPHICS.refugee,
    "Serah a ouvert la rue. Maintenant je cherche mon frère parmi ceux qui ont choisi l'autre sortie.",
    "custom",
    "0010",
  );
  ambientNpc(
    e,
    "faubourg-healer",
    "Soigneuse du camp",
    11,
    35,
    GRAPHICS.monkYellow,
    "Les brûlures d'abord, les questions ensuite. Tenez cette bande si vous voulez aider.",
    "custom",
    "0010",
  );
  ambientNpc(
    e,
    "repaired-dike-watch",
    "Veilleur de la vanne",
    25,
    25,
    GRAPHICS.soldierBlue,
    "La vanne tient. Harel exige quand même une relève toutes les deux heures.",
    "custom",
    "0063",
  );
  ambientNpc(
    e,
    "returning-resident",
    "Habitante revenue",
    47,
    32,
    GRAPHICS.villager,
    "J'ai remis la table avant le lit. Une maison redevient la vôtre quand quelqu'un peut y inviter un voisin.",
    "custom",
    "0063",
  );
  once(
    e,
    "unclaimed-room",
    "Chambre sans propriétaire",
    18,
    38,
    GRAPHICS.rune,
    [
      say(
        null,
        "La serrure ne vous reconnaît pas. Pourtant votre main trouve seule le crochet caché sous le linteau.",
      ),
      say(
        null,
        "Une chanson vous revient, juste assez pour savoir qu'une autre voix devrait répondre au dernier vers.",
      ),
      addVar("0011", 1),
    ],
    "La porte reste anonyme. Le dernier vers de la chanson, lui, refuse de partir.",
  );
  once(
    e,
    "council-roof-cache",
    "Belvédère du Conseil",
    40,
    6,
    GRAPHICS.rune,
    [
      say(
        null,
        "Depuis le second palier, les canaux dessinent une couronne incomplète. Une lettre coincée sous la balustrade porte une écriture qui vous serre la gorge.",
      ),
      say(
        null,
        "Vous ne reconnaissez ni le nom effacé ni la main. Vous reconnaissez seulement la façon dont la plume hésite avant le dernier mot.",
      ),
      { t: "changeGold", amount: 45 },
      addVar("0009", 1),
      addVar("0011", 1),
    ],
    "Le belvédère montre toute la ville, mais aucune rue ne ressemble encore à un retour.",
  );
  once(
    e,
    "dike-maintenance-cache",
    "Réserve de la digue",
    53,
    19,
    GRAPHICS.rune,
    [
      say(
        null,
        "Derrière une grille de maintenance, des ouvriers ont caché des soins et la liste réelle des rondes de nuit.",
      ),
      { t: "changeItems", itemId: "health_potion", count: 2 },
      { t: "changeGold", amount: 25 },
      addVar("0010", 1),
    ],
    "La réserve est vide. La liste des rondes reste annotée dans votre carnet.",
  );
  portal(
    e,
    "to-faubourg",
    "Porte des Traîtres",
    55,
    22,
    { map: "faubourg", col: 5, row: 22 },
    ["0004", "0005"],
    "Lyra refuse une sortie sans preuve vérifiée. Les registres du quartier des archives peuvent encore être comparés.",
    "geographic",
    GRAPHICS.soldierRed,
    "La sentinelle ouvre la Porte des Traîtres. Le faubourg commence derrière le rempart oriental.",
  );
  portal(
    e,
    "to-prologue",
    "Porte occidentale",
    4,
    40,
    { map: "prologue", col: 51, row: 10 },
    [],
    "",
    "geographic",
    GRAPHICS.soldierBlue,
    "Le garde rouvre la Porte occidentale vers la Route des Bornes arrachées.",
  );
  portal(
    e,
    "shortcut-relay",
    "Aqueduc du relais",
    52,
    39,
    { map: "relay", col: 8, row: 36 },
    ["0058"],
    "La grille de l’aqueduc est verrouillée depuis l’autre côté.",
    "shortcut",
    GRAPHICS.artisan,
    "L’ouvrière soulève la grille. Le conduit rejoint directement le Relais des Quatre Dettes.",
  );
  monsterPack(e, "seep", "Noyé des vannes", "skull_guard", [
    cell(45, 27),
    cell(48, 28),
    cell(50, 30),
    cell(54, 28),
  ]);
  e.monster(
    "seep-warden",
    "Gardien de la brèche",
    cell(50, 25),
    "skull_warden",
    {
      rank: "elite",
      maxHp: 260,
      damage: 28,
      speed: 82,
      xp: 210,
      weakness: "priest",
      weaknessPercent: 150,
      specialTechnique: "grave_siphon",
    },
    [],
    undefined,
    ["0063"],
  );
  return bundleMap(
    "aubeval",
    "Aubeval — Les Digues hautes",
    terrainLayers("aubeval", {
      water: [
        { col: 12, row: 2, width: 3, height: 26 },
        { col: 12, row: 32, width: 3, height: 11 },
        { col: 27, row: 17, width: 3, height: 26 },
        { col: 43, row: 2, width: 3, height: 20 },
      ],
      carve: [
        { col: 12, row: 11, width: 3, height: 5 },
        { col: 12, row: 35, width: 3, height: 4 },
        { col: 27, row: 23, width: 3, height: 5 },
        { col: 43, row: 14, width: 3, height: 5 },
      ],
      elevation: [
        { col: 30, row: 3, width: 13, height: 13, level: 1 },
        { col: 46, row: 3, width: 12, height: 17, level: 1 },
        { col: 36, row: 4, width: 7, height: 9, level: 2 },
      ],
      stairs: [
        { col: 29, row: 14, direction: "east", lowLevel: 0 },
        { col: 45, row: 17, direction: "east", lowLevel: 0 },
        { col: 35, row: 10, direction: "east", lowLevel: 1 },
      ],
    }),
    spawn,
    e.events,
    mapElements("city", "aubeval", e, spawn, [
      // Fortified western entrance and military quarter.
      element(BUILDINGS.blueTower, 3, 34),
      element(BUILDINGS.blueTower, 8, 34),
      element(BUILDINGS.blueTower, 4, 24),
      element(BUILDINGS.blueHouse1, 9, 27),
      element(BUILDINGS.blueBarracks, 16, 8),
      element(BUILDINGS.blueArchery, 7, 9),
      element(BUILDINGS.blueHouse1, 18, 5),
      element(BUILDINGS.blueHouse2, 23, 8),
      element(SCENERY.tool1, 13, 16),
      element(SCENERY.tool3, 16, 17),
      // Administrative terrace and archives, visibly above the flood plain.
      element(BUILDINGS.blueCastle, 31, 7),
      element(BUILDINGS.blueMonastery, 47, 8),
      element(BUILDINGS.blueHouse1, 49, 16),
      element(SCENERY.memorial, 44, 34),
      // Market square: stalls, stores and visible reserves.
      element(SCENERY.marketRed, 20, 19),
      element(SCENERY.marketBlue, 24, 19),
      element(SCENERY.marketRed, 28, 19),
      element(SCENERY.marketBlue, 32, 20),
      element(SCENERY.meat, 21, 23),
      element(SCENERY.gold, 29, 23),
      element(BUILDINGS.yellowHouse3, 23, 16),
      // Dike works and the low quarter.
      element(SCENERY.bridgeHorizontal, 11, 12),
      element(SCENERY.bridgeHorizontal, 11, 36),
      element(SCENERY.bridgeHorizontal, 26, 24),
      element(SCENERY.bridgeHorizontal, 42, 15),
      element(SCENERY.tool1, 16, 24),
      element(SCENERY.tool2, 19, 25),
      element(SCENERY.tool3, 22, 25),
      element(SCENERY.tool4, 24, 27),
      element(SCENERY.wood, 17, 27),
      element(SCENERY.wood, 20, 28),
      element(BUILDINGS.blueHouse1, 17, 33),
      element(BUILDINGS.blueHouse2, 24, 36),
      element(BUILDINGS.yellowHouse3, 20, 31),
      element(BUILDINGS.yellowHouse1, 32, 31),
      element(BUILDINGS.yellowHouse2, 42, 32),
      element(BUILDINGS.yellowHouse3, 34, 27),
      element(BUILDINGS.ruinedHouse, 39, 28),
      element(BUILDINGS.blueHouse1, 34, 39),
      element(BUILDINGS.blueHouse2, 44, 39),
      element(BUILDINGS.ruinedHouse, 49, 31),
      element(BUILDINGS.blueTower, 53, 12),
      element(SCENERY.reeds, 46, 28),
      element(SCENERY.rock3, 51, 27),
      element(SCENERY.bush1, 7, 29),
      element(SCENERY.bush2, 10, 28),
    ]),
  );
}

function buildFaubourg(refs: StoryRefs): AdventureBundleMap {
  const e = createEventFactory("faubourg", refs);
  const spawn = cell(5, 22);
  npc(e, "serah", "Serah", 10, 20, GRAPHICS.serah, [
    "Mon père a découvert les convois. Puis il a pendu deux officiers sans procès et muré la rue du Four avec des familles encore dedans.",
    "Si vous le jugez, jugez tout. Je ne servirai ni le Conseil qui efface ses victimes, ni une rébellion qui blanchit les siennes.",
  ]);
  once(
    e,
    "convoy-yard",
    "Cour des chariots",
    22,
    12,
    GRAPHICS.rune,
    [
      say(
        null,
        "Les essieux portent le sceau royal sous la boue. Une caisse trie les menottes d’enfant par taille ; un bordereau classe les adultes selon les métiers utiles aux canaux.",
      ),
      addVar("0009", 2),
    ],
    "Les menottes et les marques d’essieu ont été consignées. Varkesh ne peut plus nier leur provenance.",
  );
  e.normal("evacuation", "Maison du Four", cell(17, 31), GRAPHICS.refugee, [
    page(
      [
        say(
          "Tessa",
          "Le mur de Varkesh nous protège des morts et nous enferme avec la fumée. Ouvrez côté rivière, et ses archers verront la brèche.",
        ),
        choice("Comment évacuer la rue ?", [
          {
            label: "Ouvrir la brèche malgré le risque",
            body: [
              switchOn("0010"),
              addVar("0010", 3),
              addVar("0003", 1),
              switchOn("0041"),
              activity("evacuer_faubourg"),
            ],
          },
          {
            label: "Attendre la relève de Lyra",
            body: [
              switchOn("0010"),
              addVar("0010", 1),
              addVar("0002", 2),
              addVar("0006", 1),
              activity("evacuer_faubourg"),
              say(
                "Tessa",
                "Nous attendrons. Si le vent tourne avant la relève, ce choix aura aussi un nom.",
              ),
            ],
          },
        ]),
        { t: "setSelfSwitch", selfSwitch: "A", value: true },
      ],
      { graphicAssetId: GRAPHICS.refugee },
    ),
    page(
      [
        say(
          "Tessa",
          "Les survivants ont rejoint la digue. La rue du Four reste un argument contre tous les camps.",
        ),
      ],
      { condSelfSwitch: "A", graphicAssetId: GRAPHICS.refugee },
    ),
  ]);
  once(
    e,
    "varkesh-proof",
    "Dossier de Varkesh",
    34,
    18,
    GRAPHICS.rune,
    [
      say(
        null,
        "Le dossier nomme les convois, puis trois ordres signés de Varkesh : relever les morts, exécuter les déserteurs, condamner la rue du Four.",
      ),
      switchOn("0009"),
      addVar("0009", 2),
      activity("preuve_varkesh"),
    ],
    "Les crimes du Conseil et ceux de Varkesh occupent des pages voisines. Aucun ne rature l’autre.",
  );
  e.normal("varkesh-parley", "Porte de Varkesh", cell(39, 20), GRAPHICS.soldierRed, [
    page(
      [
        say(
          "Serah",
          "Il ne parlera qu’après lecture du dossier. Cherchez ses ordres dans l’ancien poste de péage.",
        ),
      ],
      { graphicAssetId: GRAPHICS.soldierRed },
    ),
    page(
      [
        say(
          "Varkesh",
          "J’ai vu les chariots et compris que notre paix reposait sur des gens qu’aucun registre ne pleurerait. J’ai ensuite cru que ma colère me donnait tous les droits.",
        ),
        say(
          "Varkesh",
          "Tuez-moi, livrez-moi, ou prenez mes hommes jusqu’au Sanctuaire. Mais emportez les preuves : Varos compte sur votre dégoût pour les brûler avec moi.",
        ),
        choice("Quel sort réserver à Varkesh ?", [
          {
            label: "L’affronter pour l’exécuter",
            body: [
              switchOn("0075"),
              addVar("0002", 2),
              addVar("0005", 1),
              { t: "setSelfSwitch", selfSwitch: "A", value: true },
              teleport("faubourg", 51, 9, "recovery"),
            ],
          },
          {
            label: "Le vaincre et le capturer",
            body: [
              switchOn("0076"),
              addVar("0004", 2),
              addVar("0002", 1),
              { t: "setSelfSwitch", selfSwitch: "A", value: true },
              teleport("faubourg", 51, 9, "recovery"),
            ],
          },
          {
            label: "Négocier une trêve limitée",
            body: [
              switchOn("0077"),
              switchOn("0008"),
              switchOn("0041"),
              addVar("0003", 2),
              addVar("0004", 1),
              addVar("0005", 1),
              addVar("0007", 1),
              activity("sort_varkesh"),
              { t: "setSelfSwitch", selfSwitch: "A", value: true },
            ],
          },
        ]),
      ],
      { condSwitchId: "0009", graphicAssetId: GRAPHICS.soldierRed },
    ),
    page(
      [
        say(
          "Serah",
          "La décision est prise. Je la défendrai seulement si nous conservons aussi le dossier complet.",
        ),
      ],
      { condSelfSwitch: "A", graphicAssetId: GRAPHICS.serah },
    ),
  ]);
  e.monster(
    "varkesh",
    "Varkesh",
    cell(51, 8),
    "skull_warden",
    {
      rank: "boss",
      maxHp: 1_400,
      damage: 28,
      speed: 82,
      xp: 850,
      weakness: "priest",
      weaknessPercent: 165,
      specialTechnique: "bone_cleave",
    },
    [
      ifSwitch(
        "0076",
        [
          switchOn("0007"),
          say(
            "Serah",
            "Posez les armes, père. Tu répondras aux familles et aux soldats, dans la même salle.",
          ),
        ],
        [
          switchOn("0006"),
          say(
            "Varkesh",
            "Gardez le dossier. Si ma mort devient une excuse, j’aurai encore servi ceux que je combattais.",
          ),
        ],
      ),
      switchOn("0041"),
      addVar("0007", 1),
      activity("sort_varkesh"),
      teleport("faubourg", 38, 24, "recovery"),
    ],
    undefined,
    ["0075", "0076"],
  );
  npc(e, "varos-seal", "Sceau de Varos", 29, 8, GRAPHICS.varos, [
    "Varkesh a raison sur les convois et tort sur presque tout ce qu’il en a conclu. La vérité ne choisit pas automatiquement un bon commandant.",
    "Je vous offre ses registres sans condition. Je préfère être jugé sur le système réel que remplacé par un homme qui improvise avec les morts.",
  ]);
  once(
    e,
    "three-houses",
    "Trois portes murées",
    13,
    10,
    GRAPHICS.rune,
    [
      say(
        null,
        "Derrière les briques, trois tables sont encore dressées. Les noms gravés au couteau correspondent aux absents d’Aubeval.",
      ),
      switchOn("0062"),
      addVar("0010", 1),
      addVar("0011", 1),
      activity("trois_places_vides"),
    ],
    "Les portes sont ouvertes. Des proches viennent identifier les objets sans qu’on leur promette des survivants.",
  );
  portal(
    e,
    "back-aubeval",
    "Sentinelle d’Aubeval",
    4,
    22,
    { map: "aubeval", col: 53, row: 22 },
    [],
    "",
    "geographic",
    GRAPHICS.soldierRed,
    "La sentinelle vous raccompagne par la Porte des Traîtres jusqu’au rempart oriental d’Aubeval.",
  );
  portal(
    e,
    "to-relay",
    "Route du vieux relais",
    55,
    35,
    { map: "relay", col: 5, row: 35 },
    ["0006", "0007", "0008"],
    "Les factions refusent de dégager la route tant que le sort de Varkesh n’est pas décidé.",
    "geographic",
    GRAPHICS.refugee,
    "La guide du convoi prend la route du sud-est. Le vieux relais se trouve après les maisons brûlées.",
  );
  monsterPack(e, "ash-raiders", "Pillard des cendres", "torch_goblin", [
    cell(20, 35),
    cell(26, 28),
    cell(33, 34),
    cell(44, 32),
  ]);
  monsterPack(e, "oath-dead", "Mort du rempart", "skull_guard", [
    cell(46, 12),
    cell(49, 12),
    cell(53, 12),
  ]);
  explorationCache(
    e,
    "rempart-cache",
    "Guérite condamnée",
    55,
    6,
    "Au second rempart, une guérite dissimule les soldes de trois gardes déclarés déserteurs le même jour.",
    35,
  );
  return bundleMap(
    "faubourg",
    "Faubourg de la Porte",
    terrainLayers("faubourg", {
      water: [
        { col: 45, row: 2, width: 3, height: 31 },
        { col: 48, row: 15, width: 10, height: 3 },
        { col: 8, row: 25, width: 25, height: 3 },
        { col: 34, row: 27, width: 3, height: 16 },
      ],
      carve: [
        { col: 45, row: 20, width: 3, height: 5 },
        { col: 50, row: 15, width: 4, height: 3 },
        { col: 16, row: 25, width: 5, height: 3 },
        { col: 34, row: 33, width: 3, height: 5 },
      ],
    }),
    spawn,
    e.events,
    mapElements("city", "faubourg", e, spawn, [
      element(BUILDINGS.ruinedHouse, 15, 15),
      element(BUILDINGS.ruinedHouse, 24, 19),
      element(BUILDINGS.ruinedHouse, 31, 12),
      element(BUILDINGS.ruinedTower, 40, 8),
      element(BUILDINGS.blackBarracks, 49, 7),
      element(BUILDINGS.blueHouse1, 9, 32),
    ]),
  );
}

function buildRelay(refs: StoryRefs): AdventureBundleMap {
  const e = createEventFactory("relay", refs);
  const spawn = cell(5, 35);
  npc(e, "keeper", "Rime", 12, 33, GRAPHICS.villager, [
    "Le relais servait aux quatre peuples. Chaque voyageur nommait ce qu’il recevait, puis ce qu’il devait. La Couronne a gardé la seconde colonne et brûlé la première.",
    "Rouvrez les quatre volets. Les routes anciennes répondent encore quand les comptes sont dits à voix haute.",
  ]);
  const debts = [
    [
      "grain",
      "Table du grain",
      20,
      14,
      "Aubeval promettait des semences après chaque crue, pas des soldats.",
    ],
    [
      "passage",
      "Table du passage",
      33,
      12,
      "Les clans des Bois garantissaient un chemin sûr, mais chacun gardait le droit de refuser.",
    ],
    [
      "noms",
      "Table des noms",
      43,
      24,
      "Les gens du Marais conservaient les noms des morts afin qu’aucun prix ne disparaisse dans les comptes.",
    ],
    [
      "veille",
      "Table de la veille",
      28,
      35,
      "La Citadelle prêtait des gardes pour une saison. Le serment prenait fin devant témoins.",
    ],
  ] as const;
  debts.forEach(([key, name, col, row, text], index) => {
    once(
      e,
      `debt-${key}`,
      name,
      col,
      row,
      GRAPHICS.rune,
      [
        say(null, text),
        addVar("0020", 1),
        activity(`dette_${key}`),
        ...(index === 3 ? [switchOn("0011"), switchOn("0058"), activity("relais_rouvert")] : []),
      ],
      "La table reste ouverte. Sa dette est lisible depuis la route.",
    );
  });
  npc(e, "varos-rider", "Cavalière de Varos", 48, 10, GRAPHICS.soldierBlack, [
    "Mon unité a escorté des convois. On nous disait qu’ils transportaient des volontaires endettés. J’ai cessé d’y croire au troisième chariot fermé de l’extérieur.",
    "Varos ne m’a pas fait tuer pour cet aveu. Il m’a montré les villages que la Source protège et m’a demandé lequel je condamnerais à leur place.",
  ]);
  npc(e, "camp-family", "Dela", 17, 36, GRAPHICS.refugee, [
    "Nous voyageons depuis huit jours. Le climat change plus vite que les bornes : poussière d’Aubeval ici, pluie froide après la prochaine crête.",
    "Les enfants savent que la guerre approche parce que les relais n’ont plus de chevaux frais.",
  ]);
  portal(
    e,
    "back-faubourg",
    "Route d’Aubeval",
    4,
    35,
    { map: "faubourg", col: 53, row: 35 },
    [],
    "",
    "geographic",
    GRAPHICS.refugee,
    "La famille reprend la route d’ouest vers les maisons brûlées du faubourg.",
  );
  portal(
    e,
    "shortcut-aubeval",
    "Aqueduc ancien",
    8,
    38,
    { map: "aubeval", col: 50, row: 39 },
    ["0058"],
    "Les volets du relais commandent encore cette vanne.",
    "shortcut",
    GRAPHICS.artisan,
    "Le vannier ouvre le conduit. L’aqueduc débouche près des installations de la digue d’Aubeval.",
  );
  portal(
    e,
    "to-woods",
    "Route de Clairécorce",
    55,
    8,
    { map: "woods", col: 5, row: 36 },
    ["0011"],
    "Les quatre volets du relais doivent être ouverts avant d’engager la route forestière.",
    "geographic",
    GRAPHICS.woodcutter,
    "La pisteuse montre les entailles jaunes. Suivez cette ancienne route jusqu’à la lisière de Clairécorce.",
  );
  monsterPack(e, "ambush", "Éclaireur du relais", "gnoll_marauder", [
    cell(18, 18),
    cell(25, 18),
    cell(37, 20),
    cell(47, 30),
  ]);
  monsterPack(e, "ambush-support", "Lieur de piste", "hex_shaman", [cell(21, 20), cell(34, 20)], {
    maxHp: 150,
    damage: 18,
    xp: 120,
    specialTechnique: "hex_burst",
  });
  monsterPack(e, "ambush-beasts", "Bête de bât volée", "war_pig", [cell(44, 28), cell(49, 27)]);
  explorationCache(
    e,
    "relay-height-cache",
    "Malle du vieux guet",
    43,
    6,
    "Le vieux guet domine les quatre routes. Sa malle contient des péages annulés et des provisions encore sèches.",
    30,
  );
  return bundleMap(
    "relay",
    "Relais des Quatre Dettes",
    terrainLayers("relay", {
      water: [
        { col: 2, row: 20, width: 19, height: 3 },
        { col: 39, row: 20, width: 19, height: 3 },
        { col: 27, row: 2, width: 5, height: 14 },
        { col: 27, row: 29, width: 5, height: 14 },
      ],
      carve: [
        { col: 11, row: 20, width: 5, height: 3 },
        { col: 45, row: 20, width: 5, height: 3 },
        { col: 27, row: 8, width: 5, height: 4 },
        { col: 27, row: 34, width: 5, height: 4 },
      ],
    }),
    spawn,
    e.events,
    mapElements("road", "relay", e, spawn, [
      element(BUILDINGS.yellowHouse1, 13, 30),
      element(BUILDINGS.yellowHouse2, 21, 31),
      element(BUILDINGS.yellowTower, 29, 18),
      element(BUILDINGS.ruinedHouse, 42, 31),
    ]),
  );
}

function buildWoods(refs: StoryRefs): AdventureBundleMap {
  const e = createEventFactory("woods", refs);
  const spawn = cell(5, 36);
  npc(e, "elyne", "Elyne", 10, 34, GRAPHICS.elyne, [
    "Le Pacte n’était pas une bénédiction des arbres. C’était un accord public : soin contre souvenir, récolte contre saison de vie, protection contre promesse.",
    "Nos chants omettent l’hiver où mes ancêtres ont livré des étrangers à la Source. Je veux sauver le Pacte sans sauver ce mensonge.",
  ]);
  e.normal("clan-choice", "Assemblée de Clairécorce", cell(20, 31), GRAPHICS.monkYellow, [
    page(
      [
        say(
          "Elyne",
          "La Sève veut fermer le Bois aux armées pour protéger les arbres nourriciers. L’Écorce veut ouvrir les routes et partager les réserves. Aucun choix ne préserve tout.",
        ),
        choice("Quel clan aider d’abord ?", [
          {
            label: "La Sève et ses arbres nourriciers",
            body: [
              switchOn("0012"),
              addVar("0008", 2),
              addVar("0002", 1),
              say(
                "Elyne",
                "Les sanctuaires tiendront. Les hameaux de lisière recevront moins de bois cet hiver.",
              ),
            ],
          },
          {
            label: "L’Écorce et ses routes",
            body: [
              switchOn("0013"),
              addVar("0004", 2),
              addVar("0003", 1),
              say(
                "Elyne",
                "Les vivres circuleront. Les racines sacrées subiront le passage des chariots.",
              ),
            ],
          },
        ]),
        activity("choix_clan"),
        { t: "setSelfSwitch", selfSwitch: "A", value: true },
      ],
      { graphicAssetId: GRAPHICS.monkYellow },
    ),
    page(
      [say("Elyne", "Le clan choisi prépare le passage. L’autre n’a pas oublié ce qu’il a perdu.")],
      { condSelfSwitch: "A", graphicAssetId: GRAPHICS.elyne },
    ),
  ]);
  once(
    e,
    "winter-ledger",
    "Écorce de l’hiver",
    35,
    12,
    GRAPHICS.rune,
    [
      say(
        null,
        "Les entailles comptent trente-deux étrangers livrés pendant la famine. Une seconde main a ensuite remplacé « étrangers » par « volontaires ».",
      ),
      switchOn("0064"),
      addVar("0001", 2),
      addVar("0009", 1),
      activity("etrangers_hiver"),
    ],
    "La copie conserve les deux mots, l’original et le mensonge gravé par-dessus.",
  );
  npc(e, "bark-elder", "Doyenne Nolda", 15, 16, GRAPHICS.villager, [
    "Je garde les greniers, pas les légendes. Si nous fermons les routes, j’ai des réserves pour vingt-sept jours. Le vingt-huitième décidera de notre vertu.",
  ]);
  npc(e, "reed-guide", "Haran d’Écorce", 43, 32, GRAPHICS.woodcutter, [
    "Les vieilles routes suivent les marques basses sur les troncs. Les marques hautes ont été ajoutées par la Couronne pour guider ses collecteurs.",
    "Les coupeurs du nord se nomment Conclave du Creux. Varos leur a promis les clairières dont nos deux clans les ont chassés.",
    "Ouvrez le passage du sud depuis l’autre côté et les blessés du Marais pourront rejoindre nos herboristes.",
  ]);
  npc(e, "varos-raven", "Corbeau de cuivre", 46, 9, GRAPHICS.varos, [
    "Elyne vous montrera les victimes de la Couronne. Demandez-lui aussi qui les siens ont sacrifié avant qu’un roi ne porte la faute à leur place.",
    "Je ne vous demande pas de me croire. Je vous demande d’exiger la même précision de tous vos alliés.",
  ]);
  once(
    e,
    "marked-trees",
    "Arbres marqués",
    27,
    20,
    GRAPHICS.rune,
    [
      say(
        null,
        "Trois systèmes se superposent : une marque de partage, une marque royale de coupe, puis une entaille récente indiquant les arbres malades.",
      ),
      activity("deux_lois"),
      addVar("0001", 1),
    ],
    "Les trois systèmes restent lisibles. Le Bois n’a jamais obéi à une seule loi.",
  );
  portal(
    e,
    "back-relay",
    "Pisteuse de la lisière",
    4,
    36,
    { map: "relay", col: 53, row: 8 },
    [],
    "",
    "geographic",
    GRAPHICS.woodcutter,
    "La pisteuse reprend l’ancienne route occidentale vers le Relais des Quatre Dettes.",
  );
  portal(
    e,
    "to-roots",
    "Escalier des racines",
    48,
    17,
    { map: "roots", col: 8, row: 36 },
    ["0012", "0013"],
    "Les gardiens demandent qu’un clan prenne la responsabilité du passage.",
    "interior",
    GRAPHICS.monkYellow,
    "Le gardien écarte les racines. L’escalier descend dans le Sanctuaire des Racines.",
  );
  portal(
    e,
    "shortcut-marsh",
    "Chemin des Saules",
    54,
    37,
    { map: "marsh", col: 6, row: 36 },
    ["0059"],
    "Les racines ont repris l’ancienne chaussée. Elle peut être dégagée depuis le sanctuaire profond.",
    "shortcut",
    GRAPHICS.woodcutter,
    "La pisteuse engage la chaussée restaurée. Elle rejoint les premiers pontons du Marais de Verre.",
  );
  monsterPack(e, "boars", "Bête marquée", "minotaur_brute", [
    cell(19, 9),
    cell(28, 14),
    cell(39, 18),
  ]);
  monsterPack(e, "crown-cutters", "Coupeur de la Couronne", "spear_goblin", [
    cell(32, 31),
    cell(42, 26),
    cell(49, 21),
  ]);
  monsterPack(
    e,
    "cutters-support",
    "Marqueur de coupe",
    "hex_shaman",
    [cell(36, 29), cell(46, 25)],
    { maxHp: 180, damage: 21, xp: 140, specialTechnique: "hex_burst" },
  );
  monsterPack(
    e,
    "cutters-riders",
    "Patrouilleur des routes",
    "pig_rider",
    [cell(37, 23), cell(47, 18)],
    { rank: "elite", maxHp: 280, damage: 27, xp: 210, specialTechnique: "mounted_trample" },
  );
  explorationCache(
    e,
    "canopy-cache",
    "Nid des arpenteurs",
    45,
    7,
    "Une ancienne plate-forme d'arpenteurs relie les routes de Sève et d'Écorce sans porter la marque d'aucun clan.",
    35,
  );
  return bundleMap(
    "woods",
    "Bois des Murmures — Clairécorce",
    terrainLayers("woods", {
      water: [
        { col: 11, row: 8, width: 8, height: 7 },
        { col: 24, row: 24, width: 11, height: 7 },
        { col: 43, row: 13, width: 9, height: 7 },
        { col: 8, row: 31, width: 17, height: 3 },
      ],
      carve: [
        { col: 14, row: 11, width: 3, height: 4 },
        { col: 28, row: 27, width: 4, height: 3 },
        { col: 46, row: 16, width: 4, height: 3 },
        { col: 16, row: 31, width: 5, height: 3 },
      ],
    }),
    spawn,
    e.events,
    mapElements("forest", "woods", e, spawn, [
      element(BUILDINGS.yellowHouse1, 8, 32),
      element(BUILDINGS.yellowHouse2, 16, 35),
      element(BUILDINGS.yellowMonastery, 29, 9),
      element(BUILDINGS.goblinHouse, 40, 34),
      element(BUILDINGS.ruinedGoblinHouse, 48, 27),
      element(BUILDINGS.ruinedGoblinTower, 51, 8),
    ]),
  );
}

function wrongRootStep(text: string): readonly EventCommand[] {
  return [
    say(null, text),
    setVar("0012", 0),
    addVar("0017", 1),
    teleport("roots", 9, 36, "recovery"),
  ];
}

function buildRoots(refs: StoryRefs): AdventureBundleMap {
  const e = createEventFactory("roots", refs);
  const spawn = cell(8, 36);
  npc(e, "oath-tablet", "Table du premier Pacte", 11, 34, GRAPHICS.rune, [
    "Le rite suit trois obligations : nommer le bienfait demandé ; laisser à chacun le droit de refuser ; répartir le prix devant des témoins.",
    "Une erreur ne condamne personne. Le bassin de retour efface la séquence et ramène le demandeur à la première salle.",
  ]);
  e.normal("root-reset", "Bassin de retour", cell(9, 38), GRAPHICS.rune, [
    page(
      [
        say(
          null,
          "L’eau efface seulement l’ordre des salles, jamais les indices gravés sur la table.",
        ),
        setVar("0012", 0),
        teleport("roots", 9, 36, "recovery"),
      ],
      { graphicAssetId: GRAPHICS.rune },
    ),
  ]);
  e.normal("root-one", "Salle de la demande", cell(17, 30), GRAPHICS.rune, [
    page(
      [
        ifVariable(
          "0012",
          1,
          [say(null, "La demande a déjà été nommée. La seconde salle attend.")],
          [
            choice("Quel mot ouvre le Pacte ?", [
              {
                label: "Le bienfait demandé",
                body: [
                  setVar("0012", 1),
                  say(
                    null,
                    "La racine répète : « Une moisson saine pour le hameau de Clairécorce. »",
                  ),
                  teleport("roots", 29, 23, "puzzle"),
                ],
              },
              {
                label: "Le nom du souverain",
                body: wrongRootStep(
                  "La racine refuse un maître absent. Le bassin rend la séquence à son début.",
                ),
              },
              {
                label: "Le nombre des débiteurs",
                body: wrongRootStep(
                  "Un compte sans bienfait ne décrit pas un pacte. Le bassin vous ramène.",
                ),
              },
            ]),
          ],
        ),
      ],
      { graphicAssetId: GRAPHICS.rune },
    ),
  ]);
  e.normal("root-two", "Salle du refus", cell(29, 23), GRAPHICS.rune, [
    page(
      [
        ifVariable(
          "0012",
          2,
          [say(null, "Le droit de refus a été posé. La dernière salle attend.")],
          [
            ifVariable(
              "0012",
              1,
              [
                choice("Qui peut refuser le prix ?", [
                  {
                    label: "Chaque personne appelée",
                    body: [
                      setVar("0012", 2),
                      say(null, "La porte s’ouvre sans exiger de serment."),
                      teleport("roots", 44, 13, "puzzle"),
                    ],
                  },
                  {
                    label: "Le chef au nom de tous",
                    body: wrongRootStep(
                      "Le mécanisme reconnaît la règle des rois, pas celle du Pacte.",
                    ),
                  },
                  {
                    label: "Personne pendant une crise",
                    body: wrongRootStep(
                      "La crise n’abolit pas le consentement dans le texte originel.",
                    ),
                  },
                ]),
              ],
              wrongRootStep(
                "La demande n’a pas encore été nommée. La salle vous renvoie au début.",
              ),
            ),
          ],
        ),
      ],
      { graphicAssetId: GRAPHICS.rune },
    ),
  ]);
  e.normal("root-three", "Salle des témoins", cell(44, 13), GRAPHICS.rune, [
    page(
      [
        ifSwitch(
          "0069",
          [say(null, "Le rite est complet. Les trois obligations restent visibles.")],
          [
            ifVariable(
              "0012",
              2,
              [
                choice("Comment le prix devient-il une dette commune ?", [
                  {
                    label: "Il est réparti et rendu public",
                    body: [
                      setVar("0012", 3),
                      switchOn("0069"),
                      switchOn("0059"),
                      addVar("0004", 2),
                      addVar("0008", 1),
                      addVar("0011", 1),
                      activity("rite_racines"),
                      teleport("roots", 48, 9, "puzzle"),
                    ],
                  },
                  {
                    label: "Il est confié aux prêtres",
                    body: wrongRootStep(
                      "Le texte donne aux prêtres un rôle de témoins, jamais celui de propriétaires.",
                    ),
                  },
                  {
                    label: "Il disparaît après paiement",
                    body: wrongRootStep(
                      "Une dette sans mémoire peut être prélevée deux fois. Le bassin vous rappelle.",
                    ),
                  },
                ]),
              ],
              wrongRootStep(
                "Les deux premières obligations manquent. Le bassin rétablit le parcours.",
              ),
            ),
          ],
        ),
      ],
      { graphicAssetId: GRAPHICS.rune },
    ),
  ]);
  e.normal("morvane-choice", "Morvane", cell(48, 9), GRAPHICS.monkYellow, [
    page(
      [
        say(
          null,
          "Les liens ne cèdent pas. Le rite des trois salles doit être accompli dans l’ordre indiqué sur la table.",
        ),
      ],
      { graphicAssetId: GRAPHICS.monkYellow },
    ),
    page(
      [
        say(
          "Elyne",
          "Morvane retient les souvenirs que nos anciens lui ont imposés. Le libérer rendra la forêt instable ; le garder enchaîné perpétue leur crime.",
        ),
        choice("Que faire de Morvane ?", [
          {
            label: "Le libérer et partager sa charge",
            body: [
              switchOn("0014"),
              switchOn("0042"),
              addVar("0004", 2),
              addVar("0008", 1),
              addVar("0016", 1),
              addVar("0007", 1),
              activity("sort_morvane"),
              { t: "setSelfSwitch", selfSwitch: "A", value: true },
            ],
          },
          {
            label: "L’apaiser sans rompre tous les liens",
            body: [
              switchOn("0015"),
              switchOn("0042"),
              addVar("0002", 1),
              addVar("0008", 2),
              addVar("0020", 1),
              addVar("0007", 1),
              activity("sort_morvane"),
              { t: "setSelfSwitch", selfSwitch: "A", value: true },
            ],
          },
          {
            label: "Le tuer pour arrêter les prélèvements",
            body: [
              switchOn("0080"),
              addVar("0003", 1),
              addVar("0017", 1),
              { t: "setSelfSwitch", selfSwitch: "A", value: true },
              teleport("roots", 51, 34, "recovery"),
            ],
          },
          {
            label: "Confier sa puissance au clan choisi",
            body: [
              switchOn("0017"),
              switchOn("0042"),
              addVar("0002", 2),
              addVar("0005", 1),
              addVar("0007", 1),
              activity("sort_morvane"),
              { t: "setSelfSwitch", selfSwitch: "A", value: true },
            ],
          },
        ]),
      ],
      { condSwitchId: "0069", graphicAssetId: GRAPHICS.monkYellow },
    ),
    page(
      [
        say(
          "Elyne",
          "Le sort de Morvane est fixé. Mon peuple devra raconter aussi la part qui nous accuse.",
        ),
      ],
      { condSelfSwitch: "A", graphicAssetId: GRAPHICS.elyne },
    ),
  ]);
  e.monster(
    "morvane",
    "Morvane déchaîné",
    cell(51, 33),
    "mire_troll",
    {
      rank: "boss",
      maxHp: 1_900,
      damage: 34,
      speed: 72,
      xp: 1_100,
      weakness: "ranger",
      weaknessPercent: 165,
      specialTechnique: "troll_quake",
    },
    [
      switchOn("0016"),
      addVar("0003", 2),
      addVar("0017", 2),
      activity("sort_morvane"),
      teleport("roots", 47, 11, "recovery"),
    ],
    undefined,
    ["0080"],
  );
  npc(e, "varos-root", "Voix de Varos", 25, 10, GRAPHICS.varos, [
    "Le rite ancien fonctionne pour trente personnes qui se connaissent. J’administre des royaumes où une province ne sait pas si l’autre a déjà payé.",
    "Montrez-moi un partage qui survive à la famine, et je renoncerai volontiers à une partie de mon pouvoir. Je ne renoncerai pas sur une chanson.",
  ]);
  portal(
    e,
    "back-woods",
    "Racines de Clairécorce",
    7,
    39,
    { map: "woods", col: 48, row: 18 },
    [],
    "",
    "interior",
    GRAPHICS.monkYellow,
    "Le gardien vous ramène par l’escalier jusqu’au plateau central de Clairécorce.",
  );
  portal(
    e,
    "to-marsh",
    "Tunnel des Saules",
    54,
    39,
    { map: "marsh", col: 6, row: 36 },
    ["0014", "0015", "0016", "0017"],
    "Morvane retient encore la route noyée.",
    "interior",
    GRAPHICS.monkPurple,
    "Le passeur des racines ouvre le tunnel humide. Il ressort aux Saules du Marais de Verre.",
  );
  monsterPack(e, "root-dead", "Gardien des racines", "skull_crusader", [
    cell(20, 20),
    cell(38, 14),
    cell(35, 33),
  ]);
  monsterPack(
    e,
    "root-line",
    "Servant des chambres",
    "skull_guard",
    [cell(19, 20), cell(39, 14), cell(34, 33)],
    { maxHp: 210, damage: 23, xp: 155, specialTechnique: "bone_cleave" },
  );
  e.monster("root-line-warden", "Intendant du prix", cell(29, 24), "skull_warden", {
    rank: "elite",
    maxHp: 390,
    damage: 31,
    xp: 280,
    weakness: "priest",
    weaknessPercent: 150,
    specialTechnique: "grave_siphon",
  });
  explorationCache(
    e,
    "root-height-cache",
    "Offrande sans nom",
    53,
    6,
    "Au dernier palier, l'offrande ne porte aucun nom : seulement une émotion de retour et une fiole intacte.",
    25,
  );
  return bundleMap(
    "roots",
    "Sanctuaire des Racines",
    terrainLayers("roots", {
      water: [
        { col: 21, row: 2, width: 4, height: 34 },
        { col: 36, row: 9, width: 4, height: 34 },
        { col: 2, row: 26, width: 19, height: 4 },
        { col: 25, row: 17, width: 11, height: 4 },
        { col: 40, row: 25, width: 18, height: 4 },
      ],
      carve: [
        { col: 21, row: 29, width: 4, height: 4 },
        { col: 36, row: 19, width: 4, height: 4 },
        { col: 13, row: 26, width: 4, height: 4 },
        { col: 29, row: 17, width: 4, height: 4 },
        { col: 47, row: 25, width: 5, height: 4 },
      ],
    }),
    spawn,
    e.events,
    mapElements("sacred", "roots", e, spawn, [
      element(BUILDINGS.yellowMonastery, 8, 31),
      element(BUILDINGS.purpleMonastery, 28, 12),
      element(BUILDINGS.ruinedCastle, 44, 8),
      element(BUILDINGS.ruinedGoblinHouse, 47, 34),
    ]),
  );
}

function buildMarsh(refs: StoryRefs): AdventureBundleMap {
  const e = createEventFactory("marsh", refs);
  const spawn = cell(6, 36);
  npc(e, "talen", "Talen", 11, 35, GRAPHICS.talen, [
    "J’ai corrigé les registres du neuvième convoi. Au début, je croyais protéger des témoins. Ensuite j’ai continué pour que ma sœur reste sur la liste des soins.",
    "Les Archives conservent les versions effacées. Nhalgor les empêche de remonter, mais il empêche aussi Varos de les reprendre.",
  ]);
  npc(e, "maelys", "Maëlys", 19, 33, GRAPHICS.maelys, [
    "Je suis la dernière Veilleuse à avoir rompu avec le siège. Je peux chasser ses collecteurs ; je ne sais pas encore remplacer les digues ni le lumen des dispensaires.",
    "Aidez-moi à mesurer ce qui tient sans la Source. Une révolte qui refuse les comptes finit par les confier au premier administrateur disponible.",
  ]);
  e.normal("dike", "Digue des Saules", cell(24, 27), GRAPHICS.artisan, [
    page(
      [
        say(
          "Maëlys",
          "Les vannes royales fermeraient le chenal et noieraient le hameau amont. Les pieux manuels sauveraient les deux rives, mais pas avant la prochaine pluie.",
        ),
        choice("Quelle réparation engager ?", [
          {
            label: "Répartir les équipes sur les deux rives",
            body: [
              switchOn("0024"),
              switchOn("0063"),
              addVar("0010", 2),
              addVar("0004", 1),
              addVar("0008", 1),
              activity("digue_marais"),
            ],
          },
          {
            label: "Fermer immédiatement la vanne royale",
            body: [
              switchOn("0024"),
              addVar("0002", 2),
              addVar("0008", 2),
              addVar("0010", 1),
              activity("digue_marais"),
              say(
                "Maëlys",
                "La rive basse est sauvée. J’irai annoncer moi-même à l’amont ce que nous leur avons pris.",
              ),
            ],
          },
        ]),
        { t: "setSelfSwitch", selfSwitch: "A", value: true },
      ],
      { graphicAssetId: GRAPHICS.artisan },
    ),
    page(
      [
        say(
          "Maëlys",
          "La digue tient. Le registre indique désormais quelles équipes ont travaillé et quelle rive a supporté le risque.",
        ),
      ],
      { condSelfSwitch: "A", graphicAssetId: GRAPHICS.maelys },
    ),
  ]);
  once(
    e,
    "child-voice",
    "Mila",
    38,
    31,
    GRAPHICS.child,
    [
      say(
        "Mila",
        "La femme dans l’eau parle avec ma voix. Elle connaît la chanson de mon père, mais elle se trompe au dernier mot.",
      ),
      say(null, "Le reflet rend la voix quand Mila chante elle-même le dernier vers."),
      switchOn("0025"),
      switchOn("0065"),
      addVar("0001", 1),
      addVar("0019", 1),
      activity("voix_empruntee"),
    ],
    "Je parle bas pour ménager ma gorge. Mon reflet bouge de nouveau avec moi.",
  );
  const memories = [
    [
      "memory-farmer",
      "Mémoire du semeur",
      15,
      17,
      "Un homme accepte de perdre un été de vie pour sauver les semences du village.",
    ],
    [
      "memory-guard",
      "Mémoire du garde",
      31,
      14,
      "Une conscrite signe sous la menace que sa famille perde la protection des crues.",
    ],
    [
      "memory-child",
      "Mémoire sans nom",
      46,
      20,
      "Un enfant compte neuf chariots. Dans le rapport officiel, le neuvième n’existe pas.",
    ],
  ] as const;
  memories.forEach(([key, name, col, row, text]) => {
    once(
      e,
      key,
      name,
      col,
      row,
      GRAPHICS.rune,
      [say(null, text), addVar("0001", 1), addVar("0009", 1), activity("fragment_marais")],
      "Le souvenir demeure incomplet, mais sa date et son témoin sont désormais consignés.",
    );
  });
  e.normal("nhalgor-clue", "Reflet de Nhalgor", cell(49, 9), GRAPHICS.varos, [
    page(
      [
        say(
          "Nhalgor",
          "Je noie les archives parce que la Couronne sait transformer toute mémoire en dette nouvelle. Me vaincre ne garantit pas que vous saurez mieux les garder.",
        ),
        switchOn("0078"),
        activity("intentions_nhalgor"),
        { t: "setSelfSwitch", selfSwitch: "A", value: true },
      ],
      { graphicAssetId: GRAPHICS.varos },
    ),
    page(
      [
        say(
          "Nhalgor",
          "Apportez les trois dates. Une preuve sans ordre devient l’arme de celui qui la raconte le plus vite.",
        ),
      ],
      { condSelfSwitch: "A", graphicAssetId: GRAPHICS.varos },
    ),
  ]);
  npc(e, "varos-mirror", "Miroir de Varos", 28, 35, GRAPHICS.varos, [
    "Je pourrais assécher les Archives et rendre chaque souvenir à son propriétaire. Certains mourraient sous le poids d’une vie entière revenue en une minute.",
    "Nhalgor appelle cela protection. Demandez-lui combien de vivants il a privés d’eux-mêmes sans leur consentement.",
  ]);
  portal(
    e,
    "back-woods",
    "Chaussée des Bois",
    4,
    38,
    { map: "woods", col: 52, row: 37 },
    ["0059"],
    "La chaussée est encore prise dans les racines du Sanctuaire.",
    "geographic",
    GRAPHICS.woodcutter,
    "La passeuse suit les pieux hors de l’eau. La chaussée remonte jusqu’à la lisière sud de Clairécorce.",
  );
  portal(
    e,
    "to-archives",
    "Clocher englouti",
    51,
    9,
    { map: "archives", col: 7, row: 36 },
    ["0078"],
    "Le reflet demeure opaque. Il faut d’abord écouter ce que Nhalgor affirme protéger.",
    "magical",
    GRAPHICS.talen,
    "Talen frappe la cloche noyée. Son reflet ouvre un souvenir matérialisé vers les Archives sous la Vase.",
  );
  portal(
    e,
    "shortcut-citadel",
    "Poterne des digues",
    55,
    35,
    { map: "citadel", col: 53, row: 36 },
    ["0060"],
    "La poterne militaire est verrouillée depuis la Citadelle.",
    "shortcut",
    GRAPHICS.soldierBlack,
    "L’éclaireur dégage la poterne. Le tunnel rejoint la cour basse de la Citadelle.",
  );
  monsterPack(e, "glass-dead", "Souvenir hostile", "skull_guard", [
    cell(18, 24),
    cell(28, 22),
    cell(41, 26),
    cell(50, 31),
  ]);
  monsterPack(e, "mire", "Maraudeur des pontons", "gnoll_marauder", [cell(20, 10), cell(36, 10)]);
  monsterPack(e, "mire-tolls", "Troll du péage noyé", "mire_troll", [cell(24, 10), cell(40, 10)], {
    rank: "elite",
    maxHp: 410,
    damage: 31,
    xp: 270,
    specialTechnique: "troll_sweep",
  });
  monsterPack(
    e,
    "glass-support",
    "Collecteur de souvenirs",
    "hex_shaman",
    [cell(19, 24), cell(42, 26)],
    { maxHp: 175, damage: 22, xp: 145, specialTechnique: "hex_burst" },
  );
  explorationCache(
    e,
    "sunken-belfry-cache",
    "Niche du sonneur",
    55,
    5,
    "La niche haute du clocher conserve une corde sèche, des soins et la liste des îlots autrefois reliés par la digue.",
    30,
  );
  return bundleMap(
    "marsh",
    "Marais de Verre — Les Saules",
    terrainLayers("marsh", {
      water: [
        { col: 2, row: 7, width: 56, height: 6 },
        { col: 8, row: 20, width: 18, height: 7 },
        { col: 34, row: 19, width: 22, height: 7 },
        { col: 26, row: 31, width: 7, height: 12 },
      ],
      carve: [
        { col: 8, row: 9, width: 44, height: 2 },
        { col: 28, row: 7, width: 3, height: 6 },
        { col: 16, row: 20, width: 4, height: 7 },
        { col: 43, row: 19, width: 4, height: 7 },
        { col: 28, row: 31, width: 3, height: 8 },
      ],
    }),
    spawn,
    e.events,
    mapElements("marsh", "marsh", e, spawn, [
      element(BUILDINGS.yellowHouse1, 9, 34),
      element(BUILDINGS.yellowHouse2, 17, 35),
      element(BUILDINGS.ruinedHouse, 35, 32),
      element(BUILDINGS.ruinedTower, 49, 12),
      element(BUILDINGS.blackTower, 52, 7),
    ]),
  );
}

function wrongArchiveStep(text: string): readonly EventCommand[] {
  return [
    say(null, text),
    setVar("0013", 0),
    addVar("0017", 1),
    teleport("archives", 8, 36, "recovery"),
  ];
}

function buildArchives(refs: StoryRefs): AdventureBundleMap {
  const e = createEventFactory("archives", refs);
  const spawn = cell(7, 36);
  npc(e, "date-table", "Table des marées", 10, 34, GRAPHICS.rune, [
    "Les cotes donnent l’ordre : fondation avant la crue ; passage du neuvième convoi pendant la décrue ; relevé actuel après l’effondrement des digues.",
    "Chaque porte montre une version vraie, mais les franchir hors chronologie mélange les témoins. Le bassin d’entrée permet de recommencer.",
  ]);
  e.normal("archive-reset", "Bassin d’entrée", cell(9, 38), GRAPHICS.rune, [
    page(
      [
        say(
          null,
          "Les trois dates se séparent de nouveau. Les documents restent lisibles pour un nouvel essai.",
        ),
        setVar("0013", 0),
        teleport("archives", 8, 36, "recovery"),
      ],
      { graphicAssetId: GRAPHICS.rune },
    ),
  ]);
  e.normal("era-one", "Porte de fondation", cell(17, 29), GRAPHICS.rune, [
    page(
      [
        ifVariable(
          "0013",
          1,
          [say(null, "La fondation est déjà placée dans la chronologie.")],
          [
            choice("Quelle mémoire vient en premier ?", [
              {
                label: "Le pacte avant la grande crue",
                body: [
                  setVar("0013", 1),
                  say(
                    null,
                    "Des familles déposent volontairement les noms des bienfaits et des prix.",
                  ),
                  teleport("archives", 29, 22, "puzzle"),
                ],
              },
              {
                label: "Le neuvième convoi",
                body: wrongArchiveStep(
                  "Le convoi traverse un bâtiment déjà ancien. La porte vous renvoie à l’entrée.",
                ),
              },
              {
                label: "Le relevé des ruines",
                body: wrongArchiveStep(
                  "Les ruines ne peuvent précéder leurs fondations. La chronologie se défait.",
                ),
              },
            ]),
          ],
        ),
      ],
      { graphicAssetId: GRAPHICS.rune },
    ),
  ]);
  e.normal("era-two", "Porte du convoi", cell(29, 22), GRAPHICS.rune, [
    page(
      [
        ifVariable(
          "0013",
          2,
          [say(null, "La nuit du convoi occupe déjà la seconde place.")],
          [
            ifVariable(
              "0013",
              1,
              [
                choice("Quelle mémoire suit la fondation ?", [
                  {
                    label: "Le passage du neuvième convoi",
                    body: [
                      setVar("0013", 2),
                      say(
                        null,
                        "Talen remplace neuf noms par six numéros. Une autre main ordonne de détruire le chariot manquant.",
                      ),
                      teleport("archives", 44, 13, "puzzle"),
                    ],
                  },
                  {
                    label: "Le relevé après l’effondrement",
                    body: wrongArchiveStep(
                      "Le relevé cite le convoi. Il doit donc venir après lui.",
                    ),
                  },
                ]),
              ],
              wrongArchiveStep(
                "La fondation manque. La porte ne sait pas quel bâtiment le convoi traverse.",
              ),
            ),
          ],
        ),
      ],
      { graphicAssetId: GRAPHICS.rune },
    ),
  ]);
  e.normal("era-three", "Porte des ruines", cell(44, 13), GRAPHICS.rune, [
    page(
      [
        ifSwitch(
          "0070",
          [say(null, "La chronologie reste fixée : pacte, convoi, ruines.")],
          [
            ifVariable(
              "0013",
              2,
              [
                choice("Quelle mémoire ferme la série ?", [
                  {
                    label: "Le relevé actuel des ruines",
                    body: [
                      setVar("0013", 3),
                      switchOn("0070"),
                      addVar("0001", 2),
                      addVar("0009", 2),
                      activity("ordre_archives"),
                      teleport("archives", 49, 9, "puzzle"),
                    ],
                  },
                  {
                    label: "Une seconde fondation",
                    body: wrongArchiveStep(
                      "Aucun document ne mentionne une seconde fondation. Le bassin rétablit les dates.",
                    ),
                  },
                ]),
              ],
              wrongArchiveStep(
                "La nuit du convoi manque encore. Le relevé ne peut être interprété.",
              ),
            ),
          ],
        ),
      ],
      { graphicAssetId: GRAPHICS.rune },
    ),
  ]);
  e.normal("nhalgor", "Nhalgor", cell(49, 9), GRAPHICS.varos, [
    page(
      [
        say(
          null,
          "Les trois dates ne tiennent pas encore ensemble. La table des marées indique leur ordre.",
        ),
      ],
      { graphicAssetId: GRAPHICS.varos },
    ),
    page(
      [
        say(
          "Nhalgor",
          "Je suis fait de souvenirs que la Couronne voulait reprendre. Si je les rends sans préparation, je tue leurs propriétaires ; si je les garde, je prolonge leur absence.",
        ),
        say(
          "Nhalgor",
          "J’étais l’abbé de la vanne. J’ai noyé les Saules-Bas pour empêcher le transfert ; Varos aurait pris les voix, mais mes voisins n’ont jamais choisi de mourir.",
        ),
        choice("Quel sort pour les Archives ?", [
          {
            label: "Préserver les mémoires avec Nhalgor",
            body: [
              switchOn("0018"),
              switchOn("0020"),
              switchOn("0043"),
              addVar("0001", 2),
              addVar("0004", 2),
              addVar("0007", 1),
              activity("sort_nhalgor"),
              { t: "setSelfSwitch", selfSwitch: "A", value: true },
            ],
          },
          {
            label: "Le vaincre pour reprendre les preuves",
            body: [
              switchOn("0081"),
              addVar("0002", 1),
              { t: "setSelfSwitch", selfSwitch: "A", value: true },
              teleport("archives", 51, 34, "recovery"),
            ],
          },
          {
            label: "Brûler ce que Varos pourrait saisir",
            body: [
              switchOn("0019"),
              addVar("0003", 2),
              addVar("0017", 3),
              addVar("0005", 1),
              activity("sort_nhalgor"),
              { t: "setSelfSwitch", selfSwitch: "A", value: true },
            ],
          },
        ]),
      ],
      { condSwitchId: "0070", graphicAssetId: GRAPHICS.varos },
    ),
    page(
      [
        say(
          "Nhalgor",
          "Les Saules devront juger ce que vous avez conservé, repris ou détruit. Ma décision ne leur sera plus imposée comme la vôtre l’a été.",
        ),
      ],
      { condSelfSwitch: "A", graphicAssetId: GRAPHICS.varos },
    ),
  ]);
  e.monster(
    "nhalgor-boss",
    "Nhalgor délié",
    cell(51, 33),
    "mire_troll",
    {
      rank: "boss",
      maxHp: 2_300,
      damage: 38,
      speed: 70,
      xp: 1_350,
      weakness: "ranger",
      weaknessPercent: 165,
      specialTechnique: "troll_sweep",
    },
    [
      switchOn("0018"),
      switchOn("0021"),
      switchOn("0043"),
      addVar("0001", 1),
      addVar("0007", 1),
      activity("sort_nhalgor"),
      teleport("archives", 47, 11, "recovery"),
    ],
    undefined,
    ["0081"],
  );
  e.normal("talen-confession", "Talen", cell(35, 34), GRAPHICS.talen, [
    page(
      [
        say(
          "Talen",
          "Je parlerai quand le sort des Archives sera décidé. Tant que les preuves peuvent disparaître, mon aveu ne coûte rien.",
        ),
      ],
      { graphicAssetId: GRAPHICS.talen },
    ),
    page(
      [
        say(
          "Talen",
          "J’ai effacé les premiers noms sous menace. Les derniers, je les ai effacés pour conserver les soins de ma sœur. Je savais alors exactement ce que je faisais.",
        ),
        say(
          "Talen",
          "Avant de fuir, j’ai caché trois tables dans la vase. Elles prouvent les corrections ; elles ne rendent aucun des noms que j’ai supprimés.",
        ),
        choice("Que demander à Talen ?", [
          {
            label: "Un procès public immédiat",
            body: [
              switchOn("0022"),
              addVar("0002", 2),
              addVar("0001", 1),
              say(
                "Talen",
                "Je remettrai mes clefs. Que le jugement conserve aussi les ordres que j’ai reçus.",
              ),
            ],
          },
          {
            label: "Qu’il répare les registres sous contrôle",
            body: [
              switchOn("0023"),
              addVar("0004", 2),
              addVar("0009", 1),
              say(
                "Talen",
                "Je ne prendrai pas cela pour un pardon. Je commencerai par les noms que je crains le plus de relire.",
              ),
            ],
          },
        ]),
        switchOn("0026"),
        activity("verite_talen"),
        activity("faute_talen"),
        { t: "setSelfSwitch", selfSwitch: "A", value: true },
      ],
      { condSwitchId: "0018", graphicAssetId: GRAPHICS.talen },
    ),
    page(
      [
        say(
          "Talen",
          "J’ai effacé les premiers noms sous menace. Les derniers, je les ai effacés pour conserver les soins de ma sœur. Je savais alors exactement ce que je faisais.",
        ),
        say(
          "Talen",
          "Avant de fuir, j’ai caché trois tables dans la vase. Elles prouvent les corrections ; elles ne rendent aucun des noms que j’ai supprimés.",
        ),
        choice("Que demander à Talen ?", [
          {
            label: "Un procès public immédiat",
            body: [switchOn("0022"), addVar("0002", 2), addVar("0001", 1)],
          },
          {
            label: "Qu’il répare ce qui peut l’être",
            body: [switchOn("0023"), addVar("0004", 1), addVar("0009", 1)],
          },
        ]),
        switchOn("0026"),
        activity("verite_talen"),
        activity("faute_talen"),
        { t: "setSelfSwitch", selfSwitch: "A", value: true },
      ],
      { condSwitchId: "0019", graphicAssetId: GRAPHICS.talen },
    ),
    page(
      [
        say(
          "Talen",
          "Mon rôle est établi. La suite dépendra du jugement ou de la surveillance que vous avez choisis.",
        ),
      ],
      { condSelfSwitch: "A", graphicAssetId: GRAPHICS.talen },
    ),
  ]);
  portal(
    e,
    "back-marsh",
    "Escalier noyé",
    7,
    39,
    { map: "marsh", col: 51, row: 10 },
    [],
    "",
    "magical",
    GRAPHICS.talen,
    "Talen inverse le reflet de la cloche. L’escalier noyé rend le groupe au clocher du Marais.",
  );
  portal(
    e,
    "to-citadel",
    "Canal militaire",
    54,
    8,
    { map: "citadel", col: 5, row: 36 },
    ["0026"],
    "Le canal n’indique aucune destination tant que la vérité des Archives n’est pas établie.",
    "geographic",
    GRAPHICS.soldierBlue,
    "Le batelier militaire suit les marques retrouvées. Le canal ressort dans la cour basse de la Citadelle.",
  );
  monsterPack(e, "fragments", "Mémoire sans corps", "skull_guard", [
    cell(19, 18),
    cell(28, 30),
    cell(35, 24),
    cell(50, 20),
  ]);
  explorationCache(
    e,
    "archive-height-cache",
    "Rayonnage hors crue",
    54,
    6,
    "Le rayonnage le plus haut contient une copie que la vase n'a jamais touchée et la clé d'un coffre de voyage.",
    40,
  );
  return bundleMap(
    "archives",
    "Archives sous la Vase",
    terrainLayers("archives", {
      water: [
        { col: 21, row: 2, width: 4, height: 34 },
        { col: 36, row: 9, width: 4, height: 34 },
        { col: 2, row: 25, width: 19, height: 4 },
        { col: 25, row: 17, width: 11, height: 4 },
        { col: 40, row: 25, width: 18, height: 4 },
      ],
      carve: [
        { col: 21, row: 28, width: 4, height: 4 },
        { col: 36, row: 18, width: 4, height: 4 },
        { col: 12, row: 25, width: 4, height: 4 },
        { col: 28, row: 17, width: 4, height: 4 },
        { col: 46, row: 25, width: 5, height: 4 },
      ],
    }),
    spawn,
    e.events,
    mapElements("marsh", "archives", e, spawn, [
      element(BUILDINGS.ruinedHouse, 9, 31),
      element(BUILDINGS.blackTower, 27, 10),
      element(BUILDINGS.purpleMonastery, 42, 10),
      element(BUILDINGS.ruinedCastle, 48, 33),
    ]),
  );
}

function serahPage(opening: string, conditionSwitchId: string): MapEventPage {
  return page(
    [
      say("Serah", opening),
      say(
        "Serah",
        "La cour des conscrits hésite. Si je leur demande vengeance, ils me suivront vite. Si je demande justice, il faudra garder vivants ceux que nous voulons juger.",
      ),
      choice("Quelle ligne Serah doit-elle tenir ?", [
        {
          label: "Justice, preuves et prisonniers",
          body: [
            switchOn("0031"),
            addVar("0004", 2),
            addVar("0001", 1),
            say(
              "Serah",
              "Alors nous prendrons la cour assez proprement pour pouvoir encore la juger demain.",
            ),
          ],
        },
        {
          label: "Vengeance avant la contre-attaque",
          body: [
            switchOn("0032"),
            addVar("0002", 2),
            addVar("0017", 1),
            say(
              "Serah",
              "Je donnerai l’ordre. Ne prétendez pas ensuite que la guerre l’a donné à notre place.",
            ),
          ],
        },
      ]),
      activity("position_serah"),
      { t: "setSelfSwitch", selfSwitch: "A", value: true },
    ],
    { condSwitchId: conditionSwitchId, graphicAssetId: GRAPHICS.serah },
  );
}

function buildCitadel(refs: StoryRefs): AdventureBundleMap {
  const e = createEventFactory("citadel", refs);
  const spawn = cell(5, 36);
  npc(e, "field-surgeon", "Sœur Ane", 12, 35, GRAPHICS.monkYellow, [
    "Je trie par respiration, pas par uniforme. Les inquisiteurs ont réquisitionné les potions du quartier des officiers et laissé les conscrits avec des linges.",
    "Si vous ouvrez leur dépôt, ils perdront une position défendable. Les blessés gagneront peut-être la nuit.",
  ]);
  e.normal("serah", "Serah", cell(16, 31), GRAPHICS.serah, [
    page(
      [
        say(
          "Serah",
          "Je dois d’abord savoir ce que vous avez fait de Varkesh. Les conscrits me poseront la même question.",
        ),
      ],
      {
        graphicAssetId: GRAPHICS.serah,
      },
    ),
    serahPage(
      "Mon père est mort sous vos coups. Cela ne rend pas ses ordres moins criminels, mais mes soldats attendent de voir si je réclame son sang en retour.",
      "0006",
    ),
    serahPage(
      "Mon père attend un procès. Le maintenir vivant coûtera des gardes et donnera une cible aux deux camps ; c’est aussi la seule chance d’entendre toutes les familles.",
      "0007",
    ),
    serahPage(
      "Vous avez accepté ses hommes sans effacer ses crimes. Je peux tenir cette contradiction, mais chaque ordre sera soupçonné de protéger son héritage.",
      "0008",
    ),
    page(
      [
        say(
          "Serah",
          "Ma position est connue. Les soldats jugeront nos actes à la cour intérieure.",
        ),
      ],
      { condSelfSwitch: "A", graphicAssetId: GRAPHICS.serah },
    ),
  ]);
  e.normal("conscripts", "Grille des conscrits", cell(23, 22), GRAPHICS.soldierBlue, [
    page(
      [
        say(
          "Caporal Venn",
          "Cent onze conscrits sont enfermés parce qu’ils ont refusé le serment permanent. Ouvrir cette grille retire des défenseurs à la muraille nord.",
        ),
        choice("Que faire des conscrits ?", [
          {
            label: "Les libérer et leur laisser le choix",
            body: [
              switchOn("0033"),
              switchOn("0044"),
              addVar("0003", 2),
              addVar("0004", 1),
              addVar("0007", 1),
              activity("liberer_conscrits"),
            ],
          },
          {
            label: "Maintenir la garde jusqu’à la relève",
            body: [
              addVar("0002", 2),
              addVar("0008", 1),
              say(
                "Venn",
                "Nous tiendrons quatre heures. Après cela, l’ordre devra être renouvelé devant les hommes.",
              ),
            ],
          },
        ]),
        { t: "setSelfSwitch", selfSwitch: "A", value: true },
      ],
      { graphicAssetId: GRAPHICS.soldierBlue },
    ),
    page(
      [
        say(
          "Venn",
          "La décision est appliquée. Ceux qui restent savent désormais pour combien de temps.",
        ),
      ],
      { condSelfSwitch: "A", graphicAssetId: GRAPHICS.soldierBlue },
    ),
  ]);
  once(
    e,
    "inquisition-ledger",
    "Dépôt inquisitorial",
    35,
    28,
    GRAPHICS.rune,
    [
      say(
        null,
        "Les potions portent les noms de blessés rayés de la liste. Sous chaque caisse, un ordre prévoit de brûler les archives si la cour tombe.",
      ),
      switchOn("0034"),
      addVar("0019", 2),
      addVar("0009", 1),
      activity("retourner_brasiers"),
    ],
    "Les soins sont distribués au poste de tri. Les ordres de destruction sont remis à Serah.",
  );
  once(
    e,
    "conscript-letters",
    "Sac postal militaire",
    42,
    34,
    GRAPHICS.rune,
    [
      say(
        null,
        "Cent lettres n’ont jamais quitté la Citadelle. Elles demandent des semences, annoncent des naissances et décrivent la fatigue sans discours héroïque.",
      ),
      switchOn("0066"),
      addVar("0004", 1),
      activity("lettres_conscrits"),
    ],
    "Les lettres sont triées par village. Des coureurs volontaires préparent leur départ.",
  );
  npc(e, "lyra-message", "Messagère de Lyra", 8, 15, GRAPHICS.archerBlue, [
    "Lyra tient la porte sud avec deux compagnies. Elle promet une amnistie limitée aux conscrits, pas aux officiers qui ont organisé les convois.",
    "Le Conseil dit qu’elle prépare sa propre couronne. Elle n’a pas répondu à cette accusation.",
  ]);
  npc(e, "varos-brazier", "Brasier de Varos", 46, 10, GRAPHICS.varos, [
    "Je viens d’ordonner à mes légions de laisser sortir les familles de la cour orientale. Une forteresse vide vaut mieux qu’un charnier inutilisable.",
    "Vos alliés appelleront cela calcul. Ils auront raison. Un calcul peut aussi sauver des vies ; la sincérité ne possède pas ce monopole.",
  ]);
  e.guard("freed-guard-1", "Conscrits libres A", cell(29, 19), 180, "0033");
  e.guard("freed-guard-2", "Conscrits libres B", cell(31, 19), 180, "0033");
  portal(
    e,
    "back-archives",
    "Canal du Marais",
    4,
    38,
    { map: "archives", col: 52, row: 9 },
    [],
    "",
    "geographic",
    GRAPHICS.soldierBlue,
    "Le batelier reprend le canal occidental vers les salles émergées des Archives.",
  );
  portal(
    e,
    "to-fort",
    "Porte des trois cours",
    54,
    15,
    { map: "fort", col: 6, row: 36 },
    ["0031", "0032"],
    "Serah n’engagera pas ses soldats dans la cour intérieure avant d’avoir choisi une ligne de commandement.",
    "interior",
    GRAPHICS.soldierBlue,
    "L’officier lève la herse. La Porte des trois cours mène à l’enceinte intérieure du Fort.",
  );
  e.normal("open-marsh-shortcut", "Poterne des digues", cell(53, 36), GRAPHICS.artisan, [
    page(
      [
        say(
          null,
          "Le verrou porte les cotes de crue du Marais. Une fois levé depuis la Citadelle, le tunnel permet d’éviter le canal des Archives.",
        ),
        switchOn("0060"),
        { t: "setSelfSwitch", selfSwitch: "A", value: true },
        teleport("marsh", 55, 35, "shortcut"),
      ],
      { graphicAssetId: GRAPHICS.artisan },
    ),
    page([teleport("marsh", 55, 35, "shortcut")], {
      condSelfSwitch: "A",
      graphicAssetId: GRAPHICS.artisan,
    }),
  ]);
  monsterPack(
    e,
    "loyalists",
    "Loyaliste des cours",
    "spear_goblin",
    [cell(19, 14), cell(29, 12), cell(43, 14)],
    { rank: "elite", maxHp: 220, damage: 24, xp: 160 },
  );
  monsterPack(e, "oath-dead", "Mort du vieux serment", "skull_crusader", [
    cell(18, 26),
    cell(31, 24),
    cell(46, 24),
  ]);
  monsterPack(
    e,
    "court-support",
    "Officiant loyaliste",
    "hex_shaman",
    [cell(22, 16), cell(40, 16)],
    { maxHp: 190, damage: 22, xp: 150, specialTechnique: "hex_burst" },
  );
  monsterPack(e, "court-riders", "Cavalier des cours", "pig_rider", [cell(22, 27), cell(43, 27)], {
    rank: "elite",
    maxHp: 310,
    damage: 29,
    xp: 230,
    specialTechnique: "mounted_trample",
  });
  explorationCache(
    e,
    "citadel-height-cache",
    "Poste des signaux",
    54,
    6,
    "Le poste supérieur conserve les codes des trois cours. Ils prouvent que plusieurs ordres contradictoires ont été envoyés.",
    40,
  );
  return bundleMap(
    "citadel",
    "Citadelle — Les Trois Cours",
    terrainLayers("citadel", {
      water: [
        { col: 2, row: 18, width: 56, height: 3 },
        { col: 19, row: 2, width: 3, height: 16 },
        { col: 38, row: 21, width: 3, height: 22 },
        { col: 47, row: 8, width: 11, height: 3 },
      ],
      carve: [
        { col: 9, row: 18, width: 5, height: 3 },
        { col: 28, row: 18, width: 5, height: 3 },
        { col: 47, row: 18, width: 5, height: 3 },
        { col: 19, row: 10, width: 3, height: 5 },
        { col: 38, row: 29, width: 3, height: 5 },
        { col: 51, row: 8, width: 4, height: 3 },
      ],
    }),
    spawn,
    e.events,
    mapElements("military", "citadel", e, spawn, [
      element(BUILDINGS.blackBarracks, 10, 10),
      element(BUILDINGS.blueBarracks, 25, 27),
      element(BUILDINGS.blackTower, 43, 8),
      element(BUILDINGS.ruinedTower, 32, 34),
      element(BUILDINGS.blackHouse1, 45, 34),
      element(BUILDINGS.ruinedHouse, 17, 34),
    ]),
  );
}

function buildFort(refs: StoryRefs): AdventureBundleMap {
  const e = createEventFactory("fort", refs);
  const spawn = cell(6, 36);
  npc(e, "maelys", "Maëlys", 12, 34, GRAPHICS.maelys, [
    "Prendre la Citadelle est possible. La nourrir demain l’est moins. Ses greniers couvrent douze jours et ses sceaux de crue dépendent du Sanctuaire.",
    "Choisissez un commandement qui puisse expliquer les pertes, pas seulement gagner la prochaine heure.",
  ]);
  e.normal("command-choice", "Table de commandement", cell(29, 21), GRAPHICS.rune, [
    page(
      [
        say(
          "Maëlys",
          "Lyra apporte les officiers, Serah les conscrits, et mon réseau les communes. Le Conseil conserve les ingénieurs des sceaux. Personne ne possède tout.",
        ),
        choice("Qui contrôlera la Citadelle ?", [
          {
            label: "Lyra et un commandement réformateur",
            body: [
              switchOn("0027"),
              switchOn("0044"),
              addVar("0002", 2),
              addVar("0006", 2),
              addVar("0007", 2),
              say(
                "Lyra",
                "J’accepte jusqu’à l’assemblée. Si je repousse sa date, vous devrez me compter parmi les problèmes.",
              ),
            ],
          },
          {
            label: "Serah et les unités libérées",
            body: [
              switchOn("0028"),
              switchOn("0044"),
              addVar("0004", 2),
              addVar("0007", 2),
              say(
                "Serah",
                "Les officiers resteront à leur poste sous contrôle civil. Ceux qui refusent déposeront leurs armes.",
              ),
            ],
          },
          {
            label: "Maëlys et les communes",
            body: [
              switchOn("0029"),
              switchOn("0044"),
              addVar("0003", 2),
              addVar("0004", 1),
              addVar("0007", 2),
              say(
                "Maëlys",
                "Je prends la charge, pas un titre. Les comptes des réserves seront affichés dans chaque cour.",
              ),
            ],
          },
          {
            label: "Maintenir le Conseil technique",
            body: [
              switchOn("0030"),
              addVar("0002", 3),
              addVar("0005", 2),
              addVar("0008", 2),
              say(
                "Maëlys",
                "La Citadelle tiendra. Le Conseil saura aussi que la peur suffit encore à conserver sa place.",
              ),
            ],
          },
        ]),
        activity("controle_citadelle"),
        { t: "setSelfSwitch", selfSwitch: "A", value: true },
      ],
      { graphicAssetId: GRAPHICS.rune },
    ),
    page(
      [
        say(
          null,
          "La table porte le sceau du commandement choisi. Les ordres de rationnement partent avant les proclamations.",
        ),
      ],
      { condSelfSwitch: "A", graphicAssetId: GRAPHICS.rune },
    ),
  ]);
  e.normal("oath-dead", "Cour des anciens morts", cell(17, 19), GRAPHICS.rune, [
    page(
      [
        say(
          "Veilleur Sael",
          "Ces morts gardent un serment sans terme. Les délivrer ouvre une brèche dans la défense ; les garder prolonge la faute d’Eryndor.",
        ),
        choice("Que faire de la garde morte ?", [
          {
            label: "Rompre leur serment",
            body: [switchOn("0035"), addVar("0001", 2), addVar("0008", 1), addVar("0003", 1)],
          },
          {
            label: "Reporter la rupture après la guerre",
            body: [
              addVar("0002", 2),
              addVar("0017", 1),
              say(
                "Sael",
                "Je noterai le report avec la date. Une mesure temporaire doit enfin savoir quand elle finit.",
              ),
            ],
          },
        ]),
        activity("delivrer_morts"),
        { t: "setSelfSwitch", selfSwitch: "A", value: true },
      ],
      { graphicAssetId: GRAPHICS.rune },
    ),
    page(
      [
        say(
          "Sael",
          "La cour obéit à votre décision. Les vivants ont repris les postes laissés libres.",
        ),
      ],
      { condSelfSwitch: "A", graphicAssetId: GRAPHICS.rune },
    ),
  ]);
  once(
    e,
    "letter-office",
    "Bureau des courriers",
    40,
    32,
    GRAPHICS.rune,
    [
      say(
        null,
        "Les lettres saisies dans les trois cours sont classées par destination. Les messagers demandent une escorte plutôt qu’une récompense.",
      ),
      switchOn("0066"),
      addVar("0004", 1),
      activity("lettres_conscrits"),
    ],
    "Les premiers courriers ont franchi la porte sud sous drapeau blanc.",
  );
  npc(e, "varos-envoy", "Envoyé de Varos", 44, 13, GRAPHICS.varos, [
    "Mon maître reconnaîtra le commandement choisi si les sceaux de crue restent actifs. Il demande en échange l’accès aux relevés de la Source.",
    "Refuser ne le rendra pas moins capable de les prendre. Accepter ne vous oblige pas à lui remettre les noms.",
  ]);
  e.guard("conscript-guard", "Garde des conscrits", cell(24, 25), 190, "0033");
  e.guard("citadel-guard", "Garde de la Citadelle", cell(34, 25), 190, "0044");
  portal(
    e,
    "back-citadel",
    "Porte des cours",
    5,
    39,
    { map: "citadel", col: 52, row: 15 },
    [],
    "",
    "interior",
    GRAPHICS.soldierBlue,
    "Le garde rouvre la herse vers les trois cours extérieures de la Citadelle.",
  );
  portal(
    e,
    "to-sanctuary",
    "Route du Sanctuaire",
    54,
    8,
    { map: "sanctuary", col: 6, row: 36 },
    ["0027", "0028", "0029", "0030"],
    "La Citadelle n’ouvrira ses portes extérieures qu’après la désignation d’un commandement.",
    "geographic",
    GRAPHICS.soldierBlack,
    "L’intendante remet un laissez-passer. La route haute mène aux jardins du Sanctuaire de l’Aube.",
  );
  monsterPack(
    e,
    "inquisitors",
    "Inquisiteur du fort",
    "spear_goblin",
    [cell(20, 10), cell(31, 12), cell(43, 21)],
    { rank: "elite", maxHp: 250, damage: 26, xp: 190 },
  );
  monsterPack(e, "bound-dead", "Légionnaire lié", "skull_crusader", [
    cell(13, 25),
    cell(26, 30),
    cell(47, 28),
  ]);
  monsterPack(
    e,
    "inquisitor-support",
    "Thaumaturge de l’intendance",
    "hex_shaman",
    [cell(23, 14), cell(39, 22)],
    { maxHp: 205, damage: 24, xp: 165, specialTechnique: "hex_burst" },
  );
  monsterPack(
    e,
    "fort-riders",
    "Cavalier du chemin de ronde",
    "pig_rider",
    [cell(17, 23), cell(42, 27)],
    { rank: "elite", maxHp: 330, damage: 30, xp: 245, specialTechnique: "mounted_trample" },
  );
  explorationCache(
    e,
    "fort-height-cache",
    "Réserve du chemin de ronde",
    51,
    6,
    "Une réserve du chemin de ronde a échappé à l'intendance. Les dates montrent qui préparait déjà un siège.",
    40,
  );
  return bundleMap(
    "fort",
    "Fort des Serments",
    terrainLayers("fort", {
      water: [
        { col: 2, row: 15, width: 56, height: 3 },
        { col: 18, row: 18, width: 3, height: 25 },
        { col: 38, row: 2, width: 3, height: 13 },
        { col: 41, row: 29, width: 17, height: 3 },
      ],
      carve: [
        { col: 8, row: 15, width: 5, height: 3 },
        { col: 27, row: 15, width: 5, height: 3 },
        { col: 47, row: 15, width: 5, height: 3 },
        { col: 18, row: 31, width: 3, height: 5 },
        { col: 38, row: 8, width: 3, height: 4 },
        { col: 44, row: 29, width: 10, height: 3 },
      ],
    }),
    spawn,
    e.events,
    mapElements("military", "fort", e, spawn, [
      element(BUILDINGS.blackCastle, 26, 8),
      element(BUILDINGS.blackBarracks, 8, 28),
      element(BUILDINGS.blackTower, 45, 8),
      element(BUILDINGS.blackHouse1, 28, 34),
      element(BUILDINGS.blackHouse2, 36, 34),
      element(BUILDINGS.ruinedTower, 50, 34),
    ]),
  );
}

function buildSanctuary(refs: StoryRefs): AdventureBundleMap {
  const e = createEventFactory("sanctuary", refs);
  const spawn = cell(6, 36);
  npc(e, "maelys", "Maëlys", 11, 35, GRAPHICS.maelys, [
    "Sous les autels, vous trouverez des canaux, des dortoirs de serviteurs et des bureaux de prélèvement. Le lieu saint est aussi une administration.",
    "Nous pouvons prendre le Sanctuaire. Nous devons encore décider ce que nous ferons de ses soins, de ses digues et de ses réserves au lendemain.",
  ]);
  once(
    e,
    "source-ledger",
    "Conduit des prélèvements",
    23,
    28,
    GRAPHICS.rune,
    [
      say(
        null,
        "Chaque miracle est lié à une ligne de prix : jours de vie, souvenir précis, émotion, nom, promesse ou dette transmissible.",
      ),
      say(
        null,
        "Les colonnes des bénéficiaires sont publiques jusqu’au règne d’Eryndor, puis remplacées par des codes royaux.",
      ),
      switchOn("0039"),
      addVar("0001", 2),
      addVar("0009", 2),
      activity("verite_couronne"),
    ],
    "Le registre prouve que la Source n’a jamais offert de miracle sans prix et que la Couronne a caché les bénéficiaires.",
  );
  e.normal("gardens", "Jardins nourriciers", cell(17, 17), GRAPHICS.monkYellow, [
    page(
      [
        say(
          "Sœur Ysra",
          "Les serres nourrissent trois hospices. Couper le canal libère les noms qui l’alimentent, mais la récolte meurt avant la semaine prochaine.",
        ),
        choice("Que faire des jardins ?", [
          {
            label: "Réduire le canal et organiser les réserves",
            body: [
              switchOn("0067"),
              switchOn("0045"),
              addVar("0004", 2),
              addVar("0019", 2),
              addVar("0007", 1),
              activity("jardins_nourriciers"),
            ],
          },
          {
            label: "Maintenir le débit jusqu’après la guerre",
            body: [
              switchOn("0067"),
              switchOn("0045"),
              addVar("0002", 2),
              addVar("0008", 2),
              addVar("0017", 1),
              addVar("0007", 1),
              activity("jardins_nourriciers"),
            ],
          },
        ]),
        { t: "setSelfSwitch", selfSwitch: "A", value: true },
      ],
      { graphicAssetId: GRAPHICS.monkYellow },
    ),
    page(
      [
        say(
          "Ysra",
          "Les hospices ont reçu un calendrier et des réserves. Le prix du jardin figure désormais sur la porte.",
        ),
      ],
      { condSelfSwitch: "A", graphicAssetId: GRAPHICS.monkYellow },
    ),
  ]);
  once(
    e,
    "twin-libraries",
    "Bibliothèques jumelles",
    37,
    31,
    GRAPHICS.rune,
    [
      say(
        null,
        "L’ordre des Bienfaits classe les miracles par rendement. L’ordre des Noms classe les mêmes opérations par victimes et symptômes.",
      ),
      addVar("0001", 1),
      addVar("0009", 1),
      activity("bibliotheques_jumelles"),
    ],
    "Les deux catalogues sont réunis. Aucun rendement ne peut plus être lu sans sa colonne de victimes.",
  );
  e.normal("varos-offer", "Varos", cell(43, 14), GRAPHICS.varos, [
    page(
      [
        say(
          "Varos",
          "Lisez d’abord le conduit des prélèvements. Une trêve proposée avant les comptes ne serait qu’une injonction de plus.",
        ),
      ],
      { graphicAssetId: GRAPHICS.varos },
    ),
    page(
      [
        say(
          "Varos",
          "L’Éclipse est la masse des souvenirs arrachés sans témoin. Si la Couronne tombe ce soir, elle se répandra dans chaque vivant relié à la Source.",
        ),
        say(
          "Varos",
          "Accordez-moi trois jours de trêve. Je stabilise les digues et les hospices ; vous inspectez mes registres. Ensuite vous pourrez encore me combattre.",
        ),
        choice("Accepter la trêve logistique ?", [
          {
            label: "Accepter trois jours sous contrôle",
            body: [
              switchOn("0036"),
              switchOn("0067"),
              switchOn("0045"),
              addVar("0002", 2),
              addVar("0005", 2),
              addVar("0008", 2),
              addVar("0019", 2),
              addVar("0007", 1),
              say(
                "Varos",
                "Vos observateurs auront les clefs et verront les quotas. Les noms resteront scellés tant que les familles exposées ne seront pas à l’abri.",
              ),
            ],
          },
          {
            label: "Refuser et préparer nos propres relais",
            body: [
              switchOn("0037"),
              addVar("0003", 2),
              addVar("0004", 1),
              addVar("0006", 1),
              say(
                "Varos",
                "Alors certains soins cesseront. Ne dites pas que je vous ai caché cette conséquence.",
              ),
            ],
          },
        ]),
        activity("offre_varos"),
        { t: "setSelfSwitch", selfSwitch: "A", value: true },
      ],
      { condSwitchId: "0039", graphicAssetId: GRAPHICS.varos },
    ),
    page(
      [
        say(
          "Varos",
          "Nous avons un désaccord sur le droit de choisir pour autrui. Nous n’en avons plus sur les chiffres.",
        ),
      ],
      { condSelfSwitch: "A", graphicAssetId: GRAPHICS.varos },
    ),
  ]);
  npc(e, "servant", "Linn", 29, 35, GRAPHICS.child, [
    "Je porte les seaux entre les jardins et les chambres. Les prêtres parlent de miracle ; nous, nous savons combien de marches il faut monter quand une pompe s’arrête.",
    "Sous la crypte, un couloir de service rejoint l’ancienne salle. Les couronnes passent par la grande porte. Les seaux passent par là.",
  ]);
  portal(
    e,
    "back-fort",
    "Porteuse du laissez-passer",
    5,
    39,
    { map: "fort", col: 52, row: 9 },
    [],
    "",
    "geographic",
    GRAPHICS.soldierBlack,
    "La porteuse redescend la route haute jusqu’à l’entrée orientale du Fort des Serments.",
  );
  portal(
    e,
    "to-crypt",
    "Crypte du premier roi",
    52,
    9,
    { map: "crypt", col: 7, row: 36 },
    ["0036", "0037"],
    "Le sceau attend que le registre soit lu et que l’offre de Varos ait reçu une réponse.",
    "interior",
    GRAPHICS.monkPurple,
    "La gardienne funéraire brise le cachet. L’escalier descend dans la Crypte d’Eryndor.",
  );
  portal(
    e,
    "shortcut-war",
    "Escalier des serviteurs",
    53,
    37,
    { map: "war", col: 8, row: 37 },
    ["0061"],
    "L’escalier est bloqué par une grille qui ne s’ouvre que depuis le champ de bataille.",
    "shortcut",
    GRAPHICS.child,
    "Linn ouvre la grille de service. L’escalier débouche derrière l’infirmerie du champ de bataille.",
  );
  monsterPack(
    e,
    "crown-agents",
    "Agent de la Couronne",
    "spear_goblin",
    [cell(13, 26), cell(28, 18), cell(47, 26)],
    { rank: "elite", maxHp: 280, damage: 28, xp: 210 },
  );
  monsterPack(e, "eclipse-leaks", "Fuite de l’Éclipse", "skull_guard", [
    cell(27, 11),
    cell(38, 10),
    cell(45, 33),
  ]);
  monsterPack(
    e,
    "crown-support",
    "Officiant armé",
    "hex_shaman",
    [cell(17, 25), cell(37, 10), cell(43, 27)],
    { maxHp: 210, damage: 24, xp: 170, specialTechnique: "hex_burst" },
  );
  monsterPack(
    e,
    "sanctuary-riders",
    "Poursuivant de la Couronne",
    "pig_rider",
    [cell(12, 26), cell(48, 26)],
    { rank: "elite", maxHp: 340, damage: 31, xp: 250, specialTechnique: "mounted_trample" },
  );
  explorationCache(
    e,
    "sanctuary-height-cache",
    "Jardin suspendu",
    45,
    6,
    "Le jardin suspendu nourrit les officiants, pas les pèlerins. Un registre de récolte confirme la différence.",
    35,
  );
  return bundleMap(
    "sanctuary",
    "Sanctuaire de l’Aube",
    terrainLayers("sanctuary", {
      water: [
        { col: 14, row: 2, width: 3, height: 30 },
        { col: 29, row: 13, width: 3, height: 30 },
        { col: 44, row: 2, width: 3, height: 26 },
        { col: 17, row: 20, width: 12, height: 3 },
        { col: 32, row: 28, width: 12, height: 3 },
      ],
      carve: [
        { col: 14, row: 16, width: 3, height: 5 },
        { col: 29, row: 31, width: 3, height: 5 },
        { col: 44, row: 12, width: 3, height: 5 },
        { col: 22, row: 20, width: 4, height: 3 },
        { col: 37, row: 28, width: 4, height: 3 },
      ],
    }),
    spawn,
    e.events,
    mapElements("sacred", "sanctuary", e, spawn, [
      element(BUILDINGS.purpleMonastery, 8, 13),
      element(BUILDINGS.yellowMonastery, 20, 8),
      element(BUILDINGS.purpleHouse1, 18, 34),
      element(BUILDINGS.purpleHouse2, 34, 34),
      element(BUILDINGS.yellowTower, 49, 8),
      element(BUILDINGS.ruinedCastle, 39, 18),
    ]),
  );
}

function eryndorFragment(
  factory: Factory,
  key: string,
  name: string,
  col: number,
  row: number,
  text: string,
): void {
  once(
    factory,
    key,
    name,
    col,
    row,
    GRAPHICS.rune,
    [say("Eryndor", text), addVar("0014", 1), addVar("0001", 1), activity("fragment_eryndor")],
    "Le fragment a rejoint les autres. Sa date reste gravée dans le socle.",
  );
}

function buildCrypt(refs: StoryRefs): AdventureBundleMap {
  const e = createEventFactory("crypt", refs);
  const spawn = cell(7, 36);
  eryndorFragment(
    e,
    "eryndor-0",
    "Eryndor — année 0",
    16,
    29,
    "La seconde Éclipse a emporté des villages entiers. J’ai centralisé les offrandes pour neuf hivers, avec l’accord de quatre assemblées.",
  );
  eryndorFragment(
    e,
    "eryndor-9",
    "Eryndor — année 9",
    31,
    20,
    "La crise avait reculé. J’ai reporté l’assemblée parce que rendre le pouvoir semblait plus dangereux que le garder. Ce fut mon premier mensonge.",
  );
  eryndorFragment(
    e,
    "eryndor-14",
    "Eryndor — année 14",
    45,
    11,
    "J’ai juré de porter la Couronne jusqu’à la fin du danger sans définir cette fin. Quand les Liin ont tenté de l’arrêter, mon serment a rayé leurs noms.",
  );
  once(
    e,
    "ninth-cart",
    "Le neuvième chariot",
    39,
    33,
    GRAPHICS.rune,
    [
      say(
        null,
        "Sous une bâche pourrie, des bracelets portent les mêmes marques que vos poignets. La liste désigne les passagers comme « sujets déjà prélevés ».",
      ),
      say(
        null,
        "Le moyeu est vitrifié par une rupture ancienne de la Source. Une liste répartit les survivants sous de faux états civils.",
      ),
      switchOn("0068"),
      addVar("0011", 2),
      addVar("0009", 2),
      activity("neuvieme_chariot"),
    ],
    "Les bracelets prouvent que les Sans-Sceau ont voyagé dans le convoi effacé.",
  );
  e.normal("eryndor-whole", "Mémoire d’Eryndor", cell(50, 8), GRAPHICS.monkPurple, [
    page(
      [
        say(
          null,
          "Trois fragments datés manquent encore. La porte centrale répond aux années 0, 9 et 14.",
        ),
      ],
      { graphicAssetId: GRAPHICS.monkPurple },
    ),
    page(
      [
        say(
          "Eryndor",
          "La Couronne contient réellement l’Éclipse, mais chaque prélèvement secret lui ajoute ce qu’elle devra contenir demain.",
        ),
        say(
          "Eryndor",
          "Varos n’a pas créé mon système. Il a remplacé les faveurs et les exemptions par une méthode égale dans sa cruauté.",
        ),
        say(
          "Eryndor",
          "Liin signifie le témoin vivant : le nom peut quitter le registre sans quitter le monde, si quelqu’un accepte d’en porter la dette.",
        ),
        switchOn("0038"),
        switchOn("0040"),
        switchOn("0045"),
        addVar("0008", 2),
        addVar("0011", 2),
        addVar("0007", 1),
        activity("memoire_eryndor"),
        activity("preparer_guerre"),
        { t: "setSelfSwitch", selfSwitch: "A", value: true },
      ],
      { condVariableId: "0014", condVariableMin: 3, graphicAssetId: GRAPHICS.monkPurple },
    ),
    page(
      [
        say(
          "Eryndor",
          "Mon serment n’a pas de terme. Le mécanisme originel, sous la forteresse, peut lui en rendre un.",
        ),
      ],
      { condSelfSwitch: "A", graphicAssetId: GRAPHICS.monkPurple },
    ),
  ]);
  npc(e, "varos-answer", "Varos", 26, 10, GRAPHICS.varos, [
    "Eryndor regrette depuis quatre siècles sans avoir eu à nourrir une ville. Son remords est une preuve ; ce n’est pas un plan.",
    "Ma Couronne répartira les prélèvements par population et besoin. Vous l’appelez monstrueuse ; dites-moi qui maintiendra les digues quand une province refusera.",
  ]);
  portal(
    e,
    "back-sanctuary",
    "Escalier du Sanctuaire",
    6,
    39,
    { map: "sanctuary", col: 50, row: 10 },
    [],
    "",
    "interior",
    GRAPHICS.monkPurple,
    "La gardienne funéraire vous reconduit par l’escalier jusqu’au Sanctuaire de l’Aube.",
  );
  portal(
    e,
    "to-war",
    "Porte de la guerre",
    54,
    38,
    { map: "war", col: 8, row: 37 },
    ["0040"],
    "Eryndor doit réunir ses trois fragments avant que le mécanisme originel puisse être localisé.",
    "geographic",
    GRAPHICS.soldierRed,
    "Le courrier ouvre la porte basse. Le vacarme de la Guerre de l’Aube vient de l’autre côté.",
  );
  monsterPack(
    e,
    "oath-keepers",
    "Gardien du serment",
    "skull_crusader",
    [cell(19, 15), cell(28, 29), cell(39, 17), cell(47, 27)],
    { rank: "elite", maxHp: 320, damage: 30, xp: 240 },
  );
  monsterPack(
    e,
    "crypt-retinue",
    "Porte-cendre",
    "skull_guard",
    [cell(17, 15), cell(40, 17), cell(48, 27)],
    { maxHp: 230, damage: 25, xp: 175, specialTechnique: "bone_cleave" },
  );
  e.monster("crypt-warden", "Chambellan d’Eryndor", cell(31, 23), "skull_warden", {
    rank: "elite",
    maxHp: 430,
    damage: 33,
    xp: 300,
    specialTechnique: "grave_siphon",
  });
  explorationCache(
    e,
    "crypt-height-cache",
    "Cénotaphe vide",
    40,
    6,
    "Le cénotaphe ne contient aucun corps. Une lettre familière y remercie pourtant quelqu'un dont le nom a été gratté.",
    30,
  );
  return bundleMap(
    "crypt",
    "Crypte d’Eryndor",
    terrainLayers("crypt", {
      water: [
        { col: 20, row: 2, width: 3, height: 34 },
        { col: 36, row: 9, width: 3, height: 34 },
        { col: 2, row: 25, width: 18, height: 3 },
        { col: 23, row: 17, width: 13, height: 3 },
        { col: 39, row: 25, width: 19, height: 3 },
      ],
      carve: [
        { col: 20, row: 28, width: 3, height: 5 },
        { col: 36, row: 18, width: 3, height: 5 },
        { col: 12, row: 25, width: 4, height: 3 },
        { col: 28, row: 17, width: 4, height: 3 },
        { col: 47, row: 25, width: 5, height: 3 },
      ],
    }),
    spawn,
    e.events,
    mapElements("sacred", "crypt", e, spawn, [
      element(BUILDINGS.ruinedCastle, 45, 8),
      element(BUILDINGS.purpleMonastery, 25, 30),
      element(BUILDINGS.blackTower, 13, 28),
      element(BUILDINGS.ruinedTower, 42, 34),
    ]),
  );
}

function frontPage(
  name: string,
  switchId: string,
  axisCommands: readonly EventCommand[],
  success: string,
): MapEventPage {
  return page(
    [
      ifVariable(
        "0018",
        2,
        [
          say(
            name,
            "Deux secteurs ont déjà reçu les dernières réserves mobiles. Aider ici imposerait d’abandonner l’un d’eux sans prévenir.",
          ),
        ],
        [
          say(name, success),
          choice("Engager les réserves sur ce secteur ?", [
            {
              label: "Oui, tenir ce secteur",
              body: [
                switchOn(switchId),
                addVar("0018", 1),
                ...axisCommands,
                activity("tenir_front"),
                { t: "setSelfSwitch", selfSwitch: "A", value: true },
              ],
            },
            {
              label: "Non, conserver les réserves",
              body: [
                say(
                  name,
                  "Compris. Je ne dirai pas aux soldats qu’un renfort arrive s’il n’arrive pas.",
                ),
              ],
            },
          ]),
        ],
      ),
    ],
    { graphicAssetId: GRAPHICS.soldierBlue },
  );
}

function buildWar(refs: StoryRefs): AdventureBundleMap {
  const e = createEventFactory("war", refs);
  const spawn = cell(8, 37);
  npc(e, "lyra", "Lyra", 12, 35, GRAPHICS.lyra, [
    "La bataille couvre trois lieues. Nous ne la gagnerons pas en vidant chaque tranchée : Varos remplace ses pertes tant que la Couronne alimente les serments.",
    "Tenez assez longtemps pour atteindre le conduit des serviteurs. Ce que vous ferez sous la forteresse décidera si nos positions ont un sens.",
  ]);
  npc(e, "serah", "Serah", 17, 32, GRAPHICS.serah, [
    "Mes éclaireurs ont trouvé le passage de Linn derrière l’infirmerie. Les légions ignorent qu’il rejoint les galeries de la Source.",
    "Choisissez les secteurs à sauver. Je peux déplacer des unités, pas fabriquer du temps.",
  ]);
  e.normal("west-front", "Capitaine Orve", cell(18, 18), GRAPHICS.soldierBlue, [
    frontPage(
      "Orve",
      "0046",
      [addVar("0002", 1), addVar("0007", 1)],
      "La porte occidentale tient encore. Sans renfort, les réfugiés du faubourg seront coupés de la route.",
    ),
    page(
      [
        say(
          "Orve",
          "Le front occidental tient. Nous avons perdu la tour, pas la route d’évacuation.",
        ),
      ],
      { condSelfSwitch: "A", graphicAssetId: GRAPHICS.soldierBlue },
    ),
  ]);
  e.normal("east-front", "Haran", cell(44, 18), GRAPHICS.woodcutter, [
    frontPage(
      "Haran",
      "0047",
      [addVar("0004", 1), addVar("0007", 1)],
      "Les guerriers des Bois reculent devant les créatures de l’Éclipse. Si la levée cède, le chenal atteint les jardins.",
    ),
    page(
      [
        say(
          "Haran",
          "La levée orientale reste ouverte. Les blessés des Bois passent vers les jardins.",
        ),
      ],
      { condSelfSwitch: "A", graphicAssetId: GRAPHICS.woodcutter },
    ),
  ]);
  e.normal("infirmary", "Sœur Ane", cell(28, 29), GRAPHICS.monkYellow, [
    frontPage(
      "Sœur Ane",
      "0048",
      [addVar("0010", 3), addVar("0019", 2)],
      "L’infirmerie centrale est sous tir. Nous pouvons déplacer les blessés, mais les brancardiers ne renforceront aucun rempart.",
    ),
    page(
      [
        say(
          "Sœur Ane",
          "Les derniers brancards sont passés. Nous avons laissé le matériel lourd, pas les patients.",
        ),
      ],
      { condSelfSwitch: "A", graphicAssetId: GRAPHICS.monkYellow },
    ),
  ]);
  e.normal("west-status", "Porte occidentale", cell(22, 13), GRAPHICS.rune, [
    page([say(null, "La herse plie. Les soldats reculent par sections pour éviter une déroute.")], {
      graphicAssetId: GRAPHICS.rune,
    }),
    page(
      [
        say(
          null,
          "La tour est tombée, mais les renforts d’Orve ont calé la herse avec les poutres du magasin.",
        ),
      ],
      { condSwitchId: "0046", graphicAssetId: GRAPHICS.rune },
    ),
  ]);
  e.normal("east-status", "Levée orientale", cell(39, 13), GRAPHICS.rune, [
    page(
      [
        say(
          null,
          "Les racines brûlent sous le lumen noir. La ligne des Bois se replie vers le chenal.",
        ),
      ],
      {
        graphicAssetId: GRAPHICS.rune,
      },
    ),
    page(
      [
        say(
          null,
          "Des chaînes de seaux passent entre les Bois et les serviteurs du Sanctuaire. La levée tient.",
        ),
      ],
      { condSwitchId: "0047", graphicAssetId: GRAPHICS.rune },
    ),
  ]);
  npc(e, "varos-command", "Voix de Varos", 33, 9, GRAPHICS.varos, [
    "Mes légions se retirent du quartier des serviteurs. Je ne sacrifierai pas des civils pour vous ralentir de trois minutes.",
    "Vos chefs déplaceront leurs réserves et laisseront un autre secteur céder. Ce n’est pas une accusation : c’est la forme réelle du commandement.",
  ]);
  e.normal("culvert", "Conduit des serviteurs", cell(31, 36), GRAPHICS.artisan, [
    page(
      [
        ifVariable(
          "0018",
          1,
          [
            say(
              "Serah",
              "Un front nous donne les minutes nécessaires. Une fois dessous, ne revenez pas chercher une victoire militaire : elle n’existe pas.",
            ),
            switchOn("0049"),
            switchOn("0061"),
            activity("passage_serviteurs"),
            teleport("galleries", 7, 37, "interior"),
          ],
          [
            say(
              "Serah",
              "Le conduit est sous le feu des deux ailes. Stabilisez au moins un secteur ou personne n’atteindra la grille vivant.",
            ),
          ],
        ),
      ],
      { graphicAssetId: GRAPHICS.artisan },
    ),
    page(
      [
        say(
          null,
          "La sapeuse tient la grille. Le conduit descend derrière l’infirmerie jusqu’aux Galeries de la Source.",
        ),
        teleport("galleries", 7, 37, "interior"),
      ],
      {
        condSwitchId: "0049",
        graphicAssetId: GRAPHICS.artisan,
      },
    ),
  ]);
  portal(
    e,
    "back-sanctuary",
    "Escalier du Sanctuaire",
    5,
    40,
    { map: "sanctuary", col: 51, row: 37 },
    ["0061"],
    "La grille intérieure n’est pas encore levée.",
    "shortcut",
    GRAPHICS.child,
    "Linn remonte l’escalier de service jusqu’aux jardins du Sanctuaire.",
  );
  e.guard("watcher", "Veilleur du conduit", cell(28, 32), 210);
  e.guard("aubeval-1", "Ligne d’Aubeval A", cell(17, 21), 230, "0041");
  e.guard("aubeval-2", "Ligne d’Aubeval B", cell(20, 24), 230, "0041");
  e.guard("woods-1", "Guerrier des Bois A", cell(41, 21), 230, "0042");
  e.guard("woods-2", "Guerrier des Bois B", cell(44, 24), 230, "0042");
  e.guard("marsh-1", "Veilleur du Marais A", cell(27, 25), 210, "0043");
  e.guard("marsh-2", "Veilleur du Marais B", cell(34, 25), 210, "0043");
  e.guard("citadel-1", "Conscrit libre A", cell(24, 17), 220, "0044");
  e.guard("citadel-2", "Conscrit libre B", cell(37, 17), 220, "0044");
  e.guard("sanctuary-1", "Serviteur armé A", cell(27, 31), 190, "0045");
  e.guard("sanctuary-2", "Serviteur armé B", cell(35, 31), 190, "0045");
  e.guard("lyra-command", "Officière réformatrice", cell(22, 30), 210, "0027");
  e.guard("serah-command", "Éclaireuse de Serah", cell(25, 30), 220, "0028");
  e.guard("maelys-command", "Volontaire des communes", cell(38, 30), 200, "0029");
  e.guard("council-command", "Ingénieur du Conseil", cell(41, 30), 180, "0030");
  monsterPack(
    e,
    "west-legion",
    "Légionnaire occidental",
    "gnoll_marauder",
    [cell(17, 14), cell(21, 16), cell(25, 14)],
    { rank: "elite", maxHp: 310, damage: 30, xp: 230 },
  );
  monsterPack(
    e,
    "east-eclipse",
    "Créature de l’Éclipse",
    "skull_crusader",
    [cell(38, 14), cell(43, 15), cell(48, 12)],
    { rank: "elite", maxHp: 340, damage: 32, xp: 250 },
  );
  monsterPack(
    e,
    "center-legion",
    "Briseur de ligne",
    "gate_troll",
    [cell(27, 21), cell(34, 21), cell(30, 14)],
    { rank: "elite", maxHp: 520, damage: 36, xp: 320 },
  );
  monsterPack(
    e,
    "west-casters",
    "Artilleur du front ouest",
    "hex_shaman",
    [cell(18, 14), cell(24, 14)],
    { maxHp: 220, damage: 26, xp: 185, specialTechnique: "hex_burst" },
  );
  monsterPack(
    e,
    "east-riders",
    "Cavalier du front est",
    "pig_rider",
    [cell(40, 20), cell(46, 19)],
    { rank: "elite", maxHp: 350, damage: 32, xp: 265, specialTechnique: "mounted_trample" },
  );
  monsterPack(e, "center-beasts", "Bête de brèche", "war_pig", [cell(28, 25), cell(35, 21)], {
    maxHp: 260,
    damage: 27,
    xp: 195,
    specialTechnique: "tusk_charge",
  });
  explorationCache(
    e,
    "war-height-cache",
    "Table d'observation",
    36,
    5,
    "La table d'observation révèle un passage entre les fronts. L'emprunter permet aussi de récupérer des soins abandonnés.",
    45,
  );
  return bundleMap(
    "war",
    "Guerre de l’Aube",
    terrainLayers("war", {
      water: [
        { col: 2, row: 10, width: 19, height: 3 },
        { col: 25, row: 10, width: 10, height: 3 },
        { col: 39, row: 10, width: 19, height: 3 },
        { col: 13, row: 25, width: 13, height: 3 },
        { col: 35, row: 25, width: 13, height: 3 },
        { col: 29, row: 28, width: 3, height: 15 },
      ],
      carve: [
        { col: 9, row: 10, width: 5, height: 3 },
        { col: 28, row: 10, width: 4, height: 3 },
        { col: 46, row: 10, width: 5, height: 3 },
        { col: 18, row: 25, width: 5, height: 3 },
        { col: 40, row: 25, width: 5, height: 3 },
        { col: 29, row: 34, width: 3, height: 6 },
      ],
    }),
    spawn,
    e.events,
    mapElements("military", "war", e, spawn, [
      element(BUILDINGS.ruinedCastle, 27, 8),
      element(BUILDINGS.ruinedTower, 12, 15),
      element(BUILDINGS.ruinedTower, 49, 16),
      element(BUILDINGS.ruinedHouse, 22, 33),
      element(BUILDINGS.blackBarracks, 42, 33),
    ]),
  );
}

function anchorChoice(
  factory: Factory,
  key: string,
  name: string,
  col: number,
  row: number,
  switchId: string,
  prompt: string,
  options: readonly {
    label: string;
    text: string;
    effects: readonly EventCommand[];
  }[],
): void {
  factory.normal(key, name, cell(col, row), GRAPHICS.rune, [
    page(
      [
        say(null, prompt),
        choice(
          "Quel prix inscrire ?",
          options.map((option) => ({
            label: option.label,
            body: [
              say(null, option.text),
              switchOn(switchId),
              addVar("0015", 1),
              addVar("0020", 1),
              ...option.effects,
              { t: "setSelfSwitch", selfSwitch: "A", value: true },
            ],
          })),
        ),
      ],
      { graphicAssetId: GRAPHICS.rune },
    ),
    page(
      [
        say(
          null,
          "L’ancre est active. Son prix et son bénéficiaire restent affichés sur le mécanisme.",
        ),
      ],
      { condSelfSwitch: "A", graphicAssetId: GRAPHICS.rune },
    ),
  ]);
}

function buildGalleries(refs: StoryRefs): AdventureBundleMap {
  const e = createEventFactory("galleries", refs);
  const spawn = cell(7, 37);
  npc(e, "battle-echo", "Conduit acoustique", 11, 35, GRAPHICS.rune, [
    "Les chocs de la bataille descendent par les canaux. Une cloche brève signale un repli ; deux coups espacés indiquent qu’une porte tient encore.",
  ]);
  e.normal("war-report", "Tube de commandement", cell(19, 31), GRAPHICS.rune, [
    page(
      [
        say(
          "Serah",
          "La ligne bouge encore au-dessus. Neuf conscrits sont morts à la herse depuis votre descente ; nous ignorons combien de temps le conduit restera ouvert.",
        ),
      ],
      {
        graphicAssetId: GRAPHICS.rune,
      },
    ),
    page(
      [
        say(
          "Orve",
          "Ouest tenu. Nous reculons par ordre, pas par panique. Continuez sous la forteresse.",
        ),
      ],
      { condSwitchId: "0046", graphicAssetId: GRAPHICS.rune },
    ),
    page(
      [
        say(
          "Haran",
          "Est tenu. Les jardins reçoivent encore les blessés. Ne revenez pas pour nous.",
        ),
      ],
      { condSwitchId: "0047", graphicAssetId: GRAPHICS.rune },
    ),
    page(
      [
        say(
          "Sœur Ane",
          "Les patients sont hors de la cour. Le centre peut tomber sans les ensevelir.",
        ),
      ],
      { condSwitchId: "0048", graphicAssetId: GRAPHICS.rune },
    ),
  ]);
  anchorChoice(
    e,
    "grain-anchor",
    "Ancre du grain",
    15,
    27,
    "0071",
    "Cette ancre protège les récoltes. Elle demande une réserve présente plutôt qu’une vie future.",
    [
      {
        label: "Donner les réserves de marche",
        text: "Les greniers de campagne se vident. Les semences des villages sont stabilisées.",
        effects: [addVar("0008", 2), addVar("0019", 1)],
      },
      {
        label: "Promettre une part des récoltes",
        text: "La dette sera payée publiquement pendant trois saisons par les communes bénéficiaires.",
        effects: [addVar("0004", 1), addVar("0016", 1)],
      },
    ],
  );
  anchorChoice(
    e,
    "guard-anchor",
    "Ancre de la garde",
    31,
    20,
    "0072",
    "Cette ancre soutient les protections. Elle exige qu’un gardien puisse déposer sa charge à date fixe.",
    [
      {
        label: "Limiter le serment à une année",
        text: "Le mécanisme inscrit une date de fin et l’obligation d’un vote public pour tout renouvellement.",
        effects: [addVar("0002", 1), addVar("0004", 1), addVar("0008", 1)],
      },
      {
        label: "Rompre les anciens serments maintenant",
        text: "Les morts liés sont libérés. Les remparts perdent une part de leur force immédiate.",
        effects: [switchOn("0035"), addVar("0003", 2), addVar("0017", 1)],
      },
    ],
  );
  anchorChoice(
    e,
    "name-anchor",
    "Ancre du nom",
    45,
    12,
    "0073",
    "Cette ancre contient les noms retirés des registres. Elle demande des témoins qui acceptent de les transmettre.",
    [
      {
        label: "Porter les noms comme Liin",
        text: "Les Sans-Sceau deviennent témoins volontaires. Les noms restent hors du contrôle royal sans disparaître du monde.",
        effects: [addVar("0001", 2), addVar("0011", 2), addVar("0016", 1)],
      },
      {
        label: "Rendre les noms aux communautés",
        text: "Chaque région reçoit une copie et la charge d’en répondre publiquement.",
        effects: [addVar("0004", 2), addVar("0011", 1), addVar("0008", 1)],
      },
    ],
  );
  e.normal("false-loop", "Porte de la Couronne", cell(40, 34), GRAPHICS.rune, [
    page(
      [
        say(
          null,
          "Le linteau montre un roi recevant seul les trois prix. Cette version du mécanisme ramène au début des galeries.",
        ),
        addVar("0017", 1),
        teleport("galleries", 9, 36, "recovery"),
      ],
      { graphicAssetId: GRAPHICS.rune },
    ),
  ]);
  npc(e, "varos-gallery", "Varos", 49, 27, GRAPHICS.varos, [
    "Vous avez inscrit trois prix consentis. Demain, une ville refusera pendant qu’une autre se noiera. Qui tranchera entre elles ?",
    "Mon erreur n’est pas de voir ce conflit. C’est d’avoir décidé que personne d’autre ne devait jamais le voir.",
  ]);
  e.normal("origin-lock", "Mécanisme originel", cell(52, 8), GRAPHICS.source, [
    page(
      [
        ifVariable(
          "0015",
          3,
          [
            say(
              null,
              "Les trois ancres portent un bienfait, un prix et des témoins. Le verrou reconnaît un Pacte complet.",
            ),
            switchOn("0074"),
            activity("ouvrir_mecanisme"),
            teleport("heart", 7, 37, "magical"),
          ],
          [
            say(
              null,
              "Les ancrages du grain, de la garde et du nom doivent tous répondre. Au moins l’un reste ouvert.",
            ),
          ],
        ),
      ],
      { graphicAssetId: GRAPHICS.source },
    ),
    page(
      [
        say(
          null,
          "Le cristal central répond aux trois ancres. Son passage matérialisé conduit au Cœur du Pacte.",
        ),
        teleport("heart", 7, 37, "magical"),
      ],
      {
        condSwitchId: "0074",
        graphicAssetId: GRAPHICS.source,
      },
    ),
  ]);
  portal(
    e,
    "back-war",
    "Conduit de bataille",
    6,
    40,
    { map: "war", col: 30, row: 35 },
    [],
    "",
    "interior",
    GRAPHICS.soldierRed,
    "Le veilleur remonte le conduit acoustique vers l’infirmerie du champ de bataille.",
  );
  monsterPack(
    e,
    "eclipse-fragments",
    "Fragment de l’Éclipse",
    "skull_guard",
    [cell(14, 20), cell(26, 14), cell(35, 27), cell(48, 19)],
    { rank: "elite", maxHp: 360, damage: 33, xp: 270 },
  );
  monsterPack(
    e,
    "gallery-collectors",
    "Collecteur des conduits",
    "hex_shaman",
    [cell(16, 20), cell(39, 23), cell(45, 28)],
    { maxHp: 215, damage: 25, xp: 180, specialTechnique: "hex_burst" },
  );
  e.monster("gallery-breaker", "Briseur du puits central", cell(30, 22), "gate_troll", {
    rank: "elite",
    maxHp: 500,
    damage: 36,
    xp: 330,
    weakness: "ranger",
    weaknessPercent: 145,
    specialTechnique: "troll_quake",
  });
  explorationCache(
    e,
    "gallery-height-cache",
    "Conduit de maintenance",
    49,
    6,
    "Le conduit supérieur contourne les salles de prélèvement. Des ouvriers y cachaient une part de leurs rations.",
    40,
  );
  return bundleMap(
    "galleries",
    "Galeries de la Source",
    terrainLayers("galleries", {
      water: [
        { col: 20, row: 2, width: 3, height: 34 },
        { col: 36, row: 9, width: 3, height: 34 },
        { col: 2, row: 25, width: 18, height: 3 },
        { col: 23, row: 17, width: 13, height: 3 },
        { col: 39, row: 25, width: 19, height: 3 },
      ],
      carve: [
        { col: 20, row: 28, width: 3, height: 5 },
        { col: 36, row: 18, width: 3, height: 5 },
        { col: 11, row: 25, width: 5, height: 3 },
        { col: 28, row: 17, width: 5, height: 3 },
        { col: 47, row: 25, width: 5, height: 3 },
      ],
    }),
    spawn,
    e.events,
    mapElements("sacred", "galleries", e, spawn, [
      element(BUILDINGS.ruinedCastle, 47, 8),
      element(BUILDINGS.purpleTower, 14, 29),
      element(BUILDINGS.blackTower, 29, 12),
      element(BUILDINGS.yellowTower, 43, 31),
    ]),
  );
}

function ending(switchId: string, text: string): readonly EventCommand[] {
  return [
    say(null, text),
    switchOn(switchId),
    switchOn("0079"),
    activity("choisir_aube"),
    teleport("epilogue", 8, 35, "memory"),
  ];
}

const eclipseEnding = ending(
  "0056",
  "Le mécanisme cède sans structure de remplacement. Les armées cessent de recevoir du lumen, mais les souvenirs accumulés se répandent dans le monde.",
);

function restoredPactCommands(): readonly EventCommand[] {
  return [
    ifVariable(
      "0001",
      6,
      [
        ifVariable(
          "0004",
          6,
          [
            ifVariable(
              "0007",
              5,
              [
                ifVariable(
                  "0008",
                  4,
                  [
                    ifVariable(
                      "0011",
                      4,
                      [
                        ifVariable(
                          "0016",
                          2,
                          ending(
                            "0051",
                            "Les quatre peuples reprennent la Source sous un registre public. Chaque prélèvement exige consentement, terme et témoins Liin.",
                          ),
                          eclipseEnding,
                        ),
                      ],
                      eclipseEnding,
                    ),
                  ],
                  eclipseEnding,
                ),
              ],
              eclipseEnding,
            ),
          ],
          eclipseEnding,
        ),
      ],
      eclipseEnding,
    ),
  ];
}

function reformedCrownCommands(): readonly EventCommand[] {
  const control = ifSwitch(
    "0027",
    ending(
      "0054",
      "Une Couronne limitée est confiée à un conseil contrôlé par les régions. Elle stabilise la Source, mais conserve un centre capable d’abus.",
    ),
    [
      ifSwitch(
        "0028",
        ending(
          "0054",
          "Serah accepte une garde limitée par des mandats publics. La stabilité revient, accompagnée d’une surveillance que personne ne juge superflue.",
        ),
        [
          ifSwitch(
            "0029",
            ending(
              "0054",
              "Les communes administrent une Couronne limitée. Ses comptes sont ouverts ; son pouvoir reste assez réel pour inquiéter ceux qui l’ont créée.",
            ),
            ending(
              "0055",
              "Faute de confiance entre les factions, le Conseil remet l’administration à Varos. Il promet des audits et conserve les prélèvements.",
            ),
          ),
        ],
      ),
    ],
  );
  return [
    ifVariable(
      "0002",
      6,
      [
        ifVariable(
          "0004",
          4,
          [
            ifVariable(
              "0008",
              5,
              [control],
              ending(
                "0055",
                "La réforme manque de stabilité. Varos reprend les canaux au nom de l’urgence.",
              ),
            ),
          ],
          ending(
            "0055",
            "Sans concorde, le conseil se fracture et Varos devient l’arbitre permanent qu’il proposait d’être.",
          ),
        ),
      ],
      ending(
        "0055",
        "L’ordre nécessaire à une réforme manque. Les officiers demandent à Varos de reprendre le contrôle des sceaux.",
      ),
    ),
  ];
}

function buildHeart(refs: StoryRefs): AdventureBundleMap {
  const e = createEventFactory("heart", refs);
  const spawn = cell(7, 37);
  npc(e, "source-memory", "Mémoire de la Source", 13, 34, GRAPHICS.rune, [
    "Les voix ne forment pas un chœur. Chacune conserve une demande concrète : revoir un enfant, sauver une récolte, ne pas être oublié après la mort.",
    "L’Éclipse naît là où ces voix ont été séparées du prix et des témoins qui auraient pu en répondre.",
  ]);
  e.normal("varos-choice", "Varos", cell(28, 27), GRAPHICS.varos, [
    page(
      [
        say(
          "Varos",
          "Mon nouvel anneau prélèvera moins sur chacun, sans exception ni faveur. C’est une amélioration réelle et un crime durable. Je n’en nie aucun terme.",
        ),
        choice("Comment atteindre le mécanisme ?", [
          {
            label: "Affronter l’avatar de la Couronne",
            body: [
              switchOn("0082"),
              say(
                "Varos",
                "Alors combattez une projection, pas un homme. Même vaincue, elle ne prendra aucune décision à votre place.",
              ),
              { t: "setSelfSwitch", selfSwitch: "A", value: true },
              teleport("heart", 51, 10, "recovery"),
            ],
          },
          {
            label: "Passer et répondre à son argument",
            body: [
              addVar("0005", 1),
              say(
                "Varos",
                "Bien. Les batailles donnent souvent au vainqueur l’illusion d’avoir aussi eu raison.",
              ),
              { t: "setSelfSwitch", selfSwitch: "A", value: true },
              teleport("heart", 32, 17, "recovery"),
            ],
          },
        ]),
      ],
      { graphicAssetId: GRAPHICS.varos },
    ),
    page(
      [
        say(
          "Varos",
          "Le mécanisme attend. Aucun résultat ne rendra innocentes les personnes qui le choisiront.",
        ),
      ],
      { condSelfSwitch: "A", graphicAssetId: GRAPHICS.varos },
    ),
  ]);
  e.monster(
    "varos-avatar",
    "Avatar de la Couronne",
    cell(51, 9),
    "gate_troll",
    {
      rank: "boss",
      maxHp: 4_200,
      damage: 48,
      speed: 76,
      xp: 2_400,
      weakness: "ranger",
      weaknessPercent: 160,
      specialTechnique: "troll_quake",
    },
    [
      switchOn("0050"),
      addVar("0003", 1),
      activity("vaincre_avatar"),
      say(
        "Varos",
        "Vous avez brisé l’anneau extérieur. Le choix demeure exactement aussi difficile.",
      ),
      teleport("heart", 32, 17, "recovery"),
    ],
    undefined,
    ["0082"],
  );
  npc(e, "eryndor-last", "Eryndor", 28, 19, GRAPHICS.monkPurple, [
    "Je ne peux pas annuler mon serment : je suis devenu l’une de ses clauses. Vous pouvez lui donner un terme, le détruire ou le transmettre autrement.",
    "Ne choisissez pas pour obtenir mon pardon. Les morts n’administreront pas les conséquences.",
    "Restaurer demande des témoins, des peuples accordés, des alliés et deux dettes librement assumées. Sans cela, les voix seront relâchées sans lien.",
    "Détruire exige des relais pour les services ; sceller, des mémoires et des canaux stables ; réformer, un commandement légitime capable de se limiter.",
  ]);
  e.normal("final-mechanism", "Cœur du Pacte", cell(32, 15), GRAPHICS.source, [
    page(
      [
        say(
          null,
          "Trois ancres portent les prix consentis. Autour d’elles, la Couronne maintient les digues, les soins et la prison de l’Éclipse.",
        ),
        choice("Quelle famille de solution choisir ?", [
          {
            label: "Restaurer le Pacte collectif",
            body: restoredPactCommands(),
          },
          {
            label: "Rompre ou sceller la dépendance",
            body: [
              choice("Quelle rupture assumer ?", [
                {
                  label: "Détruire la Couronne maintenant",
                  body: [
                    ifVariable(
                      "0008",
                      3,
                      [
                        ifVariable(
                          "0007",
                          3,
                          ending(
                            "0052",
                            "La Couronne est détruite. Les protections les plus dépendantes cessent ; les régions gagnent leur liberté au milieu d’une crise ouverte.",
                          ),
                          eclipseEnding,
                        ),
                      ],
                      eclipseEnding,
                    ),
                  ],
                },
                {
                  label: "Sceller la Source et laisser décliner la magie",
                  body: [
                    ifVariable(
                      "0001",
                      4,
                      [
                        ifVariable(
                          "0008",
                          4,
                          [
                            ifVariable(
                              "0015",
                              3,
                              ending(
                                "0053",
                                "La Source est scellée derrière les trois ancres. La magie décline et l’Éclipse dort ; les peuples apprennent à vivre sans miracles garantis.",
                              ),
                              eclipseEnding,
                            ),
                          ],
                          eclipseEnding,
                        ),
                      ],
                      eclipseEnding,
                    ),
                  ],
                },
              ]),
            ],
          },
          {
            label: "Réformer la Couronne sous contrôle",
            body: reformedCrownCommands(),
          },
          {
            label: "Accepter la solution de Varos",
            body: ending(
              "0055",
              "Varos achève sa Couronne uniforme. La bataille cesse et les prélèvements continuent sous des règles plus égales, toujours imposées.",
            ),
          },
        ]),
      ],
      { condSwitchId: "0074", graphicAssetId: GRAPHICS.source },
    ),
  ]);
  monsterPack(
    e,
    "eclipse-core",
    "Dette sans témoin",
    "skull_crusader",
    [cell(18, 18), cell(39, 24), cell(45, 33)],
    { rank: "elite", maxHp: 420, damage: 36, xp: 300 },
  );
  monsterPack(
    e,
    "core-retinue",
    "Témoin consumé",
    "skull_guard",
    [cell(22, 20), cell(33, 19), cell(40, 28)],
    { maxHp: 250, damage: 27, xp: 190, specialTechnique: "grave_siphon" },
  );
  explorationCache(
    e,
    "heart-height-cache",
    "Anneau des témoins",
    45,
    6,
    "L'anneau supérieur porte des empreintes de mains sans noms. La vôtre tombe exactement dans l'une d'elles.",
    50,
  );
  return bundleMap(
    "heart",
    "Cœur du Pacte",
    terrainLayers("heart", {
      water: [
        { col: 2, row: 12, width: 19, height: 4 },
        { col: 39, row: 12, width: 19, height: 4 },
        { col: 21, row: 25, width: 18, height: 4 },
        { col: 29, row: 2, width: 3, height: 8 },
        { col: 29, row: 31, width: 3, height: 12 },
      ],
      carve: [
        { col: 10, row: 12, width: 5, height: 4 },
        { col: 46, row: 12, width: 5, height: 4 },
        { col: 28, row: 25, width: 5, height: 4 },
        { col: 29, row: 6, width: 3, height: 4 },
        { col: 29, row: 34, width: 3, height: 5 },
      ],
    }),
    spawn,
    e.events,
    mapElements("sacred", "heart", e, spawn, [
      element(BUILDINGS.ruinedCastle, 27, 10),
      element(BUILDINGS.blackTower, 47, 9),
      element(BUILDINGS.purpleTower, 11, 28),
      element(BUILDINGS.yellowMonastery, 41, 34),
    ]),
  );
}

function endingNpc(
  factory: Factory,
  key: string,
  name: string,
  col: number,
  row: number,
  graphic: MapEventPage["graphicAssetId"],
  conditionSwitchId: string,
  text: string,
  highCondition?: {
    variableId: string;
    min: number;
    text: string;
  },
): void {
  factory.normal(key, name, cell(col, row), graphic, [
    page([say(name, text)], { condSwitchId: conditionSwitchId, graphicAssetId: graphic }),
    ...(highCondition
      ? [
          page([say(name, highCondition.text)], {
            condSwitchId: conditionSwitchId,
            condVariableId: highCondition.variableId,
            condVariableMin: highCondition.min,
            graphicAssetId: graphic,
          }),
        ]
      : []),
  ]);
}

function buildEpilogue(refs: StoryRefs): AdventureBundleMap {
  const e = createEventFactory("epilogue", refs);
  const spawn = cell(8, 35);
  endingNpc(
    e,
    "restored-witness",
    "Elyne",
    17,
    31,
    GRAPHICS.elyne,
    "0051",
    "Les assemblées se disputent déjà sur la première dette. C’est lent et fragile ; c’est aussi la première fois que le désaccord figure dans le registre.",
  );
  endingNpc(
    e,
    "destroyed-witness",
    "Maëlys",
    19,
    31,
    GRAPHICS.maelys,
    "0052",
    "Deux digues ont cédé et aucune prison politique ne les remplacera. Nous construisons avec du bois, des équipes et des comptes que chacun peut lire.",
    {
      variableId: "0003",
      min: 6,
      text: "Les communes ont déjà leurs équipes et leurs comptes. La liberté acquise n’empêche pas les crues ; elle permet enfin de décider publiquement qui les affronte.",
    },
  );
  endingNpc(
    e,
    "sealed-witness",
    "Talen",
    21,
    31,
    GRAPHICS.talen,
    "0053",
    "Les soins magiques s’éteignent. Je recopie les méthodes ordinaires à côté des noms rendus ; aucun livre ne doit faire croire que la perte fut sans coût.",
    {
      variableId: "0009",
      min: 8,
      text: "Les preuves réunies empêchent les anciens bénéficiaires d’appeler le scellement une catastrophe sans cause. Je recopie aussi les soins ordinaires que nous aurions dû préserver plus tôt.",
    },
  );
  e.normal("reformed-witness", "Lyra", cell(17, 33), GRAPHICS.lyra, [
    page(
      [
        say(
          "Lyra",
          "J’ai gardé la Citadelle et différé deux fois l’assemblée. La troisième date est affichée sur chaque porte ; si je la repousse, les compagnies ont ordre de me relever.",
        ),
      ],
      { condSwitchId: "0027", graphicAssetId: GRAPHICS.lyra },
    ),
    page(
      [
        say(
          "Lyra",
          "Les quartiers m’ont confié le commandement sans me céder leurs registres. Je présente chaque semaine les pertes et les réserves devant leurs délégués.",
        ),
      ],
      {
        condSwitchId: "0027",
        condVariableId: "0006",
        condVariableMin: 4,
        graphicAssetId: GRAPHICS.lyra,
      },
    ),
    page(
      [
        say(
          "Lyra",
          "Serah commande la Citadelle. Je lui ai remis mes officiers et conservé le droit de publier leurs ordres ; notre alliance tient parce qu’elle peut être contrôlée.",
        ),
      ],
      { condSwitchId: "0028", graphicAssetId: GRAPHICS.lyra },
    ),
    page(
      [
        say(
          "Lyra",
          "Les communes ont pris le Fort. Je protège leurs routes sans parler en leur nom ; c’est moins de pouvoir que je n’en avais, et davantage de comptes à rendre.",
        ),
      ],
      { condSwitchId: "0029", graphicAssetId: GRAPHICS.lyra },
    ),
    page(
      [
        say(
          "Lyra",
          "Le Conseil technique a gardé les sceaux. Je siège dehors avec les familles des convois et je vérifie chaque prélèvement qu’il voudrait de nouveau classer secret.",
        ),
      ],
      { condSwitchId: "0030", graphicAssetId: GRAPHICS.lyra },
    ),
    page(
      [
        say(
          "Lyra",
          "La nouvelle garde possède assez de pouvoir pour m’inquiéter. J’ai demandé que mon propre mandat soit le premier à expirer.",
        ),
      ],
      { condSwitchId: "0054", graphicAssetId: GRAPHICS.lyra },
    ),
    page(
      [
        say(
          "Lyra",
          "Vous m’avez accordé assez de confiance pour gouverner et assez peu pour exiger une date de fin. Mon mandat expirera avant celui des autres gardiens.",
        ),
      ],
      {
        condSwitchId: "0054",
        condVariableId: "0006",
        condVariableMin: 4,
        graphicAssetId: GRAPHICS.lyra,
      },
    ),
  ]);
  e.normal("varos-witness", "Serah", cell(19, 33), GRAPHICS.serah, [
    page(
      [
        say(
          "Serah",
          "J’ai choisi la justice. Nous gardons des prisonniers coûteux et des dossiers que personne ne pourra remplacer par le nom de mon père.",
        ),
      ],
      { condSwitchId: "0031", graphicAssetId: GRAPHICS.serah },
    ),
    page(
      [
        say(
          "Serah",
          "J’ai choisi la vengeance et certains coupables ne parleront jamais. Je commande encore, mais je ne demanderai à personne d’appeler ce manque une victoire propre.",
        ),
      ],
      { condSwitchId: "0032", graphicAssetId: GRAPHICS.serah },
    ),
    page(
      [
        say(
          "Serah",
          "La guerre est finie et les chariots roulent encore, mieux comptés qu’avant. Je garde les noms que le registre officiel continue d’appeler quotas.",
        ),
      ],
      { condSwitchId: "0055", graphicAssetId: GRAPHICS.serah },
    ),
    page(
      [
        say(
          "Serah",
          "Varos cite vos anciens accords pour légitimer ses quotas. Ils ont sauvé des vies ; ils lui donnent maintenant des précédents que nous devrons combattre un par un.",
        ),
      ],
      {
        condSwitchId: "0055",
        condVariableId: "0005",
        condVariableMin: 5,
        graphicAssetId: GRAPHICS.serah,
      },
    ),
  ]);
  e.normal("varkesh-record", "Registre de Varkesh", cell(23, 30), GRAPHICS.rune, [
    page(
      [
        say(
          null,
          "L’acte de décès de Varkesh ne porte aucun titre honorifique. Son dossier reste ouvert pour les familles de la rue du Four.",
        ),
      ],
      { condSwitchId: "0006", graphicAssetId: GRAPHICS.rune },
    ),
    page(
      [
        say(
          null,
          "Varkesh témoigne sous garde. Ses tables accusent le Conseil ; les familles de la rue du Four utilisent le même témoignage contre lui.",
        ),
      ],
      { condSwitchId: "0007", graphicAssetId: GRAPHICS.rune },
    ),
    page(
      [
        say(
          null,
          "Varkesh commande encore les survivants du faubourg sous mandat d’un mois. La trêve ne suspend pas les plaintes déposées contre lui.",
        ),
      ],
      { condSwitchId: "0008", graphicAssetId: GRAPHICS.rune },
    ),
  ]);
  endingNpc(
    e,
    "eclipse-witness",
    "Linn",
    21,
    33,
    GRAPHICS.child,
    "0056",
    "Les adultes oublient des rues entières. J’écris les directions sur les murs pour que les gens puissent rentrer même quand leur mémoire se trompe.",
    {
      variableId: "0017",
      min: 8,
      text: "La brume atteint le camp chaque matin. J’écris les directions et le nom des enfants sur les deux côtés des portes, parce qu’un seul côté disparaît parfois.",
    },
  );
  e.normal("saved-families", "Camp des familles", cell(25, 27), GRAPHICS.refugee, [
    page(
      [
        say(
          "Mara",
          "Les familles évacuées à Aubeval et au Marais ont monté ce camp. Elles ont perdu leurs maisons, pas la liste de ceux qu’elles ont sortis.",
        ),
      ],
      { condVariableId: "0010", condVariableMin: 5, graphicAssetId: GRAPHICS.refugee },
    ),
  ]);
  e.normal("ordinary-clinic", "Dispensaire de toile", cell(28, 27), GRAPHICS.monkYellow, [
    page(
      [
        say(
          "Sœur Ane",
          "Les jardins et les caisses sauvés pendant la guerre nous donnent un mois. Ce n’est pas un miracle : c’est du temps pour former d’autres mains.",
        ),
      ],
      { condVariableId: "0019", condVariableMin: 5, graphicAssetId: GRAPHICS.monkYellow },
    ),
  ]);
  e.normal("travelling-archive", "Archive ambulante", cell(34, 27), GRAPHICS.rune, [
    page(
      [
        say(
          null,
          "Les fragments Liin circulent en quatre copies. Chaque coffre porte le nom de son gardien et la date à laquelle il doit remettre sa charge.",
        ),
      ],
      { condVariableId: "0011", condVariableMin: 4, graphicAssetId: GRAPHICS.rune },
    ),
  ]);
  e.normal("consented-table", "Table des dettes consenties", cell(37, 27), GRAPHICS.rune, [
    page(
      [
        say(
          null,
          "Plusieurs communautés ont déjà inscrit un prix, un terme et le droit de se retirer. Aucun accord n’est identique au précédent.",
        ),
      ],
      { condVariableId: "0016", condVariableMin: 2, graphicAssetId: GRAPHICS.rune },
    ),
  ]);
  e.normal("eclipse-mist", "Brume résiduelle", cell(40, 27), GRAPHICS.rune, [
    page(
      [
        say(
          null,
          "La forte pression accumulée laisse des reflets en retard sur les voyageurs. Des Veilleurs consignent chaque incident au lieu de le déclarer résolu.",
        ),
      ],
      { condVariableId: "0017", condVariableMin: 8, graphicAssetId: GRAPHICS.rune },
    ),
  ]);
  e.normal("book-of-liin", "Livre des Liin", cell(31, 22), GRAPHICS.rune, [
    page([say(null, "Le livre attend que le mécanisme du Pacte ait reçu une décision.")], {
      graphicAssetId: GRAPHICS.rune,
    }),
    page(
      [
        say(
          null,
          "Liin : témoin vivant, mémoire transmise, dette refusée à l’oubli. Les noms retirés des registres demeurent dans les communautés qui les portent.",
        ),
        say(
          null,
          "Le Pacte restauré n’est pas une paix définitive. Il est une procédure publique pour qu’aucun miracle ne cache de nouveau son prix.",
        ),
        switchOn("0057"),
        { t: "endAdventure" },
      ],
      { condSwitchId: "0051", graphicAssetId: GRAPHICS.rune },
    ),
    page(
      [
        say(
          null,
          "Liin : témoin vivant, mémoire transmise, dette refusée à l’oubli. Les noms survivent à la Couronne désormais détruite.",
        ),
        say(
          null,
          "La liberté commence au milieu des digues rompues et des soins perdus. Les survivants devront décider quels secours rebâtir sans impôt humain.",
        ),
        switchOn("0057"),
        { t: "endAdventure" },
      ],
      { condSwitchId: "0052", graphicAssetId: GRAPHICS.rune },
    ),
    page(
      [
        say(
          null,
          "Liin : témoin vivant, mémoire transmise, dette refusée à l’oubli. Le mot demeure alors que la Source se tait.",
        ),
        say(
          null,
          "La magie décline. Les peuples gagnent du temps contre l’Éclipse et perdent les miracles dont ils avaient bâti leur monde.",
        ),
        switchOn("0057"),
        { t: "endAdventure" },
      ],
      { condSwitchId: "0053", graphicAssetId: GRAPHICS.rune },
    ),
    page(
      [
        say(
          null,
          "Liin : témoin vivant, mémoire transmise, dette refusée à l’oubli. Le nouveau conseil doit conserver ce mot dans chaque décret.",
        ),
        say(
          null,
          "La Couronne réformée stabilise les protections. Elle garde aussi la capacité de redevenir l’instrument qu’elle prétend avoir corrigé.",
        ),
        switchOn("0057"),
        { t: "endAdventure" },
      ],
      { condSwitchId: "0054", graphicAssetId: GRAPHICS.rune },
    ),
    page(
      [
        say(
          null,
          "Liin : nom absent du registre mais pas du monde. Sous Varos, les témoins transmettent les dettes que l’État réduit encore à des chiffres.",
        ),
        say(
          null,
          "La paix revient avec des quotas égaux et obligatoires. Le système est plus prévisible, pas plus libre.",
        ),
        switchOn("0057"),
        { t: "endAdventure" },
      ],
      { condSwitchId: "0055", graphicAssetId: GRAPHICS.rune },
    ),
    page(
      [
        say(
          null,
          "Liin : témoin vivant quand la mémoire du monde se déchire. Le mot devient une tâche quotidienne plutôt qu’un titre.",
        ),
        say(
          null,
          "La bataille est finie, mais l’Éclipse traverse les routes. Les survivants cartographient ce que chacun oublie afin de rester un peuple.",
        ),
        switchOn("0057"),
        { t: "endAdventure" },
      ],
      { condSwitchId: "0056", graphicAssetId: GRAPHICS.rune },
    ),
  ]);
  npc(e, "last-stone", "Stèle des absents", 39, 30, GRAPHICS.rune, [
    "Aucun nom n’est gravé seul. Chaque ligne indique qui l’a transmis, ce que la personne avait donné et qui avait reçu le bienfait.",
  ]);
  explorationCache(
    e,
    "epilogue-height-cache",
    "Balise des voyageurs",
    32,
    6,
    "La balise rassemble les itinéraires découverts. Des voyageurs y laissent désormais de quoi aider les suivants.",
    25,
  );
  return bundleMap(
    "epilogue",
    "Plaine des Liin",
    terrainLayers("epilogue", {
      water: [
        { col: 2, row: 8, width: 18, height: 3 },
        { col: 40, row: 8, width: 18, height: 3 },
        { col: 24, row: 31, width: 12, height: 3 },
      ],
      carve: [
        { col: 9, row: 8, width: 5, height: 3 },
        { col: 47, row: 8, width: 5, height: 3 },
        { col: 28, row: 31, width: 4, height: 3 },
      ],
    }),
    spawn,
    e.events,
    mapElements("road", "epilogue", e, spawn, [
      element(BUILDINGS.yellowHouse1, 10, 32),
      element(BUILDINGS.blueHouse1, 46, 32),
      element(BUILDINGS.yellowMonastery, 28, 9),
    ]),
  );
}

export function buildMaps(refs: StoryRefs): AdventureBundleMap[] {
  return [
    buildPrologue(refs),
    buildAubeval(refs),
    buildFaubourg(refs),
    buildRelay(refs),
    buildWoods(refs),
    buildRoots(refs),
    buildMarsh(refs),
    buildArchives(refs),
    buildCitadel(refs),
    buildFort(refs),
    buildSanctuary(refs),
    buildCrypt(refs),
    buildWar(refs),
    buildGalleries(refs),
    buildHeart(refs),
    buildEpilogue(refs),
  ];
}
