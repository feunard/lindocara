import { t, useLocale } from "@lindocara/client/i18n.js";
import type { AuthoredQuestDefinition, RegistryEntry } from "@lindocara/engine/adventure-state.js";
import { CONSUMABLE_IDS } from "@lindocara/engine/consumables.js";
import {
  COMMAND_TEXT_MAX,
  type EventCommand,
  type EventCondition,
  MAX_CHOICE_OPTIONS,
  WAIT_FRAMES_MAX,
  WAIT_FRAMES_MIN,
} from "@lindocara/engine/event-commands.js";
import { SELF_SWITCHES, type SelfSwitch } from "@lindocara/engine/map-events.js";
import { Button } from "@lindocara/ui/components/button.js";
import type * as React from "react";
import { useMemo, useState } from "react";
import { normalizeConditionId } from "../../game/editor-state.js";
import {
  type CommandRow,
  commandAt,
  type DividerKind,
  deleteCommand,
  flattenCommands,
  insertCommand,
  insertRefusal,
  MAX_COMMAND_DEPTH,
  MAX_COMMANDS_PER_PAGE,
  moveCommand,
  type Selection,
  type SlotLabel,
  selectionsEqual,
  updateCommand,
} from "../../game/event-command-tree.js";

/** A map an authored `teleport` may target: the adventure's member maps, carrying the dims the editor
 *  clamps the destination cell against (the runtime re-validates, but a red-cell client clamp keeps
 *  the author on the map). */
export interface TeleportMap {
  readonly mapId: string;
  readonly name: string;
  readonly cols: number;
  readonly rows: number;
}

interface EventCommandEditorProps {
  /** The page's authored program. */
  commands: readonly EventCommand[];
  /** The adventure's switch/variable registry — Selects for the set/if id fields, free text when
   *  empty. */
  switches: readonly RegistryEntry[];
  variables: readonly RegistryEntry[];
  quests?: readonly AuthoredQuestDefinition[];
  /** The adventure's maps, for a `teleport` destination Select. */
  maps: readonly TeleportMap[];
  onChange(commands: readonly EventCommand[]): void;
}

/** The picker's vocabulary, grouped exactly as the wireframe's categories (minus the deferred
 *  commands). Each entry names the opcode a fresh command carries. */
type CategoryKey =
  | "messages"
  | "quests"
  | "progression"
  | "control"
  | "character"
  | "party"
  | "other";

const COMMAND_CATEGORIES: readonly {
  readonly key: CategoryKey;
  readonly kinds: readonly EventCommand["t"][];
}[] = [
  { key: "messages", kinds: ["say", "choices"] },
  { key: "quests", kinds: ["startQuest", "advanceQuest", "completeQuest"] },
  { key: "progression", kinds: ["setSwitch", "setVariable", "setSelfSwitch"] },
  { key: "control", kinds: ["if", "loop", "breakLoop", "exitRun", "endAdventure"] },
  { key: "character", kinds: ["teleport", "wait"] },
  { key: "party", kinds: ["changeGold", "changeItems"] },
  { key: "other", kinds: ["comment"] },
];

function firstId(entries: readonly RegistryEntry[]): string {
  return entries[0]?.id ?? "0001";
}

/** A fresh command with sensible, parser-valid defaults. `teleport` needs a real map uuid, so it is
 *  only offered when the adventure has a map (`mapId` is a non-empty member id). */
function defaultCommand(
  kind: EventCommand["t"],
  ctx: {
    switches: readonly RegistryEntry[];
    variables: readonly RegistryEntry[];
    quests: readonly AuthoredQuestDefinition[];
    maps: readonly TeleportMap[];
  },
): EventCommand | null {
  switch (kind) {
    case "say":
      return { t: "say", text: "", name: null };
    case "choices":
      return { t: "choices", prompt: "", options: [{ label: "", body: [] }] };
    case "setSwitch":
      return { t: "setSwitch", switchId: firstId(ctx.switches), value: true };
    case "setVariable":
      return { t: "setVariable", variableId: firstId(ctx.variables), op: "set", value: 0 };
    case "setSelfSwitch":
      return { t: "setSelfSwitch", selfSwitch: "A", value: true };
    case "if":
      return {
        t: "if",
        cond: { type: "switch", switchId: firstId(ctx.switches) },
        then: [],
        else: [],
      };
    case "loop":
      return { t: "loop", body: [] };
    case "breakLoop":
      return { t: "breakLoop" };
    case "exitRun":
      return { t: "exitRun" };
    case "endAdventure":
      return { t: "endAdventure" };
    case "wait":
      return { t: "wait", frames: WAIT_FRAMES_MIN };
    case "teleport": {
      const mapId = ctx.maps[0]?.mapId;
      return mapId === undefined ? null : { t: "teleport", mapId, col: 0, row: 0 };
    }
    case "changeGold":
      return { t: "changeGold", amount: 1 };
    case "changeItems": {
      const itemId = CONSUMABLE_IDS[0];
      return { t: "changeItems", itemId, count: 1 };
    }
    case "startQuest": {
      const questId = ctx.quests[0]?.id;
      return questId ? { t: "startQuest", questId } : null;
    }
    case "advanceQuest": {
      const quest = ctx.quests.find((item) => item.objectives.length > 0);
      const objectiveId = quest?.objectives[0]?.id;
      return quest && objectiveId
        ? { t: "advanceQuest", questId: quest.id, objectiveId, amount: 1 }
        : null;
    }
    case "completeQuest": {
      const questId = ctx.quests[0]?.id;
      return questId ? { t: "completeQuest", questId } : null;
    }
    case "comment":
      return { t: "comment", text: "" };
    default:
      return null;
  }
}

/** Dense native select styled to sit with the shadcn controls — the same `FieldSelect` idiom
 *  `EventDialog` uses, kept local so the two command surfaces do not couple. */
function FieldSelect(props: React.ComponentProps<"select">) {
  const { className, ...rest } = props;
  return (
    <select
      className={`h-7 rounded-lg border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 ${className ?? ""}`}
      {...rest}
    />
  );
}

/** Compact number input that writes a lenient value on change and clamps on blur — the blur-normalize
 *  precedent tranche 3 set for the condition threshold, applied to every command number. */
function NumberField({
  ariaLabel,
  value,
  onChange,
  onBlur,
  className,
}: {
  ariaLabel: string;
  value: number;
  onChange(next: number): void;
  onBlur(): void;
  className?: string;
}) {
  return (
    <input
      type="number"
      aria-label={ariaLabel}
      className={`h-7 rounded-lg border border-input bg-transparent px-2 text-xs tabular-nums outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 ${className ?? ""}`}
      value={value}
      onChange={(e) => onChange(Number(e.currentTarget.value))}
      onBlur={onBlur}
    />
  );
}

/** A registry id field: a Select over the registry, or a normalized free-text input when the registry
 *  is empty (mirroring `EventDialog`'s `ConditionIdField`, the established precedent). */
function RegistryIdField({
  entries,
  value,
  ariaLabel,
  onCommit,
}: {
  entries: readonly RegistryEntry[];
  value: string;
  ariaLabel: string;
  onCommit(id: string): void;
}) {
  if (entries.length === 0) {
    return (
      <input
        aria-label={ariaLabel}
        className="h-7 w-24 rounded-lg border border-input bg-transparent px-2 text-xs tabular-nums outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        value={value}
        onChange={(e) => onCommit(e.currentTarget.value)}
        onBlur={() => onCommit(normalizeConditionId(value))}
      />
    );
  }
  const known = entries.some((entry) => entry.id === value);
  return (
    <FieldSelect
      aria-label={ariaLabel}
      className="w-44"
      value={value}
      onChange={(e) => onCommit(e.currentTarget.value)}
    >
      {!known && <option value={value}>{value}</option>}
      {entries.map((entry) => (
        <option key={entry.id} value={entry.id}>
          {entry.name ? `${entry.id} · ${entry.name}` : entry.id}
        </option>
      ))}
    </FieldSelect>
  );
}

function onOff(value: boolean): string {
  return value ? t("editor.event.cmd.on") : t("editor.event.cmd.off");
}

function conditionText(cond: EventCondition): string {
  switch (cond.type) {
    case "switch":
      return t("editor.event.cmd.cond.switch", { id: cond.switchId });
    case "variable":
      return t("editor.event.cmd.cond.variable", { id: cond.variableId, min: cond.min });
    case "selfSwitch":
      return t("editor.event.cmd.cond.selfSwitch", { sw: cond.selfSwitch });
  }
}

/** One command as its monospace list line. Ids and raw text, not registry names — the same terse
 *  grammar the wireframe shows. */
function commandLine(command: EventCommand, maps: readonly TeleportMap[]): string {
  switch (command.t) {
    case "say":
      return command.name
        ? t("editor.event.cmd.say.named", { name: command.name, text: command.text })
        : t("editor.event.cmd.say", { text: command.text });
    case "choices":
      return t("editor.event.cmd.choices", { prompt: command.prompt });
    case "setSwitch":
      return t("editor.event.cmd.setSwitch", { id: command.switchId, value: onOff(command.value) });
    case "setVariable":
      return t("editor.event.cmd.setVariable", {
        id: command.variableId,
        op: t(command.op === "set" ? "editor.event.cmd.op.set" : "editor.event.cmd.op.add"),
        value: command.value,
      });
    case "setSelfSwitch":
      return t("editor.event.cmd.setSelfSwitch", {
        sw: command.selfSwitch,
        value: onOff(command.value),
      });
    case "if":
      return t("editor.event.cmd.if", { cond: conditionText(command.cond) });
    case "loop":
      return t("editor.event.cmd.loop");
    case "breakLoop":
      return t("editor.event.cmd.breakLoop");
    case "exitRun":
      return t("editor.event.cmd.exitRun");
    case "endAdventure":
      return t("editor.event.cmd.endAdventure");
    case "wait":
      return t("editor.event.cmd.wait", { frames: command.frames });
    case "teleport": {
      const map = maps.find((m) => m.mapId === command.mapId);
      return t("editor.event.cmd.teleport", {
        map: map?.name ?? command.mapId,
        col: command.col,
        row: command.row,
      });
    }
    case "changeGold":
      return t("editor.event.cmd.changeGold", { amount: signed(command.amount) });
    case "changeItems":
      return t("editor.event.cmd.changeItems", {
        item: command.itemId,
        count: signed(command.count),
      });
    case "startQuest":
      return t("editor.event.cmd.startQuest", { id: command.questId });
    case "advanceQuest":
      return t("editor.event.cmd.advanceQuest", {
        quest: command.questId,
        objective: command.objectiveId,
        amount: signed(command.amount),
      });
    case "completeQuest":
      return t("editor.event.cmd.completeQuest", { id: command.questId });
    case "comment":
      return t("editor.event.cmd.comment", { text: command.text });
  }
}

function signed(value: number): string {
  return value >= 0 ? `+${value}` : String(value);
}

function dividerText(kind: DividerKind): string {
  if (typeof kind === "object")
    return t("editor.event.cmd.div.option", { label: kind.optionLabel });
  switch (kind) {
    case "then":
      return t("editor.event.cmd.div.then");
    case "else":
      return t("editor.event.cmd.div.else");
    case "end-if":
      return t("editor.event.cmd.div.endIf");
    case "end-loop":
      return t("editor.event.cmd.div.endLoop");
    case "end-choices":
      return t("editor.event.cmd.div.endChoices");
  }
}

function slotText(label: SlotLabel): string {
  if (typeof label === "object")
    return t("editor.event.cmd.slot.option", {
      label: label.label || String(label.optionIndex + 1),
    });
  switch (label) {
    case "root":
      return t("editor.event.cmd.slot.root");
    case "then":
      return t("editor.event.cmd.slot.then");
    case "else":
      return t("editor.event.cmd.slot.else");
    case "loop":
      return t("editor.event.cmd.slot.loop");
  }
}

/**
 * The event's command column, come alive (spec Decision 7). The indented monospace list of the page's
 * program, an Insert palette grouped by the wireframe's categories, per-command parameter editors, and
 * reorder/delete — all stock shadcn / native controls, the creator tree. It edits the page's
 * `commands` array through `onChange`; the draft, its history and its save are the dialog's concern.
 * Depth and count guards refuse an insert the parser would reject, with a localized hint, so the
 * editor can never author an unsaveable program.
 */
export function EventCommandEditor({
  commands,
  switches,
  variables,
  quests = [],
  maps,
  onChange,
}: EventCommandEditorProps) {
  useLocale();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [hint, setHint] = useState<"depth" | "count" | null>(null);

  const rows = useMemo(() => flattenCommands(commands), [commands]);
  const selected = selection ? commandAt(commands, selection) : null;
  const ctx = { switches, variables, quests, maps };

  const insert = (kind: EventCommand["t"]): void => {
    const command = defaultCommand(kind, ctx);
    if (!command) return;
    const refusal = insertRefusal(commands, selection, command);
    if (refusal) {
      setHint(refusal);
      setPickerOpen(false);
      return;
    }
    const result = insertCommand(commands, selection, command);
    if (!result) return;
    onChange(result.commands);
    setSelection(result.selection);
    setPickerOpen(false);
    setHint(null);
  };

  const remove = (): void => {
    const result = deleteCommand(commands, selection);
    if (!result) return;
    onChange(result.commands);
    setSelection(result.selection);
    setHint(null);
  };

  const move = (direction: -1 | 1): void => {
    const result = moveCommand(commands, selection, direction);
    if (!result) return;
    onChange(result.commands);
    setSelection(result.selection);
  };

  const replaceSelected = (command: EventCommand): void => {
    onChange(updateCommand(commands, selection, command));
  };

  const canMoveUp = selection?.kind === "command" && selection.index > 0;
  // A next sibling exists when the command one index further in the same body resolves.
  const canMoveDown =
    selection?.kind === "command" &&
    commandAt(commands, { kind: "command", addr: selection.addr, index: selection.index + 1 }) !==
      null;

  return (
    <section className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase">
          {t("editor.event.commands")}
        </h3>
        <div className="relative flex gap-1.5">
          <Button
            type="button"
            size="sm"
            className="h-7"
            aria-label={t("editor.event.cmd.insert")}
            aria-expanded={pickerOpen}
            onClick={() => setPickerOpen((open) => !open)}
          >
            {t("editor.event.cmd.insert")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-destructive"
            disabled={selection?.kind !== "command"}
            aria-label={t("editor.event.cmd.delete")}
            onClick={remove}
          >
            ✕
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7"
            disabled={!canMoveUp}
            aria-label={t("editor.event.cmd.moveUp")}
            onClick={() => move(-1)}
          >
            ↑
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7"
            disabled={!canMoveDown}
            aria-label={t("editor.event.cmd.moveDown")}
            onClick={() => move(1)}
          >
            ↓
          </Button>

          {pickerOpen && (
            <div
              className="absolute top-8 right-0 z-20 max-h-80 w-64 overflow-auto rounded-lg border border-zinc-200 bg-white p-1.5 shadow-xl"
              role="menu"
              aria-label={t("editor.event.cmd.insert")}
            >
              {COMMAND_CATEGORIES.map((category) => (
                <div key={category.key} className="flex flex-col">
                  <span className="px-2 pt-1.5 pb-0.5 text-[10px] font-semibold tracking-wide text-zinc-400 uppercase">
                    {t(`editor.event.cmd.cat.${category.key}`)}
                  </span>
                  {category.kinds.map((kind) => {
                    const disabled =
                      (kind === "teleport" && maps.length === 0) ||
                      ((kind === "startQuest" || kind === "completeQuest") &&
                        quests.length === 0) ||
                      (kind === "advanceQuest" &&
                        !quests.some((quest) => quest.objectives.length > 0));
                    const disabledTitle =
                      kind === "teleport"
                        ? t("editor.event.cmd.teleport.noMaps")
                        : t("editor.event.cmd.quest.noQuests");
                    return (
                      <button
                        key={kind}
                        type="button"
                        role="menuitem"
                        disabled={disabled}
                        title={disabled ? disabledTitle : undefined}
                        className="rounded-md px-2 py-1 text-left text-xs text-zinc-800 hover:bg-zinc-100 disabled:text-zinc-300 disabled:hover:bg-transparent"
                        onClick={() => insert(kind)}
                      >
                        {t(`editor.event.cmd.new.${kind}`)}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="min-h-32 flex-1 overflow-auto rounded-lg border border-zinc-200 bg-zinc-50 p-1.5 font-mono text-[11.5px]">
        {rows.map((row) => (
          <CommandRowView
            key={row.key}
            row={row}
            maps={maps}
            selected={row.selection !== null && selectionsEqual(row.selection, selection)}
            onSelect={() => {
              if (row.selection) {
                setSelection(row.selection);
                setHint(null);
              }
            }}
          />
        ))}
      </div>

      {hint && (
        <p role="alert" className="text-[11px] text-destructive">
          {hint === "count"
            ? t("editor.event.cmd.limit.count", { max: MAX_COMMANDS_PER_PAGE })
            : t("editor.event.cmd.limit.depth", { max: MAX_COMMAND_DEPTH })}
        </p>
      )}

      <div className="rounded-lg border border-zinc-200 p-2.5">
        {selected ? (
          <ParamEditor
            command={selected}
            switches={switches}
            variables={variables}
            quests={quests}
            maps={maps}
            onChange={replaceSelected}
          />
        ) : (
          <p className="text-[11.5px] text-zinc-400">{t("editor.event.cmd.selectHint")}</p>
        )}
      </div>
    </section>
  );
}

function CommandRowView({
  row,
  maps,
  selected,
  onSelect,
}: {
  row: CommandRow;
  maps: readonly TeleportMap[];
  selected: boolean;
  onSelect(): void;
}) {
  const indent = { paddingLeft: `${(row.depth - 1) * 14 + 6}px` };
  if (row.variant === "divider" && row.divider) {
    return (
      <div style={indent} className="py-0.5 text-[11px] text-zinc-400 italic">
        {dividerText(row.divider)}
      </div>
    );
  }
  if (row.variant === "slot" && row.slotLabel) {
    return (
      <button
        type="button"
        style={indent}
        aria-pressed={selected}
        aria-label={slotText(row.slotLabel)}
        onClick={onSelect}
        className={`block w-full rounded px-1 py-0.5 text-left text-[11px] ${
          selected ? "bg-indigo-100 text-indigo-800" : "text-zinc-400 hover:bg-zinc-200/60"
        }`}
      >
        ◆ {slotText(row.slotLabel)}
      </button>
    );
  }
  if (row.command) {
    return (
      <button
        type="button"
        style={indent}
        aria-pressed={selected}
        aria-label={commandLine(row.command, maps)}
        onClick={onSelect}
        className={`block w-full rounded px-1 py-0.5 text-left whitespace-pre-wrap ${
          selected ? "bg-indigo-100 text-indigo-800" : "text-zinc-700 hover:bg-zinc-200/60"
        }`}
      >
        ◇ {commandLine(row.command, maps)}
      </button>
    );
  }
  return null;
}

/** The label caption + native control pairing `EventDialog` uses, so Biome's noLabelWithoutControl
 *  stays satisfied through the accessible name rather than a `<label htmlFor>`. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="flex flex-col gap-1 text-[11px] text-zinc-500">
      {label}
      {children}
    </span>
  );
}

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function ParamEditor({
  command,
  switches,
  variables,
  quests,
  maps,
  onChange,
}: {
  command: EventCommand;
  switches: readonly RegistryEntry[];
  variables: readonly RegistryEntry[];
  quests: readonly AuthoredQuestDefinition[];
  maps: readonly TeleportMap[];
  onChange(command: EventCommand): void;
}) {
  const label = t(`editor.event.cmd.new.${command.t}`);
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase">
        {t("editor.event.cmd.param", { label })}
      </div>
      <ParamBody
        command={command}
        switches={switches}
        variables={variables}
        quests={quests}
        maps={maps}
        onChange={onChange}
      />
    </div>
  );
}

function ParamBody({
  command,
  switches,
  variables,
  quests,
  maps,
  onChange,
}: {
  command: EventCommand;
  switches: readonly RegistryEntry[];
  variables: readonly RegistryEntry[];
  quests: readonly AuthoredQuestDefinition[];
  maps: readonly TeleportMap[];
  onChange(command: EventCommand): void;
}) {
  switch (command.t) {
    case "say":
      return <SayParams command={command} onChange={onChange} />;
    case "choices":
      return <ChoicesParams command={command} onChange={onChange} />;
    case "setSwitch":
      return (
        <div className="flex flex-wrap items-end gap-2">
          <Field label={t("editor.event.cmd.field.switchId")}>
            <RegistryIdField
              entries={switches}
              value={command.switchId}
              ariaLabel={t("editor.event.cmd.field.switchId")}
              onCommit={(switchId) => onChange({ ...command, switchId })}
            />
          </Field>
          <Field label={t("editor.event.cmd.field.value")}>
            <FieldSelect
              aria-label={t("editor.event.cmd.field.value")}
              className="w-24"
              value={command.value ? "on" : "off"}
              onChange={(e) => onChange({ ...command, value: e.currentTarget.value === "on" })}
            >
              <option value="on">{t("editor.event.cmd.on")}</option>
              <option value="off">{t("editor.event.cmd.off")}</option>
            </FieldSelect>
          </Field>
        </div>
      );
    case "setVariable":
      return (
        <div className="flex flex-wrap items-end gap-2">
          <Field label={t("editor.event.cmd.field.variableId")}>
            <RegistryIdField
              entries={variables}
              value={command.variableId}
              ariaLabel={t("editor.event.cmd.field.variableId")}
              onCommit={(variableId) => onChange({ ...command, variableId })}
            />
          </Field>
          <Field label={t("editor.event.cmd.field.op")}>
            <FieldSelect
              aria-label={t("editor.event.cmd.field.op")}
              className="w-24"
              value={command.op}
              onChange={(e) =>
                onChange({ ...command, op: e.currentTarget.value === "add" ? "add" : "set" })
              }
            >
              <option value="set">{t("editor.event.cmd.op.set")}</option>
              <option value="add">{t("editor.event.cmd.op.add")}</option>
            </FieldSelect>
          </Field>
          <Field label={t("editor.event.cmd.field.value")}>
            <NumberField
              ariaLabel={t("editor.event.cmd.field.value")}
              className="w-24"
              value={command.value}
              onChange={(value) => onChange({ ...command, value })}
              onBlur={() => onChange({ ...command, value: clampInt(command.value, -1e9, 1e9, 0) })}
            />
          </Field>
        </div>
      );
    case "setSelfSwitch":
      return (
        <div className="flex flex-wrap items-end gap-2">
          <Field label={t("editor.event.cmd.field.selfSwitch")}>
            <FieldSelect
              aria-label={t("editor.event.cmd.field.selfSwitch")}
              className="w-16"
              value={command.selfSwitch}
              onChange={(e) =>
                onChange({ ...command, selfSwitch: e.currentTarget.value as SelfSwitch })
              }
            >
              {SELF_SWITCHES.map((sw) => (
                <option key={sw} value={sw}>
                  {sw}
                </option>
              ))}
            </FieldSelect>
          </Field>
          <Field label={t("editor.event.cmd.field.value")}>
            <FieldSelect
              aria-label={t("editor.event.cmd.field.value")}
              className="w-24"
              value={command.value ? "on" : "off"}
              onChange={(e) => onChange({ ...command, value: e.currentTarget.value === "on" })}
            >
              <option value="on">{t("editor.event.cmd.on")}</option>
              <option value="off">{t("editor.event.cmd.off")}</option>
            </FieldSelect>
          </Field>
        </div>
      );
    case "if":
      return (
        <ConditionParams
          cond={command.cond}
          switches={switches}
          variables={variables}
          onChange={(cond) => onChange({ ...command, cond })}
        />
      );
    case "wait":
      return (
        <Field label={t("editor.event.cmd.field.frames")}>
          <NumberField
            ariaLabel={t("editor.event.cmd.field.frames")}
            className="w-24"
            value={command.frames}
            onChange={(frames) => onChange({ ...command, frames })}
            onBlur={() =>
              onChange({
                ...command,
                frames: clampInt(command.frames, WAIT_FRAMES_MIN, WAIT_FRAMES_MAX, WAIT_FRAMES_MIN),
              })
            }
          />
        </Field>
      );
    case "teleport":
      return <TeleportParams command={command} maps={maps} onChange={onChange} />;
    case "changeGold":
      return (
        <Field label={t("editor.event.cmd.field.gold")}>
          <NumberField
            ariaLabel={t("editor.event.cmd.field.gold")}
            className="w-28"
            value={command.amount}
            onChange={(amount) => onChange({ ...command, amount })}
            onBlur={() => onChange({ ...command, amount: clampInt(command.amount, -1e9, 1e9, 0) })}
          />
        </Field>
      );
    case "changeItems":
      return (
        <div className="flex flex-wrap items-end gap-2">
          <Field label={t("editor.event.cmd.field.item")}>
            <FieldSelect
              aria-label={t("editor.event.cmd.field.item")}
              className="w-44"
              value={command.itemId}
              onChange={(e) => onChange({ ...command, itemId: e.currentTarget.value })}
            >
              {CONSUMABLE_IDS.map((id) => (
                <option key={id} value={id}>
                  {t(`consumable.${id}.name`)}
                </option>
              ))}
            </FieldSelect>
          </Field>
          <Field label={t("editor.event.cmd.field.count")}>
            <NumberField
              ariaLabel={t("editor.event.cmd.field.count")}
              className="w-24"
              value={command.count}
              onChange={(count) => onChange({ ...command, count })}
              onBlur={() => {
                const clamped = clampInt(command.count, -999, 999, 1);
                onChange({ ...command, count: clamped === 0 ? 1 : clamped });
              }}
            />
          </Field>
        </div>
      );
    case "startQuest":
    case "completeQuest":
      return (
        <QuestSelect
          quests={quests}
          value={command.questId}
          onChange={(questId) => onChange({ ...command, questId })}
        />
      );
    case "advanceQuest":
      return <QuestProgressParams command={command} quests={quests} onChange={onChange} />;
    case "comment":
      return (
        <Field label={t("editor.event.cmd.field.comment")}>
          <input
            aria-label={t("editor.event.cmd.field.comment")}
            className="h-7 w-full rounded-lg border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            maxLength={COMMAND_TEXT_MAX}
            value={command.text}
            onChange={(e) => onChange({ ...command, text: e.currentTarget.value })}
          />
        </Field>
      );
    default:
      return <p className="text-[11.5px] text-zinc-400">{t("editor.event.cmd.noParam")}</p>;
  }
}

function QuestSelect({
  quests,
  value,
  onChange,
}: {
  quests: readonly AuthoredQuestDefinition[];
  value: string;
  onChange(id: string): void;
}) {
  return (
    <Field label={t("editor.event.cmd.field.quest")}>
      <FieldSelect
        aria-label={t("editor.event.cmd.field.quest")}
        className="w-full"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        {quests.map((quest) => (
          <option key={quest.id} value={quest.id}>
            {quest.title || quest.id}
          </option>
        ))}
      </FieldSelect>
    </Field>
  );
}

function QuestProgressParams({
  command,
  quests,
  onChange,
}: {
  command: Extract<EventCommand, { t: "advanceQuest" }>;
  quests: readonly AuthoredQuestDefinition[];
  onChange(command: EventCommand): void;
}) {
  const quest = quests.find((item) => item.id === command.questId) ?? quests[0];
  const objectives = quest?.objectives ?? [];
  return (
    <div className="flex flex-wrap items-end gap-2">
      <QuestSelect
        quests={quests}
        value={command.questId}
        onChange={(questId) => {
          const selected = quests.find((item) => item.id === questId);
          onChange({
            ...command,
            questId,
            objectiveId: selected?.objectives[0]?.id ?? command.objectiveId,
          });
        }}
      />
      <Field label={t("editor.event.cmd.field.objective")}>
        <FieldSelect
          aria-label={t("editor.event.cmd.field.objective")}
          className="w-48"
          value={command.objectiveId}
          onChange={(event) => onChange({ ...command, objectiveId: event.currentTarget.value })}
        >
          {objectives.map((objective) => (
            <option key={objective.id} value={objective.id}>
              {objective.label || objective.id}
            </option>
          ))}
        </FieldSelect>
      </Field>
      <Field label={t("editor.event.cmd.field.amount")}>
        <NumberField
          ariaLabel={t("editor.event.cmd.field.amount")}
          className="w-20"
          value={command.amount}
          onChange={(amount) => onChange({ ...command, amount })}
          onBlur={() => {
            const amount = clampInt(command.amount, -999, 999, 1);
            onChange({ ...command, amount: amount === 0 ? 1 : amount });
          }}
        />
      </Field>
    </div>
  );
}

function SayParams({
  command,
  onChange,
}: {
  command: Extract<EventCommand, { t: "say" }>;
  onChange(command: EventCommand): void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Field label={t("editor.event.cmd.field.name")}>
        <input
          aria-label={t("editor.event.cmd.field.name")}
          className="h-7 w-44 rounded-lg border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          maxLength={COMMAND_TEXT_MAX}
          value={command.name ?? ""}
          onChange={(e) => {
            const name = e.currentTarget.value;
            onChange({ ...command, name: name === "" ? null : name });
          }}
        />
      </Field>
      <Field label={t("editor.event.cmd.field.text")}>
        <textarea
          aria-label={t("editor.event.cmd.field.text")}
          className="h-16 w-full resize-none rounded-lg border border-input bg-transparent px-2 py-1.5 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          maxLength={COMMAND_TEXT_MAX}
          value={command.text}
          onChange={(e) => onChange({ ...command, text: e.currentTarget.value })}
        />
      </Field>
      <span className="text-right text-[10px] text-zinc-400 tabular-nums">
        {t("editor.event.cmd.field.charCount", { n: command.text.length, max: COMMAND_TEXT_MAX })}
      </span>
    </div>
  );
}

function ChoicesParams({
  command,
  onChange,
}: {
  command: Extract<EventCommand, { t: "choices" }>;
  onChange(command: EventCommand): void;
}) {
  const setLabel = (index: number, label: string): void => {
    onChange({
      ...command,
      options: command.options.map((option, i) => (i === index ? { ...option, label } : option)),
    });
  };
  const addOption = (): void => {
    if (command.options.length >= MAX_CHOICE_OPTIONS) return;
    onChange({ ...command, options: [...command.options, { label: "", body: [] }] });
  };
  const removeOption = (index: number): void => {
    if (command.options.length <= 1) return;
    onChange({ ...command, options: command.options.filter((_option, i) => i !== index) });
  };
  return (
    <div className="flex flex-col gap-2">
      <Field label={t("editor.event.cmd.field.prompt")}>
        <input
          aria-label={t("editor.event.cmd.field.prompt")}
          className="h-7 w-full rounded-lg border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          maxLength={COMMAND_TEXT_MAX}
          value={command.prompt}
          onChange={(e) => onChange({ ...command, prompt: e.currentTarget.value })}
        />
      </Field>
      <div className="flex flex-col gap-1.5">
        {command.options.map((option, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: options are positional, no stable id
          <div key={index} className="flex items-center gap-1.5">
            <input
              aria-label={t("editor.event.cmd.field.option", { n: index + 1 })}
              className="h-7 flex-1 rounded-lg border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              maxLength={COMMAND_TEXT_MAX}
              value={option.label}
              onChange={(e) => setLabel(index, e.currentTarget.value)}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-destructive"
              disabled={command.options.length <= 1}
              aria-label={t("editor.event.cmd.field.removeOption", { n: index + 1 })}
              onClick={() => removeOption(index)}
            >
              ✕
            </Button>
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 self-start"
        disabled={command.options.length >= MAX_CHOICE_OPTIONS}
        aria-label={t("editor.event.cmd.field.addOption")}
        onClick={addOption}
      >
        {t("editor.event.cmd.field.addOption")}
      </Button>
    </div>
  );
}

function ConditionParams({
  cond,
  switches,
  variables,
  onChange,
}: {
  cond: EventCondition;
  switches: readonly RegistryEntry[];
  variables: readonly RegistryEntry[];
  onChange(cond: EventCondition): void;
}) {
  const changeType = (type: EventCondition["type"]): void => {
    if (type === cond.type) return;
    if (type === "switch") onChange({ type: "switch", switchId: firstId(switches) });
    else if (type === "variable")
      onChange({ type: "variable", variableId: firstId(variables), min: 0 });
    else onChange({ type: "selfSwitch", selfSwitch: "A" });
  };
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label={t("editor.event.cmd.field.condType")}>
        <FieldSelect
          aria-label={t("editor.event.cmd.field.condType")}
          className="w-32"
          value={cond.type}
          onChange={(e) => changeType(e.currentTarget.value as EventCondition["type"])}
        >
          <option value="switch">{t("editor.event.cmd.field.switchId")}</option>
          <option value="variable">{t("editor.event.cmd.field.variableId")}</option>
          <option value="selfSwitch">{t("editor.event.cmd.field.selfSwitch")}</option>
        </FieldSelect>
      </Field>
      {cond.type === "switch" && (
        <Field label={t("editor.event.cmd.field.switchId")}>
          <RegistryIdField
            entries={switches}
            value={cond.switchId}
            ariaLabel={t("editor.event.cmd.field.switchId")}
            onCommit={(switchId) => onChange({ type: "switch", switchId })}
          />
        </Field>
      )}
      {cond.type === "variable" && (
        <>
          <Field label={t("editor.event.cmd.field.variableId")}>
            <RegistryIdField
              entries={variables}
              value={cond.variableId}
              ariaLabel={t("editor.event.cmd.field.variableId")}
              onCommit={(variableId) => onChange({ type: "variable", variableId, min: cond.min })}
            />
          </Field>
          <Field label={t("editor.event.cmd.field.min")}>
            <NumberField
              ariaLabel={t("editor.event.cmd.field.min")}
              className="w-24"
              value={cond.min}
              onChange={(min) => onChange({ type: "variable", variableId: cond.variableId, min })}
              onBlur={() =>
                onChange({
                  type: "variable",
                  variableId: cond.variableId,
                  min: clampInt(cond.min, 0, 1e9, 0),
                })
              }
            />
          </Field>
        </>
      )}
      {cond.type === "selfSwitch" && (
        <Field label={t("editor.event.cmd.field.selfSwitch")}>
          <FieldSelect
            aria-label={t("editor.event.cmd.field.selfSwitch")}
            className="w-16"
            value={cond.selfSwitch}
            onChange={(e) =>
              onChange({ type: "selfSwitch", selfSwitch: e.currentTarget.value as SelfSwitch })
            }
          >
            {SELF_SWITCHES.map((sw) => (
              <option key={sw} value={sw}>
                {sw}
              </option>
            ))}
          </FieldSelect>
        </Field>
      )}
    </div>
  );
}

function TeleportParams({
  command,
  maps,
  onChange,
}: {
  command: Extract<EventCommand, { t: "teleport" }>;
  maps: readonly TeleportMap[];
  onChange(command: EventCommand): void;
}) {
  const map = maps.find((m) => m.mapId === command.mapId);
  const maxCol = map ? map.cols - 1 : 0;
  const maxRow = map ? map.rows - 1 : 0;
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label={t("editor.event.cmd.field.map")}>
        <FieldSelect
          aria-label={t("editor.event.cmd.field.map")}
          className="w-44"
          value={command.mapId}
          onChange={(e) => {
            const mapId = e.currentTarget.value;
            const next = maps.find((m) => m.mapId === mapId);
            onChange({
              ...command,
              mapId,
              col: next ? clampInt(command.col, 0, next.cols - 1, 0) : command.col,
              row: next ? clampInt(command.row, 0, next.rows - 1, 0) : command.row,
            });
          }}
        >
          {maps.map((m) => (
            <option key={m.mapId} value={m.mapId}>
              {m.name}
            </option>
          ))}
        </FieldSelect>
      </Field>
      <Field label={t("editor.event.cmd.field.col")}>
        <NumberField
          ariaLabel={t("editor.event.cmd.field.col")}
          className="w-20"
          value={command.col}
          onChange={(col) => onChange({ ...command, col })}
          onBlur={() => onChange({ ...command, col: clampInt(command.col, 0, maxCol, 0) })}
        />
      </Field>
      <Field label={t("editor.event.cmd.field.row")}>
        <NumberField
          ariaLabel={t("editor.event.cmd.field.row")}
          className="w-20"
          value={command.row}
          onChange={(row) => onChange({ ...command, row })}
          onBlur={() => onChange({ ...command, row: clampInt(command.row, 0, maxRow, 0) })}
        />
      </Field>
    </div>
  );
}
