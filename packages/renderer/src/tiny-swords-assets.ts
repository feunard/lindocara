import type { CatalogAssetRef } from "@lindocara/engine/tiny-swords-catalog.js";
import { TINY_SWORDS_UI } from "@lindocara/engine/tiny-swords-catalog.js";

/**
 * `?no-inline` rather than a bare `?url`, and that flag is the difference between a URL and a wall
 * of base64.
 *
 * Vite inlines any asset under `build.assetsInlineLimit` (4 KB by default) as a `data:` URI, and
 * most of the Tiny Swords UI pieces — buttons, ribbons, checkboxes, cursors — are comfortably
 * under it. Every one of them then travelled as base64 inside the JS bundle, was pasted into a CSS
 * `url()`, and landed in the document. `?no-inline` keeps them as emitted files: the bundle stays
 * small, the theme stylesheet stays readable, and the browser can cache each sprite separately
 * instead of re-downloading all of them inside whichever chunk carried them.
 */
const SOURCE_URLS = import.meta.glob<string>("../../catalog/assets/Tiny Swords*/**/*.png", {
  eager: true,
  import: "default",
  query: "?no-inline",
});

/** Resolve a catalogued source path through Vite. The glob is the only client import boundary for
 * raw Tiny Swords files; components deal in stable ids or catalogue entries, never physical paths. */
export function tinySwordsSourceUrl(sourcePath: string): string {
  if (sourcePath.startsWith("/")) return sourcePath;
  const key = `../../catalog/assets/${sourcePath}`;
  const resolved = SOURCE_URLS[key];
  if (!resolved) throw new Error(`Missing bundled Tiny Swords source: ${sourcePath}`);
  return resolved;
}

export function tinySwordsAssetUrl(asset: CatalogAssetRef): string {
  return tinySwordsSourceUrl(asset.sourcePath);
}

function cssUrl(asset: CatalogAssetRef): string {
  return `url("${tinySwordsAssetUrl(asset)}")`;
}

function cursorValue(asset: CatalogAssetRef, fallback: string): string {
  const hotspot = asset.hotspot ?? { x: 0, y: 0 };
  return `${cssUrl(asset)} ${hotspot.x} ${hotspot.y}, ${fallback}`;
}

function doubledCursorValue(
  publicPath: string,
  hotspot: Readonly<{ x: number; y: number }>,
  fallback: string,
): string {
  return `image-set(url("${publicPath}") 2x) ${hotspot.x} ${hotspot.y}, ${fallback}`;
}

/**
 * The semantic UI assets, as `[custom property, value]` pairs — the one source of truth both
 * appliers below read.
 */
function themeDeclarations(): Array<[string, string]> {
  const declarations: Array<[string, string]> = [];
  const set = (name: string, value: string): void => {
    declarations.push([name, value]);
  };
  set("--tiny-button-blue-normal", cssUrl(TINY_SWORDS_UI.button.blue.normal));
  set("--tiny-button-blue-hover", cssUrl(TINY_SWORDS_UI.button.blue.hover));
  set("--tiny-button-blue-pressed", cssUrl(TINY_SWORDS_UI.button.blue.pressed));
  set("--tiny-button-blue-disabled", cssUrl(TINY_SWORDS_UI.button.blue.disabled));
  set("--tiny-button-red-normal", cssUrl(TINY_SWORDS_UI.button.red.normal));
  set("--tiny-button-red-hover", cssUrl(TINY_SWORDS_UI.button.red.hover));
  set("--tiny-button-red-pressed", cssUrl(TINY_SWORDS_UI.button.red.pressed));
  set("--tiny-button-red-disabled", cssUrl(TINY_SWORDS_UI.button.red.disabled));
  set("--tiny-ribbon-blue", cssUrl(TINY_SWORDS_UI.ribbon.blue));
  set("--tiny-ribbon-yellow", cssUrl(TINY_SWORDS_UI.ribbon.yellow));
  set("--tiny-paper", cssUrl(TINY_SWORDS_UI.panel.paper));
  set("--tiny-checkbox-normal", cssUrl(TINY_SWORDS_UI.control.checkbox.normal));
  set("--tiny-checkbox-checked", cssUrl(TINY_SWORDS_UI.control.checkbox.checked));
  set("--tiny-range-thumb", cssUrl(TINY_SWORDS_UI.control.rangeThumb));
  set("--tiny-icon-button-normal", cssUrl(TINY_SWORDS_UI.control.iconButton.normal));
  set("--tiny-icon-button-pressed", cssUrl(TINY_SWORDS_UI.control.iconButton.pressed));
  set("--tiny-icon-button-danger", cssUrl(TINY_SWORDS_UI.control.iconButton.danger));
  set("--tiny-slot", cssUrl(TINY_SWORDS_UI.control.slot));
  set("--tiny-icon-quest", cssUrl(TINY_SWORDS_UI.control.icon.quest));
  set("--tiny-icon-oath", cssUrl(TINY_SWORDS_UI.control.icon.oath));
  set("--tiny-icon-sword", cssUrl(TINY_SWORDS_UI.control.icon.sword));
  set("--tiny-icon-potion", cssUrl(TINY_SWORDS_UI.control.icon.potion));
  set("--tiny-icon-gold", cssUrl(TINY_SWORDS_UI.control.icon.gold));
  set("--tiny-icon-crystal", cssUrl(TINY_SWORDS_UI.control.icon.crystal));
  set("--tiny-bar-large-base", cssUrl(TINY_SWORDS_UI.bar.largeBase));
  set("--tiny-bar-large-fill", cssUrl(TINY_SWORDS_UI.bar.largeFill));
  set("--tiny-bar-small-base", cssUrl(TINY_SWORDS_UI.bar.smallBase));
  set("--tiny-bar-small-fill", cssUrl(TINY_SWORDS_UI.bar.smallFill));
  set(
    "--tiny-cursor-default",
    doubledCursorValue("/assets/lindocara/tiny-swords/ui/cursor.png", { x: 22, y: 17 }, "default"),
  );
  set(
    "--tiny-cursor-link",
    doubledCursorValue(
      "/assets/lindocara/tiny-swords/ui/cursor-hand.png",
      { x: 23, y: 17 },
      "pointer",
    ),
  );
  set(
    "--tiny-cursor-interact",
    doubledCursorValue(
      "/assets/lindocara/tiny-swords/ui/cursor-hand.png",
      { x: 23, y: 17 },
      "pointer",
    ),
  );
  set(
    "--tiny-cursor-move",
    doubledCursorValue(
      "/assets/lindocara/tiny-swords/ui/cursor-hand.png",
      { x: 23, y: 17 },
      "grab",
    ),
  );
  set("--tiny-cursor-paint", cursorValue(TINY_SWORDS_UI.cursor.paint, "crosshair"));
  set("--tiny-cursor-unavailable", cursorValue(TINY_SWORDS_UI.cursor.unavailable, "not-allowed"));
  return declarations;
}

/** Sets the theme as inline custom properties on one element. Element-scoped by nature — use
 *  `installTinySwordsTheme` for the document, which must not carry these in an attribute. */
export function applyTinySwordsTheme(root: HTMLElement = document.documentElement): void {
  for (const [name, value] of themeDeclarations()) {
    root.style.setProperty(name, value);
  }
}

const THEME_STYLE_ID = "tiny-swords-theme";

/**
 * Installs the theme as a real stylesheet, once, before React mounts.
 *
 * These are ~40 declarations whose values are `url(...)`s, and this used to write them straight
 * onto `document.documentElement.style`. That put the whole set in the `<html style="…">`
 * ATTRIBUTE — a wall of text at the top of every inspected page, tens of kilobytes of it once the
 * build inlined the smaller PNGs as `data:` URIs, in the one place a developer cannot avoid
 * looking. Nothing was broken by it; it just made the document unreadable and every DevTools
 * session worse.
 *
 * A `<style>` element is where document-wide theme tokens belong: same cascade entry point
 * (`:root`), same precedence relative to `legacy.css`'s unlayered rules (both unlayered author
 * styles, this one later in the document), and inspectable as a collapsed stylesheet rather than
 * an attribute. Idempotent by id, because the browser entry can run twice under HMR.
 */
export function installTinySwordsTheme(doc: Document = document): void {
  const body = themeDeclarations()
    .map(([name, value]) => `  ${name}: ${value};`)
    .join("\n");
  const existing = doc.getElementById(THEME_STYLE_ID);
  const style = existing ?? doc.createElement("style");
  style.id = THEME_STYLE_ID;
  style.textContent = `:root {\n${body}\n}\n`;
  if (!existing) doc.head.append(style);
}
