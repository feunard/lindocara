import { t, useLocale } from "@lindocara/client/i18n.js";
import type { AdventureRegistry, RegistryEntry } from "@lindocara/engine/adventure-state.js";
import {
  CURATED_MONSTER_SPECIES,
  defaultMonsterTuning,
  MONSTER_ATTACK_PROFILES,
  MONSTER_RANKS,
  MONSTER_RESPAWN_DELAY_LIMITS,
  MONSTER_RESPAWN_MODES,
  MONSTER_RESPAWN_MS,
  MONSTER_TUNING_LIMITS,
  MONSTER_WEAKNESSES,
  type MonsterAttackProfile,
  type MonsterRespawnMode,
  type MonsterSpecies,
  type MonsterTuning,
  monsterSpecialTechniquesFor,
} from "@lindocara/engine/game.js";
import {
  HARVEST_EXHAUSTION_BEHAVIORS,
  HARVEST_PROFILE_LIMITS,
  HARVEST_RESOURCE_KINDS,
  HARVEST_RESPAWN_MODES,
  type HarvestExhaustionBehavior,
  type HarvestProfile,
  type HarvestResourceKind,
  type HarvestRespawnMode,
  harvestToolForResource,
  MIN_TIMED_HARVEST_RESPAWN_MS,
  parseHarvestProfile,
} from "@lindocara/engine/harvest.js";
import { MAX_PATROL_RADIUS, MIN_PATROL_RADIUS } from "@lindocara/engine/map-data.js";
import {
  EVENT_GRAPHIC_TINT_DEFAULT,
  EVENT_NAME_MAX,
  type EventTrigger,
  MAX_NPC_ROUTINE_STEPS,
  MAX_PAGES_PER_EVENT,
  type MapEvent,
  type MapEventPage,
  MOVE_TYPES,
  NPC_ROUTINE_OFFSET_LIMIT,
  NPC_ROUTINE_WAIT_LIMITS,
  type NpcRoutineStep,
  SELF_SWITCHES,
  type SelfSwitch,
  validateEventName,
} from "@lindocara/engine/map-events.js";
import { type EditorAssetId, editorAsset } from "@lindocara/engine/tiny-swords-catalog.js";
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
  setEventDraftHarvestProfile,
  setEventDraftMonster,
  setEventDraftMonsterAttackProfile,
  setEventDraftMonsterRespawnDelay,
  setEventDraftMonsterRespawnMode,
  setEventDraftName,
  setEventDraftNpc,
  updateEventDraftPage,
} from "../../game/editor-state.js";
import { CatalogueAssetPicker, EditorAssetPreview } from "./CatalogueAssetPicker.js";
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

type EventStatField =
  | "patrolRadius"
  | "respawnDelay"
  | "maxHp"
  | "damage"
  | "speed"
  | "xp"
  | "weaknessPercent";

interface EventStatError {
  reason: "integer" | "range";
  min: number;
  max: number;
}

type EventStatErrors = Partial<Record<EventStatField, EventStatError | undefined>>;

function runtimeTrigger(trigger: EventTrigger): boolean {
  return (RUNTIME_EVENT_TRIGGERS as readonly EventTrigger[]).includes(trigger);
}

function statError(value: number, min: number, max: number): EventStatError | undefined {
  if (!Number.isSafeInteger(value)) return { reason: "integer", min, max };
  if (value < min || value > max) return { reason: "range", min, max };
  return undefined;
}

/** Validate the same numeric bounds as the shared wire parser, but retain a field-level reason so
 * authors can correct a rejected stat without having to infer the server contract. */
function validateEventStats(draft: MapEvent): EventStatErrors {
  const errors: EventStatErrors = {};
  if (draft.kind !== "monster" && draft.kind !== "npc" && draft.kind !== "guard") return errors;

  const patrolRadius = draft.patrolRadius ?? MIN_PATROL_RADIUS;
  errors.patrolRadius = statError(patrolRadius, MIN_PATROL_RADIUS, MAX_PATROL_RADIUS);

  if (draft.kind === "guard") return errors;

  const species = draft.kind === "monster" ? (draft.species ?? "spear_goblin") : "spear_goblin";
  const defaults = defaultMonsterTuning(species);
  errors.maxHp = statError(
    draft.monsterMaxHp ?? defaults.maxHp,
    MONSTER_TUNING_LIMITS.maxHp.min,
    MONSTER_TUNING_LIMITS.maxHp.max,
  );
  errors.damage = statError(
    draft.monsterDamage ?? defaults.damage,
    MONSTER_TUNING_LIMITS.damage.min,
    MONSTER_TUNING_LIMITS.damage.max,
  );

  if (draft.kind === "npc") return errors;

  errors.speed = statError(
    draft.monsterSpeed ?? defaults.speed,
    MONSTER_TUNING_LIMITS.speed.min,
    MONSTER_TUNING_LIMITS.speed.max,
  );
  errors.xp = statError(
    draft.monsterXp ?? defaults.xp,
    MONSTER_TUNING_LIMITS.xp.min,
    MONSTER_TUNING_LIMITS.xp.max,
  );
  errors.weaknessPercent = statError(
    draft.monsterWeaknessPercent ?? defaults.weaknessPercent,
    MONSTER_TUNING_LIMITS.weaknessPercent.min,
    MONSTER_TUNING_LIMITS.weaknessPercent.max,
  );
  if ((draft.monsterRespawnMode ?? "timed") === "timed") {
    const respawnError = statError(
      draft.monsterRespawnDelayMs ?? MONSTER_RESPAWN_MS,
      MONSTER_RESPAWN_DELAY_LIMITS.min,
      MONSTER_RESPAWN_DELAY_LIMITS.max,
    );
    if (respawnError) {
      errors.respawnDelay = {
        ...respawnError,
        min: respawnError.min / 1_000,
        max: respawnError.max / 1_000,
      };
    }
  }
  return errors;
}

function StatFieldError({ id, error }: { id: string; error: EventStatError | undefined }) {
  if (!error) return null;
  return (
    <span id={id} className="text-[10.5px] leading-tight text-destructive" role="alert">
      {t(`editor.event.validation.${error.reason}`, {
        min: error.min,
        max: error.max,
      })}
    </span>
  );
}

function NpcRoutineEditor({
  route,
  onChange,
}: {
  route: readonly NpcRoutineStep[];
  onChange(route: readonly NpcRoutineStep[]): void;
}) {
  const updateStep = (index: number, patch: Partial<NpcRoutineStep>): void => {
    onChange(route.map((step, current) => (current === index ? { ...step, ...patch } : step)));
  };
  const moveStep = (index: number, direction: -1 | 1): void => {
    const target = index + direction;
    if (target < 0 || target >= route.length) return;
    const next = [...route];
    const current = next[index];
    const replacement = next[target];
    if (!current || !replacement) return;
    next[index] = replacement;
    next[target] = current;
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-2 rounded-md border border-zinc-200 p-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-medium text-zinc-700">{t("editor.event.routine.title")}</p>
          <p className="text-[10.5px] text-zinc-500">{t("editor.event.routine.hint")}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7"
          disabled={route.length >= MAX_NPC_ROUTINE_STEPS}
          onClick={() => onChange([...route, { offsetCol: 0, offsetRow: 0, waitMs: 0 }])}
        >
          {t("editor.event.routine.add")}
        </Button>
      </div>
      {route.length === 0 && (
        <p className="text-[10.5px] text-zinc-400">{t("editor.event.routine.empty")}</p>
      )}
      {route.map((step, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: routine steps are positional by design
          key={index}
          className="grid grid-cols-[auto_1fr_1fr_1.2fr_auto] items-end gap-1.5 rounded bg-zinc-50 p-1.5"
        >
          <span className="self-center text-[10px] font-semibold text-zinc-400">{index + 1}</span>
          <label
            htmlFor={`npc-routine-${index}-x`}
            className="flex flex-col gap-0.5 text-[10px] text-zinc-500"
          >
            {t("editor.event.routine.offsetX")}
            <Input
              id={`npc-routine-${index}-x`}
              type="number"
              className="h-7 text-xs"
              min={-NPC_ROUTINE_OFFSET_LIMIT}
              max={NPC_ROUTINE_OFFSET_LIMIT}
              value={step.offsetCol}
              onChange={(event) =>
                updateStep(index, {
                  offsetCol: Math.max(
                    -NPC_ROUTINE_OFFSET_LIMIT,
                    Math.min(
                      NPC_ROUTINE_OFFSET_LIMIT,
                      Math.round(Number(event.currentTarget.value)),
                    ),
                  ),
                })
              }
            />
          </label>
          <label
            htmlFor={`npc-routine-${index}-y`}
            className="flex flex-col gap-0.5 text-[10px] text-zinc-500"
          >
            {t("editor.event.routine.offsetY")}
            <Input
              id={`npc-routine-${index}-y`}
              type="number"
              className="h-7 text-xs"
              min={-NPC_ROUTINE_OFFSET_LIMIT}
              max={NPC_ROUTINE_OFFSET_LIMIT}
              value={step.offsetRow}
              onChange={(event) =>
                updateStep(index, {
                  offsetRow: Math.max(
                    -NPC_ROUTINE_OFFSET_LIMIT,
                    Math.min(
                      NPC_ROUTINE_OFFSET_LIMIT,
                      Math.round(Number(event.currentTarget.value)),
                    ),
                  ),
                })
              }
            />
          </label>
          <label
            htmlFor={`npc-routine-${index}-wait`}
            className="flex flex-col gap-0.5 text-[10px] text-zinc-500"
          >
            {t("editor.event.routine.wait")}
            <Input
              id={`npc-routine-${index}-wait`}
              type="number"
              className="h-7 text-xs"
              min={NPC_ROUTINE_WAIT_LIMITS.min / 1_000}
              max={NPC_ROUTINE_WAIT_LIMITS.max / 1_000}
              step={0.5}
              value={step.waitMs / 1_000}
              onChange={(event) =>
                updateStep(index, {
                  waitMs: Math.max(
                    NPC_ROUTINE_WAIT_LIMITS.min,
                    Math.min(
                      NPC_ROUTINE_WAIT_LIMITS.max,
                      Math.round(Number(event.currentTarget.value) * 1_000),
                    ),
                  ),
                })
              }
            />
          </label>
          <div className="flex gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={index === 0}
              aria-label={t("editor.event.routine.up")}
              onClick={() => moveStep(index, -1)}
            >
              ↑
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={index === route.length - 1}
              aria-label={t("editor.event.routine.down")}
              onClick={() => moveStep(index, 1)}
            >
              ↓
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-destructive"
              aria-label={t("editor.event.routine.delete")}
              onClick={() => onChange(route.filter((_step, current) => current !== index))}
            >
              ×
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
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
  errors,
  onChange,
  onAttackProfileChange,
}: {
  draft: MapEvent;
  errors: EventStatErrors;
  onChange(
    species: MonsterSpecies,
    patrolRadius: number,
    tuning?: Partial<MonsterTuning>,
    respawnMode?: MonsterRespawnMode,
    respawnDelayMs?: number,
  ): void;
  onAttackProfileChange(profile: MonsterAttackProfile | null): void;
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
  const respawnMode = draft.monsterRespawnMode ?? "timed";
  const respawnDelayMs = draft.monsterRespawnDelayMs ?? MONSTER_RESPAWN_MS;
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
          {t("editor.monster.attackProfile")}
          <FieldSelect
            aria-label={t("editor.monster.attackProfile")}
            className="h-8 text-sm"
            value={draft.monsterAttackProfile ?? "natural"}
            onChange={(event) =>
              onAttackProfileChange(
                event.currentTarget.value === "natural"
                  ? null
                  : (event.currentTarget.value as MonsterAttackProfile),
              )
            }
          >
            <option value="natural">{t("editor.monster.attackProfile.natural")}</option>
            {MONSTER_ATTACK_PROFILES.map((profile) => (
              <option key={profile} value={profile}>
                {t(`editor.monster.attackProfile.${profile}`)}
              </option>
            ))}
          </FieldSelect>
        </span>
        <span className="flex flex-col gap-1 text-[11px] text-zinc-500">
          {t("editor.markers.radius")}
          <Input
            aria-label={t("editor.markers.radius")}
            aria-invalid={Boolean(errors.patrolRadius)}
            aria-describedby={errors.patrolRadius ? "monster-patrol-radius-error" : undefined}
            type="number"
            className="h-8 text-sm tabular-nums"
            min={MIN_PATROL_RADIUS}
            max={MAX_PATROL_RADIUS}
            value={patrolRadius}
            onChange={(e) => onChange(species, Number(e.currentTarget.value))}
          />
          <StatFieldError id="monster-patrol-radius-error" error={errors.patrolRadius} />
        </span>
        <span className="flex flex-col gap-1 text-[11px] text-zinc-500">
          {t("editor.monster.respawnMode")}
          <FieldSelect
            aria-label={t("editor.monster.respawnMode")}
            className="h-8 text-sm"
            value={respawnMode}
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
        {respawnMode === "timed" && (
          <span className="flex flex-col gap-1 text-[11px] text-zinc-500">
            {t("editor.monster.respawnDelay")}
            <Input
              aria-label={t("editor.monster.respawnDelay")}
              aria-invalid={Boolean(errors.respawnDelay)}
              aria-describedby={errors.respawnDelay ? "monster-respawn-delay-error" : undefined}
              type="number"
              className="h-8 text-sm tabular-nums"
              min={MONSTER_RESPAWN_DELAY_LIMITS.min / 1_000}
              max={MONSTER_RESPAWN_DELAY_LIMITS.max / 1_000}
              step={1}
              value={respawnDelayMs / 1_000}
              onChange={(event) =>
                onChange(
                  species,
                  patrolRadius,
                  undefined,
                  undefined,
                  Math.round(Number(event.currentTarget.value) * 1_000),
                )
              }
            />
            <StatFieldError id="monster-respawn-delay-error" error={errors.respawnDelay} />
          </span>
        )}
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
              aria-invalid={Boolean(errors[field])}
              aria-describedby={errors[field] ? `monster-${field}-error` : undefined}
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
            <StatFieldError id={`monster-${field}-error`} error={errors[field]} />
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
            aria-invalid={Boolean(errors.weaknessPercent)}
            aria-describedby={errors.weaknessPercent ? "monster-weakness-percent-error" : undefined}
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
          <StatFieldError id="monster-weakness-percent-error" error={errors.weaknessPercent} />
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
  errors,
  onChange,
}: {
  draft: MapEvent;
  errors: EventStatErrors;
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
            aria-invalid={Boolean(errors.patrolRadius)}
            aria-describedby={errors.patrolRadius ? "npc-patrol-radius-error" : undefined}
            type="number"
            min={MIN_PATROL_RADIUS}
            max={MAX_PATROL_RADIUS}
            value={patrolRadius}
            onChange={(event) => onChange(Number(event.currentTarget.value))}
          />
          <StatFieldError id="npc-patrol-radius-error" error={errors.patrolRadius} />
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
              aria-invalid={Boolean(errors[field])}
              aria-describedby={errors[field] ? `npc-${field}-error` : undefined}
              type="number"
              min={limits.min}
              max={limits.max}
              value={values[field]}
              onChange={(event) =>
                onChange(patrolRadius, { [field]: Number(event.currentTarget.value) })
              }
            />
            <StatFieldError id={`npc-${field}-error`} error={errors[field]} />
          </label>
        ))}
      </div>
    </section>
  );
}

function HarvestNumberField({
  id,
  label,
  value,
  min,
  max,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  onChange(value: number): void;
}) {
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-[11px] text-zinc-500">
      {label}
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </label>
  );
}

/** Complete per-instance resource authoring. The profile and both images stay independent: an
 * appearance picker only writes an asset id, while semantic controls only write HarvestProfile. */
function HarvestEventFields({
  profile,
  intactAssetId,
  onProfileChange,
  onIntactAssetChange,
}: {
  profile: HarvestProfile;
  intactAssetId: EditorAssetId | null;
  onProfileChange(profile: HarvestProfile): void;
  onIntactAssetChange(assetId: EditorAssetId): void;
}) {
  const intactAsset = intactAssetId ? editorAsset(intactAssetId) : null;
  const exhaustedAsset = profile.exhaustedAssetId ? editorAsset(profile.exhaustedAssetId) : null;
  const patch = (next: Partial<HarvestProfile>): void => onProfileChange({ ...profile, ...next });
  const changeResource = (resource: HarvestResourceKind): void => {
    patch({
      resource,
      tool: harvestToolForResource(resource),
      yieldAmount: resource === "gold" ? 0 : Math.max(1, profile.yieldAmount),
      goldValue: resource === "gold" ? Math.max(1, profile.goldValue || 25) : 0,
    });
  };
  const changeExhaustion = (exhaustionBehavior: HarvestExhaustionBehavior): void => {
    patch({
      exhaustionBehavior,
      ...(exhaustionBehavior === "hide" ? { exhaustedAssetId: null } : {}),
    });
  };
  const changeRespawn = (respawn: HarvestRespawnMode): void => {
    patch({
      respawn,
      respawnDelayMs:
        respawn === "permanent"
          ? 0
          : Math.max(MIN_TIMED_HARVEST_RESPAWN_MS, profile.respawnDelayMs || 60_000),
    });
  };

  return (
    <section className="flex flex-col gap-4 border-y border-zinc-200 py-3">
      <div>
        <h3 className="text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase">
          {t("editor.harvest.profile.heading")}
        </h3>
        <p className="text-xs text-muted-foreground">{t("editor.harvest.profile.hint")}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label htmlFor="harvest-resource" className="flex flex-col gap-1 text-[11px] text-zinc-500">
          {t("editor.harvest.resource")}
          <FieldSelect
            id="harvest-resource"
            value={profile.resource}
            onChange={(event) => changeResource(event.currentTarget.value as HarvestResourceKind)}
          >
            {HARVEST_RESOURCE_KINDS.map((resource) => (
              <option key={resource} value={resource}>
                {t(`editor.harvest.resource.${resource}`)}
              </option>
            ))}
          </FieldSelect>
        </label>
        <label htmlFor="harvest-tool" className="flex flex-col gap-1 text-[11px] text-zinc-500">
          {t("editor.harvest.tool")}
          <FieldSelect id="harvest-tool" value={profile.tool} disabled>
            <option value={profile.tool}>{t(`editor.harvest.tool.${profile.tool}`)}</option>
          </FieldSelect>
        </label>
        {profile.resource === "gold" ? (
          <HarvestNumberField
            id="harvest-gold-value"
            label={t("editor.harvest.goldValue")}
            value={profile.goldValue}
            min={1}
            max={HARVEST_PROFILE_LIMITS.goldValue.max}
            onChange={(goldValue) => patch({ goldValue })}
          />
        ) : (
          <HarvestNumberField
            id="harvest-yield"
            label={t("editor.harvest.yield")}
            value={profile.yieldAmount}
            min={1}
            max={HARVEST_PROFILE_LIMITS.yieldAmount.max}
            onChange={(yieldAmount) => patch({ yieldAmount })}
          />
        )}
        <HarvestNumberField
          id="harvest-hits"
          label={t("editor.harvest.hits")}
          value={profile.hitsRequired}
          min={HARVEST_PROFILE_LIMITS.hitsRequired.min}
          max={HARVEST_PROFILE_LIMITS.hitsRequired.max}
          onChange={(hitsRequired) => patch({ hitsRequired })}
        />
        <HarvestNumberField
          id="harvest-range"
          label={t("editor.harvest.range")}
          value={profile.range}
          min={HARVEST_PROFILE_LIMITS.range.min}
          max={HARVEST_PROFILE_LIMITS.range.max}
          onChange={(range) => patch({ range })}
        />
        <HarvestNumberField
          id="harvest-duration"
          label={t("editor.harvest.duration")}
          value={profile.harvestDurationMs}
          min={HARVEST_PROFILE_LIMITS.harvestDurationMs.min}
          max={HARVEST_PROFILE_LIMITS.harvestDurationMs.max}
          onChange={(harvestDurationMs) => patch({ harvestDurationMs })}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label
          htmlFor="harvest-exhaustion"
          className="flex flex-col gap-1 text-[11px] text-zinc-500"
        >
          {t("editor.harvest.exhaustion")}
          <FieldSelect
            id="harvest-exhaustion"
            value={profile.exhaustionBehavior}
            onChange={(event) =>
              changeExhaustion(event.currentTarget.value as HarvestExhaustionBehavior)
            }
          >
            {HARVEST_EXHAUSTION_BEHAVIORS.map((behavior) => (
              <option key={behavior} value={behavior}>
                {t(`editor.harvest.exhaustion.${behavior}`)}
              </option>
            ))}
          </FieldSelect>
        </label>
        <label htmlFor="harvest-respawn" className="flex flex-col gap-1 text-[11px] text-zinc-500">
          {t("editor.harvest.respawn")}
          <FieldSelect
            id="harvest-respawn"
            value={profile.respawn}
            onChange={(event) => changeRespawn(event.currentTarget.value as HarvestRespawnMode)}
          >
            {HARVEST_RESPAWN_MODES.map((respawn) => (
              <option key={respawn} value={respawn}>
                {t(`editor.harvest.respawn.${respawn}`)}
              </option>
            ))}
          </FieldSelect>
        </label>
        {profile.respawn === "timed" && (
          <HarvestNumberField
            id="harvest-respawn-delay"
            label={t("editor.harvest.respawnDelay")}
            value={profile.respawnDelayMs}
            min={MIN_TIMED_HARVEST_RESPAWN_MS}
            max={HARVEST_PROFILE_LIMITS.respawnDelayMs.max}
            onChange={(respawnDelayMs) => patch({ respawnDelayMs })}
          />
        )}
        <HarvestNumberField
          id="harvest-fade-duration"
          label={t("editor.harvest.fadeDuration")}
          value={profile.fadeDurationMs}
          min={HARVEST_PROFILE_LIMITS.fadeDurationMs.min}
          max={HARVEST_PROFILE_LIMITS.fadeDurationMs.max}
          onChange={(fadeDurationMs) => patch({ fadeDurationMs })}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3">
          <h3 className="text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase">
            {t("editor.harvest.appearance.intact")}
          </h3>
          <div data-testid="harvest-intact-preview">
            {intactAsset ? (
              <EditorAssetPreview asset={intactAsset} size={96} />
            ) : (
              <p className="rounded bg-zinc-50 p-3 text-xs text-zinc-500">
                {t("editor.harvest.appearance.missing")}
              </p>
            )}
          </div>
          <CatalogueAssetPicker
            usage="scenery"
            value={intactAssetId}
            onSelectAsset={onIntactAssetChange}
          />
        </div>

        <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3">
          <h3 className="text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase">
            {t("editor.harvest.appearance.exhausted")}
          </h3>
          <div data-testid="harvest-exhausted-preview">
            {exhaustedAsset ? (
              <EditorAssetPreview asset={exhaustedAsset} size={96} />
            ) : (
              <p className="flex h-24 items-center justify-center rounded border border-dashed border-zinc-200 bg-zinc-50 p-3 text-center text-xs text-zinc-500">
                {t(`editor.harvest.preview.${profile.exhaustionBehavior}`)}
              </p>
            )}
          </div>
          {profile.exhaustionBehavior !== "hide" && (
            <CatalogueAssetPicker
              usage="scenery"
              value={profile.exhaustedAssetId}
              onSelectAsset={(exhaustedAssetId) => patch({ exhaustedAssetId })}
              onSelectNone={
                profile.exhaustionBehavior === "replace"
                  ? undefined
                  : () => patch({ exhaustedAssetId: null })
              }
              noneLabel={t("editor.shell.events.graphic.none")}
            />
          )}
        </div>
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
  const [validationAttempted, setValidationAttempted] = useState(false);

  const index = Math.min(pageIndex, draft.pages.length - 1);
  const page = draft.pages[index];
  if (!page) return null;
  const statErrors = validateEventStats(draft);
  const visibleStatErrors = validationAttempted ? statErrors : {};
  const harvestProfileValid =
    draft.kind !== "harvestable" || parseHarvestProfile(draft.harvestProfile) !== null;
  const harvestAppearanceValid =
    draft.kind !== "harvestable" ||
    draft.pages.every((candidate) => candidate.graphicAssetId !== null);
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
    if (
      Object.values(statErrors).some(Boolean) ||
      !harvestProfileValid ||
      !harvestAppearanceValid
    ) {
      setValidationAttempted(true);
      return;
    }
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
              errors={visibleStatErrors}
              onChange={(species, radius, tuning, respawnMode, respawnDelayMs) => {
                const monster = setEventDraftMonster(draft, species, radius, tuning);
                const withMode =
                  respawnMode === undefined
                    ? monster
                    : setEventDraftMonsterRespawnMode(monster, respawnMode);
                setDraft(
                  respawnDelayMs === undefined
                    ? withMode
                    : setEventDraftMonsterRespawnDelay(withMode, respawnDelayMs),
                );
              }}
              onAttackProfileChange={(profile) =>
                setDraft(setEventDraftMonsterAttackProfile(draft, profile))
              }
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
            errors={visibleStatErrors}
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
                aria-invalid={Boolean(visibleStatErrors.patrolRadius)}
                aria-describedby={
                  visibleStatErrors.patrolRadius ? "guard-patrol-radius-error" : undefined
                }
                type="number"
                min={MIN_PATROL_RADIUS}
                max={MAX_PATROL_RADIUS}
                value={draft.patrolRadius ?? MIN_PATROL_RADIUS}
                onChange={(event) =>
                  setDraft(setEventDraftGuardRadius(draft, Number(event.currentTarget.value)))
                }
              />
              <StatFieldError
                id="guard-patrol-radius-error"
                error={visibleStatErrors.patrolRadius}
              />
            </label>
            <CatalogueAssetPicker
              usage="guard"
              value={page.graphicAssetId}
              onSelectAsset={(graphicAssetId) =>
                update({ graphicAssetId, graphicTint: EVENT_GRAPHIC_TINT_DEFAULT })
              }
            />
          </section>
        )}

        {draft.kind === "harvestable" && draft.harvestProfile && (
          <HarvestEventFields
            profile={draft.harvestProfile}
            intactAssetId={page.graphicAssetId}
            onProfileChange={(profile) => setDraft(setEventDraftHarvestProfile(draft, profile))}
            onIntactAssetChange={(graphicAssetId) =>
              update({ graphicAssetId, graphicTint: EVENT_GRAPHIC_TINT_DEFAULT })
            }
          />
        )}
        {draft.kind === "harvestable" &&
          validationAttempted &&
          (!harvestProfileValid || !harvestAppearanceValid) && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
              {t("editor.harvest.validation.invalid")}
            </p>
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

        {/* Normal events and NPCs expose complete pages. Guards reuse page conditions for presence
            and the action list for dialogue while their combat appearance/movement stays server-owned. */}
        {(draft.kind === "normal" ||
          draft.kind === "npc" ||
          draft.kind === "guard" ||
          draft.kind === "harvestable") && (
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
                draft.kind === "normal" || draft.kind === "npc" || draft.kind === "guard"
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
                        usage={draft.kind === "npc" ? "character" : "event"}
                        value={page.graphicAssetId}
                        onSelectAsset={(assetId) =>
                          update({
                            graphicAssetId: assetId,
                            ...(draft.kind === "npc"
                              ? { graphicTint: EVENT_GRAPHIC_TINT_DEFAULT }
                              : {}),
                          })
                        }
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
                        {page.moveType === "custom" && (
                          <NpcRoutineEditor
                            route={page.moveRoute ?? []}
                            onChange={(moveRoute) => update({ moveRoute })}
                          />
                        )}
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
              {(draft.kind === "normal" || draft.kind === "npc" || draft.kind === "guard") && (
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
