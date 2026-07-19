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
import { isMonsterSpecies, type MonsterSpecies } from "./game.js";
import { isUuid } from "./identifiers.js";
import { MAX_PATROL_RADIUS, MIN_PATROL_RADIUS } from "./map-data.js";
import { TILE_SIZE } from "./tilemap.js";
import { type EditorAssetId, isEditorAssetId } from "./tiny-swords-catalog.js";

/**
 * UX wave #12: markers die, their meaning becomes a typed event. A `normal` event is the wireframe
 * event from tranche 3 (pages, conditions, appearance); the other three kinds are the old functional
 * markers reborn as addressable, uuid-identified events:
 *
 * - `entry`  — a spawn/arrival anchor the adventure graph binds by the EVENT's uuid.
 * - `exit`   — a departure anchor the graph binds by the EVENT's uuid.
 * - `monster` — a monster spawn: `species` + `patrolRadius` ride the event, nothing else.
 *
 * Entry/exit/monster events are single-page and conditions-disabled this tranche (see
 * `parseMapEvents`): they are anchors, not scripted behaviour, so the pages/conditions machinery
 * is hidden in the editor and refused by the parser. `docs/superpowers/plans/2026-07-19-ux-wave.md`
 * Task 5 is the record of that choice.
 */
export const EVENT_KINDS = ["normal", "entry", "exit", "monster"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export function isEventKind(value: unknown): value is EventKind {
  return typeof value === "string" && (EVENT_KINDS as readonly string[]).includes(value);
}

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

export const SELF_SWITCHES = ["A", "B", "C", "D"] as const;
export type SelfSwitch = (typeof SELF_SWITCHES)[number];

/** The most events one map may carry, and the most pages one event may carry — matching the
 *  wireframe's own scale. Both feed `MAX_MAP_JSON_BYTES`'s worst-case derivation
 *  (`server/index.ts`); raise either only alongside that comment. */
export const MAX_EVENTS_PER_MAP = 64;
export const MAX_PAGES_PER_EVENT = 8;
export const EVENT_NAME_MAX = 32;

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
  moveType: MoveType;
  /** 0-5, the wireframe's move-speed select. */
  moveSpeed: number;
  /** 0-4, the wireframe's move-frequency select. */
  moveFreq: number;
  optMoveAnim: boolean;
  optStopAnim: boolean;
  optDirFix: boolean;
  optThrough: boolean;
  optOnTop: boolean;
  trigger: EventTrigger;
}

export interface MapEvent {
  /** Client-minted, stable across edits. This uuid is what the adventure graph binds for entry/exit
   *  kinds — a rename must never break a reference. */
  id: string;
  col: number;
  row: number;
  /** For entry/exit kinds this doubles as the marker label (optional, decorative). */
  name: string;
  /** Creation order, per map. Display only (the wireframe's `EV{ordinal}`); never identity. */
  ordinal: number;
  /** UX wave #12. `normal` is the scripted event; entry/exit/monster are the reborn markers. */
  kind: EventKind;
  /** Set (and validated) iff `kind === "monster"`; `null` for every other kind. */
  species: MonsterSpecies | null;
  /** Set (in `[MIN_PATROL_RADIUS, MAX_PATROL_RADIUS]`) iff `kind === "monster"`; else `null`. */
  patrolRadius: number | null;
  pages: readonly MapEventPage[];
}

/** The pixel centre of an event's one cell — where an entry/exit puts a hero, a monster spawns. */
export function eventCellCentre(event: { col: number; row: number }): { x: number; y: number } {
  return { x: event.col * TILE_SIZE + TILE_SIZE / 2, y: event.row * TILE_SIZE + TILE_SIZE / 2 };
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
    moveType: "fixed",
    moveSpeed: 4,
    moveFreq: 3,
    optMoveAnim: true,
    optStopAnim: false,
    optDirFix: false,
    optThrough: false,
    optOnTop: false,
    trigger: "action",
  };
}

/**
 * A functional (entry/exit/monster) event: one default page, conditions off. Monster kind carries
 * `species`+`patrolRadius`; the others carry neither. The one place the server, the default map and
 * the migration build these, so they cannot drift from what `parseMapEvents` accepts.
 */
export function functionalEvent(params: {
  id: string;
  col: number;
  row: number;
  ordinal: number;
  kind: Exclude<EventKind, "normal">;
  name?: string | undefined;
  species?: MonsterSpecies | undefined;
  patrolRadius?: number | undefined;
}): MapEvent {
  const isMonster = params.kind === "monster";
  return {
    id: params.id,
    col: params.col,
    row: params.row,
    name: params.name ?? "",
    ordinal: params.ordinal,
    kind: params.kind,
    species: isMonster ? (params.species ?? null) : null,
    patrolRadius: isMonster ? (params.patrolRadius ?? null) : null,
    pages: [defaultEventPage()],
  };
}

/** Trims and bounds an event name; `null` on anything that cannot be one. An empty name is legal
 *  — the ordinal chip is the event's real label, the name is decoration. */
export function validateEventName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length <= EVENT_NAME_MAX ? trimmed : null;
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
    moveType,
    moveSpeed,
    moveFreq,
    optMoveAnim,
    optStopAnim,
    optDirFix,
    optThrough,
    optOnTop,
    trigger,
  } = record;

  if (
    condSwitchId !== null &&
    !(typeof condSwitchId === "string" && CONDITION_ID_PATTERN.test(condSwitchId))
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
  if (graphicAssetId !== null && !isEditorAssetId(graphicAssetId)) return null;
  if (!isMoveType(moveType)) return null;
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
    typeof optOnTop !== "boolean"
  )
    return null;
  if (!isEventTrigger(trigger)) return null;

  return {
    condSwitchId: condSwitchId as string | null,
    condVariableId: condVariableId as string | null,
    condVariableMin: variableMin,
    condSelfSwitch: condSelfSwitch as SelfSwitch | null,
    graphicAssetId: graphicAssetId as EditorAssetId | null,
    moveType,
    moveSpeed: speed,
    moveFreq: freq,
    optMoveAnim,
    optStopAnim,
    optDirFix,
    optThrough,
    optOnTop,
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
 * is a unique key `map_event` enforces in D1, and an out-of-bounds or colliding event is not a
 * value the editor or server should ever accept, so there is no reason to defer the check to a
 * caller the way collision-free scenery placement does.
 */
export function parseMapEvents(value: unknown, cols: number, rows: number): MapEvent[] | null {
  if (!Array.isArray(value) || value.length > MAX_EVENTS_PER_MAP) return null;
  const seenCells = new Set<string>();
  const seenIds = new Set<string>();
  const events: MapEvent[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) return null;
    const record = raw as Record<string, unknown>;
    const { id, col, row, name, ordinal, pages } = record;

    if (!isUuid(id) || seenIds.has(id)) return null;
    if (!Number.isSafeInteger(col) || !Number.isSafeInteger(row)) return null;
    const c = col as number;
    const r = row as number;
    if (c < 0 || c >= cols || r < 0 || r >= rows) return null;
    const cellKey = `${c}:${r}`;
    if (seenCells.has(cellKey)) return null;

    const parsedName = validateEventName(name);
    if (parsedName === null) return null;
    if (!Number.isSafeInteger(ordinal) || (ordinal as number) < 0) return null;

    // `kind` is a validated enum; an old client that predates typed events omits it and means
    // `normal`. Everything below keeps `parseMapEvents` total — a bad kind, a monster without a
    // species, or a functional anchor carrying pages it may not have is rejected outright.
    const kind = record.kind === undefined ? "normal" : record.kind;
    if (!isEventKind(kind)) return null;

    // Monster events carry `species` + `patrolRadius`; every other kind must carry neither. A
    // discriminated pair, checked here rather than deferred, so no unvalidated data slips past.
    let species: MonsterSpecies | null = null;
    let patrolRadius: number | null = null;
    if (kind === "monster") {
      if (!isMonsterSpecies(record.species)) return null;
      species = record.species;
      if (!Number.isSafeInteger(record.patrolRadius)) return null;
      const radius = record.patrolRadius as number;
      if (radius < MIN_PATROL_RADIUS || radius > MAX_PATROL_RADIUS) return null;
      patrolRadius = radius;
    } else if (
      (record.species !== undefined && record.species !== null) ||
      (record.patrolRadius !== undefined && record.patrolRadius !== null)
    ) {
      return null;
    }

    const parsedPages = parseEventPages(pages);
    if (!parsedPages) return null;
    // Entry/exit/monster are anchors, not scripts: exactly one page, conditions-disabled. The
    // single page is a default page the editor never surfaces; refusing extra pages here keeps the
    // "hidden in the UI" promise from being bypassed over the wire.
    if (kind !== "normal" && parsedPages.length !== 1) return null;

    seenCells.add(cellKey);
    seenIds.add(id);
    events.push({
      id,
      col: c,
      row: r,
      name: parsedName,
      ordinal: ordinal as number,
      kind,
      species,
      patrolRadius,
      pages: parsedPages,
    });
  }
  return events;
}
