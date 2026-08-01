import { t, useLocale } from "@lindocara/client/i18n.js";
import { EVENT_PRESETS, type EventPreset } from "@lindocara/engine/event-presets.js";
import { CURATED_MONSTER_SPECIES, type MonsterSpecies } from "@lindocara/engine/game.js";
import { HARVEST_PRESETS, type HarvestPresetId } from "@lindocara/engine/harvest-presets.js";
import type { MessageKey } from "@lindocara/engine/i18n/index.js";
import { MAX_PATROL_RADIUS, MIN_PATROL_RADIUS } from "@lindocara/engine/map-data.js";
import {
  type EventKind,
  isRuntimeEventKind,
  MAX_EVENTS_PER_MAP,
  MAX_RUNTIME_EVENTS_PER_MAP,
  type MapEvent,
  runtimeEventCount,
} from "@lindocara/engine/map-events.js";
import { type EditorAssetId, editorAsset } from "@lindocara/engine/tiny-swords-catalog.js";
import { TINY_SWORDS_ENEMIES } from "@lindocara/renderer/enemy-art.js";
import { Input } from "@lindocara/ui/components/input.js";
import { Label } from "@lindocara/ui/components/label.js";
import { CatalogueAssetPicker, EditorAssetPreview } from "./CatalogueAssetPicker.js";
import { EDITOR_MARKER_PREVIEWS, SpriteSheetPreview, SwatchButton } from "./TerrainPalette.js";

/** The popular one-click placements. `raw` is a blank custom event; the rest pre-fill page 1 with
 * one canonical action the author then tunes in the dialog. Exported because a placement also STORES
 * its label as the fresh event's name (see `eventToolFor`), so the sidebar list can tell a teleporter
 * from a chest instead of showing five identical "Custom event" rows. */
export const PRESET_LABEL: Record<EventPreset, MessageKey> = {
  raw: "editor.event.preset.raw",
  teleporter: "editor.event.preset.teleporter",
  sign: "editor.event.preset.sign",
  chest: "editor.event.preset.chest",
  endgame: "editor.event.preset.endgame",
};

export const HARVEST_PRESET_LABEL: Record<HarvestPresetId, MessageKey> = {
  tree: "editor.harvest.preset.tree",
  stone_outcrop: "editor.harvest.preset.stone",
  iron_outcrop: "editor.harvest.preset.iron",
  gold_small: "editor.harvest.preset.goldSmall",
  gold_large: "editor.harvest.preset.goldLarge",
  meat_cache: "editor.harvest.preset.meat",
  sheep: "editor.harvest.preset.sheep",
  happy_sheep: "editor.harvest.preset.happySheep",
};

/** The kind-tagged placements shown alongside the command PRESETS. Entry/exit are GONE from authoring
 *  (the adventure graph is no longer authored — a teleporter preset replaces an exit, and a hero
 *  spawns on a placed `spawn` event); `normal` is absent because presets are how a custom event
 *  is placed. What remains here are the non-monster placements that map to live runtime behaviour:
 *  `spawn` (D25's adventure-start anchor) and `guard` (a conditional allied combatant). Monsters
 *  have their own visible catalogue below so every supported species is directly selectable.
 *  Existing entry/exit events on an old adventure's map still render and list — they just cannot be
 *  authored anew. */
const FUNCTIONAL_KINDS = ["npc", "spawn", "guard", "harvestable"] as const;

const EVENT_KIND_LABEL: Record<EventKind, MessageKey> = {
  normal: "editor.event.kind.normal",
  npc: "editor.event.kind.npc",
  entry: "editor.event.kind.entry",
  exit: "editor.event.kind.exit",
  monster: "editor.event.kind.monster",
  guard: "editor.event.kind.guard",
  harvestable: "editor.event.kind.harvestable",
  spawn: "editor.event.kind.spawn",
};

/** The wireframe's `EV{ordinal}` chip text, zero-padded to three digits — display only, identity is
 *  the uuid. Kept local so this palette does not pull the Pixi stage module in for a one-line format. */
function eventDisplayId(ordinal: number): string {
  return `EV${String(ordinal).padStart(3, "0")}`;
}

interface EventPaletteProps {
  /** The kind the next placed event will be (`normal` for a preset placement, else the functional
   *  kind). Highlights the active kind button. */
  eventKind: EventKind;
  /** Which preset a `normal` placement uses; highlights the active preset button. */
  eventPreset: EventPreset;
  /** Whether the `teleporter` preset can be placed — false when no map is open, since its `teleport`
   *  command needs the current map's uuid as a same-map destination default. */
  teleporterEnabled: boolean;
  /** The species/radius the next placed `monster` event will carry. */
  markerSpecies: MonsterSpecies;
  markerRadius: number;
  npcGraphic: EditorAssetId;
  enemyGraphic: EditorAssetId | null;
  guardGraphic: EditorAssetId;
  harvestPreset: HarvestPresetId;
  harvestGraphic: EditorAssetId;
  /** The open map's events, listed for overview + find (D14). */
  events: readonly MapEvent[];
  /** The selected event's id, so the list marks it. */
  selectedEventId: string | null;
  onSelectPreset(preset: EventPreset): void;
  onSelectEventKind(kind: EventKind): void;
  onMarkerSpeciesChange(species: MonsterSpecies): void;
  onMarkerRadiusChange(radius: number): void;
  onSelectNpcGraphic(assetId: EditorAssetId): void;
  onSelectEnemyGraphic(assetId: EditorAssetId | null): void;
  onSelectGuardGraphic(assetId: EditorAssetId): void;
  onSelectHarvestPreset(preset: HarvestPresetId): void;
  onSelectHarvestGraphic(assetId: EditorAssetId): void;
  /** Hover a list row → emphasise that event on the canvas; `null` clears it. */
  onHoverEvent(id: string | null): void;
  /** Click a list row → select that event on the canvas (like a canvas click). */
  onSelectEvent(id: string): void;
}

/**
 * Event mode's palette (D13/D14): a set of one-click scripted presets and functional kinds, a visible
 * catalogue of every runtime monster, the monster/guard radius, and a LIST of the map's events whose
 * rows highlight their marker on hover and select it on click. Stock shadcn + inline sprite previews
 * only — no Tiny Swords component ever reaches the creator tree. The event graphic is chosen inside
 * the event dialog.
 */
export function EventPalette({
  eventKind,
  eventPreset,
  teleporterEnabled,
  markerSpecies,
  markerRadius,
  npcGraphic,
  enemyGraphic,
  guardGraphic,
  harvestPreset,
  harvestGraphic,
  events,
  selectedEventId,
  onSelectPreset,
  onSelectEventKind,
  onMarkerSpeciesChange,
  onMarkerRadiusChange,
  onSelectNpcGraphic,
  onSelectEnemyGraphic,
  onSelectGuardGraphic,
  onSelectHarvestPreset,
  onSelectHarvestGraphic,
  onHoverEvent,
  onSelectEvent,
}: EventPaletteProps) {
  useLocale();
  const activeHarvestAsset = editorAsset(harvestGraphic);
  const activeCount = runtimeEventCount(events);
  const eventLimitReached = events.length >= MAX_EVENTS_PER_MAP;
  const runtimeLimitReached = activeCount >= MAX_RUNTIME_EVENTS_PER_MAP;
  const placementDisabled = (kind: EventKind) =>
    eventLimitReached || (isRuntimeEventKind(kind) && runtimeLimitReached);

  return (
    <aside
      className="flex h-full min-h-0 flex-col border-r border-zinc-200 bg-zinc-50"
      aria-label={t("editor.shell.palette.aria")}
    >
      <div className="flex h-8 flex-none items-center justify-between border-b border-zinc-200 px-3">
        <span className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
          {t("editor.shell.mode.event")}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2">
        <div
          data-testid="event-budget"
          className="grid grid-cols-2 gap-1 border-y border-zinc-200 py-1 text-[10.5px] font-semibold text-zinc-500"
        >
          <span className={eventLimitReached ? "text-red-600" : undefined}>
            {t("editor.mapBudget.events", { count: events.length, max: MAX_EVENTS_PER_MAP })}
          </span>
          <span className={runtimeLimitReached ? "text-red-600" : undefined}>
            {t("editor.mapBudget.runtimeEvents", {
              count: activeCount,
              max: MAX_RUNTIME_EVENTS_PER_MAP,
            })}
          </span>
        </div>
        {(eventLimitReached || runtimeLimitReached) && (
          <p role="status" className="rounded-md bg-red-50 px-2 py-1.5 text-[11px] text-red-700">
            {eventLimitReached
              ? t("editor.mapBudget.eventsReached", { max: MAX_EVENTS_PER_MAP })
              : t("editor.mapBudget.runtimeEventsReached", { max: MAX_RUNTIME_EVENTS_PER_MAP })}
          </p>
        )}
        <div className="flex h-6 items-center text-[10.5px] font-semibold tracking-wide text-zinc-400 uppercase">
          {t("editor.event.preset.heading")}
        </div>
        <div data-testid="event-presets" className="flex flex-col gap-1">
          {EVENT_PRESETS.map((preset) => (
            <SwatchButton
              key={preset}
              label={t(PRESET_LABEL[preset])}
              active={eventKind === "normal" && eventPreset === preset}
              disabled={
                placementDisabled("normal") || (preset === "teleporter" && !teleporterEnabled)
              }
              title={
                preset === "teleporter" && !teleporterEnabled
                  ? t("editor.event.preset.teleporter.disabled")
                  : undefined
              }
              onClick={() => onSelectPreset(preset)}
            />
          ))}
        </div>

        <div className="mt-1 flex h-6 items-center border-t border-zinc-200 text-[10.5px] font-semibold tracking-wide text-zinc-400 uppercase">
          {t("editor.event.kind.heading")}
        </div>
        <div data-testid="event-kinds" className="flex flex-col gap-1">
          {FUNCTIONAL_KINDS.map((kind) => (
            <SwatchButton
              key={kind}
              label={t(EVENT_KIND_LABEL[kind])}
              active={eventKind === kind}
              disabled={placementDisabled(kind)}
              preview={
                kind === "npc" ? undefined : kind === "harvestable" ? (
                  activeHarvestAsset ? (
                    <EditorAssetPreview asset={activeHarvestAsset} size={36} />
                  ) : undefined
                ) : (
                  <SpriteSheetPreview source={EDITOR_MARKER_PREVIEWS[kind]} frame={192} />
                )
              }
              onClick={() => onSelectEventKind(kind)}
            />
          ))}
        </div>

        {eventKind === "harvestable" && (
          <div
            data-testid="harvest-presets"
            className="flex flex-col gap-2 rounded-md border border-zinc-300 bg-zinc-100 p-2"
          >
            <div>
              <p className="text-[11px] font-semibold text-zinc-600">
                {t("editor.harvest.palette.heading")}
              </p>
              <p className="text-[10.5px] text-zinc-500">
                {t("editor.harvest.palette.description")}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-1">
              {HARVEST_PRESETS.map((preset) => {
                const asset = editorAsset(preset.intactAssetId);
                return (
                  <SwatchButton
                    key={preset.id}
                    label={t(HARVEST_PRESET_LABEL[preset.id])}
                    active={harvestPreset === preset.id}
                    disabled={placementDisabled("harvestable")}
                    preview={asset ? <EditorAssetPreview asset={asset} size={42} /> : undefined}
                    onClick={() => onSelectHarvestPreset(preset.id)}
                  />
                );
              })}
            </div>
            <details className="rounded-md border border-zinc-200 bg-white">
              <summary className="cursor-pointer px-2 py-1.5 text-[11px] font-semibold text-zinc-600">
                {t("editor.harvest.appearance.intact")}
              </summary>
              <div className="border-t border-zinc-200 p-2">
                <CatalogueAssetPicker
                  usage="scenery"
                  disabled={placementDisabled("harvestable")}
                  value={harvestGraphic}
                  onSelectAsset={onSelectHarvestGraphic}
                />
              </div>
            </details>
          </div>
        )}

        <details
          data-testid="npc-catalogue"
          className={`rounded-md border ${
            eventKind === "npc" ? "border-zinc-400 bg-zinc-100" : "border-zinc-200 bg-white"
          }`}
        >
          <summary className="cursor-pointer px-2 py-1.5 text-[11px] font-semibold text-zinc-600">
            {t("editor.event.kind.npc")}
          </summary>
          <div className="flex flex-col gap-2 border-t border-zinc-200 p-2">
            <p className="text-[10.5px] text-zinc-500">
              {t("editor.event.appearance.nativeVariants")}
            </p>
            <CatalogueAssetPicker
              usage="character"
              disabled={placementDisabled("npc")}
              value={npcGraphic}
              onSelectAsset={onSelectNpcGraphic}
            />
          </div>
        </details>

        {eventKind === "guard" && (
          <details
            data-testid="guard-appearance-catalogue"
            className="rounded-md border border-zinc-300 bg-zinc-100"
          >
            <summary className="cursor-pointer px-2 py-1.5 text-[11px] font-semibold text-zinc-600">
              {t("editor.event.kind.guard")}
            </summary>
            <div className="flex flex-col gap-2 border-t border-zinc-200 p-2">
              <p className="text-[10.5px] text-zinc-500">
                {t("editor.event.appearance.nativeVariants")}
              </p>
              <CatalogueAssetPicker
                usage="guard"
                disabled={placementDisabled("guard")}
                value={guardGraphic}
                onSelectAsset={onSelectGuardGraphic}
              />
            </div>
          </details>
        )}

        <details
          data-testid="monster-catalogue"
          className="rounded-md border border-zinc-200 bg-white"
        >
          <summary className="cursor-pointer px-2 py-1.5 text-[11px] font-semibold text-zinc-600">
            {t("editor.event.monsters.heading")}
          </summary>
          <div className="flex flex-col gap-1 border-t border-zinc-200 p-2">
            {CURATED_MONSTER_SPECIES.map((species) => {
              const idle = TINY_SWORDS_ENEMIES[species].idle;
              return (
                <SwatchButton
                  key={species}
                  label={t(`monster.${species}`)}
                  disabled={placementDisabled("monster")}
                  active={
                    eventKind === "monster" && markerSpecies === species && enemyGraphic === null
                  }
                  preview={<SpriteSheetPreview source={idle.source} frame={idle.frame} />}
                  onClick={() => {
                    onSelectEnemyGraphic(null);
                    onMarkerSpeciesChange(species);
                    onSelectEventKind("monster");
                  }}
                />
              );
            })}
          </div>
        </details>

        <details
          data-testid="enemy-catalogue"
          className={`rounded-md border ${
            eventKind === "monster" && enemyGraphic !== null
              ? "border-zinc-400 bg-zinc-100"
              : "border-zinc-200 bg-white"
          }`}
        >
          <summary className="cursor-pointer px-2 py-1.5 text-[11px] font-semibold text-zinc-600">
            {t("editor.event.enemies.heading")}
          </summary>
          <div className="flex flex-col gap-2 border-t border-zinc-200 p-2">
            <p className="text-[10.5px] text-zinc-500">{t("editor.event.enemies.description")}</p>
            <CatalogueAssetPicker
              usage="enemy"
              disabled={placementDisabled("monster")}
              value={enemyGraphic}
              onSelectAsset={(assetId) => {
                if (placementDisabled("monster")) return;
                onSelectEnemyGraphic(assetId);
                onSelectEventKind("monster");
              }}
            />
          </div>
        </details>

        {(eventKind === "monster" || eventKind === "guard" || eventKind === "npc") && (
          <div className="mt-1 flex flex-col gap-1.5 rounded-md bg-zinc-100 p-2">
            <Label htmlFor="marker-radius" className="text-[11px] text-zinc-500">
              {t("editor.markers.radius")}
            </Label>
            <Input
              id="marker-radius"
              type="number"
              className="h-7 text-xs"
              min={MIN_PATROL_RADIUS}
              max={MAX_PATROL_RADIUS}
              value={markerRadius}
              onChange={(event) => onMarkerRadiusChange(Number(event.currentTarget.value))}
            />
          </div>
        )}

        <div className="mt-1 flex h-6 items-center border-t border-zinc-200 text-[10.5px] font-semibold tracking-wide text-zinc-400 uppercase">
          {t("editor.event.list.heading")}
        </div>
        {events.length === 0 ? (
          <p className="px-1 text-[11px] text-zinc-400">{t("editor.event.list.empty")}</p>
        ) : (
          <ul
            data-testid="event-list"
            aria-label={t("editor.event.list.heading")}
            className="flex flex-col gap-0.5"
            onMouseLeave={() => onHoverEvent(null)}
          >
            {events.map((event) => (
              <li key={event.id}>
                <button
                  type="button"
                  aria-pressed={selectedEventId === event.id}
                  onMouseEnter={() => onHoverEvent(event.id)}
                  onFocus={() => onHoverEvent(event.id)}
                  onBlur={() => onHoverEvent(null)}
                  onClick={() => onSelectEvent(event.id)}
                  className={`flex w-full items-baseline gap-2 rounded-md px-2 py-1 text-left text-[12px] ${
                    selectedEventId === event.id
                      ? "bg-zinc-900 text-zinc-50"
                      : "text-zinc-600 hover:bg-zinc-200/70"
                  }`}
                >
                  <span className="text-[11px] tabular-nums">{eventDisplayId(event.ordinal)}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {event.name || t(EVENT_KIND_LABEL[event.kind])}
                  </span>
                  <span className="text-[10px] text-zinc-400 uppercase">
                    {t(EVENT_KIND_LABEL[event.kind])}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
