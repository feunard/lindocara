import { t, useLocale } from "@lindocara/client/i18n.js";
import { Input } from "@lindocara/client/ui/components/input.js";
import { Label } from "@lindocara/client/ui/components/label.js";
import { EVENT_PRESETS, type EventPreset } from "@lindocara/engine/event-presets.js";
import { CURATED_MONSTER_SPECIES, type MonsterSpecies } from "@lindocara/engine/game.js";
import type { MessageKey } from "@lindocara/engine/i18n/index.js";
import { MAX_PATROL_RADIUS, MIN_PATROL_RADIUS } from "@lindocara/engine/map-data.js";
import type { EventKind, MapEvent } from "@lindocara/engine/map-events.js";
import { EDITOR_MARKER_PREVIEWS, SpriteSheetPreview, SwatchButton } from "./TerrainPalette.js";

/** The popular presets shown as one-click placements. `raw` is the blank scripted event; the rest
 *  pre-fill a scripted event's page 1 with one canonical command the author then tunes in the dialog. */
const PRESET_LABEL: Record<EventPreset, MessageKey> = {
  raw: "editor.event.preset.raw",
  teleporter: "editor.event.preset.teleporter",
  sign: "editor.event.preset.sign",
  chest: "editor.event.preset.chest",
  endgame: "editor.event.preset.endgame",
};

/** The kind-tagged placements shown alongside the command PRESETS. Entry/exit are GONE from authoring
 *  (the adventure graph is no longer authored — a teleporter preset replaces an exit, and a hero
 *  spawns on a placed `spawn` event); `normal` is absent because the presets ARE how a scripted event
 *  is placed. What remains are the two placements that still map to live runtime behaviour: `spawn`
 *  (D25's adventure-start anchor — the map it sits on becomes the first map) and `monster` (spawns a
 *  patrolling monster with the chosen species/radius). Both stay kind-tagged because the runtime
 *  detects them by kind; the palette presents them as one-click placements, not a "kind selector".
 *  Existing entry/exit events on an old adventure's map still render and list — they just cannot be
 *  authored anew. */
const FUNCTIONAL_KINDS = ["spawn", "monster"] as const;

const EVENT_KIND_LABEL: Record<EventKind, MessageKey> = {
  normal: "editor.event.kind.normal",
  entry: "editor.event.kind.entry",
  exit: "editor.event.kind.exit",
  monster: "editor.event.kind.monster",
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
  /** The open map's events, listed for overview + find (D14). */
  events: readonly MapEvent[];
  /** The selected event's id, so the list marks it. */
  selectedEventId: string | null;
  onSelectPreset(preset: EventPreset): void;
  onSelectEventKind(kind: EventKind): void;
  onMarkerSpeciesChange(species: MonsterSpecies): void;
  onMarkerRadiusChange(radius: number): void;
  /** Hover a list row → emphasise that event on the canvas; `null` clears it. */
  onHoverEvent(id: string | null): void;
  /** Click a list row → select that event on the canvas (like a canvas click). */
  onSelectEvent(id: string): void;
}

/**
 * Event mode's palette (D13/D14). No inline graphic catalogue any more — the sidebar is compact: a set
 * of one-click PLACEMENTS (a raw scripted event plus popular presets, then the entry/exit/monster
 * kinds), the monster kind's own fields, and a LIST of the map's events whose rows highlight their
 * marker on hover and select it on click. Stock shadcn + inline sprite previews only — no Tiny Swords
 * component ever reaches the creator tree. The event graphic is now chosen inside the event dialog.
 */
export function EventPalette({
  eventKind,
  eventPreset,
  teleporterEnabled,
  markerSpecies,
  markerRadius,
  events,
  selectedEventId,
  onSelectPreset,
  onSelectEventKind,
  onMarkerSpeciesChange,
  onMarkerRadiusChange,
  onHoverEvent,
  onSelectEvent,
}: EventPaletteProps) {
  useLocale();

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
        <div className="flex h-6 items-center text-[10.5px] font-semibold tracking-wide text-zinc-400 uppercase">
          {t("editor.event.preset.heading")}
        </div>
        <div data-testid="event-presets" className="flex flex-col gap-1">
          {EVENT_PRESETS.map((preset) => (
            <SwatchButton
              key={preset}
              label={t(PRESET_LABEL[preset])}
              active={eventKind === "normal" && eventPreset === preset}
              disabled={preset === "teleporter" && !teleporterEnabled}
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
              preview={
                <SpriteSheetPreview
                  source={EDITOR_MARKER_PREVIEWS[kind]}
                  {...(kind === "monster" ? { frame: 256 } : { frame: 192 })}
                />
              }
              onClick={() => onSelectEventKind(kind)}
            />
          ))}
        </div>

        {eventKind === "monster" && (
          <div className="mt-1 flex flex-col gap-1.5 rounded-md bg-zinc-100 p-2">
            <Label htmlFor="marker-species" className="text-[11px] text-zinc-500">
              {t("editor.markers.species")}
            </Label>
            <select
              id="marker-species"
              className="h-7 w-full rounded-md border border-input bg-white px-1.5 text-xs outline-none"
              value={markerSpecies}
              onChange={(event) =>
                onMarkerSpeciesChange(event.currentTarget.value as MonsterSpecies)
              }
            >
              {CURATED_MONSTER_SPECIES.map((option) => (
                <option key={option} value={option}>
                  {t(`monster.${option}`)}
                </option>
              ))}
            </select>
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
                  <code className="text-[11px] tabular-nums">{eventDisplayId(event.ordinal)}</code>
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
