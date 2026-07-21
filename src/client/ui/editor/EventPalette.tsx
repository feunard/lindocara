import { CURATED_MONSTER_SPECIES, type MonsterSpecies } from "../../../shared/game.js";
import type { MessageKey } from "../../../shared/i18n/index.js";
import { MAX_PATROL_RADIUS, MIN_PATROL_RADIUS } from "../../../shared/map-data.js";
import { EVENT_KINDS, type EventKind } from "../../../shared/map-events.js";
import type { EditorAssetId } from "../../../shared/tiny-swords-catalog.js";
import { t, useLocale } from "../../i18n.js";
import { Input } from "../components/input.js";
import { Label } from "../components/label.js";
import { CatalogueAssetPicker } from "./CatalogueAssetPicker.js";
import { EDITOR_MARKER_PREVIEWS, SpriteSheetPreview, SwatchButton } from "./TerrainPalette.js";

/** The friendly label for each event kind, shown on the EV-mode kind selector. */
const EVENT_KIND_LABEL: Record<EventKind, MessageKey> = {
  normal: "editor.event.kind.normal",
  entry: "editor.event.kind.entry",
  exit: "editor.event.kind.exit",
  monster: "editor.event.kind.monster",
};

interface EventPaletteProps {
  /** The kind the next placed event will be, highlighted in the kind selector. */
  eventKind: EventKind;
  /** The default graphic the next placed `normal` event's page 1 will get, or `null` for the blank
   *  placeholder — highlighted in the Événements grid. */
  pendingEventGraphic: EditorAssetId | null;
  /** The species/radius the next placed `monster` event will carry. */
  markerSpecies: MonsterSpecies;
  markerRadius: number;
  onSelectEventKind(kind: EventKind): void;
  onSelectEventGraphic(assetId: EditorAssetId | null): void;
  onMarkerSpeciesChange(species: MonsterSpecies): void;
  onMarkerRadiusChange(radius: number): void;
}

/**
 * Event mode's palette: the event kind selector (normal / entry / exit / monster) and each kind's
 * own fields — a graphic for `normal`, species + patrol radius for `monster`. Stock shadcn + inline
 * sprite previews only — no Tiny Swords component ever reaches the creator tree.
 *
 * Split out of `TerrainPalette`'s old event body (Task 11), moved verbatim into its own mode-scoped
 * body dispatched by `EditorPalette`.
 */
export function EventPalette({
  eventKind,
  pendingEventGraphic,
  markerSpecies,
  markerRadius,
  onSelectEventKind,
  onSelectEventGraphic,
  onMarkerSpeciesChange,
  onMarkerRadiusChange,
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
          {t("editor.event.kind.heading")}
        </div>
        <div data-testid="event-kinds" className="flex flex-col gap-1">
          {EVENT_KINDS.map((kind) => (
            <SwatchButton
              key={kind}
              label={t(EVENT_KIND_LABEL[kind])}
              active={eventKind === kind}
              preview={
                <SpriteSheetPreview
                  source={EDITOR_MARKER_PREVIEWS[kind]}
                  {...(kind === "monster"
                    ? { frame: 256 }
                    : kind === "entry"
                      ? { frame: 192 }
                      : {})}
                />
              }
              onClick={() => onSelectEventKind(kind)}
            />
          ))}
        </div>

        {eventKind === "normal" && (
          <>
            <div className="mt-1 flex h-6 items-center border-t border-zinc-200 text-[10.5px] font-semibold tracking-wide text-zinc-400 uppercase">
              {t("editor.shell.events.graphic.heading")}
            </div>
            <CatalogueAssetPicker
              usage="event"
              value={pendingEventGraphic}
              onSelectAsset={onSelectEventGraphic}
              onSelectNone={() => onSelectEventGraphic(null)}
              noneLabel={t("editor.shell.events.graphic.none")}
            />
          </>
        )}

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
      </div>
    </aside>
  );
}
