import { useEffect, useState } from "react";
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
} from "../api.js";
import { blankMap } from "../game/editor-state.js";
import { t, useLocale } from "../i18n.js";
import { useUiStore } from "../store.js";
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

/**
 * List mode only (Task 9): fetch, create, delete, and flag the front door. Opening a map sets
 * `selected` and shows a stub panel — the obvious seam Task 10 fills in with the real painting
 * canvas and `mapEditor` stage handle.
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

  if (selected) {
    const rowCount = selected.blocks.length;
    const colCount = selected.blocks[0]?.length ?? 0;
    return (
      <main className="roster-shell">
        <header className="roster-header">
          <div>
            <span className="eyebrow">{t("editor.title")}</span>
            <h1>{selected.name}</h1>
            <p>
              {t("editor.cols")}: {colCount} · {t("editor.rows")}: {rowCount}
            </p>
          </div>
          <Button type="button" variant="secondary" onClick={() => setSelected(null)}>
            {t("editor.back")}
          </Button>
        </header>
        <section className="framed" aria-label={selected.name}>
          <p>{t("editor.preview")}</p>
          <div className="map-editor-canvas-placeholder" aria-hidden="true" />
        </section>
      </main>
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
