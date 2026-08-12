import { t, useLocale } from "@lindocara/client/i18n.js";
import { MAX_MAP_ELEMENTS } from "@lindocara/engine/map-data.js";
import type { EditorAssetId } from "@lindocara/engine/tiny-swords-catalog.js";
import { CatalogueAssetPicker } from "./CatalogueAssetPicker.js";

interface ElementPaletteProps {
  /** The selected decoration, highlighted in the catalogue grid. */
  selectedAsset: EditorAssetId | null;
  elementCount: number;
  onSelectAsset(assetId: EditorAssetId): void;
}

/**
 * Element mode's palette: the Tiny Swords decoration catalogue with search, plus the
 * `{elementCount}/{MAX_MAP_ELEMENTS}` budget counter. Stock shadcn + inline sprite previews only —
 * no Tiny Swords component ever reaches the creator tree.
 *
 * Split out of `TerrainPalette`'s old scenery section into its own mode-scoped body. Placement uses
 * quarter-cell offsets and the selection inspector can adjust the exact slot.
 */
export function ElementPalette({
  selectedAsset,
  elementCount,
  onSelectAsset,
}: ElementPaletteProps) {
  const locale = useLocale();

  return (
    <aside
      className="flex h-full min-h-0 flex-col border-r border-zinc-200 bg-zinc-50"
      aria-label={t("editor.shell.palette.aria")}
    >
      <div className="flex h-8 flex-none items-center justify-between border-b border-zinc-200 px-3">
        <span className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
          {t("editor.shell.mode.element")}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2">
        <div
          data-testid="element-budget"
          className={`flex h-6 items-center justify-between border-y border-zinc-200 text-[10.5px] font-semibold tracking-wide uppercase ${
            elementCount >= MAX_MAP_ELEMENTS ? "text-red-600" : "text-zinc-400"
          }`}
        >
          <span>{t("editor.mapBudget.scenery")}</span>
          <span className="tabular-nums lowercase">
            {elementCount.toLocaleString(locale)}/{MAX_MAP_ELEMENTS.toLocaleString(locale)}
          </span>
        </div>
        {elementCount >= MAX_MAP_ELEMENTS && (
          <p role="status" className="rounded-md bg-red-50 px-2 py-1.5 text-[11px] text-red-700">
            {t("editor.mapBudget.sceneryReached", { max: MAX_MAP_ELEMENTS })}
          </p>
        )}
        <div data-testid="catalogue-picker" className="contents">
          <CatalogueAssetPicker value={selectedAsset} onSelectAsset={onSelectAsset} />
        </div>
      </div>
    </aside>
  );
}
