import { t, useLocale } from "@lindocara/client/i18n.js";
import type { AdventureRegistry, RegistryEntry } from "@lindocara/engine/adventure-state.js";
import {
  CURATED_MONSTER_SPECIES,
  defaultMonsterTuning,
  MONSTER_RANKS,
  MONSTER_RESPAWN_MODES,
  MONSTER_TUNING_LIMITS,
  MONSTER_WEAKNESSES,
  type MonsterRespawnMode,
  type MonsterSpecies,
  type MonsterTuning,
  monsterSpecialTechniquesFor,
} from "@lindocara/engine/game.js";
import { MAX_PATROL_RADIUS, MIN_PATROL_RADIUS } from "@lindocara/engine/map-data.js";
import {
  EVENT_NAME_MAX,
  type EventTrigger,
  MAX_PAGES_PER_EVENT,
  type MapEvent,
  type MapEventPage,
  MOVE_TYPES,
  SELF_SWITCHES,
  type SelfSwitch,
  validateEventName,
} from "@lindocara/engine/map-events.js";
import { Button } from "@lindocara/ui/components/button.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@lindocara/ui/components/dialog.js";
import { Input } from "@lindocara/ui/components/input.js";
import { CircleHelp } from "lucide-react";
import type * as React from "react";
import { useState } from "react";
import {
  addEventDraftPage,
  deleteEventDraftPage,
  normalizeConditionMin,
  normalizeEventDraftConditions,
  setEventDraftGuardRadius,
  setEventDraftMonster,
  setEventDraftMonsterRespawnMode,
  setEventDraftName,
  setEventDraftNpc,
  updateEventDraftPage,
} from "../../game/editor-state.js";
import { CatalogueAssetPicker } from "./CatalogueAssetPicker.js";
import { EventCommandEditor, type TeleportMap } from "./EventCommandEditor.js";

/** The wireframe's friendly `EV{ordinal}` display id, zero-padded to three digits. Display only —
 *  identity is the uuid. Duplicated (rather than imported from `map-editor-stage`) so this React
 *  dialog does not pull the Pixi stage module into its bundle for a one-line format. */
function eventDisplayId(ordinal: number): string {
  return `EV${String(ordinal).padStart(3, "0")}`;
}

/** The World runtime currently detects these two edges. Older persisted trigger values remain
 * parseable for compatibility, but the editor labels them as legacy rather than implying that an
 * autonomous/event-touch executor exists. */
const RUNTIME_EVENT_TRIGGERS = [
  "action",
  "player-touch",
] as const satisfies readonly EventTrigger[];
const NPC_MOVE_SPEEDS = [0, 1, 2, 3, 4, 5] as const;
const NPC_MOVE_FREQUENCIES = [0, 1, 2, 3, 4] as const;

function runtimeTrigger(trigger: EventTrigger): boolean {
  return (RUNTIME_EVENT_TRIGGERS as readonly EventTrigger[]).includes(trigger);
}

/** Dense native select styled to sit with the shadcn `Input`, mirroring `AdventureSettingsDialog`'s
 *  `FieldSelect`. Native so the condition/trigger pickers stay keyboard- and test-driveable. */
function FieldSelect(props: React.ComponentProps<"select">) {
  const { className, ...rest } = props;
  return (
    <select
      className={`h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 ${className ?? ""}`}
      {...rest}
    />
  );
}

/** A newly enabled condition always starts with the first authored value of its kind. */
function defaultConditionId(entries: readonly RegistryEntry[]): string | null {
  return entries[0]?.id ?? null;
}

/**
 * A condition's named-value picker. A deleted reference is shown as missing and can be replaced or
 * disabled; an author never has to type or understand its internal id.
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
      <FieldSelect aria-label={ariaLabel} className="h-7 w-44 text-xs" disabled value={value}>
        <option value={value}>{t("editor.event.cond.missing")}</option>
      </FieldSelect>
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
      {!known && <option value={value}>{t("editor.event.cond.missing")}</option>}
      {entries.map((entry) => (
        <option key={entry.id} value={entry.id}>
          {entry.name || t("editor.registry.unnamed")}
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
  disabled = false,
  onToggle,
  label,
  children,
}: {
  checked: boolean;
  disabled?: boolean;
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
          disabled={disabled}
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
  onChange(
    species: MonsterSpecies,
    patrolRadius: number,
    tuning?: Partial<MonsterTuning>,
    respawnMode?: MonsterRespawnMode,
  ): void;
}) {
  const species = draft.species ?? CURATED_MONSTER_SPECIES[0] ?? "spear_goblin";
  const patrolRadius = draft.patrolRadius ?? MIN_PATROL_RADIUS;
  const defaults = defaultMonsterTuning(species);
  const tuning: MonsterTuning = {
    rank: draft.monsterRank ?? defaults.rank,
    maxHp: draft.monsterMaxHp ?? defaults.maxHp,
    damage: draft.monsterDamage ?? defaults.damage,
    speed: draft.monsterSpeed ?? defaults.speed,
    xp: draft.monsterXp ?? defaults.xp,
    weakness: draft.monsterWeakness ?? defaults.weakness,
    weaknessPercent: draft.monsterWeaknessPercent ?? defaults.weaknessPercent,
    specialTechnique: draft.monsterSpecialTechnique ?? defaults.specialTechnique,
  };
  const options = CURATED_MONSTER_SPECIES.includes(species)
    ? CURATED_MONSTER_SPECIES
    : [species, ...CURATED_MONSTER_SPECIES];
  const speciesTechniques = monsterSpecialTechniquesFor(species);
  const techniqueOptions = speciesTechniques.includes(tuning.specialTechnique)
    ? speciesTechniques
    : [tuning.specialTechnique, ...speciesTechniques];
  return (
    <section className="flex flex-col gap-3 border-y border-zinc-200 py-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
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
          {t("editor.monster.rank")}
          <FieldSelect
            aria-label={t("editor.monster.rank")}
            className="h-8 text-sm"
            value={tuning.rank}
            onChange={(event) =>
              onChange(species, patrolRadius, {
                rank: event.currentTarget.value as MonsterTuning["rank"],
              })
            }
          >
            {MONSTER_RANKS.map((rank) => (
              <option key={rank} value={rank}>
                {t(`editor.monster.rank.${rank}`)}
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
        <span className="flex flex-col gap-1 text-[11px] text-zinc-500">
          {t("editor.monster.respawnMode")}
          <FieldSelect
            aria-label={t("editor.monster.respawnMode")}
            className="h-8 text-sm"
            value={draft.monsterRespawnMode ?? "timed"}
            onChange={(event) =>
              onChange(
                species,
                patrolRadius,
                undefined,
                event.currentTarget.value as MonsterRespawnMode,
              )
            }
          >
            {MONSTER_RESPAWN_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {t(`editor.monster.respawnMode.${mode}`)}
              </option>
            ))}
          </FieldSelect>
        </span>
        {(
          [
            ["maxHp", "editor.monster.hp", MONSTER_TUNING_LIMITS.maxHp],
            ["damage", "editor.monster.damage", MONSTER_TUNING_LIMITS.damage],
            ["speed", "editor.monster.speed", MONSTER_TUNING_LIMITS.speed],
            ["xp", "editor.monster.xp", MONSTER_TUNING_LIMITS.xp],
          ] as const
        ).map(([field, label, limits]) => (
          <span key={field} className="flex flex-col gap-1 text-[11px] text-zinc-500">
            {t(label)}
            <Input
              aria-label={t(label)}
              type="number"
              className="h-8 text-sm tabular-nums"
              min={limits.min}
              max={limits.max}
              value={tuning[field]}
              onChange={(event) =>
                onChange(species, patrolRadius, {
                  [field]: Number(event.currentTarget.value),
                })
              }
            />
          </span>
        ))}
        <span className="flex flex-col gap-1 text-[11px] text-zinc-500">
          {t("editor.monster.weakness")}
          <FieldSelect
            aria-label={t("editor.monster.weakness")}
            className="h-8 text-sm"
            value={tuning.weakness}
            onChange={(event) =>
              onChange(species, patrolRadius, {
                weakness: event.currentTarget.value as MonsterTuning["weakness"],
              })
            }
          >
            {MONSTER_WEAKNESSES.map((weakness) => (
              <option key={weakness} value={weakness}>
                {t(`editor.monster.weakness.${weakness}`)}
              </option>
            ))}
          </FieldSelect>
        </span>
        <span className="flex flex-col gap-1 text-[11px] text-zinc-500">
          {t("editor.monster.weaknessPercent")}
          <Input
            aria-label={t("editor.monster.weaknessPercent")}
            type="number"
            className="h-8 text-sm tabular-nums"
            min={MONSTER_TUNING_LIMITS.weaknessPercent.min}
            max={MONSTER_TUNING_LIMITS.weaknessPercent.max}
            value={tuning.weaknessPercent}
            onChange={(event) =>
              onChange(species, patrolRadius, {
                weaknessPercent: Number(event.currentTarget.value),
              })
            }
          />
        </span>
        <span className="flex flex-col gap-1 text-[11px] text-zinc-500 lg:col-span-2">
          {t("editor.monster.technique")}
          <FieldSelect
            aria-label={t("editor.monster.technique")}
            className="h-8 text-sm"
            value={tuning.specialTechnique}
            onChange={(event) =>
              onChange(species, patrolRadius, {
                specialTechnique: event.currentTarget.value as MonsterTuning["specialTechnique"],
              })
            }
          >
            {techniqueOptions.map((technique) => (
              <option key={technique} value={technique}>
                {t(`editor.monster.technique.${technique}`)}
              </option>
            ))}
          </FieldSelect>
        </span>
      </div>
    </section>
  );
}

/** Free-NPC characteristics shared by persistence and its authoritative movement routine. */
function NpcEventFields({
  draft,
  onChange,
}: {
  draft: MapEvent;
  onChange(patrolRadius: number, tuning?: Partial<Pick<MonsterTuning, "maxHp" | "damage">>): void;
}) {
  const defaults = defaultMonsterTuning("spear_goblin");
  const patrolRadius = draft.patrolRadius ?? MIN_PATROL_RADIUS;
  const values = {
    maxHp: draft.monsterMaxHp ?? defaults.maxHp,
    damage: draft.monsterDamage ?? defaults.damage,
  };
  return (
    <section className="grid gap-3 border-y border-zinc-200 py-3">
      <p className="text-xs text-muted-foreground">{t("editor.event.kind.npc.hint")}</p>
      <div className="grid grid-cols-3 gap-3">
        <label
          htmlFor="npc-patrol-radius"
          className="flex flex-col gap-1 text-[11px] text-zinc-500"
        >
          {t("editor.markers.radius")}
          <Input
            id="npc-patrol-radius"
            type="number"
            min={MIN_PATROL_RADIUS}
            max={MAX_PATROL_RADIUS}
            value={patrolRadius}
            onChange={(event) => onChange(Number(event.currentTarget.value))}
          />
        </label>
        {(
          [
            ["maxHp", "editor.monster.hp", MONSTER_TUNING_LIMITS.maxHp],
            ["damage", "editor.npc.power", MONSTER_TUNING_LIMITS.damage],
          ] as const
        ).map(([field, label, limits]) => (
          <label
            key={field}
            htmlFor={`npc-${field}`}
            className="flex flex-col gap-1 text-[11px] text-zinc-500"
          >
            {t(label)}
            <Input
              id={`npc-${field}`}
              type="number"
              min={limits.min}
              max={limits.max}
              value={values[field]}
              onChange={(event) =>
                onChange(patrolRadius, { [field]: Number(event.currentTarget.value) })
              }
            />
          </label>
        ))}
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
  /** Open the task guide on the story and event section without discarding this draft. */
  onOpenHelp(): void;
}

/**
 * The wireframe's event editor, in stock shadcn. It edits a detached draft (a `MapEvent` copy the
 * caller seeds from `beginEventDraft`): every keystroke folds into local state through the pure
 * `editor-state` draft mutators, and only Save writes back — as ONE history entry — while Cancel
 * simply drops the draft. Only runtime-backed controls are authorable: page conditions, appearance,
 * draw layer, Action/Player-touch triggers and commands. Legacy movement/options/trigger fields are
 * preserved in the detached page data but are never advertised as working controls.
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
  onOpenHelp,
}: EventDialogProps) {
  useLocale();
  const [draft, setDraft] = useState<MapEvent>(event);
  const [pageIndex, setPageIndex] = useState(0);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const index = Math.min(pageIndex, draft.pages.length - 1);
  const page = draft.pages[index];
  if (!page) return null;
  const unsupportedTriggerPages = draft.pages.flatMap((candidate, candidateIndex) =>
    runtimeTrigger(candidate.trigger) ? [] : [candidateIndex + 1],
  );

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
    if (unsupportedTriggerPages.length > 0) return;
    // Re-normalize condition ids/thresholds here so old imported pages remain parser-safe even
    // though current authors can only pick named values.
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
          <Button type="button" variant="outline" size="icon-sm" onClick={onOpenHelp}>
            <CircleHelp />
            <span className="sr-only">{t("editor.event.help")}</span>
          </Button>
        </DialogHeader>

        {draft.kind === "normal" && (
          <p className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs leading-relaxed text-blue-950">
            {t("editor.event.guide.summary")}
          </p>
        )}

        {/* Monster events carry species, patrol radius and one focused on-defeat action list — a dense
            kind-specific block that replaces the normal event's page/condition machinery. */}
        {draft.kind === "monster" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <MonsterEventFields
              draft={draft}
              onChange={(species, radius, tuning, respawnMode) => {
                const monster = setEventDraftMonster(draft, species, radius, tuning);
                setDraft(
                  respawnMode ? setEventDraftMonsterRespawnMode(monster, respawnMode) : monster,
                );
              }}
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
                defaultSpeakerName={draft.name}
                onChange={(commands) => update({ commands })}
              />
            </div>
          </div>
        )}

        {draft.kind === "npc" && (
          <NpcEventFields
            draft={draft}
            onChange={(radius, tuning) => setDraft(setEventDraftNpc(draft, radius, tuning))}
          />
        )}

        {draft.kind === "guard" && (
          <section className="flex flex-col gap-3 border-y border-zinc-200 py-3">
            <p className="text-xs text-muted-foreground">{t("editor.event.kind.guard.hint")}</p>
            <label
              htmlFor="guard-patrol-radius"
              className="flex max-w-xs flex-col gap-1 text-[11px] text-zinc-500"
            >
              {t("editor.markers.radius")}
              <Input
                id="guard-patrol-radius"
                type="number"
                min={MIN_PATROL_RADIUS}
                max={MAX_PATROL_RADIUS}
                value={draft.patrolRadius ?? MIN_PATROL_RADIUS}
                onChange={(event) =>
                  setDraft(setEventDraftGuardRadius(draft, Number(event.currentTarget.value)))
                }
              />
            </label>
          </section>
        )}

        {/* Entry/exit/spawn events are pure anchors: their only field is the label (the header Name
            input), so no body is shown — a hint states what the placement binds. */}
        {(draft.kind === "entry" || draft.kind === "exit" || draft.kind === "spawn") && (
          <p className="border-y border-zinc-200 py-3 text-[12.5px] text-muted-foreground">
            {t(
              draft.kind === "spawn"
                ? "editor.event.kind.spawn.hint"
                : "editor.event.kind.anchor.hint",
            )}
          </p>
        )}

        {/* Normal events expose complete pages. Guards reuse only the page tabs and party-state
            conditions: their pages declare presence and may never run commands. */}
        {(draft.kind === "normal" || draft.kind === "npc" || draft.kind === "guard") && (
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

            <div
              className={
                draft.kind === "normal" || draft.kind === "npc"
                  ? "grid gap-4 sm:grid-cols-2"
                  : "grid gap-4"
              }
            >
              {/* Left column: the authored page fields. */}
              <div className="flex flex-col gap-4">
                <section className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3">
                  <h3 className="text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase">
                    {t("editor.event.conditions")}
                  </h3>
                  <CheckRow
                    checked={page.condSwitchId !== null}
                    disabled={page.condSwitchId === null && registry.switches.length === 0}
                    onToggle={(on) => {
                      const id = defaultConditionId(registry.switches);
                      update({ condSwitchId: on ? id : null });
                    }}
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
                  {registry.switches.length === 0 && (
                    <p className="pl-6 text-[11px] text-zinc-400">
                      {t("editor.event.cond.switch.empty.hint")}
                    </p>
                  )}
                  <CheckRow
                    checked={page.condVariableId !== null}
                    disabled={page.condVariableId === null && registry.variables.length === 0}
                    onToggle={(on) => {
                      const id = defaultConditionId(registry.variables);
                      update(
                        on && id
                          ? {
                              condVariableId: id,
                              condVariableMin: 0,
                            }
                          : { condVariableId: null, condVariableMin: null },
                      );
                    }}
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
                  {registry.variables.length === 0 && (
                    <p className="pl-6 text-[11px] text-zinc-400">
                      {t("editor.event.cond.variable.empty.hint")}
                    </p>
                  )}
                  {(draft.kind === "normal" || draft.kind === "npc") && (
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
                  )}
                </section>

                {(draft.kind === "normal" || draft.kind === "npc") && (
                  <>
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
                      <label className="flex items-center gap-2 text-[12.5px] text-zinc-700">
                        <input
                          type="checkbox"
                          checked={page.optOnTop}
                          onChange={(event) => update({ optOnTop: event.currentTarget.checked })}
                        />
                        {t("editor.event.opt.onTop")}
                      </label>
                    </section>

                    {draft.kind === "npc" && (
                      <section className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3">
                        <h3 className="text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase">
                          {t("editor.event.movement")}
                        </h3>
                        <label
                          htmlFor="npc-move-type"
                          className="flex flex-col gap-1 text-[11px] text-zinc-500"
                        >
                          {t("editor.event.move.type")}
                          <FieldSelect
                            id="npc-move-type"
                            value={page.moveType}
                            onChange={(event) =>
                              update({
                                moveType: event.currentTarget.value as MapEventPage["moveType"],
                              })
                            }
                          >
                            {MOVE_TYPES.map((moveType) => (
                              <option key={moveType} value={moveType}>
                                {t(`editor.event.moveType.${moveType}`)}
                              </option>
                            ))}
                          </FieldSelect>
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                          <label
                            htmlFor="npc-move-speed"
                            className="flex flex-col gap-1 text-[11px] text-zinc-500"
                          >
                            {t("editor.event.move.speed")}
                            <FieldSelect
                              id="npc-move-speed"
                              value={page.moveSpeed}
                              onChange={(event) =>
                                update({ moveSpeed: Number(event.currentTarget.value) })
                              }
                            >
                              {NPC_MOVE_SPEEDS.map((value) => (
                                <option key={value} value={value}>
                                  {t(`editor.event.speed.${value}`)}
                                </option>
                              ))}
                            </FieldSelect>
                          </label>
                          <label
                            htmlFor="npc-move-frequency"
                            className="flex flex-col gap-1 text-[11px] text-zinc-500"
                          >
                            {t("editor.event.move.freq")}
                            <FieldSelect
                              id="npc-move-frequency"
                              value={page.moveFreq}
                              onChange={(event) =>
                                update({ moveFreq: Number(event.currentTarget.value) })
                              }
                            >
                              {NPC_MOVE_FREQUENCIES.map((value) => (
                                <option key={value} value={value}>
                                  {t(`editor.event.freq.${value}`)}
                                </option>
                              ))}
                            </FieldSelect>
                          </label>
                        </div>
                      </section>
                    )}

                    <section className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3">
                      <h3 className="text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase">
                        {t("editor.event.trigger")}
                      </h3>
                      <p className="text-[11px] text-zinc-500">{t("editor.event.runtime.hint")}</p>
                      <FieldSelect
                        aria-label={t("editor.event.trigger")}
                        className="h-7 text-xs"
                        value={page.trigger}
                        onChange={(event) =>
                          update({ trigger: event.currentTarget.value as EventTrigger })
                        }
                      >
                        {!runtimeTrigger(page.trigger) && (
                          <option value={page.trigger} disabled>
                            {t(`editor.event.trigger.${page.trigger}`)} — {t("editor.event.legacy")}
                          </option>
                        )}
                        {RUNTIME_EVENT_TRIGGERS.map((option) => (
                          <option key={option} value={option}>
                            {t(`editor.event.trigger.${option}`)}
                          </option>
                        ))}
                      </FieldSelect>
                    </section>
                  </>
                )}
              </div>

              {/* Right column: the page's guided action list. */}
              {(draft.kind === "normal" || draft.kind === "npc") && (
                <EventCommandEditor
                  commands={page.commands}
                  switches={registry.switches}
                  variables={registry.variables}
                  quests={registry.quests ?? []}
                  maps={maps}
                  defaultSpeakerName={draft.name}
                  onChange={(commands) => update({ commands })}
                />
              )}
            </div>
          </>
        )}

        <DialogFooter className="items-center sm:justify-between">
          <div className="flex flex-col items-start gap-1.5">
            <Button variant="destructive" size="sm" onClick={() => setConfirmingDelete(true)}>
              {t("editor.event.delete")}
            </Button>
            {unsupportedTriggerPages.length > 0 && (
              <div className="max-w-md text-xs text-amber-700" role="alert">
                <p>
                  {t("editor.event.runtime.legacy", {
                    pages: unsupportedTriggerPages.join(", "),
                  })}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-1 h-7"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      pages: draft.pages.map((candidate) =>
                        runtimeTrigger(candidate.trigger)
                          ? candidate
                          : { ...candidate, trigger: "action" },
                      ),
                    })
                  }
                >
                  {t("editor.event.runtime.convert")}
                </Button>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onCancel}>
              {t("editor.event.cancel")}
            </Button>
            <Button disabled={unsupportedTriggerPages.length > 0} onClick={save}>
              {t("editor.event.save")}
            </Button>
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
