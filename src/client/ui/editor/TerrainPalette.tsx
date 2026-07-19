import { useMemo, useState } from "react";
import { MONSTER_SPECIES_KIND, type MonsterSpecies } from "../../../shared/game.js";
import {
  MAX_MAP_ELEMENTS,
  MAX_PATROL_RADIUS,
  MIN_PATROL_RADIUS,
} from "../../../shared/map-data.js";
import {
  EDITOR_ASSETS,
  type EditorAssetDefinition,
  type EditorAssetId,
} from "../../../shared/tiny-swords-catalog.js";
import type { RectFillContent } from "../../game/editor-state.js";
import { tinySwordsSourceUrl } from "../../game/tiny-swords-assets.js";
import { t, useLocale } from "../../i18n.js";
import { Input } from "../components/input.js";
import { Label } from "../components/label.js";

/** The marker-authoring tools the palette exposes, restored from the pre-merge MapEditor. */
export type MarkerToolKey = "spawn" | "entry" | "exit" | "monster";
export const MARKER_TOOL_KEYS: MarkerToolKey[] = ["spawn", "entry", "exit", "monster"];

const ELEVATION_LEVELS: (0 | 1 | 2)[] = [0, 1, 2];

interface TerrainPaletteProps {
  /** The active terrain content (grass / water / one elevation level), highlighted in the palette. */
  content: RectFillContent;
  /** True while the fill tool is active: fill has no water primitive, so the water swatch is gated. */
  fillActive: boolean;
  /** True while the stairs stamp is the active tool. */
  stairsActive: boolean;
  /** The active marker tool, if any, so its palette button reads as pressed. */
  activeMarker: MarkerToolKey | null;
  /** True while the event tool is active: the palette swaps its terrain body for the Événements
   *  section, the default-graphic picker for new event placements. */
  eventMode: boolean;
  /** The default graphic the next placed event's page 1 will get, or `null` for the blank
   *  placeholder — highlighted in the Événements grid. */
  pendingEventGraphic: EditorAssetId | null;
  /** The selected decoration, highlighted in the catalogue grid. */
  selectedAsset: EditorAssetId | null;
  markerSpecies: MonsterSpecies;
  markerRadius: number;
  elementCount: number;
  onPickContent(content: RectFillContent): void;
  onSelectStairs(): void;
  onSelectMarkerTool(key: MarkerToolKey): void;
  onSelectAsset(assetId: EditorAssetId): void;
  onSelectEventGraphic(assetId: EditorAssetId | null): void;
  onMarkerSpeciesChange(species: MonsterSpecies): void;
  onMarkerRadiusChange(radius: number): void;
}

/**
 * The wireframe's left palette, replacing the floating scenery palette: terrains (grass, water), the
 * grass-elevation level group, the stairs stamp, the marker tools, and the Tiny Swords decoration
 * catalogue with search. Stock shadcn + inline sprite previews only — no Tiny Swords component ever
 * reaches the creator tree.
 *
 * Selection composes with the toolbar's tool in the screen: a terrain pick feeds pencil/rect/fill,
 * the stairs and marker picks set their own tools. Fill has no water fill primitive, so the water
 * swatch is disabled while fill is active (the screen closes the reverse by never entering fill with
 * water selected).
 */
export function TerrainPalette({
  content,
  fillActive,
  stairsActive,
  activeMarker,
  eventMode,
  pendingEventGraphic,
  selectedAsset,
  markerSpecies,
  markerRadius,
  elementCount,
  onPickContent,
  onSelectStairs,
  onSelectMarkerTool,
  onSelectAsset,
  onSelectEventGraphic,
  onMarkerSpeciesChange,
  onMarkerRadiusChange,
}: TerrainPaletteProps) {
  useLocale();
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const filtered = EDITOR_ASSETS.filter((asset) => {
      const haystack =
        `${asset.id} ${asset.role} ${asset.category} ${asset.tags.join(" ")}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
    const grouped = new Map<string, EditorAssetDefinition[]>();
    for (const asset of filtered) {
      const list = grouped.get(asset.editor.category) ?? [];
      list.push(asset);
      grouped.set(asset.editor.category, list);
    }
    return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [query]);

  const grassActive = content.kind === "block" && content.block === "grass";
  const waterActive = content.kind === "block" && content.block === "water";

  return (
    <aside
      className="flex h-full min-h-0 flex-col border-r border-zinc-200 bg-zinc-50"
      aria-label={t("editor.shell.palette.aria")}
    >
      <div className="flex h-8 flex-none items-center justify-between border-b border-zinc-200 px-3">
        <span className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
          {eventMode ? t("editor.shell.events") : t("editor.shell.terrain.heading")}
        </span>
      </div>

      {eventMode ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2">
          <div className="flex h-6 items-center text-[10.5px] font-semibold tracking-wide text-zinc-400 uppercase">
            {t("editor.shell.events.graphic.heading")}
          </div>
          <SwatchButton
            label={t("editor.shell.events.graphic.none")}
            active={pendingEventGraphic === null}
            onClick={() => onSelectEventGraphic(null)}
          />
          <Input
            type="search"
            value={query}
            aria-label={t("editor.palette.search")}
            placeholder={t("editor.palette.search")}
            className="h-7 text-xs"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          <div className="flex flex-col gap-2">
            {groups.map(([category, assets]) => (
              <div key={category} className="flex flex-col gap-1">
                <span className="px-0.5 text-[10.5px] font-medium text-zinc-400">
                  {category} ({assets.length})
                </span>
                <div className="grid grid-cols-3 gap-1">
                  {assets.map((asset) => (
                    <AssetChoice
                      key={asset.id}
                      asset={asset}
                      selected={asset.id === pendingEventGraphic}
                      onSelect={onSelectEventGraphic}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
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
                const active = content.kind === "elevation" && content.level === level;
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

          <div className="mt-1 flex h-6 items-center border-y border-zinc-200 text-[10.5px] font-semibold tracking-wide text-zinc-400 uppercase">
            {t("editor.shell.markers.heading")}
          </div>
          <div className="flex flex-col gap-1">
            {MARKER_TOOL_KEYS.map((key) => (
              <SwatchButton
                key={key}
                label={t(`editor.tool.${key}`)}
                active={activeMarker === key}
                onClick={() => onSelectMarkerTool(key)}
              />
            ))}
            {activeMarker === "monster" && (
              <div className="flex flex-col gap-1.5 rounded-md bg-zinc-100 p-2">
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
                  {(Object.keys(MONSTER_SPECIES_KIND) as MonsterSpecies[]).map((option) => (
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

          <div className="mt-1 flex h-6 items-center justify-between border-y border-zinc-200 text-[10.5px] font-semibold tracking-wide text-zinc-400 uppercase">
            <span>{t("editor.shell.decor.heading")}</span>
            <span className="tabular-nums lowercase">
              {elementCount}/{MAX_MAP_ELEMENTS}
            </span>
          </div>
          <Input
            type="search"
            value={query}
            aria-label={t("editor.palette.search")}
            placeholder={t("editor.palette.search")}
            className="h-7 text-xs"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          <div className="flex flex-col gap-2">
            {groups.map(([category, assets]) => (
              <div key={category} className="flex flex-col gap-1">
                <span className="px-0.5 text-[10.5px] font-medium text-zinc-400">
                  {category} ({assets.length})
                </span>
                <div className="grid grid-cols-3 gap-1">
                  {assets.map((asset) => (
                    <AssetChoice
                      key={asset.id}
                      asset={asset}
                      selected={asset.id === selectedAsset}
                      onSelect={onSelectAsset}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
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

/** One decoration in the catalogue grid: a cropped native-scale sprite preview above the asset's
 *  short id, its allowed terrain, and a Solid badge when it collides. The text is the button's
 *  accessible name, matching the pre-merge palette so the same searches select the same asset. */
function AssetChoice({
  asset,
  selected,
  onSelect,
}: {
  asset: EditorAssetDefinition;
  selected: boolean;
  onSelect(assetId: EditorAssetId): void;
}) {
  const collides = asset.editor.collisionFootprint.length > 0;
  const crop =
    asset.editor.sourceRect ??
    (asset.frame
      ? { x: 0, y: 0, width: asset.frame.width, height: asset.frame.height }
      : { x: 0, y: 0, width: asset.width, height: asset.height });
  const previewScale = Math.min(56 / crop.width, 56 / crop.height, 1);
  return (
    <button
      type="button"
      aria-pressed={selected}
      title={`${asset.role} · ${asset.editor.allowedTerrain.join(", ")}`}
      onClick={() => onSelect(asset.id as EditorAssetId)}
      className={`flex flex-col items-center gap-0.5 rounded-md border p-1 text-center ${
        selected ? "border-zinc-900 bg-white" : "border-zinc-200 bg-white hover:border-zinc-400"
      }`}
    >
      <span
        aria-hidden="true"
        className="flex h-14 w-full items-center justify-center overflow-hidden rounded bg-zinc-100"
      >
        <span
          style={{
            width: crop.width,
            height: crop.height,
            backgroundImage: `url("${tinySwordsSourceUrl(asset.sourcePath)}")`,
            backgroundPosition: `${-crop.x}px ${-crop.y}px`,
            transform: `scale(${previewScale})`,
            imageRendering: "pixelated",
          }}
        />
      </span>
      <strong className="w-full truncate text-[10.5px] font-semibold text-zinc-700">
        {asset.id.split(".").at(-1)}
      </strong>
      <small className="w-full truncate text-[9.5px] text-zinc-400">
        {asset.editor.allowedTerrain.join(" · ")}
      </small>
      {collides && (
        <span className="text-[9px] font-medium text-amber-600">
          {t("editor.palette.collision")}
        </span>
      )}
    </button>
  );
}
