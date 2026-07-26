import { createHash } from "node:crypto";
import type { AdventureBundleMap } from "@lindocara/engine/adventure-bundle.js";
import type { RegistryEntry } from "@lindocara/engine/adventure-state.js";
import type { EventCommand } from "@lindocara/engine/event-commands.js";
import type { MonsterSpecies, MonsterTuning } from "@lindocara/engine/game.js";
import { elementCoversCell, elementFitsMap, type MapElement } from "@lindocara/engine/map-data.js";
import {
  defaultEventPage,
  functionalEvent,
  type MapEvent,
  type MapEventPage,
} from "@lindocara/engine/map-events.js";
import { resolveWholeLayer } from "@lindocara/engine/tile-brush.js";
import { emptyLayer, encodeTileLayer } from "@lindocara/engine/tile-layer-codec.js";
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

export function teleport(map: MapKey, col: number, row: number): EventCommand {
  return { t: "teleport", mapId: MAP_IDS[map], col, row };
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
      pages: [{ ...(event.pages[0] ?? defaultEventPage()), commands }],
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
}

function paintRect(ids: number[], rect: TerrainRect, id: number): void {
  for (let row = Math.max(0, rect.row); row < Math.min(ROWS, rect.row + rect.height); row += 1) {
    for (let col = Math.max(0, rect.col); col < Math.min(COLS, rect.col + rect.width); col += 1) {
      ids[row * COLS + col] = id;
    }
  }
}

/** Unique, deterministic field geometry. Water is real collision; `carve` reopens causeways/doors. */
export function terrainLayers(plan: TerrainPlan): [string, string, string] {
  const grass = autotileId(0, 0);
  const ids = new Array<number>(COLS * ROWS).fill(grass);
  paintRect(ids, { col: 0, row: 0, width: COLS, height: 2 }, EMPTY_TILE);
  paintRect(ids, { col: 0, row: ROWS - 2, width: COLS, height: 2 }, EMPTY_TILE);
  paintRect(ids, { col: 0, row: 0, width: 2, height: ROWS }, EMPTY_TILE);
  paintRect(ids, { col: COLS - 2, row: 0, width: 2, height: ROWS }, EMPTY_TILE);
  for (const rect of plan.water ?? []) paintRect(ids, rect, EMPTY_TILE);
  for (const rect of plan.carve ?? []) paintRect(ids, rect, grass);
  const ground = resolveWholeLayer({ cols: COLS, rows: ROWS, ids }, TINY_SWORDS_TILESET);
  const empty = emptyLayer(COLS, ROWS);
  return [encodeTileLayer(ground), encodeTileLayer(empty), encodeTileLayer(empty)];
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

const SCATTER: Record<
  "road" | "city" | "forest" | "marsh" | "military" | "sacred",
  readonly EditorAssetId[]
> = {
  road: [
    "decoration.terrain-decorations-rocks.rock1",
    "decoration.terrain-decorations-rocks.rock3",
    "decoration.terrain-decorations-bushes.bushe1",
  ],
  city: ["decoration.deco.13", "decoration.deco.14", "decoration.terrain-decorations-rocks.rock4"],
  forest: [
    "resource.terrain-resources-wood-trees.tree1",
    "resource.terrain-resources-wood-trees.tree2",
    "resource.terrain-resources-wood-trees.tree4",
    "decoration.terrain-decorations-bushes.bushe1",
  ],
  marsh: [
    "resource.terrain-resources-wood-trees.tree3",
    "decoration.terrain-decorations-rocks.rock3",
    "decoration.deco.17",
  ],
  military: [
    "decoration.deco.13",
    "decoration.deco.14",
    "decoration.terrain-decorations-rocks.rock1",
  ],
  sacred: [
    "decoration.deco.17",
    "resource.terrain-resources-wood-trees.tree4",
    "decoration.terrain-decorations-rocks.rock4",
  ],
};

const SCATTER_CELLS = [
  [3, 3],
  [8, 4],
  [15, 3],
  [23, 4],
  [32, 3],
  [41, 4],
  [50, 3],
  [56, 6],
  [4, 13],
  [55, 15],
  [5, 23],
  [54, 25],
  [4, 34],
  [12, 40],
  [23, 41],
  [36, 40],
  [48, 41],
  [56, 36],
] as const;

export function safeElements(
  theme: keyof typeof SCATTER,
  events: readonly MapEvent[],
  spawn: { col: number; row: number },
  authored: readonly MapElement[],
): MapElement[] {
  const protectedCells = [...events, spawn];
  const candidates = [
    ...authored,
    ...SCATTER_CELLS.map(([col, row], index) =>
      element(SCATTER[theme][index % SCATTER[theme].length] as EditorAssetId, col, row),
    ),
  ];
  const occupied = new Set<string>();
  return candidates.filter((candidate) => {
    const slot = `${candidate.col}:${candidate.row}:${candidate.offsetX}:${candidate.offsetY}`;
    if (
      occupied.has(slot) ||
      !elementFitsMap(candidate, COLS, ROWS) ||
      protectedCells.some(
        (protectedCell) =>
          elementCoversCell(candidate, protectedCell.col, protectedCell.row) ||
          (Math.abs(candidate.col - protectedCell.col) <= 1 &&
            Math.abs(candidate.row - protectedCell.row) <= 1),
      )
    ) {
      return false;
    }
    occupied.add(slot);
    return true;
  });
}

export function bundleMap(
  key: MapKey,
  name: string,
  layers: readonly string[],
  spawn: { col: number; row: number },
  events: readonly MapEvent[],
  elements: readonly MapElement[],
): AdventureBundleMap {
  return {
    id: MAP_IDS[key],
    name,
    tilesetId: TINY_SWORDS_TILESET_ID,
    cols: COLS,
    rows: ROWS,
    layers,
    elements,
    spawn,
    events,
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
