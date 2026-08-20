import { blankMap, canvasEditorMap, toMapData } from "@lindocara/editor/game/editor-state.js";
import {
  bridgeDimensionsAtDelta,
  bridgeResizeGuide,
  buildingDimensionsAtPoint,
  buildingResizeGuide,
  defaultDimForMode,
  editorToolPreviewAssetId,
  elementRotationAtPoint,
  elementRotationGuide,
  openMapEditorStage,
} from "@lindocara/editor/game/map-editor-stage.js";
import { compileAuthoredMap } from "@lindocara/engine/hd2d/authored-map.js";
import { defaultEventPage } from "@lindocara/engine/map-events.js";
import { MAP_MAX_COLS, MAP_MAX_ROWS } from "@lindocara/engine/map-limits.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const HOUSE = "building.buildings-blue-buildings.house1" as const;

const mock = vi.hoisted(() => {
  let frame: ((now: number) => void) | null = null;
  const renderer = {
    configureMapTerrain: vi.fn(),
    updateEditorContent: vi.fn(),
    destroy: vi.fn(),
    onFrame: vi.fn((callback: (now: number) => void) => {
      frame = callback;
    }),
    preloadWorldEventAssets: vi.fn(),
    render: vi.fn(),
    screenToWorld: vi.fn(() => ({ x: -8.5, z: -7.5 })),
    rotateCamera: vi.fn(),
    setCameraPitch: vi.fn(),
    setCameraFocus: vi.fn(),
    setCameraZoom: vi.fn(),
    setEditorOverlay: vi.fn(),
    setEditorPreviewAsset: vi.fn(),
    setDayCycleOverride: vi.fn(),
    setFogEnabled: vi.fn(),
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
    expect(mock.renderer.setDayCycleOverride).toHaveBeenCalledOnce();
    // A blank map is born on permanent day, so the stage opens with the clock overridden — `null`
    // (let the cycle run) is what a map that opted INTO the cycle would produce.
    expect(mock.renderer.setDayCycleOverride).toHaveBeenCalledWith("day");
    // Play tightens the fog band as the camera pulls back; authoring pulls back precisely to see
    // more, so the stage turns it off for the session.
    expect(mock.renderer.setFogEnabled).toHaveBeenCalledOnce();
    expect(mock.renderer.setFogEnabled).toHaveBeenCalledWith(false);

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

  it("the overlay carries the derived save rect and bounds the collision overlay to it", async () => {
    const map = canvasEditorMap(blankMap("m", 20, 15));
    const stage = await openMapEditorStage(map, vi.fn());
    const overlay = mock.renderer.setEditorOverlay.mock.lastCall?.[0];
    const size = MAP_MAX_COLS; // the canvas is square at 256
    const expected = {
      x: 116 - size / 2,
      z: 118 - size / 2,
      cols: 24,
      rows: 19,
    };
    expect(overlay.saveRect).toEqual(expected);
    // Ocean outside the derived rect must NOT be marked blocked: every collider stays inside it.
    for (const cell of overlay.colliders) {
      expect(cell.x).toBeGreaterThanOrEqual(expected.x - 1);
      expect(cell.x).toBeLessThanOrEqual(expected.x + expected.cols + 1);
      expect(cell.z).toBeGreaterThanOrEqual(expected.z - 1);
      expect(cell.z).toBeLessThanOrEqual(expected.z + expected.rows + 1);
    }
    stage.dispose();
  });

  it("the overlay carries the map's spawn, in every mode and after it moves", async () => {
    // blankMap(20, 15) spawns dead centre at col 10 / row 7; the stage's world origin is the
    // canvas centre, so size = max(20, 15) = 20 and the cell centre is (0.5, -2.5).
    const map = blankMap("Map", 20, 15);
    const stage = await openMapEditorStage(map, vi.fn());
    expect(mock.renderer.setEditorOverlay.mock.lastCall?.[0].spawn).toEqual({ x: 0.5, z: -2.5 });

    // A fact about the map, not a Field-mode tool artefact: it must survive into the two modes
    // where an author can bury it under scenery or an event without noticing.
    stage.setActiveMode("element");
    expect(mock.renderer.setEditorOverlay.mock.lastCall?.[0].spawn).toEqual({ x: 0.5, z: -2.5 });
    stage.setActiveMode("event");
    expect(mock.renderer.setEditorOverlay.mock.lastCall?.[0].spawn).toEqual({ x: 0.5, z: -2.5 });

    stage.replaceMap({ ...stage.current(), spawn: { col: 3, row: 4 } });
    expect(mock.renderer.setEditorOverlay.mock.lastCall?.[0].spawn).toEqual({ x: -6.5, z: -5.5 });
    stage.dispose();
  });

  it("stores the map lighting mode in history and previews every fixed night degree", async () => {
    const changes = vi.fn();
    // Opts INTO the cycle first: a blank map now starts on permanent day, and undo below must land
    // back on a distinguishable state.
    const cycling = { ...blankMap("Map", 20, 15), dayNightCycle: true };
    const stage = await openMapEditorStage(cycling, changes);

    stage.setLighting(false, "night-middle");
    expect(stage.current().dayNightCycle).toBe(false);
    expect(stage.current().fixedLighting).toBe("night-middle");
    expect(mock.renderer.setDayCycleOverride).toHaveBeenLastCalledWith("night-middle");
    expect(changes).toHaveBeenLastCalledWith(
      expect.objectContaining({ dayNightCycle: false, fixedLighting: "night-middle" }),
      expect.objectContaining({ canUndo: true, dirty: true }),
    );

    stage.undo();
    expect(stage.current().dayNightCycle).toBe(true);
    expect(mock.renderer.setDayCycleOverride).toHaveBeenLastCalledWith(null);
    stage.dispose();
  });

  it("installs a generated canvas as one undoable edit and recentres its content", async () => {
    const changes = vi.fn();
    const original = canvasEditorMap(blankMap("Map", 20, 15));
    const stage = await openMapEditorStage(original, changes);
    const generated = canvasEditorMap(blankMap("Map", 40, 30));

    stage.replaceMap(generated);

    expect(stage.current().layers[0]).toMatchObject({ cols: MAP_MAX_COLS, rows: MAP_MAX_ROWS });
    expect(changes).toHaveBeenLastCalledWith(
      expect.objectContaining({ layers: expect.any(Array) }),
      expect.objectContaining({ canUndo: true, dirty: true }),
    );
    expect(mock.renderer.configureMapTerrain).toHaveBeenLastCalledWith(
      "editor",
      [],
      2,
      expect.objectContaining({ size: MAP_MAX_COLS }),
    );
    expect(mock.renderer.setCameraFocus).toHaveBeenLastCalledWith(0, 0);

    stage.undo();
    expect(stage.current()).toEqual(original);
    expect(mock.renderer.setCameraFocus).toHaveBeenLastCalledWith(0, -0.5);
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

  it("throttles world rebuilds during a spray stroke and flushes once at release", async () => {
    const changes = vi.fn();
    const stage = await openMapEditorStage(blankMap("Map", 20, 15), changes);
    const canvas = document.querySelector<HTMLCanvasElement>("#stage");
    if (!canvas) throw new Error("fixture canvas missing");

    // One distinct cell per dispatched event: the mocked pick tracks this mutable point, so a
    // four-cell drag inside one tick reaches four different cells the way a fast real spray does.
    const point = { x: -8.5, z: -7.5 };
    mock.renderer.screenToWorld.mockImplementation(() => ({ ...point }));

    stage.setTool({ kind: "block", block: "water" });
    const rebuildsBeforeStroke = mock.renderer.configureMapTerrain.mock.calls.length;
    canvas.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: 10, clientY: 10 }));
    for (let step = 1; step <= 3; step += 1) {
      point.x = -8.5 + step;
      canvas.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 10 + step * 32, clientY: 10 }),
      );
    }
    const rebuildsDuringStroke =
      mock.renderer.configureMapTerrain.mock.calls.length - rebuildsBeforeStroke;
    window.dispatchEvent(new PointerEvent("pointerup"));
    const rebuildsAfterRelease =
      mock.renderer.configureMapTerrain.mock.calls.length - rebuildsBeforeStroke;

    // The first painted cell rebuilds at once (immediate feedback); the three follow-up cells of
    // the same-instant burst coalesce; the release flushes the pending rebuild exactly once.
    expect(rebuildsDuringStroke).toBe(1);
    expect(rebuildsAfterRelease).toBe(2);
    // Every sprayed cell is painted regardless of the rebuild cadence — the throttle defers only
    // the world rebuild, never the edit itself. Water erases the ground layer to the empty tile.
    const ground = stage.current().layers[0];
    for (let step = 0; step <= 3; step += 1) {
      expect(ground?.ids[2 * 20 + 1 + step]).toBe(0);
    }
    // `vi.clearAllMocks` resets calls, not implementations — hand the shared pick mock its
    // default back so the tests after this one keep receiving the fixed cell they rely on.
    mock.renderer.screenToWorld.mockImplementation(() => ({ x: -8.5, z: -7.5 }));
    stage.dispose();
  });

  it("snaps a quarter turn to the nearest axis, so a free orbit can be straightened", async () => {
    const yaws: number[] = [];
    const stage = await openMapEditorStage(
      blankMap("Map", 20, 15),
      vi.fn(),
      undefined,
      undefined,
      undefined,
      (degrees) => yaws.push(degrees),
    );
    const quarter = Math.PI / 2;

    stage.rotateQuarter(1);
    expect(mock.renderer.rotateCamera).toHaveBeenLastCalledWith(quarter);

    // Orbit to an off-axis angle, then a quarter turn must land back ON an axis rather than
    // carrying the stray offset forever.
    const canvas = document.querySelector<HTMLCanvasElement>("#stage");
    if (!canvas) throw new Error("fixture canvas missing");
    canvas.dispatchEvent(
      new PointerEvent("pointerdown", { button: 2, clientX: 100, clientY: 100 }),
    );
    canvas.dispatchEvent(new PointerEvent("pointermove", { clientX: 104, clientY: 100 }));
    window.dispatchEvent(new PointerEvent("pointerup"));
    expect(yaws.at(-1)).not.toBe(90);

    stage.rotateQuarter(1);
    expect(yaws.at(-1)).toBe(180);
    stage.dispose();
  });

  it("orbits on right-drag and pans on middle-drag, never both", async () => {
    const yaws: number[] = [];
    const stage = await openMapEditorStage(
      blankMap("Map", 20, 15),
      vi.fn(),
      undefined,
      undefined,
      undefined,
      (degrees) => yaws.push(degrees),
    );
    const canvas = document.querySelector<HTMLCanvasElement>("#stage");
    if (!canvas) throw new Error("fixture canvas missing");
    const focusCalls = () => mock.renderer.setCameraFocus.mock.calls.length;

    // Right-drag turns the camera and must NOT move the focus. Right used to be a second pan
    // trigger, so this is the assertion that pins the reassignment.
    const beforeRight = focusCalls();
    canvas.dispatchEvent(
      new PointerEvent("pointerdown", { button: 2, clientX: 100, clientY: 100 }),
    );
    canvas.dispatchEvent(new PointerEvent("pointermove", { clientX: 140, clientY: 100 }));
    window.dispatchEvent(new PointerEvent("pointerup"));
    expect(yaws.length).toBeGreaterThan(0);
    expect(focusCalls()).toBe(beforeRight);

    // Middle-drag still pans, and must not turn the camera.
    const turns = yaws.length;
    canvas.dispatchEvent(
      new PointerEvent("pointerdown", { button: 1, clientX: 100, clientY: 100 }),
    );
    canvas.dispatchEvent(new PointerEvent("pointermove", { clientX: 140, clientY: 100 }));
    window.dispatchEvent(new PointerEvent("pointerup"));
    expect(focusCalls()).toBeGreaterThan(beforeRight);
    expect(yaws.length).toBe(turns);
    stage.dispose();
  });

  it("pans along the axis the camera is actually facing", async () => {
    const stage = await openMapEditorStage(blankMap("Map", 20, 15), vi.fn());
    const canvas = document.querySelector<HTMLCanvasElement>("#stage");
    if (!canvas) throw new Error("fixture canvas missing");

    // The camera starts centred on the map, so what matters is how far a drag MOVES it, not where
    // it lands.
    const focus = (): [number, number] => {
      const call = mock.renderer.setCameraFocus.mock.calls.at(-1) ?? [0, 0];
      return [call[0] as number, call[1] as number];
    };
    const dragRight = (): [number, number] => {
      const [beforeX, beforeZ] = focus();
      canvas.dispatchEvent(
        new PointerEvent("pointerdown", { button: 1, clientX: 100, clientY: 100 }),
      );
      canvas.dispatchEvent(new PointerEvent("pointermove", { clientX: 120, clientY: 100 }));
      window.dispatchEvent(new PointerEvent("pointerup"));
      const [afterX, afterZ] = focus();
      return [afterX - beforeX, afterZ - beforeZ];
    };

    // Unrotated: a rightward drag walks the focus along world X, and leaves Z alone.
    const [flatDx, flatDz] = dragRight();
    expect(flatDx).toBeCloseTo(-0.7, 5);
    expect(flatDz).toBeCloseTo(0, 5);

    // A quarter turn later the SAME drag must move the focus along Z instead. The drag is in
    // screen space and the focus is in world space; before the yaw rotation was applied to the
    // delta, this kept walking X and the map slid sideways under the cursor.
    stage.rotateQuarter(1);
    const [turnedDx, turnedDz] = dragRight();
    expect(turnedDx).toBeCloseTo(0, 5);
    expect(turnedDz).toBeCloseTo(0.7, 5);
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
    const tree = "decoration.terrain-decorations-bushes.bushe1" as const;
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

  it("keeps the decor preview on the exact compiled position after placement", async () => {
    const stage = await openMapEditorStage(blankMap("Map", 20, 15), vi.fn());
    const canvas = document.querySelector<HTMLCanvasElement>("#stage");
    if (!canvas) throw new Error("fixture canvas missing");
    const tree = "decoration.terrain-decorations-bushes.bushe1" as const;
    stage.setActiveMode("element");
    stage.setTool({ kind: "element", assetId: tree });
    const initialHeightfield = mock.renderer.configureMapTerrain.mock.lastCall?.[3];
    if (!initialHeightfield) throw new Error("initial heightfield missing");

    canvas.dispatchEvent(new PointerEvent("pointermove", { clientX: 10, clientY: 10 }));
    const overlayBeforePlacement = mock.renderer.setEditorOverlay.mock.lastCall?.[0];
    const previewPoint = overlayBeforePlacement?.assetPreview?.point;

    const terrainRebuilds = mock.renderer.configureMapTerrain.mock.calls.length;
    canvas.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: 10, clientY: 10 }));
    window.dispatchEvent(new PointerEvent("pointerup"));
    const compiledElement = compileAuthoredMap(toMapData(stage.current())).elements[0];

    expect(stage.current().elements[0]).toMatchObject({ col: 1, row: 2, offsetX: 2, offsetY: 2 });
    expect(previewPoint).toEqual({ x: compiledElement?.x, z: compiledElement?.z });
    expect(mock.renderer.configureMapTerrain).toHaveBeenCalledTimes(terrainRebuilds);
    expect(mock.renderer.updateEditorContent).toHaveBeenLastCalledWith(
      2,
      expect.objectContaining({ elements: [expect.objectContaining({ assetId: tree })] }),
    );
    expect(mock.renderer.updateEditorContent.mock.lastCall?.[1].levels).toBe(
      initialHeightfield.levels,
    );
    stage.dispose();
  });

  it("adds events through the incremental path without rebuilding terrain", async () => {
    const stage = await openMapEditorStage(blankMap("Map", 20, 15), vi.fn());
    const canvas = document.querySelector<HTMLCanvasElement>("#stage");
    if (!canvas) throw new Error("fixture canvas missing");
    const guard = "character.units-red-units-warrior.warrior-idle" as const;
    stage.setActiveMode("event");
    stage.setTool({ kind: "event", eventKind: "guard", patrolRadius: 2, graphic: guard });
    const terrainRebuilds = mock.renderer.configureMapTerrain.mock.calls.length;

    canvas.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: 10, clientY: 10 }));
    window.dispatchEvent(new PointerEvent("pointerup"));

    expect(stage.current().events).toHaveLength(1);
    expect(mock.renderer.configureMapTerrain).toHaveBeenCalledTimes(terrainRebuilds);
    expect(mock.renderer.updateEditorContent).toHaveBeenCalledOnce();
    stage.dispose();
  });

  it("draws and drags building resize handles as one undoable edit", async () => {
    const point = { x: 5.5, z: 2.5 };
    mock.renderer.screenToWorld.mockImplementation(() => ({ ...point }));
    const building = {
      col: 15,
      row: 12,
      offsetX: 0,
      offsetY: 0,
      assetId: HOUSE,
      building: {
        destructible: true,
        maxHp: 900,
        dimensions: { width: 2.75, depth: 2.125 },
      },
    } as const;
    const map = { ...blankMap("Village", 20, 15), elements: [building] };
    const changes = vi.fn();
    const stage = await openMapEditorStage(map, changes);
    const canvas = document.querySelector<HTMLCanvasElement>("#stage");
    if (!canvas) throw new Error("fixture canvas missing");

    stage.setActiveMode("element");
    stage.setTool({ kind: "select" });
    canvas.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: 10, clientY: 10 }));
    window.dispatchEvent(new PointerEvent("pointerup"));
    const guide = mock.renderer.setEditorOverlay.mock.lastCall?.[0].buildingResize;
    expect(guide).toMatchObject({
      widthHandles: expect.any(Array),
      depthHandle: expect.any(Object),
      valid: true,
    });

    Object.assign(point, guide.widthHandles[1]);
    canvas.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: 20, clientY: 20 }));
    point.x = 30;
    canvas.dispatchEvent(new PointerEvent("pointermove", { clientX: 35, clientY: 20 }));
    expect(stage.current().elements[0]?.building?.dimensions?.width).toBe(2.75);
    expect(mock.renderer.setEditorOverlay.mock.lastCall?.[0].buildingResize.valid).toBe(false);

    point.x = 8;
    canvas.dispatchEvent(new PointerEvent("pointermove", { clientX: 40, clientY: 20 }));
    window.dispatchEvent(new PointerEvent("pointerup"));

    expect(stage.current().elements[0]?.building?.dimensions).toEqual({
      width: 5,
      depth: 2.125,
    });
    expect(changes).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({ canUndo: true, dirty: true }),
    );
    stage.undo();
    expect(stage.current().elements[0]?.building?.dimensions).toEqual({
      width: 2.75,
      depth: 2.125,
    });
    mock.renderer.screenToWorld.mockImplementation(() => ({ x: -8.5, z: -7.5 }));
    stage.dispose();
  });

  it("draws and drags bridge length handles as one undoable edit", async () => {
    const point = { x: 0.5, z: -5.5 };
    mock.renderer.screenToWorld.mockImplementation(() => ({ ...point }));
    const bridge = {
      col: 10,
      row: 4,
      offsetX: 0,
      offsetY: 0,
      assetId: "terrain.bridge.wood.horizontal",
    } as const;
    const stage = await openMapEditorStage(
      { ...blankMap("Crossing", 20, 15), elements: [bridge] },
      vi.fn(),
    );
    const canvas = document.querySelector<HTMLCanvasElement>("#stage");
    if (!canvas) throw new Error("fixture canvas missing");

    stage.setActiveMode("element");
    stage.setTool({ kind: "select" });
    canvas.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: 10, clientY: 10 }));
    window.dispatchEvent(new PointerEvent("pointerup"));
    const guide = mock.renderer.setEditorOverlay.mock.lastCall?.[0].bridgeResize;
    expect(guide).toMatchObject({
      lengthHandle: expect.any(Object),
      widthHandle: expect.any(Object),
      valid: true,
    });

    Object.assign(point, guide.lengthHandle);
    canvas.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: 20, clientY: 20 }));
    point.x += 3;
    canvas.dispatchEvent(new PointerEvent("pointermove", { clientX: 40, clientY: 20 }));
    window.dispatchEvent(new PointerEvent("pointerup"));

    expect(stage.current().elements[0]?.bridge).toEqual({ length: 6, width: 1 });
    stage.undo();
    expect(stage.current().elements[0]?.bridge).toBeUndefined();
    mock.renderer.screenToWorld.mockImplementation(() => ({ x: -8.5, z: -7.5 }));
    stage.dispose();
  });

  it("rotates a selected 3D element from its map handle as one undoable edit", async () => {
    const point = { x: 5.5, z: 2.5 };
    mock.renderer.screenToWorld.mockImplementation(() => ({ ...point }));
    const building = {
      col: 15,
      row: 12,
      offsetX: 0,
      offsetY: 0,
      assetId: HOUSE,
      building: { destructible: true, maxHp: 900 },
    } as const;
    const stage = await openMapEditorStage(
      { ...blankMap("Village", 20, 15), elements: [building] },
      vi.fn(),
    );
    const canvas = document.querySelector<HTMLCanvasElement>("#stage");
    if (!canvas) throw new Error("fixture canvas missing");

    stage.setActiveMode("element");
    stage.setTool({ kind: "select" });
    canvas.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: 10, clientY: 10 }));
    window.dispatchEvent(new PointerEvent("pointerup"));
    const guide = mock.renderer.setEditorOverlay.mock.lastCall?.[0].elementRotation;
    expect(guide).toMatchObject({ handle: expect.any(Object), angle: 0, valid: true });

    Object.assign(point, guide.handle);
    canvas.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: 20, clientY: 20 }));
    point.x = guide.anchor.x - 2;
    point.z = guide.anchor.z;
    canvas.dispatchEvent(new PointerEvent("pointermove", { clientX: 40, clientY: 20 }));
    window.dispatchEvent(new PointerEvent("pointerup"));

    expect(stage.current().elements[0]?.rotation).toBe(90);
    stage.undo();
    expect(stage.current().elements[0]?.rotation).toBeUndefined();
    mock.renderer.screenToWorld.mockImplementation(() => ({ x: -8.5, z: -7.5 }));
    stage.dispose();
  });
});

describe("free 3D rotation geometry", () => {
  it("places the handle on the authored angle and converts pointer direction to whole degrees", () => {
    const element = {
      col: 10,
      row: 10,
      offsetX: 0,
      offsetY: 0,
      assetId: HOUSE,
      rotation: 37,
      building: { destructible: true, maxHp: 900 },
    } as const;
    const guide = elementRotationGuide(element, 20);
    expect(guide?.angle).toBe(37);
    expect(guide && elementRotationAtPoint(guide.anchor, guide.handle)).toBe(37);
    expect(elementRotationAtPoint({ x: 0, z: 0 }, { x: -1, z: 0 })).toBe(90);
    expect(elementRotationAtPoint({ x: 0, z: 0 }, { x: 1, z: 0 })).toBe(270);
  });
});

describe("building resize geometry", () => {
  const building = {
    col: 10,
    row: 10,
    offsetX: 0,
    offsetY: 0,
    assetId: HOUSE,
    orientation: 1 as const,
    building: {
      destructible: true,
      maxHp: 900,
      dimensions: { width: 4, depth: 3 },
    },
  };

  it("rotates the visible handles and converts drags back into local width and depth", () => {
    expect(buildingResizeGuide(building, 20)).toMatchObject({
      anchor: { x: 0.5, z: 1 },
      widthHandles: [
        { x: 2, z: -1 },
        { x: 2, z: 3 },
      ],
      depthHandle: { x: 3.5, z: 1 },
    });
    expect(buildingDimensionsAtPoint(building, 20, "width", { x: 0.5, z: 4 })).toEqual({
      width: 6,
      depth: 3,
    });
    expect(buildingDimensionsAtPoint(building, 20, "depth", { x: 4.5, z: 1 })).toEqual({
      width: 4,
      depth: 4,
    });
  });
});

describe("bridge resize geometry", () => {
  it("places horizontal and vertical handles on their compiled deck edges", () => {
    const horizontal = {
      col: 10,
      row: 10,
      offsetX: 0,
      offsetY: 0,
      assetId: "terrain.bridge.wood.horizontal" as const,
    };
    const vertical = { ...horizontal, assetId: "terrain.bridge.wood.vertical" as const };

    expect(bridgeResizeGuide(horizontal, 20)).toMatchObject({
      anchor: { x: 0.5, z: 1 },
      lengthHandle: { x: 2, z: 0.5 },
      widthHandle: { x: 0.5, z: 0 },
    });
    expect(bridgeResizeGuide(vertical, 20)).toMatchObject({
      anchor: { x: 0.5, z: 1 },
      lengthHandle: { x: 0.5, z: -2 },
      widthHandle: { x: 1, z: -0.5 },
    });
    expect(bridgeDimensionsAtDelta(horizontal, "length", 3)).toEqual({ length: 6, width: 1 });
    expect(bridgeDimensionsAtDelta(vertical, "width", 2)).toEqual({ length: 3, width: 3 });
  });

  it("rotates a bridge's resize and rotation handles around the deck centre", () => {
    const bridge = {
      col: 10,
      row: 10,
      offsetX: 0,
      offsetY: 0,
      assetId: "terrain.bridge.wood.horizontal" as const,
      rotation: 90,
    };
    const resize = bridgeResizeGuide(bridge, 20);
    expect(resize?.lengthHandle.x).toBeCloseTo(0.5);
    expect(resize?.lengthHandle.z).toBeCloseTo(2);
    expect(resize?.widthHandle.x).toBeCloseTo(1);
    expect(resize?.widthHandle.z).toBeCloseTo(0.5);
    expect(elementRotationGuide(bridge, 20)).toMatchObject({ angle: 90 });
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
