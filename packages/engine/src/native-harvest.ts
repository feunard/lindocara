import { nativeHarvestProfileForAsset } from "./harvest-presets.js";
import type { MapElement } from "./map-data.js";
import { functionalEvent, type MapEvent } from "./map-events.js";

/**
 * Project native resource scenery into the established harvest-event runtime contract.
 *
 * Persisted elements own a durable database UUID. Unsaved/legacy editor elements use a deterministic
 * preview UUID derived from their unique scenery slot; the server replaces it with a durable row id
 * when saved. This keeps preview state stable without persisting a second resource model.
 */
function previewElementId(element: MapElement): string {
  const seed = `${element.undergroundDepth ?? 0}:${element.assetId}:${element.col}:${element.row}:${element.offsetX}:${element.offsetY}`;
  let a = 0x9e3779b9;
  let b = 0x85ebca6b;
  let c = 0xc2b2ae35;
  let d = 0x27d4eb2f;
  for (let index = 0; index < seed.length; index += 1) {
    const code = seed.charCodeAt(index);
    a = Math.imul(a ^ code, 0x85ebca6b);
    b = Math.imul(b ^ code, 0xc2b2ae35);
    c = Math.imul(c ^ code, 0x27d4eb2f);
    d = Math.imul(d ^ code, 0x165667b1);
  }
  const hex = [a, b, c, d].map((part) => (part >>> 0).toString(16).padStart(8, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function nativeHarvestEventForElement(
  element: MapElement,
  ordinal: number,
): MapEvent | null {
  const profile = nativeHarvestProfileForAsset(element.assetId);
  if (!profile) return null;
  const event = functionalEvent({
    id: element.id ?? previewElementId(element),
    col: element.col,
    row: element.row,
    ordinal,
    kind: "harvestable",
    harvestProfile: profile,
    graphicAssetId: element.assetId,
  });
  return element.undergroundDepth
    ? { ...event, undergroundDepth: element.undergroundDepth }
    : event;
}

export function nativeHarvestEvents(elements: readonly MapElement[], ordinalStart = 1): MapEvent[] {
  return elements.flatMap((element, index) => {
    const event = nativeHarvestEventForElement(element, ordinalStart + index);
    return event ? [event] : [];
  });
}
