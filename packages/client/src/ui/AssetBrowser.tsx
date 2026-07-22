import type {
  AssetDomain,
  TinySwordsCatalogEntry,
  TinySwordsPack,
} from "@lindocara/engine/tiny-swords-catalog.js";
import { tinySwordsSourceUrl } from "@lindocara/renderer/tiny-swords-assets.js";
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { TinyButton } from "@/ui/tiny-swords/TinyButton.js";
import { TinyInput } from "@/ui/tiny-swords/TinyInput.js";
import { t, useLocale } from "../i18n.js";
import { TinyPanel } from "./tiny-swords/TinyPanel.js";
import { TinySelect } from "./tiny-swords/TinySelect.js";

const PAGE_SIZE = 48;

interface ClientCatalog {
  version: number;
  entries: TinySwordsCatalogEntry[];
}

let cataloguePromise: Promise<ClientCatalog> | null = null;

export function loadTinySwordsCatalog(): Promise<ClientCatalog> {
  cataloguePromise ??= fetch("/assets/lindocara/tiny-swords/catalog.json").then((response) => {
    if (!response.ok) throw new Error(`catalogue:${response.status}`);
    return response.json() as Promise<ClientCatalog>;
  });
  return cataloguePromise;
}

export function resetTinySwordsCatalogForTests(): void {
  cataloguePromise = null;
}

function AssetPreview({ entry }: { entry: TinySwordsCatalogEntry }) {
  const source = tinySwordsSourceUrl(entry.sourcePath);
  const frame = entry.frame;
  if (!frame) {
    return (
      <div className="asset-browser__preview">
        <img src={source} alt="" loading="lazy" width={entry.width} height={entry.height} />
      </div>
    );
  }
  const distance = frame.axis === "x" ? frame.width * frame.count : frame.height * frame.count;
  const style = {
    "--asset-frames": frame.count,
    "--asset-distance": `${distance}px`,
    "--asset-duration": `${frame.durationMs}ms`,
  } as CSSProperties;
  return (
    <div
      className={`asset-browser__preview asset-browser__preview--${frame.axis}`}
      style={{ width: frame.width, height: frame.height }}
    >
      <img src={source} alt="" loading="lazy" style={style} />
    </div>
  );
}

export function AssetBrowser() {
  useLocale();
  const [entries, setEntries] = useState<TinySwordsCatalogEntry[] | null>(null);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const [pack, setPack] = useState<TinySwordsPack | "all">("all");
  const [domain, setDomain] = useState<AssetDomain | "all">("all");
  const [category, setCategory] = useState("all");
  const [visible, setVisible] = useState(PAGE_SIZE);

  useEffect(() => {
    let active = true;
    loadTinySwordsCatalog().then(
      (catalog) => {
        if (active) setEntries(catalog.entries);
      },
      () => {
        if (active) setError(true);
      },
    );
    return () => {
      active = false;
    };
  }, []);

  const categories = useMemo(
    () =>
      [
        ...new Set(
          (entries ?? [])
            .filter((entry) => domain === "all" || entry.domain === domain)
            .map((entry) => entry.category),
        ),
      ].sort(),
    [domain, entries],
  );
  const filtered = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (entries ?? []).filter((entry) => {
      if (pack !== "all" && entry.pack !== pack) return false;
      if (domain !== "all" && entry.domain !== domain) return false;
      if (category !== "all" && entry.category !== category) return false;
      const haystack = `${entry.id} ${entry.category} ${entry.tags.join(" ")}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [category, domain, entries, pack, query]);

  return (
    <details className="asset-browser">
      <summary>{t("editor.assets.title")}</summary>
      <TinyPanel className="asset-browser__panel">
        <div className="asset-browser__filters">
          <TinyInput
            type="search"
            value={query}
            aria-label={t("editor.assets.search")}
            placeholder={t("editor.assets.search")}
            onChange={(event) => {
              setQuery(event.currentTarget.value);
              setVisible(PAGE_SIZE);
            }}
          />
          <TinySelect
            aria-label={t("editor.assets.pack")}
            value={pack}
            onChange={(event) => {
              setPack(event.currentTarget.value as TinySwordsPack | "all");
              setVisible(PAGE_SIZE);
            }}
          >
            <option value="all">{t("editor.assets.all_packs")}</option>
            <option value="Tiny Swords (Free Pack)">Free Pack</option>
            <option value="Tiny Swords (Update 010)">Update 010</option>
            <option value="Tiny Swords (Enemy Pack)">Enemy Pack</option>
          </TinySelect>
          <TinySelect
            aria-label={t("editor.assets.domain")}
            value={domain}
            onChange={(event) => {
              setDomain(event.currentTarget.value as AssetDomain | "all");
              setCategory("all");
              setVisible(PAGE_SIZE);
            }}
          >
            <option value="all">{t("editor.assets.all_domains")}</option>
            {[
              "ui",
              "terrain",
              "building",
              "decoration",
              "resource",
              "character",
              "enemy",
              "effect",
              "reference",
            ].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </TinySelect>
          <TinySelect
            aria-label={t("editor.assets.category")}
            value={category}
            onChange={(event) => {
              setCategory(event.currentTarget.value);
              setVisible(PAGE_SIZE);
            }}
          >
            <option value="all">{t("editor.assets.all_categories")}</option>
            {categories.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </TinySelect>
        </div>

        {error && <p role="alert">{t("editor.assets.error")}</p>}
        {!error && entries === null && <p role="status">{t("editor.assets.loading")}</p>}
        {entries && (
          <>
            <p className="asset-browser__count">
              {t("editor.assets.count", { count: filtered.length })}
            </p>
            <div className="asset-browser__grid">
              {filtered.slice(0, visible).map((entry) => (
                <article key={entry.id} className="asset-browser__card">
                  <AssetPreview entry={entry} />
                  <strong>{entry.id}</strong>
                  <span>{entry.sourcePath.split("/").at(-1)}</span>
                  <small>
                    {entry.width}×{entry.height} · {entry.frame?.count ?? 1}{" "}
                    {t("editor.assets.frames")}
                  </small>
                  <small>
                    {entry.classification.status === "ignored"
                      ? entry.classification.reason
                      : entry.classification.role}
                  </small>
                  <small>
                    {entry.editor ? t("editor.assets.available") : t("editor.assets.unavailable")}
                  </small>
                </article>
              ))}
            </div>
            {visible < filtered.length && (
              <TinyButton
                type="button"
                variant="secondary"
                onClick={() => setVisible((value) => value + PAGE_SIZE)}
              >
                {t("editor.assets.more")}
              </TinyButton>
            )}
          </>
        )}
      </TinyPanel>
    </details>
  );
}
