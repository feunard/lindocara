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
 * An event id is a server-minted uuid, stable across edits — the same policy as maps and
 * adventures, and unlike the author-chosen slug policy `map-data.ts` markers use. Tranche 5's
 * commands will reference events, so a rename must never break a reference. `ordinal` is the
 * wireframe's friendly `EV001` display order; it is display only, never identity, and this parser
 * only checks its shape, never its uniqueness.
 */
import { isUuid } from "./identifiers.js";
import { type EditorAssetId, isEditorAssetId } from "./tiny-swords-catalog.js";

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
 * A switch or variable id, as this tranche has them: free 4-digit ordinals the author types by
 * hand (the wireframe's `0001`), because the switch/variable REGISTRY that would give them
 * meaning is tranche 4's deliverable. This checks only that an id is shaped like one of those
 * ordinals, never that it names anything real — there is nothing real yet to check against.
 */
const CONDITION_ID_PATTERN = /^\d{4}$/;

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
  /** Server-minted, stable across edits. See the file header before treating this as
   *  author-choosable the way marker ids are. */
  id: string;
  col: number;
  row: number;
  name: string;
  /** Creation order, per map. Display only (the wireframe's `EV{ordinal}`); never identity. */
  ordinal: number;
  pages: readonly MapEventPage[];
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

    const parsedPages = parseEventPages(pages);
    if (!parsedPages) return null;

    seenCells.add(cellKey);
    seenIds.add(id);
    events.push({
      id,
      col: c,
      row: r,
      name: parsedName,
      ordinal: ordinal as number,
      pages: parsedPages,
    });
  }
  return events;
}
