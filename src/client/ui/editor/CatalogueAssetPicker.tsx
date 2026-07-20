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
    () => [...new Set(EDITOR_ASSETS.map((asset) => asset.editor.category))].sort(),
    [],
  );

  const filteredAssets = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return EDITOR_ASSETS.filter((asset) => {
      if (category !== "all" && asset.editor.category !== category) return false;
      const haystack =
        `${asset.id} ${asset.role} ${asset.category} ${asset.tags.join(" ")}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [category, query]);

  const groups = useMemo(() => {
    const grouped = new Map<string, EditorAssetDefinition[]>();
    for (const asset of filteredAssets.slice(0, visibleCount)) {
      const list = grouped.get(asset.editor.category) ?? [];
      list.push(asset);
      grouped.set(asset.editor.category, list);
    }
    return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right));
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
  const collides = asset.editor.collisionFootprint.length > 0;
  const displayName =
    asset.sourcePath
      .split("/")
      .at(-1)
      ?.replace(/\.png$/i, "")
      .replaceAll("_", " ")
      .replaceAll("-", " ") ?? asset.id.split(".").at(-1);
  return (
    <button
      type="button"
      aria-pressed={selected}
      title={`${asset.role} · ${asset.editor.allowedTerrain.join(", ")}`}
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
      <span className="sr-only">{asset.id.split(".").at(-1)}</span>
      <span className="sr-only">{asset.id}</span>
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
