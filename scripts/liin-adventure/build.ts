import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { parseAdventureGraph } from "@lindocara/engine/adventure.js";
import {
  ADVENTURE_BUNDLE_FORMAT,
  ADVENTURE_BUNDLE_VERSION,
  type AdventureBundle,
  type AdventureBundleMap,
  parseAdventureBundle,
} from "@lindocara/engine/adventure-bundle.js";
import { parseAdventureRegistry } from "@lindocara/engine/adventure-state.js";
import type { EventCommand } from "@lindocara/engine/event-commands.js";
import type { MonsterSpecies, MonsterTuning } from "@lindocara/engine/game.js";
import { type MapElement, parseMapData } from "@lindocara/engine/map-data.js";
import {
  defaultEventPage,
  functionalEvent,
  type MapEvent,
  type MapEventPage,
  parseMapEvents,
} from "@lindocara/engine/map-events.js";
import {
  type AuthoredQuestDefinition,
  type AuthoredQuestObjective,
  createAuthoredQuestDefinition,
  emptyQuestDialogues,
  emptyQuestRewards,
  type QuestDialogues,
  type QuestEventReference,
} from "@lindocara/engine/quests.js";
import { decodeTileLayer, encodeTileLayer } from "@lindocara/engine/tile-layer-codec.js";

const OUTPUT = new URL("../../adventures/liin-adventure-ia.json", import.meta.url);
const SCALE = 3;
const COLS = 60;
const ROWS = 45;

const MAP_IDS = {
  aubeval: "d5549add-f7ce-4232-8c00-24e699adacb6",
  woods: "ede32d6f-a416-4ec5-96cc-d4c045e5ae47",
  marsh: stableUuid("map:marais-de-verre"),
  citadel: stableUuid("map:citadelle-des-cendres"),
  sanctuary: "5490f471-424b-477d-8f03-a6b04c61aeb0",
} as const;

const BASE_LAYERS = {
  city: [
    "7,15*18,13,8,16*18,14,8,16*18,14,8,16*18,14,8,16*18,14,8,16*18,14,8,16*18,14,8,16*18,14,8,16*18,14,8,16*11,12*4,16*3,14,8,16*10,14,0*4,8,16*2,14,8,16*10,14,0*4,8,16*2,14,8,16*10,14,0*4,8,16*2,14,8,16*11,15*4,16*3,14,4,12*18,10",
    "0*300",
    "0*300",
  ],
  woods: [
    "7,15*18,13,8,16*18,14,8,16*18,14,8,16*18,14,8,16*18,14,8,16*18,14,8,16*7,12*3,16*8,14,8,16*6,14,0*3,8,16*7,14,8,16*6,14,0*3,8,16*7,14,8,16*6,14,0*3,8,16*2,12*4,16,14,8,16*7,15*3,16*2,14,0*4,8,14,8,16*12,14,0*4,8,14,8,16*12,14,0*4,8,14,8,16*13,15*4,16,14,4,12*18,10",
    "0*300",
    "0*300",
  ],
  sanctuary: [
    "7,15*11,11*7,13,8,16*10,14,23,31*5,29,6,8,16*10,14,24,32*5,30,6,8,16*10,14,24,32*5,30,6,8,16*10,14,24,32*5,30,6,8,16*10,14,24,32*5,30,6,8,16*10,14,24,32*5,30,6,8,16*5,12*4,16,14,20,28*5,26,6,8,16*4,14,0*4,8,16,15*7,14,8,16*4,14,0*4,8,16*8,14,8,16*4,14,0*4,8,16*8,14,8,16*5,15*4,16*9,14,8,16*18,14,8,16*18,14,4,12*18,10",
    "0*12,1035*7,0*12,1034,0*7,1036,0*11,1034,0*7,1036,0*11,1034,0*7,1036,0*11,1034,0*7,1036,0*11,1034,0*7,1036,0*11,1025,0*7,1036,0*11,1027,0*7,1036,0*12,51,52*5,50,0*121",
    "0*300",
  ],
} as const;

const GRAPHICS = {
  captain: "character.units-blue-units-warrior.warrior-idle",
  monk: "character.units-yellow-units-monk.idle",
  merchant: "character.units-blue-units-pawn.pawn-idle-gold",
  scout: "character.units-red-units-pawn.pawn-idle",
  rune: "decoration.deco.17",
} as const;

interface StoryRefs {
  [key: string]: MapEvent;
}

function stableUuid(key: string): string {
  const hex = createHash("sha256").update(`liin-adventure-ia:${key}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function at(col: number, row: number, offsetX = 1, offsetY = 1) {
  return { col: col * SCALE + offsetX, row: row * SCALE + offsetY };
}

function scaleLayer(encoded: string, mirrorX = false): string {
  const source = decodeTileLayer(encoded, 20, 15);
  const ids: number[] = [];
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const sourceCol = Math.floor(col / SCALE);
      const sourceRow = Math.floor(row / SCALE);
      const resolvedCol = mirrorX ? 19 - sourceCol : sourceCol;
      ids.push(source.ids[sourceRow * 20 + resolvedCol] ?? 0);
    }
  }
  return encodeTileLayer({ cols: COLS, rows: ROWS, ids });
}

function scaledLayers(layers: readonly string[], mirrorX = false): [string, string, string] {
  return [
    scaleLayer(layers[0] ?? "0*300", mirrorX),
    scaleLayer(layers[1] ?? "0*300", mirrorX),
    scaleLayer(layers[2] ?? "0*300", mirrorX),
  ];
}

function decorations(theme: "city" | "woods" | "marsh" | "citadel" | "sanctuary"): MapElement[] {
  const trees = [
    "resource.terrain-resources-wood-trees.tree1",
    "resource.terrain-resources-wood-trees.tree2",
    "resource.terrain-resources-wood-trees.tree3",
    "resource.terrain-resources-wood-trees.tree4",
  ] as const;
  const rocks = [
    "decoration.terrain-decorations-rocks.rock1",
    "decoration.terrain-decorations-rocks.rock3",
    "decoration.terrain-decorations-rocks.rock4",
  ] as const;
  const positions = [
    at(2, 3),
    at(5, 4),
    at(8, 2),
    at(11, 5),
    at(14, 3),
    at(17, 7),
    at(3, 8),
    at(7, 10),
    at(11, 11),
    at(15, 9),
    at(18, 12),
    at(9, 13),
  ];
  const assets: readonly MapElement["assetId"][] =
    theme === "city"
      ? [
          "building.buildings-blue-buildings.castle",
          "building.buildings-blue-buildings.house1",
          "building.buildings-blue-buildings.house2",
          ...trees,
          ...rocks,
          "decoration.terrain-decorations-bushes.bushe1",
        ]
      : theme === "citadel" || theme === "sanctuary"
        ? [
            "building.buildings-black-buildings.tower",
            "building.buildings-purple-buildings.monastery",
            ...rocks,
            ...trees,
          ]
        : [
            ...trees,
            ...rocks,
            "building.factions-goblins-buildings-wood-house.goblin-house-destroyed",
            "decoration.terrain-decorations-bushes.bushe1",
          ];
  return positions.map((position, index) => ({
    ...position,
    offsetX: 0,
    offsetY: 0,
    assetId: assets[index % assets.length] ?? trees[0],
  }));
}

function page(
  commands: readonly EventCommand[],
  options: Partial<MapEventPage> = {},
): MapEventPage {
  return {
    ...defaultEventPage(),
    ...options,
    commands,
  };
}

function say(name: string, text: string): EventCommand {
  return { t: "say", name, text };
}

function createEventFactory(mapKey: string, refs: StoryRefs) {
  let ordinal = 1;
  const events: MapEvent[] = [];
  const add = (key: string, event: MapEvent): MapEvent => {
    events.push(event);
    refs[`${mapKey}.${key}`] = event;
    return event;
  };
  const normal = (
    key: string,
    name: string,
    position: { col: number; row: number },
    graphicAssetId: MapEventPage["graphicAssetId"],
    pages: readonly MapEventPage[],
  ) =>
    add(key, {
      id: stableUuid(`${mapKey}:${key}`),
      ...position,
      name,
      ordinal: ordinal++,
      kind: "normal",
      species: null,
      patrolRadius: null,
      pages: pages.map((page) =>
        page.graphicAssetId === null && graphicAssetId !== null
          ? { ...page, graphicAssetId }
          : page,
      ),
    });
  const anchor = (
    key: string,
    name: string,
    position: { col: number; row: number },
    kind: "spawn" | "entry" | "exit",
  ) =>
    add(
      key,
      functionalEvent({
        id: stableUuid(`${mapKey}:${key}`),
        ...position,
        name,
        ordinal: ordinal++,
        kind,
      }),
    );
  const monster = (
    key: string,
    name: string,
    position: { col: number; row: number },
    species: MonsterSpecies,
    tuning: Partial<MonsterTuning> = {},
    commands: readonly EventCommand[] = [],
  ) => {
    const event = functionalEvent({
      id: stableUuid(`${mapKey}:${key}`),
      ...position,
      name,
      ordinal: ordinal++,
      kind: "monster",
      species,
      patrolRadius: tuning.rank === "boss" ? 96 : 72,
      monsterTuning: tuning,
    });
    const base = event.pages[0] ?? defaultEventPage();
    return add(key, {
      ...event,
      pages: [{ ...base, commands }],
    });
  };
  return { events, normal, anchor, monster };
}

function buildAubeval(refs: StoryRefs): AdventureBundleMap {
  const e = createEventFactory("aubeval", refs);
  e.anchor("spawn", "Cour des Voyageurs", at(2, 12), "spawn");
  e.anchor("entry", "Porte des Sources", at(2, 11), "entry");
  e.normal("lyra", "Capitaine Lyra Vensol", at(4, 12), GRAPHICS.captain, [
    page([], { graphicAssetId: GRAPHICS.captain }),
  ]);
  e.normal("orin", "Orin Briseclef", at(7, 12), GRAPHICS.merchant, [
    page(
      [
        say(
          "Orin",
          "Je pourrais vous vendre une belle certitude, mais elles sont en rupture depuis que les morts portent nos couleurs. Prenez plutôt des fioles. Elles mentent moins.",
        ),
        { t: "openShop" },
      ],
      { graphicAssetId: GRAPHICS.merchant },
    ),
  ]);
  e.normal("neria", "Neria, greffière des absents", at(10, 12), GRAPHICS.monk, [
    page([], { graphicAssetId: GRAPHICS.monk }),
  ]);
  for (const [index, text] of [
    "Joran Tal, maçon. Il est sorti réparer la digue avant l’aube et n’est jamais revenu.",
    "Syla Venn, messagère. Son dernier pli accusait le Conseil de déplacer des prisonniers vers l’est.",
    "Frère Céran, soigneur. Il refusait de trier les blessés selon leur bannière.",
  ].entries()) {
    e.normal(
      `memorial-${index + 1}`,
      `Stèle des absents ${index + 1}`,
      at(index === 2 ? 16 : 6 + index * 3, 10),
      GRAPHICS.rune,
      [
        page(
          [
            say("Stèle", text),
            {
              t: "advanceQuest",
              questId: "0006",
              objectiveId: `000${index + 1}`,
              amount: 1,
            },
          ],
          { graphicAssetId: GRAPHICS.rune },
        ),
      ],
    );
  }
  e.normal("soldier", "Marek, vétéran du gué", at(3, 9), GRAPHICS.scout, [
    page(
      [
        say(
          "Marek",
          "Varkesh commandait avec Lyra autrefois. S’il garde aujourd’hui la porte avec des ossements, quelqu’un lui a offert une raison plus forte que la loyauté.",
        ),
      ],
      { graphicAssetId: GRAPHICS.scout },
    ),
  ]);
  e.monster("raider-1", "Éclaireur du Conclave", at(14, 8), "spear_goblin");
  e.monster("raider-2", "Boutefeu du faubourg", at(17, 9), "torch_goblin");
  e.monster("raider-3", "Maraudeur de la digue", at(13, 7), "gnoll_marauder", {
    rank: "elite",
    maxHp: 180,
    damage: 18,
    xp: 120,
    weakness: "ranger",
    weaknessPercent: 160,
  });
  e.monster("warden-1", "Prévôt d’os", at(15, 6), "skull_crusader", {
    rank: "elite",
    maxHp: 260,
    damage: 20,
    xp: 180,
    weakness: "priest",
    weaknessPercent: 175,
  });
  e.monster(
    "boss",
    "Varkesh, Premier Renégat",
    at(16, 4),
    "skull_warden",
    {
      rank: "boss",
      maxHp: 900,
      damage: 24,
      speed: 86,
      xp: 700,
      weakness: "priest",
      weaknessPercent: 170,
      specialTechnique: "ground_slam",
    },
    [{ t: "setSwitch", switchId: "0001", value: true }],
  );
  e.anchor("exit-forward", "Route des Bois des Murmures", at(18, 1), "exit");
  return {
    id: MAP_IDS.aubeval,
    name: "Aubeval — Bastion des Sources",
    tilesetId: "tiny-swords",
    cols: COLS,
    rows: ROWS,
    layers: scaledLayers(BASE_LAYERS.city),
    elements: decorations("city"),
    spawn: at(2, 12),
    events: e.events,
  };
}

function buildWoods(refs: StoryRefs): AdventureBundleMap {
  const e = createEventFactory("woods", refs);
  e.anchor("entry-back", "Lisière d’Aubeval", at(2, 11), "entry");
  e.anchor("exit-back", "Retour vers Aubeval", at(1, 11), "exit");
  e.normal("elyne", "Elyne, voix des racines", at(4, 12), GRAPHICS.monk, [
    page([], { graphicAssetId: GRAPHICS.monk }),
  ]);
  e.normal("herbalist", "Pell, apprenti herboriste", at(6, 12), GRAPHICS.scout, [
    page([], { graphicAssetId: GRAPHICS.scout }),
  ]);
  for (const [index, position] of [at(6, 8), at(13, 6), at(16, 12, 1, 3)].entries()) {
    e.normal(`herb-${index + 1}`, `Herbe-lumen ${index + 1}`, position, "decoration.deco.17", [
      page(
        [
          say(
            "Herbe-lumen",
            "La plante se replie avec une chaleur presque animale. Une seule feuille suffit ; arracher la racine la condamnerait.",
          ),
          { t: "changeItems", itemId: "mana_potion", count: 1 },
          { t: "setSelfSwitch", selfSwitch: "A", value: true },
        ],
        { graphicAssetId: GRAPHICS.rune },
      ),
      page([say("Herbe-lumen", "La tige coupée cicatrise déjà.")], {
        condSelfSwitch: "A",
        graphicAssetId: GRAPHICS.rune,
      }),
    ]);
  }
  const runeOne = e.normal("rune-one", "Pierre de la Mémoire", at(8, 4), GRAPHICS.rune, [
    page(
      [
        say(
          "Pierre de la Mémoire",
          "« Je précède le serment, je survis au roi, et les vainqueurs me réécrivent. Qui suis-je ? »",
        ),
        {
          t: "choices",
          prompt: "Graver votre réponse.",
          options: [
            {
              label: "La mémoire",
              body: [
                say("Pierre", "La première veine s’illumine."),
                { t: "setVariable", variableId: "0001", op: "set", value: 1 },
              ],
            },
            {
              label: "La couronne",
              body: [
                say("Pierre", "La couronne passe. La pierre demeure."),
                { t: "setVariable", variableId: "0001", op: "set", value: 0 },
              ],
            },
          ],
        },
      ],
      { graphicAssetId: GRAPHICS.rune },
    ),
  ]);
  void runeOne;
  e.normal("rune-two", "Pierre de la Dette", at(10, 3), GRAPHICS.rune, [
    page(
      [
        say(
          "Pierre de la Dette",
          "La pierre reste froide. Une autre voix doit être entendue d’abord.",
        ),
      ],
      { graphicAssetId: GRAPHICS.rune },
    ),
    page(
      [
        say(
          "Pierre de la Dette",
          "« Plus on me paie, plus je grandis. Les enfants héritent de moi sans m’avoir contractée. »",
        ),
        {
          t: "choices",
          prompt: "Nommer ce qui ronge les royaumes.",
          options: [
            {
              label: "La dette",
              body: [
                say("Pierre", "La seconde veine rejoint la première."),
                { t: "setVariable", variableId: "0001", op: "set", value: 2 },
              ],
            },
            {
              label: "La gloire",
              body: [
                say("Pierre", "La gloire est seulement la dette racontée par les vainqueurs."),
                { t: "setVariable", variableId: "0001", op: "set", value: 0 },
              ],
            },
          ],
        },
      ],
      { condVariableId: "0001", condVariableMin: 1, graphicAssetId: GRAPHICS.rune },
    ),
  ]);
  e.normal("rune-three", "Pierre du Témoin", at(12, 4), GRAPHICS.rune, [
    page(
      [
        say(
          "Pierre du Témoin",
          "Deux réponses doivent former une histoire avant que celle-ci parle.",
        ),
      ],
      { graphicAssetId: GRAPHICS.rune },
    ),
    page(
      [
        say(
          "Pierre du Témoin",
          "« Je n’ordonne rien, pourtant les tyrans me craignent. Je ne frappe pas, pourtant je peux les faire tomber. »",
        ),
        {
          t: "choices",
          prompt: "Achever le pacte.",
          options: [
            {
              label: "Le témoin",
              body: [
                say(
                  "Pierre",
                  "Les trois pierres répondent ensemble : « Souviens-toi de la dette, et témoigne. »",
                ),
                { t: "setSwitch", switchId: "0002", value: true },
                { t: "completeActivity", activityId: "pacte_des_racines" },
              ],
            },
            {
              label: "Le bourreau",
              body: [
                say("Pierre", "Le bourreau ferme les yeux. Recommencez depuis la mémoire."),
                { t: "setVariable", variableId: "0001", op: "set", value: 0 },
              ],
            },
          ],
        },
      ],
      { condVariableId: "0001", condVariableMin: 2, graphicAssetId: GRAPHICS.rune },
    ),
  ]);
  e.monster("shaman-1", "Chaman du bois creux", at(16, 7), "hex_shaman");
  e.monster("rider-1", "Courrier monté du Conclave", at(12, 11), "pig_rider");
  e.monster("guard-1", "Gardien de sève", at(5, 4, 1, 2), "skull_guard", {
    rank: "elite",
    maxHp: 240,
    damage: 22,
    xp: 180,
    weakness: "warrior",
    weaknessPercent: 160,
  });
  e.monster(
    "boss",
    "Morvane, le Cerf sans Ramure",
    at(15, 3),
    "minotaur_brute",
    {
      rank: "boss",
      maxHp: 1_300,
      damage: 30,
      speed: 72,
      xp: 1_000,
      weakness: "ranger",
      weaknessPercent: 165,
      specialTechnique: "shadow_cone",
    },
    [{ t: "setSwitch", switchId: "0003", value: true }],
  );
  e.anchor("exit-forward", "Sentier du Marais de Verre", at(18, 1), "exit");
  return {
    id: MAP_IDS.woods,
    name: "Bois des Murmures — Le Pacte ancien",
    tilesetId: "tiny-swords",
    cols: COLS,
    rows: ROWS,
    layers: scaledLayers(BASE_LAYERS.woods),
    elements: decorations("woods"),
    spawn: at(2, 12),
    events: e.events,
  };
}

function buildMarsh(refs: StoryRefs): AdventureBundleMap {
  const e = createEventFactory("marsh", refs);
  e.anchor("entry-back", "Chaussée des Murmures", at(17, 11), "entry");
  e.anchor("exit-back", "Retour vers les Bois", at(18, 11), "exit");
  e.normal("talen", "Talen Rivegrise, archiviste", at(15, 12), GRAPHICS.monk, [
    page([], { graphicAssetId: GRAPHICS.monk }),
  ]);
  e.normal("wynn", "Éclaireuse Wynn", at(13, 12), GRAPHICS.scout, [
    page([], { graphicAssetId: GRAPHICS.scout }),
  ]);
  for (const [index, position] of [at(14, 8), at(9, 5), at(5, 8)].entries()) {
    const required = index;
    e.normal(`bell-${index + 1}`, `Cloche noyée ${index + 1}`, position, GRAPHICS.rune, [
      page(
        [
          say(
            "Cloche noyée",
            required === 0
              ? "Sur le bronze : « Sonne pour ceux dont le nom fut effacé. »"
              : "Le battant résiste. Le marais attend une note antérieure.",
          ),
          ...(required === 0
            ? ([
                { t: "setVariable", variableId: "0002", op: "set", value: 1 },
              ] satisfies EventCommand[])
            : []),
        ],
        { graphicAssetId: GRAPHICS.rune },
      ),
      ...(required > 0
        ? [
            page(
              [
                say(
                  "Cloche noyée",
                  index === 1
                    ? "La deuxième cloche répond : « Sonne pour ceux qui ont obéi par peur. »"
                    : "La dernière cloche gronde : « Sonne pour ceux qui ont dit non. »",
                ),
                {
                  t: "setVariable",
                  variableId: "0002",
                  op: "set",
                  value: index + 1,
                },
                ...(index === 2
                  ? ([
                      { t: "setSwitch", switchId: "0004", value: true },
                      { t: "completeActivity", activityId: "cloches_noyees" },
                    ] satisfies EventCommand[])
                  : []),
              ],
              {
                condVariableId: "0002",
                condVariableMin: required,
                graphicAssetId: GRAPHICS.rune,
              },
            ),
          ]
        : []),
    ]);
  }
  for (let index = 0; index < 4; index += 1) {
    e.monster(
      `shaman-${index + 1}`,
      `Lecteur de vase ${index + 1}`,
      at(14 - index * 3, 6 + (index % 2) * 3, 1, index === 1 ? 3 : index === 3 ? 2 : 1),
      "hex_shaman",
      {
        rank: index === 3 ? "elite" : "normal",
        maxHp: index === 3 ? 320 : 120,
        damage: index === 3 ? 28 : 19,
        xp: index === 3 ? 240 : 90,
        weakness: "warrior",
        weaknessPercent: 155,
      },
    );
  }
  e.monster("brute-1", "Troll des digues mortes", at(7, 4), "mire_troll", {
    rank: "elite",
    maxHp: 520,
    damage: 32,
    xp: 360,
    specialTechnique: "ground_slam",
  });
  e.monster(
    "boss",
    "Nhal’gor, l’Abbé des Eaux Mortes",
    at(4, 3),
    "mire_troll",
    {
      rank: "boss",
      maxHp: 1_800,
      damage: 36,
      speed: 68,
      xp: 1_450,
      weakness: "priest",
      weaknessPercent: 170,
      specialTechnique: "soul_drain",
    },
    [{ t: "setSwitch", switchId: "0005", value: true }],
  );
  e.normal("archive", "Registre des noyés", at(8, 11), GRAPHICS.rune, [
    page(
      [
        say(
          "Registre",
          "Les pages ne recensent pas des morts, mais des livraisons : grain, armes, familles entières. Toutes portent le sceau du chancelier Varos.",
        ),
      ],
      { graphicAssetId: GRAPHICS.rune },
    ),
  ]);
  e.anchor("exit-forward", "Route de la Citadelle", at(1, 1), "exit");
  return {
    id: MAP_IDS.marsh,
    name: "Marais de Verre — Les Cloches noyées",
    tilesetId: "tiny-swords",
    cols: COLS,
    rows: ROWS,
    layers: scaledLayers(BASE_LAYERS.woods, true),
    elements: decorations("marsh"),
    spawn: at(17, 12),
    events: e.events,
  };
}

function buildCitadel(refs: StoryRefs): AdventureBundleMap {
  const e = createEventFactory("citadel", refs);
  e.anchor("entry-back", "Porte du Marais", at(2, 11), "entry");
  e.anchor("exit-back", "Retour vers le Marais", at(1, 11), "exit");
  e.normal("serah", "Serah Varkesh, porte-étendard", at(4, 12), GRAPHICS.captain, [
    page([], { graphicAssetId: GRAPHICS.captain }),
  ]);
  for (const [index, position] of [at(6, 10), at(10, 8), at(14, 6)].entries()) {
    e.normal(`cage-${index + 1}`, `Cage de conscrits ${index + 1}`, position, GRAPHICS.rune, [
      page(
        [
          say(
            "Conscrit",
            [
              "On nous a juré que les gens du marais avaient brûlé nos fermes. Puis j’ai reconnu les torches de notre propre régiment.",
              "Kaelgor ne protège pas la citadelle. Il garde les archives pendant que Varos efface les noms.",
              "Serah est revenue pour son père. Dites-lui que Varkesh n’a pas trahi le premier : il a découvert le prix du pacte.",
            ][index] ?? "",
          ),
          {
            t: "advanceQuest",
            questId: "0009",
            objectiveId: `000${index + 1}`,
            amount: 1,
          },
          { t: "setSelfSwitch", selfSwitch: "A", value: true },
        ],
        { graphicAssetId: GRAPHICS.rune },
      ),
      page([say("Cage vide", "Le verrou pend, ouvert.")], {
        condSelfSwitch: "A",
        graphicAssetId: GRAPHICS.rune,
      }),
    ]);
  }
  for (const [index, position] of [at(8, 5), at(12, 5), at(16, 5)].entries()) {
    e.normal(`ward-${index + 1}`, `Brasero du serment ${index + 1}`, position, GRAPHICS.rune, [
      page(
        [
          say(
            "Brasero",
            "La flamme prononce un fragment du serment militaire. Vous retournez les mots contre le sceau qui les emprisonne.",
          ),
          { t: "setVariable", variableId: "0003", op: "add", value: 1 },
          {
            t: "if",
            cond: { type: "variable", variableId: "0003", min: 3 },
            // biome-ignore lint/suspicious/noThenProperty: the EventCommand wire format requires `then`.
            then: [
              { t: "setSwitch", switchId: "0006", value: true },
              { t: "completeActivity", activityId: "brasiers_du_serment" },
            ],
            else: [],
          },
          { t: "setSelfSwitch", selfSwitch: "A", value: true },
        ],
        { graphicAssetId: GRAPHICS.rune },
      ),
      page([say("Brasero éteint", "Il ne reste qu’une odeur de cire et de fer.")], {
        condSelfSwitch: "A",
        graphicAssetId: GRAPHICS.rune,
      }),
    ]);
  }
  for (let index = 0; index < 5; index += 1) {
    e.monster(
      `guard-${index + 1}`,
      `Légionnaire de cendre ${index + 1}`,
      at(7 + index * 2, 9 - (index % 2) * 2, 1, index === 4 ? 2 : 1),
      index % 2 === 0 ? "skull_guard" : "skull_crusader",
      {
        maxHp: 220 + index * 20,
        damage: 24 + index,
        xp: 150,
        weakness: index % 2 === 0 ? "warrior" : "ranger",
        weaknessPercent: 150,
      },
    );
  }
  e.monster("subboss", "Inquisitrice Sael", at(13, 4), "skull_warden", {
    rank: "elite",
    maxHp: 900,
    damage: 36,
    xp: 650,
    weakness: "priest",
    weaknessPercent: 165,
    specialTechnique: "shadow_cone",
  });
  e.monster(
    "boss",
    "Kaelgor, Gardien du Mensonge",
    at(17, 3),
    "gate_troll",
    {
      rank: "boss",
      maxHp: 2_400,
      damage: 44,
      speed: 70,
      xp: 1_900,
      weakness: "warrior",
      weaknessPercent: 160,
      specialTechnique: "ground_slam",
    },
    [{ t: "setSwitch", switchId: "0007", value: true }],
  );
  e.anchor("exit-forward", "Pont du Sanctuaire", at(18, 1), "exit");
  return {
    id: MAP_IDS.citadel,
    name: "Citadelle des Cendres — Le Serment brisé",
    tilesetId: "tiny-swords",
    cols: COLS,
    rows: ROWS,
    layers: scaledLayers(BASE_LAYERS.city),
    elements: decorations("citadel"),
    spawn: at(2, 12),
    events: e.events,
  };
}

function buildSanctuary(refs: StoryRefs): AdventureBundleMap {
  const e = createEventFactory("sanctuary", refs);
  e.anchor("entry-back", "Pont des Cendres", at(2, 11), "entry");
  e.anchor("exit-back", "Retour vers la Citadelle", at(1, 11), "exit");
  e.normal("maelys", "Maëlys, dernière veilleuse", at(4, 12), GRAPHICS.monk, [
    page([], { graphicAssetId: GRAPHICS.monk }),
  ]);
  e.normal("last-warden", "Orren, dernier veilleur", at(6, 12), GRAPHICS.captain, [
    page([], { graphicAssetId: GRAPHICS.captain }),
  ]);
  for (let index = 0; index < 6; index += 1) {
    e.monster(
      `sentinel-${index + 1}`,
      `Sentinelle de l’Éclipse ${index + 1}`,
      index === 0 ? at(5, 8, 2, 1) : at(6 + index * 2, 8 - (index % 3), 1, index === 3 ? 3 : 1),
      index % 3 === 0 ? "hex_shaman" : index % 2 === 0 ? "skull_crusader" : "skull_guard",
      {
        rank: index === 5 ? "elite" : "normal",
        maxHp: index === 5 ? 700 : 280,
        damage: index === 5 ? 38 : 28,
        xp: index === 5 ? 500 : 190,
        weakness: index % 2 === 0 ? "ranger" : "priest",
        weaknessPercent: 155,
      },
    );
  }
  e.monster(
    "subboss",
    "Eryndor, Ombre du Roi sans Tombe",
    at(12, 4),
    "minotaur_brute",
    {
      rank: "elite",
      maxHp: 2_000,
      damage: 46,
      speed: 78,
      xp: 1_500,
      weakness: "ranger",
      weaknessPercent: 160,
      specialTechnique: "shadow_cone",
    },
    [{ t: "setSwitch", switchId: "0008", value: true }],
  );
  e.monster(
    "boss",
    "Archonte Varos, Porte-Couronne",
    at(15, 3),
    "gate_troll",
    {
      rank: "boss",
      maxHp: 3_600,
      damage: 56,
      speed: 74,
      xp: 3_000,
      weakness: "priest",
      weaknessPercent: 175,
      specialTechnique: "soul_drain",
    },
    [{ t: "setSwitch", switchId: "0009", value: true }],
  );
  e.normal("heart", "Cœur de l’Aurore captive", at(17, 2), GRAPHICS.rune, [
    page(
      [
        say(
          "Cœur de l’Aurore",
          "La couronne boit encore la Source. Varos doit tomber avant que vous puissiez atteindre ce qui demeure dessous.",
        ),
      ],
      { graphicAssetId: GRAPHICS.rune },
    ),
    page(
      [
        say(
          "Maëlys",
          "La Source n’est ni un trône ni une arme. Elle se souvient de chaque promesse. Cette fois, elle vous demande ce que vaut une victoire qui reproduit le mensonge.",
        ),
        {
          t: "choices",
          prompt: "Décider du destin de la Couronne d’Aube.",
          options: [
            {
              label: "Briser la Couronne et rendre la Source aux peuples",
              body: [
                say(
                  "Maëlys",
                  "Alors nul ne régnera seul sur l’Aurore. Ce sera plus difficile qu’un royaume. Ce sera une responsabilité.",
                ),
                { t: "setSwitch", switchId: "0010", value: true },
                { t: "completeActivity", activityId: "destin_de_la_source" },
              ],
            },
            {
              label: "Sceller la Source jusqu’à ce que les cités soient prêtes",
              body: [
                say(
                  "Maëlys",
                  "Un sursis, pas une solution. Mais vous avez refusé de devenir Varos, et cela suffit pour aujourd’hui.",
                ),
                { t: "setSwitch", switchId: "0011", value: true },
                { t: "completeActivity", activityId: "destin_de_la_source" },
              ],
            },
          ],
        },
      ],
      { condSwitchId: "0009", graphicAssetId: GRAPHICS.rune },
    ),
  ]);
  e.anchor("exit-end", "L’Aube après la Couronne", at(18, 2), "exit");
  return {
    id: MAP_IDS.sanctuary,
    name: "Sanctuaire de l’Éclipse — La Couronne vide",
    tilesetId: "tiny-swords",
    cols: COLS,
    rows: ROWS,
    layers: scaledLayers(BASE_LAYERS.sanctuary),
    elements: decorations("sanctuary"),
    spawn: at(2, 12),
    events: e.events,
  };
}

function ref(mapId: string, event: MapEvent): QuestEventReference {
  return { mapId, eventId: event.id };
}

function objective(value: AuthoredQuestObjective): AuthoredQuestObjective {
  return value;
}

function dialogues(value: Partial<QuestDialogues>): QuestDialogues {
  return { ...emptyQuestDialogues(), ...value };
}

function quest(
  id: string,
  title: string,
  description: string,
  journalSummary: string,
  overrides: Partial<AuthoredQuestDefinition>,
): AuthoredQuestDefinition {
  return {
    ...createAuthoredQuestDefinition(id, title),
    version: 4,
    description,
    journalSummary,
    scope: "party",
    abandonable: false,
    ...overrides,
  };
}

function baseObjective(id: string, label: string, stage: number, target = 1) {
  return { id, label, target, optional: false, hidden: false, stage } as const;
}

function buildQuests(refs: StoryRefs): AuthoredQuestDefinition[] {
  const required = (key: string): MapEvent => {
    const event = refs[key];
    if (!event) throw new Error(`missing story ref ${key}`);
    return event;
  };
  const defeat = (id: string, label: string, stage: number, mapId: string, event: MapEvent) =>
    objective({
      ...baseObjective(id, label, stage),
      type: "defeat-target",
      targetRef: ref(mapId, event),
      credit: "nearby-party",
    });
  const activity = (id: string, label: string, stage: number, activityId: string) =>
    objective({
      ...baseObjective(id, label, stage),
      type: "activity",
      activityId,
    });
  const interact = (id: string, label: string, stage: number, mapId: string, event: MapEvent) =>
    objective({
      ...baseObjective(id, label, stage),
      type: "interact",
      interaction: "interact",
      targetRef: ref(mapId, event),
    });
  const reward = (
    experience: number,
    gold: number,
    nextQuestId: string | null,
    stateChanges: ReturnType<typeof emptyQuestRewards>["stateChanges"] = [],
  ) => ({
    ...emptyQuestRewards(),
    experience,
    gold,
    nextQuestId,
    stateChanges,
  });

  return [
    quest(
      "0001",
      "Le Premier Renégat",
      "La porte orientale d’Aubeval est tenue par Varkesh, ancien commandant de la cité. Lyra refuse la version commode d’une trahison sans cause et vous demande de rapporter la vérité, pas seulement une victoire.",
      "Traverser le faubourg occupé, vaincre Varkesh et revenir auprès de Lyra.",
      {
        recommendedLevel: 2,
        giver: ref(MAP_IDS.aubeval, required("aubeval.lyra")),
        turnInTarget: ref(MAP_IDS.aubeval, required("aubeval.lyra")),
        objectiveMode: "sequential",
        objectives: [
          defeat(
            "0001",
            "Vaincre le commandant Varkesh",
            0,
            MAP_IDS.aubeval,
            required("aubeval.boss"),
          ),
        ],
        rewards: reward(500, 90, "0002", [{ type: "switch", switchId: "0001", value: true }]),
        dialogues: dialogues({
          offer:
            "Varkesh a tenu cette porte à mes côtés pendant douze ans. Le Conseil dit qu’il a vendu Aubeval aux morts en une nuit. Les hommes ne deviennent pas des monstres en une nuit. Découvrez ce qu’on lui a montré, puis arrêtez-le avant que la ville paie le prix de nos secrets.",
          accepted:
            "Parlez aux survivants du faubourg si vous le pouvez. Et si Varkesh prononce le nom de Varos, retenez-le. Le chancelier aime que les autres oublient à sa place.",
          refused:
            "Je ne vous condamne pas. Je vous demande seulement de regarder les familles derrière cette porte avant de partir.",
          reminder:
            "Varkesh tient l’ancienne digue au nord-est. Ses prévôts d’os protègent les chemins étroits.",
          ready:
            "Je vois à votre visage que Varkesh n’était pas le début de cette histoire. Dites-moi ce qu’il gardait.",
          turnIn:
            "Un registre de convois vers les Bois, signé par Varos… Varkesh a choisi la révolte quand le Conseil lui a ordonné de livrer des civils. Cela n’excuse pas les morts qu’il a relevés, mais cela condamne ceux qui lui ont donné ce choix.",
          completed:
            "La porte est ouverte. J’ai envoyé des copies du registre hors de la caserne. Une vérité qui n’existe qu’entre deux officiers est déjà à moitié enterrée.",
        }),
      },
    ),
    quest(
      "0002",
      "Le Pacte des Racines",
      "Elyne affirme que la Source d’Aubeval fut confiée aux hommes par un pacte, non conquise par une couronne. Les trois pierres du bois conservent la mémoire de ce contrat.",
      "Résoudre l’énigme des trois pierres, puis libérer Morvane de sa corruption.",
      {
        recommendedLevel: 4,
        giver: ref(MAP_IDS.woods, required("woods.elyne")),
        turnInTarget: ref(MAP_IDS.woods, required("woods.elyne")),
        prerequisites: {
          minLevel: null,
          previousQuestId: "0001",
          mode: "all",
          conditions: [],
        },
        objectiveMode: "sequential",
        objectives: [
          activity("0001", "Réveiller les trois pierres dans le bon ordre", 0, "pacte_des_racines"),
          defeat(
            "0002",
            "Libérer Morvane, le Cerf sans Ramure",
            1,
            MAP_IDS.woods,
            required("woods.boss"),
          ),
        ],
        rewards: reward(850, 140, "0003", [{ type: "switch", switchId: "0003", value: true }]),
        dialogues: dialogues({
          offer:
            "Votre cité appelle cela une Source. Nous l’appelons une promesse. Trois pierres se souviennent des mots que vos premiers rois ont jurés, avant que leurs héritiers ne remplacent « garder » par « posséder ». Écoutez-les. Morvane vous barrera la route parce que Varos a planté dans son esprit une couronne de fer.",
          accepted:
            "Les réponses ne demandent ni force ni érudition. Elles demandent d’admettre ce que les royaumes préfèrent oublier.",
          refused:
            "Le bois n’a pas besoin de votre foi. Seulement de votre honnêteté lorsque vous reviendrez.",
          reminder:
            "Mémoire, dette, témoin. Trois idées, trois pierres, un ordre. Morvane attend au-delà.",
          ready:
            "Morvane est mort libre. C’est une maigre victoire, mais il n’a pas emporté la voix du bois avec lui.",
          turnIn:
            "Les pierres montrent une route noyée vers l’est. Le Marais de Verre conservait les comptes du pacte : qui recevait l’Aurore, et qui en payait silencieusement le prix.",
          completed:
            "Vous avez appris le premier mot du pacte : partager. Le prochain sera plus douloureux.",
          unavailable:
            "Aubeval doit d’abord ouvrir sa porte et reconnaître le mensonge fait à Varkesh.",
        }),
      },
    ),
    quest(
      "0003",
      "La Mémoire engloutie",
      "Dans le Marais de Verre, trois cloches donnent une voix aux victimes effacées des registres. Leur chant mène à Nhal’gor, gardien des archives noyées.",
      "Faire sonner les cloches dans l’ordre, vaincre Nhal’gor et remettre le registre à Talen.",
      {
        recommendedLevel: 6,
        giver: ref(MAP_IDS.marsh, required("marsh.talen")),
        turnInTarget: ref(MAP_IDS.marsh, required("marsh.talen")),
        prerequisites: {
          minLevel: null,
          previousQuestId: "0002",
          mode: "all",
          conditions: [],
        },
        objectiveMode: "sequential",
        objectives: [
          activity("0001", "Faire entendre les trois cloches noyées", 0, "cloches_noyees"),
          defeat(
            "0002",
            "Vaincre Nhal’gor, l’Abbé des Eaux Mortes",
            1,
            MAP_IDS.marsh,
            required("marsh.boss"),
          ),
        ],
        rewards: reward(1_200, 190, "0004", [{ type: "switch", switchId: "0005", value: true }]),
        dialogues: dialogues({
          offer:
            "Je classais autrefois les impôts du Conseil. Une colonne revenait chaque hiver : « entretien de l’Éclipse ». Je pensais à des murs. C’étaient des vies. Les cloches du marais nommaient ceux que nous livrions, jusqu’à ce que Nhal’gor les fasse taire.",
          accepted:
            "Sonnez d’abord pour les effacés, puis pour ceux qui ont obéi, enfin pour ceux qui ont refusé. Le marais respecte l’ordre des responsabilités.",
          refused:
            "J’ai passé vingt ans à appeler ces chiffres des provisions. Je peux attendre encore un peu, mais eux ont déjà trop attendu.",
          reminder:
            "Les cloches dessinent une route d’est en ouest. Nhal’gor drainera votre vigueur ; rompez son cercle ou frappez vite.",
          ready:
            "Le registre est intact. J’espérais presque que l’eau aurait dissous la signature de Varos.",
          turnIn:
            "La Citadelle des Cendres recevait les convois. Kaelgor les appelait des recrues. Varos les appelait du combustible. Voici la preuve que ces mots désignaient les mêmes personnes.",
          completed:
            "Une archive ne répare rien. Mais elle empêche les coupables de choisir seuls les noms du passé.",
        }),
      },
    ),
    quest(
      "0004",
      "Le Serment brisé",
      "Serah, fille de Varkesh, veut retourner les serments de la Citadelle contre ceux qui les ont profanés. Les trois brasiers protègent les archives de Varos.",
      "Éteindre les brasiers, vaincre le maréchal Kaelgor et ouvrir le pont du Sanctuaire.",
      {
        recommendedLevel: 8,
        giver: ref(MAP_IDS.citadel, required("citadel.serah")),
        turnInTarget: ref(MAP_IDS.citadel, required("citadel.serah")),
        prerequisites: {
          minLevel: null,
          previousQuestId: "0003",
          mode: "all",
          conditions: [],
        },
        objectiveMode: "sequential",
        objectives: [
          activity("0001", "Retourner les trois brasiers du serment", 0, "brasiers_du_serment"),
          defeat(
            "0002",
            "Abattre le maréchal Kaelgor",
            1,
            MAP_IDS.citadel,
            required("citadel.boss"),
          ),
        ],
        rewards: reward(1_650, 260, "0005", [{ type: "switch", switchId: "0007", value: true }]),
        dialogues: dialogues({
          offer:
            "Mon père a choisi l’horreur quand il a compris qu’une obéissance propre servait un crime plus vaste. Je ne lui demande pas pardon. Je veux seulement finir ce qu’il n’a pas su accomplir sans se perdre : ouvrir les archives et briser l’armée de Varos.",
          accepted:
            "Les brasiers répondent à l’ancien serment : protéger les faibles, refuser l’ordre injuste, témoigner devant ses pairs. Kaelgor n’en a gardé que le mot « ordre ».",
          refused: "Je suis sa fille, pas son excuse. Revenez si vous acceptez cette différence.",
          reminder:
            "Éteignez chaque brasier avant d’affronter Kaelgor. L’Inquisitrice Sael garde l’escalier intérieur.",
          ready:
            "Kaelgor est tombé. Dans ses appartements, j’ai trouvé des lettres où il suppliait Varos d’épargner ses hommes. Il savait donc supplier. Seulement jamais pour les autres.",
          turnIn:
            "Le pont du Sanctuaire est ouvert. Maëlys vous attend de l’autre côté. Elle sait ce que Varos a fait de toutes ces vies.",
          completed:
            "Je resterai ici pour libérer les conscrits et lire les noms à haute voix. Allez empêcher Varos d’en ajouter d’autres.",
        }),
      },
    ),
    quest(
      "0005",
      "L’Aube sans Couronne",
      "Varos a lié la Couronne d’Aube à l’Éclipse et s’est nourri des sacrifices dissimulés par le Conseil. Pour atteindre la Source, il faut d’abord traverser l’ombre du roi Eryndor.",
      "Vaincre Eryndor, abattre Varos, puis décider du destin de la Source.",
      {
        recommendedLevel: 10,
        giver: ref(MAP_IDS.sanctuary, required("sanctuary.maelys")),
        turnInTarget: ref(MAP_IDS.sanctuary, required("sanctuary.maelys")),
        prerequisites: {
          minLevel: null,
          previousQuestId: "0004",
          mode: "all",
          conditions: [],
        },
        objectiveMode: "sequential",
        objectives: [
          defeat(
            "0001",
            "Délivrer l’ombre du roi Eryndor",
            0,
            MAP_IDS.sanctuary,
            required("sanctuary.subboss"),
          ),
          defeat(
            "0002",
            "Vaincre l’archonte Varos",
            1,
            MAP_IDS.sanctuary,
            required("sanctuary.boss"),
          ),
          activity("0003", "Décider du destin de la Source", 2, "destin_de_la_source"),
        ],
        rewards: {
          ...reward(3_000, 500, null, [{ type: "switch", switchId: "0012", value: true }]),
          choices: [
            {
              id: "0001",
              label: "Sceau des peuples libres",
              experience: 500,
              gold: 100,
              items: [{ itemId: "resurrection_potion", quantity: 1 }],
            },
            {
              id: "0002",
              label: "Lumen des veilleurs",
              experience: 650,
              gold: 0,
              items: [{ itemId: "damage_elixir", quantity: 1 }],
            },
          ],
        },
        dialogues: dialogues({
          offer:
            "Varos n’a pas créé l’Éclipse. Il a découvert qu’une peur ancienne pouvait devenir une administration : un registre, une garnison, un secret partagé par assez de gens pour que chacun se sente innocent. Eryndor fut le premier roi à accepter ce marché. Libérez son ombre, puis refusez au chancelier le droit de le renouveler.",
          accepted:
            "Varos drainera votre vie pour réparer la sienne. Ne restez pas groupés dans son cercle, et gardez vos ressources pour sa dernière moitié.",
          refused:
            "Vous avez porté la vérité jusqu’ici. Je ne vous ordonnerai pas de mourir pour elle. Mais Varos, lui, continuera d’ordonner.",
          reminder: "Eryndor garde le seuil. Varos attend derrière lui, au pied de la Couronne.",
          ready:
            "La Source vous a répondu. Pour la première fois depuis des siècles, la Couronne est silencieuse.",
          turnIn:
            "Il n’y aura pas de fin propre. Les cités devront rendre des comptes, les familles devront apprendre ce qui fut fait en leur nom, et la Source ne résoudra aucune de ces tâches. C’est précisément pour cela que votre choix compte.",
          completed:
            "L’Aube revient sans maître unique. Que personne ne confonde cette fragilité avec une faiblesse.",
        }),
      },
    ),
    quest(
      "0006",
      "Les Noms du faubourg",
      "Neria refuse que les disparus deviennent un chiffre commode. Trois stèles inachevées attendent encore le récit de ceux qui les ont connus.",
      "Lire les trois stèles et rapporter leurs noms à Neria.",
      {
        recommendedLevel: 2,
        giver: ref(MAP_IDS.aubeval, required("aubeval.neria")),
        turnInTarget: ref(MAP_IDS.aubeval, required("aubeval.neria")),
        objectiveMode: "simultaneous",
        objectives: [1, 2, 3].map((index) =>
          interact(
            `000${index}`,
            `Lire la stèle ${index}`,
            0,
            MAP_IDS.aubeval,
            required(`aubeval.memorial-${index}`),
          ),
        ),
        rewards: reward(220, 45, null),
        dialogues: dialogues({
          offer:
            "Les officiers écrivent « pertes civiles ». Trois mots pour fermer une porte. Moi, je veux des noms, des métiers, des défauts. Lisez les stèles du faubourg et revenez me dire qui nous avons perdu.",
          accepted: "Ne récitez pas vite. Un nom lu sans attention est une seconde disparition.",
          reminder: "Les stèles longent l’ancienne place, derrière les maisons bleues.",
          ready: "Joran, Syla, Céran. Merci. Maintenant ils sont plus difficiles à effacer.",
          turnIn:
            "Je transmettrai leurs histoires aux familles, pas au Conseil. Le Conseil possède déjà assez de versions.",
          completed: "Les stèles portent désormais leurs noms entiers.",
        }),
      },
    ),
    quest(
      "0007",
      "L’Herbier qui écoute",
      "Pell soigne les arbres contaminés sans arracher leurs racines. Il lui faut trois feuilles de lumen récoltées avec précaution.",
      "Récolter trois feuilles de lumen dans les Bois des Murmures.",
      {
        recommendedLevel: 4,
        giver: ref(MAP_IDS.woods, required("woods.herbalist")),
        turnInTarget: ref(MAP_IDS.woods, required("woods.herbalist")),
        objectives: [
          objective({
            ...baseObjective("0001", "Récolter trois feuilles de lumen", 0, 3),
            type: "collect",
            itemId: "mana_potion",
            counting: "acquired",
          }),
        ],
        rewards: {
          ...reward(320, 55, null),
          items: [{ itemId: "health_potion", quantity: 2 }],
        },
        dialogues: dialogues({
          offer:
            "Les soldats coupent la racine pour gagner une minute. Moi, j’essaie de laisser quelque chose qui guérira demain. Trois feuilles de lumen suffiront, si vous résistez à l’envie de tout arracher.",
          accepted:
            "Cherchez la lumière sous l’écorce. Prenez une feuille, puis laissez la plante se refermer.",
          reminder: "Trois feuilles, pas trois racines. La différence est toute ma profession.",
          ready: "Elles sont encore chaudes. Vous avez récolté sans tuer.",
          turnIn:
            "Avec cela, je peux traiter les arbres près de la lisière et quelques voyageurs trop fiers pour demander une potion.",
          completed: "Les jeunes pousses reprennent déjà couleur.",
        }),
      },
    ),
    quest(
      "0008",
      "Ceux qui lisent la vase",
      "Wynn veut empêcher les chamans de détruire les dernières tablettes du marais avant que Talen puisse les copier.",
      "Vaincre quatre chamans dans le Marais de Verre.",
      {
        recommendedLevel: 6,
        giver: ref(MAP_IDS.marsh, required("marsh.wynn")),
        turnInTarget: ref(MAP_IDS.marsh, required("marsh.wynn")),
        objectives: [
          objective({
            ...baseObjective("0001", "Vaincre quatre Lecteurs de vase", 0, 4),
            type: "kill",
            species: "hex_shaman",
            mapScope: { kind: "maps", mapIds: [MAP_IDS.marsh] },
            credit: "nearby-party",
          }),
        ],
        rewards: reward(480, 80, null),
        dialogues: dialogues({
          offer:
            "Les chamans ne défendent pas Nhal’gor. Ils brûlent les tablettes qu’il n’a pas encore avalées. Chaque minute leur donne un siècle d’avance sur Talen.",
          accepted:
            "Ils frappent de loin et se cachent derrière les trolls. Coupez leur ligne de vue.",
          reminder: "Quatre Lecteurs patrouillent entre les cloches.",
          ready:
            "Le dernier a lâché une tablette intacte. Talen va pleurer, puis prétendre que c’est l’humidité.",
          turnIn:
            "Vous venez de sauver plus que des preuves. Vous avez sauvé les mots employés avant que Varos ne les remplace.",
          completed: "Les tablettes sont en route vers plusieurs archives.",
        }),
      },
    ),
    quest(
      "0009",
      "Les Prisonniers de braise",
      "Des conscrits enfermés dans la Citadelle connaissent le fonctionnement des brasiers et les ordres secrets de Kaelgor.",
      "Libérer les trois groupes de conscrits.",
      {
        recommendedLevel: 8,
        giver: ref(MAP_IDS.citadel, required("citadel.serah")),
        turnInTarget: ref(MAP_IDS.citadel, required("citadel.serah")),
        objectives: [1, 2, 3].map((index) =>
          interact(
            `000${index}`,
            `Ouvrir la cage ${index}`,
            0,
            MAP_IDS.citadel,
            required(`citadel.cage-${index}`),
          ),
        ),
        rewards: reward(700, 120, null),
        dialogues: dialogues({
          offer:
            "Kaelgor enferme ceux qui posent la mauvaise question : « contre qui nous battons-nous vraiment ? » Trois cages sont encore occupées. Ouvrez-les avant d’éteindre les brasiers.",
          accepted:
            "Les clés sont inutiles. Les serrures répondent au même serment que les brasiers.",
          reminder:
            "Une cage près de chaque cour intérieure. Écoutez les prisonniers ; ils ont vu ce que les officiers cachent.",
          ready:
            "Ils sont libres. Certains veulent fuir, d’autres rester et témoigner. Pour une fois, le choix leur appartient.",
          turnIn: "Je leur ai donné la route du marais. Wynn saura les faire sortir sans bannière.",
          completed: "Les cages restent ouvertes pour que personne n’oublie leur fonction.",
        }),
      },
    ),
    quest(
      "0010",
      "Le Dernier Veilleur",
      "Orren a juré de tenir le seuil jusqu’au retour de Maëlys. Il veut voir tomber Eryndor avant d’abandonner enfin sa garde.",
      "Délivrer Eryndor et revenir auprès d’Orren.",
      {
        recommendedLevel: 10,
        giver: ref(MAP_IDS.sanctuary, required("sanctuary.last-warden")),
        turnInTarget: ref(MAP_IDS.sanctuary, required("sanctuary.last-warden")),
        objectives: [
          defeat(
            "0001",
            "Délivrer l’ombre d’Eryndor",
            0,
            MAP_IDS.sanctuary,
            required("sanctuary.subboss"),
          ),
        ],
        rewards: {
          ...reward(900, 160, null),
          items: [{ itemId: "resurrection_potion", quantity: 1 }],
        },
        dialogues: dialogues({
          offer:
            "J’ai gardé cette porte si longtemps que j’ai oublié si mon serment protégeait le monde d’Eryndor ou Eryndor du monde. Faites tomber son ombre. J’aimerais mourir avec une question de moins.",
          accepted:
            "Il charge quand il sent la peur. Laissez-le annoncer son cône d’ombre, puis traversez son flanc.",
          reminder: "Eryndor attend sur le premier plateau.",
          ready: "Le silence derrière vous est différent. Plus léger.",
          turnIn:
            "Alors mon serment est accompli. Je ne mourrai pas aujourd’hui, finalement. J’ai envie de voir à quoi ressemble un matin sans ordre.",
          completed: "Orren observe l’horizon au lieu de la porte.",
        }),
      },
    ),
  ];
}

const refs: StoryRefs = {};
const maps = [
  buildAubeval(refs),
  buildWoods(refs),
  buildMarsh(refs),
  buildCitadel(refs),
  buildSanctuary(refs),
];
const quests = buildQuests(refs);
const event = (key: string): MapEvent => {
  const value = refs[key];
  if (!value) throw new Error(`missing graph ref ${key}`);
  return value;
};

const bundle: AdventureBundle = {
  format: ADVENTURE_BUNDLE_FORMAT,
  version: ADVENTURE_BUNDLE_VERSION,
  adventure: {
    title: "Liin Adventure IA",
    maxPlayers: 4,
    registry: {
      switches: [
        { id: "0001", name: "Varkesh vaincu" },
        { id: "0002", name: "Pacte des racines compris" },
        { id: "0003", name: "Morvane libéré" },
        { id: "0004", name: "Cloches noyées réveillées" },
        { id: "0005", name: "Nhal’gor vaincu" },
        { id: "0006", name: "Brasiers du serment éteints" },
        { id: "0007", name: "Kaelgor vaincu" },
        { id: "0008", name: "Eryndor délivré" },
        { id: "0009", name: "Varos vaincu" },
        { id: "0010", name: "Couronne brisée" },
        { id: "0011", name: "Source scellée" },
        { id: "0012", name: "Campagne terminée" },
      ],
      variables: [
        { id: "0001", name: "Séquence des pierres" },
        { id: "0002", name: "Séquence des cloches" },
        { id: "0003", name: "Brasiers retournés" },
      ],
      quests,
    },
  },
  maps,
  graph: {
    start: {
      mapId: MAP_IDS.aubeval,
      entryId: event("aubeval.entry").id,
    },
    links: [
      {
        mapId: MAP_IDS.aubeval,
        exitId: event("aubeval.exit-forward").id,
        dest: { mapId: MAP_IDS.woods, entryId: event("woods.entry-back").id },
      },
      {
        mapId: MAP_IDS.woods,
        exitId: event("woods.exit-back").id,
        dest: { mapId: MAP_IDS.aubeval, entryId: event("aubeval.entry").id },
      },
      {
        mapId: MAP_IDS.woods,
        exitId: event("woods.exit-forward").id,
        dest: { mapId: MAP_IDS.marsh, entryId: event("marsh.entry-back").id },
      },
      {
        mapId: MAP_IDS.marsh,
        exitId: event("marsh.exit-back").id,
        dest: { mapId: MAP_IDS.woods, entryId: event("woods.entry-back").id },
      },
      {
        mapId: MAP_IDS.marsh,
        exitId: event("marsh.exit-forward").id,
        dest: { mapId: MAP_IDS.citadel, entryId: event("citadel.entry-back").id },
      },
      {
        mapId: MAP_IDS.citadel,
        exitId: event("citadel.exit-back").id,
        dest: { mapId: MAP_IDS.marsh, entryId: event("marsh.entry-back").id },
      },
      {
        mapId: MAP_IDS.citadel,
        exitId: event("citadel.exit-forward").id,
        dest: {
          mapId: MAP_IDS.sanctuary,
          entryId: event("sanctuary.entry-back").id,
        },
      },
      {
        mapId: MAP_IDS.sanctuary,
        exitId: event("sanctuary.exit-back").id,
        dest: { mapId: MAP_IDS.citadel, entryId: event("citadel.entry-back").id },
      },
      {
        mapId: MAP_IDS.sanctuary,
        exitId: event("sanctuary.exit-end").id,
        dest: "end",
      },
    ],
  },
};

if (!parseAdventureRegistry(bundle.adventure.registry)) {
  throw new Error("generated Liin Adventure IA registry is invalid");
}
const invalidEvents: string[] = [];
for (const map of bundle.maps) {
  if (!parseMapData(map)) throw new Error(`generated map data is invalid: ${map.name}`);
  for (const event of map.events) {
    if (!parseMapEvents([event], map.cols, map.rows)) {
      invalidEvents.push(`${map.name} / ${event.name} (${event.name.length} chars)`);
    }
  }
}
if (invalidEvents.length > 0) {
  throw new Error(`generated map events are invalid:\n${invalidEvents.join("\n")}`);
}
if (!parseAdventureGraph(bundle.graph)) {
  throw new Error("generated Liin Adventure IA graph is invalid");
}
const parsed = parseAdventureBundle(bundle);
if (!parsed) throw new Error("generated Liin Adventure IA bundle envelope is invalid");
writeFileSync(OUTPUT, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
console.log(
  `built ${parsed.adventure.title}: ${parsed.maps.length} maps, ${quests.length} quests, ${parsed.graph.links.length} links`,
);
