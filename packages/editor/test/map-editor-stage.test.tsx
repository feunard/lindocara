import { blankMap } from "@lindocara/editor/game/editor-state.js";
import {
  defaultDimForMode,
  editorToolPreviewAssetId,
  openMapEditorStage,
} from "@lindocara/editor/game/map-editor-stage.js";
import { defaultEventPage } from "@lindocara/engine/map-events.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => {
  let frame: ((now: number) => void) | null = null;
  const renderer = {
    configureMapTerrain: vi.fn(),
    destroy: vi.fn(),
    onFrame: vi.fn((callback: (now: number) => void) => {
      frame = callback;
    }),
    preloadWorldEventAssets: vi.fn(),
    render: vi.fn(),
    screenToWorld: vi.fn(() => ({ x: -8.5, z: -7.5 })),
    setCameraFocus: vi.fn(),
    setCameraZoom: vi.fn(),
    setEditorOverlay: vi.fn(),
    setEditorPreviewAsset: vi.fn(),
    setTiltShiftEnabled: vi.fn(),
  };
  return {
    renderer,
    create: vi.fn(async () => renderer),
    frame: () => frame,
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

  it("renders every authored event appearance and anchor in the authoring stage", async () => {
    const event = {
      id: "editor-event",
      col: 4,
      row: 5,
      name: "Hidden passage",
      ordinal: 1,
      kind: "exit" as const,
      species: null,
      patrolRadius: null,
      pages: [defaultEventPage()],
    };
    const map = { ...blankMap("Map", 20, 15), events: [event] };
    const stage = await openMapEditorStage(map, vi.fn());
    const frame = mock.frame();
    if (!frame) throw new Error("renderer frame callback missing");
    frame(performance.now());

    expect(mock.renderer.preloadWorldEventAssets).toHaveBeenCalledWith([
      expect.objectContaining({ id: event.id, presentation: "marker" }),
    ]);
    expect(mock.renderer.render).toHaveBeenLastCalledWith(
      expect.objectContaining({
        events: [expect.objectContaining({ id: event.id, presentation: "marker" })],
      }),
      expect.any(Object),
    );
    stage.dispose();
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

  it("shows the selected decor and event art under the pointer with its footprint", async () => {
    const stage = await openMapEditorStage(blankMap("Map", 20, 15), vi.fn());
    const canvas = document.querySelector<HTMLCanvasElement>("#stage");
    if (!canvas) throw new Error("fixture canvas missing");
    const tree = "resource.terrain-resources-wood-trees.tree3" as const;
    stage.setActiveMode("element");
    stage.setTool({ kind: "element", assetId: tree });
    canvas.dispatchEvent(new PointerEvent("pointermove", { clientX: 10, clientY: 10 }));
    expect(mock.renderer.setEditorPreviewAsset).toHaveBeenLastCalledWith(tree);
    expect(mock.renderer.setEditorOverlay).toHaveBeenLastCalledWith(
      expect.objectContaining({
        assetPreview: expect.objectContaining({
          point: expect.any(Object),
          footprint: expect.arrayContaining([expect.any(Object)]),
        }),
      }),
    );

    const guard = "character.units-red-units-warrior.warrior-idle" as const;
    stage.setActiveMode("event");
    stage.setTool({ kind: "event", eventKind: "guard", patrolRadius: 2, graphic: guard });
    expect(mock.renderer.setEditorPreviewAsset).toHaveBeenLastCalledWith(guard);
    stage.dispose();
  });
});

describe("editor mode emphasis", () => {
  it("dims contextual planes by default outside field mode", () => {
    expect(defaultDimForMode("field")).toBe(false);
    expect(defaultDimForMode("element")).toBe(true);
    expect(defaultDimForMode("event")).toBe(true);
  });

  it("previews the closed chest asset for the default chest event", () => {
    expect(editorToolPreviewAssetId({ kind: "event", eventKind: "normal", preset: "chest" })).toBe(
      "resource.lindocara-lab.chest-closed",
    );
  });
});
