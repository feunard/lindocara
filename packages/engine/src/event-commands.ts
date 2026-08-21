/**
 * What an event's commands ARE, as authored data with a total parser but no evaluator.
 *
 * Tranche 5 gives a `normal` event a program: an ordered list of commands the interpreter
 * (`event-interpreter.ts`, a later task) executes when the event triggers. This file owns only the
 * SHAPE — the discriminated union, its limits, and `parseEventCommands`, the boundary that turns
 * anything a client sends into either a valid program or `null`. Nothing here runs; the split
 * mirrors `map-events.ts` (the page shape with no page-selection engine) exactly, and for the same
 * reason: the evaluator reads this shape, so the shape must be pinned and defensively parsed first.
 *
 * The vocabulary is the tranche-5 catalogue (spec Decision 2/6, `2026-07-20-interpreter-design.md`):
 * show text · show choices · set switch · set variable (set/add) · set self-switch · conditional
 * (with else) · loop · break loop · exit event processing · wait · teleport · end adventure · change
 * gold · change items · comment. Switch/variable ids reuse `map-events.ts`'s registry-less shape —
 * the registry that gives an id meaning is a later concern, and pretending it exists here would move
 * the validation gap somewhere less honest, the same choice `map-events.ts` documents.
 */
import { isUuid } from "./identifiers.js";
import { CONDITION_ID_PATTERN, isSelfSwitch, type SelfSwitch } from "./map-events.js";

/**
 * The command-model limits, the single source for every consumer (the parser here, the interpreter,
 * the runtime budget, the editor). Later tasks import these rather than re-declaring them.
 *
 * `MAX_COMMANDS_PER_PAGE` is counted RECURSIVELY: a command nested inside an `if` branch, a `loop`
 * body or a `choices` option body counts toward the SAME page total as a top-level command. Without
 * that, nesting would be a hole in the bound — depth 8 with 200 commands at each level would be
 * 200x the intended ceiling — so the count follows the tree, not just the top array. The depth cap
 * and the recursive count cap together bound a page's program to at most 200 nodes no matter how it
 * is shaped, which is what lets `event-interpreter.ts` reason about a page as a bounded program.
 */
export const MAX_COMMANDS_PER_PAGE = 200;
export const COMMAND_TEXT_MAX = 200;
export const MAX_CHOICE_OPTIONS = 4;
export const MAX_COMMAND_DEPTH = 8;

/** The runtime drains at most this many commands per tick across every live context (the
 *  navigation-system budget discipline). Exported here as the single source even though the
 *  drain that consumes it lands in a later task. */
export const EVENT_COMMANDS_PER_TICK = 16;

/**
 * Authored travel semantics. The runtime still validates every destination and owns the handoff;
 * this category exists so editors, validators and adventure-map views can separate world geography
 * from interior doors, shortcuts and non-geographic puzzle/reset jumps.
 */
export const TRANSITION_CATEGORIES = [
  "geographic",
  "interior",
  "shortcut",
  "magical",
  "memory",
  "puzzle",
  "recovery",
] as const;
export type TransitionCategory = (typeof TRANSITION_CATEGORIES)[number];

export function isTransitionCategory(value: unknown): value is TransitionCategory {
  return typeof value === "string" && (TRANSITION_CATEGORIES as readonly string[]).includes(value);
}

/**
 * How far the triggerer may drift from a running dialogue before the server closes it and ends the
 * run (WoW closes the panel on walk-away). Exported here as the single source; `worldTick.ts`
 * consumes it in `groundDistance` terms.
 *
 * **Three TILES, not three tiles' worth of pixels.** It was `3 * TILE_SIZE` — a pixel length — and
 * the two comparisons that read it moved to tile units without it: a hero would have had to walk
 * 192 tiles, well past the edge of any grid, so the walk-away close could never fire and nothing
 * failed. A distance constant that outlives its unit system is the quietest kind of regression.
 */
export const DIALOGUE_CLOSE_RADIUS = 3;

/** `wait` is authored in frames at the 20Hz tick — 1 frame (50ms) to 600 (30s). Zero would be a
 *  no-op better written as no command; a longer pause is a design smell, not a primitive. */
export const WAIT_FRAMES_MIN = 1;
export const WAIT_FRAMES_MAX = 600;

/** Bounded authored environmental damage. `lethal` is an explicit separate rule. */
export const EVENT_DAMAGE_LIMITS = { min: 1, max: 100_000 } as const;

/**
 * An item id an authored `changeItems` grants or removes. `changeItems` only ever grants a
 * consumable — a lowercase snake_case slug from the shared `CONSUMABLE_IDS` catalogue
 * (`consumables.ts`), e.g. `health_potion` or `mana_potion`. Equipment ids such as `weathered_sword`
 * are a DIFFERENT catalogue (the server's `items.ts`) and are refused just like an unknown id: this
 * shared file cannot import either catalogue, and the registry-less philosophy the switch/variable
 * ids already follow applies identically — check the SHAPE of an id here, defer "does it name a
 * grantable consumable" to `World#dispatchItems` (`isConsumableId`), the runtime that owns the
 * catalogue. The bound keeps a pathological id from inflating the map body.
 */
export const ITEM_ID_PATTERN = /^[a-z][a-z0-9_]*$/;
export const ITEM_ID_MAX = 64;

/** The three condition forms a `conditional` command tests: a switch is on, a variable is at least
 *  a threshold, or a self-switch is on. Mirrors the wireframe's condition select. */
export type EventCondition =
  | { readonly type: "switch"; readonly switchId: string }
  | { readonly type: "variable"; readonly variableId: string; readonly min: number }
  | { readonly type: "selfSwitch"; readonly selfSwitch: SelfSwitch };

/** One option of a `choices` command: an author-written label and the body run when it is picked.
 *  The body is XP-style — commands nested under the choice, counted in the page's recursive total. */
export interface ChoiceOption {
  readonly label: string;
  readonly body: readonly EventCommand[];
}

/**
 * A single authored command. `t` is the opcode discriminant, matching the wire idiom (`{ t: ... }`)
 * used by the protocol and heal/interact intents. Authored prose (`say.text`, `choices` labels,
 * `comment.text`) is data, not a machine code — the one sanctioned exception to codes-not-sentences,
 * because the author wrote it and no dictionary can hold it (spec Decision 4).
 */
export type EventCommand =
  /**
   * One line of authored dialogue.
   *
   * `name` is the speaker, and it has THREE states rather than two, which is what lets an author
   * name a character once instead of on every line:
   *
   * - **absent** - the event's own name speaks the line. The common case, and the default a new
   *   line is created in, so renaming the NPC renames its dialogue.
   * - **`null`** - nobody speaks it: narration, a sign, a thought.
   * - **a string** - this line only, someone else. A second character answering inside one page.
   *
   * Every line stored before this carried an explicit `name`, so nothing authored changed meaning
   * when the third state appeared.
   */
  | { readonly t: "say"; readonly text: string; readonly name?: string | null }
  | { readonly t: "choices"; readonly prompt: string; readonly options: readonly ChoiceOption[] }
  | { readonly t: "setSwitch"; readonly switchId: string; readonly value: boolean }
  | {
      readonly t: "setVariable";
      readonly variableId: string;
      readonly op: "set" | "add";
      readonly value: number;
    }
  | { readonly t: "setSelfSwitch"; readonly selfSwitch: SelfSwitch; readonly value: boolean }
  | {
      readonly t: "if";
      readonly cond: EventCondition;
      readonly then: readonly EventCommand[];
      readonly else: readonly EventCommand[];
    }
  | { readonly t: "loop"; readonly body: readonly EventCommand[] }
  | { readonly t: "breakLoop" }
  | { readonly t: "exitRun" }
  | { readonly t: "wait"; readonly frames: number }
  | { readonly t: "damage"; readonly amount: number; readonly lethal: boolean }
  | {
      readonly t: "teleport";
      readonly mapId: string;
      readonly col: number;
      readonly row: number;
      /** Absent only on legacy in-memory fixtures; the parser normalizes it to `geographic`. */
      readonly category?: TransitionCategory;
      /**
       * An EVENT on the destination map to arrive at, resolved when the teleport runs.
       *
       * The cell below is authored once and rots the moment the far map is edited; an event id
       * survives its target being moved. It also makes a CROSS-MAP destination addressable at all:
       * `col`/`row` are a tile-editor cell in the source map's space, which the destination's own
       * heightfield grid cannot read, so a cross-map teleport with no `eventId` still lands on the
       * destination's spawn (`WorldRoom.teleportCrossMap` says so in full).
       *
       * `col`/`row` stay the fallback for every stored command and for a target that has since been
       * deleted, so nothing authored before this existed changed meaning.
       */
      readonly eventId?: string;
    }
  | { readonly t: "endAdventure" }
  /**
   * Open the consumables shop for the hero who triggered this event.
   *
   * A merchant is an ordinary authored event — give an NPC a graphic, an `action` trigger, a line of
   * `say` and this command, and he trades. There is no merchant event KIND and no merchant placement
   * marker: the shop, its protocol and its animated overlay already existed, and the only thing
   * missing was an authored way to reach them (`merchantForRuntimeRoom` returned null for every
   * room). Field-free like `endAdventure`; the event's own cell is the counter the buy path measures
   * against, so a hero cannot keep shopping after walking away.
   */
  | { readonly t: "openShop" }
  | { readonly t: "changeGold"; readonly amount: number }
  | { readonly t: "changeItems"; readonly itemId: string; readonly count: number }
  /** Emit a server-authored area-arrival fact for structured reach objectives. */
  | { readonly t: "enterArea"; readonly areaId: string }
  /** Emit a server-authored activity-completion fact for structured activity objectives. */
  | { readonly t: "completeActivity"; readonly activityId: string }
  | { readonly t: "startQuest"; readonly questId: string }
  | {
      readonly t: "advanceQuest";
      readonly questId: string;
      readonly objectiveId: string;
      readonly amount: number;
    }
  | { readonly t: "completeQuest"; readonly questId: string }
  | { readonly t: "comment"; readonly text: string };

function isConditionId(value: unknown): value is string {
  return typeof value === "string" && CONDITION_ID_PATTERN.test(value);
}

/** Trimmed authored text within `COMMAND_TEXT_MAX`; `null` on anything that cannot be one. Unlike an
 *  event name, empty text is meaningful here (a blank say line is an authored beat), so emptiness is
 *  legal — only the type and the length are gated. */
function parseText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.length <= COMMAND_TEXT_MAX ? value : null;
}

function parseCondition(raw: unknown): EventCondition | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  switch (record.type) {
    case "switch":
      return isConditionId(record.switchId) ? { type: "switch", switchId: record.switchId } : null;
    case "variable": {
      if (!isConditionId(record.variableId)) return null;
      if (!Number.isSafeInteger(record.min)) return null;
      return { type: "variable", variableId: record.variableId, min: record.min as number };
    }
    case "selfSwitch":
      return isSelfSwitch(record.selfSwitch)
        ? { type: "selfSwitch", selfSwitch: record.selfSwitch }
        : null;
    default:
      return null;
  }
}

/** Mutable node tally threaded through the whole parse so the recursive count is one running total
 *  across every branch and body, not a per-array reset. */
interface Counter {
  n: number;
}

/**
 * One command, validated field by field. `depth` is this command's nesting level (top-level is 1);
 * `counter` is the shared recursive node tally. Any bad field, an unknown opcode, an over-budget
 * count or an over-deep body returns `null`, and `parseCommandArray` propagates that to a `null`
 * program — the parser is total. Unknown extra properties are ignored, matching `parseEventPage`.
 */
function parseCommand(raw: unknown, depth: number, counter: Counter): EventCommand | null {
  if (typeof raw !== "object" || raw === null) return null;
  counter.n += 1;
  if (counter.n > MAX_COMMANDS_PER_PAGE) return null;
  const record = raw as Record<string, unknown>;
  switch (record.t) {
    case "say": {
      const text = parseText(record.text);
      if (text === null) return null;
      // The three states of a speaker (see the union): the KEY's absence is meaningful here, so it
      // is preserved rather than folded into `null`. An explicit `null` still means narration, and
      // a present name must be a string within the text bound.
      if (record.name === undefined) return { t: "say", text };
      if (record.name === null) return { t: "say", text, name: null };
      if (typeof record.name !== "string") return null;
      const name = parseText(record.name);
      if (name === null) return null;
      return { t: "say", text, name };
    }
    case "choices": {
      const prompt = parseText(record.prompt);
      if (prompt === null) return null;
      if (!Array.isArray(record.options)) return null;
      if (record.options.length < 1 || record.options.length > MAX_CHOICE_OPTIONS) return null;
      const options: ChoiceOption[] = [];
      for (const rawOption of record.options) {
        if (typeof rawOption !== "object" || rawOption === null) return null;
        const optionRecord = rawOption as Record<string, unknown>;
        const label = parseText(optionRecord.label);
        if (label === null) return null;
        const body = parseCommandArray(optionRecord.body, depth + 1, counter);
        if (!body) return null;
        options.push({ label, body });
      }
      return { t: "choices", prompt, options };
    }
    case "setSwitch": {
      if (!isConditionId(record.switchId)) return null;
      if (typeof record.value !== "boolean") return null;
      return { t: "setSwitch", switchId: record.switchId, value: record.value };
    }
    case "setVariable": {
      if (!isConditionId(record.variableId)) return null;
      if (record.op !== "set" && record.op !== "add") return null;
      if (!Number.isSafeInteger(record.value)) return null;
      return {
        t: "setVariable",
        variableId: record.variableId,
        op: record.op,
        value: record.value as number,
      };
    }
    case "setSelfSwitch": {
      if (!isSelfSwitch(record.selfSwitch)) return null;
      if (typeof record.value !== "boolean") return null;
      return { t: "setSelfSwitch", selfSwitch: record.selfSwitch, value: record.value };
    }
    case "if": {
      const cond = parseCondition(record.cond);
      if (!cond) return null;
      const thenBranch = parseCommandArray(record.then, depth + 1, counter);
      if (!thenBranch) return null;
      // `else` may be empty — an if with no else is the common case — but it must be a valid array.
      const elseBranch = parseCommandArray(record.else, depth + 1, counter);
      if (!elseBranch) return null;
      return { t: "if", cond, then: thenBranch, else: elseBranch };
    }
    case "loop": {
      const body = parseCommandArray(record.body, depth + 1, counter);
      if (!body) return null;
      return { t: "loop", body };
    }
    case "breakLoop":
      return { t: "breakLoop" };
    case "exitRun":
      return { t: "exitRun" };
    case "wait": {
      if (!Number.isSafeInteger(record.frames)) return null;
      const frames = record.frames as number;
      if (frames < WAIT_FRAMES_MIN || frames > WAIT_FRAMES_MAX) return null;
      return { t: "wait", frames };
    }
    case "damage": {
      if (!Number.isSafeInteger(record.amount)) return null;
      const amount = record.amount as number;
      if (amount < EVENT_DAMAGE_LIMITS.min || amount > EVENT_DAMAGE_LIMITS.max) return null;
      if (typeof record.lethal !== "boolean") return null;
      return { t: "damage", amount, lethal: record.lethal };
    }
    case "teleport": {
      if (!isUuid(record.mapId)) return null;
      if (!Number.isSafeInteger(record.col) || !Number.isSafeInteger(record.row)) return null;
      const col = record.col as number;
      const row = record.row as number;
      if (col < 0 || row < 0) return null;
      // Old authored maps predate transition categories. Treat them as ordinary geographic travel
      // at the parsing boundary so imports remain compatible while every newly saved command is
      // explicit.
      const category = record.category ?? "geographic";
      if (!isTransitionCategory(category)) return null;
      // An absent target is the ordinary cell-addressed teleport. A malformed one is refused
      // outright rather than silently dropped: a command that says "arrive at that door" and
      // quietly arrives somewhere else is worse than one that fails to parse.
      if (record.eventId !== undefined && !isUuid(record.eventId)) return null;
      return {
        t: "teleport",
        mapId: record.mapId,
        col,
        row,
        category,
        ...(record.eventId === undefined ? {} : { eventId: record.eventId as string }),
      };
    }
    case "endAdventure":
      // The optional end-game beat: marks the party's save complete when it runs. Field-free, like
      // `exitRun`/`breakLoop` — an author drops it wherever the ending should fire.
      return { t: "endAdventure" };
    case "openShop":
      // Field-free too: the shop's stock is `CONSUMABLES`, and the counter is the event's own cell.
      return { t: "openShop" };
    case "changeGold": {
      if (!Number.isSafeInteger(record.amount)) return null;
      return { t: "changeGold", amount: record.amount as number };
    }
    case "changeItems": {
      if (typeof record.itemId !== "string") return null;
      if (record.itemId.length > ITEM_ID_MAX || !ITEM_ID_PATTERN.test(record.itemId)) return null;
      if (!Number.isSafeInteger(record.count)) return null;
      const count = record.count as number;
      // A zero-count change is a no-op the author never meant; ± is the whole point of the command.
      if (count === 0) return null;
      return { t: "changeItems", itemId: record.itemId, count };
    }
    case "enterArea":
      return typeof record.areaId === "string" &&
        record.areaId.length <= ITEM_ID_MAX &&
        ITEM_ID_PATTERN.test(record.areaId)
        ? { t: "enterArea", areaId: record.areaId }
        : null;
    case "completeActivity":
      return typeof record.activityId === "string" &&
        record.activityId.length <= ITEM_ID_MAX &&
        ITEM_ID_PATTERN.test(record.activityId)
        ? { t: "completeActivity", activityId: record.activityId }
        : null;
    case "startQuest":
      return isConditionId(record.questId) ? { t: "startQuest", questId: record.questId } : null;
    case "advanceQuest": {
      if (!isConditionId(record.questId) || !isConditionId(record.objectiveId)) return null;
      if (!Number.isSafeInteger(record.amount)) return null;
      const amount = record.amount as number;
      if (amount === 0) return null;
      return {
        t: "advanceQuest",
        questId: record.questId,
        objectiveId: record.objectiveId,
        amount,
      };
    }
    case "completeQuest":
      return isConditionId(record.questId) ? { t: "completeQuest", questId: record.questId } : null;
    case "comment": {
      const text = parseText(record.text);
      if (text === null) return null;
      return { t: "comment", text };
    }
    default:
      return null;
  }
}

/** An ordered command array at nesting `depth`, sharing `counter`. A non-array, or any command it
 *  contains failing to parse, yields `null`. An EMPTY body at any depth is legal — only a command
 *  actually PRESENT beyond `MAX_COMMAND_DEPTH` is refused, so a deep-but-empty else costs nothing. */
function parseCommandArray(value: unknown, depth: number, counter: Counter): EventCommand[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length > 0 && depth > MAX_COMMAND_DEPTH) return null;
  const commands: EventCommand[] = [];
  for (const raw of value) {
    const command = parseCommand(raw, depth, counter);
    if (!command) return null;
    commands.push(command);
  }
  return commands;
}

/**
 * A page's command program off the wire, checked like the untrusted data it is. Total: every legal
 * program parses, everything else — a non-array, a malformed field, an unknown opcode, a body over
 * `MAX_COMMAND_DEPTH`, or more than `MAX_COMMANDS_PER_PAGE` nodes counting recursively — returns
 * `null`. An empty array is a valid empty program (the default a page carries until authored).
 */
export function parseEventCommands(value: unknown): EventCommand[] | null {
  return parseCommandArray(value, 1, { n: 0 });
}

/**
 * How many command nodes a program holds, counted RECURSIVELY — a command nested inside an `if`
 * branch, a `loop` body or a `choices` option body counts toward the same total as a top-level
 * command. This is the exact tally `parseEventCommands` threads through its `Counter` (each
 * `parseCommand` adds one and then recurses into its bodies), extracted so the editor can enforce
 * `MAX_COMMANDS_PER_PAGE` against the same semantics the parser rejects on: a guard that counted only
 * the top-level array would let nesting smuggle a program past the bound the parser would then refuse.
 */
export function countEventCommands(commands: readonly EventCommand[]): number {
  let total = 0;
  for (const command of commands) {
    total += 1;
    switch (command.t) {
      case "if":
        total += countEventCommands(command.then) + countEventCommands(command.else);
        break;
      case "loop":
        total += countEventCommands(command.body);
        break;
      case "choices":
        for (const option of command.options) total += countEventCommands(option.body);
        break;
      default:
        break;
    }
  }
  return total;
}
