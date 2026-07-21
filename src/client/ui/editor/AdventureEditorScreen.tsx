import {
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AdventureInput } from "../../../shared/adventure.js";
import { type AdventureRegistry, EMPTY_REGISTRY } from "../../../shared/adventure-state.js";
import type { MonsterSpecies } from "../../../shared/game.js";
import { EMPTY_MARKERS, type MapData } from "../../../shared/map-data.js";
import type { EventKind, MapEvent } from "../../../shared/map-events.js";
import { type EditorAssetId, editorAsset } from "../../../shared/tiny-swords-catalog.js";
import { setStart } from "../../adventure-draft.js";
import {
  authErrorText,
  createAdventureApi,
  errorCode,
  fetchMap,
  fetchMaps,
  type MapPayload,
  updateAdventureApi,
  updateMapApi,
} from "../../api.js";
import {
  type EditorMap,
  type EditorMode,
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
import { type AdventureEditorSession, useUiStore } from "../../store.js";
import { Button } from "../components/button.js";
import { Input } from "../components/input.js";
import { Label } from "../components/label.js";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../components/resizable.js";
import { AdventureSettingsDialog } from "./AdventureSettingsDialog.js";
import { loadAdventureSession } from "./adventure-session.js";
import { EditorMenuBar } from "./EditorMenuBar.js";
import { EditorPalette } from "./EditorPalette.js";
import { EditorStatusBar } from "./EditorStatusBar.js";
import { type EditorPaintTool, EditorToolbar, toolLabelText } from "./EditorToolbar.js";
import { EventDialog } from "./EventDialog.js";
import {
  clearLastEditedAdventure,
  readLastEditedAdventure,
  writeLastEditedAdventure,
} from "./editor-last-adventure.js";
import { FirstSaveDialog } from "./FirstSaveDialog.js";
import { LoadAdventureDialog } from "./LoadAdventureDialog.js";
import { MapListPanel } from "./MapListPanel.js";
import { RegistryDialog } from "./RegistryDialog.js";

/** The default terrain a fresh stroke paints with until the Task 9 terrain palette lands: flat grass,
 *  matching the stage's own default tool so what the toolbar shows and what the stage paints agree. */
const DEFAULT_CONTENT: RectFillContent = { kind: "block", block: "grass" };

type StageStatus = "loading" | "empty" | "ready" | "error";
/** The active tool key. `stairs`, the hero-spawn tool, scenery and `event` have no *paint*-toolbar
 *  button — they are picked in the palette or the EV slot — so the paint toolbar highlights only for
 *  its five paint tools. */
type ToolKey = EditorPaintTool | "stairs" | "spawn" | "event";

function isPaintToolKey(key: ToolKey | null): key is EditorPaintTool {
  return (
    key === "select" || key === "pencil" || key === "rect" || key === "fill" || key === "eraser"
  );
}

/** The event `EditorTool` for the current EV kind, bundling the pending graphic (normal) or the
 *  species/radius (monster) the placement needs. Markers are dead — every entry/exit/monster is an
 *  event now, chosen by `eventKind` on the one event tool. */
function eventToolFor(
  eventKind: EventKind,
  graphic: EditorAssetId | null,
  species: MonsterSpecies,
  patrolRadius: number,
): EditorTool {
  if (eventKind === "monster") return { kind: "event", eventKind, species, patrolRadius };
  if (eventKind === "normal") return { kind: "event", eventKind, graphic };
  return { kind: "event", eventKind };
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
    // Markers are QUARANTINED (UX wave #12): the editor ignores whatever a (legacy) payload still
    // carries and never authors one, so it opens with `EMPTY_MARKERS` and saves the same.
    markers: EMPTY_MARKERS,
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
  const session = useUiStore((state) => state.adventureEditorSession);
  // UX wave #15: opening the editor opens THE EDITOR, never a picker page. A session with a real id
  // mounts the shell straight away; otherwise the bootstrap resolves one (last-edited, else
  // instant-create) behind a loading shell — never a flash of a list.
  if (session?.adventureId) {
    return <AdventureEditorInner key={session.adventureId} adventureId={session.adventureId} />;
  }
  return <EditorBootstrap />;
}

/** Resolve the adventure the editor opens on (UX wave #15): the last one this account edited, else a
 *  freshly instant-created draft (remark 14's flow). A remembered id that is gone or forbidden falls
 *  through to instant-create; a genuine session error is re-thrown so the caller redirects to auth. */
async function bootstrapEditorSession(accountId: string | null): Promise<AdventureEditorSession> {
  const lastId = readLastEditedAdventure(accountId);
  if (lastId) {
    try {
      return await loadAdventureSession(lastId);
    } catch (caught) {
      if (isSessionError(errorCode(caught))) throw caught;
      // Gone or forbidden: forget it and fall through to a fresh adventure.
      clearLastEditedAdventure(accountId);
    }
  }
  // No memory (or a stale id): create immediately with the localized default title + 4 players and
  // land in the editor; the real name is asked at the first save (titleUntouched).
  const created = await createAdventureApi({ title: t("adventure.default_title"), maxPlayers: 4 });
  const loaded = await loadAdventureSession(created.id);
  return { ...loaded, titleUntouched: true };
}

/** The editor's own loading shell while the bootstrap resolves the opening adventure. No picker, no
 *  bare stage — just the light editor scope and a status line, so re-entry never flashes a list. */
function EditorBootstrap() {
  useLocale();
  const accountId = useUiStore((state) => state.accountId);
  const setSession = useUiStore((state) => state.setAdventureEditorSession);
  const setScreen = useUiStore((state) => state.setScreen);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: one bootstrap on mount
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        setSession(await bootstrapEditorSession(accountId));
      } catch (caught) {
        if (isSessionError(errorCode(caught))) setScreen("auth");
        else setError(errorCode(caught));
      }
    })();
  }, []);

  return (
    <div className="editor-root flex h-screen flex-col items-center justify-center gap-3 bg-zinc-50 text-zinc-950">
      {error ? (
        <>
          <p role="alert" className="text-sm text-destructive">
            {authErrorText(error)}
          </p>
          <Button variant="outline" size="sm" onClick={() => setScreen("parties")}>
            {t("editor.shell.quit")}
          </Button>
        </>
      ) : (
        <p role="status" className="text-sm text-zinc-500">
          {t("editor.shell.stage.loading")}
        </p>
      )}
    </div>
  );
}

function AdventureEditorInner({ adventureId }: { adventureId: string }) {
  useLocale();
  const setScreen = useUiStore((state) => state.setScreen);
  const setSession = useUiStore((state) => state.setAdventureEditorSession);
  const accountId = useUiStore((state) => state.accountId);
  // The starting map (UX wave #6) is the graph start's map — surfaced in the Cartes panel below.
  const startMapId = useUiStore(
    (state) => state.adventureEditorSession?.draft.start?.mapId ?? null,
  );
  // The switch/variable registry rides the loaded adventure session's draft. When no adventure is
  // loaded (the common map-first case) it is empty, which falls the event dialog's condition pickers
  // back to free text. Loading an adventure in the database dialog fills it.
  const registry: AdventureRegistry = useUiStore(
    (state) => state.adventureEditorSession?.draft.registry ?? EMPTY_REGISTRY,
  );
  // The maps that can be made the start (UX wave #6 review fix): a map is a valid start only if it has
  // an entry to point the graph at. The Cartes panel disables the start star on the rest, so the user
  // gets a hint instead of the misleading `adventure_maps` error the star used to raise.
  const draftMembers = useUiStore((state) => state.adventureEditorSession?.draft.members);
  // The first-save popup prefills with the adventure's current (default) title.
  const draftTitle = useUiStore((state) => state.adventureEditorSession?.draft.title ?? "");
  const startableMapIds = useMemo(
    () =>
      new Set(
        (draftMembers ?? [])
          .filter((member) => member.entryIds.length > 0)
          .map((member) => member.mapId),
      ),
    [draftMembers],
  );
  // The adventure's maps a `teleport` command may target, with the dims the dialog clamps the
  // destination cell against. Dims come off the member's display solid mask (rows = its length,
  // cols = a row's length) — the same thumbnail the Cartes panel already carries, no extra fetch.
  const teleportMaps = useMemo(
    () =>
      (draftMembers ?? []).map((member) => ({
        mapId: member.mapId,
        name: member.name,
        rows: member.solid.length,
        cols: member.solid[0]?.length ?? 0,
      })),
    [draftMembers],
  );

  const handleRef = useRef<MapEditorStageHandle | null>(null);
  const pendingToolRef = useRef<EditorTool>(paintToolFor("pencil", DEFAULT_CONTENT));
  // Mirrors `mode` the same way `pendingToolRef` mirrors the pending tool: the async stage-open
  // `.then` below must read the mode selected *while it was opening*, not the one captured when the
  // effect started running. Without this, clicking a mode during the open window is silently
  // overwritten by the stale initial mode once the stage resolves.
  const pendingModeRef = useRef<EditorMode>("field");
  // Mirrors `dim` for the same reason `pendingModeRef` mirrors the active mode: a dim toggled while
  // the stage is still opening must be installed by the resolving `.then`, not lost.
  const pendingDimRef = useRef(false);
  // Mirrors `showGrid` (UX wave #8), so the grid-visible state a resolving stage installs is the one
  // in effect — on by default — even if the toggle was pressed while the stage was opening.
  const pendingGridRef = useRef(true);
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
  const [mode, setActiveMode] = useState<EditorMode>("field");
  const [showGrid, setShowGrid] = useState(true);
  const [showDim, setShowDim] = useState(false);
  const [cursor, setCursor] = useState<{ col: number; row: number } | null>(null);
  const [zoom, setZoom] = useState(100);
  const [elementCount, setElementCount] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [selection, setSelection] = useState<EditorSelection | null>(null);
  // The kind the EV tool places (normal / entry / exit / monster), and the monster kind's default
  // species/radius. Markers are dead — these drive the one event tool's placement.
  const [eventKind, setEventKind] = useState<EventKind>("normal");
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
  const [databaseOpen, setDatabaseOpen] = useState(false);
  // UX wave #15: the "Load an adventure" dialog, reached from File → « Charger une aventure ».
  const [loadOpen, setLoadOpen] = useState(false);
  // UX wave #14: a freshly created adventure is born with the default title, so its first explicit
  // save must prompt for the real name. Seeded once (this component is keyed by adventureId, so a new
  // adventure remounts it) from the picker's `titleUntouched` flag, then kept in local state so no
  // session reload (map/graph refreshes rebuild the session without the flag) can lose it. Cleared on
  // the first-save confirm and whenever the settings dialog saves — both are explicit namings.
  const [titleUntouched, setTitleUntouched] = useState(
    () => useUiStore.getState().adventureEditorSession?.titleUntouched ?? false,
  );
  const [firstSaveOpen, setFirstSaveOpen] = useState(false);
  // The event whose dialog is open, keyed by uuid. Set by a stage double-click (`onOpenEvent`) or by
  // pressing Enter on a selected event; cleared on save/delete/cancel.
  const [openEventId, setOpenEventId] = useState<string | null>(null);
  // Bumped after every save/create so the map panel refetches names and dimensions.
  const [mapsRefreshNonce, setMapsRefreshNonce] = useState(0);

  function fail(caught: unknown): void {
    const code = errorCode(caught);
    if (isSessionError(code)) setScreen("auth");
    else setError(code);
  }

  // UX wave #15: remember this as the last-edited adventure so the next editor open lands straight in
  // it. This is the single write point — the bootstrap, the load dialog and the instant-create all
  // reach the editor through this keyed component, so one mount-time write covers every path.
  useEffect(() => {
    writeLastEditedAdventure(accountId, adventureId);
  }, [accountId, adventureId]);

  // Load a different adventure (UX wave #15), from the File → « Charger une aventure » dialog. Guard
  // unsaved edits first, then swap the session — a new adventureId remounts this component (it is
  // keyed by it), resetting every room-local editor state cleanly.
  function loadAdventure(id: string): void {
    if (id === adventureId) {
      setLoadOpen(false);
      return;
    }
    if (dirty && !window.confirm(t("editor.shell.exit.confirm"))) return;
    setError(null);
    void (async () => {
      try {
        const loaded = await loadAdventureSession(id);
        setSession(loaded);
        setLoadOpen(false);
      } catch (caught) {
        fail(caught);
      }
    })();
  }

  // Load the map to edit once: the author's first map. Task 8's maps panel takes over selection;
  // this is the minimal seam that keeps the stage fed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: one contextual auto-open on mount
  useEffect(() => {
    if (autoOpened.current) return;
    autoOpened.current = true;
    void (async () => {
      try {
        // No adventure loaded means no maps to open — a first-class empty state, not an error.
        if (!adventureId) {
          setStageStatus("empty");
          return;
        }
        const list = await fetchMaps(adventureId);
        const first = list[0];
        // A fresh adventure has zero maps: that is a first-class empty state, not an error. Leave
        // `map` null (no stage opened) and let the centre invite a first map; the maps panel already
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
  // a preview start before it resolves still disposes it. `mode` is intentionally excluded
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
      (id) => setOpenEventId(id),
    )
      .then((handle) => {
        if (cancelled) {
          handle.dispose();
          return;
        }
        handleRef.current = handle;
        handle.setTool(pendingToolRef.current);
        handle.setActiveMode(pendingModeRef.current);
        handle.setDim(pendingDimRef.current);
        handle.setGrid(pendingGridRef.current);
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

  // The monster event kind bundles its species/radius into the pushed tool, so changing either while
  // that kind is active must re-push it — otherwise the stage keeps stamping spawns with whatever
  // species/radius were selected when the kind was last picked.
  useEffect(() => {
    if (toolKey !== "event" || eventKind !== "monster") return;
    const tool: EditorTool = {
      kind: "event",
      eventKind: "monster",
      species: markerSpecies,
      patrolRadius: markerRadius,
    };
    pendingToolRef.current = tool;
    handleRef.current?.setTool(tool);
  }, [toolKey, eventKind, markerSpecies, markerRadius]);

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

  function selectSpawn(): void {
    setToolKey("spawn");
    setSelectedAsset(null);
    pushTool({ kind: "spawn" });
  }

  function selectAsset(assetId: EditorAssetId): void {
    setToolKey(null);
    setSelectedAsset(assetId);
    pushTool({ kind: "element", assetId });
  }

  // The EV kind selector: switch which kind the event tool places, re-pushing so the very next
  // placement is of the chosen kind (the monster re-push effect keeps species/radius fresh too).
  function selectEventKind(kind: EventKind): void {
    setEventKind(kind);
    if (toolKey === "event") {
      pushTool(eventToolFor(kind, pendingEventGraphic, markerSpecies, markerRadius));
    }
  }

  // The Événements palette picker sets the default graphic future `normal` events get; while the
  // normal event kind is active it re-pushes so the next placement uses it (a "none" pick clears back
  // to the placeholder).
  function selectEventGraphic(assetId: EditorAssetId | null): void {
    setPendingEventGraphic(assetId);
    if (toolKey === "event" && eventKind === "normal") {
      pushTool({ kind: "event", eventKind: "normal", graphic: assetId });
    }
  }

  // UX wave #11: exactly one selection. Picking a terrain content is a terrain-tool selection, so if a
  // marker/decoration/event tool is active it is deselected and the pencil takes over — never Herbe
  // AND a marker highlighted at once. When a paint shape (pencil/rect/fill) is already active the
  // content just re-feeds it, keeping that shape.
  function pickContent(next: RectFillContent): void {
    setContent(next);
    if (toolKey === "pencil" || toolKey === "rect" || toolKey === "fill") {
      pushTool(paintToolFor(toolKey, next));
      return;
    }
    setToolKey("pencil");
    setSelectedAsset(null);
    pushTool(paintToolFor("pencil", next));
  }

  // Switches which of the three authored collections (terrain / elements / events) the tools act on.
  // A mode owns a collection, so a tool left over from the previous mode would either be silently
  // dropped by `toolAllowedInMode` or, worse, keep looking selected while doing nothing — so every
  // ACTUAL mode change also resets the active tool to that mode's own default: Field always re-arms
  // the pencil; Element re-arms the last selected decoration if one exists, else falls back to select
  // (there is no canonical "first" decoration to default to); Event re-arms the event tool with its
  // current kind/graphic/species/radius — the same push `selectEvents` used to do before Event became
  // a mode instead of a toolbar toggle.
  //
  // "Actual" matters: the segmented control's own clicks never re-fire for the already-active segment
  // (Base UI swallows a repeat-click), but the `1`/`2`/`3` shortcuts and the Mode menu items call this
  // unconditionally, so re-selecting the mode the user is already in must not disturb whatever tool
  // they had picked inside it. Compared against `mode` — the committed React state that is also what
  // the toolbar/menu render as the current selection — not `pendingModeRef`, which exists solely so
  // the async stage-open `.then()` above can read the latest mode past its own stale effect-closure;
  // it is written in lockstep with `mode` by this very function, so it carries no extra information
  // for an equality check and reusing it here would just restate what this call is about to write.
  function selectMode(nextMode: EditorMode): void {
    const changed = nextMode !== mode;
    pendingModeRef.current = nextMode;
    setActiveMode(nextMode);
    handleRef.current?.setActiveMode(nextMode);
    if (!changed) return;
    if (nextMode === "field") {
      selectTool("pencil");
      return;
    }
    if (nextMode === "element") {
      if (selectedAsset) {
        setToolKey(null);
        pushTool({ kind: "element", assetId: selectedAsset });
      } else {
        selectTool("select");
      }
      return;
    }
    setToolKey("event");
    setSelectedAsset(null);
    pushTool(eventToolFor(eventKind, pendingEventGraphic, markerSpecies, markerRadius));
  }

  function toggleGrid(): void {
    setShowGrid((current) => {
      const next = !current;
      pendingGridRef.current = next;
      handleRef.current?.setGrid(next);
      return next;
    });
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

  // The map save itself, ungated: writes the stage's current map to D1. Both the direct path and the
  // first-save popup's continuation land here so there is one definition of "persist this map".
  async function doSaveMap(): Promise<void> {
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

  // The save entry point (⌘S and the menu/toolbar Save): on an unnamed fresh adventure it opens the
  // first-save name popup instead of saving; the popup's Confirm continues into `doSaveMap`.
  async function save(): Promise<void> {
    if (stageStatus !== "ready") return;
    if (titleUntouched) {
      setFirstSaveOpen(true);
      return;
    }
    await doSaveMap();
  }

  // First-save popup Confirm: persist the confirmed title through the adventure PUT, drop the unnamed
  // flag, then continue the pending map save. The graph is built from the current draft's bound links
  // directly (the adventure was born valid, so this is a title-only change over a complete graph). A
  // PUT failure leaves the popup's abort semantics intact: nothing partial is claimed as saved.
  async function confirmFirstSave(title: string): Promise<void> {
    const current = useUiStore.getState().adventureEditorSession;
    if (!current) {
      setFirstSaveOpen(false);
      return;
    }
    const draft = current.draft;
    const input: AdventureInput = {
      title,
      maxPlayers: draft.maxPlayers,
      graph: {
        start: draft.start,
        links: draft.bindings.flatMap((binding) =>
          binding.dest === null
            ? []
            : [{ mapId: binding.mapId, exitId: binding.exitId, dest: binding.dest }],
        ),
      },
      registry: draft.registry,
    };
    setError(null);
    try {
      await updateAdventureApi(adventureId, input);
    } catch (caught) {
      fail(caught);
      return;
    }
    setSession({ ...current, draft: { ...draft, title }, titleUntouched: false });
    setTitleUntouched(false);
    setFirstSaveOpen(false);
    await doSaveMap();
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

  // Reload the editor session from the server so the draft's members (and thus the start indicator
  // and the settings dialog's bindings) reflect maps just created, deleted or re-marked. Best-effort:
  // a failure here never blocks the map edit that triggered it.
  function refreshSession(): void {
    void (async () => {
      try {
        setSession(await loadAdventureSession(adventureId));
      } catch (caught) {
        const code = errorCode(caught);
        if (isSessionError(code)) setScreen("auth");
      }
    })();
  }

  // The Cartes-panel start affordance (UX wave #6): make `mapId` the graph start via its first entry,
  // and persist through the adventure PUT. The default map always has an entry; a map with none is
  // refused with the "maps" code rather than writing a start the server would reject.
  function setStartMap(mapId: string): void {
    const current = useUiStore.getState().adventureEditorSession;
    if (!current) return;
    const member = current.draft.members.find((candidate) => candidate.mapId === mapId);
    const entryId = member?.entryIds[0];
    if (!member || entryId === undefined) {
      setError("adventure_maps");
      return;
    }
    const nextDraft = setStart(current.draft, mapId, entryId);
    if (!nextDraft) return;
    setSession({ ...current, draft: nextDraft });
    // Persist the start (with its entry binding) through the adventure PUT. The graph is built from
    // the draft's bound links directly rather than via `toAdventureInput`, whose completeness gate is
    // stricter than the server: the server allows a map that is no longer reachable from the moved
    // start, so a start change on an otherwise-valid graph is not blocked client-side. The server
    // remains the validation authority — an unbound exit still comes back as an error.
    const input: AdventureInput = {
      title: nextDraft.title.trim(),
      maxPlayers: nextDraft.maxPlayers,
      graph: {
        start: { mapId, entryId },
        links: nextDraft.bindings.flatMap((binding) =>
          binding.dest === null
            ? []
            : [{ mapId: binding.mapId, exitId: binding.exitId, dest: binding.dest }],
        ),
      },
      registry: nextDraft.registry,
    };
    setError(null);
    void (async () => {
      try {
        await updateAdventureApi(adventureId, input);
        setSession(await loadAdventureSession(adventureId));
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
    refreshSession();
  }

  // The open map was deleted from the panel: fall back to the author's first remaining map, or an
  // empty stage if none is left.
  function activeMapDeleted(): void {
    setMapsRefreshNonce((n) => n + 1);
    refreshSession();
    void (async () => {
      try {
        const first = adventureId ? (await fetchMaps(adventureId))[0] : undefined;
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
    // Clear the session; the next editor open bootstraps a fresh opening adventure (UX wave #15).
    setSession(null);
    setScreen("parties");
  }

  // ⌘S save, ⌘Z/⇧⌘Z undo/redo, 1/2/3 mode (field/element/event), P/R/F/E/S tools, G grid — dispatched straight to
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
    if (
      newMapOpen ||
      confirmDeleteId !== null ||
      settingsOpen ||
      databaseOpen ||
      loadOpen ||
      openEventId !== null ||
      firstSaveOpen
    )
      return;
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
    // Enter opens the dialog of the selected event — the keyboard twin of a stage double-click.
    if (key === "enter") {
      if (selection?.kind === "event") {
        event.preventDefault();
        setOpenEventId(selection.id);
      }
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    switch (key) {
      case "1":
        selectMode("field");
        return;
      case "2":
        selectMode("element");
        return;
      case "3":
        selectMode("event");
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
    if (
      newMapOpen ||
      confirmDeleteId !== null ||
      settingsOpen ||
      databaseOpen ||
      loadOpen ||
      firstSaveOpen
    )
      return;
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

  const cursorText = cursor ? `(${cursor.col}, ${cursor.row})` : "(—, —)";

  // The live map the inspector reads its selected marker's fields off — the handle's current edits
  // while a stage is mounted, else whatever payload is loaded. Read in render so a new selection
  // reflects the latest positions.
  const currentMap: EditorMap | null =
    handleRef.current?.current() ?? editedRef.current ?? (map ? toEditorMap(map) : null);

  // The dialog seed: a detached draft of the open event, read off the live handle. `null` closes the
  // dialog (no open id, or the id no longer names a live event — e.g. it was just deleted).
  const eventDraft: MapEvent | null =
    openEventId !== null ? (handleRef.current?.beginEventDraft(openEventId) ?? null) : null;

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
        canUndo={canUndo && stageStatus === "ready"}
        canRedo={canRedo && stageStatus === "ready"}
        showGrid={showGrid}
        showDim={showDim}
        onExit={() => exit()}
        onOpenLoad={() => setLoadOpen(true)}
        onNewMap={() => setNewMapOpen(true)}
        onSave={() => void save()}
        onDeleteMap={() => setConfirmDeleteId(map?.id ?? null)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenDatabase={() => setDatabaseOpen(true)}
        onUndo={undo}
        onRedo={redo}
        onSelectMode={selectMode}
        onSelectTool={selectTool}
        onToggleGrid={toggleGrid}
        onToggleDim={toggleDim}
        onSetZoom={setZoom}
        onTest={test}
      />

      <EditorToolbar
        activeTool={isPaintToolKey(toolKey) ? toolKey : null}
        mode={mode}
        showGrid={showGrid}
        showDim={showDim}
        zoom={zoom}
        canSave={stageStatus === "ready"}
        onNewMap={() => setNewMapOpen(true)}
        onSave={() => void save()}
        onDeleteMap={() => setConfirmDeleteId(map?.id ?? null)}
        onSelectTool={selectTool}
        onSelectMode={selectMode}
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
          <EditorPalette
            mode={mode}
            field={{
              content,
              terrainActive: toolKey === "pencil" || toolKey === "rect" || toolKey === "fill",
              fillActive: toolKey === "fill",
              stairsActive: toolKey === "stairs",
              spawnActive: toolKey === "spawn",
              onPickContent: pickContent,
              onSelectStairs: () => selectTool("stairs"),
              onSelectSpawn: selectSpawn,
            }}
            element={{
              selectedAsset,
              elementCount,
              onSelectAsset: selectAsset,
            }}
            event={{
              eventKind,
              pendingEventGraphic,
              markerSpecies,
              markerRadius,
              onSelectEventKind: selectEventKind,
              onSelectEventGraphic: selectEventGraphic,
              onMarkerSpeciesChange: setMarkerSpecies,
              onMarkerRadiusChange: setMarkerRadius,
            }}
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
                <SelectionInspector
                  selection={selection}
                  map={currentMap}
                  onMove={(col, row) => handleRef.current?.moveSelected(col, row)}
                  onOpenEditor={() => {
                    if (selection.kind === "event") setOpenEventId(selection.id);
                  }}
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
            adventureId={adventureId}
            activeMapId={map?.id ?? null}
            startMapId={startMapId}
            startableMapIds={startableMapIds}
            dirty={dirty}
            refreshNonce={mapsRefreshNonce}
            newMapOpen={newMapOpen}
            onNewMapOpenChange={setNewMapOpen}
            confirmDeleteId={confirmDeleteId}
            onConfirmDeleteIdChange={setConfirmDeleteId}
            onRequestOpen={loadMap}
            onOpenPayload={openPayload}
            onActiveDeleted={activeMapDeleted}
            onSetStart={setStartMap}
            onOpenSettings={() => setSettingsOpen(true)}
            onError={(code) => setError(code === "" ? null : code)}
            onSessionExpired={() => setScreen("auth")}
          />
        </ResizablePanel>
      </ResizablePanelGroup>

      <AdventureSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onSaved={() => {
          // A settings save is an explicit adventure save that includes the title, so it counts as
          // the name being confirmed: the first-save popup must not fire afterwards (UX wave #14).
          setTitleUntouched(false);
          setMapsRefreshNonce((n) => n + 1);
          refreshSession();
        }}
        onSessionExpired={() => setScreen("auth")}
      />

      <FirstSaveDialog
        key={`${adventureId}:${firstSaveOpen}`}
        open={firstSaveOpen}
        defaultTitle={draftTitle}
        onConfirm={(title) => void confirmFirstSave(title)}
        onCancel={() => setFirstSaveOpen(false)}
      />

      <RegistryDialog
        open={databaseOpen}
        onOpenChange={setDatabaseOpen}
        onSessionExpired={() => setScreen("auth")}
      />

      <LoadAdventureDialog
        open={loadOpen}
        onOpenChange={setLoadOpen}
        onPick={loadAdventure}
        onSessionExpired={() => setScreen("auth")}
      />

      {eventDraft && (
        <EventDialog
          key={eventDraft.id}
          event={eventDraft}
          registry={registry}
          maps={teleportMaps}
          onCommit={(draft) => {
            handleRef.current?.commitEventDraft(draft);
            setOpenEventId(null);
          }}
          onDelete={() => {
            if (openEventId) handleRef.current?.deleteEvent(openEventId);
            setOpenEventId(null);
          }}
          onCancel={() => setOpenEventId(null)}
        />
      )}

      <EditorStatusBar
        mapName={map?.name ?? "—"}
        cols={map?.cols ?? 0}
        rows={map?.rows ?? 0}
        cursor={cursorText}
        saved={map !== null && !dirty && stageStatus === "ready"}
        mode={mode}
        toolLabel={toolLabel}
        zoom={zoom}
      />
    </div>
  );
}

/** The wireframe's `EV{ordinal}` display id, zero-padded to three digits — the friendly label for an
 *  event in the inspector. Identity is the uuid; this is display only. */
function eventDisplayId(ordinal: number): string {
  return `EV${String(ordinal).padStart(3, "0")}`;
}

/**
 * The selection inspector: the cell of the selected event/scenery/spawn, with move, delete, and — for
 * an event — its kind, its `EV{ordinal}` id and an "open editor" button (markers are dead, so the
 * former entry/exit/monster inspectors fold into the event's own kind-aware block; the kind-specific
 * fields themselves are edited in the event dialog). Stock shadcn; the hero spawn is move-only (it
 * cannot be deleted). Everything is pushed straight through the stage handle.
 */
function SelectionInspector({
  selection,
  map,
  onMove,
  onOpenEditor,
  onDelete,
}: {
  selection: EditorSelection;
  map: EditorMap;
  onMove(col: number, row: number): void;
  onOpenEditor(): void;
  onDelete(): void;
}) {
  useLocale();
  const selectedEvent =
    selection.kind === "event" ? map.events.find((event) => event.id === selection.id) : undefined;
  const selectedElement =
    selection.kind === "element"
      ? map.elements.find(
          (element) => element.col === selection.col && element.row === selection.row,
        )
      : undefined;
  const position =
    selectedEvent ?? selectedElement ?? (selection.kind === "spawn" ? map.spawn : undefined);

  // An event's inspector title reflects its kind (Entry/Exit/Monster spawn/Event), reusing the same
  // labels the former marker inspectors used; scenery and the hero spawn keep their own titles.
  const titleKey =
    selectedEvent && selectedEvent.kind !== "normal"
      ? (`editor.inspector.${selectedEvent.kind}` as const)
      : (`editor.inspector.${selection.kind}` as const);

  return (
    <aside
      className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-3 shadow-lg"
      aria-label={t("editor.inspector.title")}
    >
      <p className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
        {t(titleKey)}
      </p>

      {selectedEvent && (
        <>
          <p className="text-[11px] text-zinc-500">
            {t("editor.inspector.id")}: <code>{eventDisplayId(selectedEvent.ordinal)}</code>
            {selectedEvent.name ? ` · ${selectedEvent.name}` : ""}
          </p>
          <Button variant="outline" size="sm" onClick={onOpenEditor}>
            {t("editor.inspector.openEditor")}
          </Button>
        </>
      )}

      {selectedElement && (
        <p className="text-[11px] text-zinc-500">
          {selectedElement.assetId}
          {editorAsset(selectedElement.assetId)?.editor.collider
            ? ` · ${t("editor.palette.collision")}`
            : ` · ${t("editor.inspector.walkable")}`}
        </p>
      )}

      {position && (
        <div className="flex gap-2">
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor="inspector-col" className="text-[11px] text-zinc-500">
              {t("editor.cols")}
            </Label>
            <Input
              id="inspector-col"
              key={`col:${position.col},${position.row}`}
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
              key={`row:${position.col},${position.row}`}
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
