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
  /** The selected asset, highlighted in the grid; `null` highlights the "none" swatch when present. */
  value: EditorAssetId | null;
  /** Picking a catalogue asset. */
  onSelectAsset(assetId: EditorAssetId): void;
  /** When provided, a "none" swatch is rendered above the search, active while `value` is `null`.
   *  Omitted where a catalogue pick is mandatory (the decor grid has no blank option). */
  onSelectNone?: (() => void) | undefined;
  /** Label for the "none" swatch; only read when `onSelectNone` is provided. */
  noneLabel?: string | undefined;
}

/**
 * The catalogue picker shared by every editor surface that chooses a Tiny Swords asset: the palette's
 * decor grid, the palette's event-graphic grid, and the event dialog's appearance grid. It is the
 * search box + the category-grouped sprite grid, with an optional "none" swatch for the two callers
 * that allow a blank choice.
 *
 * Extracted from the two near-identical copies `TerrainPalette` used to inline, before the event
 * dialog would have made a third: the grouping/search rule and the `AssetChoice` sprite crop now live
 * once, so the same query selects the same asset everywhere. Surrounding headings and counts stay with
 * each caller — only the picker body is shared. Stock shadcn `Input` + inline sprite previews; no Tiny
 * Swords component ever reaches the creator tree.
 */
export function CatalogueAssetPicker({
  value,
  onSelectAsset,
  onSelectNone,
  noneLabel,
}: CatalogueAssetPickerProps) {
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
                  selected={asset.id === value}
                  onSelect={onSelectAsset}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
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
