import { useEffect, useRef, useState } from "react";
import { EMPTY_MARKERS, type MapData } from "../../shared/map-data.js";
import type { EditorAssetId } from "../../shared/tiny-swords-catalog.js";
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
import type { EditorMap, EditorTool } from "../game/editor-state.js";
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

const TOOL_KEYS = ["grass", "water", "eraser", "spawn", "pan"] as const;
type ToolKey = (typeof TOOL_KEYS)[number];

function toolFor(key: ToolKey): EditorTool {
  switch (key) {
    case "grass":
      return { kind: "block", block: "grass" };
    case "water":
      return { kind: "block", block: "water" };
    case "eraser":
      return { kind: "eraser" };
    case "spawn":
      return { kind: "spawn" };
    case "pan":
      return { kind: "pan" };
  }
}

/**
 * Editing mode: the React toolbar over the Pixi painting stage. React owns the tool selection, the
 * name and the Save/Back chrome; the stage owns the canvas. They meet only through the
 * `MapEditorStageHandle` — no React reaches into Pixi, no Pixi string reaches into React.
 */
function MapEditorStage({ map, onExit }: { map: MapPayload; onExit: () => void }) {
  useLocale();
  const setScreen = useUiStore((state) => state.setScreen);
  const handleRef = useRef<MapEditorStageHandle | null>(null);
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

  // The painting stage. Not mounted while previewing — the sandbox owns the one `#stage` app then —
  // and reopened from the captured edits when the preview ends. Opening is async (it loads textures):
  // if this screen unmounts or a preview starts before the stage resolves, it is still disposed.
  useEffect(() => {
    if (previewing) return;
    let cancelled = false;
    openMapEditorStage(editedRef.current ?? toEditorMap(map), (changed) => {
      setError(null);
      setElementCount(changed.elements.length);
    })
      .then((handle) => {
        if (cancelled) {
          handle.dispose();
          return;
        }
        handleRef.current = handle;
      })
      .catch((caught) => {
        // A failed stage build (WebGL/texture load) must not strand the screen with a blank canvas
        // and no way out: surface the error and leave the toolbar's Back usable, exactly like the
        // list view's failed load. Save no-ops while the handle is null.
        if (!cancelled) setError(errorCode(caught));
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
    const data: MapData = { blocks: edited.blocks, elements: edited.elements, spawn: edited.spawn };
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
    setToolKey(key);
    setSelectedAsset(null);
    handleRef.current?.setTool(toolFor(key));
  }

  function selectAsset(assetId: EditorAssetId): void {
    setToolKey(null);
    setSelectedAsset(assetId);
    handleRef.current?.setTool({ kind: "element", assetId });
  }

  function rename(value: string): void {
    setName(value);
    handleRef.current?.setName(value);
  }

  async function save(): Promise<void> {
    const handle = handleRef.current;
    if (!handle || saving) return;
    setSaving(true);
    setError(null);
    try {
      await updateMapApi(map.id, handle.current());
    } catch (caught) {
      const code = errorCode(caught);
      if (isSessionError(code)) setScreen("auth");
      else setError(code);
    } finally {
      setSaving(false);
    }
  }

  if (previewing) return <MapPreviewHint />;

  return (
    <div className="map-editor-toolbar">
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
        <Button type="button" onClick={() => void save()} disabled={saving}>
          {t("editor.save")}
        </Button>
        <Button type="button" variant="secondary" onClick={startPreview}>
          {t("editor.preview")}
        </Button>
        <Button type="button" variant="secondary" onClick={onExit}>
          {t("editor.back")}
        </Button>
      </div>

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

  // The painting stage draws onto the shared #stage canvas, which sits behind #root; the toolbar
  // is the only chrome, floated over it, so the map stays visible while you edit.
  if (selected) {
    return (
      <MapEditorStage
        map={selected}
        onExit={() => {
          setSelected(null);
          void refresh();
        }}
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
        <Button type="button" variant="secondary" onClick={() => setScreen("characters")}>
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
