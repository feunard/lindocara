/**
 * Party-owned adventure state — switches, variables, self-switches — and the rule that turns it
 * into which page of a `MapEvent` is currently showing.
 *
 * This module has three readers across two tranches. This tranche (t4): `World`, in the room,
 * calls `activePageIndex` against a read-only snapshot `GameSession` pushes down, to decide which
 * page's appearance goes on the wire. `test/adventure-state.test.ts` calls the exact same
 * function to pin page precedence and the unknown-id defaults — there is no second copy of the
 * rule to drift, the same argument `shared/simulation.ts` makes for `step()`. Tranche 5's
 * interpreter is the fourth reader and the first WRITER: it will read this same state to decide
 * what a command sees, then mutate the state this file only parses and evaluates today. Nothing
 * here executes a command or writes anything — that split mirrors `map-events.ts`'s shape/evaluator
 * boundary, one tranche later.
 *
 * The registry (id -> name, for switches and variables) rides the adventure row; a party's live
 * state is a separate thing entirely, loaded/held/saved by the coordinator
 * (`docs/superpowers/specs/2026-07-19-adventure-state-design.md`, Decisions 1-3). Both are parsed
 * here with the same totality discipline as `map-events.ts`: untrusted input in, a valid value or
 * `null` out, never a throw.
 */
import { isUuid } from "./identifiers.js";
import {
  CONDITION_ID_PATTERN,
  isSelfSwitch,
  type MapEvent,
  type MapEventPage,
  type SelfSwitch,
} from "./map-events.js";
import {
  type AuthoredQuestDefinition,
  MAX_AUTHORED_QUESTS,
  MAX_QUEST_OBJECTIVES,
  MAX_QUEST_PROCESSED_EVENT_KEYS,
  parseAuthoredQuestDefinition,
  parseAuthoredQuests,
  QUEST_OBJECTIVE_TARGET_MAX,
  QUEST_PROCESSED_EVENT_KEY_MAX,
  type QuestProgressStatus,
  requiredQuestObjectivesComplete,
} from "./quests.js";

export * from "./quests.js";

/**
 * The registry's id shape is the SAME shape `map-events.ts` checks a page's condition ids
 * against — imported from there rather than kept as a second copy, now that the registry this
 * pattern was always meant to validate against actually exists.
 */
const REGISTRY_ID_PATTERN = CONDITION_ID_PATTERN;

/** Mint order, not display order — unlike `MapEvent.ordinal`, a registry id IS identity: pages
 *  reference it by string, so once minted it never changes shape or gets reused. */
export interface RegistryEntry {
  id: string;
  name: string;
}

export const REGISTRY_ENTRY_NAME_MAX = 32;

/** The most switches, and the most variables, one adventure's registry may hold. Small and
 *  bounded on purpose: the registry rides the adventure row as JSON (Decision 1), not a table. */
export const MAX_REGISTRY_SWITCHES = 200;
export const MAX_REGISTRY_VARIABLES = 200;

export interface AdventureRegistry {
  switches: readonly RegistryEntry[];
  variables: readonly RegistryEntry[];
  /** Optional on old API payloads; parsers normalize it to an empty list. */
  quests?: readonly AuthoredQuestDefinition[];
}

export const EMPTY_REGISTRY: AdventureRegistry = { switches: [], variables: [] };

/** The largest 4-digit ordinal an id can name. Well above `MAX_REGISTRY_SWITCHES`/`VARIABLES`
 *  (200), so a registry within its size cap can never exhaust the id space. */
const MAX_REGISTRY_ORDINAL = 9999;

/**
 * The next id for a new entry: one past the highest ordinal already in the list, zero-padded to the
 * 4-digit wire shape. MONOTONE, not gap-filling — deleting id `0002` from `{0001,0002,0003}` mints
 * `0004`, never reuses `0002`, because a registry id is identity: an event page references it by
 * string, so a reused id would silently redirect an orphaned condition onto a brand-new entry.
 * Returns `null` when the highest ordinal is already `9999` (no monotone id is left); callers gate
 * the add affordance on that and on the per-list size cap.
 */
export function mintRegistryId(entries: readonly { id: string }[]): string | null {
  let highest = 0;
  for (const entry of entries) {
    const ordinal = Number.parseInt(entry.id, 10);
    if (Number.isInteger(ordinal) && ordinal > highest) highest = ordinal;
  }
  const next = highest + 1;
  if (next > MAX_REGISTRY_ORDINAL) return null;
  return String(next).padStart(4, "0");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Trims and bounds a registry entry's name — the `validateEventName` idiom, applied here. An
 *  empty name is legal for the same reason it is on an event: the id chip is the real label. */
function validateRegistryEntryName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length <= REGISTRY_ENTRY_NAME_MAX ? trimmed : null;
}

function parseRegistryEntry(raw: unknown): RegistryEntry | null {
  if (!isPlainObject(raw)) return null;
  const { id, name } = raw;
  if (typeof id !== "string" || !REGISTRY_ID_PATTERN.test(id)) return null;
  const parsedName = validateRegistryEntryName(name);
  if (parsedName === null) return null;
  return { id, name: parsedName };
}

/** Duplicate ids are rejected within THIS list only — a switch and a variable are separate
 *  namespaces (each keyed into its own `Record` in `PartyAdventureState`), so id "0001" naming
 *  both a switch and a variable is not a collision. */
function parseRegistryList(value: unknown, max: number): RegistryEntry[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const seenIds = new Set<string>();
  const entries: RegistryEntry[] = [];
  for (const raw of value) {
    const entry = parseRegistryEntry(raw);
    if (!entry) return null;
    if (seenIds.has(entry.id)) return null;
    seenIds.add(entry.id);
    entries.push(entry);
  }
  return entries;
}

export function parseAdventureRegistry(value: unknown): AdventureRegistry | null {
  if (!isPlainObject(value)) return null;
  const switches = parseRegistryList(value.switches, MAX_REGISTRY_SWITCHES);
  if (!switches) return null;
  const variables = parseRegistryList(value.variables, MAX_REGISTRY_VARIABLES);
  if (!variables) return null;
  const quests = parseAuthoredQuests(value.quests);
  if (!quests) return null;
  return { switches, variables, ...(quests.length > 0 ? { quests } : {}) };
}

/**
 * A party's live save data for this tranche: which switches are on, what each variable holds, and
 * which per-event self-switch letters are set. Self-switches are keyed `${eventId}:${letter}` —
 * the same event id `map-events.ts` mints (a uuid), paired with one of `SELF_SWITCHES` — because
 * XP's self-switches are local to the (event, letter) pair, not the party-wide registry: two
 * different events both using letter "A" must never share one flag.
 */
export interface PartyAdventureState {
  switches: Record<string, boolean>;
  variables: Record<string, number>;
  selfSwitches: Record<string, boolean>;
  /** Optional only for source compatibility with saves created before authored quests. */
  quests?: Record<string, AuthoredQuestProgress>;
}

export interface AuthoredQuestProgress {
  status: QuestProgressStatus;
  objectives: Record<string, number>;
  /** The accepted definition is immutable for this attempt, even if the adventure is edited. */
  definitionSnapshot: AuthoredQuestDefinition | null;
  definitionVersion: number;
  rewardClaimed: boolean;
  completionCount: number;
  /** Bounded idempotency window of server-minted business-event ids. */
  processedEventKeys: readonly string[];
}

export interface AuthoredQuestTracker {
  id: string;
  title: string;
  description: string;
  status: QuestProgressStatus;
  objectives: readonly {
    id: string;
    label: string;
    progress: number;
    target: number;
  }[];
}

export interface AuthoredQuestMarker {
  eventId: string;
  kind: "available" | "active" | "ready";
}

export const EMPTY_ADVENTURE_STATE: PartyAdventureState = {
  switches: {},
  variables: {},
  selfSwitches: {},
};

function parseSwitches(value: unknown): Record<string, boolean> | null {
  if (!isPlainObject(value)) return null;
  const switches: Record<string, boolean> = {};
  for (const [id, flag] of Object.entries(value)) {
    if (!REGISTRY_ID_PATTERN.test(id) || typeof flag !== "boolean") return null;
    switches[id] = flag;
  }
  return switches;
}

function parseVariables(value: unknown): Record<string, number> | null {
  if (!isPlainObject(value)) return null;
  const variables: Record<string, number> = {};
  for (const [id, amount] of Object.entries(value)) {
    if (!REGISTRY_ID_PATTERN.test(id) || !Number.isSafeInteger(amount)) return null;
    variables[id] = amount as number;
  }
  return variables;
}

/** `${eventId}:${letter}` — split on the LAST colon, since a uuid never contains one, so this
 *  never needs to guess where the id ends and the letter begins. */
function isSelfSwitchKey(key: string): boolean {
  const separator = key.lastIndexOf(":");
  if (separator < 0) return false;
  return isUuid(key.slice(0, separator)) && isSelfSwitch(key.slice(separator + 1));
}

/** The most self-switch entries one party's live state may hold. A party's self-switches grow
 *  unboundedly only in principle — every entry names one (event, letter) pair, and events are
 *  themselves bounded per map — but nothing upstream caps the party-wide total across every map
 *  an adventure owns, so this is the backstop against a corrupt or hostile row ballooning a D1
 *  write. `adventure-state-store.ts`'s `savePartyAdventureState` prunes entries whose event no
 *  longer exists (when the caller supplies the live id set); this is the harder ceiling that
 *  applies regardless of whether a caller prunes. */
export const MAX_SELF_SWITCH_ENTRIES = 512;

function parseSelfSwitches(value: unknown): Record<string, boolean> | null {
  if (!isPlainObject(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > MAX_SELF_SWITCH_ENTRIES) return null;
  const selfSwitches: Record<string, boolean> = {};
  for (const [key, flag] of entries) {
    if (!isSelfSwitchKey(key) || typeof flag !== "boolean") return null;
    selfSwitches[key] = flag;
  }
  return selfSwitches;
}

function parseQuestProgress(value: unknown): Record<string, AuthoredQuestProgress> | null {
  if (value === undefined) return {};
  if (!isPlainObject(value) || Object.keys(value).length > MAX_AUTHORED_QUESTS) return null;
  const quests: Record<string, AuthoredQuestProgress> = {};
  for (const [questId, raw] of Object.entries(value)) {
    if (!REGISTRY_ID_PATTERN.test(questId) || !isPlainObject(raw)) return null;
    if (
      raw.status !== "active" &&
      raw.status !== "ready" &&
      raw.status !== "completed" &&
      raw.status !== "failed" &&
      raw.status !== "abandoned"
    ) {
      return null;
    }
    if (!isPlainObject(raw.objectives)) return null;
    const entries = Object.entries(raw.objectives);
    if (entries.length > MAX_QUEST_OBJECTIVES) return null;
    const objectives: Record<string, number> = {};
    for (const [objectiveId, progress] of entries) {
      if (
        !REGISTRY_ID_PATTERN.test(objectiveId) ||
        !Number.isSafeInteger(progress) ||
        (progress as number) < 0 ||
        (progress as number) > QUEST_OBJECTIVE_TARGET_MAX
      ) {
        return null;
      }
      objectives[objectiveId] = progress as number;
    }
    const definitionSnapshot =
      raw.definitionSnapshot === undefined || raw.definitionSnapshot === null
        ? null
        : parseAuthoredQuestDefinition(raw.definitionSnapshot);
    if (
      definitionSnapshot === null &&
      raw.definitionSnapshot !== undefined &&
      raw.definitionSnapshot !== null
    ) {
      return null;
    }
    if (definitionSnapshot && definitionSnapshot.id !== questId) return null;
    const definitionVersion =
      raw.definitionVersion === undefined
        ? (definitionSnapshot?.version ?? 1)
        : raw.definitionVersion;
    if (!Number.isSafeInteger(definitionVersion) || (definitionVersion as number) < 1) return null;
    const rewardClaimed =
      raw.rewardClaimed === undefined ? raw.status === "completed" : raw.rewardClaimed;
    if (typeof rewardClaimed !== "boolean") return null;
    const completionCount =
      raw.completionCount === undefined
        ? raw.status === "completed"
          ? 1
          : 0
        : raw.completionCount;
    if (!Number.isSafeInteger(completionCount) || (completionCount as number) < 0) return null;
    const processedEventKeys = raw.processedEventKeys === undefined ? [] : raw.processedEventKeys;
    if (
      !Array.isArray(processedEventKeys) ||
      processedEventKeys.length > MAX_QUEST_PROCESSED_EVENT_KEYS ||
      processedEventKeys.some(
        (key) =>
          typeof key !== "string" || key.length === 0 || key.length > QUEST_PROCESSED_EVENT_KEY_MAX,
      ) ||
      new Set(processedEventKeys).size !== processedEventKeys.length
    ) {
      return null;
    }
    quests[questId] = {
      status: raw.status,
      objectives,
      definitionSnapshot,
      definitionVersion: definitionVersion as number,
      rewardClaimed,
      completionCount: completionCount as number,
      processedEventKeys: processedEventKeys as string[],
    };
  }
  return quests;
}

export function parsePartyAdventureState(value: unknown): PartyAdventureState | null {
  if (!isPlainObject(value)) return null;
  const switches = parseSwitches(value.switches);
  if (!switches) return null;
  const variables = parseVariables(value.variables);
  if (!variables) return null;
  const selfSwitches = parseSelfSwitches(value.selfSwitches);
  if (!selfSwitches) return null;
  const quests = parseQuestProgress(value.quests);
  if (!quests) return null;
  return {
    switches,
    variables,
    selfSwitches,
    ...(Object.keys(quests).length > 0 ? { quests } : {}),
  };
}

/** The player-facing tracker is derived from authored definitions plus party-owned progress. */
export function authoredQuestTrackers(
  registry: AdventureRegistry,
  state: PartyAdventureState,
): AuthoredQuestTracker[] {
  const progressByQuest = state.quests ?? {};
  const definitions = new Map((registry.quests ?? []).map((quest) => [quest.id, quest]));
  const authoredOrder = (registry.quests ?? []).map((quest) => quest.id);
  const orderedIds = [
    ...authoredOrder,
    ...Object.keys(progressByQuest).filter((questId) => !definitions.has(questId)),
  ];
  const trackers: AuthoredQuestTracker[] = [];
  for (const questId of orderedIds) {
    const progress = progressByQuest[questId];
    if (!progress) continue;
    const quest = progress.definitionSnapshot ?? definitions.get(questId);
    if (!quest) continue;
    const objectives = quest.objectives.map((objective) => ({
      id: objective.id,
      label: objective.label,
      progress: Math.min(objective.target, progress.objectives[objective.id] ?? 0),
      target: objective.target,
    }));
    const ready = requiredQuestObjectivesComplete(quest, progress.objectives);
    const status =
      progress.status === "active" || progress.status === "ready"
        ? ready
          ? "ready"
          : "active"
        : progress.status;
    trackers.push({
      id: quest.id,
      title: quest.title || `Quête ${quest.id}`,
      description: quest.description,
      status,
      objectives,
    });
  }
  return trackers;
}

/**
 * Upgrade legacy progress and pin its accepted definition. Once pinned, a current registry edit or
 * deletion cannot rewrite an in-progress party. Only unpinned orphan rows (legacy corrupt/stale
 * references) are dropped. Values are clamped against the pinned targets.
 */
export function normalizeAuthoredQuestProgress(
  registry: AdventureRegistry,
  state: PartyAdventureState,
): PartyAdventureState {
  if (state.quests === undefined) return state;
  const definitions = new Map((registry.quests ?? []).map((quest) => [quest.id, quest]));
  const quests: Record<string, AuthoredQuestProgress> = {};
  for (const [questId, progress] of Object.entries(state.quests)) {
    const definition = progress.definitionSnapshot ?? definitions.get(questId);
    if (!definition) continue;
    const objectives: Record<string, number> = {};
    for (const objective of definition.objectives) {
      const value = progress.objectives[objective.id];
      if (value !== undefined) objectives[objective.id] = Math.min(objective.target, value);
    }
    const ready = requiredQuestObjectivesComplete(definition, objectives);
    const status =
      progress.status === "active" || progress.status === "ready"
        ? ready
          ? "ready"
          : "active"
        : progress.status;
    quests[questId] = {
      status,
      objectives,
      definitionSnapshot: definition,
      definitionVersion: definition.version,
      rewardClaimed: progress.rewardClaimed,
      completionCount: progress.completionCount,
      processedEventKeys: progress.processedEventKeys,
    };
  }
  const { quests: _staleQuests, ...base } = state;
  return Object.keys(quests).length > 0 ? { ...base, quests } : base;
}

/**
 * The three condition PRIMITIVES, shared verbatim by page selection (below) and the tranche-5
 * command interpreter (`event-interpreter.ts`'s `if`). They are extracted here — not copied — for
 * the same reason `step()` lives once in `shared/`: page selection and the interpreter MUST agree
 * on what a condition sees, and two hand-synchronised copies of "is this switch on" is exactly how
 * they silently drift. Each encodes the unknown-id default `activePageIndex` documents: an unknown
 * switch reads `false`, an unknown/untouched variable reads `0` (so `min 0` holds vacuously).
 */
export function switchIsOn(state: PartyAdventureState, switchId: string): boolean {
  return state.switches[switchId] === true;
}

export function variableAtLeast(
  state: PartyAdventureState,
  variableId: string,
  min: number,
): boolean {
  return (state.variables[variableId] ?? 0) >= min;
}

/** The self-switch storage key: `${eventId}:${letter}`. The interpreter mints the same key when it
 *  emits a `setSelfSwitch` mutation, so a page reading letter "A" and a command setting it land on
 *  one entry. Split on the LAST colon everywhere (a uuid never contains one) — see `isSelfSwitchKey`. */
export function selfSwitchKey(eventId: string, letter: SelfSwitch): string {
  return `${eventId}:${letter}`;
}

export function selfSwitchIsOn(
  state: PartyAdventureState,
  eventId: string,
  letter: SelfSwitch,
): boolean {
  return state.selfSwitches[selfSwitchKey(eventId, letter)] === true;
}

/** One page's conditions, ALL of them — a page with none set holds vacuously (Decision 3's
 *  "no conditions" case), so an event whose only page is bare is always on. An unset condition
 *  contributes nothing to the AND; it is not evaluated at all. */
function pageConditionsHold(
  page: MapEventPage,
  eventId: string,
  state: PartyAdventureState,
): boolean {
  if (page.condSwitchId !== null && !switchIsOn(state, page.condSwitchId)) return false;
  if (
    page.condVariableId !== null &&
    !variableAtLeast(state, page.condVariableId, page.condVariableMin ?? 0)
  ) {
    return false;
  }
  if (page.condSelfSwitch !== null && !selfSwitchIsOn(state, eventId, page.condSelfSwitch)) {
    return false;
  }
  return true;
}

/**
 * XP's rule: walk pages from the LAST (highest position) to the first and return the index of the
 * first one whose conditions all hold. A more specific, later-authored page always wins over an
 * earlier, more general one when both are satisfied — that precedence, not "first match", is the
 * entire point of letting an event carry more than one page. No page holding means the event is
 * dormant: `null`, not page 0 — an event is not required to always show something.
 *
 * Unknown ids read as their neutral default (`false` for a switch, `0` for a variable) rather than
 * failing the page: state a party has never touched is indistinguishable from state explicitly
 * left at its default, so a fresh party and a party that set a switch back to its default look the
 * same to a page that reads it. A `min 0` variable condition against an unknown/untouched variable
 * therefore HOLDS (0 >= 0) — a deliberate consequence, not a hole; see the test with the same name.
 */
export function activePageIndex(event: MapEvent, state: PartyAdventureState): number | null {
  for (let index = event.pages.length - 1; index >= 0; index--) {
    const page = event.pages[index];
    if (page !== undefined && pageConditionsHold(page, event.id, state)) return index;
  }
  return null;
}
