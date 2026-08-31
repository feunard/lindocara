import { Button } from "@alepha/ui/components/ui/button";
import { Input } from "@alepha/ui/components/ui/input";
import { Label } from "@alepha/ui/components/ui/label";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@alepha/ui/components/ui/resizable";
import { Switch } from "@alepha/ui/components/ui/switch";
import { TooltipProvider } from "@alepha/ui/components/ui/tooltip";
import { DialogProvider, useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import {
  type AdventureDraft,
  type DraftMemberInfo,
  refreshMember,
  toAdventureInput,
} from "@lindocara/client/adventure-draft.js";
import {
  ApiError,
  authErrorText,
  createAdventureApi,
  createAdventureTestSessionApi,
  createBuildingInteriorApi,
  deleteAdventureTestSessionApi,
  errorCode,
  fetchMap,
  fetchMaps,
  isUnauthorizedCode,
  type MapPayload,
  updateAdventureApi,
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
import {
  BRIDGE_ASSET_IDS,
  type BridgeDimensions,
  type BridgeOrientation,
  bridgeDimensionsOrDefault,
  bridgeOrientation,
  MAX_BRIDGE_DIMENSION,
  MIN_BRIDGE_DIMENSION,
} from "@lindocara/engine/bridges.js";
import {
  BUILDING_DIMENSION_STEP,
  type BuildingDimensions,
  type BuildingSettings,
  buildingColor,
  buildingColorVariants,
  defaultBuildingSettings,
  destroyedBuildingAssetId,
  MAX_BUILDING_DIMENSION,
  MIN_BUILDING_DIMENSION,
} from "@lindocara/engine/buildings.js";
import {
  ELEMENT_SCALE_STEP,
  MAX_ELEMENT_SCALE,
  MIN_ELEMENT_SCALE,
} from "@lindocara/engine/element-scale.js";
import type { EventPreset } from "@lindocara/engine/event-presets.js";
import type { MonsterSpecies } from "@lindocara/engine/game.js";
import { decodeMap } from "@lindocara/engine/hd2d/map-data.js";
import { derivedMapRect } from "@lindocara/engine/map-canvas.js";
import {
  EMPTY_MARKERS,
  element3dRotationDegrees,
  isRotatable3dElementAsset,
  type MapData,
  type MapElement,
  sameElementSlot,
} from "@lindocara/engine/map-data.js";
import type { InteriorShellStyle } from "@lindocara/engine/map-environment.js";
import {
  type EventKind,
  entryEvents,
  exitEvents,
  type MapEvent,
  monsterEvents,
} from "@lindocara/engine/map-events.js";
import { defaultMapHeroSettings } from "@lindocara/engine/map-hero-settings.js";
import {
  DEFAULT_MAP_FIXED_LIGHTING,
  type MapFixedLighting,
} from "@lindocara/engine/map-lighting.js";
import type { MapWeather } from "@lindocara/engine/map-weather.js";
import {
  nativeSceneryDimensionsOrDefault,
  proportionalNativeSceneryDimensions,
} from "@lindocara/engine/native-scenery.js";
import type { QuestDiagnostic } from "@lindocara/engine/quests.js";
import type { RampDirection } from "@lindocara/engine/tile-brush.js";
import {
  DEFAULT_GUARD_APPEARANCE_ASSET_ID,
  DEFAULT_MONSTER_APPEARANCE_ASSET_ID,
  DEFAULT_NPC_MODEL_ASSET_ID,
  type EditorAssetId,
  editorAsset,
  LINDOCARA_RUNNER_ASSET_IDS,
} from "@lindocara/engine/tiny-swords-catalog.js";
import { MAX_UNDERGROUND_DEPTH } from "@lindocara/engine/underground.js";
import { useAlepha, useStore } from "alepha/react";
import { useRouter } from "alepha/react/router";
import { XIcon } from "lucide-react";
import {
  type FocusEvent as ReactFocusEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  canvasEditorMap,
  croppedForSave,
  type EditorMap,
  type EditorMode,
  type EditorSelection,
  type EditorTool,
  editorLayersFromPayload,
  elementForSavedMap,
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
import { generateProceduralMap, type ProceduralMapOptions } from "../../game/procedural-map.js";
import {
  createSandboxSession,
  loadAdventureSession,
  loadLastAdventureSession,
} from "./adventure-session.js";
import { AdventureSettingsDialog } from "./AdventureSettingsDialog.js";
import { AdventureTestDialog, type AdventureTestOptions } from "./AdventureTestDialog.js";
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
import { MapHeroSettingsDialog } from "./MapHeroSettingsDialog.js";
import { MapInteriorShellDialog } from "./MapInteriorShellDialog.js";
import { MapListPanel } from "./MapListPanel.js";
import { ObjectBindingDialog } from "./ObjectBindingDialog.js";
import { ProceduralMapDialog } from "./ProceduralMapDialog.js";
import { bindQuestTarget, type QuestMapCatalog } from "./quest-editor-model.js";
import { QuestWorkspaceDialog } from "./QuestWorkspaceDialog.js";
import { RegistryDialog } from "./RegistryDialog.js";

/** The default terrain a fresh stroke paints with until the Task 9 terrain palette lands: flat grass,
 *  matching the stage's own default tool so what the toolbar shows and what the stage paints agree. */
const DEFAULT_CONTENT: RectFillContent = { kind: "block", block: "grass" };
type StageStatus = "loading" | "empty" | "ready" | "error";
/** The active tool key. `stairs`, the hero-spawn tool, scenery and `event` have no toolbar button —
 *  they are picked in the palette or the EV slot — so the toolbar highlights only its six canvas
 *  tools. */
type ToolKey =
  | EditorPaintTool
  | "stairs"
  | "spawn"
  | "event"
  | "link"
  | "wall-opening"
  | "wall-closing"
  | "underground";

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
  npcGraphic: EditorAssetId,
  guardGraphic: EditorAssetId,
  enemyGraphic: EditorAssetId | null,
): EditorTool {
  if (eventKind === "sea-guardian")
    return {
      kind: "event",
      eventKind,
      presetName: t("editor.event.specialMonster.seaGuardian"),
    };
  if (eventKind === "monster")
    return {
      kind: "event",
      eventKind,
      species,
      patrolRadius,
      ...(enemyGraphic ? { graphic: enemyGraphic } : {}),
    };
  if (eventKind === "guard")
    return { kind: "event", eventKind, patrolRadius, graphic: guardGraphic };
  if (eventKind === "npc") return { kind: "event", eventKind, patrolRadius, graphic: npcGraphic };
  if (eventKind === "normal") {
    // A preset placement names itself, in the author's language, so the event list distinguishes the
    // five presets. `raw` stays unnamed: it IS the generic custom event, and the list's own kind
    // fallback already says so — naming it would only freeze that label against a later rename.
    const named = preset === "raw" ? {} : { presetName: t(PRESET_LABEL[preset]) };
    return selfMapId === null
      ? { kind: "event", eventKind, preset, ...named }
      : { kind: "event", eventKind, preset, selfMapId, ...named };
  }
  // Harvestable resources are native scenery and cannot be authored as new events.
  if (eventKind === "harvestable") return { kind: "event", eventKind: "normal", preset: "raw" };
  return { kind: "event", eventKind };
}

function toEditorMap(map: MapPayload): EditorMap {
  const underground =
    map.underground ?? (map.heightfield ? decodeMap(map.heightfield)?.underground : undefined);
  const elementDepths = new Map(
    underground?.elementDepths?.map((entry) => [entry.id, entry.depth]),
  );
  const eventDepths = new Map(underground?.eventDepths?.map((entry) => [entry.id, entry.depth]));
  return canvasEditorMap(
    {
      name: map.name,
      environment: map.environment ?? "exterior",
      ...(map.interiorShell ? { interiorShell: map.interiorShell } : {}),
      ...(underground ? { underground } : {}),
      weather: map.weather ?? "none",
      audio: map.audio ?? EMPTY_MAP_AUDIO,
      heroSettings: map.heroSettings ?? defaultMapHeroSettings(),
      dayNightCycle: map.dayNightCycle ?? true,
      fixedLighting: map.fixedLighting ?? DEFAULT_MAP_FIXED_LIGHTING,
      layers: editorLayersFromPayload(map),
      elements: map.elements.map((element) => {
        const depth = element.id ? elementDepths.get(element.id) : undefined;
        return depth === undefined ? element : { ...element, undergroundDepth: depth };
      }),
      spawn: map.spawn,
      // Markers are QUARANTINED (UX wave #12): the editor ignores whatever a (legacy) payload
      // still carries and never authors one, so it opens with `EMPTY_MARKERS` and saves the same.
      markers: EMPTY_MARKERS,
      events: (map.events ?? []).map((event) => {
        const depth = eventDepths.get(event.id);
        return depth === undefined ? event : { ...event, undergroundDepth: depth };
      }),
    },
    map.id,
  );
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
    solid: solidMaskFromMapPayload(toMapData(croppedForSave(edited, mapId))),
    monsterCount: monsterEvents(edited.events).length,
    entryIds: entries.map((event) => event.id),
    exitIds: exits.map((event) => event.id),
    entryLabels: labels(entries),
    exitLabels: labels(exits),
    events: edited.events.map((event) => ({
      id: event.id,
      label: event.name || eventDisplayId(event.ordinal),
    })),
  };
}

/** The single EditorTool a toolbar/palette selection resolves to. Terrain content composes into
 *  pencil (single cell), rect and fill exactly as the pre-merge editor's paint path did. */
function paintToolFor(key: EditorPaintTool | "stairs", content: RectFillContent): EditorTool {
  switch (key) {
    case "select":
      return { kind: "select" };
    case "pan":
      return { kind: "pan" };
    case "pencil":
      // The pencil IS the terrain content, single cell. Spread rather than rebuilt field by field:
      // the content carries either a relative `step` or an absolute `level`, and copying one of the
      // two by name is how the other silently stops reaching the brush.
      return content.kind === "elevation"
        ? { ...content }
        : { kind: "block", block: content.block };
    case "rect":
      return { kind: "rect", content };
    case "fill":
      return { kind: "fill", content };
    case "eraser":
      return { kind: "eraser" };
    case "stairs":
      // No direction and no levels: the stamp reads both off the cell under the cursor, and the
      // stage adds the camera-derived tie-break on its way to `applyTool`.
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
export function AdventureEditorScreen(props: { adventureId?: string }) {
  const [session, setSession] = useStore(adventureEditorSessionAtom);
  // Leaving the editor clears the session WHILE this component is still mounted (the route swap is
  // asynchronous and always lands later), so without this flag the no-session branch below would
  // mount the bootstrap and open a sandbox the author never asked for. Every departure therefore
  // goes through `leave()`, never a bare `setSession(null)`: the two are different intents. Clearing
  // the session to STAY in the editor (the current adventure was just deleted from the Open dialog)
  // still wants a fresh sandbox and keeps calling `setSession(null)` directly.
  const [leaving, setLeaving] = useState(false);
  const leave = useCallback((): void => {
    setLeaving(true);
    setSession(null);
  }, [setSession]);
  // `DialogProvider` is mounted HERE rather than around each caller: the editor's discard guards
  // live in this screen, in `MapListPanel` and in `QuestWorkspaceDialog`, and `useDialog` reads one
  // context. Mounting it above the keyed inner screen also means a session swap (File → New / Open)
  // cannot remount the provider mid-confirm. Its `AlertDialog` portals to `document.body`, outside
  // `.editor-root` — stock shadcn, so `legacy.css`'s `[data-slot]` fence already exempts it from the
  // Tiny Swords skin.
  // A deep link (`/editor/:id`) names the adventure the URL is FOR, so ARRIVING at one loads it —
  // including while another adventure is open, which is what stops a shared link showing whatever
  // the recipient happened to have on screen.
  //
  // It reacts to the route CHANGING, not to the route and the session merely disagreeing, and that
  // distinction is the whole comment. Written as a standing invariant ("URL wins whenever they
  // differ") it also fires during the moment a menu action has swapped the session but the
  // navigation has not landed yet — so `File → Open` and `File → New` both wrote their new session,
  // re-rendered still on the OLD url, tripped the invariant, and had the old adventure reloaded
  // over the top. Both silently reverted. Reordering the two writes does not fix it either; it only
  // moves which side of the window is wrong, since the pair can never update in one atom write.
  //
  // Keyed off the last route id this screen ACTED on: a genuine URL change (cold load, a pasted
  // link, back/forward) differs from it and loads; a session swap that then pushes its own matching
  // URL never does, because by the time the route changes the session already agrees.
  const lastRouteIdRef = useRef<string | undefined>(undefined);
  const deepLinkPending =
    props.adventureId !== undefined &&
    lastRouteIdRef.current !== props.adventureId &&
    session?.adventureId !== props.adventureId;
  useEffect(() => {
    // Recorded only once the session actually matches, so an abandoned or failed load does not mark
    // the id as handled and leave the screen stuck on the wrong adventure.
    if (props.adventureId !== undefined && session?.adventureId === props.adventureId) {
      lastRouteIdRef.current = props.adventureId;
    }
    if (props.adventureId === undefined) {
      lastRouteIdRef.current = undefined;
    }
  }, [props.adventureId, session?.adventureId]);

  return (
    <DialogProvider>
      {session && !deepLinkPending ? (
        // Keyed by `draftId`, NOT by `adventureId`: an unsaved sandbox has no adventure id, and its
        // first save gives it one — remounting there would throw away the stage the author is
        // standing in mid-save. `draftId` changes only when the session is genuinely swapped (File →
        // New / Open), which is exactly when the room-local editor state must reset. That makes it
        // load-bearing for `refreshSession`, which must preserve it rather than mint a new one.
        <AdventureEditorInner
          key={session.draftId}
          adventureId={session.adventureId}
          onLeave={leave}
        />
      ) : leaving ? null : ( // owns what comes next. // On the way out: render nothing rather than a screen that acts. The pending `router.push`
        // Keyed by the target so the bootstrap's fire-once latch resets when the URL names a
        // different adventure — a ref on a component that is never remounted would load the first
        // id and ignore every later one.
        <AdventureEditorBootstrap
          key={props.adventureId ?? "sandbox"}
          adventureId={props.adventureId}
        />
      )}
    </DialogProvider>
  );
}

/**
 * The no-session branch: RESUME the author's last adventure, or open a local sandbox when there is
 * nothing to resume. Entering the editor no longer asks which adventure to work on (that is
 * `File → Open`), and it still WRITES nothing: the resume is a `GET`, and a sandbox is minted
 * locally exactly as before.
 *
 * That `GET` is the one thing to be careful with here. This screen mounts under Alepha's real
 * router root, which enables strict mode by default (`ReactPageProvider.root`, `strictMode`
 * defaulting `true`, never overridden in this app), so its mount→cleanup→mount dance is real in
 * development. `startedRef` is the fire-once latch that keeps the doubled effect from issuing two
 * loads, and it was already load-bearing for the sandbox branch, where a second invocation would
 * replace the sandbox with a different one and discard the first session's map id.
 *
 * No cancellation ref, matching the deep-link path: a late resolution writes the session the author
 * asked for, which is what they want whether or not React discarded a render on the way. The ref
 * that DID exist (`aliveRef`) guarded a `POST` that created an adventure per visit; do not
 * reintroduce a write here without bringing it back.
 */
function AdventureEditorBootstrap({ adventureId }: { adventureId?: string }) {
  useLocale();
  const router = useRouter();
  const [, setSession] = useStore(adventureEditorSessionAtom);
  const startedRef = useRef(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    if (adventureId === undefined) {
      // Resume, and fall back QUIETLY. That is the opposite of the deep-link branch below, and for
      // the opposite reason: nobody named an adventure here, so an empty account, a vanished row or
      // an offline listing all mean "there is nothing to reopen", not "the link you were sent is
      // broken". The sandbox is the correct answer to all three.
      void loadLastAdventureSession()
        .then((resumed) => {
          if (!resumed?.adventureId) {
            setSession(createSandboxSession());
            return;
          }
          setSession(resumed);
          // The address bar follows what is open, exactly as `File → Open` does: a reload then
          // reopens the same adventure through the deep link instead of re-running this lookup,
          // and the URL stops naming a sandbox that is not on screen. `replace`, not `push`, since
          // this is a redirect the author never navigated to: Back should leave the editor rather
          // than bounce through `/editor` and land right back here.
          void router.push(`/editor/${resumed.adventureId}`, { replace: true });
        })
        .catch(() => setSession(createSandboxSession()));
      return;
    }
    // Deep link. Unlike a resume, the URL NAMED this adventure, so a failure is worth saying out
    // loud rather than papering over with a sandbox.
    void loadAdventureSession(adventureId)
      .then(setSession)
      .catch(() => setFailed(true));
  }, [adventureId, setSession, router]);

  // A link to an adventure that no longer resolves — deleted, mistyped, or from another
  // environment — must SAY so. Falling through to a sandbox is the tempting default and the wrong
  // one: the author would be dropped into an empty map that looks like a working editor, and the
  // first save would create a second adventure rather than open the one they were sent.
  if (failed) {
    return (
      <main className="editor-root editor-chrome flex min-h-screen flex-col items-center justify-center gap-3 bg-zinc-50 text-zinc-950">
        <p role="alert" className="text-sm text-zinc-700">
          {t("editor.shell.notFound")}
        </p>
        <Button variant="outline" size="sm" onClick={() => setSession(createSandboxSession())}>
          {t("editor.shell.startSandbox")}
        </Button>
      </main>
    );
  }

  return (
    <main className="editor-root editor-chrome flex min-h-screen items-center justify-center bg-zinc-50 text-zinc-950">
      <p role="status" className="text-sm text-zinc-500">
        {t("editor.shell.preparing")}
      </p>
    </main>
  );
}

function AdventureEditorInner({
  adventureId,
  onLeave,
}: {
  /** `null` for an unsaved sandbox — every server-backed action reads this to know it must ask for
   *  the first save (which creates the adventure) before it can do anything. */
  adventureId: string | null;
  /** Clears the session AND tells the shell this is a departure, not a restart — see
   *  `AdventureEditorScreen`'s `leave()`. Every exit path must call this instead of clearing the
   *  session itself. */
  onLeave: () => void;
}) {
  useLocale();
  const router = useRouter();
  const alepha = useAlepha();
  // The imperative confirm/alert/prompt trio, from the `DialogProvider` mounted by
  // `AdventureEditorScreen` above. Replaces this screen's `window.confirm` calls: the native dialog
  // is unstyled, untranslatable and blocks the whole page, and it cannot be driven by the same
  // shadcn tree the rest of the editor chrome is built from.
  const dialog = useDialog();
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
        // Its events too, so a teleport can be aimed at one of them instead of at a cell. Read off
        // the draft the panel already holds: no fetch, and every member map's events are available
        // wherever a command is authored.
        destinations: member.events,
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
  const pendingBuildingInteriorRef = useRef<MapElement | null>(null);
  const buildingInteriorBusyRef = useRef(false);

  const [map, setMap] = useState<MapPayload | null>(null);
  const [toolKey, setToolKey] = useState<ToolKey | null>("pencil");
  const [content, setContent] = useState<RectFillContent>(DEFAULT_CONTENT);
  const [selectedAsset, setSelectedAsset] = useState<EditorAssetId | null>(null);
  const [mode, setActiveMode] = useState<EditorMode>("field");
  const [showGrid, setShowGrid] = useState(true);
  const [showDim, setShowDim] = useState(false);
  // D18: the collision-visualisation overlay toggle. Off by default so a fresh editor looks exactly
  // as it did before this overlay existed.
  const [showCollisions, setShowCollisions] = useState(false);
  const [cursor, setCursor] = useState<{ col: number; row: number } | null>(null);
  const [zoom, setZoomState] = useState(100);
  const [yawDegrees, setYawDegrees] = useState(0);
  const [elementCount, setElementCount] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [linkPending, setLinkPending] = useState(false);
  const [wallOpeningPending, setWallOpeningPending] = useState(false);
  const [undergroundDepth, setUndergroundDepth] = useState(1);
  const [basementAscentTarget, setBasementAscentTarget] = useState(0);
  const [upperStorey, setUpperStorey] = useState(1);
  const [editingDepth, setEditingDepth] = useState<number | null>(null);
  const pendingEditingDepthRef = useRef<number | null>(null);
  const [undergroundStyle, setUndergroundStyle] = useState<InteriorShellStyle>("cave");
  const [undergroundWidth, setUndergroundWidth] = useState(3);
  const [undergroundLength, setUndergroundLength] = useState(6);
  const [undergroundDirection, setUndergroundDirection] = useState<RampDirection>("east");
  const [undergroundShape, setUndergroundShape] = useState<"pencil" | "rect" | "fill">("pencil");
  const [undergroundOperation, setUndergroundOperation] = useState<
    "dig" | "tunnel" | "fill" | "shaft" | "stairs"
  >("dig");
  const [savingMap, setSavingMap] = useState(false);
  const [buildingInteriorBusy, setBuildingInteriorBusy] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [selection, setSelection] = useState<EditorSelection | null>(null);
  // C7: a brief "can't place here" hint over the stage. Driven by the stage's monotone
  // `placementRejectedAt` counter rather than a boolean, so retrying the same illegal cell while the
  // previous hint is still fading restarts its timer instead of silently doing nothing.
  const [placementHint, setPlacementHint] = useState(false);
  const [pendingTeleportOrigin, setPendingTeleportOrigin] = useState<{
    col: number;
    row: number;
    undergroundDepth: number | null;
  } | null>(null);
  const lastRejectionRef = useRef<number | null>(null);
  const placementHintTimeoutRef = useRef<number | null>(null);
  // The kind the EV tool places (normal / entry / exit / monster), and the monster kind's default
  // species/radius. Markers are dead — these drive the one event tool's placement.
  const [eventKind, setEventKind] = useState<EventKind>("normal");
  // The preset a `normal` placement uses (D13): `raw` is the blank scripted event, the default.
  const [eventPreset, setEventPreset] = useState<EventPreset>("raw");
  const [markerSpecies, setMarkerSpecies] = useState<MonsterSpecies>("spear_goblin");
  const [markerRadius, setMarkerRadius] = useState(96);
  const [npcGraphic, setNpcGraphic] = useState<EditorAssetId>(DEFAULT_NPC_MODEL_ASSET_ID);
  const [enemyGraphic, setEnemyGraphic] = useState<EditorAssetId | null>(
    DEFAULT_MONSTER_APPEARANCE_ASSET_ID,
  );
  const [guardGraphic, setGuardGraphic] = useState<EditorAssetId>(
    DEFAULT_GUARD_APPEARANCE_ASSET_ID,
  );
  const [stageStatus, setStageStatus] = useState<StageStatus>("loading");
  // Inspector-only edits can leave every summary flag unchanged (dirty was already true, selection
  // did not move). The stage revision still advances, forcing this component to reread `current()`.
  const [, setStageRevision] = useState(0);
  const [stageEpoch, setStageEpoch] = useState(0);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Right-pane / dialog coordination, lifted here so the menu bar, toolbar and map panel all reach
  // the same new-map dialog, delete confirm and settings dialog.
  const [newMapOpen, setNewMapOpen] = useState(false);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mapAudioOpen, setMapAudioOpen] = useState(false);
  const [mapHeroSettingsOpen, setMapHeroSettingsOpen] = useState(false);
  const [mapInteriorShellOpen, setMapInteriorShellOpen] = useState(false);
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
  // One session swap at a time. Both File → New adventure and File → Open replace the whole session
  // asynchronously, and neither can afford to lose a race: two New invocations before the first POST
  // resolves mint two adventures (nothing ever cleans an abandoned scratch up), and a New POST that
  // resolves after an Open silently discards the adventure the author explicitly chose. A single
  // latch across both is the coherent guard — whichever swap started first is the one that lands.
  const swappingSessionRef = useRef(false);

  function openHelp(section: EditorHelpSection = "start"): void {
    setHelpSection(section);
    setHelpOpen(true);
  }

  const fail = useCallback((caught: unknown): void => {
    const code = errorCode(caught);
    if (isUnauthorizedCode(code)) return;
    setError(code);
  }, []);

  /**
   * The one unsaved-edits guard, shared by every path that would drop the stage's in-memory map:
   * File → Open, File → New adventure, switching maps, renaming the open map (in `MapListPanel`,
   * which gets this as a prop rather than a `dirty` boolean) and quitting.
   *
   * Resolves `true` when the caller may proceed — including immediately, with no dialog at all, when
   * there is nothing to lose. Callers are therefore `async` where they used to be synchronous:
   * `useDialog().confirm` returns a promise, unlike the `window.confirm` this replaced, so anything
   * a caller does after the guard now happens a microtask later. That matters for the latches around
   * it (`savingMapRef`, `swappingSessionRef`, the map/session load generations), which are all still
   * read AFTER the await — never captured before it.
   */
  const confirmDiscard = useCallback(async (): Promise<boolean> => {
    if (!dirty) return true;
    return dialog.confirm({
      title: t("editor.shell.exit.confirm"),
      confirmLabel: t("editor.discard.confirm"),
      cancelLabel: t("editor.discard.cancel"),
      destructive: true,
    });
  }, [dirty, dialog]);

  // Load a different adventure (UX wave #15), from the File → « Charger une aventure » dialog. Guard
  // unsaved edits first, then swap the session — a new adventureId remounts this component (it is
  // keyed by it), resetting every room-local editor state cleanly.
  async function loadAdventure(id: string): Promise<void> {
    if (savingMapRef.current || swappingSessionRef.current) return;
    if (id === adventureId) {
      setLoadOpen(false);
      return;
    }
    if (!(await confirmDiscard())) return;
    // Re-read both latches: the author may have started a save or another swap while the discard
    // dialog was open, which the pre-await check above could not have seen.
    if (savingMapRef.current || swappingSessionRef.current) return;
    setError(null);
    swappingSessionRef.current = true;
    try {
      const loaded = await loadAdventureSession(id);
      setSession(loaded);
      setLoadOpen(false);
      // The URL follows the open adventure, and this is NOT cosmetic — it is how an author obtains
      // a link to share at all. Without it the only way to reach `/editor/<id>` is to already know
      // the uuid, which makes the shareable route unreachable from inside the app that owns it.
      //
      // It is also what keeps `/editor/<id>` honest. That route hands the screen its id as a prop,
      // and the screen treats a URL that names a DIFFERENT adventure than the open session as "the
      // URL wins" — the rule that stops a shared link showing whatever the recipient happened to
      // have open. Swapping the session without moving the URL pits those two against each other,
      // and the URL wins: File → Open loaded the new adventure and was then silently reverted to
      // the one in the address bar. Shipped that way in c8ebb1ca and caught by trying it.
      await router.push(`/editor/${id}`);
    } catch (caught) {
      fail(caught);
    } finally {
      swappingSessionRef.current = false;
    }
  }

  // File → New adventure: same dirty guard as `loadAdventure`, then swap the session for a fresh
  // sandbox. `AdventureEditorInner` is keyed by `draftId`, so this remounts every room-local editor
  // state cleanly rather than leaking the previous adventure's stage. No request and no failure
  // mode: a sandbox is minted locally, and the swap latch is only read here to refuse while an
  // asynchronous `File → Open` is still landing.
  async function newAdventure(): Promise<void> {
    if (savingMapRef.current || swappingSessionRef.current) return;
    if (!(await confirmDiscard())) return;
    if (savingMapRef.current || swappingSessionRef.current) return;
    setError(null);
    setSession(createSandboxSession());
    // Off any `/editor/<id>` URL, for the same reason `File → Open` moves to the new one: a sandbox
    // under a URL that names an adventure is the two disagreeing, and the URL wins — the brand-new
    // sandbox would be discarded and that adventure reloaded over it. `/editor` is the sandbox's
    // own address, and pushing it when already there is a no-op.
    await router.push("/editor");
  }

  // Load the map to edit once: the author's first map. Task 8's maps panel takes over selection;
  // this is the minimal seam that keeps the stage fed.
  // One contextual auto-open on mount
  useEffect(() => {
    if (autoOpened.current) return;
    autoOpened.current = true;
    const generation = ++mapLoadGenerationRef.current;
    void (async () => {
      try {
        // An unsaved sandbox has no stored map to fetch: its one map lives on the session and is
        // mounted straight into the stage. Without a sandbox map either, there is nothing to open —
        // a first-class empty state, not an error.
        if (!adventureId) {
          if (generation !== mapLoadGenerationRef.current) return;
          const sandboxMap = alepha.store.get(adventureEditorSessionAtom)?.sandboxMap;
          if (sandboxMap) setMap(sandboxMap);
          else setStageStatus("empty");
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
  // Stage identity is (map, previewing)
  useEffect(() => {
    if (previewing || !map) return;
    let cancelled = false;
    setStageStatus("loading");
    openMapEditorStage(
      editedRef.current ?? toEditorMap(map),
      (changed, state) => {
        editedRef.current = changed;
        setStageRevision(state.revision);
        setError(null);
        setElementCount(changed.elements.length);
        setDirty(state.dirty);
        setCanUndo(state.canUndo);
        setCanRedo(state.canRedo);
        setSelection(state.selection);
        // Which step the door-link tool is on. Published by the stage rather than derived here: the
        // first door lives in the stage between the two clicks, and the palette has to say whether
        // that click registered instead of leaving the author to guess.
        setLinkPending(state.linkAnchor !== null);
        setWallOpeningPending(
          state.wallOpeningAnchor !== null && state.wallOpeningAnchor !== undefined,
        );
        setPendingTeleportOrigin(state.pendingTeleportOrigin ?? null);
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
      (degrees) => setYawDegrees(degrees),
    )
      .then((handle) => {
        if (cancelled) {
          handle.dispose();
          return;
        }
        handleRef.current = handle;
        handle.setTool(pendingToolRef.current);
        handle.setEditingDepth?.(pendingEditingDepthRef.current);
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
    const cropped = croppedForSave(edited, map?.id);
    const data: MapData = toMapData(cropped);
    let stopped = false;
    let preview: { stop(): void } | null = null;
    // Events ride alongside the terrain: the preview draws the authored NPCs and monsters at rest
    // so an author can judge scale and composition without launching a party.
    const previewStart = startMapPreview(data, cropped.events, {
      heroSettings: edited.heroSettings,
      dayNightCycle: edited.dayNightCycle,
      fixedLighting: edited.fixedLighting,
    });
    void previewStart
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
  }, [previewing, fail, map?.id]);

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

  // Runtime event kinds bundle their tuning/appearance into the pushed tool, so a palette edit while
  // one is active must re-push it before the next placement.
  useEffect(() => {
    if (
      toolKey !== "event" ||
      (eventKind !== "monster" && eventKind !== "guard" && eventKind !== "npc")
    )
      return;
    const tool = eventToolFor(
      eventKind,
      eventPreset,
      markerSpecies,
      markerRadius,
      map?.id ?? null,
      npcGraphic,
      guardGraphic,
      enemyGraphic,
    );
    pendingToolRef.current = tool;
    handleRef.current?.setTool(tool);
  }, [
    toolKey,
    eventKind,
    eventPreset,
    markerSpecies,
    markerRadius,
    map?.id,
    npcGraphic,
    guardGraphic,
    enemyGraphic,
  ]);

  function pushTool(tool: EditorTool): void {
    pendingToolRef.current = tool;
    handleRef.current?.setTool(tool);
  }

  function chooseEditingDepth(depth: number | null): void {
    const next =
      depth === null
        ? null
        : Math.max(-16, Math.min(16, Math.trunc(depth) || (depth < 0 ? -1 : 1)));
    pendingEditingDepthRef.current = next;
    setEditingDepth(next);
    if (next !== null && next > 0) setUndergroundDepth(next);
    if (next !== null && next > 0) setBasementAscentTarget(Math.max(0, next - 1));
    if (next !== null && next < 0) setUpperStorey(-next);
    handleRef.current?.setEditingDepth?.(next);
  }

  async function removeEditingStorey(): Promise<void> {
    const depth = editingDepth;
    const handle = handleRef.current;
    if (
      depth === null ||
      !handle ||
      !handle.current().underground?.levels.some((level) => level.depth === depth)
    ) {
      return;
    }
    const level = depth < 0 ? `+${-depth}` : `−${depth}`;
    if (
      !(await dialog.confirm({
        title: t("editor.level.delete.confirm", { level }),
        confirmLabel: t("editor.level.delete.action"),
        cancelLabel: t("editor.discard.cancel"),
        destructive: true,
      }))
    ) {
      return;
    }
    if (handle.removeStorey(depth)) chooseEditingDepth(null);
  }

  function selectTool(key: EditorPaintTool | "stairs"): void {
    if (
      toolKey === "underground" &&
      (undergroundOperation === "shaft" || undergroundOperation === "fill") &&
      (key === "pencil" || key === "rect" || key === "fill")
    ) {
      setUndergroundShape(key);
      pushTool(undergroundTool(undergroundOperation, { shape: key, width: 1, length: 1 }));
      return;
    }
    setToolKey(key);
    setSelectedAsset(null);
    // Every terrain content, including raised water, is valid with pencil, rectangle and fill.
    // Keeping the selected content makes switching paint shapes predictable in both directions.
    pushTool(paintToolFor(key, content));
  }

  function selectSpawn(): void {
    setToolKey("spawn");
    setSelectedAsset(null);
    pushTool({ kind: "spawn" });
  }

  function selectWallOpening(operation: "open" | "close"): void {
    setToolKey(operation === "open" ? "wall-opening" : "wall-closing");
    setSelectedAsset(null);
    pushTool({ kind: "wall-opening", operation });
  }

  function undergroundTool(
    operation: "dig" | "tunnel" | "fill" | "shaft" | "stairs" = undergroundOperation,
    overrides: Partial<{
      depth: number;
      style: InteriorShellStyle;
      width: number;
      length: number;
      direction: RampDirection;
      shape: "pencil" | "rect" | "fill";
    }> = {},
  ): EditorTool {
    return {
      kind: "underground",
      operation,
      depth: overrides.depth ?? undergroundDepth,
      style: overrides.style ?? undergroundStyle,
      width: overrides.width ?? undergroundWidth,
      length: overrides.length ?? undergroundLength,
      direction: overrides.direction ?? undergroundDirection,
      ...(operation === "shaft" || operation === "fill"
        ? { shape: overrides.shape ?? undergroundShape }
        : {}),
    };
  }

  function selectUnderground(operation: "dig" | "tunnel" | "fill" | "shaft" | "stairs"): void {
    setToolKey("underground");
    setUndergroundOperation(operation);
    setSelectedAsset(null);
    const currentUpperFloor = editingDepth !== null && editingDepth < 0 ? editingDepth : null;
    const currentBasement = editingDepth !== null && editingDepth > 0 ? editingDepth : null;
    const targetDepth =
      operation === "shaft" && currentBasement !== null
        ? Math.min(MAX_UNDERGROUND_DEPTH, Math.max(undergroundDepth, currentBasement + 1))
        : currentUpperFloor !== null && operation !== "shaft" && operation !== "stairs"
          ? currentUpperFloor
          : undergroundDepth;
    const targetStyle =
      currentUpperFloor !== null
        ? (currentMap?.underground?.levels.find((level) => level.depth === currentUpperFloor)
            ?.style ??
          currentMap?.interiorShell?.style ??
          undergroundStyle)
        : undergroundStyle;
    // A direct opening starts on the storey currently shown. Its target defaults to the next lower
    // basement and the view stays at the upper mouth so the author sees exactly what will be cut.
    if (operation === "shaft" && currentBasement !== null) setUndergroundDepth(targetDepth);
    else if (operation === "shaft") chooseEditingDepth(null);
    else if (operation !== "stairs") chooseEditingDepth(targetDepth);
    if (operation === "shaft" || operation === "fill") {
      setUndergroundShape("pencil");
      setUndergroundWidth(1);
      setUndergroundLength(1);
      pushTool(
        undergroundTool(operation, {
          depth: targetDepth,
          style: targetStyle,
          shape: "pencil",
          width: 1,
          length: 1,
        }),
      );
    } else if (operation === "tunnel") {
      setUndergroundWidth(2);
      pushTool(undergroundTool(operation, { depth: targetDepth, style: targetStyle, width: 2 }));
    } else {
      pushTool(undergroundTool(operation, { depth: targetDepth, style: targetStyle }));
    }
  }

  function selectUpperStairs(): void {
    if (currentMap?.environment !== "interior") return;
    setToolKey("underground");
    setUndergroundOperation("stairs");
    setSelectedAsset(null);
    const style = currentMap.interiorShell?.style ?? undergroundStyle;
    setUndergroundStyle(style);
    pushTool(undergroundTool("stairs", { depth: -upperStorey, style }));
  }

  function selectBasementUpStairs(): void {
    if (editingDepth === null || editingDepth <= 0) return;
    const target = Math.max(0, Math.min(editingDepth - 1, basementAscentTarget));
    const style =
      currentMap?.underground?.levels.find((level) => level.depth === editingDepth)?.style ??
      undergroundStyle;
    setToolKey("underground");
    setUndergroundOperation("stairs");
    setSelectedAsset(null);
    setUndergroundStyle(style);
    setBasementAscentTarget(target);
    pushTool(undergroundTool("stairs", { depth: target, style }));
  }

  function updateUndergroundTool(overrides: Parameters<typeof undergroundTool>[1]): void {
    if (toolKey !== "underground") return;
    const current = pendingToolRef.current;
    pushTool(
      undergroundTool(undergroundOperation, {
        ...(current.kind === "underground"
          ? {
              depth: current.depth,
              style: current.style,
              width: current.width,
              length: current.length,
              direction: current.direction,
              ...(current.operation === "shaft" || current.operation === "fill"
                ? { shape: current.shape }
                : {}),
            }
          : {}),
        ...overrides,
      }),
    );
  }

  function selectAsset(assetId: EditorAssetId): void {
    const trapPreset =
      assetId === LINDOCARA_RUNNER_ASSET_IDS.spikeTrap
        ? "trap"
        : assetId === LINDOCARA_RUNNER_ASSET_IDS.pushTrap
          ? "push-trap"
          : assetId === LINDOCARA_RUNNER_ASSET_IDS.launchTrap
            ? "launch-trap"
            : null;
    // These three cards are visible in the scenery catalogue because they share the authored 3D
    // placement language, but a trap-looking inert MapElement is a broken promise. Route the pick
    // through the canonical event preset so damage/impulse remains server-authored and the saved map
    // contains one functional object rather than a decorative duplicate hiding an event underneath.
    if (trapPreset !== null) {
      selectMode("event");
      selectEventPreset(trapPreset);
      return;
    }
    setToolKey(null);
    setSelectedAsset(assetId);
    pushTool({ kind: "element", assetId });
  }

  // The EV kind selector (entry/exit/monster): switch which kind the event tool places, re-pushing so
  // the very next placement is of the chosen kind (the monster re-push effect keeps species/radius
  // fresh too).
  function selectEventKind(kind: EventKind): void {
    setEventKind(kind);
    setToolKey("event");
    setSelectedAsset(null);
    pushTool(
      eventToolFor(
        kind,
        eventPreset,
        markerSpecies,
        markerRadius,
        map?.id ?? null,
        npcGraphic,
        guardGraphic,
        enemyGraphic,
      ),
    );
  }

  function selectNpcGraphic(assetId: EditorAssetId): void {
    setNpcGraphic(assetId);
    setEventKind("npc");
    setToolKey("event");
    setSelectedAsset(null);
    pushTool({
      kind: "event",
      eventKind: "npc",
      patrolRadius: markerRadius,
      graphic: assetId,
    });
  }

  function selectEnemyGraphic(assetId: EditorAssetId | null): void {
    setEnemyGraphic(assetId);
    if (assetId === null) return;
    setEventKind("monster");
    setToolKey("event");
    setSelectedAsset(null);
    pushTool({
      kind: "event",
      eventKind: "monster",
      species: markerSpecies,
      patrolRadius: markerRadius,
      graphic: assetId,
    });
  }

  function selectGuardGraphic(assetId: EditorAssetId): void {
    setGuardGraphic(assetId);
    setEventKind("guard");
    setToolKey("event");
    setSelectedAsset(null);
    pushTool({
      kind: "event",
      eventKind: "guard",
      patrolRadius: markerRadius,
      graphic: assetId,
    });
  }

  // Door link: two clicks, one round trip. It places events, so it lives in Event mode beside the
  // presets, and it needs the open map's uuid for the same reason the Teleporter preset does.
  function selectDoorLink(): void {
    setToolKey("link");
    setSelectedAsset(null);
    pushTool({
      kind: "link",
      selfMapId: map?.id ?? "",
      name: t("editor.event.preset.doorLink"),
    });
  }

  // The preset selector (D13): pick a popular scripted-event template. Every preset places a `normal`
  // event; re-push so the next placement uses the chosen preset.
  function selectEventPreset(preset: EventPreset): void {
    setEventKind("normal");
    setEventPreset(preset);
    setToolKey("event");
    setSelectedAsset(null);
    pushTool(
      eventToolFor(
        "normal",
        preset,
        markerSpecies,
        markerRadius,
        map?.id ?? null,
        npcGraphic,
        guardGraphic,
        enemyGraphic,
      ),
    );
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
    pushTool(
      eventToolFor(
        eventKind,
        eventPreset,
        markerSpecies,
        markerRadius,
        map?.id ?? null,
        npcGraphic,
        guardGraphic,
        enemyGraphic,
      ),
    );
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

  function selectLighting(value: "cycle" | MapFixedLighting): void {
    const handle = handleRef.current;
    if (!handle) return;
    const current = handle.current();
    handle.setLighting(value === "cycle", value === "cycle" ? current.fixedLighting : value);
  }

  function selectWeather(weather: MapWeather): void {
    handleRef.current?.setWeather(weather);
  }

  function setEditorZoom(percent: number): void {
    handleRef.current?.setZoom(percent);
  }

  function cycleZoom(): void {
    const stops = [50, 75, 100, 125, 150, 200] as const;
    const next = stops.find((stop) => stop > zoom) ?? stops[0];
    setEditorZoom(next);
  }

  function generateMap(options: ProceduralMapOptions): void {
    const handle = handleRef.current;
    if (!handle || stageStatus !== "ready" || savingMapRef.current) return;
    handle.replaceMap(generateProceduralMap(handle.current(), options));
    setCursor(null);
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
    /** The adventure the first save just created. Required on that path: this function closes over
     *  the render's `adventureId`, which is still `null` inside the very handler that created it. */
    createdAdventureId?: string,
  ): Promise<void> {
    const testAdventureId = createdAdventureId ?? adventureId;
    if (!testAdventureId || testBusy) return;
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
      const testSession = await createAdventureTestSessionApi(testAdventureId, options);
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
      // The global 401 seam already navigates to /auth (see `isUnauthorizedCode`'s docblock) — bail
      // without reopening the test dialog with a stale error while that redirect is in flight.
      if (isUnauthorizedCode(code)) return;
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
    // A sandbox has no adventure for a test party to join, and an unnamed one has no name to join
    // it under: both route through the first-save popup, which continues into the launch.
    if (titleUntouched || !adventureId) {
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
    // The map save rides the adventure's shell (title, players, camera/game policies, audio and
    // registry) atomically; it never carries a graph now (the editor authors none), so the server
    // preserves the stored graph untouched.
    const adventureInput = refreshed ? toAdventureInput(refreshed) : null;
    setError(null);
    setSavingMap(true);
    try {
      // No adventure yet: this IS the first save of a sandbox, so it CREATES rather than updates —
      // the adventure and the map the author has been drawing, in one request (see
      // `createAdventureApi`). A create-then-PUT pair could persist the named adventure and then
      // fail the map, which would present one action as half done.
      if (!adventureId) {
        // Both are guaranteed by the first-save popup (a non-empty title) and by the sandbox draft
        // tracking its own map; a create cannot proceed without either.
        if (!adventureInput || !baseDraft) return null;
        const created = await createAdventureApi({
          ...adventureInput,
          map: toSaveInput(savedSnapshot, map.id),
        });
        if (mapLoadGenerationRef.current === savedMapGeneration) handle.markSaved(savedSnapshot);
        // The stored map is a new row with a server-minted id, so the stage reopens — from
        // `editedRef`, i.e. the exact edits just saved, the same way it does after a preview.
        setMap(created.defaultMap);
        setMapsRefreshNonce((n) => n + 1);
        const member = Array.isArray(savedSnapshot.events)
          ? memberInfoFromEditor(created.defaultMap.id, created.defaultMap.revision, savedSnapshot)
          : null;
        const createdDraft: AdventureDraft = {
          ...(refreshed ?? baseDraft),
          members: member ? [member] : [],
        };
        setSession({
          adventureId: created.id,
          draftId: currentSession?.draftId ?? crypto.randomUUID(),
          draft: createdDraft,
          invalidatedLinks: [],
          savedDraft: JSON.stringify(createdDraft),
          // Named and stored: the sandbox is gone, and so is the first-save prompt.
          titleUntouched: false,
        });
        setTitleUntouched(false);
        return createdDraft;
      }
      const updated = await updateMapApi(
        map.id,
        toSaveInput(savedSnapshot, map.id),
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

  // First-save popup Confirm: name the adventure and save under that name, drop the unnamed flag,
  // then continue the pending map save. A failure leaves the popup's abort semantics intact: nothing
  // partial is claimed as saved.
  async function confirmFirstSave(title: string): Promise<void> {
    const current = alepha.store.get(adventureEditorSessionAtom);
    if (!current) {
      setFirstSaveOpen(false);
      return;
    }
    setError(null);
    // Title + map are ONE request either way: the sandbox's first save creates both
    // (`POST /api/adventures` carrying the map), a named adventure's rides the map PUT. A two-call
    // sequence could persist the title and then fail the map, despite presenting the action as one
    // first save.
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
    const pendingInterior = pendingBuildingInteriorRef.current;
    pendingBuildingInteriorRef.current = null;
    // `latest.adventureId` explicitly: on the sandbox path the adventure was created a moment ago
    // by `doSaveMap`, and this closure's own `adventureId` is still the render's `null`.
    if (pendingTest) void launchAdventureTest(pendingTest, true, latest?.adventureId ?? undefined);
    if (pendingInterior) {
      const sourceMapId = adventureId ? map?.id : latest?.draft.members[0]?.mapId;
      if (sourceMapId) void createAndOpenBuildingInterior(sourceMapId, pendingInterior, true);
    }
  }

  async function createAndOpenBuildingInterior(
    sourceMapId: string,
    element: MapElement,
    mapAlreadySaved = false,
  ): Promise<void> {
    if (buildingInteriorBusyRef.current || savingMapRef.current) return;
    buildingInteriorBusyRef.current = true;
    setBuildingInteriorBusy(true);
    setError(null);
    try {
      // The stage edits a padded 256×256 canvas, while save stores its derived content crop. A
      // freshly placed building has no database id until that save returns, so send the slot from
      // the cropped document rather than the stale canvas coordinates kept by the selection.
      const persistedElement = handleRef.current
        ? elementForSavedMap(handleRef.current.current(), element, sourceMapId)
        : element;
      if (!mapAlreadySaved && dirty) {
        const saved = await doSaveMap();
        if (!saved) return;
      }
      const created = await createBuildingInteriorApi(sourceMapId, {
        ...(persistedElement.id ? { elementId: persistedElement.id } : {}),
        col: persistedElement.col,
        row: persistedElement.row,
        offsetX: persistedElement.offsetX,
        offsetY: persistedElement.offsetY,
      });
      openPayload(created.interiorMap);
    } catch (caught) {
      fail(caught);
    } finally {
      buildingInteriorBusyRef.current = false;
      setBuildingInteriorBusy(false);
    }
  }

  function requestBuildingInterior(element: MapElement): void {
    const existingInteriorId = element.building?.interiorMapId;
    if (existingInteriorId) {
      void loadMap(existingInteriorId);
      return;
    }
    if (!adventureId || titleUntouched) {
      pendingBuildingInteriorRef.current = element;
      setFirstSaveOpen(true);
      return;
    }
    if (map) void createAndOpenBuildingInterior(map.id, element);
  }

  // The map panel's "select to switch" load path: guard unsaved edits, then swap the stage's map.
  async function loadMap(id: string): Promise<void> {
    if (savingMapRef.current) return;
    if (id === map?.id) return;
    if (!(await confirmDiscard())) return;
    if (savingMapRef.current) return;
    // Claimed only after the guard resolves: bumping the generation before the dialog would cancel
    // an in-flight load the author never chose to abandon.
    const generation = ++mapLoadGenerationRef.current;
    setError(null);
    try {
      const payload = await fetchMap(id);
      if (generation !== mapLoadGenerationRef.current) return;
      editedRef.current = null;
      setMap(payload);
    } catch (caught) {
      if (generation === mapLoadGenerationRef.current) fail(caught);
    }
  }

  // Reload the editor session from the server so the draft's members reflect maps just created,
  // deleted or renamed. Best-effort: a failure here never blocks the map edit that triggered it.
  // Nothing to reload for an unsaved sandbox — it has no server state to be behind.
  function refreshSession(): void {
    if (!adventureId) return;
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
          // A refresh is the SAME session, so it keeps its `draftId`: that id keys
          // `AdventureEditorInner`, and minting a new one here would remount the whole editor —
          // stage, history and camera — every time a map is created, renamed or deleted.
          draftId: current.draftId,
          draft: mergedDraft,
          savedDraft: JSON.stringify(mergedDraft),
          ...(current.titleUntouched === undefined
            ? {}
            : { titleUntouched: current.titleUntouched }),
        });
      } catch {
        // Best-effort refresh: swallow every failure, including a dead session — the global 401
        // seam already navigates to /auth on its own (see `isUnauthorizedCode`'s docblock).
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

  // Written through as soon as the settings dialog is bypassed — the maps panel already owns its
  // own create/rename/delete calls — but only AFTER the server accepts, never optimistically. A
  // rejected 400/409 (moving the start while a party holds it, or a stale id) must leave the draft
  // exactly where the server still has it: nothing is written speculatively, so there is nothing to
  // roll back, and the existing `fail` banner explains the refusal. A speculative write here would
  // also poison the NEXT unrelated save (e.g. a title edit in the settings dialog reseeds from
  // `session.draft` and resubmits whatever `startMapId` sits there), turning one rejected star click
  // into a silently broken later save.
  async function setStartMap(id: string): Promise<void> {
    const latest = alepha.store.get(adventureEditorSessionAtom);
    if (!latest?.adventureId) return;
    const input = toAdventureInput({ ...latest.draft, startMapId: id });
    if (!input) return;
    try {
      await updateAdventureApi(latest.adventureId, input);
    } catch (caught) {
      fail(caught);
      return;
    }
    // Re-read rather than reuse `latest`: the request may have outlived edits made elsewhere
    // (rename, registry, settings) while it was in flight, so the write merges onto the CURRENT
    // draft instead of rolling those back.
    const current = alepha.store.get(adventureEditorSessionAtom);
    if (!current || current.adventureId !== latest.adventureId) return;
    const draft = { ...current.draft, startMapId: id };
    setSession({ ...current, draft, savedDraft: JSON.stringify(draft) });
  }

  async function exit(force = false): Promise<void> {
    if (!force && savingMapRef.current) return;
    if (!force && !(await confirmDiscard())) return;
    if (!force && savingMapRef.current) return;
    // Clear the session; the next editor open bootstraps a fresh opening adventure (UX wave #15).
    // `onLeave`, never a bare `setSession(null)`: this screen stays mounted until the route swap
    // lands, and the no-session branch would otherwise mint a stray scratch on the way out.
    onLeave();
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
  //
  // It is bound on the WINDOW, not on this screen's container, and that is load-bearing. The HD-2D
  // stage owns `#stage` — a sibling of `#root`, outside `.editor-root` entirely — and it makes that
  // canvas focusable (`canvas.tabIndex = 0`) and focuses it on every `pointerdown`
  // (`game/map-editor-stage.ts`). So from the first paint stroke onward the author's focus is on the
  // canvas, and a container-bound listener would never see another keystroke: ⌘S, undo/redo, the
  // mode digits, the tool letters and the grid toggle all went silently dead until some chrome was
  // clicked by hand. The gates above are what make a window binding safe — reaching every keystroke
  // is the point, ignoring the ones that belong to a field or a dialog is the discipline.
  function handleShortcutKeyDown(event: KeyboardEvent): void {
    if (stageStatus !== "ready" || savingMap) return;
    if (
      newMapOpen ||
      generatorOpen ||
      confirmDeleteId !== null ||
      settingsOpen ||
      mapHeroSettingsOpen ||
      mapInteriorShellOpen ||
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
      // Turn the camera a quarter at a time, so every side of a cliff or a building can be
      // authored from in front of it. Brackets because every letter that reads as "rotate" is
      // already a tool (`r` is the rectangle, `e` the eraser).
      case "[":
        handleRef.current?.rotateQuarter(-1);
        return;
      case "]":
        handleRef.current?.rotateQuarter(1);
        return;
    }
  }

  // The listener is installed once and reads the handler through a ref, because `handleShortcutKeyDown`
  // closes over a dozen pieces of state (every dialog flag, the stage status, the selection) and a
  // dependency-listed effect would either reinstall the listener on every keystroke-adjacent render
  // or, worse, capture a stale set of gates and fire a shortcut through a dialog that is open.
  const shortcutRef = useRef(handleShortcutKeyDown);
  useEffect(() => {
    shortcutRef.current = handleShortcutKeyDown;
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => shortcutRef.current(event);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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
      generatorOpen ||
      confirmDeleteId !== null ||
      settingsOpen ||
      mapHeroSettingsOpen ||
      mapInteriorShellOpen ||
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
      : toolKey === "wall-opening"
        ? t("editor.wallOpening.open")
        : toolKey === "wall-closing"
          ? t("editor.wallOpening.close")
          : toolKey === "underground"
            ? t("editor.underground.heading")
            : isPaintToolKey(toolKey) || toolKey === "stairs"
              ? toolLabelText(toolKey)
              : t(`editor.tool.${toolKey}`);

  // The live map the inspector reads its selected marker's fields off — the handle's current edits
  // while a stage is mounted, else whatever payload is loaded. Read in render so a new selection
  // reflects the latest positions.
  const currentMap: EditorMap | null =
    handleRef.current?.current() ?? editedRef.current ?? (map ? toEditorMap(map) : null);
  const currentMapIsStart = map
    ? session?.draft.startMapId
      ? session.draft.startMapId === map.id
      : (draftMembers?.[0]?.mapId ?? map.id) === map.id
    : true;
  // `map?.id` is forwarded as `selfMapId` so a same-map teleport target that would extend the
  // saved rect is reflected in the live derived size too, not just in the eventual save.
  const currentRect = useMemo(
    () => (currentMap ? derivedMapRect(currentMap, map?.id) : null),
    [currentMap, map?.id],
  );
  const currentSize = currentRect
    ? { cols: currentRect.cols, rows: currentRect.rows }
    : { cols: 0, rows: 0 };
  const liveTeleportMaps = teleportMaps.map((candidate) =>
    candidate.mapId === map?.id
      ? {
          ...candidate,
          cols: currentSize.cols,
          rows: currentSize.rows,
          // The open map's events come from the stage, not from the last SAVED member: an author
          // who places a door and immediately aims a teleport at it should find it in the list.
          destinations: (currentMap?.events ?? []).map((event) => ({
            id: event.id,
            label: event.name || eventDisplayId(event.ordinal),
          })),
        }
      : candidate,
  );
  const currentQuestMap: QuestMapCatalog | null =
    map && currentMap
      ? {
          mapId: map.id,
          name: currentMap.name,
          cols: currentSize.cols,
          rows: currentSize.rows,
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
      {/* Focus host, not an interactive widget */}
      <div
        ref={containerRef}
        tabIndex={-1}
        onBlur={handleContainerBlur}
        className="editor-root flex h-screen flex-col overflow-hidden text-zinc-950 outline-none select-none"
      >
        <EditorMenuBar
          canUndo={canUndo && stageStatus === "ready"}
          canRedo={canRedo && stageStatus === "ready"}
          showGrid={showGrid}
          showDim={showDim}
          showCollisions={showCollisions}
          onExit={() => void exit()}
          onOpenLoad={() => setLoadOpen(true)}
          onNewAdventure={() => void newAdventure()}
          onNewMap={() => setNewMapOpen(true)}
          canGenerateMap={stageStatus === "ready" && currentMap !== null && !savingMap}
          onGenerateMap={() => setGeneratorOpen(true)}
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
          activeTool={
            toolKey === "underground" &&
            (undergroundOperation === "shaft" || undergroundOperation === "fill")
              ? undergroundShape
              : isPaintToolKey(toolKey)
                ? toolKey
                : null
          }
          mode={mode}
          showGrid={showGrid}
          showDim={showDim}
          showCollisions={showCollisions}
          dayNightCycle={currentMap?.dayNightCycle ?? true}
          fixedLighting={currentMap?.fixedLighting ?? DEFAULT_MAP_FIXED_LIGHTING}
          dayNightCycleAvailable={currentMap !== null}
          weather={currentMap?.weather ?? "none"}
          onSelectWeather={selectWeather}
          zoom={zoom}
          onNewMap={() => setNewMapOpen(true)}
          canGenerateMap={stageStatus === "ready" && currentMap !== null && !savingMap}
          onGenerateMap={() => setGeneratorOpen(true)}
          onSelectTool={selectTool}
          onSelectMode={selectMode}
          onToggleGrid={toggleGrid}
          onToggleDim={toggleDim}
          onToggleCollisions={toggleCollisions}
          onSelectLighting={selectLighting}
          onCycleZoom={cycleZoom}
          onTest={test}
          onOpenHelp={() => openHelp()}
        />

        <div className="editor-chrome flex h-8 items-center gap-1 border-b border-zinc-200 bg-white px-2 text-[11px]">
          <span className="mr-1 text-zinc-400">{t("editor.level.label")}</span>
          <button
            type="button"
            aria-pressed={editingDepth === null}
            onClick={() => chooseEditingDepth(null)}
            className={`h-6 rounded px-2 ${editingDepth === null ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"}`}
          >
            {t("editor.level.surface")}
          </button>
          <button
            type="button"
            aria-pressed={editingDepth !== null && editingDepth > 0}
            onClick={() => chooseEditingDepth(undergroundDepth)}
            className={`h-6 rounded px-2 ${editingDepth !== null && editingDepth > 0 ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"}`}
          >
            {editingDepth !== null && editingDepth > 0
              ? `−${editingDepth}`
              : `−${undergroundDepth}`}
          </button>
          {currentMap?.environment === "interior" ? (
            <button
              type="button"
              aria-pressed={editingDepth !== null && editingDepth < 0}
              onClick={() => chooseEditingDepth(-upperStorey)}
              className={`h-6 rounded px-2 ${editingDepth !== null && editingDepth < 0 ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"}`}
            >
              {editingDepth !== null && editingDepth < 0 ? `+${-editingDepth}` : `+${upperStorey}`}
            </button>
          ) : null}
          {editingDepth === null ? null : (
            <input
              aria-label={t("editor.level.storey")}
              className="h-6 w-14 rounded border border-zinc-200 px-1.5"
              type="number"
              min={-16}
              max={16}
              value={-editingDepth}
              onChange={(event) => chooseEditingDepth(-Number(event.currentTarget.value))}
            />
          )}
          {editingDepth !== null &&
          currentMap?.underground?.levels.some((level) => level.depth === editingDepth) ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="ml-1 h-6 px-2 text-[10px]"
              onClick={() => void removeEditingStorey()}
            >
              {t("editor.level.delete.action")}
            </Button>
          ) : null}
          <span className="ml-1 truncate text-zinc-400">{t("editor.level.hint")}</span>
        </div>

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
                stairsActive: toolKey === "stairs",
                spawnActive: toolKey === "spawn",
                interior: currentMap?.environment === "interior",
                wallOpeningOperation:
                  toolKey === "wall-opening" ? "open" : toolKey === "wall-closing" ? "close" : null,
                wallOpeningPending,
                undergroundOperation: toolKey === "underground" ? undergroundOperation : null,
                undergroundDepth,
                undergroundStyle,
                undergroundWidth,
                undergroundLength,
                undergroundDirection,
                editingDepth,
                basementAscentTarget,
                basementUpStairsActive:
                  editingDepth !== null &&
                  editingDepth > 0 &&
                  toolKey === "underground" &&
                  undergroundOperation === "stairs" &&
                  pendingToolRef.current.kind === "underground" &&
                  pendingToolRef.current.depth >= 0 &&
                  pendingToolRef.current.depth < editingDepth,
                upperStorey,
                upperStairsActive:
                  toolKey === "underground" &&
                  undergroundOperation === "stairs" &&
                  pendingToolRef.current.kind === "underground" &&
                  pendingToolRef.current.depth < 0,
                onPickContent: pickContent,
                onSelectStairs: () => selectTool("stairs"),
                onSelectSpawn: selectSpawn,
                onSelectWallOpening: selectWallOpening,
                onSelectUnderground: selectUnderground,
                onUndergroundDepthChange: (depth) => {
                  const next = Math.max(1, Math.min(16, Math.trunc(depth) || 1));
                  setUndergroundDepth(next);
                  if (
                    editingDepth !== null &&
                    !(
                      toolKey === "underground" &&
                      (undergroundOperation === "stairs" || undergroundOperation === "shaft")
                    )
                  )
                    chooseEditingDepth(next);
                  updateUndergroundTool({ depth: next });
                },
                onUndergroundStyleChange: (style) => {
                  setUndergroundStyle(style);
                  updateUndergroundTool({ style });
                },
                onUndergroundSizeChange: (width, length) => {
                  const nextWidth = Math.max(1, Math.min(32, Math.trunc(width) || 1));
                  const nextLength = Math.max(1, Math.min(64, Math.trunc(length) || 1));
                  setUndergroundWidth(nextWidth);
                  setUndergroundLength(nextLength);
                  updateUndergroundTool({ width: nextWidth, length: nextLength });
                },
                onUndergroundDirectionChange: (direction) => {
                  setUndergroundDirection(direction);
                  updateUndergroundTool({ direction });
                },
                onSelectBasementUpStairs: selectBasementUpStairs,
                onBasementAscentTargetChange: (depth) => {
                  if (editingDepth === null || editingDepth <= 0) return;
                  const next = Math.max(0, Math.min(editingDepth - 1, Math.trunc(depth)));
                  setBasementAscentTarget(next);
                  if (
                    toolKey === "underground" &&
                    undergroundOperation === "stairs" &&
                    pendingToolRef.current.kind === "underground" &&
                    pendingToolRef.current.depth >= 0 &&
                    pendingToolRef.current.depth < editingDepth
                  ) {
                    updateUndergroundTool({ depth: next });
                  }
                },
                onSelectUpperStairs: selectUpperStairs,
                onUpperStoreyChange: (storey) => {
                  const next = Math.max(1, Math.min(16, Math.trunc(storey) || 1));
                  setUpperStorey(next);
                  if (
                    toolKey === "underground" &&
                    undergroundOperation === "stairs" &&
                    pendingToolRef.current.kind === "underground" &&
                    pendingToolRef.current.depth < 0
                  ) {
                    updateUndergroundTool({ depth: -next });
                  }
                },
              }}
              element={{
                selectedAsset,
                elementCount,
                environment: currentMap?.environment ?? "exterior",
                onSelectAsset: selectAsset,
              }}
              event={{
                eventKind,
                eventPreset,
                teleporterEnabled: map !== null,
                linkActive: toolKey === "link",
                linkPending,
                onSelectDoorLink: selectDoorLink,
                markerSpecies,
                markerRadius,
                npcGraphic,
                enemyGraphic,
                guardGraphic,
                events: (currentMap?.events ?? []).filter(
                  (event) => (event.undergroundDepth ?? null) === editingDepth,
                ),
                selectedEventId: selection?.kind === "event" ? selection.id : null,
                onSelectPreset: selectEventPreset,
                onSelectEventKind: selectEventKind,
                onMarkerSpeciesChange: setMarkerSpecies,
                onMarkerRadiusChange: setMarkerRadius,
                onSelectNpcGraphic: selectNpcGraphic,
                onSelectEnemyGraphic: selectEnemyGraphic,
                onSelectGuardGraphic: selectGuardGraphic,
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
                <p className="absolute top-3 left-3 z-10 text-sm text-zinc-500" role="status">
                  {t("editor.shell.stage.loading")}
                </p>
              )}
              {savingMap && (
                <p
                  className="pointer-events-none absolute top-3 right-3 z-10 rounded-md bg-white/90 px-2 py-1 text-xs text-zinc-600 shadow-sm"
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
                  className="pointer-events-none absolute right-3 bottom-3 z-10 rounded-md bg-red-600/90 px-2 py-1 text-xs font-medium text-white shadow-sm"
                  role="status"
                >
                  {t("editor.error.placement")}
                </p>
              )}
              {pendingTeleportOrigin && (
                <p
                  className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-md bg-sky-700/95 px-3 py-1.5 text-xs font-medium text-white shadow-sm"
                  role="status"
                >
                  {t("editor.event.teleporter.placeExit", {
                    col: pendingTeleportOrigin.col + 1,
                    row: pendingTeleportOrigin.row + 1,
                  })}
                </p>
              )}
              {stageStatus === "error" && (
                <p className="absolute top-3 left-3 z-10 text-sm text-red-600" role="alert">
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
                <p className="absolute bottom-3 left-3 z-10 text-sm text-red-600" role="alert">
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
                    onSetRotation={(rotation) =>
                      handleRef.current?.setSelectedElementRotation(rotation)
                    }
                    onSetScale={(scale) => handleRef.current?.setSelectedElementScale(scale)}
                    onSetElementAsset={(assetId) =>
                      handleRef.current?.setSelectedElementAsset(assetId)
                    }
                    onSetBridgeDimensions={(dimensions) =>
                      handleRef.current?.setSelectedBridgeDimensions(dimensions)
                    }
                    onSetBuilding={(settings) =>
                      handleRef.current?.setSelectedBuildingSettings(settings)
                    }
                    onSetNativeDimensions={(dimensions) =>
                      handleRef.current?.setSelectedNativeSceneryDimensions(dimensions)
                    }
                    onOpenInterior={requestBuildingInterior}
                    buildingInteriorBusy={buildingInteriorBusy}
                    onOpenEditor={() => {
                      if (selection.kind === "event") setOpenEventId(selection.id);
                      if (selection.kind === "element") setBindingSelection(selection);
                    }}
                    onClose={() => handleRef.current?.clearSelection()}
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
              // The sandbox's map, named from the LIVE stage rather than the session snapshot, so a
              // rename shows in the list at once (a stored map gets that from its save refresh).
              sandboxMap={
                adventureId === null && map
                  ? {
                      id: map.id,
                      name: currentMap?.name ?? map.name,
                      cols: currentSize.cols,
                      rows: currentSize.rows,
                    }
                  : undefined
              }
              activeMapId={map?.id ?? null}
              onConfirmDiscard={confirmDiscard}
              locked={savingMap}
              refreshNonce={mapsRefreshNonce}
              newMapOpen={newMapOpen}
              onNewMapOpenChange={setNewMapOpen}
              confirmDeleteId={confirmDeleteId}
              onConfirmDeleteIdChange={setConfirmDeleteId}
              onRequestOpen={(id) => void loadMap(id)}
              onOpenPayload={openPayload}
              onActiveDeleted={activeMapDeleted}
              onOpenMapAudio={() => setMapAudioOpen(true)}
              onOpenHeroSettings={() => setMapHeroSettingsOpen(true)}
              onOpenInteriorShell={() => setMapInteriorShellOpen(true)}
              onOpenSettings={() => setSettingsOpen(true)}
              onError={(code) => setError(code === "" ? null : code)}
              startMapId={session?.draft.startMapId ?? null}
              onSetStartMap={setStartMap}
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
          <ProceduralMapDialog
            open={generatorOpen}
            mapName={currentMap.name}
            onOpenChange={setGeneratorOpen}
            onGenerate={generateMap}
          />
        )}

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

        {currentMap && (
          <MapInteriorShellDialog
            key={`${map?.id ?? "map"}-interior-shell`}
            open={mapInteriorShellOpen}
            mapName={currentMap.name}
            environment={currentMap.environment ?? "exterior"}
            initial={currentMap.interiorShell}
            canMakeInterior={!currentMapIsStart}
            onOpenChange={setMapInteriorShellOpen}
            onSave={async (environment, shell) => {
              const handle = handleRef.current;
              if (!handle) return false;
              handle.setInteriorShell(environment, shell);
              return (await doSaveMap()) !== null;
            }}
          />
        )}

        {currentMap && (
          <MapHeroSettingsDialog
            key={`${map?.id ?? "map"}-hero-settings`}
            open={mapHeroSettingsOpen}
            mapName={currentMap.name}
            initial={currentMap.heroSettings ?? defaultMapHeroSettings()}
            onOpenChange={setMapHeroSettingsOpen}
            onSave={async (heroSettings) => {
              const handle = handleRef.current;
              if (!handle) return false;
              handle.setHeroSettings(heroSettings);
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
            pendingBuildingInteriorRef.current = null;
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
          onPick={(id) => void loadAdventure(id)}
          onDeleted={(id) => {
            if (id !== adventureId) return;
            setLoadOpen(false);
            setSession(null);
            // Off the deleted adventure's own URL before the bootstrap runs. `setSession(null)`
            // here means "stay in the editor with a fresh sandbox" (unlike `leave()`), but on
            // `/editor/<id>` that id is still in the address bar — so the bootstrap would try to
            // reload the adventure just deleted and land on the not-found screen instead of the
            // sandbox this path is asking for.
            void router.push("/editor");
          }}
        />

        {eventDraft && (
          <EventDialog
            key={eventDraft.id}
            event={eventDraft}
            registry={registry}
            maps={liveTeleportMaps}
            currentMapId={map?.id}
            onOpenHelp={() => openHelp("story")}
            onCommit={async (draft) => {
              const handle = handleRef.current;
              if (!handle) return;
              handle.commitEventDraft(draft);
              // This dialog says Save, so it owns the durable write just like the map-audio,
              // interior-shell and hero-settings dialogs below. Previously it only committed the
              // detached draft to stage memory: a map switch/reload then made a freshly created
              // blank or scenery-bound event appear to have vanished.
              if (titleUntouched || !adventureId) {
                setOpenEventId(null);
                setFirstSaveOpen(true);
                return;
              }
              if (await doSaveMap()) setOpenEventId(null);
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
          cols={currentSize.cols}
          rows={currentSize.rows}
          cursor={cursor}
          saved={map !== null && !dirty && stageStatus === "ready"}
          sandbox={adventureId === null && map !== null}
          mode={mode}
          toolLabel={toolLabel}
          zoom={zoom}
          yaw={yawDegrees}
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
  onSetRotation,
  onSetScale,
  onSetElementAsset,
  onSetBridgeDimensions,
  onSetBuilding,
  onSetNativeDimensions,
  onOpenInterior,
  buildingInteriorBusy,
  onOpenEditor,
  onClose,
  onDelete,
}: {
  selection: EditorSelection;
  map: EditorMap;
  onMove(col: number, row: number): void;
  onSetOffset(offsetX: number, offsetY: number): void;
  onSetRotation(rotation: number): void;
  onSetScale(scale: number): void;
  onSetElementAsset(assetId: EditorAssetId): void;
  onSetBridgeDimensions(dimensions: BridgeDimensions): void;
  onSetBuilding(settings: BuildingSettings): void;
  onSetNativeDimensions(dimensions: BuildingDimensions): void;
  onOpenInterior(element: MapElement): void;
  buildingInteriorBusy: boolean;
  onOpenEditor(): void;
  onClose(): void;
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
  const selectedBuilding = selectedElement
    ? (selectedElement.building ?? defaultBuildingSettings(selectedElement.assetId))
    : null;
  const selectedNativeDimensions = selectedElement
    ? nativeSceneryDimensionsOrDefault(
        selectedElement.assetId,
        selectedBuilding?.dimensions ?? selectedElement.dimensions,
      )
    : null;
  const selectedBuildingColor = selectedElement ? buildingColor(selectedElement.assetId) : null;
  const selectedBuildingColorVariants = selectedElement
    ? buildingColorVariants(selectedElement.assetId)
    : [];
  const selectedBridge =
    selectedElement && bridgeOrientation(selectedElement.assetId)
      ? bridgeDimensionsOrDefault(selectedElement.bridge)
      : null;
  const destroyedAsset = selectedElement
    ? editorAsset(destroyedBuildingAssetId(selectedElement.assetId) ?? "")
    : null;
  const position =
    selectedEvent ?? selectedElement ?? (selection.kind === "spawn" ? map.spawn : undefined);

  // An event's inspector title reflects its kind (Entry/Exit/Monster spawn/Event), reusing the same
  // labels the former marker inspectors used; scenery and the hero spawn keep their own titles.
  const titleKey = selectedBuilding
    ? ("editor.inspector.building" as const)
    : selectedEvent && selectedEvent.kind !== "normal"
      ? (`editor.inspector.${selectedEvent.kind}` as const)
      : (`editor.inspector.${selection.kind}` as const);

  return (
    <aside
      className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-3 shadow-lg"
      aria-label={t("editor.inspector.title")}
    >
      <div className="-mr-1 flex items-start justify-between gap-2">
        <p className="pt-1 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
          {t(titleKey)}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("editor.inspector.close")}
          onClick={onClose}
        >
          <XIcon aria-hidden="true" />
        </Button>
      </div>

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
          <p className="text-muted-foreground text-[10.5px]">
            {t("editor.binding.doubleClickHint")}
          </p>
        </>
      )}

      {selectedElement && isRotatable3dElementAsset(selectedElement.assetId) && (
        <div className="flex flex-col gap-1 rounded-md border border-zinc-200 p-2">
          <Label htmlFor="inspector-element-rotation" className="text-[11px] text-zinc-600">
            {t("editor.inspector.element.rotation")}
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="inspector-element-rotation"
              key={`rotation:${element3dRotationDegrees(selectedElement)}`}
              type="number"
              className="h-7 flex-1 text-xs"
              min={0}
              max={359}
              step={1}
              defaultValue={element3dRotationDegrees(selectedElement)}
              onBlur={(event) => {
                const value = Number(event.currentTarget.value);
                if (Number.isSafeInteger(value) && value >= 0 && value <= 359) {
                  onSetRotation(value);
                } else {
                  event.currentTarget.value = String(element3dRotationDegrees(selectedElement));
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
            <span className="text-xs text-zinc-500">°</span>
          </div>
          <p className="text-[10px] text-zinc-500">{t("editor.inspector.element.rotation.hint")}</p>
        </div>
      )}

      {selectedElement && !selectedNativeDimensions && !selectedBridge && (
        <div className="flex flex-col gap-1 rounded-md border border-zinc-200 p-2">
          <Label htmlFor="inspector-element-scale" className="text-[11px] text-zinc-600">
            {t("editor.inspector.element.scale")}
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="inspector-element-scale"
              key={`scale:${selectedElement.scale ?? 1}`}
              type="number"
              className="h-7 flex-1 text-xs"
              min={MIN_ELEMENT_SCALE * 100}
              max={MAX_ELEMENT_SCALE * 100}
              step={ELEMENT_SCALE_STEP * 100}
              defaultValue={(selectedElement.scale ?? 1) * 100}
              onBlur={(event) => {
                const percent = Number(event.currentTarget.value);
                const scale = Number.isFinite(percent)
                  ? Math.max(MIN_ELEMENT_SCALE, Math.min(MAX_ELEMENT_SCALE, percent / 100))
                  : (selectedElement.scale ?? 1);
                onSetScale(scale);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
            <span className="text-xs text-zinc-500">%</span>
          </div>
          <p className="text-muted-foreground text-[10.5px]">
            {t("editor.inspector.element.scaleHint")}
          </p>
        </div>
      )}

      {selectedElement && selectedNativeDimensions && !selectedBuilding && (
        <div className="flex flex-col gap-1 rounded-md border border-zinc-200 p-2">
          <Label className="text-[11px] text-zinc-600">{t("editor.inspector.element.size")}</Label>
          <div className="flex gap-2">
            {(
              [
                ["width", "editor.inspector.building.width"],
                ["depth", "editor.inspector.building.depth"],
              ] as const
            ).map(([dimension, label]) => (
              <div key={dimension} className="flex flex-1 flex-col gap-1">
                <Label
                  htmlFor={`inspector-element-${dimension}`}
                  className="text-[11px] text-zinc-500"
                >
                  {t(label)}
                </Label>
                <Input
                  id={`inspector-element-${dimension}`}
                  key={`element-${dimension}:${selectedNativeDimensions[dimension]}`}
                  type="number"
                  className="h-7 text-xs"
                  min={MIN_BUILDING_DIMENSION}
                  max={MAX_BUILDING_DIMENSION}
                  step={BUILDING_DIMENSION_STEP}
                  defaultValue={selectedNativeDimensions[dimension]}
                  onBlur={(event) => {
                    const value = Number(event.currentTarget.value);
                    const normalized = Number.isFinite(value)
                      ? Math.max(
                          MIN_BUILDING_DIMENSION,
                          Math.min(
                            MAX_BUILDING_DIMENSION,
                            Math.round(value / BUILDING_DIMENSION_STEP) * BUILDING_DIMENSION_STEP,
                          ),
                        )
                      : selectedNativeDimensions[dimension];
                    const dimensions = proportionalNativeSceneryDimensions(
                      selectedElement.assetId,
                      dimension,
                      normalized,
                    );
                    if (dimensions) onSetNativeDimensions(dimensions);
                  }}
                />
              </div>
            ))}
          </div>
          <p className="text-muted-foreground text-[10.5px]">
            {t("editor.inspector.element.sizeHint")}
          </p>
        </div>
      )}

      {selectedElement && selectedBuilding && (
        <div className="flex flex-col gap-2 rounded-md border border-zinc-200 p-2">
          {selectedBuildingColor && selectedBuildingColorVariants.length > 1 && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="inspector-building-color" className="text-[11px] text-zinc-600">
                {t("editor.inspector.building.color")}
              </Label>
              <select
                id="inspector-building-color"
                className="border-input focus-visible:border-ring focus-visible:ring-ring/40 h-7 w-full rounded-md border bg-white px-2 text-xs outline-none focus-visible:ring-2"
                value={selectedBuildingColor}
                onChange={(event) => {
                  const variant = selectedBuildingColorVariants.find(
                    (candidate) => candidate.color === event.currentTarget.value,
                  );
                  if (variant && variant.assetId !== selectedElement.assetId) {
                    onSetElementAsset(variant.assetId);
                  }
                }}
              >
                {selectedBuildingColorVariants.map((variant) => (
                  <option key={variant.color} value={variant.color}>
                    {t(
                      `editor.inspector.building.color.${variant.color}` as Parameters<typeof t>[0],
                    )}
                  </option>
                ))}
              </select>
            </div>
          )}
          {selectedNativeDimensions && (
            <div className="flex flex-col gap-1">
              <Label className="text-[11px] text-zinc-600">
                {t("editor.inspector.building.size")}
              </Label>
              <div className="flex gap-2">
                {(
                  [
                    ["width", "editor.inspector.building.width"],
                    ["depth", "editor.inspector.building.depth"],
                  ] as const
                ).map(([dimension, label]) => (
                  <div key={dimension} className="flex flex-1 flex-col gap-1">
                    <Label
                      htmlFor={`inspector-building-${dimension}`}
                      className="text-[11px] text-zinc-500"
                    >
                      {t(label)}
                    </Label>
                    <Input
                      id={`inspector-building-${dimension}`}
                      key={`building-${dimension}:${selectedNativeDimensions[dimension]}`}
                      type="number"
                      className="h-7 text-xs"
                      min={MIN_BUILDING_DIMENSION}
                      max={MAX_BUILDING_DIMENSION}
                      step={BUILDING_DIMENSION_STEP}
                      defaultValue={selectedNativeDimensions[dimension]}
                      onBlur={(event) => {
                        const value = Number(event.currentTarget.value);
                        const normalized = Number.isFinite(value)
                          ? Math.max(
                              MIN_BUILDING_DIMENSION,
                              Math.min(
                                MAX_BUILDING_DIMENSION,
                                Math.round(value / BUILDING_DIMENSION_STEP) *
                                  BUILDING_DIMENSION_STEP,
                              ),
                            )
                          : selectedNativeDimensions[dimension];
                        const dimensions = proportionalNativeSceneryDimensions(
                          selectedElement.assetId,
                          dimension,
                          normalized,
                        );
                        if (dimensions) onSetBuilding({ ...selectedBuilding, dimensions });
                      }}
                    />
                  </div>
                ))}
              </div>
              <p className="text-muted-foreground text-[10.5px]">
                {t("editor.inspector.building.sizeHint")}
              </p>
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="inspector-building-destructible" className="text-[11px] text-zinc-600">
              {t("editor.inspector.building.destructible")}
            </Label>
            <Switch
              id="inspector-building-destructible"
              size="sm"
              checked={selectedBuilding.destructible}
              onCheckedChange={(checked) =>
                onSetBuilding({ ...selectedBuilding, destructible: checked })
              }
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="inspector-building-hp" className="text-[11px] text-zinc-600">
              {t("editor.inspector.building.hp")}
            </Label>
            <Input
              id="inspector-building-hp"
              key={`building-hp:${selectedBuilding.maxHp}`}
              type="number"
              className="h-7 text-xs"
              min={1}
              max={1_000_000}
              step={50}
              defaultValue={selectedBuilding.maxHp}
              onBlur={(event) => {
                const value = Number(event.currentTarget.value);
                onSetBuilding({
                  ...selectedBuilding,
                  maxHp: Number.isFinite(value)
                    ? Math.max(1, Math.min(1_000_000, Math.trunc(value)))
                    : selectedBuilding.maxHp,
                });
              }}
            />
          </div>
          {destroyedAsset && (
            <p className="text-muted-foreground text-[10.5px]">
              {t("editor.inspector.building.ruin")}: {assetDisplayName(destroyedAsset)}
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={buildingInteriorBusy}
            onClick={() => onOpenInterior(selectedElement)}
          >
            {buildingInteriorBusy
              ? t("editor.inspector.building.interior.creating")
              : selectedBuilding.interiorMapId
                ? t("editor.inspector.building.interior.open")
                : t("editor.inspector.building.interior.create")}
          </Button>
        </div>
      )}

      {selectedElement && selectedBridge && (
        <div className="flex flex-col gap-2 rounded-md border border-zinc-200 p-2">
          {/* Placement reads the orientation off the crossing, which is right often enough to be
              worth doing and wrong often enough to need an undo that is not "delete and re-place".
              Swapping the asset id is how the building colour variants already do exactly this. */}
          <div className="flex flex-col gap-1">
            <Label htmlFor="inspector-bridge-orientation" className="text-[11px] text-zinc-600">
              {t("editor.inspector.bridge.orientation")}
            </Label>
            <select
              id="inspector-bridge-orientation"
              className="border-input focus-visible:border-ring focus-visible:ring-ring/40 h-7 w-full rounded-md border bg-white px-2 text-xs outline-none focus-visible:ring-2"
              value={bridgeOrientation(selectedElement.assetId) ?? "horizontal"}
              onChange={(event) => {
                const next = BRIDGE_ASSET_IDS[event.currentTarget.value as BridgeOrientation];
                if (next && next !== selectedElement.assetId) onSetElementAsset(next);
              }}
            >
              {(["horizontal", "vertical"] as const).map((orientation) => (
                <option key={orientation} value={orientation}>
                  {t(`editor.inspector.bridge.orientation.${orientation}`)}
                </option>
              ))}
            </select>
          </div>
          <p className="text-[11px] font-medium text-zinc-600">
            {t("editor.inspector.bridge.size")}
          </p>
          <div className="flex gap-2">
            <div className="flex flex-1 flex-col gap-1">
              <Label htmlFor="inspector-bridge-length" className="text-[11px] text-zinc-500">
                {t("editor.inspector.bridge.length")}
              </Label>
              <Input
                id="inspector-bridge-length"
                key={`bridge-length:${selectedBridge.length}`}
                type="number"
                className="h-7 text-xs"
                min={MIN_BRIDGE_DIMENSION}
                max={MAX_BRIDGE_DIMENSION}
                step={1}
                defaultValue={selectedBridge.length}
                onBlur={(event) => {
                  const value = Number(event.currentTarget.value);
                  onSetBridgeDimensions({
                    ...selectedBridge,
                    length: Number.isFinite(value)
                      ? Math.max(
                          MIN_BRIDGE_DIMENSION,
                          Math.min(MAX_BRIDGE_DIMENSION, Math.trunc(value)),
                        )
                      : selectedBridge.length,
                  });
                }}
              />
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <Label htmlFor="inspector-bridge-width" className="text-[11px] text-zinc-500">
                {t("editor.inspector.bridge.width")}
              </Label>
              <Input
                id="inspector-bridge-width"
                key={`bridge-width:${selectedBridge.width}`}
                type="number"
                className="h-7 text-xs"
                min={MIN_BRIDGE_DIMENSION}
                max={MAX_BRIDGE_DIMENSION}
                step={1}
                defaultValue={selectedBridge.width}
                onBlur={(event) => {
                  const value = Number(event.currentTarget.value);
                  onSetBridgeDimensions({
                    ...selectedBridge,
                    width: Number.isFinite(value)
                      ? Math.max(
                          MIN_BRIDGE_DIMENSION,
                          Math.min(MAX_BRIDGE_DIMENSION, Math.trunc(value)),
                        )
                      : selectedBridge.width,
                  });
                }}
              />
            </div>
          </div>
          <p className="text-muted-foreground text-[10.5px]">{t("editor.inspector.bridge.hint")}</p>
        </div>
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
