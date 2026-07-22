import type { AdventureRegistry, RegistryEntry } from "@lindocara/engine/adventure-state.js";
import { CURATED_MONSTER_SPECIES, type MonsterSpecies } from "@lindocara/engine/game.js";
import type { MessageKey } from "@lindocara/engine/i18n/index.js";
import { MAX_PATROL_RADIUS, MIN_PATROL_RADIUS } from "@lindocara/engine/map-data.js";
import {
  EVENT_NAME_MAX,
  EVENT_TRIGGERS,
  type EventTrigger,
  MAX_PAGES_PER_EVENT,
  type MapEvent,
  type MapEventPage,
  MOVE_TYPES,
  type MoveType,
  SELF_SWITCHES,
  type SelfSwitch,
  validateEventName,
} from "@lindocara/engine/map-events.js";
import type * as React from "react";
import { useState } from "react";
import {
  addEventDraftPage,
  deleteEventDraftPage,
  normalizeConditionId,
  normalizeConditionMin,
  normalizeEventDraftConditions,
  setEventDraftMonster,
  setEventDraftName,
  updateEventDraftPage,
} from "../../game/editor-state.js";
import { t, useLocale } from "../../i18n.js";
import { Button } from "../components/button.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/dialog.js";
import { Input } from "../components/input.js";
import { CatalogueAssetPicker } from "./CatalogueAssetPicker.js";
import { EventCommandEditor, type TeleportMap } from "./EventCommandEditor.js";

/** The wireframe's friendly `EV{ordinal}` display id, zero-padded to three digits. Display only —
 *  identity is the uuid. Duplicated (rather than imported from `map-editor-stage`) so this React
 *  dialog does not pull the Pixi stage module into its bundle for a one-line format. */
function eventDisplayId(ordinal: number): string {
  return `EV${String(ordinal).padStart(3, "0")}`;
}

/** The wireframe's move-speed range: shared `moveSpeed` is 0-5 (six steps). */
const SPEED_VALUES = [0, 1, 2, 3, 4, 5] as const;
/** The wireframe's move-frequency range: shared `moveFreq` is 0-4 (five steps). */
const FREQ_VALUES = [0, 1, 2, 3, 4] as const;

/** The five per-page boolean options, in the wireframe's order, paired with their `MapEventPage`
 *  field. */
const OPTION_FIELDS: readonly (keyof Pick<
  MapEventPage,
  "optMoveAnim" | "optStopAnim" | "optDirFix" | "optThrough" | "optOnTop"
>)[] = ["optMoveAnim", "optStopAnim", "optDirFix", "optThrough", "optOnTop"];

const OPTION_KEY: Record<(typeof OPTION_FIELDS)[number], MessageKey> = {
  optMoveAnim: "editor.event.opt.moveAnim",
  optStopAnim: "editor.event.opt.stopAnim",
  optDirFix: "editor.event.opt.dirFix",
  optThrough: "editor.event.opt.through",
  optOnTop: "editor.event.opt.onTop",
};

/** Dense native select styled to sit with the shadcn `Input`, mirroring `AdventureSettingsDialog`'s
 *  `FieldSelect`. Native so the movement/trigger pickers stay keyboard- and test-driveable, unlike a
 *  portalled listbox. */
function FieldSelect(props: React.ComponentProps<"select">) {
  const { className, ...rest } = props;
  return (
    <select
      className={`h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 ${className ?? ""}`}
      {...rest}
    />
  );
}

/** The default id a freshly enabled condition takes: the first registry entry of its kind when the
 *  registry has any, else the `"0001"` wire-legal placeholder the free-text fallback expects. */
function defaultConditionId(entries: readonly RegistryEntry[]): string {
  return entries[0]?.id ?? "0001";
}

/**
 * A condition's id field: a native `FieldSelect` over the registry (`0001 · name`) once the registry
 * has entries, else the normalized free-text `Input` — the same blur-normalization tranche 3 built,
 * kept for the empty-registry path. The select carries an extra option for the current value when it
 * names nothing in the registry (an id orphaned by a since-deleted entry), so opening a page never
 * silently rewrites its stored id.
 */
function ConditionIdField({
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
      <Input
        aria-label={ariaLabel}
        className="h-7 w-20 text-xs tabular-nums"
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
      className="h-7 w-44 text-xs"
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

/** A checkbox that enables one condition row: checking it seeds a default value, unchecking it clears
 *  the row to `null` (a variable clears both its id and threshold). Native input so it stays
 *  test-driveable and keyboard-efficient. */
function CheckRow({
  checked,
  onToggle,
  label,
  children,
}: {
  checked: boolean;
  onToggle(next: boolean): void;
  label: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="flex flex-none items-center gap-2 text-[12.5px] text-zinc-700">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onToggle(event.currentTarget.checked)}
        />
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * A monster event's kind-specific fields: every runtime-supported species and a bounded patrol
 * radius. Edits fold straight into the draft through `setEventDraftMonster`; a `monster` draft
 * always carries a non-null species/radius, so the `??` fallbacks only guard the impossible.
 */
function MonsterEventFields({
  draft,
  onChange,
}: {
  draft: MapEvent;
  onChange(species: MonsterSpecies, patrolRadius: number): void;
}) {
  const species = draft.species ?? CURATED_MONSTER_SPECIES[0] ?? "spear_goblin";
  const patrolRadius = draft.patrolRadius ?? MIN_PATROL_RADIUS;
  const options = CURATED_MONSTER_SPECIES.includes(species)
    ? CURATED_MONSTER_SPECIES
    : [species, ...CURATED_MONSTER_SPECIES];
  return (
    <section className="flex flex-col gap-2 border-y border-zinc-200 py-3">
      <div className="grid grid-cols-2 gap-3">
        <span className="flex flex-col gap-1 text-[11px] text-zinc-500">
          {t("editor.markers.species")}
          <FieldSelect
            aria-label={t("editor.markers.species")}
            className="h-8 text-sm"
            value={species}
            onChange={(e) => onChange(e.currentTarget.value as MonsterSpecies, patrolRadius)}
          >
            {options.map((option) => (
              <option key={option} value={option}>
                {t(`monster.${option}`)}
              </option>
            ))}
          </FieldSelect>
        </span>
        <span className="flex flex-col gap-1 text-[11px] text-zinc-500">
          {t("editor.markers.radius")}
          <Input
            aria-label={t("editor.markers.radius")}
            type="number"
            className="h-8 text-sm tabular-nums"
            min={MIN_PATROL_RADIUS}
            max={MAX_PATROL_RADIUS}
            value={patrolRadius}
            onChange={(e) => onChange(species, Number(e.currentTarget.value))}
          />
        </span>
      </div>
    </section>
  );
}

interface EventDialogProps {
  /** The draft seed: a deep copy of the event to edit, from `beginEventDraft`. */
  event: MapEvent;
  /** The loaded adventure's switch/variable registry. Its entries drive the condition pickers; an
   *  empty registry falls the id fields back to normalized free text with a hint. */
  registry: AdventureRegistry;
  /** The adventure's member maps, for a `teleport` command's destination Select (with its dims for
   *  the client-side cell clamp). Empty disables the teleport command in the insert palette. */
  maps: readonly TeleportMap[];
  /** Commit the edited draft as one history entry. */
  onCommit(draft: MapEvent): void;
  /** Delete the event (its own history entry). */
  onDelete(): void;
  /** Close without writing anything back. */
  onCancel(): void;
}

/**
 * The wireframe's event editor, in stock shadcn. It edits a detached draft (a `MapEvent` copy the
 * caller seeds from `beginEventDraft`): every keystroke folds into local state through the pure
 * `editor-state` draft mutators, and only Save writes back — as ONE history entry — while Cancel
 * simply drops the draft. Nothing here executes; conditions, movement, options and trigger are
 * authored data for a later tranche.
 *
 * Normal pages and monster defeat hooks share the live command editor and authoritative runtime
 * interpreter.
 */
export function EventDialog({
  event,
  registry,
  maps,
  onCommit,
  onDelete,
  onCancel,
}: EventDialogProps) {
  useLocale();
  const [draft, setDraft] = useState<MapEvent>(event);
  const [pageIndex, setPageIndex] = useState(0);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const index = Math.min(pageIndex, draft.pages.length - 1);
  const page = draft.pages[index];
  if (!page) return null;

  const update = (patch: Partial<MapEventPage>): void => {
    setDraft(updateEventDraftPage(draft, index, patch));
  };

  const addPage = (): void => {
    const next = addEventDraftPage(draft);
    if (!next) return;
    setDraft(next);
    setPageIndex(next.pages.length - 1);
  };

  const deletePage = (): void => {
    const next = deleteEventDraftPage(draft, index);
    if (!next) return;
    setDraft(next);
    setPageIndex(Math.min(index, next.pages.length - 1));
  };

  const save = (): void => {
    // Re-normalize every page's condition ids/threshold here too — the per-field blur handlers
    // below cover the mouse path, but Save can fire via keyboard shortcut while a field is still
    // focused, and a blur that never happened must not let a stray free-text id reach the parser.
    const normalized = normalizeEventDraftConditions(draft);
    // The wireframe's `normEv`: an empty name persists as the `EV{ordinal}` string, never blank.
    const trimmed = validateEventName(normalized.name) ?? "";
    const name = trimmed === "" ? eventDisplayId(normalized.ordinal) : trimmed;
    onCommit(setEventDraftName(normalized, name));
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader className="flex-row items-center gap-3">
          <div className="flex flex-1 flex-col gap-0.5">
            <DialogTitle>{t("editor.event.dialog.title")}</DialogTitle>
            <span className="text-xs text-muted-foreground">
              {t("editor.event.dialog.caption", {
                id: eventDisplayId(draft.ordinal),
                col: draft.col,
                row: draft.row,
              })}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
              {t("editor.event.name")}
            </span>
            <Input
              aria-label={t("editor.event.name")}
              className="h-8 w-56"
              maxLength={EVENT_NAME_MAX}
              placeholder={eventDisplayId(draft.ordinal)}
              value={draft.name}
              onChange={(e) => setDraft(setEventDraftName(draft, e.currentTarget.value))}
            />
          </div>
        </DialogHeader>

        {/* Monster events carry species, patrol radius and one focused on-defeat program — a dense
            kind-specific block that replaces the normal event's page/condition machinery. */}
        {draft.kind === "monster" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <MonsterEventFields
              draft={draft}
              onChange={(species, radius) => setDraft(setEventDraftMonster(draft, species, radius))}
            />
            <div className="rounded-lg border border-zinc-200 p-3">
              <p className="mb-2 text-xs text-muted-foreground">
                {t("editor.event.monster.defeatHint")}
              </p>
              <EventCommandEditor
                commands={page.commands}
                switches={registry.switches}
                variables={registry.variables}
                quests={registry.quests ?? []}
                maps={maps}
                onChange={(commands) => update({ commands })}
              />
            </div>
          </div>
        )}

        {/* Entry/exit/spawn events are pure anchors: their only field is the label (the header Name
            input), so no body is shown — a hint states what the placement binds. */}
        {(draft.kind === "entry" || draft.kind === "exit" || draft.kind === "spawn") && (
          <p className="border-y border-zinc-200 py-3 text-[12.5px] text-muted-foreground">
            {t("editor.event.kind.anchor.hint")}
          </p>
        )}

        {/* The full paged editor belongs to normal events. Entry/exit remain pure anchors; monsters
            expose only their focused on-defeat program below. */}
        {draft.kind === "normal" && (
          <>
            {/* Page tabs: 1..n, add (≤ MAX_PAGES_PER_EVENT), delete (disabled at one page). */}
            <div
              className="flex flex-wrap items-center gap-1.5 border-y border-zinc-200 py-2"
              role="tablist"
              aria-label={t("editor.event.pages.aria")}
            >
              {draft.pages.map((_page, i) => (
                <button
                  // biome-ignore lint/suspicious/noArrayIndexKey: pages are positional, no stable id
                  key={i}
                  type="button"
                  role="tab"
                  aria-selected={i === index}
                  aria-label={t("editor.event.page.aria", { n: i + 1 })}
                  onClick={() => setPageIndex(i)}
                  className={`h-7 min-w-7 rounded-md px-2 text-[12px] font-medium tabular-nums ${
                    i === index ? "bg-zinc-900 text-zinc-50" : "text-zinc-600 hover:bg-zinc-200/70"
                  }`}
                >
                  {i + 1}
                </button>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7"
                disabled={draft.pages.length >= MAX_PAGES_PER_EVENT}
                aria-label={t("editor.event.page.add")}
                onClick={addPage}
              >
                +
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-destructive"
                disabled={draft.pages.length <= 1}
                aria-label={t("editor.event.page.delete")}
                onClick={deletePage}
              >
                {t("editor.event.page.delete")}
              </Button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {/* Left column: the authored page fields. */}
              <div className="flex flex-col gap-4">
                <section className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3">
                  <h3 className="text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase">
                    {t("editor.event.conditions")}
                  </h3>
                  <CheckRow
                    checked={page.condSwitchId !== null}
                    onToggle={(on) =>
                      update({ condSwitchId: on ? defaultConditionId(registry.switches) : null })
                    }
                    label={t("editor.event.cond.switch")}
                  >
                    {page.condSwitchId !== null && (
                      <>
                        <ConditionIdField
                          entries={registry.switches}
                          value={page.condSwitchId}
                          ariaLabel={t("editor.event.cond.switch")}
                          onCommit={(id) => update({ condSwitchId: id })}
                        />
                        <span className="text-[12.5px] text-zinc-500">
                          {t("editor.event.cond.switch.on")}
                        </span>
                      </>
                    )}
                  </CheckRow>
                  {page.condSwitchId !== null && registry.switches.length === 0 && (
                    <p className="pl-6 text-[11px] text-zinc-400">
                      {t("editor.event.cond.empty.hint")}
                    </p>
                  )}
                  <CheckRow
                    checked={page.condVariableId !== null}
                    onToggle={(on) =>
                      update(
                        on
                          ? {
                              condVariableId: defaultConditionId(registry.variables),
                              condVariableMin: 0,
                            }
                          : { condVariableId: null, condVariableMin: null },
                      )
                    }
                    label={t("editor.event.cond.variable")}
                  >
                    {page.condVariableId !== null && (
                      <>
                        <ConditionIdField
                          entries={registry.variables}
                          value={page.condVariableId}
                          ariaLabel={t("editor.event.cond.variable")}
                          onCommit={(id) => update({ condVariableId: id })}
                        />
                        <span className="text-[12.5px] text-zinc-500">≥</span>
                        <Input
                          aria-label={t("editor.event.cond.variable.min")}
                          type="number"
                          className="h-7 w-20 text-xs tabular-nums"
                          value={page.condVariableMin ?? 0}
                          onChange={(e) =>
                            update({ condVariableMin: Number(e.currentTarget.value) })
                          }
                          onBlur={() => {
                            if (page.condVariableMin !== null)
                              update({
                                condVariableMin: normalizeConditionMin(page.condVariableMin),
                              });
                          }}
                        />
                      </>
                    )}
                  </CheckRow>
                  {page.condVariableId !== null && registry.variables.length === 0 && (
                    <p className="pl-6 text-[11px] text-zinc-400">
                      {t("editor.event.cond.empty.hint")}
                    </p>
                  )}
                  <CheckRow
                    checked={page.condSelfSwitch !== null}
                    onToggle={(on) => update({ condSelfSwitch: on ? "A" : null })}
                    label={t("editor.event.cond.selfSwitch")}
                  >
                    <FieldSelect
                      aria-label={t("editor.event.cond.selfSwitch")}
                      className="h-7 w-16 text-xs"
                      disabled={page.condSelfSwitch === null}
                      value={page.condSelfSwitch ?? "A"}
                      onChange={(e) =>
                        update({ condSelfSwitch: e.currentTarget.value as SelfSwitch })
                      }
                    >
                      {SELF_SWITCHES.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </FieldSelect>
                  </CheckRow>
                </section>

                <section className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3">
                  <h3 className="text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase">
                    {t("editor.event.appearance")}
                  </h3>
                  <CatalogueAssetPicker
                    usage="event"
                    value={page.graphicAssetId}
                    onSelectAsset={(assetId) => update({ graphicAssetId: assetId })}
                    onSelectNone={() => update({ graphicAssetId: null })}
                    noneLabel={t("editor.shell.events.graphic.none")}
                  />
                </section>

                <section className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3">
                  <h3 className="text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase">
                    {t("editor.event.movement")}
                  </h3>
                  <div className="grid grid-cols-3 gap-2">
                    {/* A `<span>` caption + `aria-label`, not a `<label>` wrapping the select: Biome's
                    noLabelWithoutControl cannot see the native `<select>` through the `FieldSelect`
                    component, so the label/control pairing lives on the accessible name instead. */}
                    <span className="flex flex-col gap-1 text-[11px] text-zinc-500">
                      {t("editor.event.move.type")}
                      <FieldSelect
                        aria-label={t("editor.event.move.type")}
                        className="h-7 text-xs"
                        value={page.moveType}
                        onChange={(e) => update({ moveType: e.currentTarget.value as MoveType })}
                      >
                        {MOVE_TYPES.map((option) => (
                          <option key={option} value={option}>
                            {t(`editor.event.moveType.${option}`)}
                          </option>
                        ))}
                      </FieldSelect>
                    </span>
                    <span className="flex flex-col gap-1 text-[11px] text-zinc-500">
                      {t("editor.event.move.speed")}
                      <FieldSelect
                        aria-label={t("editor.event.move.speed")}
                        className="h-7 text-xs"
                        value={page.moveSpeed}
                        onChange={(e) => update({ moveSpeed: Number(e.currentTarget.value) })}
                      >
                        {SPEED_VALUES.map((value) => (
                          <option key={value} value={value}>
                            {t(`editor.event.speed.${value}`)}
                          </option>
                        ))}
                      </FieldSelect>
                    </span>
                    <span className="flex flex-col gap-1 text-[11px] text-zinc-500">
                      {t("editor.event.move.freq")}
                      <FieldSelect
                        aria-label={t("editor.event.move.freq")}
                        className="h-7 text-xs"
                        value={page.moveFreq}
                        onChange={(e) => update({ moveFreq: Number(e.currentTarget.value) })}
                      >
                        {FREQ_VALUES.map((value) => (
                          <option key={value} value={value}>
                            {t(`editor.event.freq.${value}`)}
                          </option>
                        ))}
                      </FieldSelect>
                    </span>
                  </div>
                </section>

                <section className="flex gap-4 rounded-lg border border-zinc-200 p-3">
                  <div className="flex flex-1 flex-col gap-2">
                    <h3 className="text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase">
                      {t("editor.event.options")}
                    </h3>
                    {OPTION_FIELDS.map((field) => (
                      <label
                        key={field}
                        className="flex items-center gap-2 text-[12.5px] text-zinc-700"
                      >
                        <input
                          type="checkbox"
                          checked={page[field]}
                          onChange={(e) => update({ [field]: e.currentTarget.checked })}
                        />
                        {t(OPTION_KEY[field])}
                      </label>
                    ))}
                  </div>
                  <div className="flex w-44 flex-none flex-col gap-2">
                    <h3 className="text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase">
                      {t("editor.event.trigger")}
                    </h3>
                    <FieldSelect
                      aria-label={t("editor.event.trigger")}
                      className="h-7 text-xs"
                      value={page.trigger}
                      onChange={(e) => update({ trigger: e.currentTarget.value as EventTrigger })}
                    >
                      {EVENT_TRIGGERS.map((option) => (
                        <option key={option} value={option}>
                          {t(`editor.event.trigger.${option}`)}
                        </option>
                      ))}
                    </FieldSelect>
                  </div>
                </section>
              </div>

              {/* Right column: the page's command program. */}
              <EventCommandEditor
                commands={page.commands}
                switches={registry.switches}
                variables={registry.variables}
                quests={registry.quests ?? []}
                maps={maps}
                onChange={(commands) => update({ commands })}
              />
            </div>
          </>
        )}

        <DialogFooter className="items-center sm:justify-between">
          <Button variant="destructive" size="sm" onClick={() => setConfirmingDelete(true)}>
            {t("editor.event.delete")}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onCancel}>
              {t("editor.event.cancel")}
            </Button>
            <Button onClick={save}>{t("editor.event.save")}</Button>
          </div>
        </DialogFooter>

        <Dialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("editor.event.delete.confirm.title")}</DialogTitle>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmingDelete(false)}>
                {t("editor.event.cancel")}
              </Button>
              <Button variant="destructive" onClick={onDelete}>
                {t("editor.event.delete")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
