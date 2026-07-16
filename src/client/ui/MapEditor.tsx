import { useEffect, useRef, useState } from "react";
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
import { openMapEditorStage } from "../game/map-editor-stage.js";
import { t, useLocale } from "../i18n.js";
import { type MapEditorStageHandle, useUiStore } from "../store.js";
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
  return { name: map.name, blocks: map.blocks, elements: map.elements, spawn: map.spawn };
}

/** The toolbar's buttons, in order. Element tools carry no variant here: the current variant is
 *  folded in when a button is clicked, so one counter cycles whichever element kind is selected. */
const TOOL_KEYS = ["grass", "water", "tree", "bush", "stone", "eraser", "spawn"] as const;
type ToolKey = (typeof TOOL_KEYS)[number];

function isElementTool(key: ToolKey): boolean {
  return key === "tree" || key === "bush" || key === "stone";
}

/** The `EditorTool` a toolbar button stands for, with the live `variant` folded into element tools
 *  so the stage draws (and `applyTool` validates) the currently selected sprite. */
function toolFor(key: ToolKey, variant: number): EditorTool {
  switch (key) {
    case "grass":
      return { kind: "block", block: "grass" };
    case "water":
      return { kind: "block", block: "water" };
    case "tree":
      return { kind: "element", element: "tree", variant };
    case "bush":
      return { kind: "element", element: "bush", variant };
    case "stone":
      return { kind: "element", element: "stone", variant };
    case "eraser":
      return { kind: "eraser" };
    case "spawn":
      return { kind: "spawn" };
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
  const setMapEditor = useUiStore((state) => state.setMapEditor);
  const handleRef = useRef<MapEditorStageHandle | null>(null);
  const [toolKey, setToolKey] = useState<ToolKey>("grass");
  const [variant, setVariant] = useState(0);
  const [name, setName] = useState(map.name);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Opening is async (it loads textures): if this screen unmounts before the stage resolves, the
  // stage still gets disposed. Re-runs only when the opened map's identity changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional per-map open, stable setters
  useEffect(() => {
    let cancelled = false;
    openMapEditorStage(toEditorMap(map), () => setError(null)).then((handle) => {
      if (cancelled) {
        handle.dispose();
        return;
      }
      handleRef.current = handle;
      setMapEditor(handle);
    });
    return () => {
      cancelled = true;
      handleRef.current?.dispose();
      handleRef.current = null;
      setMapEditor(null);
    };
  }, [map]);

  function selectTool(key: ToolKey): void {
    setToolKey(key);
    handleRef.current?.setTool(toolFor(key, variant));
  }

  function cycleVariant(): void {
    const next = variant + 1;
    setVariant(next);
    if (isElementTool(toolKey)) handleRef.current?.setTool(toolFor(toolKey, next));
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
        <Button
          type="button"
          variant="secondary"
          disabled={!isElementTool(toolKey)}
          onClick={cycleVariant}
        >
          {t("editor.tool.variant")}
        </Button>
      </div>

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
        <Button type="button" variant="secondary" onClick={onExit}>
          {t("editor.back")}
        </Button>
      </div>

      {error && <p role="alert">{authErrorText(error)}</p>}
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
