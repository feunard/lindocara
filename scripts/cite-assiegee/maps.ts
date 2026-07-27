import type { AdventureBundleMap } from "@lindocara/engine/adventure-bundle.js";
import type { EventCommand } from "@lindocara/engine/event-commands.js";
import type { MonsterSpecies, MonsterTuning } from "@lindocara/engine/game.js";
import type { MapElement } from "@lindocara/engine/map-data.js";
import type { EditorAssetId } from "@lindocara/engine/tiny-swords-catalog.js";
import {
  addVar,
  bundleMap,
  cell,
  createEventFactory,
  element,
  endAdventure,
  GRAPHICS,
  gold,
  items,
  type MapKey,
  page,
  S,
  type StoryRefs,
  say,
  selfSwitchOn,
  switchOn,
  teleport,
  terrainLayers,
  V,
  wait,
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
  purpleHouse1: "building.buildings-purple-buildings.house1",
  purpleHouse2: "building.buildings-purple-buildings.house2",
  purpleHouse3: "building.buildings-purple-buildings.house3",
  purpleBarracks: "building.buildings-purple-buildings.barracks",
  purpleMonastery: "building.buildings-purple-buildings.monastery",
  purpleTower: "building.buildings-purple-buildings.tower",
  blackHouse1: "building.buildings-black-buildings.house1",
  blackHouse2: "building.buildings-black-buildings.house2",
  blackHouse3: "building.buildings-black-buildings.house3",
  blackBarracks: "building.buildings-black-buildings.barracks",
  blackCastle: "building.buildings-black-buildings.castle",
  blackTower: "building.buildings-black-buildings.tower",
  ruinedHouse: "building.factions-knights-buildings-house.house-destroyed",
  ruinedTower: "building.factions-knights-buildings-tower.tower-destroyed",
  ruinedCastle: "building.factions-knights-buildings-castle.castle-destroyed",
  constructionHouse: "building.factions-knights-buildings-house.house-construction",
  constructionTower: "building.factions-knights-buildings-tower.tower-construction",
  goblinHouse: "building.factions-goblins-buildings-wood-house.goblin-house",
  ruinedGoblinHouse: "building.factions-goblins-buildings-wood-house.goblin-house-destroyed",
  ruinedGoblinTower: "building.factions-goblins-buildings-wood-tower.wood-tower-destroyed",
} as const satisfies Record<string, EditorAssetId>;

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
  mushroom1: "decoration.deco.01",
  mushroom2: "decoration.deco.02",
  mushroom3: "decoration.deco.03",
  stone1: "decoration.deco.04",
  stone2: "decoration.deco.05",
  stone3: "decoration.deco.06",
  plant1: "decoration.deco.07",
  plant2: "decoration.deco.08",
  plant3: "decoration.deco.09",
  reeds: "decoration.deco.11",
  market1: "decoration.deco.12",
  market2: "decoration.deco.13",
  boneLarge: "decoration.deco.14",
  boneSmall: "decoration.deco.15",
  memorial: "decoration.deco.16",
  notice: "decoration.deco.17",
  scarecrow: "decoration.deco.18",
  bush1: "decoration.terrain-decorations-bushes.bushe1",
  bush2: "decoration.terrain-decorations-bushes.bushe2",
  bush3: "decoration.terrain-decorations-bushes.bushe3",
  bush4: "decoration.terrain-decorations-bushes.bushe4",
  rock1: "decoration.terrain-decorations-rocks.rock1",
  rock2: "decoration.terrain-decorations-rocks.rock2",
  rock3: "decoration.terrain-decorations-rocks.rock3",
  rock4: "decoration.terrain-decorations-rocks.rock4",
  tree1: "resource.terrain-resources-wood-trees.tree1",
  tree2: "resource.terrain-resources-wood-trees.tree2",
  tree3: "resource.terrain-resources-wood-trees.tree3",
  tree4: "resource.terrain-resources-wood-trees.tree4",
  stump1: "resource.terrain-resources-wood-trees.stump-1",
  stump2: "resource.terrain-resources-wood-trees.stump-2",
  stump3: "resource.terrain-resources-wood-trees.stump-3",
  goldStone1: "resource.terrain-resources-gold-gold-stones.gold-stone-1",
  goldStone2: "resource.terrain-resources-gold-gold-stones.gold-stone-2",
  goldStone3: "resource.terrain-resources-gold-gold-stones.gold-stone-3",
  goldStone4: "resource.terrain-resources-gold-gold-stones.gold-stone-4",
  goldStone5: "resource.terrain-resources-gold-gold-stones.gold-stone-5",
  goldStone6: "resource.terrain-resources-gold-gold-stones.gold-stone-6",
} as const satisfies Record<string, EditorAssetId>;

function battleTrigger(
  factory: Factory,
  key: string,
  name: string,
  position: { col: number; row: number },
  switchId: string,
) {
  return factory.normal(key, name, position, GRAPHICS.sign, [
    page([switchOn(switchId), selfSwitchOn("A")], { trigger: "player-touch" }),
    page([], { condSelfSwitch: "A" }),
  ]);
}

function portal(
  factory: Factory,
  key: string,
  name: string,
  position: { col: number; row: number },
  commands: readonly EventCommand[],
  graphic: EditorAssetId = GRAPHICS.rune,
) {
  return factory.normal(key, name, position, graphic, [page(commands, { trigger: "action" })]);
}

function gatedPortal(
  factory: Factory,
  key: string,
  name: string,
  position: { col: number; row: number },
  variableId: string,
  minimum: number,
  destination: EventCommand,
) {
  return factory.normal(key, name, position, GRAPHICS.rune, [
    page([say(null, "La voie reste fermée tant que le secteur n’est pas sûr.")], {
      trigger: "action",
    }),
    page([destination], {
      condVariableId: variableId,
      condVariableMin: minimum,
      trigger: "action",
    }),
  ]);
}

function waveMonster(
  factory: Factory,
  key: string,
  name: string,
  position: { col: number; row: number },
  species: MonsterSpecies,
  switchId: string,
  variableId: string,
  threshold: number,
  tuning: Partial<MonsterTuning> = {},
) {
  return factory.monster(key, name, position, species, {
    conditionSwitchId: switchId,
    conditionVariable: { id: variableId, min: threshold },
    tuning,
    commands: [addVar(variableId)],
  });
}

function rowOf(
  assets: readonly EditorAssetId[],
  cols: readonly number[],
  row: number,
): MapElement[] {
  const fallback = assets[0];
  if (fallback === undefined) return [];
  return cols.map((col, index) => element(assets[index % assets.length] ?? fallback, col, row));
}

function routeMap(refs: StoryRefs): AdventureBundleMap {
  const factory = createEventFactory("route", refs);
  const spawn = cell(4, 19);
  factory.anchor("spawn", "Départ de l’aventure", spawn, "spawn");
  factory.normal("captain", "Capitaine de la porte", cell(6, 16), GRAPHICS.captain, [
    page(
      [
        say(
          "Capitaine",
          "La cité a été découverte. La porte basse a cédé ; les deux suivantes tiennent encore.",
        ),
      ],
      { trigger: "action" },
    ),
  ]);

  factory.monster("patrol-a", "Éclaireur de la gorge", cell(10, 18), "spear_goblin", {
    tuning: { specialTechnique: "spear_fan", weakness: "ranger", weaknessPercent: 145 },
  });
  factory.monster("patrol-b", "Porte-torche", cell(14, 22), "torch_goblin", {
    tuning: { specialTechnique: "fire_burst", weakness: "priest", weaknessPercent: 145 },
  });
  factory.monster("patrol-c", "Maraudeur du poste", cell(23, 15), "gnoll_marauder", {
    tuning: { specialTechnique: "marauder_frenzy", weakness: "warrior", weaknessPercent: 140 },
  });
  factory.monster("patrol-d", "Sanglier échappé", cell(29, 20), "war_pig", {
    tuning: { specialTechnique: "tusk_charge", speed: 132 },
  });

  battleTrigger(factory, "gate-trigger", "Ligne de défense ennemie", cell(35, 19), S.routeBattle);
  waveMonster(
    factory,
    "gate-w1-a",
    "Lancier de la première porte",
    cell(39, 16),
    "spear_goblin",
    S.routeBattle,
    V.routeKills,
    0,
    { specialTechnique: "spear_fan" },
  );
  waveMonster(
    factory,
    "gate-w1-b",
    "Porte-torche de la porte",
    cell(40, 20),
    "torch_goblin",
    S.routeBattle,
    V.routeKills,
    0,
    { specialTechnique: "fire_burst" },
  );
  waveMonster(
    factory,
    "gate-w1-c",
    "Lancier du parapet",
    cell(38, 23),
    "spear_goblin",
    S.routeBattle,
    V.routeKills,
    0,
    { specialTechnique: "spear_fan" },
  );
  waveMonster(
    factory,
    "gate-w2-a",
    "Sanglier de guerre",
    cell(44, 15),
    "war_pig",
    S.routeBattle,
    V.routeKills,
    3,
    { specialTechnique: "tusk_charge", speed: 136 },
  );
  waveMonster(
    factory,
    "gate-w2-b",
    "Sanglier du passage",
    cell(45, 21),
    "war_pig",
    S.routeBattle,
    V.routeKills,
    3,
    { specialTechnique: "tusk_charge", speed: 136 },
  );
  waveMonster(
    factory,
    "gate-w2-c",
    "Maraudeur de renfort",
    cell(47, 19),
    "gnoll_marauder",
    S.routeBattle,
    V.routeKills,
    3,
    { specialTechnique: "marauder_frenzy" },
  );
  waveMonster(
    factory,
    "gate-w3-a",
    "Chevaucheur de la porte",
    cell(50, 16),
    "pig_rider",
    S.routeBattle,
    V.routeKills,
    6,
    {
      rank: "elite",
      maxHp: 160,
      damage: 16,
      xp: 110,
      specialTechnique: "mounted_trample",
      weakness: "ranger",
      weaknessPercent: 155,
    },
  );
  waveMonster(
    factory,
    "gate-w3-b",
    "Maraudeur de la brèche",
    cell(50, 23),
    "gnoll_marauder",
    S.routeBattle,
    V.routeKills,
    6,
    {
      rank: "elite",
      maxHp: 125,
      damage: 14,
      xp: 90,
      specialTechnique: "marauder_frenzy",
    },
  );
  gatedPortal(
    factory,
    "to-lower",
    "Brèche vers la ville basse",
    cell(53, 19),
    V.routeKills,
    8,
    teleport("lower", 5, 43),
  );

  const elements: MapElement[] = [
    ...rowOf([SCENERY.tree1, SCENERY.tree2, SCENERY.tree3], [5, 10, 15, 23, 31, 40, 49], 12),
    ...rowOf([SCENERY.tree4, SCENERY.rock2, SCENERY.rock4], [6, 13, 20, 27, 36, 44, 51], 28),
    element(BUILDINGS.ruinedTower, 8, 17),
    element(BUILDINGS.blueBarracks, 13, 15),
    element(BUILDINGS.blueTower, 18, 15),
    element(BUILDINGS.blueTower, 18, 27),
    element(BUILDINGS.blueBarracks, 23, 13),
    element(BUILDINGS.ruinedTower, 25, 26),
    element(BUILDINGS.ruinedHouse, 26, 29),
    element(BUILDINGS.blueTower, 34, 14),
    element(BUILDINGS.ruinedTower, 34, 28),
    element(BUILDINGS.blueBarracks, 39, 14),
    element(BUILDINGS.blackTower, 47, 14),
    element(BUILDINGS.ruinedGoblinTower, 47, 28),
    element(BUILDINGS.goblinHouse, 43, 11),
    element(BUILDINGS.goblinHouse, 51, 13),
    element(BUILDINGS.ruinedGoblinHouse, 48, 31),
    element(SCENERY.bridgeHorizontal, 31, 19),
    element(SCENERY.wood, 12, 24),
    element(SCENERY.tool2, 24, 21),
    element(SCENERY.boneLarge, 32, 17),
    element(SCENERY.boneSmall, 42, 21),
    element(SCENERY.notice, 19, 19),
    element(SCENERY.rock1, 3, 12),
    element(SCENERY.rock3, 29, 12),
    element(SCENERY.stump1, 26, 26),
  ];

  return bundleMap(
    "route",
    "La Route cachée",
    terrainLayers("route", {
      blocked: [
        { col: 2, row: 2, width: 52, height: 9 },
        { col: 2, row: 29, width: 52, height: 7 },
        { col: 2, row: 11, width: 9, height: 4 },
        { col: 12, row: 11, width: 7, height: 6 },
        { col: 20, row: 25, width: 8, height: 4 },
        { col: 29, row: 11, width: 7, height: 5 },
        { col: 37, row: 25, width: 8, height: 4 },
        { col: 46, row: 11, width: 8, height: 4 },
      ],
    }),
    spawn,
    factory.events,
    elements,
    { music: "bards-tale", ambience: "forest-ambience", combatMusic: "battle-theme" },
  );
}

function lowerMap(refs: StoryRefs): AdventureBundleMap {
  const factory = createEventFactory("lower", refs);
  const spawn = cell(5, 43);
  portal(
    factory,
    "to-route",
    "Porte basse",
    cell(3, 43),
    [teleport("route", 51, 20)],
    GRAPHICS.sign,
  );
  factory.normal("survivor", "Habitante du marché", cell(8, 40), GRAPHICS.survivor, [
    page(
      [
        say(
          "Habitante",
          "Les maisons tiennent encore. Passez par les cours : les grandes rues sont occupées.",
        ),
      ],
      { trigger: "action" },
    ),
  ]);

  for (const [key, name, position, species, technique] of [
    ["alley-a", "Lancier des entrepôts", cell(12, 36), "spear_goblin", "spear_fan"],
    ["alley-b", "Porte-torche de l’auberge", cell(18, 31), "torch_goblin", "fire_burst"],
    ["alley-c", "Maraudeur des ateliers", cell(25, 39), "gnoll_marauder", "marauder_frenzy"],
    ["alley-d", "Sanglier du canal", cell(37, 38), "war_pig", "tusk_charge"],
    ["alley-e", "Chevaucheur des casernes", cell(51, 33), "pig_rider", "mounted_trample"],
    ["alley-f", "Chamane des ruines", cell(55, 17), "hex_shaman", "hex_burst"],
  ] as const) {
    factory.monster(key, name, position, species, {
      tuning: { specialTechnique: technique },
    });
  }

  battleTrigger(factory, "market-trigger", "Place du marché", cell(34, 28), S.marketBattle);
  const marketWaves = [
    {
      threshold: 0,
      enemies: [
        ["w1-a", "Lancier du marché", cell(31, 23), "spear_goblin", "spear_fan"],
        ["w1-b", "Lancier de la halle", cell(35, 21), "spear_goblin", "spear_fan"],
        ["w1-c", "Porte-torche de la place", cell(38, 25), "torch_goblin", "fire_burst"],
      ],
    },
    {
      threshold: 3,
      enemies: [
        ["w2-a", "Porte-torche de l’auberge", cell(25, 24), "torch_goblin", "fire_burst"],
        ["w2-b", "Lancier de la cour est", cell(43, 23), "spear_goblin", "spear_fan"],
        ["w2-c", "Porte-torche des ateliers", cell(42, 28), "torch_goblin", "fire_burst"],
      ],
    },
    {
      threshold: 6,
      enemies: [
        ["w3-a", "Sanglier du marché", cell(27, 29), "war_pig", "tusk_charge"],
        ["w3-b", "Sanglier des étals", cell(35, 31), "war_pig", "tusk_charge"],
        ["w3-c", "Chevaucheur de renfort", cell(41, 31), "pig_rider", "mounted_trample"],
      ],
    },
    {
      threshold: 9,
      enemies: [
        ["w4-a", "Chamane du porche", cell(28, 20), "hex_shaman", "hex_burst"],
        ["w4-b", "Chamane de la halle", cell(41, 20), "hex_shaman", "hex_burst"],
        ["w4-c", "Lancier du porche", cell(27, 26), "spear_goblin", "spear_fan"],
        ["w4-d", "Lancier de la halle", cell(40, 26), "spear_goblin", "spear_fan"],
      ],
    },
    {
      threshold: 13,
      enemies: [
        ["w5-a", "Lieutenant du marché", cell(34, 22), "gnoll_marauder", "marauder_frenzy"],
        ["w5-b", "Dernier lancier", cell(30, 27), "spear_goblin", "spear_fan"],
        ["w5-c", "Dernier porte-torche", cell(38, 27), "torch_goblin", "fire_burst"],
      ],
    },
  ] as const;
  for (const wave of marketWaves) {
    for (const [key, name, position, species, specialTechnique] of wave.enemies) {
      waveMonster(
        factory,
        `market-${key}`,
        name,
        position,
        species,
        S.marketBattle,
        V.marketKills,
        wave.threshold,
        key === "w5-a"
          ? {
              rank: "elite",
              maxHp: 165,
              damage: 17,
              xp: 130,
              specialTechnique,
              weakness: "warrior",
              weaknessPercent: 160,
            }
          : { specialTechnique },
      );
    }
  }
  gatedPortal(
    factory,
    "to-foundations",
    "Escalier des anciennes caves",
    cell(59, 5),
    V.marketKills,
    16,
    teleport("foundations", 4, 41, "interior"),
  );

  const houses = [
    ...rowOf(
      [BUILDINGS.yellowHouse1, BUILDINGS.yellowHouse2, BUILDINGS.blueHouse3],
      [7, 13, 20, 45, 52, 58],
      14,
    ),
    ...rowOf(
      [BUILDINGS.blueHouse1, BUILDINGS.yellowHouse3, BUILDINGS.ruinedHouse],
      [8, 16, 23, 46, 54, 60],
      25,
    ),
    ...rowOf(
      [BUILDINGS.yellowHouse2, BUILDINGS.blueHouse2, BUILDINGS.constructionHouse],
      [9, 16, 23, 43, 51, 58],
      37,
    ),
    ...rowOf(
      [BUILDINGS.blueHouse3, BUILDINGS.yellowHouse1, BUILDINGS.ruinedHouse],
      [12, 21, 41, 49, 57],
      46,
    ),
  ];
  const elements: MapElement[] = [
    ...houses,
    ...rowOf(
      [BUILDINGS.yellowHouse1, BUILDINGS.blueHouse2, BUILDINGS.yellowHouse3],
      [5, 10, 15, 20, 25, 39, 44, 49, 54, 59],
      11,
    ),
    ...rowOf(
      [BUILDINGS.blueHouse3, BUILDINGS.yellowHouse2, BUILDINGS.ruinedHouse],
      [6, 11, 16, 21, 26, 38, 43, 48, 53, 58],
      18,
    ),
    ...rowOf(
      [BUILDINGS.yellowHouse2, BUILDINGS.blueHouse1, BUILDINGS.constructionHouse],
      [5, 10, 15, 20, 25, 39, 44, 49, 54, 59],
      34,
    ),
    ...rowOf(
      [BUILDINGS.blueHouse2, BUILDINGS.yellowHouse3, BUILDINGS.ruinedHouse],
      [6, 11, 16, 21, 26, 38, 43, 48, 53, 58],
      42,
    ),
    element(BUILDINGS.blueBarracks, 8, 8),
    element(BUILDINGS.yellowBarracks, 22, 9),
    element(BUILDINGS.blueArchery, 48, 9),
    element(BUILDINGS.yellowTower, 59, 10),
    element(BUILDINGS.blueMonastery, 36, 12),
    element(BUILDINGS.ruinedTower, 28, 17),
    element(BUILDINGS.ruinedCastle, 57, 29),
    element(BUILDINGS.constructionTower, 4, 31),
    element(SCENERY.bridgeHorizontal, 31, 11),
    element(SCENERY.bridgeHorizontal, 31, 25),
    element(SCENERY.bridgeHorizontal, 31, 41),
    ...rowOf([SCENERY.market1, SCENERY.market2], [29, 32, 36, 39], 24),
    ...rowOf([SCENERY.wood, SCENERY.tool1, SCENERY.tool3], [11, 15, 19, 47, 51, 55], 19),
    ...rowOf([SCENERY.meat, SCENERY.gold, SCENERY.tool4], [26, 30, 34, 38, 42], 30),
    element(SCENERY.notice, 34, 19),
    element(SCENERY.boneSmall, 25, 28),
    element(SCENERY.boneLarge, 44, 31),
    element(SCENERY.tree1, 5, 17),
    element(SCENERY.tree2, 58, 19),
    element(SCENERY.tree3, 5, 29),
    element(SCENERY.tree4, 59, 39),
  ];

  return bundleMap(
    "lower",
    "La Ville basse",
    terrainLayers("lower", {
      blocked: [{ col: 30, row: 2, width: 3, height: 44 }],
      carve: [
        { col: 30, row: 9, width: 3, height: 4 },
        { col: 30, row: 23, width: 3, height: 5 },
        { col: 30, row: 39, width: 3, height: 4 },
      ],
    }),
    spawn,
    factory.events,
    elements,
    { music: "town-theme", ambience: null, combatMusic: "battle-theme" },
  );
}

function foundationsMap(refs: StoryRefs): AdventureBundleMap {
  const factory = createEventFactory("foundations", refs);
  const spawn = cell(4, 41);
  portal(
    factory,
    "to-lower",
    "Escalier vers la ville basse",
    cell(3, 41),
    [teleport("lower", 57, 6, "interior")],
    GRAPHICS.sign,
  );
  factory.normal("inscription", "Inscription des fondations", cell(6, 38), GRAPHICS.memorial, [
    page(
      [
        say(
          null,
          "Sous la ville actuelle reposent les portes d’une cité plus ancienne. Certaines ramènent en arrière.",
        ),
      ],
      { trigger: "action" },
    ),
  ]);

  for (const [key, name, position, species, technique] of [
    ["skull-a", "Garde des caves", cell(9, 34), "skull_guard", "bone_cleave"],
    ["skull-b", "Croisé de la citerne", cell(20, 38), "skull_crusader", "bone_cleave"],
    ["skull-c", "Gardien du caveau", cell(25, 28), "skull_warden", "grave_siphon"],
    ["skull-d", "Garde de la galerie", cell(11, 21), "skull_guard", "bone_cleave"],
    ["skull-e", "Croisé des marches", cell(23, 16), "skull_crusader", "grave_siphon"],
    ["skull-f", "Gardien de la salle basse", cell(35, 25), "skull_warden", "bone_cleave"],
    ["skull-g", "Garde de l’ancienne porte", cell(39, 17), "skull_guard", "bone_cleave"],
    ["skull-h", "Croisé du vestibule", cell(50, 20), "skull_crusader", "grave_siphon"],
  ] as const) {
    factory.monster(key, name, position, species, {
      tuning: { specialTechnique: technique, weakness: "priest", weaknessPercent: 155 },
    });
  }

  portal(factory, "secondary-in", "Porte latérale intacte", cell(9, 9), [
    teleport("foundations", 35, 39, "shortcut"),
  ]);
  portal(
    factory,
    "secondary-out",
    "Porte de la réserve",
    cell(35, 39),
    [gold(35), items("health_potion", 1), teleport("foundations", 10, 10, "shortcut")],
    GRAPHICS.cache,
  );
  portal(
    factory,
    "false-portal",
    "Porte fendue",
    cell(18, 20),
    [switchOn(S.cisternTrap), teleport("foundations", 51, 39, "puzzle")],
    GRAPHICS.memorial,
  );
  factory.monster("trap-a", "Garde de la citerne close", cell(49, 36), "skull_guard", {
    conditionSwitchId: S.cisternTrap,
    tuning: { specialTechnique: "bone_cleave", weakness: "priest", weaknessPercent: 155 },
    commands: [addVar(V.trapKills)],
  });
  factory.monster("trap-b", "Croisé de la citerne close", cell(54, 36), "skull_crusader", {
    conditionSwitchId: S.cisternTrap,
    tuning: { specialTechnique: "grave_siphon", weakness: "priest", weaknessPercent: 155 },
    commands: [addVar(V.trapKills)],
  });
  factory.monster("trap-c", "Gardien de la citerne close", cell(52, 42), "skull_warden", {
    conditionSwitchId: S.cisternTrap,
    tuning: {
      rank: "elite",
      maxHp: 155,
      damage: 16,
      xp: 125,
      specialTechnique: "grave_siphon",
      weakness: "priest",
      weaknessPercent: 165,
    },
    commands: [addVar(V.trapKills)],
  });
  gatedPortal(
    factory,
    "trap-return",
    "Porte de sortie de la citerne",
    cell(48, 42),
    V.trapKills,
    3,
    teleport("foundations", 19, 21, "recovery"),
  );

  factory.normal("arena-warning", "Dalle de l’arène", cell(43, 14), GRAPHICS.memorial, [
    page(
      [
        switchOn(S.foundationArena),
        wait(180),
        addVar(V.foundationKills),
        wait(220),
        addVar(V.foundationKills),
        selfSwitchOn("A"),
      ],
      { trigger: "player-touch" },
    ),
    page([], { condSelfSwitch: "A" }),
  ]);
  factory.monster("mid-boss", "Le Gardien des galeries", cell(50, 9), "minotaur_brute", {
    conditionSwitchId: S.foundationArena,
    patrolRadius: 190,
    tuning: {
      rank: "boss",
      maxHp: 720,
      damage: 20,
      speed: 72,
      xp: 520,
      weakness: "ranger",
      weaknessPercent: 145,
      specialTechnique: "horn_charge",
    },
    commands: [addVar(V.midBoss), switchOn(S.minotaurDefeated)],
  });
  for (const [key, name, position, species, technique] of [
    ["arena-a", "Garde de la galerie ouest", cell(47, 8), "skull_guard", "bone_cleave"],
    ["arena-b", "Croisé de la galerie est", cell(55, 8), "skull_crusader", "bone_cleave"],
    ["arena-c", "Gardien de la porte nord", cell(50, 15), "skull_warden", "grave_siphon"],
  ] as const) {
    factory.monster(key, name, position, species, {
      conditionSwitchId: S.foundationArena,
      conditionVariable: { id: V.foundationKills, min: 1 },
      tuning: {
        rank: key === "arena-c" ? "elite" : "normal",
        ...(key === "arena-c" ? { maxHp: 145, damage: 15, xp: 115 } : {}),
        specialTechnique: technique,
        weakness: "priest",
        weaknessPercent: 155,
      },
    });
  }
  gatedPortal(
    factory,
    "to-upper",
    "Porte vers la ville haute",
    cell(56, 4),
    V.midBoss,
    1,
    teleport("upper", 4, 42, "interior"),
  );

  const elements: MapElement[] = [
    ...rowOf([SCENERY.rock1, SCENERY.rock2, SCENERY.rock3], [5, 11, 18, 25, 35, 42, 50, 56], 6),
    ...rowOf([SCENERY.rock4, SCENERY.stone2, SCENERY.stone3], [7, 14, 22, 31, 39, 47, 55], 29),
    element(BUILDINGS.ruinedTower, 8, 17),
    element(BUILDINGS.ruinedHouse, 21, 12),
    element(BUILDINGS.ruinedCastle, 34, 20),
    element(BUILDINGS.ruinedTower, 43, 27),
    element(BUILDINGS.ruinedHouse, 25, 43),
    element(BUILDINGS.ruinedHouse, 7, 28),
    element(BUILDINGS.ruinedTower, 12, 42),
    element(BUILDINGS.ruinedHouse, 20, 25),
    element(BUILDINGS.ruinedTower, 25, 35),
    element(BUILDINGS.ruinedHouse, 34, 12),
    element(BUILDINGS.ruinedTower, 39, 29),
    element(BUILDINGS.ruinedHouse, 49, 18),
    element(BUILDINGS.ruinedTower, 55, 27),
    ...rowOf(
      [SCENERY.memorial, SCENERY.goldStone2, SCENERY.goldStone4],
      [6, 12, 19, 26, 34, 41, 49, 56],
      17,
    ),
    ...rowOf(
      [SCENERY.rock1, SCENERY.rock3, SCENERY.boneLarge],
      [5, 11, 18, 24, 34, 41, 50, 56],
      36,
    ),
    element(SCENERY.bridgeVertical, 15, 18),
    element(SCENERY.bridgeVertical, 30, 34),
    element(SCENERY.bridgeHorizontal, 44, 13),
    ...rowOf([SCENERY.boneLarge, SCENERY.boneSmall], [8, 13, 19, 24, 33, 38, 44, 49, 54], 24),
    ...rowOf(
      [SCENERY.goldStone1, SCENERY.goldStone3, SCENERY.goldStone5],
      [7, 10, 33, 36, 40, 54, 57],
      11,
    ),
    element(SCENERY.goldStone6, 9, 8),
    element(SCENERY.memorial, 17, 19),
    element(SCENERY.boneLarge, 17, 22),
    element(SCENERY.boneSmall, 20, 20),
    element(SCENERY.mushroom1, 6, 32),
    element(SCENERY.mushroom2, 27, 26),
    element(SCENERY.mushroom3, 39, 38),
    element(SCENERY.reeds, 48, 34),
    element(SCENERY.reeds, 55, 40),
  ];

  return bundleMap(
    "foundations",
    "Les Fondations",
    terrainLayers("foundations", {
      groundSlot: 2,
      blocked: [
        { col: 14, row: 2, width: 2, height: 31 },
        { col: 14, row: 12, width: 17, height: 2 },
        { col: 29, row: 12, width: 2, height: 32 },
        { col: 29, row: 30, width: 17, height: 2 },
        { col: 44, row: 2, width: 2, height: 30 },
        { col: 46, row: 31, width: 12, height: 2 },
        { col: 46, row: 31, width: 2, height: 13 },
      ],
      carve: [
        { col: 14, row: 9, width: 2, height: 3 },
        { col: 14, row: 22, width: 2, height: 4 },
        { col: 21, row: 12, width: 4, height: 2 },
        { col: 29, row: 17, width: 2, height: 4 },
        { col: 29, row: 37, width: 2, height: 4 },
        { col: 37, row: 30, width: 4, height: 2 },
        { col: 44, row: 12, width: 2, height: 4 },
        { col: 44, row: 24, width: 2, height: 4 },
      ],
    }),
    spawn,
    factory.events,
    elements,
    { music: "dungeon-ambience", ambience: null, combatMusic: "battle-theme" },
  );
}

function upperMap(refs: StoryRefs): AdventureBundleMap {
  const factory = createEventFactory("upper", refs);
  const spawn = cell(4, 42);
  portal(
    factory,
    "to-foundations",
    "Escalier des fondations",
    cell(3, 42),
    [teleport("foundations", 54, 5, "interior")],
    GRAPHICS.sign,
  );
  factory.normal("soldier", "Soldat de la ville haute", cell(7, 39), GRAPHICS.soldier, [
    page(
      [
        say(
          "Soldat",
          "La grande rue est la plus courte. Les demeures offrent des couverts. Les portes anciennes coupent par les jardins.",
        ),
      ],
      { trigger: "action" },
    ),
  ]);

  for (const [key, name, position, species, technique, elite] of [
    [
      "direct-a",
      "Maraudeur de la grande rue",
      cell(16, 27),
      "gnoll_marauder",
      "marauder_frenzy",
      false,
    ],
    ["direct-b", "Chamane du tribunal", cell(27, 25), "hex_shaman", "hex_burst", false],
    ["direct-c", "Chevaucheur de la muraille", cell(39, 24), "pig_rider", "mounted_trample", true],
    ["houses-a", "Porte-torche des demeures", cell(15, 39), "torch_goblin", "fire_burst", false],
    ["houses-b", "Lancier des jardins", cell(29, 38), "spear_goblin", "spear_fan", false],
    [
      "houses-c",
      "Maraudeur de la cour close",
      cell(46, 36),
      "gnoll_marauder",
      "marauder_frenzy",
      true,
    ],
    ["doors-a", "Garde de la porte ancienne", cell(14, 11), "skull_guard", "bone_cleave", false],
    ["doors-b", "Gardien du passage couvert", cell(37, 12), "skull_warden", "grave_siphon", true],
  ] as const) {
    factory.monster(key, name, position, species, {
      tuning: {
        ...(elite ? { rank: "elite" as const, maxHp: 155, damage: 16, xp: 125 } : {}),
        specialTechnique: technique,
      },
    });
  }

  portal(factory, "old-door-a", "Première porte ancienne", cell(10, 9), [
    teleport("upper", 34, 10, "magical"),
  ]);
  portal(factory, "old-door-b", "Porte des jardins clos", cell(34, 10), [
    teleport("upper", 47, 20, "shortcut"),
  ]);
  portal(factory, "old-door-return", "Porte de retour", cell(47, 20), [
    teleport("upper", 11, 10, "shortcut"),
  ]);
  portal(
    factory,
    "old-door-false",
    "Porte ancienne ébréchée",
    cell(21, 10),
    [switchOn(S.upperTrap), teleport("upper", 37, 40, "puzzle")],
    GRAPHICS.memorial,
  );
  for (const [key, name, position, species, technique] of [
    [
      "door-trap-a",
      "Maraudeur de la salle close",
      cell(34, 37),
      "gnoll_marauder",
      "marauder_frenzy",
    ],
    ["door-trap-b", "Chamane de la salle close", cell(40, 37), "hex_shaman", "hex_burst"],
    ["door-trap-c", "Chevaucheur de la salle close", cell(38, 43), "pig_rider", "mounted_trample"],
  ] as const) {
    factory.monster(key, name, position, species, {
      conditionSwitchId: S.upperTrap,
      tuning: {
        rank: key === "door-trap-c" ? "elite" : "normal",
        ...(key === "door-trap-c" ? { maxHp: 165, damage: 17, xp: 135 } : {}),
        specialTechnique: technique,
      },
      commands: [addVar(V.upperTrapKills)],
    });
  }
  gatedPortal(
    factory,
    "old-door-recovery",
    "Porte de la salle close",
    cell(34, 44),
    V.upperTrapKills,
    3,
    teleport("upper", 22, 11, "recovery"),
  );

  battleTrigger(factory, "upper-trigger", "Muraille intérieure", cell(48, 27), S.upperBattle);
  const upperWaves = [
    {
      threshold: 0,
      enemies: [
        ["w1-a", "Lancier de la muraille", cell(51, 24), "spear_goblin", "spear_fan"],
        ["w1-b", "Porte-torche de la muraille", cell(54, 28), "torch_goblin", "fire_burst"],
        ["w1-c", "Lancier de la porte", cell(50, 31), "spear_goblin", "spear_fan"],
      ],
    },
    {
      threshold: 3,
      enemies: [
        ["w2-a", "Chevaucheur du boulevard", cell(55, 23), "pig_rider", "mounted_trample"],
        ["w2-b", "Chevaucheur des demeures", cell(56, 32), "pig_rider", "mounted_trample"],
      ],
    },
    {
      threshold: 5,
      enemies: [
        ["w3-a", "Chamane du bastion", cell(50, 20), "hex_shaman", "hex_burst"],
        ["w3-b", "Maraudeur du bastion", cell(57, 20), "gnoll_marauder", "marauder_frenzy"],
        ["w3-c", "Chamane de la cour", cell(58, 29), "hex_shaman", "hex_burst"],
      ],
    },
    {
      threshold: 8,
      enemies: [
        ["w4-a", "Troll des demeures", cell(54, 25), "mire_troll", "troll_sweep"],
        ["w4-b", "Maraudeur du troll", cell(52, 33), "gnoll_marauder", "marauder_frenzy"],
      ],
    },
  ] as const;
  for (const wave of upperWaves) {
    for (const [key, name, position, species, specialTechnique] of wave.enemies) {
      waveMonster(
        factory,
        `upper-${key}`,
        name,
        position,
        species,
        S.upperBattle,
        V.upperKills,
        wave.threshold,
        species === "mire_troll"
          ? {
              rank: "elite",
              maxHp: 285,
              damage: 19,
              xp: 210,
              weakness: "warrior",
              weaknessPercent: 150,
              specialTechnique,
            }
          : { specialTechnique },
      );
    }
  }
  gatedPortal(
    factory,
    "to-court",
    "Passage vers la cour centrale",
    cell(60, 6),
    V.upperKills,
    10,
    teleport("court", 29, 38),
  );

  const elements: MapElement[] = [
    ...rowOf(
      [BUILDINGS.purpleHouse1, BUILDINGS.blueHouse2, BUILDINGS.purpleHouse3],
      [8, 15, 23, 40, 48, 56],
      16,
    ),
    ...rowOf(
      [BUILDINGS.blueHouse1, BUILDINGS.purpleHouse2, BUILDINGS.yellowHouse3],
      [9, 17, 25, 40, 48, 57],
      29,
    ),
    ...rowOf(
      [BUILDINGS.purpleHouse3, BUILDINGS.blueHouse3, BUILDINGS.purpleHouse1],
      [10, 18, 27, 39, 47, 56],
      42,
    ),
    ...rowOf(
      [BUILDINGS.purpleHouse1, BUILDINGS.blueHouse2, BUILDINGS.yellowHouse3],
      [5, 10, 15, 20, 25, 34, 39, 44, 49, 54, 59],
      14,
    ),
    ...rowOf(
      [BUILDINGS.blueHouse3, BUILDINGS.purpleHouse2, BUILDINGS.ruinedHouse],
      [6, 11, 16, 21, 26, 35, 40, 45, 50, 55, 60],
      24,
    ),
    ...rowOf(
      [BUILDINGS.purpleHouse2, BUILDINGS.blueHouse1, BUILDINGS.constructionHouse],
      [5, 10, 15, 20, 25, 34, 39, 44, 49, 54, 59],
      34,
    ),
    ...rowOf(
      [BUILDINGS.blueHouse2, BUILDINGS.purpleHouse3, BUILDINGS.ruinedHouse],
      [6, 11, 16, 21, 26, 35, 40, 45, 50, 55, 60],
      45,
    ),
    element(BUILDINGS.purpleMonastery, 8, 8),
    element(BUILDINGS.blueCastle, 28, 9),
    element(BUILDINGS.purpleBarracks, 45, 9),
    element(BUILDINGS.blueTower, 58, 11),
    element(BUILDINGS.purpleTower, 4, 23),
    element(BUILDINGS.blueArchery, 32, 22),
    element(BUILDINGS.blueBarracks, 59, 19),
    element(BUILDINGS.ruinedHouse, 22, 34),
    element(BUILDINGS.ruinedTower, 37, 34),
    element(BUILDINGS.constructionHouse, 6, 34),
    ...rowOf([SCENERY.tree1, SCENERY.tree2, SCENERY.tree4], [6, 13, 20, 35, 43, 51, 59], 20),
    ...rowOf([SCENERY.bush1, SCENERY.bush2, SCENERY.bush4], [7, 14, 24, 36, 45, 53, 60], 35),
    element(SCENERY.memorial, 20, 9),
    element(SCENERY.boneSmall, 22, 11),
    element(SCENERY.goldStone6, 10, 8),
    element(SCENERY.goldStone5, 34, 9),
    element(SCENERY.goldStone4, 47, 19),
    ...rowOf([SCENERY.tool1, SCENERY.tool2, SCENERY.wood], [12, 19, 27, 41, 49, 55], 44),
  ];

  return bundleMap(
    "upper",
    "La Ville haute",
    terrainLayers("upper", {
      blocked: [
        { col: 2, row: 18, width: 25, height: 2 },
        { col: 34, row: 18, width: 28, height: 2 },
        { col: 28, row: 30, width: 3, height: 16 },
        { col: 44, row: 2, width: 2, height: 13 },
        { col: 31, row: 33, width: 13, height: 2 },
        { col: 31, row: 33, width: 2, height: 13 },
        { col: 42, row: 33, width: 2, height: 13 },
      ],
      carve: [
        { col: 12, row: 18, width: 4, height: 2 },
        { col: 21, row: 18, width: 4, height: 2 },
        { col: 41, row: 18, width: 4, height: 2 },
        { col: 54, row: 18, width: 4, height: 2 },
        { col: 28, row: 36, width: 3, height: 4 },
        { col: 44, row: 8, width: 2, height: 4 },
      ],
    }),
    spawn,
    factory.events,
    elements,
    { music: "town-theme", ambience: null, combatMusic: "battle-theme" },
  );
}

function courtMap(refs: StoryRefs): AdventureBundleMap {
  const factory = createEventFactory("court", refs);
  const spawn = cell(29, 38);
  portal(
    factory,
    "to-upper",
    "Rue de la ville haute",
    cell(5, 38),
    [teleport("upper", 58, 7)],
    GRAPHICS.sign,
  );
  factory.normal("captain", "Capitaine de la cour", cell(25, 37), GRAPHICS.captain, [
    page(
      [
        say(
          "Capitaine",
          "Tenez la cour. Ils arrivent par les rues, les casernes et les brèches de la muraille.",
        ),
      ],
      { trigger: "action" },
    ),
  ]);
  battleTrigger(factory, "siege-trigger", "Centre de la cour", cell(29, 33), S.courtSiege);

  const siegeWaves = [
    {
      threshold: 0,
      enemies: [
        ["w1-a", "Lancier de la rue ouest", cell(12, 28), "spear_goblin", "spear_fan"],
        ["w1-b", "Porte-torche de la rue est", cell(46, 28), "torch_goblin", "fire_burst"],
        ["w1-c", "Lancier de la porte sud", cell(29, 29), "spear_goblin", "spear_fan"],
      ],
    },
    {
      threshold: 3,
      enemies: [
        ["w2-a", "Sanglier de l’ouest", cell(10, 22), "war_pig", "tusk_charge"],
        ["w2-b", "Chevaucheur de l’est", cell(48, 22), "pig_rider", "mounted_trample"],
        ["w2-c", "Sanglier de la grande rue", cell(29, 24), "war_pig", "tusk_charge"],
      ],
    },
    {
      threshold: 6,
      enemies: [
        ["w3-a", "Chamane de la caserne ouest", cell(14, 17), "hex_shaman", "hex_burst"],
        ["w3-b", "Chamane de la caserne est", cell(44, 17), "hex_shaman", "hex_burst"],
        ["w3-c", "Lancier du chamane ouest", cell(19, 20), "spear_goblin", "spear_fan"],
        ["w3-d", "Porte-torche du chamane est", cell(39, 20), "torch_goblin", "fire_burst"],
      ],
    },
    {
      threshold: 10,
      enemies: [
        ["w4-a", "Brute de la cour", cell(20, 15), "gnoll_marauder", "marauder_frenzy"],
        ["w4-b", "Brute de la porte", cell(29, 16), "gnoll_marauder", "marauder_frenzy"],
        ["w4-c", "Brute de la cour est", cell(38, 15), "gnoll_marauder", "marauder_frenzy"],
      ],
    },
    {
      threshold: 13,
      enemies: [
        ["w5-a", "Lieutenant de l’assaut", cell(29, 12), "pig_rider", "mounted_trample"],
        ["w5-b", "Chamane du lieutenant", cell(23, 13), "hex_shaman", "hex_burst"],
        ["w5-c", "Maraudeur du lieutenant", cell(35, 13), "gnoll_marauder", "marauder_frenzy"],
        ["w5-d", "Lancier du dernier rang", cell(18, 14), "spear_goblin", "spear_fan"],
        ["w5-e", "Porte-torche du dernier rang", cell(40, 14), "torch_goblin", "fire_burst"],
      ],
    },
  ] as const;
  for (const wave of siegeWaves) {
    for (const [key, name, position, species, specialTechnique] of wave.enemies) {
      waveMonster(
        factory,
        `siege-${key}`,
        name,
        position,
        species,
        S.courtSiege,
        V.courtKills,
        wave.threshold,
        key === "w5-a"
          ? {
              rank: "elite",
              maxHp: 185,
              damage: 18,
              xp: 155,
              weakness: "ranger",
              weaknessPercent: 155,
              specialTechnique,
            }
          : key.startsWith("w4")
            ? {
                rank: "elite",
                maxHp: 145,
                damage: 16,
                xp: 115,
                specialTechnique,
              }
            : { specialTechnique },
      );
    }
  }

  factory.normal("final-gate", "Grande porte brisée", cell(29, 9), GRAPHICS.memorial, [
    page([say(null, "Les renforts ennemis occupent encore la cour.")], { trigger: "action" }),
    page(
      [
        say(null, "Le vacarme cesse. La grande porte cède sous un dernier choc."),
        switchOn(S.finalGateOpen),
        wait(180),
        addVar(V.finalPhase),
        wait(220),
        addVar(V.finalPhase),
        selfSwitchOn("A"),
      ],
      {
        condVariableId: V.courtKills,
        condVariableMin: 18,
        trigger: "action",
      },
    ),
    page([], { condSelfSwitch: "A" }),
  ]);
  factory.monster("final-boss", "Le Briseur de portes", cell(29, 5), "gate_troll", {
    conditionSwitchId: S.finalGateOpen,
    patrolRadius: 210,
    tuning: {
      rank: "boss",
      maxHp: 980,
      damage: 24,
      speed: 66,
      xp: 780,
      weakness: "warrior",
      weaknessPercent: 145,
      specialTechnique: "troll_quake",
    },
    commands: [addVar(V.finalBoss), switchOn(S.finalBossDefeated)],
  });
  for (const [key, name, position, species, technique] of [
    [
      "boss-reinforcement-a",
      "Lancier de la dernière porte",
      cell(20, 7),
      "spear_goblin",
      "spear_fan",
    ],
    ["boss-reinforcement-b", "Porte-torche du Briseur", cell(38, 7), "torch_goblin", "fire_burst"],
    ["boss-reinforcement-c", "Chamane du Briseur", cell(34, 10), "hex_shaman", "hex_burst"],
  ] as const) {
    factory.monster(key, name, position, species, {
      conditionSwitchId: S.finalGateOpen,
      conditionVariable: { id: V.finalPhase, min: 1 },
      tuning: { specialTechnique: technique },
    });
  }
  factory.normal("ending", "Capitaine de la cour", cell(29, 3), GRAPHICS.captain, [
    page([], { condVariableId: V.finalBoss, condVariableMin: 2 }),
    page(
      [
        say(
          "Capitaine",
          "La cour tient. Les rues sont encore en feu, mais l’armée ennemie n’a plus de chef.",
        ),
        switchOn(S.finished),
        endAdventure(),
      ],
      {
        condVariableId: V.finalBoss,
        condVariableMin: 1,
        trigger: "action",
      },
    ),
  ]);

  const elements: MapElement[] = [
    element(BUILDINGS.blueCastle, 29, 8),
    element(BUILDINGS.blueTower, 13, 9),
    element(BUILDINGS.blueTower, 45, 9),
    element(BUILDINGS.blueBarracks, 8, 18),
    element(BUILDINGS.blueBarracks, 50, 18),
    element(BUILDINGS.blueArchery, 9, 31),
    element(BUILDINGS.blueMonastery, 49, 31),
    element(BUILDINGS.ruinedTower, 3, 25),
    element(BUILDINGS.ruinedTower, 55, 25),
    element(BUILDINGS.ruinedCastle, 17, 38),
    element(BUILDINGS.constructionTower, 41, 38),
    ...rowOf([BUILDINGS.blueHouse1, BUILDINGS.blueHouse2], [7, 16, 42, 51], 39),
    ...rowOf(
      [BUILDINGS.blueHouse1, BUILDINGS.blueHouse3, BUILDINGS.ruinedHouse],
      [6, 11, 16, 42, 47, 52],
      22,
    ),
    ...rowOf(
      [BUILDINGS.blueHouse2, BUILDINGS.constructionHouse, BUILDINGS.blueHouse3],
      [7, 13, 19, 39, 45, 51],
      33,
    ),
    element(BUILDINGS.blueTower, 4, 34),
    element(BUILDINGS.blueTower, 54, 34),
    element(BUILDINGS.ruinedHouse, 5, 14),
    element(BUILDINGS.ruinedHouse, 53, 14),
    ...rowOf([SCENERY.tree1, SCENERY.tree2, SCENERY.tree3, SCENERY.tree4], [7, 16, 42, 51], 13),
    ...rowOf([SCENERY.bush1, SCENERY.bush2, SCENERY.bush3], [8, 18, 24, 34, 40, 50], 27),
    element(SCENERY.memorial, 29, 19),
    element(SCENERY.notice, 26, 32),
    element(SCENERY.boneLarge, 19, 16),
    element(SCENERY.boneSmall, 39, 16),
    element(SCENERY.wood, 12, 23),
    element(SCENERY.tool1, 15, 24),
    element(SCENERY.tool3, 43, 24),
    element(SCENERY.meat, 46, 23),
    element(BUILDINGS.ruinedGoblinTower, 4, 12),
    element(BUILDINGS.goblinHouse, 54, 13),
  ];

  return bundleMap(
    "court",
    "La Cour centrale",
    terrainLayers("court", {
      blocked: [
        { col: 2, row: 2, width: 17, height: 2 },
        { col: 39, row: 2, width: 17, height: 2 },
        { col: 2, row: 33, width: 13, height: 2 },
        { col: 43, row: 33, width: 13, height: 2 },
      ],
      carve: [
        { col: 8, row: 2, width: 4, height: 2 },
        { col: 46, row: 2, width: 4, height: 2 },
        { col: 6, row: 33, width: 4, height: 2 },
        { col: 48, row: 33, width: 4, height: 2 },
      ],
    }),
    spawn,
    factory.events,
    elements,
    { music: "bards-tale", ambience: null, combatMusic: "battle-theme" },
  );
}

export function buildMaps(refs: StoryRefs): AdventureBundleMap[] {
  return [routeMap(refs), lowerMap(refs), foundationsMap(refs), upperMap(refs), courtMap(refs)];
}

export type { MapKey };
