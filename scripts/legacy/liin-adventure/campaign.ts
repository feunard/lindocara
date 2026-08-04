import { createHash } from "node:crypto";
import type { AdventureBundleMap } from "@lindocara/engine/adventure-bundle.js";
import type { RegistryEntry } from "@lindocara/engine/adventure-state.js";
import type { EventCommand, TransitionCategory } from "@lindocara/engine/event-commands.js";
import type { MonsterSpecies, MonsterTuning } from "@lindocara/engine/game.js";
import {
  elementFitsMap,
  elementWorldCollider,
  type MapElement,
} from "@lindocara/engine/map-data.js";
import {
  defaultEventPage,
  functionalEvent,
  type MapEvent,
  type MapEventPage,
} from "@lindocara/engine/map-events.js";
import { paintElevation, paintStairs, resolveWholeLayer } from "@lindocara/engine/tile-brush.js";
import { emptyLayer, encodeTileLayer } from "@lindocara/engine/tile-layer-codec.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import { autotileId, EMPTY_TILE } from "@lindocara/engine/tileset.js";
import {
  TINY_SWORDS_TILESET,
  TINY_SWORDS_TILESET_ID,
} from "@lindocara/engine/tilesets/tiny-swords.js";
import type { EditorAssetId } from "@lindocara/engine/tiny-swords-catalog.js";

export const COLS = 60;
export const ROWS = 45;

export const MAP_IDS = {
  prologue: stableUuid("map:route-bornes-arrachees"),
  aubeval: stableUuid("map:aubeval-digues-hautes"),
  faubourg: stableUuid("map:faubourg-porte"),
  relay: stableUuid("map:relais-quatre-dettes"),
  woods: stableUuid("map:bois-clairecorce"),
  roots: stableUuid("map:sanctuaire-racines"),
  marsh: stableUuid("map:marais-saules"),
  archives: stableUuid("map:archives-vase"),
  citadel: stableUuid("map:citadelle-trois-cours"),
  fort: stableUuid("map:fort-serments"),
  sanctuary: stableUuid("map:sanctuaire-aube"),
  crypt: stableUuid("map:crypte-eryndor"),
  war: stableUuid("map:guerre-aube"),
  galleries: stableUuid("map:galeries-source"),
  heart: stableUuid("map:coeur-pacte"),
  epilogue: stableUuid("map:plaine-liin"),
} as const;

export type MapKey = keyof typeof MAP_IDS;

export const MAP_DIMENSIONS: Readonly<Record<MapKey, { cols: number; rows: number }>> = {
  prologue: { cols: 52, rows: 36 },
  aubeval: { cols: 56, rows: 41 },
  faubourg: { cols: 52, rows: 38 },
  relay: { cols: 46, rows: 34 },
  woods: { cols: 58, rows: 44 },
  roots: { cols: 48, rows: 36 },
  marsh: { cols: 60, rows: 44 },
  archives: { cols: 52, rows: 40 },
  citadel: { cols: 58, rows: 42 },
  fort: { cols: 52, rows: 38 },
  sanctuary: { cols: 50, rows: 36 },
  crypt: { cols: 46, rows: 34 },
  war: { cols: 58, rows: 42 },
  galleries: { cols: 52, rows: 38 },
  heart: { cols: 50, rows: 36 },
  epilogue: { cols: 44, rows: 38 },
};

export const GRAPHICS = {
  lyra: "character.units-blue-units-warrior.warrior-idle",
  serah: "character.units-red-units-archer.archer-idle",
  elyne: "character.units-yellow-units-monk.idle",
  talen: "character.units-purple-units-monk.idle",
  maelys: "character.units-red-units-warrior.warrior-idle",
  varos: "character.units-black-units-lancer.lancer-idle",
  soldierBlue: "character.units-blue-units-lancer.lancer-idle",
  soldierRed: "character.units-red-units-lancer.lancer-idle",
  soldierBlack: "character.units-black-units-lancer.lancer-idle",
  archerBlue: "character.units-blue-units-archer.archer-idle",
  archerRed: "character.units-red-units-archer.archer-idle",
  monkYellow: "character.units-yellow-units-monk.idle",
  monkPurple: "character.units-purple-units-monk.idle",
  merchant: "character.units-blue-units-pawn.pawn-idle-gold",
  artisan: "character.units-blue-units-pawn.pawn-idle-hammer",
  villager: "character.units-yellow-units-pawn.pawn-idle",
  refugee: "character.units-red-units-pawn.pawn-idle-wood",
  woodcutter: "character.units-yellow-units-pawn.pawn-idle-axe",
  child: "character.units-yellow-units-pawn.pawn-idle",
  source: "resource.terrain-resources-gold-gold-stones.gold-stone-6",
  rune: "decoration.deco.17",
} as const satisfies Record<string, EditorAssetId>;

export type StoryRefs = Record<string, MapEvent>;

export function stableUuid(key: string): string {
  const hex = createHash("sha256").update(`liin-les-dettes-de-l-aube:${key}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function cell(col: number, row: number): { col: number; row: number } {
  return { col, row };
}

function scaleAxis(value: number, sourceSize: number, targetSize: number): number {
  return Math.max(
    0,
    Math.min(targetSize - 1, Math.round((value * (targetSize - 1)) / (sourceSize - 1))),
  );
}

export function mapCell(key: MapKey, col: number, row: number): { col: number; row: number } {
  const dimensions = MAP_DIMENSIONS[key];
  return {
    col: scaleAxis(col, COLS, dimensions.cols),
    row: scaleAxis(row, ROWS, dimensions.rows),
  };
}

export function page(
  commands: readonly EventCommand[] = [],
  options: Partial<MapEventPage> = {},
): MapEventPage {
  return { ...defaultEventPage(), ...options, commands };
}

export function say(name: string | null, text: string): EventCommand {
  return { t: "say", name, text };
}

export function addVar(variableId: string, value: number): EventCommand {
  return { t: "setVariable", variableId, op: "add", value };
}

export function setVar(variableId: string, value: number): EventCommand {
  return { t: "setVariable", variableId, op: "set", value };
}

export function switchOn(switchId: string): EventCommand {
  return { t: "setSwitch", switchId, value: true };
}

export function activity(activityId: string): EventCommand {
  return { t: "completeActivity", activityId };
}

export function teleport(
  map: MapKey,
  col: number,
  row: number,
  category: TransitionCategory = "geographic",
): EventCommand {
  return { t: "teleport", mapId: MAP_IDS[map], ...mapCell(map, col, row), category };
}

export function ifSwitch(
  switchId: string,
  then: readonly EventCommand[],
  otherwise: readonly EventCommand[] = [],
): EventCommand {
  return { t: "if", cond: { type: "switch", switchId }, then, else: otherwise };
}

export function ifVariable(
  variableId: string,
  min: number,
  then: readonly EventCommand[],
  otherwise: readonly EventCommand[] = [],
): EventCommand {
  return {
    t: "if",
    cond: { type: "variable", variableId, min },
    then,
    else: otherwise,
  };
}

export function choice(
  prompt: string,
  options: readonly { label: string; body: readonly EventCommand[] }[],
): EventCommand {
  return { t: "choices", prompt, options };
}

export function createEventFactory(mapKey: MapKey, refs: StoryRefs) {
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
  ): MapEvent =>
    add(key, {
      id: stableUuid(`${mapKey}:${key}`),
      ...position,
      name,
      ordinal: ordinal++,
      kind: "normal",
      species: null,
      patrolRadius: null,
      monsterRank: null,
      monsterMaxHp: null,
      monsterDamage: null,
      monsterSpeed: null,
      monsterXp: null,
      monsterWeakness: null,
      monsterWeaknessPercent: null,
      monsterSpecialTechnique: null,
      pages: pages.map((candidate) =>
        candidate.graphicAssetId === null && graphicAssetId !== null
          ? { ...candidate, graphicAssetId }
          : candidate,
      ),
    });
  const anchor = (
    key: string,
    name: string,
    position: { col: number; row: number },
    kind: "spawn" | "entry" | "exit",
  ): MapEvent =>
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
    patrolRadius?: number,
    conditionSwitchIds: readonly string[] = [],
  ): MapEvent => {
    const event = functionalEvent({
      id: stableUuid(`${mapKey}:${key}`),
      ...position,
      name,
      ordinal: ordinal++,
      kind: "monster",
      species,
      patrolRadius: patrolRadius ?? (tuning.rank === "boss" ? 120 : 88),
      monsterTuning: tuning,
    });
    return add(key, {
      ...event,
      pages:
        conditionSwitchIds.length === 0
          ? [{ ...(event.pages[0] ?? defaultEventPage()), commands }]
          : conditionSwitchIds.map((condSwitchId) => ({
              ...(event.pages[0] ?? defaultEventPage()),
              condSwitchId,
              commands,
            })),
    });
  };
  const guard = (
    key: string,
    name: string,
    position: { col: number; row: number },
    patrolRadius: number,
    conditionSwitchId: string | null = null,
  ): MapEvent => {
    const event = functionalEvent({
      id: stableUuid(`${mapKey}:${key}`),
      ...position,
      name,
      ordinal: ordinal++,
      kind: "guard",
      patrolRadius,
    });
    return add(key, {
      ...event,
      pages: [
        {
          ...(event.pages[0] ?? defaultEventPage()),
          condSwitchId: conditionSwitchId,
        },
      ],
    });
  };
  return { events, normal, anchor, monster, guard };
}

export interface TerrainRect {
  col: number;
  row: number;
  width: number;
  height: number;
}

export interface TerrainPlan {
  water?: readonly TerrainRect[];
  carve?: readonly TerrainRect[];
  elevation?: readonly (TerrainRect & { level: 1 | 2 })[];
  stairs?: readonly {
    col: number;
    row: number;
    direction: "east" | "west";
    lowLevel: 0 | 1;
  }[];
}

const REGIONAL_RELIEF: Readonly<Partial<Record<MapKey, TerrainPlan>>> = {
  prologue: {
    elevation: [{ col: 34, row: 3, width: 22, height: 10, level: 1 }],
    stairs: [{ col: 33, row: 10, direction: "east", lowLevel: 0 }],
  },
  faubourg: {
    elevation: [
      { col: 43, row: 3, width: 14, height: 12, level: 1 },
      { col: 51, row: 4, width: 6, height: 6, level: 2 },
    ],
    stairs: [
      { col: 42, row: 12, direction: "east", lowLevel: 0 },
      { col: 50, row: 9, direction: "east", lowLevel: 1 },
    ],
  },
  relay: {
    elevation: [{ col: 38, row: 3, width: 19, height: 11, level: 1 }],
    stairs: [{ col: 37, row: 11, direction: "east", lowLevel: 0 }],
  },
  woods: {
    elevation: [
      { col: 32, row: 4, width: 16, height: 12, level: 1 },
      { col: 41, row: 5, width: 7, height: 7, level: 2 },
    ],
    stairs: [
      { col: 31, row: 13, direction: "east", lowLevel: 0 },
      { col: 40, row: 10, direction: "east", lowLevel: 1 },
    ],
  },
  roots: {
    elevation: [
      { col: 34, row: 3, width: 22, height: 13, level: 1 },
      { col: 44, row: 4, width: 10, height: 9, level: 2 },
    ],
    stairs: [
      { col: 33, row: 13, direction: "east", lowLevel: 0 },
      { col: 43, row: 9, direction: "east", lowLevel: 1 },
    ],
  },
  marsh: {
    elevation: [{ col: 45, row: 3, width: 12, height: 13, level: 1 }],
    stairs: [{ col: 44, row: 13, direction: "east", lowLevel: 0 }],
  },
  archives: {
    elevation: [
      { col: 40, row: 3, width: 17, height: 13, level: 1 },
      { col: 49, row: 4, width: 7, height: 7, level: 2 },
    ],
    stairs: [
      { col: 39, row: 13, direction: "east", lowLevel: 0 },
      { col: 48, row: 9, direction: "east", lowLevel: 1 },
    ],
  },
  citadel: {
    elevation: [
      { col: 40, row: 3, width: 17, height: 14, level: 1 },
      { col: 49, row: 4, width: 8, height: 7, level: 2 },
    ],
    stairs: [
      { col: 39, row: 14, direction: "east", lowLevel: 0 },
      { col: 48, row: 10, direction: "east", lowLevel: 1 },
    ],
  },
  fort: {
    elevation: [{ col: 39, row: 3, width: 17, height: 13, level: 1 }],
    stairs: [{ col: 38, row: 13, direction: "east", lowLevel: 0 }],
  },
  sanctuary: {
    elevation: [
      { col: 32, row: 3, width: 16, height: 12, level: 1 },
      { col: 41, row: 4, width: 7, height: 7, level: 2 },
    ],
    stairs: [
      { col: 31, row: 12, direction: "east", lowLevel: 0 },
      { col: 40, row: 9, direction: "east", lowLevel: 1 },
    ],
  },
  crypt: {
    elevation: [
      { col: 31, row: 3, width: 16, height: 11, level: 1 },
      { col: 38, row: 4, width: 8, height: 9, level: 2 },
    ],
    stairs: [
      { col: 30, row: 11, direction: "east", lowLevel: 0 },
      { col: 37, row: 8, direction: "east", lowLevel: 1 },
    ],
  },
  war: {
    elevation: [{ col: 27, row: 3, width: 12, height: 9, level: 1 }],
    stairs: [{ col: 26, row: 9, direction: "east", lowLevel: 0 }],
  },
  galleries: {
    elevation: [
      { col: 36, row: 3, width: 18, height: 12, level: 1 },
      { col: 46, row: 4, width: 8, height: 7, level: 2 },
    ],
    stairs: [
      { col: 35, row: 12, direction: "east", lowLevel: 0 },
      { col: 45, row: 9, direction: "east", lowLevel: 1 },
    ],
  },
  heart: {
    elevation: [
      { col: 34, row: 3, width: 15, height: 12, level: 1 },
      { col: 42, row: 4, width: 7, height: 6, level: 2 },
    ],
    stairs: [
      { col: 33, row: 12, direction: "east", lowLevel: 0 },
      { col: 41, row: 8, direction: "east", lowLevel: 1 },
    ],
  },
  epilogue: {
    elevation: [{ col: 22, row: 3, width: 16, height: 12, level: 1 }],
    stairs: [{ col: 21, row: 12, direction: "east", lowLevel: 0 }],
  },
};

function projectRect(key: MapKey, rect: TerrainRect): TerrainRect {
  const start = mapCell(key, rect.col, rect.row);
  const end = mapCell(key, rect.col + rect.width - 1, rect.row + rect.height - 1);
  return {
    col: start.col,
    row: start.row,
    width: Math.max(1, end.col - start.col + 1),
    height: Math.max(1, end.row - start.row + 1),
  };
}

function paintRect(ids: number[], cols: number, rows: number, rect: TerrainRect, id: number): void {
  for (let row = Math.max(0, rect.row); row < Math.min(rows, rect.row + rect.height); row += 1) {
    for (let col = Math.max(0, rect.col); col < Math.min(cols, rect.col + rect.width); col += 1) {
      ids[row * cols + col] = id;
    }
  }
}

/** Deterministic authored geometry. Water, cliffs and ramps all share runtime collision truth. */
export function terrainLayers(key: MapKey, plan: TerrainPlan): [string, string, string] {
  const { cols, rows } = MAP_DIMENSIONS[key];
  const regional = REGIONAL_RELIEF[key] ?? {};
  const grass = autotileId(0, 0);
  const ids = new Array<number>(cols * rows).fill(grass);
  paintRect(ids, cols, rows, { col: 0, row: 0, width: cols, height: 2 }, EMPTY_TILE);
  paintRect(ids, cols, rows, { col: 0, row: rows - 2, width: cols, height: 2 }, EMPTY_TILE);
  paintRect(ids, cols, rows, { col: 0, row: 0, width: 2, height: rows }, EMPTY_TILE);
  paintRect(ids, cols, rows, { col: cols - 2, row: 0, width: 2, height: rows }, EMPTY_TILE);
  for (const rect of plan.water ?? []) {
    paintRect(ids, cols, rows, projectRect(key, rect), EMPTY_TILE);
  }
  for (const rect of plan.carve ?? []) {
    paintRect(ids, cols, rows, projectRect(key, rect), grass);
  }
  let layers = [
    resolveWholeLayer({ cols, rows, ids }, TINY_SWORDS_TILESET),
    emptyLayer(cols, rows),
    emptyLayer(cols, rows),
  ];
  for (const elevation of [...(plan.elevation ?? []), ...(regional.elevation ?? [])]) {
    const projected = projectRect(key, elevation);
    for (let row = projected.row; row < projected.row + projected.height; row += 1) {
      for (let col = projected.col; col < projected.col + projected.width; col += 1) {
        layers = paintElevation(layers, TINY_SWORDS_TILESET, elevation.level, col, row);
      }
    }
  }
  for (const stairs of [...(plan.stairs ?? []), ...(regional.stairs ?? [])]) {
    const projected = mapCell(key, stairs.col, stairs.row);
    for (const row of [projected.row - 1, projected.row]) {
      layers = paintElevation(layers, TINY_SWORDS_TILESET, stairs.lowLevel, projected.col, row);
    }
    layers = paintStairs(
      layers,
      TINY_SWORDS_TILESET,
      projected.col,
      projected.row,
      stairs.direction,
      stairs.lowLevel,
    );
  }
  return layers.map(encodeTileLayer) as [string, string, string];
}

export function element(
  assetId: EditorAssetId,
  col: number,
  row: number,
  offsetX = 0,
  offsetY = 0,
): MapElement {
  return { assetId, col, row, offsetX, offsetY };
}

export type MapTheme = "road" | "city" | "forest" | "marsh" | "military" | "sacred";

export function safeElements(
  _theme: MapTheme,
  events: readonly MapEvent[],
  spawn: { col: number; row: number },
  authored: readonly MapElement[],
): MapElement[] {
  const occupied = new Set<string>();
  const protectedCells = [spawn, ...events];
  return authored.filter((candidate) => {
    const slot = `${candidate.col}:${candidate.row}:${candidate.offsetX}:${candidate.offsetY}`;
    if (
      occupied.has(slot) ||
      !elementFitsMap(candidate, COLS, ROWS) ||
      protectedCells.some((cell) => elementBlocksCell(candidate, cell))
    ) {
      return false;
    }
    occupied.add(slot);
    return true;
  });
}

function elementBlocksCell(candidate: MapElement, cell: { col: number; row: number }): boolean {
  const collider = elementWorldCollider(candidate);
  if (!collider) return false;
  const left = cell.col * TILE_SIZE + TILE_SIZE / 2;
  const top = cell.row * TILE_SIZE + TILE_SIZE / 2;
  const right = left + TILE_SIZE / 2;
  const bottom = top + TILE_SIZE / 2;
  return (
    collider.x < right &&
    collider.x + collider.width > left &&
    collider.y < bottom &&
    collider.y + collider.height > top
  );
}

export function bundleMap(
  key: MapKey,
  name: string,
  layers: readonly string[],
  spawn: { col: number; row: number },
  events: readonly MapEvent[],
  elements: readonly MapElement[],
): AdventureBundleMap {
  const dimensions = MAP_DIMENSIONS[key];
  const projectedSpawn = mapCell(key, spawn.col, spawn.row);
  const projectedEvents = events.map((event) => ({
    ...event,
    ...mapCell(key, event.col, event.row),
  }));
  const occupiedSlots = new Set<string>();
  const protectedCells = [projectedSpawn, ...projectedEvents];
  const projectedElements = elements
    .map((candidate) => ({
      ...candidate,
      ...mapCell(key, candidate.col, candidate.row),
    }))
    .filter((candidate) => {
      const slot = `${candidate.col}:${candidate.row}:${candidate.offsetX}:${candidate.offsetY}`;
      if (
        occupiedSlots.has(slot) ||
        !elementFitsMap(candidate, dimensions.cols, dimensions.rows) ||
        protectedCells.some((cell) => elementBlocksCell(candidate, cell))
      ) {
        return false;
      }
      occupiedSlots.add(slot);
      return true;
    });
  return {
    id: MAP_IDS[key],
    name,
    tilesetId: TINY_SWORDS_TILESET_ID,
    cols: dimensions.cols,
    rows: dimensions.rows,
    layers,
    elements: projectedElements,
    spawn: projectedSpawn,
    events: projectedEvents,
  };
}

const SWITCH_NAMES = [
  "Noms absents confirmés",
  "Disparus reliés aux convois",
  "Source reconnaît les Sans-Sceau",
  "Preuve publiée à Aubeval",
  "Preuve confiée à Lyra",
  "Varkesh mort",
  "Varkesh capturé",
  "Trêve conclue avec Varkesh",
  "Preuves de Varkesh obtenues",
  "Faubourg évacué",
  "Relais des Quatre Dettes rouvert",
  "Clan de Sève soutenu",
  "Clan d’Écorce soutenu",
  "Morvane libéré",
  "Morvane apaisé",
  "Morvane tué",
  "Morvane remis à un clan",
  "Souvenirs du Marais préservés",
  "Souvenirs du Marais détruits",
  "Nhalgor devenu gardien allié",
  "Nhalgor vaincu",
  "Talen accusé publiquement",
  "Talen autorisé à réparer",
  "Digue des Saules sauvée",
  "Voix de l’enfant rendue",
  "Vérité des Archives établie",
  "Citadelle confiée à Lyra",
  "Citadelle confiée à Serah",
  "Citadelle confiée à Maëlys",
  "Citadelle laissée au Conseil",
  "Serah choisit la justice",
  "Serah choisit la vengeance",
  "Conscrits libérés",
  "Inquisition démantelée",
  "Morts du serment délivrés",
  "Trêve logistique de Varos",
  "Offre de Varos refusée",
  "Mémoire d’Eryndor réunie",
  "Vérité de la Couronne connue",
  "Guerre de l’Aube préparée",
  "Renforts d’Aubeval",
  "Renforts des Bois",
  "Renforts du Marais",
  "Renforts de la Citadelle",
  "Renforts du Sanctuaire",
  "Front occidental tenu",
  "Front oriental tenu",
  "Blessés du centre évacués",
  "Chemin des serviteurs ouvert",
  "Avatar de Varos vaincu",
  "Fin — Pacte restauré",
  "Fin — Couronne détruite",
  "Fin — Source scellée",
  "Fin — Couronne réformée",
  "Fin — Victoire de Varos",
  "Fin — Nouvelle Éclipse",
  "Campagne terminée",
  "Raccourci Aubeval–Relais",
  "Raccourci Bois–Marais",
  "Raccourci Marais–Citadelle",
  "Raccourci Sanctuaire–Guerre",
  "Traces des absents retrouvées",
  "Digues stabilisées",
  "Faute de l’hiver établie",
  "Voix de Mila restituée",
  "Lettres des conscrits remises",
  "Jardins nourriciers sauvés",
  "Neuvième chariot retrouvé",
  "Rite des racines résolu",
  "Ordre des Archives résolu",
  "Ancre du grain assumée",
  "Ancre de la garde assumée",
  "Ancre du nom assumée",
  "Mécanisme originel ouvert",
  "Intention — tuer Varkesh",
  "Intention — capturer Varkesh",
  "Intention — négocier Varkesh",
  "Intentions de Nhalgor comprises",
  "Choix final prononcé",
  "Combat Morvane engagé",
  "Combat Nhalgor engagé",
  "Combat avatar engagé",
] as const;

const VARIABLE_NAMES = [
  "Mémoire",
  "Ordre",
  "Liberté",
  "Concorde",
  "Influence de Varos",
  "Confiance de Lyra",
  "Forces alliées",
  "Stabilité de la Source",
  "Preuves réunies",
  "Civils sauvés",
  "Fragments Liin",
  "Séquence des racines",
  "Séquence des Archives",
  "Fragments d’Eryndor",
  "Ancres des galeries",
  "Dettes consenties",
  "Pression de l’Éclipse",
  "Fronts tenus",
  "Soins préservés",
  "Dettes assumées",
] as const;

function registryEntries(names: readonly string[]): RegistryEntry[] {
  return names.map((name, index) => ({
    id: String(index + 1).padStart(4, "0"),
    name,
  }));
}

export const SWITCHES = registryEntries(SWITCH_NAMES);
export const VARIABLES = registryEntries(VARIABLE_NAMES);
