import { CURATED_MONSTER_SPECIES, type MonsterSpecies } from "../../../shared/game.js";
import type { MessageKey } from "../../../shared/i18n/index.js";
import {
  MAX_MAP_ELEMENTS,
  MAX_PATROL_RADIUS,
  MIN_PATROL_RADIUS,
} from "../../../shared/map-data.js";
import { EVENT_KINDS, type EventKind } from "../../../shared/map-events.js";
import type { EditorAssetId } from "../../../shared/tiny-swords-catalog.js";
import type { RectFillContent } from "../../game/editor-state.js";
import { t, useLocale } from "../../i18n.js";
import { Input } from "../components/input.js";
import { Label } from "../components/label.js";
import { CatalogueAssetPicker } from "./CatalogueAssetPicker.js";

const ELEVATION_LEVELS: (0 | 1 | 2)[] = [0, 1, 2];

/** The friendly label for each event kind, shown on the EV-mode kind selector. */
const EVENT_KIND_LABEL: Record<EventKind, MessageKey> = {
  normal: "editor.event.kind.normal",
  entry: "editor.event.kind.entry",
  exit: "editor.event.kind.exit",
  monster: "editor.event.kind.monster",
};

interface TerrainPaletteProps {
  /** The active terrain content (grass / water / one elevation level), highlighted in the palette. */
  content: RectFillContent;
  /** UX wave #11: whether a terrain paint tool (pencil/rect/fill) is the ONE active selection. The
   *  terrain swatches read as pressed only when it is — otherwise a spawn/decoration/event owns the
   *  selection and no terrain swatch may also light up (no Herbe AND a spawn at once). */
  terrainActive: boolean;
  /** True while the fill tool is active: fill has no water primitive, so the water swatch is gated. */
  fillActive: boolean;
  /** True while the stairs stamp is the active tool. */
  stairsActive: boolean;
  /** True while the hero-spawn tool is the active tool, so its palette button reads as pressed. */
  spawnActive: boolean;
  /** True while the event tool is active: the palette swaps its terrain body for the Événements
   *  section — the kind selector and each kind's own fields. */
  eventMode: boolean;
  /** The kind the next placed event will be, highlighted in the kind selector. */
  eventKind: EventKind;
  /** The default graphic the next placed `normal` event's page 1 will get, or `null` for the blank
   *  placeholder — highlighted in the Événements grid. */
  pendingEventGraphic: EditorAssetId | null;
  /** The selected decoration, highlighted in the catalogue grid. */
  selectedAsset: EditorAssetId | null;
  /** The species/radius the next placed `monster` event will carry. */
  markerSpecies: MonsterSpecies;
  markerRadius: number;
  elementCount: number;
  onPickContent(content: RectFillContent): void;
  onSelectStairs(): void;
  onSelectSpawn(): void;
  onSelectAsset(assetId: EditorAssetId): void;
  onSelectEventKind(kind: EventKind): void;
  onSelectEventGraphic(assetId: EditorAssetId | null): void;
  onMarkerSpeciesChange(species: MonsterSpecies): void;
  onMarkerRadiusChange(radius: number): void;
}

/**
 * The wireframe's left palette: terrains (grass, water), the grass-elevation level group, the stairs
 * stamp, the hero-spawn tool, and the Tiny Swords decoration catalogue with search. In EV mode the
 * body swaps for the event kind selector (normal / entry / exit / monster) and each kind's own
 * fields — a graphic for `normal`, species + patrol radius for `monster`. Stock shadcn + inline sprite
 * previews only — no Tiny Swords component ever reaches the creator tree.
 *
 * Markers are dead (UX wave #12): entries, exits and monster spawns are typed events now, placed with
 * the EV tool's kind selector rather than their own marker tools.
 */
export function TerrainPalette({
  content,
  terrainActive,
  fillActive,
  stairsActive,
  spawnActive,
  eventMode,
  eventKind,
  pendingEventGraphic,
  selectedAsset,
  markerSpecies,
  markerRadius,
  elementCount,
  onPickContent,
  onSelectStairs,
  onSelectSpawn,
  onSelectAsset,
  onSelectEventKind,
  onSelectEventGraphic,
  onMarkerSpeciesChange,
  onMarkerRadiusChange,
}: TerrainPaletteProps) {
  useLocale();

  // Gated on `terrainActive` (UX wave #11): a terrain swatch is pressed only when a terrain tool is the
  // one active selection, never merely because `content` still remembers a grass/water pick made
  // before a spawn or decoration was selected.
  const grassActive = terrainActive && content.kind === "block" && content.block === "grass";
  const waterActive = terrainActive && content.kind === "block" && content.block === "water";

  return (
    <aside
      className="flex h-full min-h-0 flex-col border-r border-zinc-200 bg-zinc-50"
      aria-label={t("editor.shell.palette.aria")}
    >
      <div className="flex h-8 flex-none items-center justify-between border-b border-zinc-200 px-3">
        <span className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
          {eventMode ? t("editor.shell.mode.event") : t("editor.shell.terrain.heading")}
        </span>
      </div>

      {eventMode ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2">
          <div className="flex h-6 items-center text-[10.5px] font-semibold tracking-wide text-zinc-400 uppercase">
            {t("editor.event.kind.heading")}
          </div>
          <div className="flex flex-col gap-1">
            {EVENT_KINDS.map((kind) => (
              <SwatchButton
                key={kind}
                label={t(EVENT_KIND_LABEL[kind])}
                active={eventKind === kind}
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
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2">
          <div className="grid grid-cols-2 gap-1.5">
            <SwatchButton
              label={t("editor.tool.grass")}
              active={grassActive}
              onClick={() => onPickContent({ kind: "block", block: "grass" })}
            />
            <SwatchButton
              label={t("editor.tool.water")}
              active={waterActive}
              disabled={fillActive}
              title={fillActive ? t("editor.shell.fill.water_disabled") : undefined}
              onClick={() => onPickContent({ kind: "block", block: "water" })}
            />
          </div>

          <div className="flex items-center justify-between gap-2 px-0.5">
            <span className="text-[11.5px] text-zinc-500">
              {t("editor.shell.terrain.elevationLabel")}
            </span>
            <div className="flex gap-0.5 rounded-lg bg-zinc-100 p-0.5">
              {ELEVATION_LEVELS.map((level) => {
                const active =
                  terrainActive && content.kind === "elevation" && content.level === level;
                return (
                  <button
                    key={level}
                    type="button"
                    aria-label={t("editor.shell.terrain.level", { level })}
                    aria-pressed={active}
                    onClick={() => onPickContent({ kind: "elevation", level })}
                    className={`flex size-6 items-center justify-center rounded-md text-[12px] font-medium tabular-nums ${
                      active ? "bg-zinc-900 text-zinc-50" : "text-zinc-600 hover:bg-zinc-200/70"
                    }`}
                  >
                    {level}
                  </button>
                );
              })}
            </div>
          </div>

          <SwatchButton
            label={t("editor.shell.tool.stairs")}
            active={stairsActive}
            onClick={onSelectStairs}
          />
          <SwatchButton
            label={t("editor.tool.spawn")}
            active={spawnActive}
            onClick={onSelectSpawn}
          />

          <div className="mt-1 flex h-6 items-center justify-between border-y border-zinc-200 text-[10.5px] font-semibold tracking-wide text-zinc-400 uppercase">
            <span>{t("editor.shell.decor.heading")}</span>
            <span className="tabular-nums lowercase">
              {elementCount}/{MAX_MAP_ELEMENTS}
            </span>
          </div>
          <CatalogueAssetPicker value={selectedAsset} onSelectAsset={onSelectAsset} />
        </div>
      )}
    </aside>
  );
}

function SwatchButton({
  label,
  active,
  disabled,
  title,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled?: boolean | undefined;
  title?: string | undefined;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={`rounded-md px-2 py-1.5 text-left text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? "bg-zinc-900 text-zinc-50" : "text-zinc-600 hover:bg-zinc-200/70"
      }`}
    >
      {label}
    </button>
  );
}
