/**
 * The `#stage` canvas, owned by whoever renders into it.
 *
 * It used to be created once by `bootClient()` and never removed, so every page carried it —
 * the title, the menu, sign-in, the launch carousels, the admin console. A `position: fixed`
 * canvas covering the viewport behind `#root` is not harmless furniture: it is a live GPU surface
 * on pages that never draw a pixel into it, and it is the first thing anyone inspecting the
 * document trips over.
 *
 * Three modules render into it, all of them imperative and none of them React
 * (`game/session.ts`, and the editor's `map-editor-stage.ts` / `map-preview.ts`), so ownership
 * belongs to them rather than to a bootstrap that cannot know when they are done. Each acquires
 * before it builds a renderer and releases when it destroys one.
 *
 * REFERENCE COUNTED, because the editor legitimately overlaps: entering the playable preview
 * builds the preview's renderer while the painting stage is still tearing down, and a plain
 * create/remove pair would delete the canvas out from under whichever finished second. The count
 * makes the last release win, whatever order they arrive in.
 *
 * The repo rule that `ui/` never touches `#stage` is unchanged and is why this lives in `game/`:
 * React must never own, render or reorder this element.
 */

const STAGE_ID = "stage";

let holders = 0;

/**
 * Ensures the canvas exists and registers one holder. Returns the canvas to render into.
 *
 * Placed BEFORE `#root` so `#root`'s chrome paints on top of it, which is the same ordering
 * `bootClient()` used to establish. `#root` is already in the served HTML by the time any of this
 * runs, so `prepend` needs nothing reordered around it.
 */
export function acquireStageCanvas(): HTMLCanvasElement {
  holders += 1;
  const existing = document.querySelector<HTMLCanvasElement>(`#${STAGE_ID}`);
  if (existing) return existing;
  const canvas = document.createElement("canvas");
  canvas.id = STAGE_ID;
  document.body.prepend(canvas);
  return canvas;
}

/**
 * Drops one holder, removing the canvas once none are left.
 *
 * Never goes below zero: a double release (a teardown path that runs twice, a failed launch that
 * cleans up after an error already did) would otherwise make the NEXT acquire look like the second
 * holder and leave the canvas behind for good.
 */
export function releaseStageCanvas(): void {
  holders = Math.max(0, holders - 1);
  if (holders > 0) return;
  document.querySelector(`#${STAGE_ID}`)?.remove();
}

/** Test seam: the holder count is module state, and a suite that acquires must be able to reset. */
export function resetStageCanvasForTests(): void {
  holders = 0;
  document.querySelector(`#${STAGE_ID}`)?.remove();
}
