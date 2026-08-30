import { Input } from "@alepha/ui/components/ui/input";
import { t, useLocale } from "@lindocara/client/i18n.js";
import { BRIDGE_ASSET_IDS } from "@lindocara/engine/bridges.js";
import { nativeHarvestPresetForAsset } from "@lindocara/engine/harvest-presets.js";
import type { MessageKey } from "@lindocara/engine/i18n/index.js";
import type { MapEnvironment } from "@lindocara/engine/map-environment.js";
import {
  EDITOR_ASSETS,
  type EditorAssetDefinition,
  type EditorAssetId,
  type EditorTerrain,
  EVENT_GRAPHIC_ASSETS,
  GUARD_APPEARANCE_ASSETS,
  LINDOCARA_BUILDING_ASSET_IDS,
  LINDOCARA_INTERIOR_ASSET_IDS,
  LINDOCARA_RUNNER_ASSET_IDS,
  LINDOCARA_STRUCTURE_ASSET_IDS,
  NPC_MODEL_ASSETS,
  PLACEABLE_EDITOR_ASSETS,
} from "@lindocara/engine/tiny-swords-catalog.js";
import { tinySwordsSourceUrl } from "@lindocara/renderer/tiny-swords-assets.js";
import { useMemo, useState } from "react";

interface CatalogueAssetPickerProps {
  value: EditorAssetId | null;
  onSelectAsset(assetId: EditorAssetId): void;
  onSelectNone?: (() => void) | undefined;
  noneLabel?: string | undefined;
  usage?: "scenery" | "event" | "character" | "enemy" | "guard";
  environment?: MapEnvironment | undefined;
  disabled?: boolean | undefined;
}

const ASSET_PAGE_SIZE = 12;

/**
 * Décor-first category order (D3). The palette exists mainly to place scenery (trees, bushes,
 * rocks). Legacy Tiny Swords buildings once dominated the raw catalogue. The engine now keeps
 * those ids only for
 * stored-map compatibility and offers the compact Lindocara family for new placement. Ranking
 * still puts Buildings after environmental scenery, and is also
 * applied to `filteredAssets` before pagination slices the first page — otherwise the first
 * `ASSET_PAGE_SIZE` items would still all be Buildings even though the *groups* are shown in the
 * right order afterwards. Unlisted categories rank last, just after Buildings (defensive, if a
 * future asset ships a category this list doesn't know about).
 */
const CATEGORY_ORDER = [
  "atmosphere",
  "trees",
  "vegetation",
  "small-decor",
  "water-decor",
  "rocks",
  "farm-and-village",
  "resources",
  "bridges",
  "signs",
  "interior-furniture",
  "architecture",
  "traps-and-defenses",
  "buildings",
] as const;

const FACTION_ORDER = ["general", "human", "goblin", "orc-troll", "beastfolk", "wild-tribe"];
const PURPOSE_ORDER = ["housing", "command", "training", "community", "daily-life"];

const INTERIOR_SCENERY_CATEGORIES: ReadonlySet<string> = new Set([
  "interior-furniture",
  "small-decor",
  "signs",
  "camp-and-treasure",
  "architecture",
]);

function categoryRank(category: string): number {
  const index = CATEGORY_ORDER.indexOf(category as (typeof CATEGORY_ORDER)[number]);
  return index === -1 ? CATEGORY_ORDER.length : index;
}

// Buildings ship five recolours of the same file name inside a "<Colour> Buildings" source
// folder (Black/Blue/Purple/Red/Yellow) — two "Archery" cards read as duplicates (C3). Matches
// that folder shape so its colour can suffix the name; returns null for every other asset, which
// never needed a suffix before and shouldn't gain a noisy one now.
const COLOR_BUILDING_FOLDER = /^(.+)\s+Buildings$/i;

function folderVariant(asset: EditorAssetDefinition): string | null {
  const parts = asset.sourcePath.split("/");
  const folder = parts.length >= 2 ? parts[parts.length - 2] : undefined;
  if (!folder) return null;
  const match = folder.match(COLOR_BUILDING_FOLDER);
  if (match?.[1]) return match[1];
  // Actor recolours live either under "Blue Units" or a simple "Blue" folder. These are real
  // separate Tiny Swords sheets, so expose that native variant instead of tinting one sprite.
  for (const part of [...parts].reverse()) {
    const color = part.match(/^(Black|Blue|Purple|Red|Yellow)(?: Units)?$/i);
    if (color?.[1]) return color[1];
  }
  return null;
}

function baseAssetName(asset: EditorAssetDefinition): string {
  const name =
    asset.sourcePath
      .split("/")
      .at(-1)
      ?.replace(/\.png$/i, "")
      .replaceAll("_", " ")
      .replaceAll("-", " ") ??
    asset.id.split(".").at(-1) ??
    asset.id;
  if (name.toLowerCase() !== "idle") return name;
  const parent = asset.sourcePath.split("/").at(-2);
  return parent ? `${parent} ${name}` : name;
}

/** Every asset's display name, disambiguated (C3) only where the plain file-derived name actually
 * collides with another asset's — most assets need no suffix at all, so this never adds one to a
 * name that is already unique. Computed once at module scope: `EDITOR_ASSETS` is a static import,
 * so there is nothing to recompute per render. The rare pair that even shares a source folder (the
 * wood bridge's horizontal/vertical placement, one sprite sheet) falls back to the asset id's own
 * last segment, which is guaranteed distinct — that's what the id space is for. */
const ASSET_DISPLAY_NAMES: ReadonlyMap<EditorAssetId, string> = (() => {
  const baseNames = new Map<EditorAssetId, string>();
  const counts = new Map<string, number>();
  for (const asset of EDITOR_ASSETS) {
    const name = baseAssetName(asset);
    baseNames.set(asset.id as EditorAssetId, name);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const names = new Map<EditorAssetId, string>();
  for (const asset of EDITOR_ASSETS) {
    const assetId = asset.id as EditorAssetId;
    const name = baseNames.get(assetId) ?? asset.id;
    if ((counts.get(name) ?? 0) <= 1) {
      names.set(assetId, name);
      continue;
    }
    const variant = folderVariant(asset) ?? asset.id.split(".").at(-1) ?? asset.id;
    names.set(assetId, `${name} (${variant})`);
  }
  return names;
})();

const LINDOCARA_ASSET_LABELS: Readonly<Record<string, MessageKey>> = {
  // Both bridge ids, and NOT for the usual reason. The sheet-derived names ("Bridge All
  // (horizontal)" / "(vertical)") were already ugly, and they became wrong when placement started
  // choosing the orientation from the crossing: the one card an author clicks must not promise a
  // direction the click may not produce.
  [BRIDGE_ASSET_IDS.horizontal]: "editor.asset.bridge.wood",
  [BRIDGE_ASSET_IDS.vertical]: "editor.asset.bridge.wood",
  [LINDOCARA_BUILDING_ASSET_IDS.house]: "editor.asset.lindocara.house",
  [LINDOCARA_BUILDING_ASSET_IDS.stoneTower]: "editor.asset.lindocara.stoneTower",
  [LINDOCARA_BUILDING_ASSET_IDS.archeryGuild]: "editor.asset.lindocara.archeryGuild",
  [LINDOCARA_BUILDING_ASSET_IDS.barracks]: "editor.asset.lindocara.barracks",
  [LINDOCARA_BUILDING_ASSET_IDS.monastery]: "editor.asset.lindocara.monastery",
  [LINDOCARA_BUILDING_ASSET_IDS.castle]: "editor.asset.lindocara.castle",
  [LINDOCARA_BUILDING_ASSET_IDS.windmill]: "editor.asset.lindocara.windmill",
  [LINDOCARA_INTERIOR_ASSET_IDS.hearth]: "editor.asset.lindocara.hearth",
  [LINDOCARA_INTERIOR_ASSET_IDS.bed]: "editor.asset.lindocara.bed",
  [LINDOCARA_INTERIOR_ASSET_IDS.table]: "editor.asset.lindocara.table",
  [LINDOCARA_INTERIOR_ASSET_IDS.cupboard]: "editor.asset.lindocara.cupboard",
  [LINDOCARA_INTERIOR_ASSET_IDS.rug]: "editor.asset.lindocara.rug",
  [LINDOCARA_INTERIOR_ASSET_IDS.doubleBed]: "editor.asset.lindocara.doubleBed",
  [LINDOCARA_INTERIOR_ASSET_IDS.wardrobe]: "editor.asset.lindocara.wardrobe",
  [LINDOCARA_INTERIOR_ASSET_IDS.diningTable]: "editor.asset.lindocara.diningTable",
  [LINDOCARA_INTERIOR_ASSET_IDS.chair]: "editor.asset.lindocara.chair",
  [LINDOCARA_INTERIOR_ASSET_IDS.sofa]: "editor.asset.lindocara.sofa",
  [LINDOCARA_INTERIOR_ASSET_IDS.coffeeTable]: "editor.asset.lindocara.coffeeTable",
  [LINDOCARA_INTERIOR_ASSET_IDS.bar]: "editor.asset.lindocara.bar",
  [LINDOCARA_INTERIOR_ASSET_IDS.fireplace]: "editor.asset.lindocara.fireplace",
  [LINDOCARA_INTERIOR_ASSET_IDS.wallTapestry]: "editor.asset.lindocara.wallTapestry",
  [LINDOCARA_INTERIOR_ASSET_IDS.oilLampTable]: "editor.asset.lindocara.oilLampTable",
  [LINDOCARA_INTERIOR_ASSET_IDS.oilLampWall]: "editor.asset.lindocara.oilLampWall",
  [LINDOCARA_INTERIOR_ASSET_IDS.torchFloor]: "editor.asset.lindocara.torchFloor",
  [LINDOCARA_INTERIOR_ASSET_IDS.torchWall]: "editor.asset.lindocara.torchWall",
  [LINDOCARA_INTERIOR_ASSET_IDS.doorTimber]: "editor.asset.lindocara.doorTimber",
  [LINDOCARA_INTERIOR_ASSET_IDS.doorStone]: "editor.asset.lindocara.doorStone",
  [LINDOCARA_RUNNER_ASSET_IDS.spikeTrap]: "editor.asset.lindocara.spikeTrap",
  [LINDOCARA_RUNNER_ASSET_IDS.pushTrap]: "editor.asset.lindocara.pushTrap",
  [LINDOCARA_RUNNER_ASSET_IDS.launchTrap]: "editor.asset.lindocara.launchTrap",
  [LINDOCARA_RUNNER_ASSET_IDS.barricade]: "editor.asset.lindocara.barricade",
  [LINDOCARA_RUNNER_ASSET_IDS.goblinBarricade]: "editor.asset.lindocara.goblinBarricade",
  [LINDOCARA_RUNNER_ASSET_IDS.orcBarricade]: "editor.asset.lindocara.orcBarricade",
  [LINDOCARA_STRUCTURE_ASSET_IDS.caveWall]: "editor.asset.lindocara.caveWall",
  [LINDOCARA_STRUCTURE_ASSET_IDS.castleWall]: "editor.asset.lindocara.castleWall",
  [LINDOCARA_STRUCTURE_ASSET_IDS.timberWall]: "editor.asset.lindocara.timberWall",
  [LINDOCARA_STRUCTURE_ASSET_IDS.caveCeiling]: "editor.asset.lindocara.caveCeiling",
  [LINDOCARA_STRUCTURE_ASSET_IDS.castleCeiling]: "editor.asset.lindocara.castleCeiling",
  [LINDOCARA_STRUCTURE_ASSET_IDS.timberCeiling]: "editor.asset.lindocara.timberCeiling",
};

export function assetDisplayName(asset: EditorAssetDefinition): string {
  const lindocaraLabel = LINDOCARA_ASSET_LABELS[asset.id];
  if (lindocaraLabel) return t(lindocaraLabel);
  if (asset.editor.buildingFaction) {
    const slug = asset.id.split(".").at(-1);
    if (slug) return t(`editor.asset.factionBuilding.${slug}` as MessageKey);
  }
  return ASSET_DISPLAY_NAMES.get(asset.id as EditorAssetId) ?? asset.id;
}

function factionRank(faction: string): number {
  const index = FACTION_ORDER.indexOf(faction);
  return index === -1 ? FACTION_ORDER.length : index;
}

function purposeRank(purpose: string | undefined): number {
  if (!purpose) return -1;
  const index = PURPOSE_ORDER.indexOf(purpose);
  return index === -1 ? PURPOSE_ORDER.length : index;
}

function assetFaction(asset: EditorAssetDefinition): string | null {
  if (asset.editor.category === "buildings") return asset.editor.buildingFaction ?? "human";
  if (asset.editor.category === "traps-and-defenses")
    return asset.editor.editorFaction ?? "general";
  return null;
}

function assetGroupKey(asset: EditorAssetDefinition): string {
  const faction = assetFaction(asset);
  return faction ? `${asset.editor.category}::${faction}` : asset.editor.category;
}

function groupRank(group: string): number {
  const [category, faction] = group.split("::");
  return categoryRank(category ?? group) * 10 + factionRank(faction ?? "general");
}

function groupLabel(group: string): string {
  const [category, faction] = group.split("::");
  if (!faction) return categoryLabel(category ?? group);
  return `${categoryLabel(category ?? group)} · ${t(`editor.palette.faction.${faction}` as MessageKey)}`;
}

/** Searchable access to every asset carrying editor placement metadata. The catalogue is the
 * authority for crop, footprint, collision, terrain and render layer, so the palette and stage can
 * expose the complete set without inventing per-component exceptions. */
export function CatalogueAssetPicker({
  value,
  onSelectAsset,
  onSelectNone,
  noneLabel,
  usage = "scenery",
  environment = "exterior",
  disabled = false,
}: CatalogueAssetPickerProps) {
  useLocale();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const actorPageSize =
    usage === "character" || usage === "enemy" ? NPC_MODEL_ASSETS.length : ASSET_PAGE_SIZE;
  const [visibleCount, setVisibleCount] = useState(actorPageSize);

  const fullSource =
    usage === "event"
      ? EVENT_GRAPHIC_ASSETS
      : usage === "character" || usage === "enemy"
        ? NPC_MODEL_ASSETS
        : usage === "guard"
          ? GUARD_APPEARANCE_ASSETS
          : PLACEABLE_EDITOR_ASSETS;
  const source =
    usage !== "scenery"
      ? fullSource
      : environment === "interior"
        ? fullSource.filter((asset) => INTERIOR_SCENERY_CATEGORIES.has(asset.editor.category))
        : fullSource.filter((asset) => asset.editor.category !== "interior-furniture");
  const categories = useMemo(
    () =>
      [...new Set(source.map((asset) => asset.editor.category))].sort(
        (left, right) => categoryRank(left) - categoryRank(right),
      ),
    [source],
  );

  const filteredAssets = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return source
      .filter((asset) => {
        if (category !== "all" && asset.editor.category !== category) return false;
        const haystack =
          `${assetDisplayName(asset)} ${asset.id} ${asset.role} ${asset.category} ${asset.tags.join(" ")} ${asset.editor.buildingFaction ?? ""} ${asset.editor.buildingPurpose ?? ""} ${asset.editor.editorFaction ?? ""}`.toLowerCase();
        return terms.every((term) => haystack.includes(term));
      })
      .sort((left, right) => {
        const categoryDifference =
          categoryRank(left.editor.category) - categoryRank(right.editor.category);
        if (categoryDifference !== 0) return categoryDifference;
        const factionDifference =
          factionRank(assetFaction(left) ?? "general") -
          factionRank(assetFaction(right) ?? "general");
        if (factionDifference !== 0) return factionDifference;
        const purposeDifference =
          purposeRank(left.editor.buildingPurpose) - purposeRank(right.editor.buildingPurpose);
        if (purposeDifference !== 0) return purposeDifference;
        return left.id.localeCompare(right.id);
      });
  }, [category, query, source]);

  const groups = useMemo(() => {
    const grouped = new Map<string, EditorAssetDefinition[]>();
    for (const asset of filteredAssets.slice(0, visibleCount)) {
      const key = assetGroupKey(asset);
      const list = grouped.get(key) ?? [];
      list.push(asset);
      grouped.set(key, list);
    }
    return [...grouped.entries()].sort(([left], [right]) => groupRank(left) - groupRank(right));
  }, [filteredAssets, visibleCount]);

  return (
    <>
      {onSelectNone && (
        <button
          type="button"
          aria-pressed={value === null}
          disabled={disabled}
          onClick={onSelectNone}
          className={`rounded-md px-2 py-1.5 text-left text-[12px] font-medium ${
            value === null ? "bg-zinc-900 text-zinc-50" : "text-zinc-600 hover:bg-zinc-200/70"
          }`}
        >
          {noneLabel}
        </button>
      )}
      <Input
        type="search"
        disabled={disabled}
        value={query}
        aria-label={t("editor.palette.search")}
        placeholder={t("editor.palette.search")}
        className="h-7 text-xs"
        onChange={(event) => {
          setQuery(event.currentTarget.value);
          setVisibleCount(actorPageSize);
        }}
      />
      <select
        disabled={disabled}
        className="border-input focus-visible:border-ring focus-visible:ring-ring/40 h-7 w-full rounded-md border bg-white px-2 text-xs outline-none focus-visible:ring-2"
        value={category}
        aria-label={t("editor.palette.category.all")}
        onChange={(event) => {
          const nextCategory = event.currentTarget.value;
          setCategory(nextCategory);
          setVisibleCount(
            nextCategory === "buildings" || nextCategory === "traps-and-defenses"
              ? source.filter((asset) => asset.editor.category === nextCategory).length
              : actorPageSize,
          );
        }}
      >
        <option value="all">{t("editor.palette.category.all")}</option>
        {categories.map((item) => (
          <option key={item} value={item}>
            {categoryLabel(item)}
          </option>
        ))}
      </select>

      {groups.length === 0 && (
        <p className="px-1 py-2 text-xs text-zinc-400">{t("editor.palette.noResults")}</p>
      )}
      <div className="flex flex-col gap-2">
        {groups.map(([group, assets]) => (
          <div key={group} className="flex flex-col gap-1">
            <span className="px-0.5 text-[10.5px] font-medium text-zinc-400">
              {groupLabel(group)} ({assets.length})
            </span>
            <div className="grid grid-cols-3 gap-1">
              {assets.map((asset) => (
                <AssetChoice
                  key={asset.id}
                  asset={asset}
                  selected={asset.id === value}
                  onSelect={onSelectAsset}
                  disabled={disabled}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      {visibleCount < filteredAssets.length && (
        <button
          type="button"
          disabled={disabled}
          className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs font-medium text-zinc-600 hover:border-zinc-400"
          onClick={() => setVisibleCount((count) => count + ASSET_PAGE_SIZE)}
        >
          {t("editor.palette.showMore", {
            shown: Math.min(visibleCount, filteredAssets.length),
            total: filteredAssets.length,
          })}
        </button>
      )}
    </>
  );
}

function AssetChoice({
  asset,
  selected,
  onSelect,
  disabled,
}: {
  asset: EditorAssetDefinition;
  selected: boolean;
  onSelect(assetId: EditorAssetId): void;
  disabled: boolean;
}) {
  // A bridge carries a collider AND `terrainOverride: "walkable"`: the collider is its raised deck
  // and rails (a surface a hero stands ON), while the override is what turns the water underneath
  // into ground. Reading the collider alone badged the one asset an author places precisely in
  // order to CROSS something as "blocking".
  const collides =
    asset.editor.collider !== undefined && asset.editor.terrainOverride !== "walkable";
  const harvestPreset = nativeHarvestPresetForAsset(asset.id as EditorAssetId);
  const harvestRange = harvestPreset
    ? harvestPreset.profile.resource === "gold"
      ? harvestPreset.profile.goldValueRange
      : harvestPreset.profile.yieldRange
    : undefined;
  const harvestAmount = harvestPreset
    ? harvestRange
      ? `${harvestRange.min}–${harvestRange.max}`
      : harvestPreset.profile.resource === "gold"
        ? harvestPreset.profile.goldValue
        : harvestPreset.profile.yieldAmount
    : null;
  const displayName = assetDisplayName(asset);
  const terrainNames = asset.editor.allowedTerrain.map((terrain: EditorTerrain) =>
    t(`editor.palette.terrain.${terrain}` as MessageKey),
  );
  // The raw dotted catalogue id (C2) is dev clutter for an author, not author-facing UI — kept only
  // as a data attribute (useful for debugging/tests), never as visible or sr-only text.
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={selected}
      data-asset-id={asset.id}
      title={displayName}
      onClick={() => onSelect(asset.id as EditorAssetId)}
      className={`flex min-w-0 flex-col items-center gap-0.5 rounded-md border p-1 text-center disabled:cursor-not-allowed disabled:opacity-40 ${
        selected ? "border-zinc-900 bg-white" : "border-zinc-200 bg-white hover:border-zinc-400"
      }`}
    >
      <EditorAssetPreview asset={asset} />
      <strong className="w-full truncate text-[10.5px] font-semibold text-zinc-700">
        {displayName}
      </strong>
      <small className="w-full truncate text-[9.5px] text-zinc-400">
        {terrainNames.join(" · ")}
      </small>
      {asset.editor.buildingPurpose && (
        <span className="text-[9px] font-medium text-sky-700">
          {t(`editor.palette.purpose.${asset.editor.buildingPurpose}` as MessageKey)} ·{" "}
          {asset.editor.buildingVariant?.toUpperCase()}
        </span>
      )}
      {harvestPreset && harvestAmount !== null && (
        <span
          data-harvest-resource={harvestPreset.profile.resource}
          className="text-[9px] font-semibold text-emerald-700"
        >
          {t(`editor.harvest.resource.${harvestPreset.profile.resource}`)} +{harvestAmount}
        </span>
      )}
      {collides && (
        <span className="text-[9px] font-medium text-amber-600">
          {t("editor.palette.collision")}
        </span>
      )}
    </button>
  );
}

/** A correctly cropped first frame. Keeping the native-size inner sprite out of flex layout avoids
 * the old double shrink that reduced 192–384px trees and buildings to one-pixel marks. */
export function EditorAssetPreview({
  asset,
  size = 56,
}: {
  asset: EditorAssetDefinition;
  size?: number;
}) {
  const crop =
    asset.editor.sourceRect ??
    (asset.frame
      ? { x: 0, y: 0, width: asset.frame.width, height: asset.frame.height }
      : { x: 0, y: 0, width: asset.width, height: asset.height });
  const previewScale = Math.min(size / crop.width, size / crop.height, 1);
  return (
    <span
      aria-hidden="true"
      className="relative flex w-full items-center justify-center overflow-hidden rounded bg-zinc-100"
      style={{ height: size }}
    >
      <span
        className="absolute top-1/2 left-1/2 flex-none"
        style={{
          width: crop.width,
          height: crop.height,
          backgroundImage: `url("${tinySwordsSourceUrl(asset.sourcePath)}")`,
          backgroundPosition: `${-crop.x}px ${-crop.y}px`,
          backgroundRepeat: "no-repeat",
          transform: `translate(-50%, -50%) scale(${previewScale})`,
          imageRendering: "pixelated",
        }}
      />
    </span>
  );
}

function categoryLabel(category: string): string {
  return t(`editor.palette.category.${category}` as Parameters<typeof t>[0]);
}
