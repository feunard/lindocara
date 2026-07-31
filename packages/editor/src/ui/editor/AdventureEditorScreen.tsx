import {
  type AdventureDraft,
  type DraftMemberInfo,
  refreshMember,
  toAdventureInput,
} from "@lindocara/client/adventure-draft.js";
import {
  ApiError,
  authErrorText,
  createAdventureTestSessionApi,
  deleteAdventureTestSessionApi,
  errorCode,
  fetchMap,
  fetchMaps,
  type MapPayload,
  updateMapApi,
} from "@lindocara/client/api.js";
import { t, useLocale } from "@lindocara/client/i18n.js";
import {
  activePartyAtom,
  adventureEditorSessionAtom,
  adventureTestSessionAtom,
} from "@lindocara/client/state/atoms.js";
import { type AdventureRegistry, EMPTY_REGISTRY } from "@lindocara/engine/adventure-state.js";
import { EMPTY_MAP_AUDIO } from "@lindocara/engine/audio-catalog.js";
import type { EventPreset } from "@lindocara/engine/event-presets.js";
import type { MonsterSpecies } from "@lindocara/engine/game.js";
import { EMPTY_MARKERS, type MapData, sameElementSlot } from "@lindocara/engine/map-data.js";
import {
  type EventKind,
  entryEvents,
  exitEvents,
  type MapEvent,
  monsterEvents,
} from "@lindocara/engine/map-events.js";
import type { QuestDiagnostic } from "@lindocara/engine/quests.js";
import type { StairsDirection, StairsLowLevel } from "@lindocara/engine/tile-brush.js";
import { type EditorAssetId, editorAsset } from "@lindocara/engine/tiny-swords-catalog.js";
import { Button } from "@lindocara/ui/components/button.js";
import { Input } from "@lindocara/ui/components/input.js";
import { Label } from "@lindocara/ui/components/label.js";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@lindocara/ui/components/resizable.js";
import { TooltipProvider } from "@lindocara/ui/components/tooltip.js";
import { useAlepha, useStore } from "alepha/react";
import { useRouter } from "alepha/react/router";
import {
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type EditorMap,
  type EditorMode,
  type EditorSelection,
  type EditorTool,
  editorLayersFromPayload,
  type RectFillContent,
  solidMaskFromMapPayload,
  toMapData,
  toSaveInput,
} from "../../game/editor-state.js";
import {
  defaultDimForMode,
  type MapEditorStageHandle,
  openMapEditorStage,
} from "../../game/map-editor-stage.js";
import { startMapPreview } from "../../game/map-preview.js";
import { AdventurePickerScreen } from "./AdventurePickerScreen.js";
import { AdventureSettingsDialog } from "./AdventureSettingsDialog.js";
import { AdventureTestDialog, type AdventureTestOptions } from "./AdventureTestDialog.js";
import { loadAdventureSession } from "./adventure-session.js";
import { assetDisplayName, EditorAssetPreview } from "./CatalogueAssetPicker.js";
import { EditorHelpDialog, type EditorHelpSection } from "./EditorHelpDialog.js";
import { EditorMenuBar } from "./EditorMenuBar.js";
import { EditorPalette } from "./EditorPalette.js";
import { EditorStatusBar } from "./EditorStatusBar.js";
import { type EditorPaintTool, EditorToolbar, toolLabelText } from "./EditorToolbar.js";
import { EventDialog } from "./EventDialog.js";
import { PRESET_LABEL } from "./EventPalette.js";
import { FirstSaveDialog } from "./FirstSaveDialog.js";
import { LoadAdventureDialog } from "./LoadAdventureDialog.js";
import { MapAudioDialog } from "./MapAudioDialog.js";
import { MapListPanel } from "./MapListPanel.js";
import { ObjectBindingDialog } from "./ObjectBindingDialog.js";
import { QuestWorkspaceDialog } from "./QuestWorkspaceDialog.js";
import { bindQuestTarget, type QuestMapCatalog } from "./quest-editor-model.js";
import { RegistryDialog } from "./RegistryDialog.js";

/** The default terrain a fresh stroke paints with until the Task 9 terrain palette lands: flat grass,
 *  matching the stage's own default tool so what the toolbar shows and what the stage paints agree. */
const DEFAULT_CONTENT: RectFillContent = { kind: "block", block: "grass" };
const DEFAULT_STAIRS: Readonly<{
  direction: StairsDirection;
  lowLevel: StairsLowLevel;
}> = { direction: "east", lowLevel: 0 };

type StageStatus = "loading" | "empty" | "ready" | "error";
/** The active tool key. `stairs`, the hero-spawn tool, scenery and `event` have no toolbar button —
 *  they are picked in the palette or the EV slot — so the toolbar highlights only its six canvas
 *  tools. */
type ToolKey = EditorPaintTool | "stairs" | "spawn" | "event";

function isPaintToolKey(key: ToolKey | null): key is EditorPaintTool {
  return (
    key === "select" ||
    key === "pan" ||
    key === "pencil" ||
    key === "rect" ||
    key === "fill" ||
    key === "eraser"
  );
}

/** The event `EditorTool` for the current EV kind. A `normal` placement carries its PRESET (D13) and
 *  the current map's uuid (the teleporter preset's same-map destination default); a `monster` carries
 *  its species/radius. Markers are dead — every entry/exit/monster is an event now, chosen by
 *  `eventKind` on the one event tool. */
function eventToolFor(
  eventKind: EventKind,
  preset: EventPreset,
  species: MonsterSpecies,
  patrolRadius: number,
  selfMapId: string | null,
): EditorTool {
  if (eventKind === "monster") return { kind: "event", eventKind, species, patrolRadius };
  if (eventKind === "guard" || eventKind === "npc")
    return { kind: "event", eventKind, patrolRadius };
  if (eventKind === "normal") {
    // A preset placement names itself, in the author's language, so the event list distinguishes the
    // five presets. `raw` stays unnamed: it IS the generic custom event, and the list's own kind
    // fallback already says so — naming it would only freeze that label against a later rename.
    const named = preset === "raw" ? {} : { presetName: t(PRESET_LABEL[preset]) };
    return selfMapId === null
      ? { kind: "event", eventKind, preset, ...named }
      : { kind: "event", eventKind, preset, selfMapId, ...named };
  }
  return { kind: "event", eventKind };
}

/**
 * The two `requireSession` codes that mean "log in again", never "this map request failed". The
 * client's global 401 seam (`packages/client/src/api.ts`'s `api()` helper, `state/navigation.ts`'s
 * `onUnauthorized`) already navigates to `/auth` for both — this file's own catch blocks check it
 * only to SKIP surfacing a redundant local error while that redirect is already in flight, never to
 * navigate themselves.
 */
function isSessionError(code: string): boolean {
  return code === "session_expired" || code === "unauthorized";
}

function toEditorMap(map: MapPayload): EditorMap {
  return {
    name: map.name,
    audio: map.audio ?? EMPTY_MAP_AUDIO,
    layers: editorLayersFromPayload(map),
    elements: map.elements,
    spawn: map.spawn,
    // Markers are QUARANTINED (UX wave #12): the editor ignores whatever a (legacy) payload still
    // carries and never authors one, so it opens with `EMPTY_MARKERS` and saves the same.
    markers: EMPTY_MARKERS,
    events: map.events ?? [],
  };
}

/** Draft-facing facts from the exact in-memory map being saved. This is the bridge that lets a new
 * entry/exit id and its graph binding be validated and committed in the same server transaction. */
function memberInfoFromEditor(mapId: string, revision: number, edited: EditorMap): DraftMemberInfo {
  const entries = entryEvents(edited.events);
  const exits = exitEvents(edited.events);
  const labels = (events: readonly { id: string; name: string }[]) =>
    Object.fromEntries(events.flatMap((event) => (event.name ? [[event.id, event.name]] : [])));
  return {
    mapId,
    name: edited.name,
    revision,
    solid: solidMaskFromMapPayload(toMapData(edited)),
    monsterCount: monsterEvents(edited.events).length,
    entryIds: entries.map((event) => event.id),
    exitIds: exits.map((event) => event.id),
    entryLabels: labels(entries),
    exitLabels: labels(exits),
  };
}

/** The single EditorTool a toolbar/palette selection resolves to. Terrain content composes into
 *  pencil (single cell), rect and fill exactly as the pre-merge editor's paint path did. */
function paintToolFor(
  key: EditorPaintTool | "stairs",
  content: RectFillContent,
  stairs = DEFAULT_STAIRS,
): EditorTool {
  switch (key) {
    case "select":
      return { kind: "select" };
    case "pan":
      return { kind: "pan" };
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
      return { kind: "stairs", direction: stairs.direction, lowLevel: stairs.lowLevel };
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
  const [session] = useStore(adventureEditorSessionAtom);
  if (session?.adventureId) {
    return <AdventureEditorInner key={session.adventureId} adventureId={session.adventureId} />;
  }
  return <AdventurePickerScreen />;
}

function AdventureEditorInner({ adventureId }: { adventureId: string }) {
  useLocale();
  const router = useRouter();
  const alepha = useAlepha();
  const [session, setSession] = useStore(adventureEditorSessionAtom);
  const [, setAdventureTestSession] = useStore(adventureTestSessionAtom);
  const [, setActiveParty] = useStore(activePartyAtom);
  // The switch/variable registry rides the loaded adventure session's draft. When no adventure is
  // loaded (the common map-first case) it is empty, which falls the event dialog's condition pickers
  // back to free text. Loading an adventure in the database dialog fills it.
  const registry: AdventureRegistry = session?.draft.registry ?? EMPTY_REGISTRY;
  // The adventure's member maps, used to offer a `teleport` command its destinations (below).
  const draftMembers = session?.draft.members;
  // The first-save popup prefills with the adventure's current (default) title.
  const draftTitle = session?.draft.title ?? "";
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
  // State alone cannot fence two clicks in the same React turn. This synchronous twin closes that
  // window before `setSavingMap(true)` has rendered, so one map revision can never be PUT twice by
  // a rapid shortcut/button sequence.
  const savingMapRef = useRef(false);
  // Async map/session reads can finish out of order. Only the newest generation may install its
  // response; opening/creating/deleting a map increments the same counter to invalidate older work.
  const mapLoadGenerationRef = useRef(0);
  const sessionLoadGenerationRef = useRef(0);
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
  // Mirrors `showCollisions` (D18), off by default, for the same reason `pendingGridRef` mirrors
  // `showGrid`: a toggle pressed while the stage is still opening must be installed by the resolving
  // `.then`, not lost.
  const pendingCollisionsRef = useRef(false);
  // The live edits captured when Tester is pressed, carried across the preview round-trip so the
  // stage reopens from them rather than the pristine payload.
  const editedRef = useRef<EditorMap | null>(null);
  const autoOpened = useRef(false);
  // The keyboard-shortcut host: shortcuts are bound here, never on `document`, so no other screen's
  // typing risks being intercepted. It needs `tabIndex={-1}` to be programmatically focusable — see
  // the focus effect below.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pendingTestOptionsRef = useRef<AdventureTestOptions | null>(null);

  const [map, setMap] = useState<MapPayload | null>(null);
  const [toolKey, setToolKey] = useState<ToolKey | null>("pencil");
  const [content, setContent] = useState<RectFillContent>(DEFAULT_CONTENT);
  const [stairsDirection, setStairsDirection] = useState<StairsDirection>(DEFAULT_STAIRS.direction);
  const [stairsLowLevel, setStairsLowLevel] = useState<StairsLowLevel>(DEFAULT_STAIRS.lowLevel);
  const [selectedAsset, setSelectedAsset] = useState<EditorAssetId | null>(null);
  const [mode, setActiveMode] = useState<EditorMode>("field");
  const [showGrid, setShowGrid] = useState(true);
  const [showDim, setShowDim] = useState(false);
  // D18: the collision-visualisation overlay toggle. Off by default so a fresh editor looks exactly
  // as it did before this overlay existed.
  const [showCollisions, setShowCollisions] = useState(false);
  const [cursor, setCursor] = useState<{ col: number; row: number } | null>(null);
  const [zoom, setZoomState] = useState(100);
  const [elementCount, setElementCount] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [savingMap, setSavingMap] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [selection, setSelection] = useState<EditorSelection | null>(null);
  // C7: a brief "can't place here" hint over the stage. Driven by the stage's monotone
  // `placementRejectedAt` counter rather than a boolean, so retrying the same illegal cell while the
  // previous hint is still fading restarts its timer instead of silently doing nothing.
  const [placementHint, setPlacementHint] = useState(false);
  const lastRejectionRef = useRef<number | null>(null);
  const placementHintTimeoutRef = useRef<number | null>(null);
  // The kind the EV tool places (normal / entry / exit / monster), and the monster kind's default
  // species/radius. Markers are dead — these drive the one event tool's placement.
  const [eventKind, setEventKind] = useState<EventKind>("normal");
  // The preset a `normal` placement uses (D13): `raw` is the blank scripted event, the default.
  const [eventPreset, setEventPreset] = useState<EventPreset>("raw");
  const [markerSpecies, setMarkerSpecies] = useState<MonsterSpecies>("spear_goblin");
  const [markerRadius, setMarkerRadius] = useState(96);
  const [stageStatus, setStageStatus] = useState<StageStatus>("loading");
  const [stageEpoch, setStageEpoch] = useState(0);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Right-pane / dialog coordination, lifted here so the menu bar, toolbar and map panel all reach
  // the same new-map dialog, delete confirm and settings dialog.
  const [newMapOpen, setNewMapOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mapAudioOpen, setMapAudioOpen] = useState(false);
  const [questWorkspaceOpen, setQuestWorkspaceOpen] = useState(false);
  const [databaseOpen, setDatabaseOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpSection, setHelpSection] = useState<EditorHelpSection>("start");
  const [testOpen, setTestOpen] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [testDiagnostics, setTestDiagnostics] = useState<readonly QuestDiagnostic[]>([]);
  // UX wave #15: the "Load an adventure" dialog, reached from File → « Charger une aventure ».
  const [loadOpen, setLoadOpen] = useState(false);
  // UX wave #14: a freshly created adventure is born with the default title, so its first explicit
  // save must prompt for the real name. Seeded once (this component is keyed by adventureId, so a new
  // adventure remounts it) from the picker's `titleUntouched` flag, then kept in local state so no
  // session reload (map/graph refreshes rebuild the session without the flag) can lose it. Cleared on
  // the first-save confirm and whenever the settings dialog saves — both are explicit namings.
  const [titleUntouched, setTitleUntouched] = useState(() => session?.titleUntouched ?? false);
  const [firstSaveOpen, setFirstSaveOpen] = useState(false);
  // The event whose dialog is open, keyed by uuid. Set by a stage double-click (`onOpenEvent`) or by
  // pressing Enter on a selected event; cleared on save/delete/cancel.
  const [openEventId, setOpenEventId] = useState<string | null>(null);
  const [bindingSelection, setBindingSelection] = useState<Extract<
    EditorSelection,
    { kind: "element" }
  > | null>(null);
  // Bumped after every save/create so the map panel refetches names and dimensions.
  const [mapsRefreshNonce, setMapsRefreshNonce] = useState(0);

  function openHelp(section: EditorHelpSection = "start"): void {
    setHelpSection(section);
    setHelpOpen(true);
  }

  const fail = useCallback((caught: unknown): void => {
    const code = errorCode(caught);
    if (isSessionError(code)) return;
    setError(code);
  }, []);

  // Load a different adventure (UX wave #15), from the File → « Charger une aventure » dialog. Guard
  // unsaved edits first, then swap the session — a new adventureId remounts this component (it is
  // keyed by it), resetting every room-local editor state cleanly.
  function loadAdventure(id: string): void {
    if (savingMapRef.current) return;
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
    const generation = ++mapLoadGenerationRef.current;
    void (async () => {
      try {
        // No adventure loaded means no maps to open — a first-class empty state, not an error.
        if (!adventureId) {
          if (generation === mapLoadGenerationRef.current) setStageStatus("empty");
          return;
        }
        const list = await fetchMaps(adventureId);
        const first = list[0];
        // A fresh adventure has zero maps: that is a first-class empty state, not an error. Leave
        // `map` null (no stage opened) and let the centre invite a first map; the maps panel already
        // renders its own empty list with a New-map affordance.
        if (first) {
          const payload = await fetchMap(first.id);
          if (generation === mapLoadGenerationRef.current) setMap(payload);
        } else if (generation === mapLoadGenerationRef.current) setStageStatus("empty");
      } catch (caught) {
        if (generation === mapLoadGenerationRef.current) fail(caught);
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
        editedRef.current = changed;
        setError(null);
        setElementCount(changed.elements.length);
        setDirty(state.dirty);
        setCanUndo(state.canUndo);
        setCanRedo(state.canRedo);
        setSelection(state.selection);
        // C7: a new rejection count flashes the "can't place here" hint, restarting its timer even
        // if the previous flash is still fading (see the `placementHint` state declaration above).
        const rejectedAt = state.placementRejectedAt ?? null;
        if (rejectedAt !== null && rejectedAt !== lastRejectionRef.current) {
          lastRejectionRef.current = rejectedAt;
          setPlacementHint(true);
          if (placementHintTimeoutRef.current !== null) {
            window.clearTimeout(placementHintTimeoutRef.current);
          }
          placementHintTimeoutRef.current = window.setTimeout(() => {
            setPlacementHint(false);
            placementHintTimeoutRef.current = null;
          }, 1400);
        }
      },
      (col, row) => setCursor(col === null || row === null ? null : { col, row }),
      (target: EditorSelection | string) => {
        // Keep compatibility with the former callback shape used by older stage mocks.
        if (typeof target === "string") setOpenEventId(target);
        else if (target.kind === "event") setOpenEventId(target.id);
        else if (target.kind === "element") setBindingSelection(target);
      },
      (percent) => setZoomState(percent),
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
        handle.setCollisions(pendingCollisionsRef.current);
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
      if (placementHintTimeoutRef.current !== null) {
        window.clearTimeout(placementHintTimeoutRef.current);
        placementHintTimeoutRef.current = null;
      }
    };
  }, [map?.id, previewing, stageEpoch]);

  // The sandbox walk. Only while previewing; Esc ends it, which reopens the editor with edits intact.
  useEffect(() => {
    if (!previewing) return;
    const edited = editedRef.current;
    if (!edited) return;
    const data: MapData = toMapData(edited);
    let stopped = false;
    let preview: { stop(): void } | null = null;
    // Events ride alongside the terrain: the preview draws the authored NPCs and monsters at rest
    // so an author can judge scale and composition without launching a party.
    void startMapPreview(data, edited.events)
      .then((started) => {
        if (stopped) {
          started.stop();
          return;
        }
        preview = started;
      })
      .catch((caught) => {
        if (!stopped) {
          setPreviewing(false);
          fail(caught);
        }
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
  }, [previewing, fail]);

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

  // Monster and guard event kinds bundle their tuning into the pushed tool, so a palette edit while
  // either is active must re-push it before the next placement.
  useEffect(() => {
    if (toolKey !== "event" || (eventKind !== "monster" && eventKind !== "guard")) return;
    const tool: EditorTool =
      eventKind === "monster"
        ? {
            kind: "event",
            eventKind: "monster",
            species: markerSpecies,
            patrolRadius: markerRadius,
          }
        : { kind: "event", eventKind: "guard", patrolRadius: markerRadius };
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
    pushTool(paintToolFor(key, next, { direction: stairsDirection, lowLevel: stairsLowLevel }));
  }

  function chooseStairsDirection(direction: StairsDirection): void {
    setStairsDirection(direction);
    setToolKey("stairs");
    setSelectedAsset(null);
    pushTool(paintToolFor("stairs", content, { direction, lowLevel: stairsLowLevel }));
  }

  function chooseStairsLowLevel(lowLevel: StairsLowLevel): void {
    setStairsLowLevel(lowLevel);
    setToolKey("stairs");
    setSelectedAsset(null);
    pushTool(paintToolFor("stairs", content, { direction: stairsDirection, lowLevel }));
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

  // The EV kind selector (entry/exit/monster): switch which kind the event tool places, re-pushing so
  // the very next placement is of the chosen kind (the monster re-push effect keeps species/radius
  // fresh too).
  function selectEventKind(kind: EventKind): void {
    setEventKind(kind);
    if (toolKey === "event") {
      pushTool(eventToolFor(kind, eventPreset, markerSpecies, markerRadius, map?.id ?? null));
    }
  }

  // The preset selector (D13): pick a popular scripted-event template. Every preset places a `normal`
  // event; re-push so the next placement uses the chosen preset.
  function selectEventPreset(preset: EventPreset): void {
    setEventKind("normal");
    setEventPreset(preset);
    if (toolKey === "event") {
      pushTool(eventToolFor("normal", preset, markerSpecies, markerRadius, map?.id ?? null));
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
    // D12: reapply the mode's default emphasis on every real mode change — dim ON in Element/Event so
    // the active plane pops, OFF in Field. The manual toggle still overrides it until the next switch.
    applyDim(defaultDimForMode(nextMode));
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
    pushTool(eventToolFor(eventKind, eventPreset, markerSpecies, markerRadius, map?.id ?? null));
  }

  function toggleGrid(): void {
    setShowGrid((current) => {
      const next = !current;
      pendingGridRef.current = next;
      handleRef.current?.setGrid(next);
      return next;
    });
  }

  // Push a dim state to React, the stage handle and the async-open ref in lockstep. Shared by the
  // manual toggle and by `selectMode`'s per-mode auto-default (D12).
  function applyDim(next: boolean): void {
    setShowDim(next);
    pendingDimRef.current = next;
    handleRef.current?.setDim(next);
  }

  function toggleDim(): void {
    applyDim(!showDim);
  }

  function toggleCollisions(): void {
    setShowCollisions((current) => {
      const next = !current;
      pendingCollisionsRef.current = next;
      handleRef.current?.setCollisions(next);
      return next;
    });
  }

  function setEditorZoom(percent: number): void {
    handleRef.current?.setZoom(percent);
  }

  function cycleZoom(): void {
    const stops = [50, 75, 100, 125, 150, 200] as const;
    const next = stops.find((stop) => stop > zoom) ?? stops[0];
    setEditorZoom(next);
  }

  function test(): void {
    if (stageStatus !== "ready") return;
    setTestError(null);
    setTestDiagnostics([]);
    setTestOpen(true);
  }

  function quickPreview(): void {
    const handle = handleRef.current;
    if (!handle) return;
    editedRef.current = handle.current();
    setTestOpen(false);
    setPreviewing(true);
  }

  async function launchAdventureTest(
    options: AdventureTestOptions,
    mapAlreadySaved = false,
  ): Promise<void> {
    if (!adventureId || testBusy) return;
    setTestBusy(true);
    setTestError(null);
    setTestDiagnostics([]);
    let createdSessionId: string | null = null;
    let releasedStage = false;
    try {
      if (!mapAlreadySaved && dirty) {
        const saved = await doSaveMap();
        if (!saved) return;
      }
      const testSession = await createAdventureTestSessionApi(adventureId, options);
      createdSessionId = testSession.id;
      setAdventureTestSession(testSession);
      setTestOpen(false);
      // Hand the one shared Pixi canvas over synchronously. If React unmounts the editor after the
      // game has already acquired/started that app, the editor effect cleanup would otherwise stop
      // the ticker again and strand the hero-loading overlay at 90% despite live server snapshots.
      handleRef.current?.dispose();
      handleRef.current = null;
      releasedStage = true;
      const { startGameAsHero } = await import("@lindocara/client/game/session.js");
      await startGameAsHero(testSession.hero, testSession.party);
    } catch (caught) {
      if (createdSessionId) {
        // A runtime/bootstrap failure must not leave an invisible disposable party behind. The TTL
        // remains a backstop if this best-effort cleanup itself cannot reach the server.
        try {
          await deleteAdventureTestSessionApi(createdSessionId);
        } catch {
          // Preserve the original launch error: it is the actionable failure shown to the creator.
        }
        setAdventureTestSession(null);
        setActiveParty(null);
      }
      if (releasedStage) setStageEpoch((current) => current + 1);
      const code = errorCode(caught);
      // The global 401 seam already navigates to /auth (see `isSessionError`'s docblock) — bail
      // without reopening the test dialog with a stale error while that redirect is in flight.
      if (isSessionError(code)) return;
      if (caught instanceof ApiError && code === "adventure_test_invalid") {
        const diagnostics = (caught.details as { diagnostics?: unknown } | null)?.diagnostics;
        if (Array.isArray(diagnostics)) setTestDiagnostics(diagnostics as QuestDiagnostic[]);
      }
      setTestError(authErrorText(code));
      setTestOpen(true);
    } finally {
      setTestBusy(false);
    }
  }

  function requestAdventureTest(options: AdventureTestOptions): void {
    if (titleUntouched) {
      pendingTestOptionsRef.current = options;
      setTestOpen(false);
      setFirstSaveOpen(true);
      return;
    }
    void launchAdventureTest(options);
  }

  function undo(): void {
    handleRef.current?.undo();
  }

  function redo(): void {
    handleRef.current?.redo();
  }

  // The map save itself, ungated: writes the stage's current map to D1. Both the direct path and the
  // first-save popup's continuation land here so there is one definition of "persist this map".
  async function doSaveMap(draftOverride?: AdventureDraft): Promise<AdventureDraft | null> {
    const handle = handleRef.current;
    if (!handle || !map || stageStatus !== "ready" || savingMapRef.current) return null;
    const savedSnapshot = handle.current();
    const savedMapId = map.id;
    const savedMapGeneration = mapLoadGenerationRef.current;
    savingMapRef.current = true;
    const currentSession = alepha.store.get(adventureEditorSessionAtom);
    const baseDraft = draftOverride ?? currentSession?.draft;
    const tracksCurrentMap = baseDraft?.members.some((member) => member.mapId === map.id) ?? false;
    const refreshed =
      baseDraft && tracksCurrentMap
        ? Array.isArray(savedSnapshot.events)
          ? refreshMember(baseDraft, memberInfoFromEditor(map.id, map.revision, savedSnapshot))
          : baseDraft
        : null;
    // The map save rides the adventure's shell (title/players/registry) atomically; it never carries a
    // graph now (the editor authors none), so the server preserves the stored graph untouched.
    const adventureInput = refreshed ? toAdventureInput(refreshed) : null;
    setError(null);
    setSavingMap(true);
    try {
      const updated = await updateMapApi(
        map.id,
        toSaveInput(savedSnapshot),
        adventureInput ?? undefined,
        map.revision,
      );
      // Edits made while the request was in flight remain dirty: `markSaved` receives the exact
      // captured snapshot, never `handle.current()` after the response. A later map load cannot be
      // overwritten by this response either.
      if (mapLoadGenerationRef.current === savedMapGeneration) handle.markSaved(savedSnapshot);
      setMap((current) => (current?.id === savedMapId ? { ...current, ...updated } : current));
      setMapsRefreshNonce((n) => n + 1);
      const latestSession = alepha.store.get(adventureEditorSessionAtom);
      // A direct map save merges only this member into the latest session so a metadata/registry
      // edit that landed during the network request is not rolled back by a stale captured draft.
      // A settings/first-save override is itself the metadata that the server atomically stored, so
      // it remains the authoritative base for that path.
      const mergeBase = draftOverride ? refreshed : (latestSession?.draft ?? refreshed);
      const savedDraft =
        mergeBase && Array.isArray(savedSnapshot.events)
          ? refreshMember(
              mergeBase,
              memberInfoFromEditor(savedMapId, updated.revision, savedSnapshot),
            )
          : mergeBase;
      if (latestSession && savedDraft) {
        setSession({
          ...latestSession,
          draft: savedDraft,
          invalidatedLinks: [],
          savedDraft: JSON.stringify(savedDraft),
        });
      }
      return savedDraft;
    } catch (caught) {
      // Settings owns the visible modal error surface. Let that caller translate/render the failure;
      // direct toolbar/shortcut saves still report through the editor shell here.
      if (draftOverride) throw caught;
      fail(caught);
      return null;
    } finally {
      savingMapRef.current = false;
      setSavingMap(false);
    }
  }

  // The save entry point (⌘S and the menu/toolbar Save): on an unnamed fresh adventure it opens the
  // first-save name popup instead of saving; the popup's Confirm continues into `doSaveMap`.
  async function save(): Promise<void> {
    if (stageStatus !== "ready" || savingMapRef.current) return;
    if (titleUntouched) {
      setFirstSaveOpen(true);
      return;
    }
    await doSaveMap();
  }

  // First-save popup Confirm: persist the confirmed title through the adventure PUT, drop the unnamed
  // flag, then continue the pending map save. This is a title-only change now — no graph rides the
  // PUT, so the server preserves the stored graph. A PUT failure leaves the popup's abort semantics
  // intact: nothing partial is claimed as saved.
  async function confirmFirstSave(title: string): Promise<void> {
    const current = alepha.store.get(adventureEditorSessionAtom);
    if (!current) {
      setFirstSaveOpen(false);
      return;
    }
    setError(null);
    // Title + map are one `/api/maps/:id` transaction. The old two-PUT sequence could persist the
    // title and then fail the map, despite presenting the action as one first save.
    let saved: AdventureDraft | null;
    try {
      saved = await doSaveMap({ ...current.draft, title });
    } catch (caught) {
      fail(caught);
      return;
    }
    if (!saved) return;
    const latest = alepha.store.get(adventureEditorSessionAtom);
    if (latest) setSession({ ...latest, draft: saved, titleUntouched: false });
    setTitleUntouched(false);
    setFirstSaveOpen(false);
    const pendingTest = pendingTestOptionsRef.current;
    pendingTestOptionsRef.current = null;
    if (pendingTest) void launchAdventureTest(pendingTest, true);
  }

  // The map panel's "select to switch" load path: guard unsaved edits, then swap the stage's map.
  function loadMap(id: string): void {
    if (savingMapRef.current) return;
    if (id === map?.id) return;
    if (dirty && !window.confirm(t("editor.shell.exit.confirm"))) return;
    const generation = ++mapLoadGenerationRef.current;
    setError(null);
    void (async () => {
      try {
        const payload = await fetchMap(id);
        if (generation !== mapLoadGenerationRef.current) return;
        editedRef.current = null;
        setMap(payload);
      } catch (caught) {
        if (generation === mapLoadGenerationRef.current) fail(caught);
      }
    })();
  }

  // Reload the editor session from the server so the draft's members reflect maps just created,
  // deleted or renamed. Best-effort: a failure here never blocks the map edit that triggered it.
  function refreshSession(): void {
    const generation = ++sessionLoadGenerationRef.current;
    void (async () => {
      try {
        const loaded = await loadAdventureSession(adventureId);
        if (generation !== sessionLoadGenerationRef.current) return;
        const current = alepha.store.get(adventureEditorSessionAtom);
        if (current?.adventureId !== adventureId) return;
        // A map-list refresh owns membership/names/revisions, not adventure metadata. Preserve the
        // latest successfully edited shell and registry so an older GET cannot roll them back.
        const mergedDraft: AdventureDraft = {
          ...loaded.draft,
          title: current.draft.title,
          maxPlayers: current.draft.maxPlayers,
          audio: current.draft.audio,
          registry: current.draft.registry,
        };
        setSession({
          ...loaded,
          draft: mergedDraft,
          savedDraft: JSON.stringify(mergedDraft),
          ...(current.titleUntouched === undefined
            ? {}
            : { titleUntouched: current.titleUntouched }),
        });
      } catch {
        // Best-effort refresh: swallow every failure, including a dead session — the global 401
        // seam already navigates to /auth on its own (see `isSessionError`'s docblock).
      }
    })();
  }

  // A freshly created or renamed-in-place map handed back by the panel: mount it in the stage.
  function openPayload(payload: MapPayload): void {
    ++mapLoadGenerationRef.current;
    editedRef.current = null;
    setMap(payload);
    setMapsRefreshNonce((n) => n + 1);
    refreshSession();
  }

  // The open map was deleted from the panel: fall back to the author's first remaining map, or an
  // empty stage if none is left.
  function activeMapDeleted(): void {
    const generation = ++mapLoadGenerationRef.current;
    setMapsRefreshNonce((n) => n + 1);
    refreshSession();
    void (async () => {
      try {
        const first = adventureId ? (await fetchMaps(adventureId))[0] : undefined;
        const payload = first ? await fetchMap(first.id) : null;
        if (generation !== mapLoadGenerationRef.current) return;
        editedRef.current = null;
        if (payload) setMap(payload);
        else {
          setMap(null);
          setStageStatus("empty");
        }
      } catch (caught) {
        if (generation === mapLoadGenerationRef.current) fail(caught);
      }
    })();
  }

  function exit(force = false): void {
    if (!force && savingMapRef.current) return;
    if (!force && dirty && !window.confirm(t("editor.shell.exit.confirm"))) {
      return;
    }
    // Clear the session; the next editor open bootstraps a fresh opening adventure (UX wave #15).
    setSession(null);
    void router.push("title");
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
    if (stageStatus !== "ready" || savingMap) return;
    if (
      newMapOpen ||
      confirmDeleteId !== null ||
      settingsOpen ||
      questWorkspaceOpen ||
      databaseOpen ||
      helpOpen ||
      testOpen ||
      loadOpen ||
      openEventId !== null ||
      bindingSelection !== null ||
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
    if ((event.metaKey || event.ctrlKey) && key === "s") {
      event.preventDefault();
      event.stopPropagation();
      void save();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && key === "z") {
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && key === "y") {
      event.preventDefault();
      event.stopPropagation();
      redo();
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
      case "m":
        selectTool("pan");
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
      questWorkspaceOpen ||
      databaseOpen ||
      helpOpen ||
      testOpen ||
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

  // The live map the inspector reads its selected marker's fields off — the handle's current edits
  // while a stage is mounted, else whatever payload is loaded. Read in render so a new selection
  // reflects the latest positions.
  const currentMap: EditorMap | null =
    handleRef.current?.current() ?? editedRef.current ?? (map ? toEditorMap(map) : null);
  const currentQuestMap: QuestMapCatalog | null =
    map && currentMap
      ? {
          mapId: map.id,
          name: currentMap.name,
          cols: map.cols,
          rows: map.rows,
          events: currentMap.events,
        }
      : null;

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
    // D16: one TooltipProvider for the whole shell, so every icon-only button's tooltip (toolbar,
    // menu bar, Cartes panel) shares the same hover/focus timing instead of each mounting its own.
    <TooltipProvider>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: shortcut-key host, not an interactive widget */}
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
          showCollisions={showCollisions}
          onExit={() => exit()}
          onOpenLoad={() => setLoadOpen(true)}
          onNewMap={() => setNewMapOpen(true)}
          onSave={() => void save()}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenQuests={() => setQuestWorkspaceOpen(true)}
          onOpenDatabase={() => setDatabaseOpen(true)}
          onOpenHelp={() => openHelp()}
          onUndo={undo}
          onRedo={redo}
          onSelectMode={selectMode}
          onSelectTool={selectTool}
          onToggleGrid={toggleGrid}
          onToggleDim={toggleDim}
          onToggleCollisions={toggleCollisions}
          onSetZoom={setEditorZoom}
          onTest={test}
        />

        <EditorToolbar
          activeTool={isPaintToolKey(toolKey) ? toolKey : null}
          mode={mode}
          showGrid={showGrid}
          showDim={showDim}
          showCollisions={showCollisions}
          zoom={zoom}
          onNewMap={() => setNewMapOpen(true)}
          onSelectTool={selectTool}
          onSelectMode={selectMode}
          onToggleGrid={toggleGrid}
          onToggleDim={toggleDim}
          onToggleCollisions={toggleCollisions}
          onCycleZoom={cycleZoom}
          onTest={test}
          onOpenHelp={() => openHelp()}
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
                stairsDirection,
                stairsLowLevel,
                spawnActive: toolKey === "spawn",
                onPickContent: pickContent,
                onSelectStairs: () => selectTool("stairs"),
                onStairsDirectionChange: chooseStairsDirection,
                onStairsLowLevelChange: chooseStairsLowLevel,
                onSelectSpawn: selectSpawn,
              }}
              element={{
                selectedAsset,
                elementCount,
                onSelectAsset: selectAsset,
              }}
              event={{
                eventKind,
                eventPreset,
                teleporterEnabled: map !== null,
                markerSpecies,
                markerRadius,
                events: currentMap?.events ?? [],
                selectedEventId: selection?.kind === "event" ? selection.id : null,
                onSelectPreset: selectEventPreset,
                onSelectEventKind: selectEventKind,
                onMarkerSpeciesChange: setMarkerSpecies,
                onMarkerRadiusChange: setMarkerRadius,
                onHoverEvent: (id) => handleRef.current?.highlightEvent(id),
                onSelectEvent: (id) => handleRef.current?.selectEvent(id),
              }}
            />
          </ResizablePanel>
          <ResizableHandle className="editor-chrome" />

          <ResizablePanel defaultSize="64" className="min-h-0">
            {/* The stage draws on the sibling #stage canvas behind #root; this pane is its viewport.
              The decoration palette now lives in the left TerrainPalette, not floating over here. */}
            <section
              data-editor-stage-viewport=""
              className="relative h-full min-h-0 overflow-hidden"
              aria-label={t("editor.shell.stage.aria")}
            >
              {stageStatus === "loading" && (
                <p className="absolute left-3 top-3 z-10 text-sm text-zinc-500" role="status">
                  {t("editor.shell.stage.loading")}
                </p>
              )}
              {savingMap && (
                <p
                  className="pointer-events-none absolute right-3 top-3 z-10 rounded-md bg-white/90 px-2 py-1 text-xs text-zinc-600 shadow-sm"
                  role="status"
                >
                  {t("editor.shell.saving")}
                </p>
              )}
              {placementHint && (
                // C7: the hover-illegal red fill already warns before the click; this covers the
                // click itself, which otherwise leaves no trace at all (the placed count just stays
                // put). Non-intrusive: a small fading pill, not a blocking dialog.
                <p
                  className="pointer-events-none absolute bottom-3 right-3 z-10 rounded-md bg-red-600/90 px-2 py-1 text-xs font-medium text-white shadow-sm"
                  role="status"
                >
                  {t("editor.error.placement")}
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
                    onSetOffset={(offsetX, offsetY) =>
                      handleRef.current?.setSelectedElementOffset(offsetX, offsetY)
                    }
                    onOpenEditor={() => {
                      if (selection.kind === "event") setOpenEventId(selection.id);
                      if (selection.kind === "element") setBindingSelection(selection);
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
              dirty={dirty}
              locked={savingMap}
              refreshNonce={mapsRefreshNonce}
              newMapOpen={newMapOpen}
              onNewMapOpenChange={setNewMapOpen}
              confirmDeleteId={confirmDeleteId}
              onConfirmDeleteIdChange={setConfirmDeleteId}
              onRequestOpen={loadMap}
              onOpenPayload={openPayload}
              onActiveDeleted={activeMapDeleted}
              onOpenMapAudio={() => setMapAudioOpen(true)}
              onOpenSettings={() => setSettingsOpen(true)}
              onError={(code) => setError(code === "" ? null : code)}
            />
          </ResizablePanel>
        </ResizablePanelGroup>

        <AdventureSettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          onSaveDraft={doSaveMap}
          onSaved={() => {
            // A settings save is an explicit adventure save that includes the title, so it counts as
            // the name being confirmed: the first-save popup must not fire afterwards (UX wave #14).
            setTitleUntouched(false);
            setMapsRefreshNonce((n) => n + 1);
          }}
        />

        {currentMap && (
          <MapAudioDialog
            key={map?.id ?? "map-audio"}
            open={mapAudioOpen}
            mapName={currentMap.name}
            initial={currentMap.audio}
            onOpenChange={setMapAudioOpen}
            onSave={async (audio) => {
              const handle = handleRef.current;
              if (!handle) return false;
              // "Save" in this dedicated dialog must persist the choice, not merely leave it as an
              // unsaved stage edit. The previous flow closed the popup after setAudio(), so music,
              // ambience and combat themes disappeared on reload unless the author happened to use
              // the editor-wide Save afterwards.
              handle.setAudio(audio);
              return (await doSaveMap()) !== null;
            }}
          />
        )}

        <AdventureTestDialog
          open={testOpen}
          maps={draftMembers ?? []}
          currentMapId={map?.id ?? null}
          quests={registry.quests ?? []}
          dirty={dirty}
          busy={testBusy}
          error={testError}
          diagnostics={testDiagnostics}
          onOpenChange={setTestOpen}
          onQuickPreview={quickPreview}
          onLaunch={requestAdventureTest}
        />

        <FirstSaveDialog
          key={`${adventureId}:${firstSaveOpen}`}
          open={firstSaveOpen}
          defaultTitle={draftTitle}
          onConfirm={(title) => void confirmFirstSave(title)}
          onCancel={() => {
            pendingTestOptionsRef.current = null;
            setFirstSaveOpen(false);
          }}
        />

        <RegistryDialog
          open={databaseOpen}
          onOpenChange={setDatabaseOpen}
          onOpenHelp={() => openHelp("state")}
        />

        <QuestWorkspaceDialog
          open={questWorkspaceOpen}
          onOpenChange={setQuestWorkspaceOpen}
          onOpenHelp={() => openHelp("quests")}
          currentMap={currentQuestMap}
          {...(stageStatus === "ready" ? { onSaveDraft: doSaveMap } : {})}
        />

        <LoadAdventureDialog
          open={loadOpen}
          onOpenChange={setLoadOpen}
          onPick={loadAdventure}
          onDeleted={(id) => {
            if (id !== adventureId) return;
            setLoadOpen(false);
            setSession(null);
          }}
        />

        {eventDraft && (
          <EventDialog
            key={eventDraft.id}
            event={eventDraft}
            registry={registry}
            maps={teleportMaps}
            onOpenHelp={() => openHelp("story")}
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

        {bindingSelection &&
          currentMap &&
          (() => {
            const element = currentMap.elements.find((candidate) =>
              sameElementSlot(candidate, bindingSelection),
            );
            if (!element) return null;
            return (
              <ObjectBindingDialog
                assetId={element.assetId}
                quests={registry.quests ?? []}
                onCancel={() => setBindingSelection(null)}
                onOpenQuestDatabase={() => {
                  setBindingSelection(null);
                  setQuestWorkspaceOpen(true);
                }}
                onBind={(binding) => {
                  const id = handleRef.current?.bindSelectedElement(binding) ?? null;
                  if (id && binding.questBinding && map) {
                    const latest = session;
                    if (latest) {
                      const nextRegistry = bindQuestTarget(
                        latest.draft.registry,
                        binding.questBinding,
                        {
                          mapId: map.id,
                          eventId: id,
                        },
                      );
                      if (nextRegistry) {
                        setSession({
                          ...latest,
                          draft: { ...latest.draft, registry: nextRegistry },
                        });
                      }
                    }
                  }
                  setBindingSelection(null);
                  if (id) setOpenEventId(id);
                }}
              />
            );
          })()}

        <EditorHelpDialog
          open={helpOpen}
          section={helpSection}
          onOpenChange={setHelpOpen}
          onSectionChange={setHelpSection}
        />

        <EditorStatusBar
          mapName={map?.name ?? "—"}
          cols={map?.cols ?? 0}
          rows={map?.rows ?? 0}
          cursor={cursor}
          saved={map !== null && !dirty && stageStatus === "ready"}
          mode={mode}
          toolLabel={toolLabel}
          zoom={zoom}
        />
      </div>
    </TooltipProvider>
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
  onSetOffset,
  onOpenEditor,
  onDelete,
}: {
  selection: EditorSelection;
  map: EditorMap;
  onMove(col: number, row: number): void;
  onSetOffset(offsetX: number, offsetY: number): void;
  onOpenEditor(): void;
  onDelete(): void;
}) {
  useLocale();
  const selectedEvent =
    selection.kind === "event" ? map.events.find((event) => event.id === selection.id) : undefined;
  const selectedElement =
    selection.kind === "element"
      ? map.elements.find((element) => sameElementSlot(element, selection))
      : undefined;
  const selectedElementAsset = selectedElement ? editorAsset(selectedElement.assetId) : undefined;
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
            {t("editor.inspector.id")}:{" "}
            <span className="tabular-nums">{eventDisplayId(selectedEvent.ordinal)}</span>
            {selectedEvent.name ? ` · ${selectedEvent.name}` : ""}
          </p>
          <Button variant="outline" size="sm" onClick={onOpenEditor}>
            {t("editor.inspector.openEditor")}
          </Button>
        </>
      )}

      {selectedElement && (
        <>
          <div className="flex items-center gap-2">
            {selectedElementAsset && <EditorAssetPreview asset={selectedElementAsset} size={48} />}
            <p className="min-w-0 text-[11px] text-zinc-500">
              {/* The friendly name, never the raw dotted catalogue id (C2), which is dev clutter. */}
              <span className="block truncate">
                {selectedElementAsset
                  ? assetDisplayName(selectedElementAsset)
                  : t("editor.palette.unknown")}
              </span>
              {selectedElementAsset?.editor.collider
                ? t("editor.palette.collision")
                : t("editor.inspector.walkable")}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={onOpenEditor}>
            {t("editor.binding.makeInteractive")}
          </Button>
          <p className="text-[10.5px] text-muted-foreground">
            {t("editor.binding.doubleClickHint")}
          </p>
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

      {selectedElement && (
        <div className="flex gap-2">
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor="inspector-offset-x" className="text-[11px] text-zinc-500">
              {t("editor.inspector.offsetX")}
            </Label>
            <Input
              id="inspector-offset-x"
              key={`ox:${selectedElement.col},${selectedElement.row},${selectedElement.offsetX}`}
              type="number"
              className="h-7 text-xs"
              min={0}
              max={3}
              step={1}
              defaultValue={selectedElement.offsetX}
              onBlur={(event) =>
                onSetOffset(Number(event.currentTarget.value), selectedElement.offsetY)
              }
            />
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor="inspector-offset-y" className="text-[11px] text-zinc-500">
              {t("editor.inspector.offsetY")}
            </Label>
            <Input
              id="inspector-offset-y"
              key={`oy:${selectedElement.col},${selectedElement.row},${selectedElement.offsetY}`}
              type="number"
              className="h-7 text-xs"
              min={0}
              max={3}
              step={1}
              defaultValue={selectedElement.offsetY}
              onBlur={(event) =>
                onSetOffset(selectedElement.offsetX, Number(event.currentTarget.value))
              }
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
