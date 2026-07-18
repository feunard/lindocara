import { useMemo, useState } from "react";
import { MAX_MAP_ELEMENTS } from "../../shared/map-data.js";
import {
  EDITOR_ASSETS,
  type EditorAssetDefinition,
  type EditorAssetId,
} from "../../shared/tiny-swords-catalog.js";
import { tinySwordsSourceUrl } from "../game/tiny-swords-assets.js";
import { t, useLocale } from "../i18n.js";
import { Input } from "./pixelact-ui/input.js";

interface EditorAssetPaletteProps {
  selected: EditorAssetId | null;
  elementCount: number;
  onSelect(assetId: EditorAssetId): void;
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
  const crop =
    asset.editor.sourceRect ??
    (asset.frame
      ? { x: 0, y: 0, width: asset.frame.width, height: asset.frame.height }
      : { x: 0, y: 0, width: asset.width, height: asset.height });
  const previewScale = Math.min(72 / crop.width, 72 / crop.height, 1);
  return (
    <button
      type="button"
      className="editor-asset-choice"
      data-selected={selected || undefined}
      data-collision={collides || undefined}
      aria-pressed={selected}
      title={`${asset.role} · ${asset.editor.allowedTerrain.join(", ")}`}
      onClick={() => onSelect(asset.id as EditorAssetId)}
    >
      <span
        className="editor-asset-choice__preview"
        aria-hidden="true"
        data-frame-count={asset.frame?.count ?? 1}
      >
        <span
          className="editor-asset-choice__frame"
          style={{
            width: crop.width,
            height: crop.height,
            backgroundImage: `url("${tinySwordsSourceUrl(asset.sourcePath)}")`,
            backgroundPosition: `${-crop.x}px ${-crop.y}px`,
            transform: `translate(-50%, -50%) scale(${previewScale})`,
          }}
        />
      </span>
      <strong>{asset.id.split(".").at(-1)}</strong>
      <small>{asset.editor.allowedTerrain.join(" · ")}</small>
      {collides && (
        <span className="editor-asset-choice__collision">{t("editor.palette.collision")}</span>
      )}
    </button>
  );
}

export function EditorAssetPalette({ selected, elementCount, onSelect }: EditorAssetPaletteProps) {
  useLocale();
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<EditorAssetId[]>([]);
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

  const choose = (assetId: EditorAssetId): void => {
    setRecent((current) => [assetId, ...current.filter((id) => id !== assetId)].slice(0, 6));
    onSelect(assetId);
  };
  const recentAssets = recent.flatMap((id) => {
    const asset = EDITOR_ASSETS.find((candidate) => candidate.id === id);
    return asset ? [asset] : [];
  });

  return (
    <aside className="editor-palette" aria-label={t("editor.palette.title")}>
      <header className="editor-palette__header">
        <strong>{t("editor.palette.title")}</strong>
        <span>
          {elementCount}/{MAX_MAP_ELEMENTS}
        </span>
      </header>
      <Input
        type="search"
        value={query}
        aria-label={t("editor.palette.search")}
        placeholder={t("editor.palette.search")}
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
      {recentAssets.length > 0 && (
        <details open>
          <summary>{t("editor.palette.recent")}</summary>
          <div className="editor-palette__grid">
            {recentAssets.map((asset) => (
              <AssetChoice
                key={asset.id}
                asset={asset}
                selected={asset.id === selected}
                onSelect={choose}
              />
            ))}
          </div>
        </details>
      )}
      <div className="editor-palette__groups">
        {groups.map(([category, assets], index) => (
          <details key={category} open={query.length > 0 || index < 2}>
            <summary>
              {category} <span>({assets.length})</span>
            </summary>
            <div className="editor-palette__grid">
              {assets.map((asset) => (
                <AssetChoice
                  key={asset.id}
                  asset={asset}
                  selected={asset.id === selected}
                  onSelect={choose}
                />
              ))}
            </div>
          </details>
        ))}
      </div>
    </aside>
  );
}
