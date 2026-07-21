import { useMemo, useState } from "react";
import {
  EDITOR_ASSETS,
  type EditorAssetDefinition,
  type EditorAssetId,
} from "../../../shared/tiny-swords-catalog.js";
import { tinySwordsSourceUrl } from "../../game/tiny-swords-assets.js";
import { t, useLocale } from "../../i18n.js";
import { Input } from "../components/input.js";

interface CatalogueAssetPickerProps {
  value: EditorAssetId | null;
  onSelectAsset(assetId: EditorAssetId): void;
  onSelectNone?: (() => void) | undefined;
  noneLabel?: string | undefined;
}

const ASSET_PAGE_SIZE = 12;

/**
 * Décor-first category order (D3). The palette exists mainly to place scenery (trees, bushes,
 * rocks) — Buildings is simply the biggest `editor.category` (62 of 126 assets) and, in raw
 * catalogue order, its five recoloured sets come first, so an un-ordered "All categories" view
 * buries every tree behind pages of Archery/Barracks recolours. Ranking puts every non-Buildings
 * category ahead of it (both in the dropdown and in the grouped "All" view below), and is also
 * applied to `filteredAssets` before pagination slices the first page — otherwise the first
 * `ASSET_PAGE_SIZE` items would still all be Buildings even though the *groups* are shown in the
 * right order afterwards. Unlisted categories rank last, just after Buildings (defensive, if a
 * future asset ships a category this list doesn't know about).
 */
const CATEGORY_ORDER = [
  "trees",
  "vegetation",
  "small-decor",
  "rocks",
  "farm-and-village",
  "resources",
  "bridges",
  "signs",
  "buildings",
] as const;

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
  return match?.[1] ?? null;
}

function baseAssetName(asset: EditorAssetDefinition): string {
  return (
    asset.sourcePath
      .split("/")
      .at(-1)
      ?.replace(/\.png$/i, "")
      .replaceAll("_", " ")
      .replaceAll("-", " ") ??
    asset.id.split(".").at(-1) ??
    asset.id
  );
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

export function assetDisplayName(asset: EditorAssetDefinition): string {
  return ASSET_DISPLAY_NAMES.get(asset.id as EditorAssetId) ?? asset.id;
}

/** Searchable access to every asset carrying editor placement metadata. The catalogue is the
 * authority for crop, footprint, collision, terrain and render layer, so the palette and stage can
 * expose the complete set without inventing per-component exceptions. */
export function CatalogueAssetPicker({
  value,
  onSelectAsset,
  onSelectNone,
  noneLabel,
}: CatalogueAssetPickerProps) {
  useLocale();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [visibleCount, setVisibleCount] = useState(ASSET_PAGE_SIZE);

  const categories = useMemo(
    () =>
      [...new Set(EDITOR_ASSETS.map((asset) => asset.editor.category))].sort(
        (left, right) => categoryRank(left) - categoryRank(right),
      ),
    [],
  );

  const filteredAssets = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return EDITOR_ASSETS.filter((asset) => {
      if (category !== "all" && asset.editor.category !== category) return false;
      const haystack =
        `${asset.id} ${asset.role} ${asset.category} ${asset.tags.join(" ")}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    }).sort(
      (left, right) => categoryRank(left.editor.category) - categoryRank(right.editor.category),
    );
  }, [category, query]);

  const groups = useMemo(() => {
    const grouped = new Map<string, EditorAssetDefinition[]>();
    for (const asset of filteredAssets.slice(0, visibleCount)) {
      const list = grouped.get(asset.editor.category) ?? [];
      list.push(asset);
      grouped.set(asset.editor.category, list);
    }
    return [...grouped.entries()].sort(
      ([left], [right]) => categoryRank(left) - categoryRank(right),
    );
  }, [filteredAssets, visibleCount]);

  return (
    <>
      {onSelectNone && (
        <button
          type="button"
          aria-pressed={value === null}
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
        value={query}
        aria-label={t("editor.palette.search")}
        placeholder={t("editor.palette.search")}
        className="h-7 text-xs"
        onChange={(event) => {
          setQuery(event.currentTarget.value);
          setVisibleCount(ASSET_PAGE_SIZE);
        }}
      />
      <select
        className="h-7 w-full rounded-md border border-input bg-white px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
        value={category}
        aria-label={t("editor.palette.category.all")}
        onChange={(event) => {
          setCategory(event.currentTarget.value);
          setVisibleCount(ASSET_PAGE_SIZE);
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
        {groups.map(([groupCategory, assets]) => (
          <div key={groupCategory} className="flex flex-col gap-1">
            <span className="px-0.5 text-[10.5px] font-medium text-zinc-400">
              {categoryLabel(groupCategory)} ({assets.length})
            </span>
            <div className="grid grid-cols-3 gap-1">
              {assets.map((asset) => (
                <AssetChoice
                  key={asset.id}
                  asset={asset}
                  selected={asset.id === value}
                  onSelect={onSelectAsset}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      {visibleCount < filteredAssets.length && (
        <button
          type="button"
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
}: {
  asset: EditorAssetDefinition;
  selected: boolean;
  onSelect(assetId: EditorAssetId): void;
}) {
  const collides = asset.editor.collider !== undefined;
  const displayName = assetDisplayName(asset);
  // The raw dotted catalogue id (C2) is dev clutter for an author, not author-facing UI — kept only
  // as a data attribute (useful for debugging/tests), never as visible or sr-only text.
  return (
    <button
      type="button"
      aria-pressed={selected}
      data-asset-id={asset.id}
      title={`${displayName} · ${asset.role} · ${asset.editor.allowedTerrain.join(", ")}`}
      onClick={() => onSelect(asset.id as EditorAssetId)}
      className={`flex min-w-0 flex-col items-center gap-0.5 rounded-md border p-1 text-center ${
        selected ? "border-zinc-900 bg-white" : "border-zinc-200 bg-white hover:border-zinc-400"
      }`}
    >
      <EditorAssetPreview asset={asset} />
      <strong className="w-full truncate text-[10.5px] font-semibold text-zinc-700">
        {displayName}
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
