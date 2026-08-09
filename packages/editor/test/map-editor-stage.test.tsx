import { blankMap } from "@lindocara/editor/game/editor-state.js";
import { defaultDimForMode, openMapEditorStage } from "@lindocara/editor/game/map-editor-stage.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => {
  const renderer = {
    configureMapTerrain: vi.fn(),
    destroy: vi.fn(),
    onFrame: vi.fn(),
    render: vi.fn(),
    screenToWorld: vi.fn(() => ({ x: -8.5, z: -7.5 })),
    setCameraFocus: vi.fn(),
    setCameraZoom: vi.fn(),
    setEditorOverlay: vi.fn(),
    setTiltShiftEnabled: vi.fn(),
  };
  return {
    renderer,
    create: vi.fn(async () => renderer),
  };
});

vi.mock("@lindocara/renderer/hd2d/game-renderer.js", () => ({
  Hd2dRenderer: { create: mock.create },
}));

describe("HD-2D map editor stage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '<canvas id="stage"></canvas>';
  });

  it("uses the compiled authored map as its render document", async () => {
    const map = blankMap("Map", 20, 15);
    const stage = await openMapEditorStage(map, vi.fn());

    expect(mock.renderer.setTiltShiftEnabled).toHaveBeenCalledOnce();
    expect(mock.renderer.setTiltShiftEnabled).toHaveBeenCalledWith(false);

    expect(mock.renderer.configureMapTerrain).toHaveBeenCalledWith(
      "editor",
      [],
      1,
      expect.objectContaining({ size: 20, levels: expect.any(Array), spawns: expect.any(Array) }),
    );
    expect(mock.renderer.setEditorOverlay).toHaveBeenCalledWith(
      expect.objectContaining({ cols: 20, rows: 15, showGrid: true }),
    );
    stage.dispose();
  });

  it("routes pointer painting through editor state and commits one dirty stroke", async () => {
    const changes = vi.fn();
    const stage = await openMapEditorStage(blankMap("Map", 20, 15), changes);
    const canvas = document.querySelector<HTMLCanvasElement>("#stage");
    if (!canvas) throw new Error("fixture canvas missing");

    stage.setTool({ kind: "block", block: "water" });
    canvas.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: 10, clientY: 10 }));
    window.dispatchEvent(new PointerEvent("pointerup"));

    expect(stage.current().layers[0]?.ids[2 * 20 + 1]).toBe(0);
    expect(changes).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({ canUndo: true, dirty: true }),
    );
    stage.dispose();
  });

  it("forwards creator diagnostics without changing authored content", async () => {
    const stage = await openMapEditorStage(blankMap("Map", 20, 15), vi.fn());
    stage.setGrid(false);
    stage.setCollisions(true);
    stage.setZoom(42);

    expect(mock.renderer.setEditorOverlay).toHaveBeenLastCalledWith(
      expect.objectContaining({ showGrid: false, showCollisions: true }),
    );
    expect(mock.renderer.setCameraZoom).toHaveBeenLastCalledWith(42);
    stage.dispose();
  });
});

describe("editor mode emphasis", () => {
  it("dims contextual planes by default outside field mode", () => {
    expect(defaultDimForMode("field")).toBe(false);
    expect(defaultDimForMode("element")).toBe(true);
    expect(defaultDimForMode("event")).toBe(true);
  });
});
