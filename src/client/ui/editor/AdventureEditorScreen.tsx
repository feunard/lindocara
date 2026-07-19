import {
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { MONSTER_SPECIES_KIND, type MonsterSpecies } from "../../../shared/game.js";
import {
  EMPTY_MARKERS,
  MARKER_LABEL_MAX,
  MAX_PATROL_RADIUS,
  type MapData,
  MIN_PATROL_RADIUS,
} from "../../../shared/map-data.js";
import { type EditorAssetId, editorAsset } from "../../../shared/tiny-swords-catalog.js";
import {
  authErrorText,
  errorCode,
  fetchMap,
  fetchMaps,
  type MapPayload,
  updateMapApi,
} from "../../api.js";
import {
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
import { Button } from "../components/button.js";
import { Input } from "../components/input.js";
import { Label } from "../components/label.js";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../components/resizable.js";
import { AdventureSettingsDialog } from "./AdventureSettingsDialog.js";
import { EditorMenuBar } from "./EditorMenuBar.js";
import { EditorStatusBar } from "./EditorStatusBar.js";
import { type EditorPaintTool, EditorToolbar, toolLabelText } from "./EditorToolbar.js";
import { MapListPanel } from "./MapListPanel.js";
import { type MarkerToolKey, TerrainPalette } from "./TerrainPalette.js";

/** The default terrain a fresh stroke paints with until the Task 9 terrain palette lands: flat grass,
 *  matching the stage's own default tool so what the toolbar shows and what the stage paints agree. */
const DEFAULT_CONTENT: RectFillContent = { kind: "block", block: "grass" };

type StageStatus = "loading" | "empty" | "ready" | "error";
/** The active tool key. `stairs`, scenery, the marker tools and `event` have no *paint*-toolbar
 *  button — they are picked in the palette or the EV slot — so the paint toolbar highlights only for
 *  its five paint tools. */
type ToolKey = EditorPaintTool | "stairs" | MarkerToolKey | "event";

function isPaintToolKey(key: ToolKey | null): key is EditorPaintTool {
  return (
    key === "select" || key === "pencil" || key === "rect" || key === "fill" || key === "eraser"
  );
}

/** The EditorTool a marker palette selection resolves to, bundling the monster species/radius the
 *  monster tool needs. */
function markerToolFor(
  key: MarkerToolKey,
  species: MonsterSpecies,
  patrolRadius: number,
): EditorTool {
  switch (key) {
    case "spawn":
      return { kind: "spawn" };
    case "entry":
      return { kind: "marker-entry" };
    case "exit":
      return { kind: "marker-exit" };
    case "monster":
      return { kind: "marker-monster", species, patrolRadius };
  }
}

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
    events: map.events ?? [],
  };
}

/** The single EditorTool a toolbar/palette selection resolves to. Terrain content composes into
 *  pencil (single cell), rect and fill exactly as the pre-merge editor's paint path did. */
function paintToolFor(key: EditorPaintTool | "stairs", content: RectFillContent): EditorTool {
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

  const handleRef = useRef<MapEditorStageHandle | null>(null);
  const pendingToolRef = useRef<EditorTool>(paintToolFor("pencil", DEFAULT_CONTENT));
  // Mirrors `activeLayer` the same way `pendingToolRef` mirrors the pending tool: the async stage-open
  // `.then` below must read the layer selected *while it was opening*, not the one captured when the
  // effect started running. Without this, clicking a layer during the open window is silently
  // overwritten by the stale initial layer once the stage resolves.
  const pendingLayerRef = useRef<0 | 1 | 2>(0);
  // Mirrors `dim` for the same reason `pendingLayerRef` mirrors the active layer: a dim toggled while
  // the stage is still opening must be installed by the resolving `.then`, not lost.
  const pendingDimRef = useRef(false);
  // The live edits captured when Tester is pressed, carried across the preview round-trip so the
  // stage reopens from them rather than the pristine payload.
  const editedRef = useRef<EditorMap | null>(null);
  const autoOpened = useRef(false);
  // The keyboard-shortcut host: shortcuts are bound here, never on `document`, so no other screen's
  // typing risks being intercepted. It needs `tabIndex={-1}` to be programmatically focusable — see
  // the focus effect below.
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [map, setMap] = useState<MapPayload | null>(null);
  const [toolKey, setToolKey] = useState<ToolKey | null>("pencil");
  const [content, setContent] = useState<RectFillContent>(DEFAULT_CONTENT);
  const [selectedAsset, setSelectedAsset] = useState<EditorAssetId | null>(null);
  // The default graphic a newly placed event's page 1 receives, carried on the event tool; `null` is
  // the wireframe's "no graphic" default (a blank placeholder on the overlay).
  const [pendingEventGraphic, setPendingEventGraphic] = useState<EditorAssetId | null>(null);
  const [activeLayer, setActiveLayer] = useState<0 | 1 | 2>(0);
  const [showGrid, setShowGrid] = useState(true);
  const [showDim, setShowDim] = useState(false);
  const [cursor, setCursor] = useState<{ col: number; row: number } | null>(null);
  const [zoom, setZoom] = useState(100);
  const [elementCount, setElementCount] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [selection, setSelection] = useState<EditorSelection | null>(null);
  const [markerSpecies, setMarkerSpecies] = useState<MonsterSpecies>("spear_goblin");
  const [markerRadius, setMarkerRadius] = useState(96);
  const [stageStatus, setStageStatus] = useState<StageStatus>("loading");
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Right-pane / dialog coordination, lifted here so the menu bar, toolbar and map panel all reach
  // the same new-map dialog, delete confirm and settings dialog.
  const [newMapOpen, setNewMapOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Bumped after every save/create so the map panel refetches names and dimensions.
  const [mapsRefreshNonce, setMapsRefreshNonce] = useState(0);

  function fail(caught: unknown): void {
    const code = errorCode(caught);
    if (isSessionError(code)) setScreen("auth");
    else setError(code);
  }

  // Load the map to edit once: the author's first map. Task 8's maps panel takes over selection;
  // this is the minimal seam that keeps the stage fed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: one contextual auto-open on mount
  useEffect(() => {
    if (autoOpened.current) return;
    autoOpened.current = true;
    void (async () => {
      try {
        const list = await fetchMaps();
        const first = list[0];
        // A fresh account has zero maps: that is a first-class empty state, not an error. Leave `map`
        // null (no stage opened) and let the centre invite a first map; the maps panel already
        // renders its own empty list with a New-map affordance.
        if (first) setMap(await fetchMap(first.id));
        else setStageStatus("empty");
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
    openMapEditorStage(
      editedRef.current ?? toEditorMap(map),
      (changed, state) => {
        setError(null);
        setElementCount(changed.elements.length);
        setDirty(state.dirty);
        setCanUndo(state.canUndo);
        setCanRedo(state.canRedo);
        setSelection(state.selection);
      },
      (col, row) => setCursor(col === null || row === null ? null : { col, row }),
    )
      .then((handle) => {
        if (cancelled) {
          handle.dispose();
          return;
        }
        handleRef.current = handle;
        handle.setTool(pendingToolRef.current);
        handle.setActiveLayer(pendingLayerRef.current);
        handle.setDim(pendingDimRef.current);
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

  // Claims focus for the shortcut host whenever its container (re)appears — on first mount and again
  // every time the preview sandbox hands the screen back, since that branch unmounts this container
  // entirely. `tabIndex={-1}` makes the div programmatically focusable without adding it to the tab
  // order.
  useEffect(() => {
    if (previewing) return;
    containerRef.current?.focus();
  }, [previewing]);

  // The monster marker tool bundles its species/radius into the pushed tool, so changing either while
  // that tool is active must re-push it — otherwise the stage keeps stamping spawns with whatever
  // species/radius were selected when the tool was last picked.
  useEffect(() => {
    if (toolKey !== "monster") return;
    const tool: EditorTool = {
      kind: "marker-monster",
      species: markerSpecies,
      patrolRadius: markerRadius,
    };
    pendingToolRef.current = tool;
    handleRef.current?.setTool(tool);
  }, [toolKey, markerSpecies, markerRadius]);

  function pushTool(tool: EditorTool): void {
    pendingToolRef.current = tool;
    handleRef.current?.setTool(tool);
  }

  function selectTool(key: EditorPaintTool | "stairs"): void {
    setToolKey(key);
    setSelectedAsset(null);
    // Fill has no water primitive, so entering fill with water selected would be a dead brush. The
    // palette disables the water swatch while fill is active; this closes the reverse by falling the
    // content back to grass when fill is picked over a water selection.
    const next: RectFillContent =
      key === "fill" && content.kind === "block" && content.block === "water"
        ? { kind: "block", block: "grass" }
        : content;
    if (next !== content) setContent(next);
    pushTool(paintToolFor(key, next));
  }

  function selectMarkerTool(key: MarkerToolKey): void {
    setToolKey(key);
    setSelectedAsset(null);
    pushTool(markerToolFor(key, markerSpecies, markerRadius));
  }

  function selectAsset(assetId: EditorAssetId): void {
    setToolKey(null);
    setSelectedAsset(assetId);
    pushTool({ kind: "element", assetId });
  }

  // The EV slot and the Mode › Événements item both land here: activate the event tool, carrying the
  // pending default graphic so a first placement already has it.
  function selectEvents(): void {
    setToolKey("event");
    setSelectedAsset(null);
    pushTool({ kind: "event", graphic: pendingEventGraphic });
  }

  // The Événements palette picker sets the default graphic future events get; while the event tool is
  // active it re-pushes so the very next placement uses it (a "none" pick clears back to placeholder).
  function selectEventGraphic(assetId: EditorAssetId | null): void {
    setPendingEventGraphic(assetId);
    if (toolKey === "event") pushTool({ kind: "event", graphic: assetId });
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

  function toggleDim(): void {
    setShowDim((current) => {
      const next = !current;
      pendingDimRef.current = next;
      handleRef.current?.setDim(next);
      return next;
    });
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
      setMapsRefreshNonce((n) => n + 1);
    } catch (caught) {
      fail(caught);
    }
  }

  // The map panel's "select to switch" load path: guard unsaved edits, then swap the stage's map.
  function loadMap(id: string): void {
    if (id === map?.id) return;
    if (dirty && !window.confirm(t("editor.shell.exit.confirm"))) return;
    setError(null);
    void (async () => {
      try {
        editedRef.current = null;
        setMap(await fetchMap(id));
      } catch (caught) {
        fail(caught);
      }
    })();
  }

  // A freshly created or renamed-in-place map handed back by the panel: mount it in the stage.
  function openPayload(payload: MapPayload): void {
    editedRef.current = null;
    setMap(payload);
    setMapsRefreshNonce((n) => n + 1);
  }

  // The open map was deleted from the panel: fall back to the author's first remaining map, or an
  // empty stage if none is left.
  function activeMapDeleted(): void {
    setMapsRefreshNonce((n) => n + 1);
    void (async () => {
      try {
        const first = (await fetchMaps())[0];
        editedRef.current = null;
        if (first) setMap(await fetchMap(first.id));
        else {
          setMap(null);
          setStageStatus("empty");
        }
      } catch (caught) {
        fail(caught);
      }
    })();
  }

  function exit(force = false): void {
    if (!force && dirty && !window.confirm(t("editor.shell.exit.confirm"))) {
      return;
    }
    setScreen("parties");
  }

  // ⌘S save, ⌘Z/⇧⌘Z undo/redo, 1/2/3 active layer, P/R/F/E/S tools, G grid — dispatched straight to
  // the same actions the menu bar and toolbar call, never a parallel implementation. Inert while:
  // - an input/textarea/select owns the keystroke (checked on `event.target`, since typing "r" into
  //   the new-map name field must not switch tools);
  // - any of the three dialogs this screen tracks is open — `newMapOpen`, `confirmDeleteId` and
  //   `settingsOpen`. `event.target` checking alone cannot stand in for this: a dialog can be open
  //   while the keydown's target is neither an input nor even inside the dialog at all — a button in
  //   the (portaled) dialog, or focus that never left this container in the first place. Gating on
  //   `settingsOpen` in particular is what stops ⌘S from firing this screen's map save while the
  //   settings dialog is open with its own save action.
  // - the keydown's target is inside *any* dialog popup, tracked or not — `MapListPanel`'s rename
  //   dialog is local, un-lifted state this screen has no flag for, so the three explicit booleans
  //   above cannot gate it. Every shadcn `DialogContent` stamps `data-slot="dialog-content"` on its
  //   popup regardless of portal target (`dialog.tsx`), so a `closest()` search for that attribute
  //   catches the rename dialog today and future-proofs any later dialog this screen forgets to lift
  //   into its own state. This is additive to the three flags above, not a replacement: the flags
  //   still cover the "focus never left the container" case this `closest()` cannot see.
  // - the stage has not finished opening (`stageStatus !== "ready"`), matching every other action in
  //   this file guarding on stage readiness.
  function handleShortcutKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (stageStatus !== "ready") return;
    if (newMapOpen || confirmDeleteId !== null || settingsOpen) return;
    if (event.target instanceof Element && event.target.closest('[data-slot="dialog-content"]')) {
      return;
    }
    const target = event.target;
    if (target instanceof HTMLElement) {
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    }

    const key = event.key.toLowerCase();
    if (event.metaKey && key === "s") {
      event.preventDefault();
      void save();
      return;
    }
    if (event.metaKey && key === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    switch (key) {
      case "1":
        selectLayer(0);
        return;
      case "2":
        selectLayer(1);
        return;
      case "3":
        selectLayer(2);
        return;
      case "p":
        selectTool("pencil");
        return;
      case "r":
        selectTool("rect");
        return;
      case "f":
        selectTool("fill");
        return;
      case "e":
        selectTool("eraser");
        return;
      case "s":
        selectTool("select");
        return;
      case "g":
        toggleGrid();
        return;
    }
  }

  // Painting on `#stage` — React's sibling canvas, never React's to touch — blurs this container in
  // a real browser: the canvas has no `tabindex` in `index.html`, so a click on it cannot receive
  // focus itself, but per standard browser behaviour it still steals focus away from whatever *was*
  // focused, landing on `document.body`. Shortcuts then go silently dead until the user clicks some
  // chrome to refocus the container by hand. Recover from exactly that case and no other: refocus
  // only when `relatedTarget` is `null` or `document.body`, because that is the one signature a
  // genuine "focus went nowhere" blur has. A Radix/Base UI dialog opening always moves focus to a
  // concrete node *inside* itself (never `null`/`body`), so this condition is what keeps a refocus
  // here from ever fighting a dialog's own focus management — it is not a coincidence, it is the
  // whole reason this is safe to do unconditionally on the relatedTarget check alone. The dialog-flag
  // and stage-readiness checks mirror `handleShortcutKeyDown`'s own gates, for the same reasons.
  function handleContainerBlur(event: ReactFocusEvent<HTMLDivElement>): void {
    const related = event.relatedTarget;
    if (related !== null && related !== document.body) return;
    if (newMapOpen || confirmDeleteId !== null || settingsOpen) return;
    if (stageStatus !== "ready" || previewing) return;
    containerRef.current?.focus();
  }

  const toolLabel = selectedAsset
    ? t("editor.inspector.element")
    : toolKey === null
      ? t("editor.inspector.element")
      : isPaintToolKey(toolKey) || toolKey === "stairs"
        ? toolLabelText(toolKey)
        : t(`editor.tool.${toolKey}`);

  const activeMarker: MarkerToolKey | null =
    toolKey === "spawn" || toolKey === "entry" || toolKey === "exit" || toolKey === "monster"
      ? toolKey
      : null;
  const cursorText = cursor ? `(${cursor.col}, ${cursor.row})` : "(—, —)";

  // The live map the inspector reads its selected marker's fields off — the handle's current edits
  // while a stage is mounted, else whatever payload is loaded. Read in render so a new selection
  // reflects the latest positions.
  const currentMap: EditorMap | null =
    handleRef.current?.current() ?? editedRef.current ?? (map ? toEditorMap(map) : null);

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
    // biome-ignore lint/a11y/noStaticElementInteractions: shortcut-key host, not an interactive widget
    <div
      ref={containerRef}
      tabIndex={-1}
      onKeyDown={handleShortcutKeyDown}
      onBlur={handleContainerBlur}
      className="editor-root flex h-screen flex-col overflow-hidden text-zinc-950 select-none outline-none"
    >
      <EditorMenuBar
        adventureName={map?.name ?? t("editor.shell.adventureFallback")}
        canUndo={canUndo && stageStatus === "ready"}
        canRedo={canRedo && stageStatus === "ready"}
        showGrid={showGrid}
        showDim={showDim}
        onExit={() => exit()}
        onNewMap={() => setNewMapOpen(true)}
        onSave={() => void save()}
        onDeleteMap={() => setConfirmDeleteId(map?.id ?? null)}
        onOpenSettings={() => setSettingsOpen(true)}
        onUndo={undo}
        onRedo={redo}
        onSelectLayer={selectLayer}
        onSelectEvents={selectEvents}
        onSelectTool={selectTool}
        onToggleGrid={toggleGrid}
        onToggleDim={toggleDim}
        onSetZoom={setZoom}
        onTest={test}
      />

      <EditorToolbar
        activeTool={isPaintToolKey(toolKey) ? toolKey : null}
        activeLayer={activeLayer}
        eventActive={toolKey === "event"}
        showGrid={showGrid}
        showDim={showDim}
        zoom={zoom}
        canSave={stageStatus === "ready"}
        onNewMap={() => setNewMapOpen(true)}
        onSave={() => void save()}
        onDeleteMap={() => setConfirmDeleteId(map?.id ?? null)}
        onSelectTool={selectTool}
        onSelectLayer={selectLayer}
        onSelectEvents={selectEvents}
        onToggleGrid={toggleGrid}
        onToggleDim={toggleDim}
        onCycleZoom={cycleZoom}
        onTest={test}
      />

      <ResizablePanelGroup orientation="horizontal" className="editor-body min-h-0 flex-1">
        <ResizablePanel
          defaultSize="18"
          minSize="12"
          maxSize="30"
          className="editor-chrome min-h-0"
        >
          <TerrainPalette
            content={content}
            fillActive={toolKey === "fill"}
            stairsActive={toolKey === "stairs"}
            activeMarker={activeMarker}
            eventMode={toolKey === "event"}
            pendingEventGraphic={pendingEventGraphic}
            selectedAsset={selectedAsset}
            markerSpecies={markerSpecies}
            markerRadius={markerRadius}
            elementCount={elementCount}
            onPickContent={pickContent}
            onSelectStairs={() => selectTool("stairs")}
            onSelectMarkerTool={selectMarkerTool}
            onSelectAsset={selectAsset}
            onSelectEventGraphic={selectEventGraphic}
            onMarkerSpeciesChange={setMarkerSpecies}
            onMarkerRadiusChange={setMarkerRadius}
          />
        </ResizablePanel>
        <ResizableHandle className="editor-chrome" />

        <ResizablePanel defaultSize="64" className="min-h-0">
          {/* The stage draws on the sibling #stage canvas behind #root; this pane is its viewport.
              The decoration palette now lives in the left TerrainPalette, not floating over here. */}
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
            {stageStatus === "empty" && (
              <div className="pointer-events-auto absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 text-center">
                <p className="text-sm font-semibold text-zinc-300">
                  {t("editor.shell.stage.empty.title")}
                </p>
                <p className="max-w-xs text-xs text-zinc-400">
                  {t("editor.shell.stage.empty.hint")}
                </p>
                <Button size="sm" onClick={() => setNewMapOpen(true)}>
                  {t("editor.new")}
                </Button>
              </div>
            )}
            {error && (
              <p className="absolute left-3 bottom-3 z-10 text-sm text-red-600" role="alert">
                {authErrorText(error)}
              </p>
            )}
            {selection && currentMap && (
              <div className="pointer-events-auto absolute bottom-3 left-3 z-10 w-64">
                <MarkerInspector
                  selection={selection}
                  map={currentMap}
                  onSetLabel={(label) => handleRef.current?.setSelectedMarkerLabel(label)}
                  onMove={(col, row) => handleRef.current?.moveSelected(col, row)}
                  onSetMonster={(species, radius) =>
                    handleRef.current?.setSelectedMonster(species, radius)
                  }
                  onDelete={() => handleRef.current?.deleteSelected()}
                />
              </div>
            )}
          </section>
        </ResizablePanel>
        <ResizableHandle className="editor-chrome" />

        <ResizablePanel
          defaultSize="18"
          minSize="12"
          maxSize="30"
          className="editor-chrome min-h-0"
        >
          <MapListPanel
            activeMapId={map?.id ?? null}
            dirty={dirty}
            refreshNonce={mapsRefreshNonce}
            newMapOpen={newMapOpen}
            onNewMapOpenChange={setNewMapOpen}
            confirmDeleteId={confirmDeleteId}
            onConfirmDeleteIdChange={setConfirmDeleteId}
            onRequestOpen={loadMap}
            onOpenPayload={openPayload}
            onActiveDeleted={activeMapDeleted}
            onOpenSettings={() => setSettingsOpen(true)}
            onError={(code) => setError(code === "" ? null : code)}
            onSessionExpired={() => setScreen("auth")}
          />
        </ResizablePanel>
      </ResizablePanelGroup>

      <AdventureSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onSaved={() => setMapsRefreshNonce((n) => n + 1)}
        onSessionExpired={() => setScreen("auth")}
      />

      <EditorStatusBar
        mapName={map?.name ?? "—"}
        cols={map?.cols ?? 0}
        rows={map?.rows ?? 0}
        cursor={cursorText}
        saved={map !== null && !dirty && stageStatus === "ready"}
        activeLayer={activeLayer}
        toolLabel={toolLabel}
        zoom={zoom}
      />
    </div>
  );
}

/**
 * The selection inspector restored from the old MapEditor: the label, species/radius and cell of the
 * selected marker, with move and delete, all pushed straight through the stage handle. Stock shadcn +
 * a dense native species select; the hero spawn is move-only (it cannot be deleted).
 */
function MarkerInspector({
  selection,
  map,
  onSetLabel,
  onMove,
  onSetMonster,
  onDelete,
}: {
  selection: EditorSelection;
  map: EditorMap;
  onSetLabel(label: string): void;
  onMove(col: number, row: number): void;
  onSetMonster(species: MonsterSpecies, patrolRadius: number): void;
  onDelete(): void;
}) {
  useLocale();
  const selectedEntry =
    selection.kind === "entry"
      ? map.markers.entries.find((marker) => marker.id === selection.id)
      : undefined;
  const selectedExit =
    selection.kind === "exit"
      ? map.markers.exits.find((marker) => marker.id === selection.id)
      : undefined;
  const selectedMonster =
    selection.kind === "monster"
      ? map.markers.monsterSpawns.find(
          (marker) => marker.col === selection.col && marker.row === selection.row,
        )
      : undefined;
  const selectedElement =
    selection.kind === "element"
      ? map.elements.find(
          (element) => element.col === selection.col && element.row === selection.row,
        )
      : undefined;
  const named = selectedEntry ?? selectedExit;
  const position =
    named ??
    selectedMonster ??
    selectedElement ??
    (selection.kind === "spawn" ? map.spawn : undefined);

  return (
    <aside
      className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-3 shadow-lg"
      aria-label={t("editor.inspector.title")}
    >
      <p className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
        {t(`editor.inspector.${selection.kind}`)}
      </p>

      {named && (
        <>
          <p className="text-[11px] text-zinc-500">
            {t("editor.inspector.id")}: <code>{named.id}</code>
          </p>
          <Label htmlFor="inspector-label" className="text-[11px] text-zinc-500">
            {t("editor.inspector.label")}
          </Label>
          <Input
            id="inspector-label"
            key={`${selection.kind}:${named.id}`}
            type="text"
            className="h-7 text-xs"
            maxLength={MARKER_LABEL_MAX}
            defaultValue={named.label ?? ""}
            onBlur={(event) => onSetLabel(event.currentTarget.value)}
          />
        </>
      )}

      {selectedElement && (
        <p className="text-[11px] text-zinc-500">
          {selectedElement.assetId}
          {editorAsset(selectedElement.assetId)?.editor.collisionFootprint.length
            ? ` · ${t("editor.palette.collision")}`
            : ` · ${t("editor.inspector.walkable")}`}
        </p>
      )}

      {selectedMonster && (
        <>
          <Label htmlFor="inspector-species" className="text-[11px] text-zinc-500">
            {t("editor.markers.species")}
          </Label>
          <select
            id="inspector-species"
            className="h-7 w-full rounded-md border border-input bg-white px-1.5 text-xs outline-none"
            value={selectedMonster.species}
            onChange={(event) =>
              onSetMonster(
                event.currentTarget.value as MonsterSpecies,
                selectedMonster.patrolRadius,
              )
            }
          >
            {(Object.keys(MONSTER_SPECIES_KIND) as MonsterSpecies[]).map((option) => (
              <option key={option} value={option}>
                {t(`monster.${option}`)}
              </option>
            ))}
          </select>
          <Label htmlFor="inspector-radius" className="text-[11px] text-zinc-500">
            {t("editor.markers.radius")}
          </Label>
          <Input
            id="inspector-radius"
            type="number"
            className="h-7 text-xs"
            min={MIN_PATROL_RADIUS}
            max={MAX_PATROL_RADIUS}
            defaultValue={selectedMonster.patrolRadius}
            onBlur={(event) =>
              onSetMonster(selectedMonster.species, Number(event.currentTarget.value))
            }
          />
        </>
      )}

      {position && (
        <div className="flex gap-2">
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor="inspector-col" className="text-[11px] text-zinc-500">
              {t("editor.cols")}
            </Label>
            <Input
              id="inspector-col"
              type="number"
              className="h-7 text-xs"
              min={0}
              defaultValue={position.col}
              onBlur={(event) => onMove(Number(event.currentTarget.value), position.row)}
            />
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor="inspector-row" className="text-[11px] text-zinc-500">
              {t("editor.rows")}
            </Label>
            <Input
              id="inspector-row"
              type="number"
              className="h-7 text-xs"
              min={0}
              defaultValue={position.row}
              onBlur={(event) => onMove(position.col, Number(event.currentTarget.value))}
            />
          </div>
        </div>
      )}

      {selection.kind !== "spawn" && (
        <Button variant="destructive" size="sm" onClick={onDelete}>
          {t("editor.delete")}
        </Button>
      )}
    </aside>
  );
}
