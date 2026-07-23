/**
 * The three Brumeval maps, built with the same pure brushes the editor uses.
 * Content tables: docs/superpowers/specs/2026-07-24-brumeval-adventure-design.md
 */
import type { EditorAssetId } from "@lindocara/engine/tiny-swords-catalog.js";
import type { MapElement } from "@lindocara/engine/map-data.js";
import {
  type MapEvent,
  type MapEventPage,
  defaultEventPage,
  functionalEvent,
} from "@lindocara/engine/map-events.js";
import type { EventCommand } from "@lindocara/engine/event-commands.js";
import {
  paintElevation,
  paintRectAutotile,
  resolveWholeLayer,
} from "@lindocara/engine/tile-brush.js";
import { type TileLayer, emptyLayer, encodeTileLayer } from "@lindocara/engine/tile-layer-codec.js";
import type { MonsterSpecies } from "@lindocara/engine/game.js";
import { GRASS_SLOTS, TINY_SWORDS_TILESET } from "@lindocara/engine/tilesets/tiny-swords.js";

export interface ExitPlan {
  event: MapEvent;
  dest: { toMap: "abbaye" | "ronceclair" | "antre"; entryKey: string } | "end";
}

export interface MapContent {
  key: "abbaye" | "ronceclair" | "antre";
  name: string;
  cols: number;
  rows: number;
  layers: string[];
  elements: MapElement[];
  spawn: { col: number; row: number };
  /** Events without exits; exits ride `exits` so the orchestrator can stage them. */
  events: MapEvent[];
  exits: ExitPlan[];
  /** Entry events by stable key, referenced by other maps' exit plans. */
  entries: Record<string, MapEvent>;
}

/** Stable references other content (quests, dialogue) needs. */
export interface BrumevalRefs {
  anselme: MapEvent;
  aldric: MapEvent;
  lise: MapEvent;
  malgrin: MapEvent;
  cacheEvents: MapEvent[];
  areaCampGnoll: MapEvent;
}

const MONK: Record<string, EditorAssetId> = {
  blue: "character.units-blue-units-monk.idle" as EditorAssetId,
  red: "character.units-red-units-monk.idle" as EditorAssetId,
  purple: "character.units-purple-units-monk.idle" as EditorAssetId,
};

const CACHE_GRAPHIC = "decoration.deco.09" as EditorAssetId;

export const SWITCH_MALGRIN = "0001";
export const AREA_CAMP_GNOLL = "camp_gnoll";
export const ITEM_FIOLE = "health_potion";

let ordinalCounter = 0;

function say(name: string, text: string): EventCommand {
  return { t: "say", name, text };
}

function page(overrides: Partial<MapEventPage>): MapEventPage {
  return { ...defaultEventPage(), ...overrides };
}

function normalEvent(params: {
  col: number;
  row: number;
  name: string;
  pages: MapEventPage[];
}): MapEvent {
  ordinalCounter += 1;
  return {
    id: crypto.randomUUID(),
    col: params.col,
    row: params.row,
    name: params.name,
    ordinal: ordinalCounter,
    kind: "normal",
    species: null,
    patrolRadius: null,
    pages: params.pages,
  };
}

function fEvent(params: {
  col: number;
  row: number;
  name: string;
  kind: "entry" | "exit" | "spawn" | "monster";
  species?: MonsterSpecies;
  patrolRadius?: number;
}): MapEvent {
  ordinalCounter += 1;
  return functionalEvent({
    id: crypto.randomUUID(),
    col: params.col,
    row: params.row,
    ordinal: ordinalCounter,
    kind: params.kind,
    species: params.species,
    patrolRadius: params.patrolRadius,
    name: params.name,
  });
}

function monster(
  col: number,
  row: number,
  species: MonsterSpecies,
  name: string,
  radius = 96,
): MapEvent {
  return fEvent({ col, row, name, kind: "monster", species, patrolRadius: radius });
}

function element(assetId: string, col: number, row: number, offsetX = 0, offsetY = 0): MapElement {
  return { col, row, offsetX, offsetY, assetId: assetId as EditorAssetId };
}

function grassBase(cols: number, rows: number, inset = 1): TileLayer[] {
  const ground = paintRectAutotile(
    emptyLayer(cols, rows),
    TINY_SWORDS_TILESET,
    GRASS_SLOTS[0],
    inset,
    inset,
    cols - 1 - inset,
    rows - 1 - inset,
  );
  return [ground, emptyLayer(cols, rows), emptyLayer(cols, rows)];
}

function encodeLayers(layers: TileLayer[]): string[] {
  return layers.map((layer) => encodeTileLayer(resolveWholeLayer(layer, TINY_SWORDS_TILESET)));
}

/** Cache chest: one potion, once, guarded by self-switch A. */
function cacheEvent(col: number, row: number, name: string): MapEvent {
  return normalEvent({
    col,
    row,
    name,
    pages: [
      page({
        graphicAssetId: CACHE_GRAPHIC,
        trigger: "action",
        commands: [
          say("", "Une cache de ravitaillement. Vous récupérez une fiole de soin volée."),
          { t: "changeItems", itemId: ITEM_FIOLE, count: 1 },
          { t: "setSelfSwitch", selfSwitch: "A", value: true },
        ],
      }),
      page({
        condSelfSwitch: "A",
        graphicAssetId: CACHE_GRAPHIC,
        trigger: "action",
        commands: [say("", "La cache est vide.")],
      }),
    ],
  });
}

export function buildAbbaye(): { content: MapContent; refs: Pick<BrumevalRefs, "anselme" | "aldric"> } {
  const cols = 28;
  const rows = 20;
  const layers = grassBase(cols, rows);

  const elements: MapElement[] = [
    // The abbey and its hamlet, west side.
    element("building.buildings-blue-buildings.monastery", 4, 5),
    element("building.buildings-blue-buildings.house1", 9, 4),
    element("building.buildings-blue-buildings.house2", 3, 10),
    // Vineyard rows, east side: bushes as vines.
    ...[5, 8, 11].flatMap((row) =>
      [17, 19, 21, 23, 25].map((col) => element("decoration.terrain-decorations-bushes.bushe2", col, row)),
    ),
    // Tree line along the north and scattered accents.
    element("resource.terrain-resources-wood-trees.tree1", 13, 2),
    element("resource.terrain-resources-wood-trees.tree2", 16, 2),
    element("resource.terrain-resources-wood-trees.tree3", 2, 14),
    element("resource.terrain-resources-wood-trees.tree1", 25, 15),
    element("decoration.terrain-decorations-rocks.rock1", 7, 13),
    element("decoration.terrain-decorations-rocks.rock3", 21, 14),
  ];

  const anselme = normalEvent({
    col: 8,
    row: 9,
    name: "Frère Anselme",
    pages: [
      page({
        graphicAssetId: MONK.blue,
        trigger: "action",
        commands: [
          say(
            "Frère Anselme",
            "Bienvenue à Brumeval, voyageur. L'abbaye offre le gîte — mais la vallée n'est plus sûre.",
          ),
        ],
      }),
      page({
        condSwitchId: SWITCH_MALGRIN,
        graphicAssetId: MONK.blue,
        trigger: "action",
        commands: [
          say("Frère Anselme", "Malgrin est tombé ? Les cloches sonneront ce soir. Merci, héros."),
        ],
      }),
    ],
  });

  const aldric = normalEvent({
    col: 13,
    row: 16,
    name: "Maréchal Aldric",
    pages: [
      page({
        graphicAssetId: MONK.red,
        trigger: "action",
        commands: [
          say(
            "Maréchal Aldric",
            "Halte. La route du sud est coupée : gobelins, gnolls — et pire encore, dit-on.",
          ),
        ],
      }),
      page({
        condSwitchId: SWITCH_MALGRIN,
        graphicAssetId: MONK.red,
        trigger: "action",
        commands: [
          say("Maréchal Aldric", "La route est libre. Tu as l'étoffe d'un capitaine, voyageur."),
        ],
      }),
    ],
  });

  const spawn = fEvent({ col: 11, row: 9, name: "Départ", kind: "spawn" });
  const entrySouth = fEvent({ col: 12, row: 18, name: "Entrée sud", kind: "entry" });
  const exitSouth = fEvent({ col: 14, row: 18, name: "Vers Ronceclair", kind: "exit" });

  const monsters = [
    monster(19, 5, "spear_goblin", "Gobelin pillard"),
    monster(22, 7, "spear_goblin", "Gobelin pillard"),
    monster(20, 10, "spear_goblin", "Gobelin pillard"),
    monster(23, 12, "spear_goblin", "Gobelin pillard"),
    monster(18, 13, "spear_goblin", "Gobelin pillard"),
  ];

  return {
    content: {
      key: "abbaye",
      name: "L'abbaye de Brumeval",
      cols,
      rows,
      layers: encodeLayers(layers),
      elements,
      spawn: { col: 11, row: 10 },
      events: [spawn, entrySouth, anselme, aldric, ...monsters],
      exits: [{ event: exitSouth, dest: { toMap: "ronceclair", entryKey: "north" } }],
      entries: { south: entrySouth },
    },
    refs: { anselme, aldric },
  };
}

export function buildRonceclair(): {
  content: MapContent;
  refs: Pick<BrumevalRefs, "cacheEvents" | "areaCampGnoll">;
} {
  const cols = 40;
  const rows = 25;
  const layers = grassBase(cols, rows);

  const trees = "resource.terrain-resources-wood-trees";
  const elements: MapElement[] = [
    // Forest edges: tree lines north and south.
    ...[4, 8, 12, 16, 20, 24, 28, 33].map((col) => element(`${trees}.tree2`, col, 3)),
    ...[3, 7, 11, 15, 21, 26, 31, 36].map((col) => element(`${trees}.tree1`, col, 22)),
    // Mid-forest clumps shaping the paths.
    ...[
      [6, 7],
      [15, 6],
      [23, 9],
      [18, 13],
      [11, 17],
      [22, 18],
      [27, 5],
      [34, 20],
    ].map(([col, row]) => element(`${trees}.tree3`, col, row)),
    // A funnel toward the gnoll camp: trees force the (29,12) corridor.
    element(`${trees}.tree1`, 29, 9),
    element(`${trees}.tree2`, 29, 15),
    element(`${trees}.tree3`, 27, 11),
    element(`${trees}.tree1`, 27, 14),
    // Camp dressing.
    element("decoration.terrain-decorations-rocks.rock2", 10, 12),
    element("decoration.terrain-decorations-rocks.rock4", 33, 13),
    element("decoration.terrain-decorations-bushes.bushe3", 14, 10),
    element("decoration.terrain-decorations-bushes.bushe1", 31, 16),
  ];

  const caches = [
    cacheEvent(11, 13, "Cache de ravitaillement"),
    cacheEvent(24, 6, "Cache de ravitaillement"),
    cacheEvent(30, 19, "Cache de ravitaillement"),
  ];

  const areaCampGnoll = normalEvent({
    col: 29,
    row: 12,
    name: "Lisière du camp gnoll",
    pages: [
      page({
        graphicAssetId: null,
        trigger: "player-touch",
        commands: [{ t: "enterArea", areaId: AREA_CAMP_GNOLL }],
      }),
    ],
  });

  const entryNorth = fEvent({ col: 20, row: 2, name: "Entrée nord", kind: "entry" });
  const exitNorth = fEvent({ col: 18, row: 2, name: "Vers l'abbaye", kind: "exit" });
  const entryEast = fEvent({ col: 38, row: 14, name: "Entrée est", kind: "entry" });
  const exitEast = fEvent({ col: 38, row: 12, name: "Vers l'antre", kind: "exit" });

  const monsters = [
    monster(8, 10, "torch_goblin", "Gobelin incendiaire", 128),
    monster(12, 11, "torch_goblin", "Gobelin incendiaire", 128),
    monster(9, 14, "torch_goblin", "Gobelin incendiaire", 128),
    monster(13, 15, "torch_goblin", "Gobelin incendiaire", 128),
    monster(16, 8, "spear_goblin", "Gobelin pillard"),
    monster(17, 16, "spear_goblin", "Gobelin pillard"),
    monster(6, 18, "spear_goblin", "Gobelin pillard"),
    monster(31, 10, "gnoll_marauder", "Gnoll maraudeur", 128),
    monster(34, 12, "gnoll_marauder", "Gnoll maraudeur", 128),
    monster(32, 15, "gnoll_marauder", "Gnoll maraudeur", 128),
  ];

  return {
    content: {
      key: "ronceclair",
      name: "La forêt de Ronceclair",
      cols,
      rows,
      layers: encodeLayers(layers),
      elements,
      spawn: { col: 20, row: 4 },
      events: [entryNorth, entryEast, areaCampGnoll, ...caches, ...monsters],
      exits: [
        { event: exitNorth, dest: { toMap: "abbaye", entryKey: "south" } },
        { event: exitEast, dest: { toMap: "antre", entryKey: "west" } },
      ],
      entries: { north: entryNorth, east: entryEast },
    },
    refs: { cacheEvents: caches, areaCampGnoll },
  };
}

export function buildAntre(): {
  content: MapContent;
  refs: Pick<BrumevalRefs, "lise" | "malgrin">;
} {
  const cols = 24;
  const rows = 16;
  let layers = grassBase(cols, rows);
  // A raised north rim: pure scenery depth (its cliff face blocks from the south).
  for (let col = 1; col <= 22; col += 1) {
    layers = paintElevation(layers, TINY_SWORDS_TILESET, 1, col, 1);
  }

  const trees = "resource.terrain-resources-wood-trees";
  const elements: MapElement[] = [
    // The arena ring, gap on the west side.
    ...[10, 12, 14, 16, 18].map((col) => element(`${trees}.tree1`, col, 4)),
    ...[10, 12, 14, 16, 18].map((col) => element(`${trees}.tree2`, col, 12)),
    element(`${trees}.tree3`, 20, 6),
    element(`${trees}.tree3`, 20, 10),
    element("decoration.terrain-decorations-rocks.rock1", 9, 6),
    element("decoration.terrain-decorations-rocks.rock2", 9, 10),
    element("decoration.terrain-decorations-rocks.rock3", 13, 8),
  ];

  const lise = normalEvent({
    col: 4,
    row: 6,
    name: "Éclaireuse Lise",
    pages: [
      page({
        graphicAssetId: MONK.purple,
        trigger: "action",
        commands: [
          say(
            "Éclaireuse Lise",
            "Baisse-toi ! Malgrin est là, au fond de l'arène. J'ai vu ses cornes briser un chêne.",
          ),
        ],
      }),
      page({
        condSwitchId: SWITCH_MALGRIN,
        graphicAssetId: MONK.purple,
        trigger: "action",
        commands: [
          say("Éclaireuse Lise", "Tu l'as vaincu... La vallée de Brumeval est libre. Rentrons."),
          {
            t: "choices",
            prompt: "Rentrer au village ?",
            options: [
              { label: "Oui, rentrons", body: [{ t: "endAdventure" }] },
              {
                label: "Pas encore",
                body: [say("Éclaireuse Lise", "Je t'attends. Prends ton temps.")],
              },
            ],
          },
        ],
      }),
    ],
  });

  const malgrin = fEvent({
    col: 15,
    row: 8,
    name: "Malgrin",
    kind: "monster",
    species: "minotaur_brute",
    patrolRadius: 160,
  });
  // On-defeat program: raise the victory switch the NPC pages and the finale read.
  malgrin.pages[0].commands = [{ t: "setSwitch", switchId: SWITCH_MALGRIN, value: true }];

  const entryWest = fEvent({ col: 2, row: 7, name: "Entrée ouest", kind: "entry" });
  const exitWest = fEvent({ col: 2, row: 9, name: "Vers Ronceclair", kind: "exit" });
  const exitEnd = fEvent({ col: 21, row: 8, name: "La vallée libérée", kind: "exit" });

  const guards = [
    monster(12, 6, "skull_guard", "Garde d'os", 96),
    monster(12, 11, "skull_guard", "Garde d'os", 96),
  ];

  return {
    content: {
      key: "antre",
      name: "L'antre de Malgrin",
      cols,
      rows,
      layers: encodeLayers(layers),
      elements,
      spawn: { col: 3, row: 8 },
      events: [entryWest, lise, malgrin, ...guards],
      exits: [
        { event: exitWest, dest: { toMap: "ronceclair", entryKey: "east" } },
        { event: exitEnd, dest: "end" },
      ],
      entries: { west: entryWest },
    },
    refs: { lise, malgrin },
  };
}

export interface BuiltWorld {
  maps: MapContent[];
  refs: BrumevalRefs;
}

export function buildWorld(): BuiltWorld {
  ordinalCounter = 0;
  const abbaye = buildAbbaye();
  const ronceclair = buildRonceclair();
  const antre = buildAntre();
  return {
    maps: [abbaye.content, ronceclair.content, antre.content],
    refs: {
      ...abbaye.refs,
      ...ronceclair.refs,
      ...antre.refs,
    },
  };
}
