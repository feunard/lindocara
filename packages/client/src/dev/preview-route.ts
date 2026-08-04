/**
 * `?preview` — walk a map on the bare canvas, with no login, no party and no server.
 *
 * **QUARANTINED WITH THE EDITOR (S3, 2026-08-04).** The route's whole body was one call into the
 * editor's `startMapPreview`, which is built on the PixiJS renderer S3 deleted. It deliberately
 * reused that preview rather than growing a second walk loop — that one already runs the shared
 * `step()` + `resolveTerrain()` on the real `terrainFromMap` bake, and a second copy of movement is
 * the exact fork this codebase refuses everywhere else. That reasoning still holds, so the route
 * waits for the editor's HD-2D rebuild instead of forking. Until then it says so on screen.
 *
 * What it did, and must do again:
 *
 *   /?preview=1                 the étalon map
 *   /?preview=1&palette=color1  the same map on another of the pack's five ground palettes
 *
 * ```ts
 * const palette = request.palette;
 * const paletteApplied = palette === null ? true : setGroundPalette(palette);
 * const { map, stairsPlaced, stairsRequested } = buildReferenceMapBuild();
 * const { startMapPreview } = await import("@lindocara/editor/game/map-preview.js");
 * await startMapPreview(map, [], { playerChrome: false, ambience: …, zoom: …, zoomControls: true });
 * ```
 *
 * The import was dynamic on purpose: a static `client -> editor` edge would be a cycle. Keep that
 * when restoring it.
 *
 * Dev only. `main.tsx` gates the whole route on `import.meta.env.DEV`, so it leaves production
 * builds entirely.
 */

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

export async function startPreviewRoute(_request: PreviewRequest): Promise<void> {
  const root = document.querySelector("#root");
  if (!root) return;
  captionInto(root, [
    "?preview is out of order — it drew through the editor's map preview, and the editor is",
    "quarantined while it is rebuilt on @lindocara/hd2d (S3, 2026-08-04).",
    "You did not break this. See packages/editor/AGENTS.md.",
  ]);
}
