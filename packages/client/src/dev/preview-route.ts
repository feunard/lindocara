/**
 * `?preview` — walk a map on the bare canvas, with no login, no party and no server.
 *
 * The point is the feedback loop. Judging how a map LOOKS meant, until now, seeding it into D1,
 * logging in, creating a party, picking a hero and connecting a socket — minutes per look, which is
 * why nobody looked. This boots the real game renderer straight onto `#stage` from a map built in
 * memory, so `npm run dev` plus one query parameter is the whole cycle.
 *
 *   /?preview=1                 the étalon map
 *   /?preview=1&palette=color1  the same map on another of the pack's five ground palettes
 *
 * It deliberately reuses the editor's `startMapPreview` rather than growing a second walk loop: that
 * one already runs the shared `step()` + `resolveTerrain()` on the real `terrainFromMap` bake, and a
 * second copy of movement is the exact fork this codebase refuses everywhere else. The import is
 * dynamic for the same reason `App` lazy-loads the editor — a static `client -> editor` edge would
 * be a cycle.
 *
 * Dev only. `main.tsx` gates the whole route on `import.meta.env.DEV`, so it leaves production
 * builds entirely.
 */
import { AMBIENCE_FULL, AMBIENCE_NONE } from "@lindocara/renderer/ambience.js";
import { setGroundPalette } from "@lindocara/renderer/tiny-swords-art.js";
import { buildReferenceMapBuild } from "./reference-map.js";

export interface PreviewRequest {
  palette: string | null;
  ambience: boolean;
  /** Starting camera multiplier. Below 1 pulls back; the renderer clamps the extremes. */
  zoom: number;
}

/** The `?preview` request in the current URL, or `null` when this is an ordinary app boot. */
export function previewRequest(search: string): PreviewRequest | null {
  const params = new URLSearchParams(search);
  if (!params.has("preview")) return null;
  // Ambience on by default here — this route exists to show the map at its best. `?ambience=0` is
  // the A/B, and the caption says which side you are looking at so a screenshot is never ambiguous.
  const zoom = Number.parseFloat(params.get("zoom") ?? "");
  return {
    palette: params.get("palette"),
    ambience: params.get("ambience") !== "0",
    // A URL is untrusted input even from yourself: a typo must not black the screen with NaN.
    zoom: Number.isFinite(zoom) && zoom > 0 ? zoom : 1,
  };
}

/** A corner caption, in plain DOM: React never mounts on this route, and the canvas is not React's. */
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
  // Before any renderer exists: `Renderer.create` loads the terrain sheet once, so the palette has
  // to be chosen while there is still nothing to reload.
  const palette = request.palette;
  const paletteApplied = palette === null ? true : setGroundPalette(palette);

  const { map, stairsPlaced, stairsRequested } = buildReferenceMapBuild();
  const { startMapPreview } = await import("@lindocara/editor/game/map-preview.js");
  // No ring, no nameplate, no health bar: this route exists to judge the MAP, and all three sit in
  // the middle of the frame. The hero stays — scale is part of what a reference shot has to show.
  await startMapPreview(map, [], {
    playerChrome: false,
    ambience: request.ambience ? AMBIENCE_FULL : AMBIENCE_NONE,
    zoom: request.zoom,
    zoomControls: true,
  });

  const root = document.querySelector("#root");
  if (!root) return;
  captionInto(root, [
    `étalon  ${map.cols}x${map.rows}  ${map.elements.length} elements  stairs ${stairsPlaced}/${stairsRequested}`,
    `palette ${palette ?? "default"}${paletteApplied ? "" : "  (unknown — ignored)"}   ambience ${request.ambience ? "on" : "off"}`,
    "WASD / arrows to walk    wheel or - / + to zoom, 0 resets",
    "?palette=color1..color5    ?ambience=0    ?zoom=0.5",
  ]);
}
