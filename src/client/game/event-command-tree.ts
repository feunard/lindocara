/**
 * Pure editing operations over an event page's command TREE, and its flattening for display.
 *
 * The page's program (`shared/event-commands.ts`) is a tree: `if` carries `then`/`else` bodies, a
 * `loop` a body, a `choices` a body per option. The editor renders that tree as an indented,
 * monospace list of rows and mutates it by INSERT (after the selection, or at the end of a body),
 * DELETE (a command with its whole subtree), MOVE (up/down within a body) and UPDATE (a command's
 * fields in place). Everything here is a value-returning transform on a `readonly EventCommand[]`
 * with no React and no i18n — the component owns rendering and wording, this owns the shape — so the
 * insert-index/delete-subtree/count semantics can be unit-driven through the component and still
 * mirror exactly what `parseEventCommands` accepts. Guards reuse `countEventCommands` and the shared
 * limits so the editor can never author a program the parser would reject.
 */
import {
  countEventCommands,
  type EventCommand,
  MAX_COMMAND_DEPTH,
  MAX_COMMANDS_PER_PAGE,
} from "../../shared/event-commands.js";

/** Which sub-body of a container command a path step descends into. A number is not used directly;
 *  `{ option }` names one `choices` option's body so the three container kinds share one addressing
 *  vocabulary. */
export type Branch = "then" | "else" | "loop" | { readonly option: number };

/** One descent: index into the current body, then into that command's `branch` sub-body. */
export interface BodySeg {
  readonly index: number;
  readonly branch: Branch;
}

/** The address of a BODY (an `EventCommand[]`): the empty address is the root program; each seg
 *  descends one nesting level. A command is addressed by its body's address plus its index within. */
export type BodyAddr = readonly BodySeg[];

/**
 * What the author currently has selected. A `command` selection targets one command (delete / move /
 * param-edit act on it, and insert lands right after it); a `slot` selection targets the END of a
 * body (insert appends there, which is the only way to author into an empty branch). `null` — nothing
 * selected — inserts at the end of the root program.
 */
export type Selection =
  | { readonly kind: "command"; readonly addr: BodyAddr; readonly index: number }
  | { readonly kind: "slot"; readonly addr: BodyAddr };

function branchKey(branch: Branch): string {
  return typeof branch === "object" ? `o${branch.option}` : branch;
}

function addrKey(addr: BodyAddr): string {
  return addr.map((seg) => `${seg.index}:${branchKey(seg.branch)}`).join("/");
}

/** A stable string identity for a selection — React keys and equality comparisons. */
export function selectionKey(selection: Selection): string {
  return selection.kind === "command"
    ? `c:${addrKey(selection.addr)}#${selection.index}`
    : `s:${addrKey(selection.addr)}`;
}

export function selectionsEqual(a: Selection | null, b: Selection | null): boolean {
  if (a === null || b === null) return a === b;
  return selectionKey(a) === selectionKey(b);
}

/** The sub-body a branch names on a command, or `null` when the command has no such body (a type
 *  mismatch a caller must treat as "address does not resolve"). */
function childBody(command: EventCommand, branch: Branch): readonly EventCommand[] | null {
  if (branch === "then") return command.t === "if" ? command.then : null;
  if (branch === "else") return command.t === "if" ? command.else : null;
  if (branch === "loop") return command.t === "loop" ? command.body : null;
  if (command.t !== "choices") return null;
  return command.options[branch.option]?.body ?? null;
}

/** The body an address resolves to, or `null` when any step falls off the tree. */
export function bodyAt(
  commands: readonly EventCommand[],
  addr: BodyAddr,
): readonly EventCommand[] | null {
  let list: readonly EventCommand[] = commands;
  for (const seg of addr) {
    const command = list[seg.index];
    if (!command) return null;
    const child = childBody(command, seg.branch);
    if (!child) return null;
    list = child;
  }
  return list;
}

/** The command a `command` selection resolves to, or `null`. */
export function commandAt(
  commands: readonly EventCommand[],
  selection: Selection,
): EventCommand | null {
  if (selection.kind !== "command") return null;
  return bodyAt(commands, selection.addr)?.[selection.index] ?? null;
}

/** A copy of `command` with its `branch` sub-body replaced by `next(oldBody)`; a no-op on a type
 *  mismatch so a stale address cannot corrupt a command of the wrong kind. */
function withChildBody(
  command: EventCommand,
  branch: Branch,
  next: (body: readonly EventCommand[]) => readonly EventCommand[],
): EventCommand {
  // biome-ignore lint/suspicious/noThenProperty: `then` is the conditional's branch field, not a thenable.
  if (branch === "then" && command.t === "if") return { ...command, then: next(command.then) };
  if (branch === "else" && command.t === "if") return { ...command, else: next(command.else) };
  if (branch === "loop" && command.t === "loop") return { ...command, body: next(command.body) };
  if (typeof branch === "object" && command.t === "choices") {
    return {
      ...command,
      options: command.options.map((option, k) =>
        k === branch.option ? { ...option, body: next(option.body) } : option,
      ),
    };
  }
  return command;
}

/** Rebuild the tree with the body at `addr` transformed by `next`. Immutable: only the spine from the
 *  root to the touched body is rebuilt, everything else is shared. */
function mapBody(
  commands: readonly EventCommand[],
  addr: BodyAddr,
  next: (body: readonly EventCommand[]) => readonly EventCommand[],
): readonly EventCommand[] {
  const [seg, ...rest] = addr;
  if (!seg) return next(commands);
  return commands.map((command, i) =>
    i === seg.index
      ? withChildBody(command, seg.branch, (body) => mapBody(body, rest, next))
      : command,
  );
}

/** Where a fresh command lands and gets selected, given the current selection: after a selected
 *  command, at the end of a selected slot's body, or at the end of the root program. */
function insertPoint(
  commands: readonly EventCommand[],
  selection: Selection | null,
): { addr: BodyAddr; index: number } | null {
  if (selection === null) return { addr: [], index: commands.length };
  const body = bodyAt(commands, selection.addr);
  if (!body) return null;
  return selection.kind === "command"
    ? { addr: selection.addr, index: selection.index + 1 }
    : { addr: selection.addr, index: body.length };
}

/**
 * Insert `command` at the current selection, or `null` when it would break a shared limit — the
 * SAME rejections the parser makes, refused here so the editor never authors an unsaveable program:
 *
 * - a command deeper than `MAX_COMMAND_DEPTH` (the new node's depth is its body address length + 1,
 *   with the root program at depth 1, matching `parseCommandArray`'s `depth` argument);
 * - a page over `MAX_COMMANDS_PER_PAGE`, counted recursively over the whole tree including the
 *   inserted subtree.
 *
 * On success returns the new tree and a selection on the freshly inserted command.
 */
export function insertCommand(
  commands: readonly EventCommand[],
  selection: Selection | null,
  command: EventCommand,
): { commands: readonly EventCommand[]; selection: Selection } | null {
  const point = insertPoint(commands, selection);
  if (!point) return null;
  if (point.addr.length + 1 > MAX_COMMAND_DEPTH) return null;
  if (countEventCommands(commands) + countEventCommands([command]) > MAX_COMMANDS_PER_PAGE) {
    return null;
  }
  const next = mapBody(commands, point.addr, (body) => [
    ...body.slice(0, point.index),
    command,
    ...body.slice(point.index),
  ]);
  return { commands: next, selection: { kind: "command", addr: point.addr, index: point.index } };
}

/** Why an insert was refused, for a localized hint; `null` when it would succeed. */
export function insertRefusal(
  commands: readonly EventCommand[],
  selection: Selection | null,
  command: EventCommand,
): "depth" | "count" | null {
  const point = insertPoint(commands, selection);
  if (!point) return null;
  if (point.addr.length + 1 > MAX_COMMAND_DEPTH) return "depth";
  if (countEventCommands(commands) + countEventCommands([command]) > MAX_COMMANDS_PER_PAGE) {
    return "count";
  }
  return null;
}

/** Delete the selected command AND its whole subtree. Reselects the previous sibling, or the body's
 *  slot when the body is now empty, so the cursor never dangles on a removed node. */
export function deleteCommand(
  commands: readonly EventCommand[],
  selection: Selection | null,
): { commands: readonly EventCommand[]; selection: Selection } | null {
  if (selection?.kind !== "command") return null;
  const { addr, index } = selection;
  const next = mapBody(commands, addr, (body) => body.filter((_command, i) => i !== index));
  const body = bodyAt(next, addr);
  const reselect: Selection =
    body && body.length > 0
      ? { kind: "command", addr, index: Math.min(index, body.length - 1) }
      : { kind: "slot", addr };
  return { commands: next, selection: reselect };
}

/** Swap the selected command with its previous (`-1`) or next (`+1`) sibling in the same body; `null`
 *  at either end (nothing to swap with). Keeps the selection on the moved command. */
export function moveCommand(
  commands: readonly EventCommand[],
  selection: Selection | null,
  direction: -1 | 1,
): { commands: readonly EventCommand[]; selection: Selection } | null {
  if (selection?.kind !== "command") return null;
  const { addr, index } = selection;
  const body = bodyAt(commands, addr);
  if (!body) return null;
  const target = index + direction;
  if (target < 0 || target >= body.length) return null;
  const next = mapBody(commands, addr, (list) => {
    const copy = [...list];
    const here = copy[index];
    const there = copy[target];
    if (!here || !there) return list;
    copy[index] = there;
    copy[target] = here;
    return copy;
  });
  return { commands: next, selection: { kind: "command", addr, index: target } };
}

/** Replace the selected command with `command` (its container bodies are the caller's to preserve —
 *  editing an `if`'s condition rebuilds it keeping `then`/`else`). A no-op unless a command is
 *  selected. */
export function updateCommand(
  commands: readonly EventCommand[],
  selection: Selection | null,
  command: EventCommand,
): readonly EventCommand[] {
  if (selection?.kind !== "command") return commands;
  return mapBody(commands, selection.addr, (body) =>
    body.map((existing, i) => (i === selection.index ? command : existing)),
  );
}

/** A structural, non-selectable line: a branch introducer or an end marker that gives the flattened
 *  tree its shape. */
export type DividerKind =
  | "then"
  | "else"
  | "end-if"
  | "end-loop"
  | "end-choices"
  | { readonly optionLabel: string };

/** A selectable insertion point at the end of a body. `root` is the ◆ terminator. */
export type SlotLabel =
  | "root"
  | "then"
  | "else"
  | "loop"
  | { readonly optionIndex: number; readonly label: string };

export interface CommandRow {
  readonly key: string;
  /** Indent level; the root program is depth 1 (no indent), matching the parser's depth numbering. */
  readonly depth: number;
  readonly variant: "command" | "divider" | "slot";
  readonly command?: EventCommand;
  readonly divider?: DividerKind;
  readonly slotLabel?: SlotLabel;
  /** `null` for dividers (display only); command and slot rows carry the selection they set. */
  readonly selection: Selection | null;
}

function divider(kind: DividerKind, depth: number, addr: BodyAddr, index: number): CommandRow {
  const tag = typeof kind === "object" ? "opt" : kind;
  return {
    key: `div:${tag}:${addrKey(addr)}#${index}`,
    depth,
    variant: "divider",
    divider: kind,
    selection: null,
  };
}

function slot(addr: BodyAddr, depth: number, label: SlotLabel): CommandRow {
  return {
    key: `slot:${addrKey(addr)}`,
    depth,
    variant: "slot",
    slotLabel: label,
    selection: { kind: "slot", addr },
  };
}

function walk(
  body: readonly EventCommand[],
  addr: BodyAddr,
  depth: number,
  rows: CommandRow[],
): void {
  body.forEach((command, i) => {
    rows.push({
      key: `cmd:${addrKey(addr)}#${i}`,
      depth,
      variant: "command",
      command,
      selection: { kind: "command", addr, index: i },
    });
    if (command.t === "if") {
      const thenAddr: BodyAddr = [...addr, { index: i, branch: "then" }];
      const elseAddr: BodyAddr = [...addr, { index: i, branch: "else" }];
      rows.push(divider("then", depth + 1, thenAddr, i));
      walk(command.then, thenAddr, depth + 1, rows);
      rows.push(slot(thenAddr, depth + 1, "then"));
      rows.push(divider("else", depth + 1, elseAddr, i));
      walk(command.else, elseAddr, depth + 1, rows);
      rows.push(slot(elseAddr, depth + 1, "else"));
      rows.push(divider("end-if", depth, addr, i));
    } else if (command.t === "loop") {
      const loopAddr: BodyAddr = [...addr, { index: i, branch: "loop" }];
      walk(command.body, loopAddr, depth + 1, rows);
      rows.push(slot(loopAddr, depth + 1, "loop"));
      rows.push(divider("end-loop", depth, addr, i));
    } else if (command.t === "choices") {
      command.options.forEach((option, k) => {
        const optAddr: BodyAddr = [...addr, { index: i, branch: { option: k } }];
        rows.push(divider({ optionLabel: option.label }, depth + 1, optAddr, i));
        walk(option.body, optAddr, depth + 1, rows);
        rows.push(slot(optAddr, depth + 1, { optionIndex: k, label: option.label }));
      });
      rows.push(divider("end-choices", depth, addr, i));
    }
  });
}

/**
 * The tree as an ordered list of rows for display: each command, its bodies indented beneath it, the
 * structural dividers (`then`/`else`/option headers/end markers) that make the nesting legible, and a
 * selectable slot at the end of every body — the root's slot being the ◆ terminator. Selecting a slot
 * is how an author inserts into an otherwise-empty branch.
 */
export function flattenCommands(commands: readonly EventCommand[]): CommandRow[] {
  const rows: CommandRow[] = [];
  walk(commands, [], 1, rows);
  rows.push(slot([], 1, "root"));
  return rows;
}

export { MAX_COMMAND_DEPTH, MAX_COMMANDS_PER_PAGE };
