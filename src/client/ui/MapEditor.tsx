import { useEffect, useRef, useState } from "react";
import { MONSTER_SPECIES_KIND, type MonsterSpecies } from "../../shared/game.js";
import {
  EMPTY_MARKERS,
  MARKER_LABEL_MAX,
  MAX_PATROL_RADIUS,
  type MapData,
  MIN_PATROL_RADIUS,
} from "../../shared/map-data.js";
import { type EditorAssetId, editorAsset } from "../../shared/tiny-swords-catalog.js";
import { type DraftMemberInfo, refreshMember } from "../adventure-draft.js";
import {
  authErrorText,
  createMapApi,
  deleteMapApi,
  errorCode,
  fetchMap,
  fetchMaps,
  flagFirstMapApi,
  type MapPayload,
  type MapSummary,
  updateMapApi,
} from "../api.js";
import type { EditorMap, EditorSelection, EditorTool } from "../game/editor-state.js";
import { blankMap } from "../game/editor-state.js";
import { type MapEditorStageHandle, openMapEditorStage } from "../game/map-editor-stage.js";
import { startMapPreview } from "../game/map-preview.js";
import { t, useLocale } from "../i18n.js";
import { useUiStore } from "../store.js";
import { AssetBrowser } from "./AssetBrowser.js";
import { EditorAssetPalette } from "./EditorAssetPalette.js";
import { Button } from "./pixelact-ui/button/index.js";
import { Input } from "./pixelact-ui/input.js";
import { Label } from "./pixelact-ui/label.js";
import { Select } from "./pixelact-ui/select.js";

const DEFAULT_COLS = 40;
const DEFAULT_ROWS = 30;

// Mirrors MAP_MIN_COLS/MAP_MAX_COLS/MAP_MIN_ROWS/MAP_MAX_ROWS in src/server/maps.ts. Client code
// must not import server code, so these bounds are hardcoded input min/max attributes instead —
// the server remains the actual gate; these only keep the form from inviting an obvious 400.
const MIN_COLS = 20;
const MAX_COLS = 100;
const MIN_ROWS = 15;
const MAX_ROWS = 100;

/** The two codes `requireSession` (src/server/index.ts) answers with when the account behind the
 *  cookie is gone or the cookie itself is absent — both mean "log in again", never "this map
 *  request failed". */
function isSessionError(code: string): boolean {
  return code === "session_expired" || code === "unauthorized";
}

function toEditorMap(map: MapPayload): EditorMap {
  return {
    name: map.name,
    blocks: map.blocks,
    elements: map.elements,
    spawn: map.spawn,
    markers: map.markers ?? EMPTY_MARKERS,
  };
}

const TOOL_KEYS = [
  "select",
  "grass",
  "water",
  "eraser",
  "spawn",
  "entry",
  "exit",
  "monster",
  "pan",
] as const;
type ToolKey = (typeof TOOL_KEYS)[number];
type StageStatus = "loading" | "ready" | "error";

/**
 * Editing mode: the React toolbar over the Pixi painting stage. React owns the tool selection, the
 * name and the Save/Back chrome; the stage owns the canvas. They meet only through the
 * `MapEditorStageHandle` — no React reaches into Pixi, no Pixi string reaches into React.
 */
function MapEditorStage({
  map,
  onExit,
  onSaved,
}: {
  map: MapPayload;
  onExit: () => void;
  onSaved?: (map: MapPayload) => void;
}) {
  useLocale();
  const setScreen = useUiStore((state) => state.setScreen);
  const handleRef = useRef<MapEditorStageHandle | null>(null);
  const pendingToolRef = useRef<EditorTool>({ kind: "block", block: "grass" });
  const nameRef = useRef(map.name);
  // The live `EditorMap` captured when Preview is pressed. It carries the unsaved edits across the
  // preview round-trip: the stage is disposed for the sandbox and reopened from this, not from the
  // `map` prop, so painting survives the walk.
  const editedRef = useRef<EditorMap | null>(null);
  const [toolKey, setToolKey] = useState<ToolKey | null>("grass");
  const [selectedAsset, setSelectedAsset] = useState<EditorAssetId | null>(null);
  const [elementCount, setElementCount] = useState(map.elements.length);
  const [name, setName] = useState(map.name);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [species, setSpecies] = useState<MonsterSpecies>("spear_goblin");
  const [radius, setRadius] = useState(96);
  const [stageStatus, setStageStatus] = useState<StageStatus>("loading");
  const [dirty, setDirty] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [selection, setSelection] = useState<EditorSelection | null>(null);

  function toolFor(key: ToolKey): EditorTool {
    switch (key) {
      case "select":
        return { kind: "select" };
      case "grass":
        return { kind: "block", block: "grass" };
      case "water":
        return { kind: "block", block: "water" };
      case "eraser":
        return { kind: "eraser" };
      case "spawn":
        return { kind: "spawn" };
      case "entry":
        return { kind: "marker-entry" };
      case "exit":
        return { kind: "marker-exit" };
      case "monster":
        return { kind: "marker-monster", species, patrolRadius: radius };
      case "pan":
        return { kind: "pan" };
    }
  }

  // The monster marker tool bundles its species/radius into the pushed tool, so a change to either
  // control while that tool is active must re-push — otherwise the stage keeps painting spawns with
  // whatever species/radius were selected when the tool button was last clicked.
  useEffect(() => {
    if (toolKey === "monster") {
      const tool: EditorTool = { kind: "marker-monster", species, patrolRadius: radius };
      pendingToolRef.current = tool;
      handleRef.current?.setTool(tool);
    }
  }, [species, radius, toolKey]);

  // The painting stage. Not mounted while previewing — the sandbox owns the one `#stage` app then —
  // and reopened from the captured edits when the preview ends. Opening is async (it loads textures):
  // if this screen unmounts or a preview starts before the stage resolves, it is still disposed.
  useEffect(() => {
    if (previewing) return;
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
        handle.setName(nameRef.current);
        handle.setTool(pendingToolRef.current);
        setStageStatus("ready");
      })
      .catch((caught) => {
        // A failed stage build (WebGL/texture load) must not strand the screen with a blank canvas
        // and no way out: surface the error and leave the toolbar's Back usable, exactly like the
        // list view's failed load. Save no-ops while the handle is null.
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

  // The sandbox walk. Only while previewing: dispose (above) has released the shared `#stage` app, so
  // the preview builds its throwaway warrior on the clean canvas. Esc (window keydown) ends it, which
  // re-runs the effect above to reopen the editor with the edits intact.
  useEffect(() => {
    if (!previewing) return;
    const edited = editedRef.current;
    if (!edited) return;
    const data: MapData = {
      blocks: edited.blocks,
      elements: edited.elements,
      spawn: edited.spawn,
      markers: edited.markers,
    };
    let stopped = false;
    let preview: { stop(): void } | null = null;
    // Esc during startup: `stopped` latches before `startMapPreview` resolves, so a preview that
    // arrives late is stopped at once. That transient build-then-stop is safe because a preview's
    // teardown is scene-scoped — `renderer.destroy()` detaches only its throwaway warrior's world
    // from the shared `#stage` app, never destroying the Application the editor reopens onto.
    startMapPreview(data).then((started) => {
      if (stopped) {
        started.stop();
        return;
      }
      preview = started;
    });
    const onKeyDown = (event: KeyboardEvent) => {
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

  function startPreview(): void {
    const handle = handleRef.current;
    if (!handle) return;
    editedRef.current = handle.current();
    setPreviewing(true);
  }

  function selectTool(key: ToolKey): void {
    const tool = toolFor(key);
    setToolKey(key);
    setSelectedAsset(null);
    pendingToolRef.current = tool;
    handleRef.current?.setTool(tool);
  }

  function selectAsset(assetId: EditorAssetId): void {
    setToolKey(null);
    setSelectedAsset(assetId);
    const tool: EditorTool = { kind: "element", assetId };
    pendingToolRef.current = tool;
    handleRef.current?.setTool(tool);
  }

  function rename(value: string): void {
    nameRef.current = value;
    setName(value);
    if (handleRef.current) handleRef.current.setName(value);
    else setDirty(value !== map.name);
  }

  async function save(): Promise<void> {
    const handle = handleRef.current;
    if (!handle || saving) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateMapApi(map.id, handle.current());
      handle.markSaved();
      setDirty(false);
      onSaved?.(updated);
    } catch (caught) {
      const code = errorCode(caught);
      if (isSessionError(code)) setScreen("auth");
      else setError(code);
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function exitEditor(): void {
    if (dirty && !window.confirm(t("editor.unsaved.confirm"))) return;
    onExit();
  }

  function undo(): void {
    handleRef.current?.undo();
  }

  function redo(): void {
    handleRef.current?.redo();
  }

  const currentMap = handleRef.current?.current() ?? editedRef.current ?? toEditorMap(map);
  const selectedEntry =
    selection?.kind === "entry"
      ? currentMap.markers.entries.find((marker) => marker.id === selection.id)
      : undefined;
  const selectedExit =
    selection?.kind === "exit"
      ? currentMap.markers.exits.find((marker) => marker.id === selection.id)
      : undefined;
  const selectedMonster =
    selection?.kind === "monster"
      ? currentMap.markers.monsterSpawns.find(
          (marker) => marker.col === selection.col && marker.row === selection.row,
        )
      : undefined;
  const selectedElement =
    selection?.kind === "element"
      ? currentMap.elements.find(
          (element) => element.col === selection.col && element.row === selection.row,
        )
      : undefined;
  const selectedPosition =
    selectedEntry ??
    selectedExit ??
    selectedMonster ??
    (selection?.kind === "spawn" ? currentMap.spawn : selectedElement);

  if (previewing) return <MapPreviewHint />;

  return (
    <div className="map-editor-toolbar" data-dirty={dirty}>
      {stageStatus === "loading" && (
        <p className="map-editor-toolbar__status" role="status">
          {t("editor.stage.loading")}
        </p>
      )}
      {stageStatus === "error" && (
        <p className="map-editor-toolbar__status" role="alert">
          {t("editor.stage.error")}
        </p>
      )}
      <div className="map-editor-toolbar__tools">
        {TOOL_KEYS.map((key) => (
          <Button
            key={key}
            type="button"
            variant={toolKey === key ? "default" : "secondary"}
            aria-pressed={toolKey === key}
            onClick={() => selectTool(key)}
          >
            {t(`editor.tool.${key}`)}
          </Button>
        ))}
      </div>

      {toolKey === "monster" && (
        <div className="map-editor-toolbar__monster">
          <Label htmlFor="editor-species">{t("editor.markers.species")}</Label>
          <Select
            id="editor-species"
            value={species}
            onChange={(event) => setSpecies(event.currentTarget.value as MonsterSpecies)}
          >
            {(Object.keys(MONSTER_SPECIES_KIND) as MonsterSpecies[]).map((option) => (
              <option key={option} value={option}>
                {t(`monster.${option}`)}
              </option>
            ))}
          </Select>
          <Label htmlFor="editor-radius">{t("editor.markers.radius")}</Label>
          <Input
            id="editor-radius"
            type="number"
            min={MIN_PATROL_RADIUS}
            max={MAX_PATROL_RADIUS}
            value={radius}
            onChange={(event) => setRadius(Number(event.currentTarget.value))}
          />
        </div>
      )}

      <EditorAssetPalette
        selected={selectedAsset}
        elementCount={elementCount}
        onSelect={selectAsset}
      />

      <div className="map-editor-toolbar__meta">
        <Label htmlFor="map-editor-edit-name">{t("editor.name")}</Label>
        <Input
          id="map-editor-edit-name"
          type="text"
          value={name}
          onChange={(event) => rename(event.currentTarget.value)}
        />
        <Button
          type="button"
          variant="secondary"
          onClick={undo}
          disabled={!canUndo || stageStatus !== "ready"}
        >
          {t("editor.undo")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={redo}
          disabled={!canRedo || stageStatus !== "ready"}
        >
          {t("editor.redo")}
        </Button>
        <Button
          type="button"
          onClick={() => void save()}
          disabled={saving || stageStatus !== "ready"}
        >
          {t("editor.save")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={startPreview}
          disabled={stageStatus !== "ready"}
        >
          {t("editor.preview")}
        </Button>
        <Button type="button" variant="secondary" onClick={exitEditor}>
          {t("editor.back")}
        </Button>
        {dirty && <span role="status">{t("editor.unsaved")}</span>}
      </div>

      {selection && (
        <aside className="map-editor-inspector" aria-label={t("editor.inspector.title")}>
          <h2>{t("editor.inspector.title")}</h2>
          <p>{t(`editor.inspector.${selection.kind}`)}</p>
          {(selectedEntry || selectedExit) && (
            <>
              <p>
                {t("editor.inspector.id")}: <code>{(selectedEntry ?? selectedExit)?.id}</code>
              </p>
              <Label htmlFor="marker-label">{t("editor.inspector.label")}</Label>
              <Input
                id="marker-label"
                key={`${selection.kind}:${selection.kind === "entry" || selection.kind === "exit" ? selection.id : ""}`}
                type="text"
                maxLength={MARKER_LABEL_MAX}
                defaultValue={(selectedEntry ?? selectedExit)?.label ?? ""}
                onBlur={(event) =>
                  handleRef.current?.setSelectedMarkerLabel(event.currentTarget.value)
                }
              />
            </>
          )}
          {selectedElement && (
            <>
              <p>{selectedElement.assetId}</p>
              <p>{editorAsset(selectedElement.assetId)?.category ?? ""}</p>
              <p>{editorAsset(selectedElement.assetId)?.editor.renderLayer ?? "object"}</p>
              <p>
                {editorAsset(selectedElement.assetId)?.editor.collisionFootprint.length
                  ? t("editor.palette.collision")
                  : t("editor.inspector.walkable")}
              </p>
            </>
          )}
          {selectedMonster && (
            <>
              <Label htmlFor="selected-monster-species">{t("editor.markers.species")}</Label>
              <Select
                id="selected-monster-species"
                className="map-editor-select"
                value={selectedMonster.species}
                onChange={(event) =>
                  handleRef.current?.setSelectedMonster(
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
              </Select>
              <Label htmlFor="selected-monster-radius">{t("editor.markers.radius")}</Label>
              <Input
                id="selected-monster-radius"
                type="number"
                min={MIN_PATROL_RADIUS}
                max={MAX_PATROL_RADIUS}
                defaultValue={selectedMonster.patrolRadius}
                onBlur={(event) =>
                  handleRef.current?.setSelectedMonster(
                    selectedMonster.species,
                    Number(event.currentTarget.value),
                  )
                }
              />
            </>
          )}
          {selectedPosition && (
            <div className="map-editor-inspector__position">
              <Label htmlFor="selected-col">{t("editor.cols")}</Label>
              <Input
                id="selected-col"
                type="number"
                min={0}
                defaultValue={selectedPosition.col}
                onBlur={(event) =>
                  handleRef.current?.moveSelected(
                    Number(event.currentTarget.value),
                    selectedPosition.row,
                  )
                }
              />
              <Label htmlFor="selected-row">{t("editor.rows")}</Label>
              <Input
                id="selected-row"
                type="number"
                min={0}
                defaultValue={selectedPosition.row}
                onBlur={(event) =>
                  handleRef.current?.moveSelected(
                    selectedPosition.col,
                    Number(event.currentTarget.value),
                  )
                }
              />
            </div>
          )}
          {selection.kind !== "spawn" && (
            <Button
              type="button"
              variant="destructive"
              onClick={() => handleRef.current?.deleteSelected()}
            >
              {t("editor.delete")}
            </Button>
          )}
        </aside>
      )}

      {error && <p role="alert">{authErrorText(error)}</p>}
    </div>
  );
}

/** While a preview runs, the toolbar is hidden — the sandbox owns the whole canvas — and only this
 *  hint floats over it, telling the builder how to get back. */
function MapPreviewHint() {
  useLocale();
  return (
    <div className="map-editor-preview-hint" role="status">
      {t("editor.preview.hint")}
    </div>
  );
}

/**
 * List mode (Task 9): fetch, create, delete, and flag the front door. Opening a map — or creating
 * one — sets `selected` and hands it to `MapEditorStage`, the WYSIWYG painting surface (Task 10).
 */
export function MapEditor() {
  useLocale();
  const setScreen = useUiStore((state) => state.setScreen);
  const returnContext = useUiStore((state) => state.editorReturnContext);
  const setReturnContext = useUiStore((state) => state.setEditorReturnContext);
  const setAdventureEditorSession = useUiStore((state) => state.setAdventureEditorSession);
  const autoOpenAttempted = useRef(false);
  const [maps, setMaps] = useState<MapSummary[] | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<MapPayload | null>(null);
  const [name, setName] = useState("");
  const [cols, setCols] = useState(DEFAULT_COLS);
  const [rows, setRows] = useState(DEFAULT_ROWS);
  const [error, setError] = useState<string | null>(null);

  // refresh() only closes over stable setState setters; running it once on mount is the point —
  // depending on it would refetch every render, since it is redefined each render.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional mount-only fetch
  useEffect(() => {
    refresh();
  }, []);

  // `open` intentionally closes over stable setters. Depending on the render-local function would
  // repeat the request on every render.
  // biome-ignore lint/correctness/useExhaustiveDependencies: one contextual auto-open
  useEffect(() => {
    if (
      maps === null ||
      selected !== null ||
      returnContext?.screen !== "adventure" ||
      returnContext.mapId === null ||
      autoOpenAttempted.current
    ) {
      return;
    }
    autoOpenAttempted.current = true;
    void open(returnContext.mapId);
  }, [maps, returnContext, selected]);

  /** A session problem leaves the screen entirely, exactly like `CharacterSelect`'s initial
   *  fetch does (store.ts's `setScreen("auth")`). Anything else becomes a visible error rather
   *  than silence: returns true when the caller should stop (session gone), false otherwise. */
  function fail(caught: unknown): boolean {
    const code = errorCode(caught);
    if (isSessionError(code)) {
      setScreen("auth");
      return true;
    }
    setError(code);
    return false;
  }

  async function refresh(): Promise<void> {
    try {
      setMaps(await fetchMaps());
    } catch (caught) {
      // A failure here must never leave `maps` null: that is the one state the render below
      // treats as "still loading" and renders nothing for — no error, no Back, stranded.
      if (!fail(caught)) setMaps((current) => current ?? []);
    }
  }

  async function create(): Promise<void> {
    setError(null);
    try {
      const created = await createMapApi(blankMap(name.trim(), cols, rows));
      setName("");
      if (returnContext?.screen === "adventure" && returnContext.addCreatedMap) {
        returnToAdventure(created);
        return;
      }
      await refresh();
      setSelected(created);
    } catch (caught) {
      fail(caught);
    }
  }

  async function open(id: string): Promise<void> {
    try {
      setSelected(await fetchMap(id));
    } catch (caught) {
      fail(caught);
    }
  }

  async function remove(id: string): Promise<void> {
    try {
      await deleteMapApi(id);
      setConfirmingId(null);
      await refresh();
    } catch (caught) {
      fail(caught);
      setConfirmingId(null);
    }
  }

  async function makeFirst(id: string): Promise<void> {
    try {
      await flagFirstMapApi(id);
      await refresh();
    } catch (caught) {
      fail(caught);
    }
  }

  function draftMember(map: MapPayload): DraftMemberInfo {
    return {
      mapId: map.id,
      name: map.name,
      revision: map.revision,
      blocks: map.blocks,
      monsterCount: map.markers.monsterSpawns.length,
      entryIds: map.markers.entries.map((marker) => marker.id),
      exitIds: map.markers.exits.map((marker) => marker.id),
      entryLabels: Object.fromEntries(
        map.markers.entries.flatMap((marker) =>
          marker.label ? [[marker.id, marker.label] as const] : [],
        ),
      ),
      exitLabels: Object.fromEntries(
        map.markers.exits.flatMap((marker) =>
          marker.label ? [[marker.id, marker.label] as const] : [],
        ),
      ),
    };
  }

  function returnToAdventure(updated?: MapPayload): void {
    const context = useUiStore.getState().editorReturnContext;
    const session = useUiStore.getState().adventureEditorSession;
    if (context?.screen !== "adventure" || !session || session.draftId !== context.draftId) {
      setSelected(null);
      return;
    }
    if (updated) {
      const refreshed = refreshMember(session.draft, draftMember(updated));
      setAdventureEditorSession({
        ...session,
        draft: refreshed.draft,
        invalidatedLinks: [...session.invalidatedLinks, ...refreshed.invalidated],
      });
    }
    setReturnContext(null);
    setScreen("adventures");
  }

  // The painting stage draws onto the shared #stage canvas, which sits behind #root; the toolbar
  // is the only chrome, floated over it, so the map stays visible while you edit.
  if (selected) {
    return (
      <MapEditorStage
        map={selected}
        onExit={() => {
          if (returnContext?.screen === "adventure") {
            returnToAdventure();
            return;
          }
          setSelected(null);
          void refresh();
        }}
        {...(returnContext?.screen === "adventure" ? { onSaved: returnToAdventure } : {})}
      />
    );
  }

  if (maps === null) return null;

  const deleting = maps.find((map) => map.id === confirmingId);

  return (
    <main className="roster-shell">
      <header className="roster-header">
        <div>
          <span className="eyebrow">{t("editor.title")}</span>
          <h1>{t("editor.title")}</h1>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            returnContext?.screen === "adventure" ? returnToAdventure() : setScreen("parties")
          }
        >
          {t("editor.back")}
        </Button>
      </header>

      {error && <p role="alert">{authErrorText(error)}</p>}

      <AssetBrowser />

      <section className="roster-grid" aria-label={t("editor.title")}>
        {maps.map((map) => (
          <article key={map.id} className="roster-card framed">
            <div className="roster-card__identity">
              <h2>{map.name}</h2>
              {map.isFirst && <span>{t("editor.first")}</span>}
            </div>
            <div className="roster-card__actions">
              <Button type="button" onClick={() => void open(map.id)}>
                {t("editor.open")}
              </Button>
              {!map.isFirst && (
                <Button type="button" variant="secondary" onClick={() => void makeFirst(map.id)}>
                  {t("editor.makeFirst")}
                </Button>
              )}
              <Button type="button" variant="secondary" onClick={() => setConfirmingId(map.id)}>
                {t("editor.delete")}
              </Button>
            </div>
          </article>
        ))}
      </section>

      <section className="roster-card framed" aria-label={t("editor.new")}>
        <h2>{t("editor.new")}</h2>
        <Label htmlFor="map-editor-name">{t("editor.name")}</Label>
        <Input
          id="map-editor-name"
          type="text"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
        />
        <Label htmlFor="map-editor-cols">{t("editor.cols")}</Label>
        <Input
          id="map-editor-cols"
          type="number"
          min={MIN_COLS}
          max={MAX_COLS}
          value={cols}
          onChange={(event) => setCols(Number(event.currentTarget.value))}
        />
        <Label htmlFor="map-editor-rows">{t("editor.rows")}</Label>
        <Input
          id="map-editor-rows"
          type="number"
          min={MIN_ROWS}
          max={MAX_ROWS}
          value={rows}
          onChange={(event) => setRows(Number(event.currentTarget.value))}
        />
        <Button type="button" onClick={() => void create()}>
          {t("editor.save")}
        </Button>
      </section>

      {deleting && (
        <div className="delete-dialog-backdrop">
          <section
            className="delete-dialog parchment framed"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-map-title"
          >
            <h2 id="delete-map-title">{t("editor.delete.title", { name: deleting.name })}</h2>
            <div className="delete-dialog__actions">
              <Button type="button" variant="secondary" onClick={() => setConfirmingId(null)}>
                {t("editor.delete.cancel")}
              </Button>
              <Button type="button" className="danger" onClick={() => void remove(deleting.id)}>
                {t("editor.delete.confirm")}
              </Button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
