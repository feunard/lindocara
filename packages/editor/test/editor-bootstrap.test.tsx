import { setLocale, t } from "@lindocara/client/i18n.js";
import { adventureEditorSessionAtom } from "@lindocara/client/state/atoms.js";
import { AdventureEditorScreen } from "@lindocara/editor/ui/editor/AdventureEditorScreen.js";
import { EMPTY_MARKERS } from "@lindocara/engine/map-data.js";
import { layersFromBlocks } from "@lindocara/engine/map-migrate.js";
import { encodeTileLayer } from "@lindocara/engine/tile-layer-codec.js";
import { TINY_SWORDS_TILESET_ID } from "@lindocara/engine/tilesets/tiny-swords.js";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Alepha } from "alepha";
import { AlephaContext, AlephaReact } from "alepha/react";
import { AlephaReactI18n } from "alepha/react/i18n";
import { ReactRouter } from "alepha/react/router";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** `AdventureEditorScreen` reads `adventureEditorSessionAtom` and calls `useRouter()` directly (Task
 *  6) — both need a real Alepha instance with `AlephaReact` registered to mount at all. A bare
 *  `AlephaReact` (no full `AppRouter` page tree) is enough, but `ReactRouter` still has to be
 *  injected HERE, before `start()` locks the container: a component's first `useRouter()` call
 *  happens after that lock, and `alepha.react.router`'s module is only ever registered by touching
 *  one of its services first (mirrors `AppRouter`'s own eager `reactAuth = $inject(ReactAuth)`
 *  field — see its docblock).
 *
 *  This mounts by hand instead of using `renderWithAlepha`, and the ordering is load-bearing: it must
 *  match `ReactPageProvider.root` (`.vendor/alepha/src/react/router/providers/ReactPageProvider.ts`),
 *  which wraps `<StrictMode>` OUTSIDE `<AlephaContext.Provider>` — the real router root every `$page`
 *  (including `editor`) mounts under, with `strictMode` defaulting `true` and never overridden in this
 *  app. `renderWithAlepha`'s own `wrapper` option nests the opposite way (inside the Alepha provider),
 *  which does not reproduce React's real mount→cleanup→mount dance in this environment. Composing the
 *  tree in the ORDER THE APP ACTUALLY USES is what makes the entry path strict-mode-tested for real:
 *  the sandbox is minted in an effect, and a second invocation would discard the first one's map. */
async function mountScreen() {
  // `AlephaReactI18n` for the same reason `AppRouter` eagerly injects `I18nProvider` (see its
  // docblock): the screen mounts `@alepha/ui`'s `DialogProvider`, whose `useI18n()` would otherwise
  // first reach `I18nProvider` mid-render, after the lock below.
  const alepha = Alepha.create().with(AlephaReact).with(AlephaReactI18n);
  // Spied BEFORE the render: the resume path pushes its adventure's URL from the mount effect, so a
  // spy installed afterwards would miss the call it exists to observe.
  const pushSpy = vi.spyOn(alepha.inject(ReactRouter<object>), "push").mockResolvedValue(undefined);
  await alepha.start();
  const result = render(
    <StrictMode>
      <AlephaContext.Provider value={alepha}>
        <AdventureEditorScreen />
      </AlephaContext.Provider>
    </StrictMode>,
  );
  return { ...result, alepha, pushSpy };
}

/** The sandbox map is mounted straight into the stage, so entry now reaches it — a bare `vi.fn()`
 *  would return `undefined` where the screen calls `.then()`. Only the calls the open path makes
 *  are needed. */
const stageMock = vi.hoisted(() => ({ openMapEditorStage: vi.fn() }));
vi.mock("@lindocara/editor/game/map-editor-stage.js", () => ({
  openMapEditorStage: stageMock.openMapEditorStage,
  defaultDimForMode: (mode: string) => mode !== "field",
}));
vi.mock("@lindocara/editor/game/map-preview.js", () => ({ startMapPreview: vi.fn() }));

function stageHandle() {
  return {
    setTool: vi.fn(),
    setActiveMode: vi.fn(),
    setDim: vi.fn(),
    setGrid: vi.fn(),
    setCollisions: vi.fn(),
    setZoom: vi.fn(),
    // Read during render (the inspector's live map), so it must answer with a map, not undefined.
    current: vi.fn(() => ({
      name: "Sandbox",
      layers: [],
      elements: [],
      spawn: { col: 0, row: 0 },
      markers: EMPTY_MARKERS,
      events: [],
    })),
    replaceMap: vi.fn(),
    setName: vi.fn(),
    setAudio: vi.fn(),
    setHeroSettings: vi.fn(),
    setLighting: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    markSaved: vi.fn(),
    selected: vi.fn(() => null),
    clearSelection: vi.fn(),
    moveSelected: vi.fn(),
    setSelectedElementAsset: vi.fn(),
    deleteSelected: vi.fn(),
    beginEventDraft: vi.fn(),
    commitEventDraft: vi.fn(),
    deleteEvent: vi.fn(),
    highlightEvent: vi.fn(),
    selectEvent: vi.fn(),
    dispose: vi.fn(),
  };
}

/** The listing a bare `/editor` reads to decide whether there is anything to resume. Empty is the
 *  fresh-account case and the one the sandbox tests want; `withAdventure` is the resume case.
 *  `scope=mine` is the owner-scoped listing, not the default one: an admin's default listing is
 *  every author's adventures, and resume must stay on the caller's own. */
const RESUME_LISTING = "/api/adventures?scope=mine";

function emptyListing() {
  return vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (url === RESUME_LISTING && method === "GET") return Promise.resolve(jsonResponse([]));
    return Promise.resolve(jsonResponse({ error: "not_found" }, 404));
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const RESUMED_LAYERS = layersFromBlocks(
  Array.from({ length: 15 }, () => ".".repeat(20)),
).layers.map(encodeTileLayer);

/** A backend holding exactly one adventure, most-recently-worked-on first (the server's order). */
function withAdventure() {
  const adventure = {
    id: "adv-resume",
    accountId: "u1",
    title: "Resumed",
    maxPlayers: 4,
    version: 1,
    mapIds: ["map-resume"],
    graph: { start: null, links: [] },
    registry: { switches: [], variables: [] },
    startMapId: null,
  };
  const map = {
    id: "map-resume",
    name: "Resumed map",
    revision: 3,
    heightfield: null,
    dayNightCycle: true,
    fixedLighting: "day",
    tilesetId: TINY_SWORDS_TILESET_ID,
    cols: 20,
    rows: 15,
    layers: RESUMED_LAYERS,
    elements: [],
    spawn: { col: 10, row: 7 },
    markers: EMPTY_MARKERS,
    events: [],
  };
  return vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (url === RESUME_LISTING && method === "GET")
      return Promise.resolve(
        jsonResponse([
          { id: "adv-resume", title: "Resumed", maxPlayers: 4, mapCount: 1, playable: true },
        ]),
      );
    if (url === "/api/adventures/adv-resume" && method === "GET")
      return Promise.resolve(jsonResponse(adventure));
    if (url === "/api/maps/map-resume" && method === "GET")
      return Promise.resolve(jsonResponse(map));
    if (url.startsWith("/api/maps?adventure=") && method === "GET")
      return Promise.resolve(
        jsonResponse([
          {
            id: "map-resume",
            name: "Resumed map",
            author: "MapMaker",
            revision: 3,
            cols: 20,
            rows: 15,
            isFirst: true,
          },
        ]),
      );
    return Promise.resolve(jsonResponse({ error: "not_found" }, 404));
  });
}

/** Every write a fetch mock saw. Entry must stay read-only: it resumes or mints a local sandbox,
 *  and neither creates a row. Untitled adventures used to accumulate one per visit. */
function writes(mock: ReturnType<typeof emptyListing>): unknown[] {
  return mock.mock.calls.filter(
    ([, init]) => ((init as RequestInit | undefined)?.method ?? "GET") !== "GET",
  );
}

describe("AdventureEditorScreen sandbox entry", () => {
  let alephaInstances: Array<{ stop(): Promise<void> }> = [];

  beforeEach(() => {
    setLocale("en");
    localStorage.clear();
    stageMock.openMapEditorStage.mockReset();
    stageMock.openMapEditorStage.mockResolvedValue(stageHandle());
  });

  afterEach(async () => {
    for (const alepha of alephaInstances) await alepha.stop();
    alephaInstances = [];
  });

  it("opens a local sandbox on entry, writing nothing and never rendering a picker", async () => {
    const mock = emptyListing();
    vi.stubGlobal("fetch", mock);

    const { alepha } = await mountScreen();
    alephaInstances.push(alepha);

    await waitFor(() => expect(alepha.store.get(adventureEditorSessionAtom)).not.toBeNull());
    const session = alepha.store.get(adventureEditorSessionAtom);
    // The whole point of the sandbox: entering the editor creates no adventure row. Untitled rows
    // used to accumulate one per visit, and nothing ever cleaned them up.
    expect(session?.adventureId).toBeNull();
    expect(session?.sandboxMap).toBeDefined();
    expect(session?.titleUntouched).toBe(true);
    // Entry now ASKS whether there is anything to resume: one GET, and nothing written. An empty
    // account is not a failure, so the answer "none" opens the sandbox exactly as before.
    expect(mock.mock.calls.map(([url]) => url)).toEqual([RESUME_LISTING]);
    expect(writes(mock)).toHaveLength(0);
    // Strict mode double-invokes the mount effect; a second sandbox would discard this one's map.
    await waitFor(() => expect(stageMock.openMapEditorStage).toHaveBeenCalled());
    expect(alepha.store.get(adventureEditorSessionAtom)?.sandboxMap?.id).toBe(
      session?.sandboxMap?.id,
    );
  });

  it("mounts the sandbox's own map in the stage, with no map request", async () => {
    const mock = emptyListing();
    vi.stubGlobal("fetch", mock);

    const { alepha } = await mountScreen();
    alephaInstances.push(alepha);

    await waitFor(() => expect(stageMock.openMapEditorStage).toHaveBeenCalledTimes(1));
    const opened = stageMock.openMapEditorStage.mock.calls[0]?.[0] as { name: string };
    expect(opened.name).toBe(alepha.store.get(adventureEditorSessionAtom)?.sandboxMap?.name);
    // No `/api/maps?adventure=…` list and no map fetch: there is nothing stored to fetch. The
    // resume lookup is the only request entry makes.
    expect(mock.mock.calls.map(([url]) => url)).toEqual([RESUME_LISTING]);
  });

  it("resumes the account's most recent adventure and puts it in the URL", async () => {
    const mock = withAdventure();
    vi.stubGlobal("fetch", mock);

    const { alepha, pushSpy } = await mountScreen();
    alephaInstances.push(alepha);

    await waitFor(() =>
      expect(alepha.store.get(adventureEditorSessionAtom)?.adventureId).toBe("adv-resume"),
    );
    // The address bar follows what is open, so a reload reopens the same adventure through the deep
    // link. `replace`, because the author never navigated here: Back leaves the editor.
    await waitFor(() =>
      expect(pushSpy).toHaveBeenCalledWith("/editor/adv-resume", { replace: true }),
    );
    const session = alepha.store.get(adventureEditorSessionAtom);
    // A resumed session is a real adventure, not a sandbox wearing its name: no `sandboxMap`, and a
    // `savedDraft` snapshot to diff unsaved edits against.
    expect(session?.sandboxMap).toBeUndefined();
    expect(session?.savedDraft).not.toBeNull();
    expect(session?.draft.title).toBe("Resumed");
    expect(writes(mock)).toHaveLength(0);
  });

  it("falls back to a sandbox, quietly, when the listing cannot be read", async () => {
    // Offline, signed out, a 500: nobody NAMED an adventure here, so this is not the deep link's
    // "that link is broken" case. The author gets somewhere to draw.
    const mock = vi.fn(() => Promise.reject(new Error("offline")));
    vi.stubGlobal("fetch", mock);

    const { alepha } = await mountScreen();
    alephaInstances.push(alepha);

    await waitFor(() => expect(alepha.store.get(adventureEditorSessionAtom)).not.toBeNull());
    expect(alepha.store.get(adventureEditorSessionAtom)?.adventureId).toBeNull();
    expect(alepha.store.get(adventureEditorSessionAtom)?.sandboxMap).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("opens another sandbox from File → New adventure, still writing nothing", async () => {
    const mock = emptyListing();
    vi.stubGlobal("fetch", mock);

    const { alepha } = await mountScreen();
    alephaInstances.push(alepha);
    await waitFor(() => expect(alepha.store.get(adventureEditorSessionAtom)).not.toBeNull());
    const first = alepha.store.get(adventureEditorSessionAtom);

    // The File-menu idiom used throughout `editor-shell.test.tsx`: focus the trigger, press Enter,
    // then click the item. A plain click on the trigger does not open this menubar.
    screen.getByRole("menuitem", { name: t("editor.shell.menu.file") }).focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.click(
      await screen.findByRole("menuitem", { name: t("editor.shell.newAdventure") }),
    );

    await waitFor(() =>
      expect(alepha.store.get(adventureEditorSessionAtom)?.draftId).not.toBe(first?.draftId),
    );
    const second = alepha.store.get(adventureEditorSessionAtom);
    expect(second?.adventureId).toBeNull();
    expect(second?.sandboxMap?.id).not.toBe(first?.sandboxMap?.id);
    expect(writes(mock)).toHaveLength(0);
  });
});
