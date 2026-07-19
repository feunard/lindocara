import { useEffect, useRef, useState } from "react";
import { EMPTY_MARKERS, type MapData } from "../../../shared/map-data.js";
import type { EditorAssetId } from "../../../shared/tiny-swords-catalog.js";
import {
  authErrorText,
  createMapApi,
  deleteMapApi,
  errorCode,
  fetchMap,
  fetchMaps,
  type MapPayload,
  updateMapApi,
} from "../../api.js";
import {
  blankMap,
  type EditorMap,
  type EditorSelection,
  type EditorTool,
  editorLayersFromPayload,
  type RectFillContent,
  toMapData,
  toSaveInput,
} from "../../game/editor-state.js";
import { type MapEditorStageHandle, openMapEditorStage } from "../../game/map-editor-stage.js";
import { startMapPreview } from "../../game/map-preview.js";
import { t, useLocale } from "../../i18n.js";
import { useUiStore } from "../../store.js";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../components/resizable.js";
import { EditorAssetPalette } from "../EditorAssetPalette.js";
import { EditorMenuBar } from "./EditorMenuBar.js";
import { EditorStatusBar } from "./EditorStatusBar.js";
import { type EditorPaintTool, EditorToolbar, toolLabelText } from "./EditorToolbar.js";

const DEFAULT_COLS = 40;
const DEFAULT_ROWS = 30;

/** The default terrain a fresh stroke paints with until the Task 9 terrain palette lands: flat grass,
 *  matching the stage's own default tool so what the toolbar shows and what the stage paints agree. */
const DEFAULT_CONTENT: RectFillContent = { kind: "block", block: "grass" };

type StageStatus = "loading" | "ready" | "error";
/** The active tool key. `stairs` and `element` (scenery) have no toolbar button — they are picked in
 *  the palette — so the toolbar highlights only when the key is one of its five paint tools. */
type ToolKey = EditorPaintTool | "stairs";

/** The two `requireSession` codes that mean "log in again", never "this map request failed". */
function isSessionError(code: string): boolean {
  return code === "session_expired" || code === "unauthorized";
}

function toEditorMap(map: MapPayload): EditorMap {
  return {
    name: map.name,
    layers: editorLayersFromPayload(map),
    elements: map.elements,
    spawn: map.spawn,
    markers: map.markers ?? EMPTY_MARKERS,
  };
}

/** The single EditorTool a toolbar/palette selection resolves to. Terrain content composes into
 *  pencil (single cell), rect and fill exactly as the pre-merge editor's paint path did. */
function paintToolFor(key: ToolKey, content: RectFillContent): EditorTool {
  switch (key) {
    case "select":
      return { kind: "select" };
    case "pencil":
      return content.kind === "elevation"
        ? { kind: "elevation", level: content.level }
        : { kind: "block", block: content.block };
    case "rect":
      return { kind: "rect", content };
    case "fill":
      return { kind: "fill", content };
    case "eraser":
      return { kind: "eraser" };
    case "stairs":
      return { kind: "stairs" };
  }
}

/**
 * The merged adventure editor: the wireframe's dense shell (menu row / toolbar row / resizable
 * three-pane body / status bar) wrapped around the same Pixi painting stage the pre-merge
 * `MapEditor` drove. The left palette and right maps panes are Task 8/9 placeholders; the centre is
 * the stage mount, with the scenery palette still floating over it until Task 9 moves it.
 *
 * React never touches `#stage`: `openMapEditorStage` finds that canvas itself, and every edit flows
 * through the `MapEditorStageHandle`, exactly as before.
 */
export function AdventureEditorScreen() {
  useLocale();
  const setScreen = useUiStore((state) => state.setScreen);
  const returnContext = useUiStore((state) => state.editorReturnContext);

  const handleRef = useRef<MapEditorStageHandle | null>(null);
  const pendingToolRef = useRef<EditorTool>(paintToolFor("pencil", DEFAULT_CONTENT));
  // Mirrors `activeLayer` the same way `pendingToolRef` mirrors the pending tool: the async stage-open
  // `.then` below must read the layer selected *while it was opening*, not the one captured when the
  // effect started running. Without this, clicking a layer during the open window is silently
  // overwritten by the stale initial layer once the stage resolves.
  const pendingLayerRef = useRef<0 | 1 | 2>(0);
  // The live edits captured when Tester is pressed, carried across the preview round-trip so the
  // stage reopens from them rather than the pristine payload.
  const editedRef = useRef<EditorMap | null>(null);
  const autoOpened = useRef(false);

  const [map, setMap] = useState<MapPayload | null>(null);
  const [toolKey, setToolKey] = useState<ToolKey | null>("pencil");
  const [content, setContent] = useState<RectFillContent>(DEFAULT_CONTENT);
  const [selectedAsset, setSelectedAsset] = useState<EditorAssetId | null>(null);
  const [activeLayer, setActiveLayer] = useState<0 | 1 | 2>(0);
  const [showGrid, setShowGrid] = useState(true);
  const [zoom, setZoom] = useState(100);
  const [elementCount, setElementCount] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [, setSelection] = useState<EditorSelection | null>(null);
  const [stageStatus, setStageStatus] = useState<StageStatus>("loading");
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function fail(caught: unknown): void {
    const code = errorCode(caught);
    if (isSessionError(code)) setScreen("auth");
    else setError(code);
  }

  // Load the map to edit once: the one named by an adventure return context, else the author's first
  // map. Task 8's maps panel takes over selection; this is the minimal seam that keeps the stage fed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: one contextual auto-open on mount
  useEffect(() => {
    if (autoOpened.current) return;
    autoOpened.current = true;
    void (async () => {
      try {
        const wanted = returnContext?.screen === "adventure" ? returnContext.mapId : null;
        if (wanted) {
          setMap(await fetchMap(wanted));
          return;
        }
        const list = await fetchMaps();
        const first = list[0];
        if (first) setMap(await fetchMap(first.id));
        else setError("no_maps");
      } catch (caught) {
        fail(caught);
      }
    })();
  }, []);

  // The painting stage. Not mounted while previewing — the sandbox owns the one `#stage` app then —
  // and reopened from the captured edits when the preview ends. Opening is async; a screen unmount or
  // a preview start before it resolves still disposes it. `activeLayer` is intentionally excluded
  // from the deps: it is pushed live through the handle below, never by re-opening the stage.
  // biome-ignore lint/correctness/useExhaustiveDependencies: stage identity is (map, previewing)
  useEffect(() => {
    if (previewing || !map) return;
    let cancelled = false;
    setStageStatus("loading");
    openMapEditorStage(editedRef.current ?? toEditorMap(map), (changed, state) => {
      setError(null);
      setElementCount(changed.elements.length);
      setDirty(state.dirty);
      setCanUndo(state.canUndo);
      setCanRedo(state.canRedo);
      setSelection(state.selection);
    })
      .then((handle) => {
        if (cancelled) {
          handle.dispose();
          return;
        }
        handleRef.current = handle;
        handle.setTool(pendingToolRef.current);
        handle.setActiveLayer(pendingLayerRef.current);
        setStageStatus("ready");
      })
      .catch((caught) => {
        if (!cancelled) {
          setStageStatus("error");
          setError(errorCode(caught));
        }
      });
    return () => {
      cancelled = true;
      handleRef.current?.dispose();
      handleRef.current = null;
    };
  }, [map, previewing]);

  // The sandbox walk. Only while previewing; Esc ends it, which reopens the editor with edits intact.
  useEffect(() => {
    if (!previewing) return;
    const edited = editedRef.current;
    if (!edited) return;
    const data: MapData = toMapData(edited);
    let stopped = false;
    let preview: { stop(): void } | null = null;
    void startMapPreview(data).then((started) => {
      if (stopped) {
        started.stop();
        return;
      }
      preview = started;
    });
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code !== "Escape") return;
      event.preventDefault();
      setPreviewing(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      stopped = true;
      window.removeEventListener("keydown", onKeyDown);
      preview?.stop();
    };
  }, [previewing]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function pushTool(tool: EditorTool): void {
    pendingToolRef.current = tool;
    handleRef.current?.setTool(tool);
  }

  function selectTool(key: ToolKey): void {
    setToolKey(key);
    setSelectedAsset(null);
    pushTool(paintToolFor(key, content));
  }

  function selectAsset(assetId: EditorAssetId): void {
    setToolKey(null);
    setSelectedAsset(assetId);
    pushTool({ kind: "element", assetId });
  }

  function pickContent(next: RectFillContent): void {
    setContent(next);
    if (toolKey === "pencil" || toolKey === "rect" || toolKey === "fill") {
      pushTool(paintToolFor(toolKey, next));
    }
  }

  function selectLayer(layer: 0 | 1 | 2): void {
    pendingLayerRef.current = layer;
    setActiveLayer(layer);
    handleRef.current?.setActiveLayer(layer);
  }

  function toggleGrid(): void {
    setShowGrid((current) => !current);
  }

  function cycleZoom(): void {
    setZoom((current) => (current >= 200 ? 100 : 200));
  }

  function test(): void {
    const handle = handleRef.current;
    if (!handle) return;
    editedRef.current = handle.current();
    setPreviewing(true);
  }

  function undo(): void {
    handleRef.current?.undo();
  }

  function redo(): void {
    handleRef.current?.redo();
  }

  async function save(): Promise<void> {
    const handle = handleRef.current;
    if (!handle || !map || stageStatus !== "ready") return;
    setError(null);
    try {
      const updated = await updateMapApi(map.id, toSaveInput(handle.current()));
      handle.markSaved();
      setDirty(false);
      setMap((current) => (current ? { ...current, ...updated } : current));
    } catch (caught) {
      fail(caught);
    }
  }

  async function newMap(): Promise<void> {
    setError(null);
    try {
      const created = await createMapApi(
        toSaveInput(blankMap(t("editor.new"), DEFAULT_COLS, DEFAULT_ROWS)),
      );
      editedRef.current = null;
      setMap(created);
    } catch (caught) {
      fail(caught);
    }
  }

  async function deleteMap(): Promise<void> {
    if (!map) return;
    if (!window.confirm(t("editor.shell.deleteMap.confirm", { name: map.name }))) return;
    setError(null);
    try {
      await deleteMapApi(map.id);
      exit(true);
    } catch (caught) {
      fail(caught);
    }
  }

  function exit(force = false): void {
    if (!force && dirty && !window.confirm(t("editor.shell.exit.confirm"))) {
      return;
    }
    setScreen("parties");
  }

  const toolLabel = selectedAsset
    ? t("editor.inspector.element")
    : toolKey
      ? toolLabelText(toolKey)
      : t("editor.inspector.element");

  if (previewing) {
    return (
      <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center">
        <p
          className="rounded-md bg-zinc-900/90 px-4 py-2 text-sm text-zinc-50 shadow-lg"
          role="status"
        >
          {t("editor.shell.preview.hint")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white text-zinc-950 select-none">
      <EditorMenuBar
        adventureName={map?.name ?? t("editor.shell.adventureFallback")}
        canUndo={canUndo && stageStatus === "ready"}
        canRedo={canRedo && stageStatus === "ready"}
        showGrid={showGrid}
        onExit={() => exit()}
        onNewMap={() => void newMap()}
        onSave={() => void save()}
        onDeleteMap={() => void deleteMap()}
        onUndo={undo}
        onRedo={redo}
        onSelectLayer={selectLayer}
        onSelectTool={selectTool}
        onToggleGrid={toggleGrid}
        onSetZoom={setZoom}
        onTest={test}
      />

      <EditorToolbar
        activeTool={toolKey === "stairs" ? null : toolKey}
        activeLayer={activeLayer}
        showGrid={showGrid}
        zoom={zoom}
        canSave={stageStatus === "ready"}
        onNewMap={() => void newMap()}
        onSave={() => void save()}
        onDeleteMap={() => void deleteMap()}
        onSelectTool={selectTool}
        onSelectLayer={selectLayer}
        onToggleGrid={toggleGrid}
        onCycleZoom={cycleZoom}
        onTest={test}
      />

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize="18" minSize="12" maxSize="30" className="min-h-0">
          {/* Task 9 replaces this with the full terrain palette. Minimal stand-in: terrain + stairs
              selection so pencil/rect/fill/stairs keep working through the merge. */}
          <aside
            className="flex h-full flex-col border-r border-zinc-200 bg-zinc-50"
            aria-label={t("editor.shell.palette.aria")}
          >
            <div className="flex h-8 items-center border-b border-zinc-200 px-3 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
              {t("editor.shell.terrain.heading")}
            </div>
            <div className="flex flex-col gap-1 p-2">
              <TerrainButton
                label={t("editor.tool.grass")}
                active={contentIs(content, "grass")}
                onClick={() => pickContent({ kind: "block", block: "grass" })}
              />
              <TerrainButton
                label={t("editor.tool.water")}
                active={contentIs(content, "water")}
                onClick={() => pickContent({ kind: "block", block: "water" })}
              />
              <TerrainButton
                label={t("editor.shell.terrain.elevation1")}
                active={contentIsLevel(content, 0)}
                onClick={() => pickContent({ kind: "elevation", level: 0 })}
              />
              <TerrainButton
                label={t("editor.shell.terrain.elevation2")}
                active={contentIsLevel(content, 1)}
                onClick={() => pickContent({ kind: "elevation", level: 1 })}
              />
              <TerrainButton
                label={t("editor.shell.terrain.elevation3")}
                active={contentIsLevel(content, 2)}
                onClick={() => pickContent({ kind: "elevation", level: 2 })}
              />
              <TerrainButton
                label={t("editor.shell.tool.stairs")}
                active={toolKey === "stairs"}
                onClick={() => selectTool("stairs")}
              />
            </div>
          </aside>
        </ResizablePanel>
        <ResizableHandle />

        <ResizablePanel defaultSize="64" className="min-h-0">
          {/* The stage draws on the sibling #stage canvas behind #root; this pane is its viewport.
              The scenery palette floats over it, exactly as before, until Task 9 moves it left. */}
          <section
            className="relative h-full min-h-0 overflow-hidden"
            aria-label={t("editor.shell.stage.aria")}
          >
            {stageStatus === "loading" && (
              <p className="absolute left-3 top-3 z-10 text-sm text-zinc-500" role="status">
                {t("editor.shell.stage.loading")}
              </p>
            )}
            {stageStatus === "error" && (
              <p className="absolute left-3 top-3 z-10 text-sm text-red-600" role="alert">
                {t("editor.shell.stage.error")}
              </p>
            )}
            {error && (
              <p className="absolute left-3 bottom-3 z-10 text-sm text-red-600" role="alert">
                {authErrorText(error)}
              </p>
            )}
            <div className="pointer-events-auto absolute right-3 top-3 z-10 w-64">
              <EditorAssetPalette
                selected={selectedAsset}
                elementCount={elementCount}
                onSelect={selectAsset}
              />
            </div>
          </section>
        </ResizablePanel>
        <ResizableHandle />

        <ResizablePanel defaultSize="18" minSize="12" maxSize="30" className="min-h-0">
          {/* Task 8 replaces this with the adventure's maps list + new-map dialog. */}
          <aside
            className="flex h-full flex-col border-l border-zinc-200 bg-zinc-50"
            aria-label={t("editor.shell.maps.aria")}
          >
            <div className="flex h-8 items-center justify-between border-b border-zinc-200 px-3 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
              {t("editor.shell.maps.aria")}
            </div>
            <div className="flex flex-1 flex-col gap-1 overflow-auto p-2 text-sm text-zinc-500">
              {map ? (
                <span className="truncate rounded-md bg-zinc-200/60 px-2 py-1 text-zinc-700">
                  {map.name}
                </span>
              ) : null}
              <p className="px-1 pt-2 text-[11px] leading-relaxed text-zinc-400">
                {t("editor.shell.maps.comingSoon")}
              </p>
            </div>
          </aside>
        </ResizablePanel>
      </ResizablePanelGroup>

      <EditorStatusBar
        mapName={map?.name ?? "—"}
        cols={map?.cols ?? 0}
        rows={map?.rows ?? 0}
        cursor="(—, —)"
        saved={map !== null && !dirty && stageStatus === "ready"}
        activeLayer={activeLayer}
        toolLabel={toolLabel}
        zoom={zoom}
      />
    </div>
  );
}

function contentIs(content: RectFillContent, block: "grass" | "water"): boolean {
  return content.kind === "block" && content.block === block;
}

function contentIsLevel(content: RectFillContent, level: 0 | 1 | 2): boolean {
  return content.kind === "elevation" && content.level === level;
}

function TerrainButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-md px-2 py-1.5 text-left text-[12px] font-medium ${
        active ? "bg-zinc-900 text-zinc-50" : "text-zinc-600 hover:bg-zinc-200/70"
      }`}
    >
      {label}
    </button>
  );
}
