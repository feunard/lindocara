import {
  acquireStageCanvas,
  releaseStageCanvas,
  resetStageCanvasForTests,
} from "@lindocara/client/game/stage-canvas.js";
import { beforeEach, describe, expect, it } from "vitest";

/**
 * The `#stage` canvas used to be created once by `bootClient()` and never removed, so every page
 * carried it. It now belongs to whoever renders into it — the game session and the editor's two
 * stages — and these are the rules that move with it.
 */
describe("the stage canvas", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    resetStageCanvasForTests();
  });

  it("creates the canvas BEFORE #root, so #root's chrome paints on top of it", () => {
    const canvas = acquireStageCanvas();

    expect(canvas.id).toBe("stage");
    const children = Array.from(document.body.children);
    // The ordering half of the repo's "the canvas is not React's" rule: a sibling of `#root`,
    // placed before it. It moved here from the bootstrap's own test along with the code.
    expect(children.indexOf(canvas)).toBeLessThan(
      children.indexOf(document.querySelector("#root") as Element),
    );
  });

  it("removes the canvas when the last holder releases", () => {
    acquireStageCanvas();
    releaseStageCanvas();

    expect(document.querySelector("#stage")).toBeNull();
  });

  it("keeps the canvas while a second holder still has it", () => {
    // The editor overlap this counter exists for: entering the playable preview builds its renderer
    // while the painting stage is still tearing down. Without the count, whichever released first
    // would delete the canvas out from under the other.
    const first = acquireStageCanvas();
    const second = acquireStageCanvas();
    expect(second).toBe(first);

    releaseStageCanvas();
    expect(document.querySelector("#stage")).toBe(first);

    releaseStageCanvas();
    expect(document.querySelector("#stage")).toBeNull();
  });

  it("does not strand the canvas after a release that had no matching acquire", () => {
    // A teardown path that runs twice, or an error handler cleaning up after one already did.
    // If the count went negative, the NEXT acquire would look like a second holder and its release
    // would leave the canvas behind for good — on every page, which is the bug being fixed.
    releaseStageCanvas();
    releaseStageCanvas();

    acquireStageCanvas();
    releaseStageCanvas();
    expect(document.querySelector("#stage")).toBeNull();
  });
});
