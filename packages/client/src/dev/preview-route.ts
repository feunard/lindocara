/** `?preview` walks the deterministic reference map through the shipped HD-2D preview client. */

import { AMBIENCE_FULL, AMBIENCE_NONE } from "@lindocara/renderer/ambience.js";
import { setHd2dGroundPalette } from "@lindocara/renderer/hd2d/scene.js";
import { buildReferenceMapBuild } from "./reference-map.js";

export interface PreviewRequest {
  palette: string | null;
  ambience: boolean;
  /** Starting camera multiplier. Below 1 pulls back. */
  zoom: number;
}

export function previewRequest(search: string): PreviewRequest | null {
  const params = new URLSearchParams(search);
  if (!params.has("preview")) return null;
  const zoom = Number.parseFloat(params.get("zoom") ?? "");
  return {
    palette: params.get("palette"),
    ambience: params.get("ambience") !== "0",
    zoom: Number.isFinite(zoom) && zoom > 0 ? zoom : 1,
  };
}

function captionInto(root: Element, lines: readonly string[]): void {
  const box = document.createElement("div");
  box.style.cssText = [
    "position:fixed",
    "left:12px",
    "bottom:12px",
    "z-index:10",
    "padding:8px 12px",
    "border-radius:8px",
    "background:rgba(7,18,15,.72)",
    "color:#e8f5ee",
    "font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace",
    "pointer-events:none",
    "white-space:pre",
  ].join(";");
  box.textContent = lines.join("\n");
  root.appendChild(box);
}

export async function startPreviewRoute(request: PreviewRequest): Promise<void> {
  const palette = request.palette;
  const paletteApplied = palette === null ? true : setHd2dGroundPalette(palette);
  const { map, stairsPlaced, stairsRequested } = buildReferenceMapBuild();
  const { startMapPreview } = await import("@lindocara/editor/game/map-preview.js");
  await startMapPreview(map, [], {
    playerChrome: false,
    ambience: request.ambience ? AMBIENCE_FULL : AMBIENCE_NONE,
    zoom: request.zoom,
    zoomControls: true,
  });

  const root = document.querySelector("#root");
  if (!root) return;
  captionInto(root, [
    `HD-2D reference  ${map.cols}x${map.rows}  ${map.elements.length} elements  stairs ${stairsPlaced}/${stairsRequested}`,
    `palette ${palette ?? "altitude"}${paletteApplied ? "" : "  (unknown - ignored)"}   ambience ${request.ambience ? "on" : "off"}`,
    "WASD / arrows to walk    wheel or - / + to zoom, 0 resets",
    "?palette=color1..color5    ?ambience=0    ?zoom=0.5",
  ]);
}
