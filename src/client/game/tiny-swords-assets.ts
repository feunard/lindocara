import type { CatalogAssetRef } from "../../shared/tiny-swords-catalog.js";
import { TINY_SWORDS_UI } from "../../shared/tiny-swords-catalog.js";

const SOURCE_URLS = import.meta.glob<string>("../../../assets/Tiny Swords*/**/*.png", {
  eager: true,
  import: "default",
  query: "?url",
});

/** Resolve a catalogued source path through Vite. The glob is the only client import boundary for
 * raw Tiny Swords files; components deal in stable ids or catalogue entries, never physical paths. */
export function tinySwordsSourceUrl(sourcePath: string): string {
  const key = `../../../assets/${sourcePath}`;
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

/** Installs the small set of semantic UI assets as CSS variables once, before React mounts. */
export function applyTinySwordsTheme(root: HTMLElement = document.documentElement): void {
  const set = (name: string, value: string): void => root.style.setProperty(name, value);
  set("--tiny-button-blue-normal", cssUrl(TINY_SWORDS_UI.button.blue.normal));
  set("--tiny-button-blue-hover", cssUrl(TINY_SWORDS_UI.button.blue.hover));
  set("--tiny-button-blue-pressed", cssUrl(TINY_SWORDS_UI.button.blue.pressed));
  set("--tiny-button-blue-disabled", cssUrl(TINY_SWORDS_UI.button.blue.disabled));
  set("--tiny-button-red-normal", cssUrl(TINY_SWORDS_UI.button.red.normal));
  set("--tiny-button-red-hover", cssUrl(TINY_SWORDS_UI.button.red.hover));
  set("--tiny-button-red-pressed", cssUrl(TINY_SWORDS_UI.button.red.pressed));
  set("--tiny-button-red-disabled", cssUrl(TINY_SWORDS_UI.button.red.disabled));
  set("--tiny-panel-carved", cssUrl(TINY_SWORDS_UI.panel.carved));
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
  set("--tiny-cursor-default", cursorValue(TINY_SWORDS_UI.cursor.default, "default"));
  set("--tiny-cursor-link", cursorValue(TINY_SWORDS_UI.cursor.link, "pointer"));
  set("--tiny-cursor-interact", cursorValue(TINY_SWORDS_UI.cursor.interact, "pointer"));
  set("--tiny-cursor-move", cursorValue(TINY_SWORDS_UI.cursor.move, "grab"));
  set("--tiny-cursor-paint", cursorValue(TINY_SWORDS_UI.cursor.paint, "crosshair"));
  set("--tiny-cursor-unavailable", cursorValue(TINY_SWORDS_UI.cursor.unavailable, "not-allowed"));
}
