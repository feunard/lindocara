/**
 * Shared authoring vocabulary for "La Cité assiégée".
 *
 * The bundle is source code first and JSON second: every id is derived from a logical key, every
 * state slot has a readable name, and every map is rebuilt through the same parsers as imported
 * content. Nothing in this directory depends on a running Worker or a database.
 */
import { createHash } from "node:crypto";
import type { AdventureBundleMap } from "@lindocara/engine/adventure-bundle.js";
import type { MapAudioConfig } from "@lindocara/engine/audio-catalog.js";
import type { EventCommand, TransitionCategory } from "@lindocara/engine/event-commands.js";
import type { MonsterRespawnMode, MonsterSpecies, MonsterTuning } from "@lindocara/engine/game.js";
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
import { resolveWholeLayer } from "@lindocara/engine/tile-brush.js";
import { emptyLayer, encodeTileLayer } from "@lindocara/engine/tile-layer-codec.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import { autotileId, EMPTY_TILE } from "@lindocara/engine/tileset.js";
import {
  TINY_SWORDS_TILESET,
  TINY_SWORDS_TILESET_ID,
} from "@lindocara/engine/tilesets/tiny-swords.js";
import type { EditorAssetId } from "@lindocara/engine/tiny-swords-catalog.js";

export const MAP_IDS = {
  route: stableUuid("map:route-cachee"),
  lower: stableUuid("map:ville-basse"),
  foundations: stableUuid("map:fondations"),
  upper: stableUuid("map:ville-haute"),
  court: stableUuid("map:cour-centrale"),
} as const;

export type MapKey = keyof typeof MAP_IDS;

export const MAP_DIMENSIONS: Readonly<Record<MapKey, { cols: number; rows: number }>> = {
  route: { cols: 56, rows: 38 },
  lower: { cols: 64, rows: 48 },
  foundations: { cols: 60, rows: 46 },
  upper: { cols: 64, rows: 48 },
  court: { cols: 58, rows: 42 },
};

export const GRAPHICS = {
  soldier: "character.units-blue-units-lancer.lancer-idle",
  captain: "character.units-blue-units-warrior.warrior-idle",
  survivor: "character.units-yellow-units-pawn.pawn-idle",
  smith: "character.units-blue-units-pawn.pawn-idle-hammer",
  wounded: "character.units-red-units-pawn.pawn-idle-wood",
  monk: "character.units-purple-units-monk.idle",
  sign: "decoration.deco.17",
  memorial: "decoration.deco.16",
  bones: "decoration.deco.14",
  rune: "resource.terrain-resources-gold-gold-stones.gold-stone-6",
  cache: "resource.resources-resources.g-idle",
} as const satisfies Record<string, EditorAssetId>;

export type StoryRefs = Record<string, MapEvent>;

export function stableUuid(key: string): string {
  const hex = createHash("sha256").update(`lindocara-cite-assiegee:${key}`).digest("hex");
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

export function switchOn(switchId: string): EventCommand {
  return { t: "setSwitch", switchId, value: true };
}

export function addVar(variableId: string, value = 1): EventCommand {
  return { t: "setVariable", variableId, op: "add", value };
}

export function selfSwitchOn(selfSwitch: "A" | "B" | "C" | "D"): EventCommand {
  return { t: "setSelfSwitch", selfSwitch, value: true };
}

export function wait(frames: number): EventCommand {
  return { t: "wait", frames };
}

export function teleport(
  map: MapKey,
  col: number,
  row: number,
  category: TransitionCategory = "geographic",
): EventCommand {
  return { t: "teleport", mapId: MAP_IDS[map], col, row, category };
}

export function gold(amount: number): EventCommand {
  return { t: "changeGold", amount };
}

export function items(itemId: string, count: number): EventCommand {
  return { t: "changeItems", itemId, count };
}

export function endAdventure(): EventCommand {
  return { t: "endAdventure" };
}

export interface MonsterAuthoring {
  tuning?: Partial<MonsterTuning>;
  commands?: readonly EventCommand[];
  patrolRadius?: number;
  conditionSwitchId?: string;
  conditionVariable?: { id: string; min: number };
  respawnMode?: MonsterRespawnMode;
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
    kind: "entry" | "exit",
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
    options: MonsterAuthoring = {},
  ): MapEvent => {
    const event = functionalEvent({
      id: stableUuid(`${mapKey}:${key}`),
      ...position,
      name,
      ordinal: ordinal++,
      kind: "monster",
      species,
      patrolRadius:
        options.patrolRadius ??
        (options.tuning?.rank === "boss" ? 180 : options.tuning?.rank === "elite" ? 128 : 88),
      monsterTuning: options.tuning,
      monsterRespawnMode: options.respawnMode ?? "never",
    });
    const base = event.pages[0] ?? defaultEventPage();
    return add(key, {
      ...event,
      pages: [
        {
          ...base,
          commands: options.commands ?? [],
          condSwitchId: options.conditionSwitchId ?? null,
          condVariableId: options.conditionVariable?.id ?? null,
          condVariableMin: options.conditionVariable?.min ?? null,
        },
      ],
    });
  };

  return { events, normal, anchor, monster };
}

export interface TerrainRect {
  col: number;
  row: number;
  width: number;
  height: number;
}

export interface TerrainPlan {
  /** Solid void/water used for cliffs, cisterns and the exterior boundary. */
  blocked?: readonly TerrainRect[];
  /** Re-opens gates or bridges through a larger blocked rectangle. */
  carve?: readonly TerrainRect[];
  /** 0/1/2 choose the three authored grass/elevation tints. */
  groundSlot?: 0 | 1 | 2;
}

function paintRect(ids: number[], cols: number, rows: number, rect: TerrainRect, id: number): void {
  for (let row = Math.max(0, rect.row); row < Math.min(rows, rect.row + rect.height); row += 1) {
    for (let col = Math.max(0, rect.col); col < Math.min(cols, rect.col + rect.width); col += 1) {
      ids[row * cols + col] = id;
    }
  }
}

export function terrainLayers(key: MapKey, plan: TerrainPlan): [string, string, string] {
  const { cols, rows } = MAP_DIMENSIONS[key];
  const ground = autotileId(plan.groundSlot ?? 0, 0);
  const ids = new Array<number>(cols * rows).fill(ground);
  paintRect(ids, cols, rows, { col: 0, row: 0, width: cols, height: 2 }, EMPTY_TILE);
  paintRect(ids, cols, rows, { col: 0, row: rows - 2, width: cols, height: 2 }, EMPTY_TILE);
  paintRect(ids, cols, rows, { col: 0, row: 0, width: 2, height: rows }, EMPTY_TILE);
  paintRect(ids, cols, rows, { col: cols - 2, row: 0, width: 2, height: rows }, EMPTY_TILE);
  for (const rect of plan.blocked ?? []) paintRect(ids, cols, rows, rect, EMPTY_TILE);
  for (const rect of plan.carve ?? []) paintRect(ids, cols, rows, rect, ground);
  const layers = [
    resolveWholeLayer({ cols, rows, ids }, TINY_SWORDS_TILESET),
    emptyLayer(cols, rows),
    emptyLayer(cols, rows),
  ];
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

function elementBlocksCell(candidate: MapElement, target: { col: number; row: number }): boolean {
  const collider = elementWorldCollider(candidate);
  if (!collider) return false;
  const left = target.col * TILE_SIZE + TILE_SIZE / 4;
  const top = target.row * TILE_SIZE + TILE_SIZE / 4;
  const right = left + TILE_SIZE / 2;
  const bottom = top + TILE_SIZE / 2;
  return (
    collider.x < right &&
    collider.x + collider.width > left &&
    collider.y < bottom &&
    collider.y + collider.height > top
  );
}

/**
 * Remove only invalid/duplicate placements and scenery that would cover a functional event. Visual
 * overlap is intentional in dense districts; exact quarter-cell slot overlap is not.
 */
export function safeElements(
  key: MapKey,
  spawn: { col: number; row: number },
  events: readonly MapEvent[],
  authored: readonly MapElement[],
): MapElement[] {
  const { cols, rows } = MAP_DIMENSIONS[key];
  const protectedCells = [
    spawn,
    ...events.filter(
      (event) => event.kind !== "normal" || event.pages.some((p) => p.commands.length),
    ),
  ];
  const occupied = new Set<string>();
  return authored.filter((candidate) => {
    const slot = `${candidate.col}:${candidate.row}:${candidate.offsetX}:${candidate.offsetY}`;
    if (
      occupied.has(slot) ||
      !elementFitsMap(candidate, cols, rows) ||
      protectedCells.some((target) => elementBlocksCell(candidate, target))
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
  audio: MapAudioConfig,
): AdventureBundleMap {
  const dimensions = MAP_DIMENSIONS[key];
  return {
    id: MAP_IDS[key],
    name,
    tilesetId: TINY_SWORDS_TILESET_ID,
    ...dimensions,
    layers,
    elements: safeElements(key, spawn, events, elements),
    spawn,
    events,
    audio,
  };
}

const SWITCH_NAMES = [
  "Assaut de la porte basse",
  "Bataille du marché engagée",
  "Piège des citernes engagé",
  "Arène des fondations engagée",
  "Assaut de la ville haute",
  "Siège de la cour engagé",
  "Minotaure vaincu",
  "Grande porte ouverte",
  "Troll de la porte vaincu",
  "Aventure terminée",
  "Piège des portes hautes",
] as const;

const VARIABLE_NAMES = [
  "Défenseurs de la porte",
  "Ennemis du marché vaincus",
  "Créatures du piège vaincues",
  "Gardiens des fondations",
  "Défenseurs de la ville haute",
  "Ennemis du siège vaincus",
  "Boss intermédiaire vaincu",
  "Boss final vaincu",
  "Ennemis du piège haut",
  "Phase du boss final",
] as const;

export const S = {
  routeBattle: "0001",
  marketBattle: "0002",
  cisternTrap: "0003",
  foundationArena: "0004",
  upperBattle: "0005",
  courtSiege: "0006",
  minotaurDefeated: "0007",
  finalGateOpen: "0008",
  finalBossDefeated: "0009",
  finished: "0010",
  upperTrap: "0011",
} as const;

export const V = {
  routeKills: "0001",
  marketKills: "0002",
  trapKills: "0003",
  foundationKills: "0004",
  upperKills: "0005",
  courtKills: "0006",
  midBoss: "0007",
  finalBoss: "0008",
  upperTrapKills: "0009",
  finalPhase: "0010",
} as const;

function registryEntries(names: readonly string[]) {
  return names.map((name, index) => ({ id: String(index + 1).padStart(4, "0"), name }));
}

export const SWITCHES = registryEntries(SWITCH_NAMES);
export const VARIABLES = registryEntries(VARIABLE_NAMES);
