/**
 * What a map event IS, as authored data with no evaluator.
 *
 * Tranche 3 gives events existence: placement, pages, persistence. Nothing here runs — page
 * selection, condition evaluation, movement and triggers all belong to a later tranche that reads
 * this same shape. That split is why every field below is either an enum this file validates or a
 * free-form identifier (switch/variable id) this file deliberately does NOT check against a
 * registry: the registry doesn't exist yet, and pretending it does here would just move the
 * validation gap somewhere less honest. `docs/superpowers/specs/2026-07-19-map-events-design.md`
 * (Decisions 4 and 5) is the record of that choice.
 *
 * An event id is a client-minted uuid, stable across edits — the same policy as maps and
 * adventures, and unlike the author-chosen slug policy `map-data.ts` markers use. Tranche 5's
 * commands will reference events, so a rename must never break a reference. `ordinal` is the
 * wireframe's friendly `EV001` display order; it is display only, never identity, and this parser
 * only checks its shape, never its uniqueness.
 */
import { type EventCommand, parseEventCommands } from "./event-commands.js";
import {
  defaultMonsterTuning,
  isMonsterAttackProfile,
  isMonsterPursuitMode,
  isMonsterRank,
  isMonsterRespawnMode,
  isMonsterSpecialTechnique,
  isMonsterSpecialTechniqueForSpecies,
  isMonsterSpecies,
  isMonsterWeakness,
  MONSTER_ACCELERATION_LIMITS,
  MONSTER_RESPAWN_DELAY_LIMITS,
  MONSTER_RESPAWN_MS,
  MONSTER_TUNING_LIMITS,
  type MonsterAttackProfile,
  type MonsterPursuitMode,
  type MonsterRank,
  type MonsterRespawnMode,
  type MonsterSpecialTechnique,
  type MonsterSpecies,
  type MonsterTuning,
  type MonsterWeakness,
} from "./game.js";
import { migrateLegacyHarvestGraphicAsset } from "./harvest-presets.js";
import { type HarvestProfile, parseHarvestProfile } from "./harvest.js";
import { isUuid } from "./identifiers.js";
import { MAX_PATROL_RADIUS, MIN_PATROL_RADIUS } from "./map-data.js";
import { TILE_SIZE } from "./tilemap.js";
import {
  type EditorAssetId,
  isEditorAssetId,
  isGuardAppearanceAssetId,
  RETIRED_RUNNER_HOUND_ASSET_ID,
} from "./tiny-swords-catalog.js";
import { undergroundFloorHeight, validVerticalDepth } from "./underground.js";

/**
 * UX wave #12: markers die, their meaning becomes a typed event. A `normal` event is the wireframe
 * event from tranche 3 (pages, conditions, appearance); the other kinds are functional
 * markers reborn as addressable, uuid-identified events:
 *
 * - `entry`  — a spawn/arrival anchor the adventure graph binds by the EVENT's uuid.
 * - `exit`   — a departure anchor the graph binds by the EVENT's uuid.
 * - `monster` — a monster spawn: `species` + `patrolRadius` ride the event.
 * - `guard`   — an allied combatant. Its conditional pages decide whether the reinforcement exists
 *   in the current party state; `patrolRadius` is its authoritative leash.
 *
 * Entry/exit events stay single-page anchors. Monsters and guards deliberately keep
 * conditional pages: a confrontation or an ally can appear when the shared party state calls for
 * it without a second combat system or an autonomous event runner. A monster page runs its command
 * program on defeat; a guard page selects presence and may run dialogue on interaction.
 */
export const EVENT_KINDS = [
  "normal",
  "npc",
  "entry",
  "exit",
  "monster",
  "sea-guardian",
  "guard",
  "harvestable",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export function isEventKind(value: unknown): value is EventKind {
  return typeof value === "string" && (EVENT_KINDS as readonly string[]).includes(value);
}

/**
 * The retired adventure-start anchor kind, still readable from storage.
 *
 * `parseMapEvents` rejects the WHOLE LIST on one unknown kind — the entire map, not the one event —
 * so simply dropping `"spawn"` from `EVENT_KINDS` would have made every map that ever carried one
 * unparseable, and with it every adventure that owns that map. Dropping the event is the entire
 * migration: a spawn event was inert at runtime (it only ever selected which map an adventure
 * started on, and `adventures.startMapId` holds that now), so a dropped one loses nothing an author
 * or a player could observe. Same discipline as `"glace-fine"` in `hd2d/map-data.ts`.
 *
 * Safe to delete once no stored map contains one — which nothing in this repo can prove, since
 * authored maps live in the database.
 */
const RETIRED_SPAWN_KIND = "spawn";

export const EVENT_TRIGGERS = [
  "action",
  "player-touch",
  "event-touch",
  "auto",
  "parallel",
] as const;
export type EventTrigger = (typeof EVENT_TRIGGERS)[number];

export const MOVE_TYPES = ["fixed", "random", "approach", "custom"] as const;
export type MoveType = (typeof MOVE_TYPES)[number];

export const EVENT_GRAPHIC_TINT_DEFAULT = 0xffffff;
/** Relative height in tile units for airborne event art and its pickup contact volume. */
export const EVENT_GRAPHIC_ELEVATION_LIMITS = { min: 0, max: 16 } as const;
export const MAX_NPC_ROUTINE_STEPS = 16;
export const NPC_ROUTINE_OFFSET_LIMIT = 32;
export const NPC_ROUTINE_WAIT_LIMITS = { min: 0, max: 60_000 } as const;

export interface NpcRoutineStep {
  /** Destination relative to the event's authored home cell. */
  offsetCol: number;
  offsetRow: number;
  /** Pause after reaching the destination, in milliseconds. */
  waitMs: number;
}

export function parseNpcRoutine(value: unknown): NpcRoutineStep[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_NPC_ROUTINE_STEPS) return null;
  const steps: NpcRoutineStep[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) return null;
    const { offsetCol, offsetRow, waitMs } = raw as Record<string, unknown>;
    if (
      !Number.isSafeInteger(offsetCol) ||
      !Number.isSafeInteger(offsetRow) ||
      !Number.isSafeInteger(waitMs)
    )
      return null;
    const col = offsetCol as number;
    const row = offsetRow as number;
    const wait = waitMs as number;
    if (
      Math.abs(col) > NPC_ROUTINE_OFFSET_LIMIT ||
      Math.abs(row) > NPC_ROUTINE_OFFSET_LIMIT ||
      wait < NPC_ROUTINE_WAIT_LIMITS.min ||
      wait > NPC_ROUTINE_WAIT_LIMITS.max
    )
      return null;
    steps.push({ offsetCol: col, offsetRow: row, waitMs: wait });
  }
  return steps;
}

export const SELF_SWITCHES = ["A", "B", "C", "D"] as const;
export type SelfSwitch = (typeof SELF_SWITCHES)[number];

/** Explicit authoring budgets: the total keeps save payloads and editor lists finite, while the
 * runtime subset protects the 20 Hz simulation from maps made entirely of moving actors. Anchors
 * consume the total budget but not the runtime budget. */
export const MAX_EVENTS_PER_MAP = 256;
export const MAX_RUNTIME_EVENTS_PER_MAP = 128;
export const MAX_PAGES_PER_EVENT = 8;
export const EVENT_NAME_MAX = 32;

export function isRuntimeEventKind(kind: EventKind): boolean {
  return (
    kind === "normal" ||
    kind === "npc" ||
    kind === "monster" ||
    kind === "sea-guardian" ||
    kind === "guard" ||
    kind === "harvestable"
  );
}

export function runtimeEventCount(events: readonly Pick<MapEvent, "kind">[]): number {
  return events.reduce((count, event) => count + Number(isRuntimeEventKind(event.kind)), 0);
}

/** Inclusive range of the wireframe's move-speed and move-frequency selects. */
const MOVE_SPEED_MAX = 5;
const MOVE_FREQ_MAX = 4;

/**
 * A switch or variable id: a 4-digit ordinal (the wireframe's `0001`). This tranche only checks
 * that an id is shaped like one of those ordinals, never that it names anything real — the
 * switch/variable REGISTRY that gives ids meaning is `shared/adventure-state.ts` (tranche 4),
 * which imports this exact pattern rather than keeping its own copy, so there is exactly one
 * definition of "what a condition id looks like" for both an unvalidated page (this file) and a
 * page checked against a real registry (that one).
 */
export const CONDITION_ID_PATTERN = /^\d{4}$/;

export function isEventTrigger(value: unknown): value is EventTrigger {
  return typeof value === "string" && (EVENT_TRIGGERS as readonly string[]).includes(value);
}

export function isMoveType(value: unknown): value is MoveType {
  return typeof value === "string" && (MOVE_TYPES as readonly string[]).includes(value);
}

export function isSelfSwitch(value: unknown): value is SelfSwitch {
  return typeof value === "string" && (SELF_SWITCHES as readonly string[]).includes(value);
}

/**
 * One page of an event: XP semantics, so everything on it — conditions, appearance, movement,
 * options, trigger — belongs to that page alone, not the event. Page 1 is mandatory
 * (`MapEvent.pages` is non-empty); which page is active at runtime (highest-numbered page whose
 * conditions hold) is tranche 4's job, not this file's.
 */
export interface MapEventPage {
  /** `null` clears the condition. A variable condition travels as a pair: an id with no
   *  threshold (or a threshold with no id) is half a condition, not a page with one fewer. */
  condSwitchId: string | null;
  condVariableId: string | null;
  condVariableMin: number | null;
  condSelfSwitch: SelfSwitch | null;
  /** `null` is the wireframe's blank tile, a legitimate authored choice, not a missing value. */
  graphicAssetId: EditorAssetId | null;
  /** RGB multiplier applied by the renderer. Missing legacy data means neutral white. */
  graphicTint?: number;
  /** Relative height above the authored surface, in tile units. Legacy omission means grounded. */
  graphicElevation?: number;
  /** Gentle visual levitation around `graphicElevation`; contact keeps the stable authored height. */
  optFloat?: boolean;
  moveType: MoveType;
  /** Authored custom route. An empty legacy route keeps the historical deterministic circuit. */
  moveRoute?: readonly NpcRoutineStep[];
  /** 0-5, the wireframe's move-speed select. */
  moveSpeed: number;
  /** 0-4, the wireframe's move-frequency select. */
  moveFreq: number;
  optMoveAnim: boolean;
  optStopAnim: boolean;
  optDirFix: boolean;
  optThrough: boolean;
  optOnTop: boolean;
  /**
   * While this page is the active one, the character FIGHTS.
   *
   * A page rather than a command, and that is the whole design: `kind` belongs to the event and no
   * command can change what a thing IS, but a page already owns appearance, movement, trigger and
   * program, and page selection already re-derives whenever party state changes. So the wrong
   * answer in a dialogue sets a switch, the switch selects the page, and the guard on that page
   * draws its sword - with a different graphic if the author wants one, because that is a page
   * field too.
   *
   * Only `npc` and `guard` events can carry it: they are the kinds that already hold combat-ready
   * characteristics (`monsterMaxHp` and friends) and a patrol radius. A `monster` event needs
   * nothing here, it is already hostile.
   *
   * Missing means peaceful, which is what every page authored before this said.
   */
  optHostile?: boolean;
  trigger: EventTrigger;
  /** The authored command program. Normal events run it on their trigger; monster events run their
   * active page on defeat. Entry/exit anchors must keep it empty. */
  commands: readonly EventCommand[];
}

export interface MapEvent {
  /** Client-minted, stable across edits. This uuid is what the adventure graph binds for entry/exit
   *  kinds — a rename must never break a reference. */
  id: string;
  col: number;
  row: number;
  /** Authored storey below the surface. Missing means surface. */
  undergroundDepth?: number;
  /** For entry/exit kinds this doubles as the marker label; for guards it names the reinforcement. */
  name: string;
  /** Creation order, per map. Display only (the wireframe's `EV{ordinal}`); never identity. */
  ordinal: number;
  /** Reciprocal same-map event link used by authoring tools for indivisible teleport pairs. */
  linkedEventId?: string;
  /** Whether the renderer draws the small authored-event ground marker. Legacy omission means on. */
  showMarker?: boolean;
  /** Runtime-only scale inherited by native harvest scenery projected from a map element. */
  graphicScale?: number;
  /** `normal` and `npc` are scripted world events; the other kinds have dedicated runtime roles. */
  kind: EventKind;
  /** Set (and validated) iff `kind === "monster"`; `null` for every other kind. */
  species: MonsterSpecies | null;
  /** Set (in `[MIN_PATROL_RADIUS, MAX_PATROL_RADIUS]`) for monsters, guards and free NPCs.
   * A zero radius keeps the character at its spawn point. */
  patrolRadius: number | null;
  monsterRank?: MonsterRank | null;
  /** Combat-ready characteristics for monsters and free NPCs. */
  monsterMaxHp?: number | null;
  monsterDamage?: number | null;
  monsterSpeed?: number | null;
  monsterXp?: number | null;
  monsterWeakness?: MonsterWeakness | null;
  monsterWeaknessPercent?: number | null;
  monsterSpecialTechnique?: MonsterSpecialTechnique | null;
  /** Missing means the species' natural basic attack. Never inferred from a page graphic. */
  monsterAttackProfile?: MonsterAttackProfile | null;
  /** Missing on legacy maps means the historical timed respawn. Non-monster events keep `null`. */
  monsterRespawnMode?: MonsterRespawnMode | null;
  /** Timed respawn delay in milliseconds. Ignored while permanent death is selected. */
  monsterRespawnDelayMs?: number | null;
  /** Relentless encounters ignore the ordinary visibility, aggro and leash rules. */
  monsterPursuitMode?: MonsterPursuitMode | null;
  /** Tiles per second squared; meaningful only for relentless pursuit. */
  monsterAcceleration?: number | null;
  /** Tiles per second; must be at least the monster's authored base speed. */
  monsterMaxSpeed?: number | null;
  /** A successful hit immediately kills the hero. */
  monsterOneHitKill?: boolean | null;
  /** Required only for `harvestable`; never derived from a page's graphic asset. */
  harvestProfile?: HarvestProfile;
  pages: readonly MapEventPage[];
}

/** The pixel centre of an event's one cell — where an entry/exit puts a hero, a monster spawns. */
export function eventCellCentre(event: { col: number; row: number }): { x: number; y: number } {
  return { x: event.col * TILE_SIZE + TILE_SIZE / 2, y: event.row * TILE_SIZE + TILE_SIZE / 2 };
}

/**
 * An authored cell's centre, on the GROUND PLANE in tile units with the grid centre as the origin
 * — the frame every converted runtime position lives in.
 *
 * `eventCellCentre` above and `eventCellFoot` below answer in the editor's PIXEL,
 * top-left-origin space and stay for the pixel path. This is their successor and, like
 * `authoredPatrolRadius`, it is a producer-side crossing: `gridSize` is the map's own `size`,
 * which is what turns a top-left cell index into a grid-centred coordinate.
 */
export function authoredCellCentreGround(
  event: { col: number; row: number; undergroundDepth?: number },
  gridSize: number,
): { x: number; y: number; z: number } {
  const half = gridSize / 2;
  return {
    x: event.col + 0.5 - half,
    y: event.undergroundDepth ? undergroundFloorHeight(event.undergroundDepth) : 0,
    z: event.row + 0.5 - half,
  };
}

/**
 * An authored `patrolRadius`, in the TILE UNITS every runtime consumer now reads.
 *
 * **The stored value stays PIXELS** and is bounded by `MIN_PATROL_RADIUS`/`MAX_PATROL_RADIUS` in
 * that space, exactly like authored monster speed and authored hero reach: narrowing the stored
 * bound would refuse every map already in the database and force a migration for a number nobody
 * asked to change. This function is therefore THE producer-side conversion — the single place an
 * authored leash crosses into the simulation's units — and it is what `authored-monster-system`,
 * `authored-guard-system` and `worldEvents` call. Do not divide a `patrolRadius` by `TILE_SIZE`
 * anywhere else; a radius divided at a use site is how half a conversion hides.
 */
export function authoredPatrolRadius(pixels: number): number {
  return pixels / TILE_SIZE;
}

/**
 * The visual foot of an event graphic, in PIXELS. Resource tools hit this point rather than the
 * cell centre: catalogue sprites are bottom-anchored, so the centre sits half a tile above the
 * visible trunk, ore or cache the player is actually facing.
 */
export function eventCellFoot(event: { col: number; row: number }): { x: number; y: number } {
  return { x: event.col * TILE_SIZE + TILE_SIZE / 2, y: (event.row + 1) * TILE_SIZE };
}

export function entryEvents(events: readonly MapEvent[]): MapEvent[] {
  return events.filter((event) => event.kind === "entry");
}

export function exitEvents(events: readonly MapEvent[]): MapEvent[] {
  return events.filter((event) => event.kind === "exit");
}

export function monsterEvents(events: readonly MapEvent[]): MapEvent[] {
  return events.filter((event) => event.kind === "monster");
}

/**
 * Can this KIND be turned hostile by a page?
 *
 * `npc` and `guard` only: they are the two that already carry combat-ready characteristics and a
 * patrol radius, which is everything the monster projection needs. A `monster` is already hostile
 * and an anchor or a harvest node has no body to fight with.
 */
export function canFight(kind: EventKind): boolean {
  return kind === "npc" || kind === "guard";
}

/**
 * Does this event fight, on the page currently active?
 *
 * The one question both projections ask, from opposite sides: the monster system includes an event
 * this is true of, and the guard/appearance systems exclude it, so a character has exactly one body
 * at a time rather than a peaceful sprite standing inside its own hostile copy.
 */
export function hostileOnPage(event: MapEvent, pageIndex: number): boolean {
  return canFight(event.kind) && event.pages[pageIndex]?.optHostile === true;
}

/** The map's permanent, untargetable special sea monsters. */
export function seaGuardianEvents(events: readonly MapEvent[]): MapEvent[] {
  return events.filter((event) => event.kind === "sea-guardian");
}

/** Authored allied combatants. Their active page, unlike a monster's, controls runtime presence. */
export function guardEvents(events: readonly MapEvent[]): MapEvent[] {
  return events.filter((event) => event.kind === "guard");
}

/** Free authored NPCs use event pages for appearance, dialogue and autonomous routines. */
export function npcEvents(events: readonly MapEvent[]): MapEvent[] {
  return events.filter((event) => event.kind === "npc");
}

export type HarvestableMapEvent = MapEvent & {
  kind: "harvestable";
  harvestProfile: HarvestProfile;
};

/** Explicitly configured resource nodes, narrowed for the future authoritative harvest system. */
export function harvestableEvents(events: readonly MapEvent[]): HarvestableMapEvent[] {
  return events.filter(
    (event): event is HarvestableMapEvent =>
      event.kind === "harvestable" && event.harvestProfile !== undefined,
  );
}

/** Scripted scenery, free NPCs and resources are projected into the active world-event view. */
export function isActiveWorldEventKind(kind: EventKind): boolean {
  return kind === "normal" || kind === "npc" || kind === "harvestable";
}

/** Event kinds whose action-triggered page can be run by an interacting hero. */
export function isInteractiveWorldEventKind(kind: EventKind): boolean {
  return kind === "normal" || kind === "npc" || kind === "guard";
}

/**
 * A fresh event page, matching the wireframe's `defPage`: no graphic, all conditions cleared,
 * movement Fixed at speed 4 / frequency 3, only Move-Anim on, and the Action trigger. Shared so the
 * editor, the default map and the marker->event migration all mint the identical default page —
 * there is one definition of "a blank page", not three.
 */
export function defaultEventPage(): MapEventPage {
  return {
    condSwitchId: null,
    condVariableId: null,
    condVariableMin: null,
    condSelfSwitch: null,
    graphicAssetId: null,
    graphicTint: EVENT_GRAPHIC_TINT_DEFAULT,
    moveType: "fixed",
    moveRoute: [],
    moveSpeed: 4,
    moveFreq: 3,
    optMoveAnim: true,
    optStopAnim: false,
    optDirFix: false,
    optThrough: false,
    optOnTop: false,
    trigger: "action",
    commands: [],
  };
}

/**
 * A functional event: one default page, conditions off. Monster kind carries
 * `species`+`patrolRadius`; guard kind carries `patrolRadius`; the anchors carry neither. The one
 * place the server, the default map and migrations build these, so they cannot drift from what
 * `parseMapEvents` accepts.
 */
interface FunctionalEventBase {
  id: string;
  col: number;
  row: number;
  ordinal: number;
  name?: string | undefined;
  species?: MonsterSpecies | undefined;
  patrolRadius?: number | undefined;
  monsterTuning?: Partial<MonsterTuning> | undefined;
  monsterRespawnMode?: MonsterRespawnMode | undefined;
  monsterRespawnDelayMs?: number | undefined;
  monsterPursuitMode?: MonsterPursuitMode | undefined;
  monsterAcceleration?: number | undefined;
  monsterMaxSpeed?: number | undefined;
  monsterOneHitKill?: boolean | undefined;
}

export type FunctionalEventParams = FunctionalEventBase &
  (
    | {
        kind: "harvestable";
        harvestProfile: HarvestProfile;
        graphicAssetId: EditorAssetId;
      }
    | {
        kind: Exclude<EventKind, "normal" | "harvestable">;
        harvestProfile?: never;
        graphicAssetId?: never;
      }
  );

export function functionalEvent(params: FunctionalEventParams): MapEvent {
  const isMonster = params.kind === "monster";
  const isNpc = params.kind === "npc";
  const hasTuning = isMonster || isNpc;
  const isGuard = params.kind === "guard";
  const isHarvestable = params.kind === "harvestable";
  const species = params.species ?? "spear_goblin";
  const tuning = {
    ...defaultMonsterTuning(species),
    ...params.monsterTuning,
  };
  return {
    id: params.id,
    col: params.col,
    row: params.row,
    name: params.name ?? "",
    ordinal: params.ordinal,
    kind: params.kind,
    species: isMonster ? species : null,
    patrolRadius:
      isMonster || isNpc
        ? (params.patrolRadius ?? null)
        : isGuard
          ? (params.patrolRadius ?? MIN_PATROL_RADIUS)
          : null,
    monsterRank: hasTuning ? tuning.rank : null,
    monsterMaxHp: hasTuning ? tuning.maxHp : null,
    monsterDamage: hasTuning ? tuning.damage : null,
    monsterSpeed: hasTuning ? tuning.speed : null,
    monsterXp: hasTuning ? tuning.xp : null,
    monsterWeakness: hasTuning ? tuning.weakness : null,
    monsterWeaknessPercent: hasTuning ? tuning.weaknessPercent : null,
    monsterSpecialTechnique: hasTuning ? tuning.specialTechnique : null,
    ...(isMonster
      ? {
          monsterRespawnMode: params.monsterRespawnMode ?? "timed",
          monsterRespawnDelayMs: params.monsterRespawnDelayMs ?? MONSTER_RESPAWN_MS,
          monsterPursuitMode: params.monsterPursuitMode ?? "standard",
          monsterAcceleration: params.monsterAcceleration ?? 0,
          monsterMaxSpeed: params.monsterMaxSpeed ?? tuning.speed,
          monsterOneHitKill: params.monsterOneHitKill ?? false,
        }
      : {}),
    ...(isHarvestable ? { harvestProfile: params.harvestProfile } : {}),
    pages: [
      {
        ...defaultEventPage(),
        ...(isHarvestable ? { graphicAssetId: params.graphicAssetId } : {}),
      },
    ],
  };
}

/** Trims and bounds an event name; `null` on anything that cannot be one. An empty name is legal
 *  — the ordinal chip is the event's real label, the name is decoration. */
export function validateEventName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length <= EVENT_NAME_MAX ? trimmed : null;
}

function boundedMonsterInteger(
  value: unknown,
  fallback: number,
  limits: { readonly min: number; readonly max: number },
): number | null {
  if (value === undefined || value === null) return fallback;
  if (!Number.isSafeInteger(value)) return null;
  const numeric = value as number;
  return numeric >= limits.min && numeric <= limits.max ? numeric : null;
}

/**
 * `monsterSpeed` alone is not an integer field any more: it is TILES per second, so the whole
 * bestiary's speeds (105/64, 88/64, ...) are fractions. Every other authored tuning value — hit
 * points, damage, experience, weakness percentage — is still a whole number and still parsed by
 * `boundedMonsterInteger`. A non-finite value is still refused; only the integer requirement is
 * dropped, and only here.
 */
function boundedMonsterSpeed(
  value: unknown,
  fallback: number,
  limits: { readonly min: number; readonly max: number },
): number | null {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < limits.min || value > limits.max) return null;
  // Rows predating tile units contain pixel speeds (for example 105). Modern values cannot exceed
  // the old ceiling divided by one tile, so only that legacy band is normalized here. The already
  // tile-scaled fallback and modern authored values pass through unchanged.
  const tileCeiling = limits.max / TILE_SIZE;
  return value > tileCeiling ? value / TILE_SIZE : value;
}

/** New runner ceilings were introduced after tile-unit storage and therefore have no pixel rows. */
function boundedModernMonsterSpeed(
  value: unknown,
  fallback: number,
  limits: { readonly min: number; readonly max: number },
): number | null {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value >= limits.min && value <= limits.max ? value : null;
}

function parseEventPage(raw: unknown): MapEventPage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const {
    condSwitchId,
    condVariableId,
    condVariableMin,
    condSelfSwitch,
    graphicAssetId,
    graphicTint,
    graphicElevation,
    moveType,
    moveRoute,
    moveSpeed,
    moveFreq,
    optMoveAnim,
    optStopAnim,
    optDirFix,
    optThrough,
    optOnTop,
    optFloat,
    optHostile,
    trigger,
    commands,
  } = record;

  if (
    condSwitchId !== null &&
    !(typeof condSwitchId === "string" && CONDITION_ID_PATTERN.test(condSwitchId))
  )
    return null;
  if (
    graphicElevation !== undefined &&
    (typeof graphicElevation !== "number" ||
      !Number.isFinite(graphicElevation) ||
      graphicElevation < EVENT_GRAPHIC_ELEVATION_LIMITS.min ||
      graphicElevation > EVENT_GRAPHIC_ELEVATION_LIMITS.max)
  )
    return null;
  if (
    condVariableId !== null &&
    !(typeof condVariableId === "string" && CONDITION_ID_PATTERN.test(condVariableId))
  )
    return null;
  if (condVariableMin !== null && !Number.isSafeInteger(condVariableMin)) return null;
  const variableMin = condVariableMin as number | null;
  if (variableMin !== null && variableMin < 0) return null;
  if ((condVariableId === null) !== (variableMin === null)) return null;
  if (condSelfSwitch !== null && !isSelfSwitch(condSelfSwitch)) return null;
  const retiredRunnerGraphic = graphicAssetId === RETIRED_RUNNER_HOUND_ASSET_ID;
  if (graphicAssetId !== null && !retiredRunnerGraphic && !isEditorAssetId(graphicAssetId)) {
    return null;
  }
  const parsedTint = graphicTint ?? EVENT_GRAPHIC_TINT_DEFAULT;
  if (
    !Number.isSafeInteger(parsedTint) ||
    (parsedTint as number) < 0 ||
    (parsedTint as number) > EVENT_GRAPHIC_TINT_DEFAULT
  )
    return null;
  if (!isMoveType(moveType)) return null;
  const parsedRoute = parseNpcRoutine(moveRoute);
  if (!parsedRoute) return null;
  if (!Number.isSafeInteger(moveSpeed)) return null;
  const speed = moveSpeed as number;
  if (speed < 0 || speed > MOVE_SPEED_MAX) return null;
  if (!Number.isSafeInteger(moveFreq)) return null;
  const freq = moveFreq as number;
  if (freq < 0 || freq > MOVE_FREQ_MAX) return null;
  if (
    typeof optMoveAnim !== "boolean" ||
    typeof optStopAnim !== "boolean" ||
    typeof optDirFix !== "boolean" ||
    typeof optThrough !== "boolean" ||
    typeof optOnTop !== "boolean" ||
    (optFloat !== undefined && typeof optFloat !== "boolean") ||
    (optHostile !== undefined && typeof optHostile !== "boolean")
  )
    return null;
  if (!isEventTrigger(trigger)) return null;
  // A page missing its `commands` (an old client that predates tranche 5) means the empty program;
  // anything present is parsed in full, and a malformed program fails the whole page — the parser
  // stays total. Per-kind command rules are enforced by `parseMapEvents`, which owns the kind; this
  // page-level parse is deliberately kind-agnostic.
  const parsedCommands = commands === undefined ? [] : parseEventCommands(commands);
  if (!parsedCommands) return null;

  return {
    commands: parsedCommands,
    condSwitchId: condSwitchId as string | null,
    condVariableId: condVariableId as string | null,
    condVariableMin: variableMin,
    condSelfSwitch: condSelfSwitch as SelfSwitch | null,
    graphicAssetId: retiredRunnerGraphic ? null : (graphicAssetId as EditorAssetId | null),
    graphicTint: parsedTint as number,
    ...(graphicElevation === undefined ? {} : { graphicElevation }),
    moveType,
    moveRoute: parsedRoute,
    moveSpeed: speed,
    moveFreq: freq,
    optMoveAnim,
    optStopAnim,
    optDirFix,
    optThrough,
    optOnTop,
    ...(optFloat === undefined ? {} : { optFloat }),
    // Absent stays absent: every page authored before this is peaceful, and writing `false` into
    // all of them would rewrite maps that never changed.
    ...(optHostile === undefined ? {} : { optHostile }),
    trigger,
  };
}

function parseEventPages(value: unknown): MapEventPage[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PAGES_PER_EVENT)
    return null;
  const pages: MapEventPage[] = [];
  for (const raw of value) {
    const page = parseEventPage(raw);
    if (!page) return null;
    pages.push(page);
  }
  return pages;
}

/**
 * Events off the wire, checked like the untrusted data they are — the shape of `parseMapMarkers`
 * in `map-data.ts`, applied to a richer record.
 *
 * Bounds ARE checked here (unlike `parseMapElements`): one event owns exactly one cell, that cell
 * is unique within its authored storey, and an out-of-bounds or colliding event is not a
 * value the editor or server should ever accept, so there is no reason to defer the check to a
 * caller the way collision-free scenery placement does.
 */
export function parseMapEvents(value: unknown, cols: number, rows: number): MapEvent[] | null {
  if (!Array.isArray(value) || value.length > MAX_EVENTS_PER_MAP) return null;
  const seenCells = new Set<string>();
  const seenIds = new Set<string>();
  const events: MapEvent[] = [];
  let runtimeEvents = 0;
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) return null;
    const record = raw as Record<string, unknown>;
    const { id, col, row, name, ordinal, pages } = record;

    if (!isUuid(id) || seenIds.has(id)) return null;
    if (!Number.isSafeInteger(col) || !Number.isSafeInteger(row)) return null;
    const c = col as number;
    const r = row as number;
    if (c < 0 || c >= cols || r < 0 || r >= rows) return null;
    const undergroundDepth = record.undergroundDepth;
    if (undergroundDepth !== undefined && !validVerticalDepth(undergroundDepth)) return null;
    const cellDepth = undergroundDepth === undefined ? 0 : (undergroundDepth as number);
    const cellKey = `${cellDepth}:${c}:${r}`;
    if (seenCells.has(cellKey)) return null;

    const parsedName = validateEventName(name);
    if (parsedName === null) return null;
    if (!Number.isSafeInteger(ordinal) || (ordinal as number) < 0) return null;
    const linkedEventId = record.linkedEventId;
    if (linkedEventId !== undefined && !isUuid(linkedEventId)) return null;
    const showMarker = record.showMarker;
    if (showMarker !== undefined && typeof showMarker !== "boolean") return null;

    // A stored spawn event is dropped, not rejected — see `RETIRED_SPAWN_KIND`'s docblock. This
    // must run before the `isEventKind` check below, which would otherwise reject the whole list.
    if (record.kind === RETIRED_SPAWN_KIND) continue;

    // `kind` is a validated enum; an old client that predates typed events omits it and means
    // `normal`. Everything below keeps `parseMapEvents` total — a bad kind, a monster without a
    // species, or a functional anchor carrying pages it may not have is rejected outright.
    const kind = record.kind === undefined ? "normal" : record.kind;
    if (!isEventKind(kind)) return null;
    if (isRuntimeEventKind(kind)) {
      runtimeEvents += 1;
      if (runtimeEvents > MAX_RUNTIME_EVENTS_PER_MAP) return null;
    }
    // Monster events carry `species` + tuning + radius. Free NPCs reuse the persisted HP/power
    // tuning columns without a species, and guards carry only a radius. Validate all of it here so
    // no untrusted half-event can cross the wire boundary.
    let species: MonsterSpecies | null = null;
    let patrolRadius: number | null = null;
    let monsterRank: MonsterRank | null = null;
    let monsterMaxHp: number | null = null;
    let monsterDamage: number | null = null;
    let monsterSpeed: number | null = null;
    let monsterXp: number | null = null;
    let monsterWeakness: MonsterWeakness | null = null;
    let monsterWeaknessPercent: number | null = null;
    let monsterSpecialTechnique: MonsterSpecialTechnique | null = null;
    let monsterAttackProfile: MonsterAttackProfile | undefined;
    let monsterRespawnMode: MonsterRespawnMode | undefined;
    let monsterRespawnDelayMs: number | undefined;
    let monsterPursuitMode: MonsterPursuitMode | undefined;
    let monsterAcceleration: number | undefined;
    let monsterMaxSpeed: number | undefined;
    let monsterOneHitKill: boolean | undefined;
    let harvestProfile: HarvestProfile | undefined;
    let legacyHarvestProfile = false;
    let legacyHarvestDurationMs: number | null = null;
    if (kind === "harvestable") {
      legacyHarvestProfile =
        typeof record.harvestProfile === "object" &&
        record.harvestProfile !== null &&
        !Array.isArray(record.harvestProfile) &&
        !Object.hasOwn(record.harvestProfile, "collision");
      const parsedProfile = parseHarvestProfile(record.harvestProfile);
      // Only the event anchor is map-bounded. A resource collider may overhang an edge just like
      // authored scenery; the runtime's bounded terrain remains the authoritative world fence.
      if (!parsedProfile) return null;
      harvestProfile = parsedProfile;
      if (legacyHarvestProfile) {
        const rawDuration = (record.harvestProfile as Record<string, unknown>).harvestDurationMs;
        legacyHarvestDurationMs = Number.isSafeInteger(rawDuration)
          ? (rawDuration as number)
          : null;
      }
    } else if (record.harvestProfile !== undefined && record.harvestProfile !== null) {
      return null;
    }
    if (kind === "monster" || kind === "npc") {
      const isMonster = kind === "monster";
      if (isMonster) {
        if (!isMonsterSpecies(record.species)) return null;
        species = record.species;
      } else if (record.species !== undefined && record.species !== null) {
        return null;
      }
      if (!Number.isSafeInteger(record.patrolRadius)) return null;
      const radius = record.patrolRadius as number;
      if (radius < MIN_PATROL_RADIUS || radius > MAX_PATROL_RADIUS) return null;
      patrolRadius = radius;
      const defaults = defaultMonsterTuning(species ?? "spear_goblin");
      const rank = record.monsterRank ?? defaults.rank;
      const weakness = record.monsterWeakness ?? defaults.weakness;
      const specialTechnique = record.monsterSpecialTechnique ?? defaults.specialTechnique;
      const attackProfile = record.monsterAttackProfile ?? null;
      const respawnMode = record.monsterRespawnMode;
      const respawnDelayMs = record.monsterRespawnDelayMs ?? MONSTER_RESPAWN_MS;
      const pursuitMode = record.monsterPursuitMode ?? "standard";
      const acceleration = record.monsterAcceleration ?? 0;
      const oneHitKill = record.monsterOneHitKill ?? false;
      if (
        !isMonsterRank(rank) ||
        !isMonsterWeakness(weakness) ||
        !isMonsterSpecialTechnique(specialTechnique) ||
        (isMonster
          ? attackProfile !== null && !isMonsterAttackProfile(attackProfile)
          : attackProfile !== null) ||
        !isMonsterSpecialTechniqueForSpecies(species ?? "spear_goblin", specialTechnique) ||
        (isMonster
          ? respawnMode !== undefined && !isMonsterRespawnMode(respawnMode)
          : (respawnMode !== undefined && respawnMode !== null) ||
            (record.monsterRespawnDelayMs !== undefined && record.monsterRespawnDelayMs !== null) ||
            (record.monsterPursuitMode !== undefined && record.monsterPursuitMode !== null) ||
            (record.monsterAcceleration !== undefined && record.monsterAcceleration !== null) ||
            (record.monsterMaxSpeed !== undefined && record.monsterMaxSpeed !== null) ||
            (record.monsterOneHitKill !== undefined && record.monsterOneHitKill !== null)) ||
        !Number.isSafeInteger(respawnDelayMs) ||
        (respawnDelayMs as number) < MONSTER_RESPAWN_DELAY_LIMITS.min ||
        (respawnDelayMs as number) > MONSTER_RESPAWN_DELAY_LIMITS.max ||
        (isMonster ? !isMonsterPursuitMode(pursuitMode) : pursuitMode !== "standard") ||
        typeof acceleration !== "number" ||
        !Number.isFinite(acceleration) ||
        (acceleration as number) < MONSTER_ACCELERATION_LIMITS.min ||
        (acceleration as number) > MONSTER_ACCELERATION_LIMITS.max ||
        typeof oneHitKill !== "boolean"
      )
        return null;
      monsterRank = rank;
      monsterWeakness = weakness;
      monsterSpecialTechnique = specialTechnique;
      if (isMonster && attackProfile !== null)
        monsterAttackProfile = attackProfile as MonsterAttackProfile;
      if (isMonster) {
        monsterRespawnMode = respawnMode as MonsterRespawnMode | undefined;
        monsterRespawnDelayMs = respawnDelayMs as number;
      }
      monsterMaxHp = boundedMonsterInteger(
        record.monsterMaxHp,
        defaults.maxHp,
        MONSTER_TUNING_LIMITS.maxHp,
      );
      monsterDamage = boundedMonsterInteger(
        record.monsterDamage,
        defaults.damage,
        MONSTER_TUNING_LIMITS.damage,
      );
      monsterSpeed = boundedMonsterSpeed(
        record.monsterSpeed,
        defaults.speed,
        MONSTER_TUNING_LIMITS.speed,
      );
      const maxSpeed = boundedModernMonsterSpeed(
        record.monsterMaxSpeed,
        monsterSpeed ?? defaults.speed,
        MONSTER_TUNING_LIMITS.speed,
      );
      monsterXp = boundedMonsterInteger(record.monsterXp, defaults.xp, MONSTER_TUNING_LIMITS.xp);
      monsterWeaknessPercent = boundedMonsterInteger(
        record.monsterWeaknessPercent,
        defaults.weaknessPercent,
        MONSTER_TUNING_LIMITS.weaknessPercent,
      );
      if (
        monsterMaxHp === null ||
        monsterDamage === null ||
        monsterSpeed === null ||
        maxSpeed === null ||
        maxSpeed < monsterSpeed ||
        monsterXp === null ||
        monsterWeaknessPercent === null
      )
        return null;
      if (isMonster) {
        if (record.monsterPursuitMode !== undefined && record.monsterPursuitMode !== null)
          monsterPursuitMode = pursuitMode as MonsterPursuitMode;
        if (record.monsterAcceleration !== undefined && record.monsterAcceleration !== null)
          monsterAcceleration = acceleration as number;
        if (record.monsterMaxSpeed !== undefined && record.monsterMaxSpeed !== null)
          monsterMaxSpeed = maxSpeed;
        if (record.monsterOneHitKill !== undefined && record.monsterOneHitKill !== null)
          monsterOneHitKill = oneHitKill;
      }
    } else if (kind === "guard") {
      if (!Number.isSafeInteger(record.patrolRadius)) return null;
      const radius = record.patrolRadius as number;
      if (radius < MIN_PATROL_RADIUS || radius > MAX_PATROL_RADIUS) return null;
      patrolRadius = radius;
      if (
        (record.species !== undefined && record.species !== null) ||
        (record.monsterRank !== undefined && record.monsterRank !== null) ||
        (record.monsterMaxHp !== undefined && record.monsterMaxHp !== null) ||
        (record.monsterDamage !== undefined && record.monsterDamage !== null) ||
        (record.monsterSpeed !== undefined && record.monsterSpeed !== null) ||
        (record.monsterXp !== undefined && record.monsterXp !== null) ||
        (record.monsterWeakness !== undefined && record.monsterWeakness !== null) ||
        (record.monsterWeaknessPercent !== undefined && record.monsterWeaknessPercent !== null) ||
        (record.monsterSpecialTechnique !== undefined && record.monsterSpecialTechnique !== null) ||
        (record.monsterAttackProfile !== undefined && record.monsterAttackProfile !== null) ||
        (record.monsterRespawnMode !== undefined && record.monsterRespawnMode !== null) ||
        (record.monsterRespawnDelayMs !== undefined && record.monsterRespawnDelayMs !== null) ||
        (record.monsterPursuitMode !== undefined && record.monsterPursuitMode !== null) ||
        (record.monsterAcceleration !== undefined && record.monsterAcceleration !== null) ||
        (record.monsterMaxSpeed !== undefined && record.monsterMaxSpeed !== null) ||
        (record.monsterOneHitKill !== undefined && record.monsterOneHitKill !== null)
      ) {
        return null;
      }
    } else if (
      (record.species !== undefined && record.species !== null) ||
      (record.patrolRadius !== undefined && record.patrolRadius !== null) ||
      (record.monsterRank !== undefined && record.monsterRank !== null) ||
      (record.monsterMaxHp !== undefined && record.monsterMaxHp !== null) ||
      (record.monsterDamage !== undefined && record.monsterDamage !== null) ||
      (record.monsterSpeed !== undefined && record.monsterSpeed !== null) ||
      (record.monsterXp !== undefined && record.monsterXp !== null) ||
      (record.monsterWeakness !== undefined && record.monsterWeakness !== null) ||
      (record.monsterWeaknessPercent !== undefined && record.monsterWeaknessPercent !== null) ||
      (record.monsterSpecialTechnique !== undefined && record.monsterSpecialTechnique !== null) ||
      (record.monsterAttackProfile !== undefined && record.monsterAttackProfile !== null) ||
      (record.monsterRespawnMode !== undefined && record.monsterRespawnMode !== null) ||
      (record.monsterRespawnDelayMs !== undefined && record.monsterRespawnDelayMs !== null) ||
      (record.monsterPursuitMode !== undefined && record.monsterPursuitMode !== null) ||
      (record.monsterAcceleration !== undefined && record.monsterAcceleration !== null) ||
      (record.monsterMaxSpeed !== undefined && record.monsterMaxSpeed !== null) ||
      (record.monsterOneHitKill !== undefined && record.monsterOneHitKill !== null)
    ) {
      return null;
    }

    const parsedPages = parseEventPages(pages);
    if (!parsedPages) return null;
    const normalizedPages =
      kind === "harvestable" && harvestProfile
        ? parsedPages.map((page) => ({
            ...page,
            graphicAssetId: migrateLegacyHarvestGraphicAsset(
              harvestProfile,
              page.graphicAssetId,
              legacyHarvestProfile,
              legacyHarvestDurationMs,
            ),
          }))
        : parsedPages;
    // Anchors have exactly one page. NPCs, monsters and guards keep multiple conditional pages so
    // party-state decisions can select their presence or routine.
    if (
      kind !== "normal" &&
      kind !== "npc" &&
      kind !== "monster" &&
      kind !== "guard" &&
      kind !== "harvestable" &&
      normalizedPages.length !== 1
    )
      return null;
    // Nothing over the wire may smuggle scripted behaviour onto an entry/exit anchor.
    if (
      (kind === "entry" || kind === "exit") &&
      normalizedPages.some((page) => page.commands.length > 0)
    ) {
      return null;
    }
    // This special event is only an authoritative water anchor. Its appearance, movement and
    // lethality belong to the dedicated sea-guardian system, so reject generic page settings that
    // would look configurable while being ignored at runtime.
    if (
      kind === "sea-guardian" &&
      normalizedPages.some(
        (page) =>
          page.condSwitchId !== null ||
          page.condVariableId !== null ||
          page.condVariableMin !== null ||
          page.condSelfSwitch !== null ||
          page.graphicAssetId !== null ||
          page.graphicTint !== EVENT_GRAPHIC_TINT_DEFAULT ||
          page.moveType !== "fixed" ||
          (page.moveRoute?.length ?? 0) > 0 ||
          page.moveSpeed !== 4 ||
          page.moveFreq !== 3 ||
          !page.optMoveAnim ||
          page.optStopAnim ||
          page.optDirFix ||
          page.optThrough ||
          page.optOnTop ||
          page.trigger !== "action" ||
          page.commands.length > 0,
      )
    ) {
      return null;
    }
    // A guard page selects presence, its native catalogue appearance and may carry an
    // action-triggered dialogue program. Movement and trigger selection remain owned by the guard
    // simulation, so reject other ignored fields instead of persisting misleading authoring.
    if (
      kind === "guard" &&
      normalizedPages.some(
        (page) =>
          page.condSelfSwitch !== null ||
          (page.graphicAssetId !== null && !isGuardAppearanceAssetId(page.graphicAssetId)) ||
          page.moveType !== "fixed" ||
          (page.moveRoute?.length ?? 0) > 0 ||
          page.moveSpeed !== 4 ||
          page.moveFreq !== 3 ||
          !page.optMoveAnim ||
          page.optStopAnim ||
          page.optDirFix ||
          page.optThrough ||
          page.optOnTop ||
          page.trigger !== "action",
      )
    ) {
      return null;
    }
    // Resource pages may be conditional so their appearance can follow shared party state, but a
    // resource is stationary and never enters the NPC movement system. Reject ignored movement
    // authoring instead of persisting a configuration that looks meaningful in the editor.
    if (
      kind === "harvestable" &&
      normalizedPages.some(
        (page) =>
          page.graphicAssetId === null ||
          page.moveType !== "fixed" ||
          (page.moveRoute?.length ?? 0) > 0 ||
          page.optThrough,
      )
    ) {
      return null;
    }
    seenCells.add(cellKey);
    seenIds.add(id);
    events.push({
      id,
      col: c,
      row: r,
      ...(undergroundDepth === undefined ? {} : { undergroundDepth: undergroundDepth as number }),
      name: parsedName,
      ordinal: ordinal as number,
      ...(linkedEventId === undefined ? {} : { linkedEventId }),
      ...(showMarker === undefined ? {} : { showMarker }),
      kind,
      species,
      patrolRadius,
      monsterRank,
      monsterMaxHp,
      monsterDamage,
      monsterSpeed,
      monsterXp,
      monsterWeakness,
      monsterWeaknessPercent,
      monsterSpecialTechnique,
      ...(monsterAttackProfile === undefined ? {} : { monsterAttackProfile }),
      ...(monsterRespawnMode === undefined ? {} : { monsterRespawnMode }),
      ...(monsterRespawnDelayMs === undefined ? {} : { monsterRespawnDelayMs }),
      ...(monsterPursuitMode === undefined ? {} : { monsterPursuitMode }),
      ...(monsterAcceleration === undefined ? {} : { monsterAcceleration }),
      ...(monsterMaxSpeed === undefined ? {} : { monsterMaxSpeed }),
      ...(monsterOneHitKill === undefined ? {} : { monsterOneHitKill }),
      ...(harvestProfile === undefined ? {} : { harvestProfile }),
      pages: normalizedPages,
    });
  }
  const byId = new Map(events.map((event) => [event.id, event]));
  for (const event of events) {
    if (event.linkedEventId === undefined) continue;
    const partner = byId.get(event.linkedEventId);
    if (
      partner === undefined ||
      partner.id === event.id ||
      partner.kind !== "normal" ||
      event.kind !== "normal" ||
      partner.linkedEventId !== event.id
    ) {
      return null;
    }
  }
  return events;
}
