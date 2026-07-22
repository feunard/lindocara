import { emptyDraft } from "@lindocara/client/adventure-draft.js";
import type { MapPayload, MapSummary } from "@lindocara/client/api.js";
import { setLocale, t } from "@lindocara/client/i18n.js";
import { useUiStore } from "@lindocara/client/store.js";
import { MainMenu } from "@lindocara/client/ui/MainMenu.js";
import { defaultEventPage, toMapData, toSaveInput } from "@lindocara/editor/game/editor-state.js";
import { AdventureEditorScreen } from "@lindocara/editor/ui/editor/AdventureEditorScreen.js";
import { EMPTY_MARKERS } from "@lindocara/engine/map-data.js";
import { layersFromBlocks } from "@lindocara/engine/map-migrate.js";
import { encodeTileLayer } from "@lindocara/engine/tile-layer-codec.js";
import { TINY_SWORDS_TILESET_ID } from "@lindocara/engine/tilesets/tiny-swords.js";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The painting stage is Pixi on a real canvas — untestable in jsdom. A fake handle stands in so the
// tests exercise the shell's own behaviour: which EditorTool it pushes, that the mode selector
// reaches setActiveMode, and that mount/unmount open and dispose the stage exactly once each.
const stageMock = vi.hoisted(() => ({
  openMapEditorStage: vi.fn(),
  setTool: vi.fn(),
  setActiveMode: vi.fn(),
  setDim: vi.fn(),
  setGrid: vi.fn(),
  setCollisions: vi.fn(),
  setZoom: vi.fn(),
  current: vi.fn(),
  setName: vi.fn(),
  undo: vi.fn(),
  redo: vi.fn(),
  markSaved: vi.fn(),
  selected: vi.fn(),
  moveSelected: vi.fn(),
  setSelectedElementAsset: vi.fn(),
  deleteSelected: vi.fn(),
  beginEventDraft: vi.fn(),
  commitEventDraft: vi.fn(),
  deleteEvent: vi.fn(),
  highlightEvent: vi.fn(),
  selectEvent: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock("@lindocara/editor/game/map-editor-stage.js", () => ({
  openMapEditorStage: stageMock.openMapEditorStage,
  // The screen calls this pure helper to pick the per-mode dim default (D12); mirror its real rule.
  defaultDimForMode: (mode: string) => mode !== "field",
}));

function stageHandle() {
  return {
    setTool: stageMock.setTool,
    setActiveMode: stageMock.setActiveMode,
    setDim: stageMock.setDim,
    setGrid: stageMock.setGrid,
    setCollisions: stageMock.setCollisions,
    setZoom: stageMock.setZoom,
    current: stageMock.current,
    setName: stageMock.setName,
    undo: stageMock.undo,
    redo: stageMock.redo,
    markSaved: stageMock.markSaved,
    selected: stageMock.selected,
    moveSelected: stageMock.moveSelected,
    setSelectedElementAsset: stageMock.setSelectedElementAsset,
    deleteSelected: stageMock.deleteSelected,
    beginEventDraft: stageMock.beginEventDraft,
    commitEventDraft: stageMock.commitEventDraft,
    deleteEvent: stageMock.deleteEvent,
    highlightEvent: stageMock.highlightEvent,
    selectEvent: stageMock.selectEvent,
    dispose: stageMock.dispose,
  };
}

const previewMock = vi.hoisted(() => ({ startMapPreview: vi.fn(), stop: vi.fn() }));
vi.mock("@lindocara/editor/game/map-preview.js", () => ({
  startMapPreview: previewMock.startMapPreview,
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const OPEN_TILE_LAYERS = layersFromBlocks(Array.from({ length: 30 }, () => ".".repeat(40))).layers;
const OPEN_LAYERS = OPEN_TILE_LAYERS.map(encodeTileLayer);

const oneMap: MapSummary[] = [
  { id: "m1", name: "Verdant Reach", revision: 1, cols: 40, rows: 30, isFirst: true },
];

const twoMaps: MapSummary[] = [
  { id: "m1", name: "Verdant Reach", revision: 1, cols: 40, rows: 30, isFirst: true },
  { id: "m2", name: "Frostfen", revision: 1, cols: 40, rows: 30, isFirst: false },
];

const threeMaps: MapSummary[] = [
  ...twoMaps,
  { id: "m3", name: "Ashen Keep", revision: 1, cols: 40, rows: 30, isFirst: false },
];

function payloadFor(summary: MapSummary): MapPayload {
  return {
    id: summary.id,
    name: summary.name,
    revision: summary.revision,
    tilesetId: TINY_SWORDS_TILESET_ID,
    cols: 40,
    rows: 30,
    layers: OPEN_LAYERS,
    elements: [],
    spawn: { col: 20, row: 15 },
    markers: EMPTY_MARKERS,
    events: [],
  };
}

/** A tiny fake /api/maps* backend for the auto-open: list, then open the first map. */
function mapsFetchMock(maps: MapSummary[] = oneMap) {
  return vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (url.startsWith("/api/maps?adventure=") && method === "GET")
      return Promise.resolve(jsonResponse(maps));
    const idMatch = url.match(/^\/api\/maps\/([^/]+)$/);
    const summary = idMatch?.[1] ? maps.find((m) => m.id === idMatch[1]) : undefined;
    if (summary && method === "GET") return Promise.resolve(jsonResponse(payloadFor(summary)));
    return Promise.resolve(jsonResponse({ error: "map_not_found" }, 404));
  });
}

/** A fuller /api/maps* backend that also answers create/update/delete, so the merged shell's save,
 *  the map panel's new-map dialog and its delete-with-confirm can be driven end to end. */
function mapsBackend(maps: MapSummary[] = twoMaps) {
  const list = maps.map((m) => ({ ...m }));
  return vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (url.startsWith("/api/maps?adventure=") && method === "GET")
      return Promise.resolve(jsonResponse(list));
    if (url === "/api/maps" && method === "POST") {
      const created: MapPayload = {
        id: "new",
        name: "New map",
        revision: 1,
        tilesetId: TINY_SWORDS_TILESET_ID,
        cols: 40,
        rows: 30,
        layers: OPEN_LAYERS,
        elements: [],
        spawn: { col: 20, row: 15 },
        markers: EMPTY_MARKERS,
        events: [],
      };
      list.push({ id: "new", name: "New map", revision: 1, cols: 40, rows: 30, isFirst: false });
      return Promise.resolve(jsonResponse(created, 201));
    }
    const idMatch = url.match(/^\/api\/maps\/([^/]+)$/);
    if (idMatch?.[1]) {
      const summary = list.find((m) => m.id === idMatch[1]);
      if (method === "GET") {
        if (!summary) return Promise.resolve(jsonResponse({ error: "map_not_found" }, 404));
        return Promise.resolve(jsonResponse(payloadFor(summary)));
      }
      if (method === "PUT") {
        const body: unknown = JSON.parse(String(init?.body ?? "{}"));
        return Promise.resolve(jsonResponse({ id: idMatch[1], revision: 2, ...(body as object) }));
      }
      if (method === "DELETE") {
        const index = list.findIndex((m) => m.id === idMatch[1]);
        if (index >= 0) list.splice(index, 1);
        return Promise.resolve(new Response(null, { status: 204 }));
      }
    }
    return Promise.resolve(jsonResponse({ error: "map_not_found" }, 404));
  });
}

/** Mounts the shell and waits until the (fake) stage is wired, so a following toolbar action
 *  actually reaches the handle. */
async function mountReady(): Promise<ReturnType<typeof render>> {
  const rendered = render(<AdventureEditorScreen />);
  await waitFor(() => expect(stageMock.openMapEditorStage).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(stageMock.setTool).toHaveBeenCalled());
  return rendered;
}

/** The status strip: its mode echo (`t("editor.shell.mode.*")`) renders the same text as the
 *  toolbar's mode segment, so a query for it must scope here rather than use a bare `getByText`. */
function statusBar(rendered: { container: HTMLElement }): HTMLElement {
  const bar = rendered.container.querySelector(".border-t.border-zinc-200.bg-zinc-50");
  if (!bar) throw new Error("status bar not found");
  return bar as HTMLElement;
}

describe("AdventureEditorScreen shell", () => {
  beforeEach(() => {
    setLocale("en");
    // A map belongs to one adventure, so the editor loads maps for the session's adventure. Seed a
    // loaded adventure so the auto-open fetches `/api/maps?adventure=adv-1` and mounts the stage.
    useUiStore.setState({
      screen: "adventure-editor",
      adventureEditorSession: {
        adventureId: "adv-1",
        draftId: "draft-1",
        draft: emptyDraft(),
        invalidatedLinks: [],
        savedDraft: null,
      },
    });
    for (const fn of Object.values(stageMock)) fn.mockReset();
    stageMock.openMapEditorStage.mockResolvedValue(stageHandle());
    stageMock.current.mockReturnValue({
      name: "Verdant Reach",
      layers: [],
      elements: [],
      spawn: { col: 20, row: 15 },
      markers: EMPTY_MARKERS,
      events: [],
    });
    previewMock.startMapPreview.mockReset();
    previewMock.startMapPreview.mockResolvedValue({ stop: previewMock.stop });
  });

  it("pushes the matching EditorTool for each toolbar tool button", async () => {
    vi.stubGlobal("fetch", mapsFetchMock());
    await mountReady();

    await userEvent.click(screen.getByRole("button", { name: t("editor.shell.tool.select") }));
    expect(stageMock.setTool).toHaveBeenLastCalledWith({ kind: "select" });

    await userEvent.click(screen.getByRole("button", { name: t("editor.shell.tool.pencil") }));
    expect(stageMock.setTool).toHaveBeenLastCalledWith({ kind: "block", block: "grass" });

    await userEvent.click(screen.getByRole("button", { name: t("editor.shell.tool.rect") }));
    expect(stageMock.setTool).toHaveBeenLastCalledWith({
      kind: "rect",
      content: { kind: "block", block: "grass" },
    });

    await userEvent.click(screen.getByRole("button", { name: t("editor.shell.tool.fill") }));
    expect(stageMock.setTool).toHaveBeenLastCalledWith({
      kind: "fill",
      content: { kind: "block", block: "grass" },
    });

    await userEvent.click(screen.getByRole("button", { name: t("editor.tool.eraser") }));
    expect(stageMock.setTool).toHaveBeenLastCalledWith({ kind: "eraser" });
  });

  it("mounts the shell under the light-only editor scope (UX wave #1)", async () => {
    vi.stubGlobal("fetch", mapsFetchMock());
    const { container } = await mountReady();
    // The whole shell hangs off `.editor-root`, the hook legacy.css scopes color-scheme:light and the
    // light shadcn tokens to (the token resolution itself is css:false here — verified visually in the
    // real-browser campaign). If the hook class is ever renamed/dropped, the light scope silently
    // stops applying, so pin it.
    const root = container.querySelector(".editor-root");
    expect(root).not.toBeNull();
    expect(root).toHaveClass("editor-root");
  });

  it("opens the stage grid-on by default (UX wave #8)", async () => {
    vi.stubGlobal("fetch", mapsFetchMock());
    await mountReady();
    // The stage is told to show the grid the moment it is wired…
    await waitFor(() => expect(stageMock.setGrid).toHaveBeenCalledWith(true));
    // …and the toolbar's grid toggle reflects it as pressed.
    expect(screen.getByRole("button", { name: t("editor.shell.grid.aria") })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("D18: the collision overlay toggle is off by default and reaches the stage handle", async () => {
    vi.stubGlobal("fetch", mapsFetchMock());
    await mountReady();
    // Off by default, unlike the grid — a fresh editor must look exactly as it did before this
    // overlay existed.
    await waitFor(() => expect(stageMock.setCollisions).toHaveBeenCalledWith(false));
    const toggle = () => screen.getByRole("button", { name: t("editor.shell.collisions.aria") });
    expect(toggle()).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(toggle());
    expect(stageMock.setCollisions).toHaveBeenLastCalledWith(true);
    expect(toggle()).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(toggle());
    expect(stageMock.setCollisions).toHaveBeenLastCalledWith(false);
    expect(toggle()).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps selection exclusive: a terrain pick clears the spawn tool and vice versa (UX wave #11)", async () => {
    vi.stubGlobal("fetch", mapsFetchMock());
    await mountReady();
    const grass = () => screen.getByRole("button", { name: t("editor.tool.grass") });
    const spawn = () => screen.getByRole("button", { name: t("editor.tool.spawn") });

    // Default selection is pencil+grass, so the grass swatch is the ONE active selection.
    expect(grass()).toHaveAttribute("aria-pressed", "true");

    // Picking the hero-spawn tool deselects the terrain — never Herbe AND the spawn tool at once.
    await userEvent.click(spawn());
    expect(stageMock.setTool).toHaveBeenLastCalledWith({ kind: "spawn" });
    expect(spawn()).toHaveAttribute("aria-pressed", "true");
    expect(grass()).toHaveAttribute("aria-pressed", "false");

    // Picking grass back deselects the spawn tool and re-arms the pencil, so exactly one is pressed.
    await userEvent.click(grass());
    expect(stageMock.setTool).toHaveBeenLastCalledWith({ kind: "block", block: "grass" });
    expect(grass()).toHaveAttribute("aria-pressed", "true");
    expect(spawn()).toHaveAttribute("aria-pressed", "false");
  });

  it("the EV slot activates the event tool, pushing the overlay onto the stage handle", async () => {
    vi.stubGlobal("fetch", mapsFetchMock());
    await mountReady();

    await userEvent.click(screen.getByRole("button", { name: t("editor.shell.mode.event") }));
    // The event tool is what turns the stage's EV overlay on (shouldShowEventOverlay), so this call
    // reaching the handle IS the overlay flag reaching the stage.
    expect(stageMock.setTool).toHaveBeenLastCalledWith({
      kind: "event",
      eventKind: "normal",
      preset: "raw",
      selfMapId: "m1",
    });
  });

  it("opens the event dialog when the stage double-click requests it", async () => {
    vi.stubGlobal("fetch", mapsFetchMock());
    stageMock.beginEventDraft.mockReturnValue({
      id: "ev-1",
      col: 3,
      row: 4,
      name: "",
      ordinal: 1,
      pages: [defaultEventPage()],
    });
    await mountReady();

    // The stage's onDoubleClick calls the 4th openMapEditorStage argument with the event's id.
    const onOpenEvent = stageMock.openMapEditorStage.mock.calls[0]?.[3] as (id: string) => void;
    expect(onOpenEvent).toBeInstanceOf(Function);
    act(() => onOpenEvent("ev-1"));

    await waitFor(() =>
      expect(screen.getByText(t("editor.event.dialog.title"))).toBeInTheDocument(),
    );
    // The screen seeds the dialog with a detached draft read off the handle for that id.
    expect(stageMock.beginEventDraft).toHaveBeenCalledWith("ev-1");
  });

  it("opens the event dialog on Enter when an event is selected", async () => {
    vi.stubGlobal("fetch", mapsFetchMock());
    stageMock.beginEventDraft.mockReturnValue({
      id: "ev-7",
      col: 1,
      row: 2,
      name: "",
      ordinal: 7,
      pages: [defaultEventPage()],
    });
    await mountReady();

    // Report an event selection through the stage's onChange, the way a select-click would.
    const onChange = stageMock.openMapEditorStage.mock.calls[0]?.[1] as (
      map: unknown,
      state: { canUndo: boolean; canRedo: boolean; dirty: boolean; selection: unknown },
    ) => void;
    act(() =>
      onChange(stageMock.current(), {
        canUndo: false,
        canRedo: false,
        dirty: false,
        selection: { kind: "event", id: "ev-7" },
      }),
    );

    const root = document.querySelector(".editor-root");
    if (!root) throw new Error("editor root not found");
    fireEvent.keyDown(root, { key: "Enter" });

    await waitFor(() =>
      expect(screen.getByText(t("editor.event.dialog.title"))).toBeInTheDocument(),
    );
    expect(stageMock.beginEventDraft).toHaveBeenCalledWith("ev-7");
  });

  it("keeps tool shortcuts inert while the event dialog is open", async () => {
    vi.stubGlobal("fetch", mapsFetchMock());
    stageMock.beginEventDraft.mockReturnValue({
      id: "ev-1",
      col: 3,
      row: 4,
      name: "",
      ordinal: 1,
      pages: [defaultEventPage()],
    });
    await mountReady();
    const onOpenEvent = stageMock.openMapEditorStage.mock.calls[0]?.[3] as (id: string) => void;
    act(() => onOpenEvent("ev-1"));
    await waitFor(() =>
      expect(screen.getByText(t("editor.event.dialog.title"))).toBeInTheDocument(),
    );

    const before = stageMock.setTool.mock.calls.length;
    // Typing "r" in the dialog's name input must not switch to the rectangle tool.
    await userEvent.type(screen.getByRole("textbox", { name: t("editor.event.name") }), "r");
    // A bare key with the dialog open but focus on one of its buttons must not switch tools either —
    // the portaled dialog is outside the shortcut host, and the closest('[data-slot=dialog-content]')
    // gate covers the case the container ever does see the event.
    screen.getByRole("button", { name: t("editor.event.save") }).focus();
    await userEvent.keyboard("r");

    expect(stageMock.setTool.mock.calls).toHaveLength(before);
    expect(stageMock.setTool).not.toHaveBeenCalledWith({
      kind: "rect",
      content: { kind: "block", block: "grass" },
    });
  });

  it("shows the preset placements only while EV mode is active, and no graphic picker (D13)", async () => {
    vi.stubGlobal("fetch", mapsFetchMock());
    await mountReady();

    // The sidebar graphic catalogue (D13) is gone from EV mode entirely.
    expect(screen.queryByTestId("event-presets")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: t("editor.shell.mode.event") }));
    expect(screen.getByTestId("event-presets")).toBeVisible();
    expect(screen.queryByText(t("editor.shell.events.graphic.heading"))).toBeNull();
  });

  it("picking a preset in EV mode pushes a scripted event tool with that preset (D13)", async () => {
    vi.stubGlobal("fetch", mapsFetchMock());
    await mountReady();

    await userEvent.click(screen.getByRole("button", { name: t("editor.shell.mode.event") }));
    const palette = screen.getByRole("complementary", { name: t("editor.shell.palette.aria") });

    await userEvent.click(
      within(palette).getByRole("button", { name: t("editor.event.preset.teleporter") }),
    );
    // The preset reaches the event tool the stage places with; applyTool then pre-fills page 1 from it
    // (proven directly in editor-state.test.ts / event-presets.test.ts).
    expect(stageMock.setTool).toHaveBeenLastCalledWith({
      kind: "event",
      eventKind: "normal",
      preset: "teleporter",
      selfMapId: "m1",
    });

    await userEvent.click(
      within(palette).getByRole("button", { name: t("editor.event.preset.raw") }),
    );
    expect(stageMock.setTool).toHaveBeenLastCalledWith({
      kind: "event",
      eventKind: "normal",
      preset: "raw",
      selfMapId: "m1",
    });
  });

  it("threads the mode selector to setActiveMode and reflects it in the status bar", async () => {
    vi.stubGlobal("fetch", mapsFetchMock());
    const rendered = await mountReady();

    // "Element" appears twice at once (the mode control's own segment label and the status bar
    // echo), so both assertions below scope to the status bar strip rather than a bare getByText.
    expect(within(statusBar(rendered)).getByText(t("editor.shell.mode.field"))).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: t("editor.shell.mode.element") }));

    expect(stageMock.setActiveMode).toHaveBeenLastCalledWith("element");
    expect(
      within(statusBar(rendered)).getByText(t("editor.shell.mode.element")),
    ).toBeInTheDocument();
  });

  it("installs the mode selected while the stage was still opening, not the mode captured when the open effect started", async () => {
    vi.stubGlobal("fetch", mapsFetchMock());
    // Hold the stage-open promise open so the effect's `.then` has not run yet when we click.
    let resolveOpen!: (handle: ReturnType<typeof stageHandle>) => void;
    const openPromise = new Promise<ReturnType<typeof stageHandle>>((resolve) => {
      resolveOpen = resolve;
    });
    stageMock.openMapEditorStage.mockReturnValueOnce(openPromise);

    render(<AdventureEditorScreen />);
    await waitFor(() => expect(stageMock.openMapEditorStage).toHaveBeenCalledTimes(1));

    // The handle does not exist yet, so selecting Event mode here can only reach the stage through
    // whatever the `.then` callback reads once it resolves — this is the race.
    await userEvent.click(screen.getByRole("button", { name: t("editor.shell.mode.event") }));
    expect(stageMock.setActiveMode).not.toHaveBeenCalled();

    resolveOpen(stageHandle());
    await waitFor(() => expect(stageMock.setActiveMode).toHaveBeenCalled());

    // Must be the mode selected during the open window ("event"), never the stale mode ("field")
    // that was active when the effect started running.
    expect(stageMock.setActiveMode).toHaveBeenCalledTimes(1);
    expect(stageMock.setActiveMode).toHaveBeenLastCalledWith("event");
  });

  it("opens the registry database dialog from the Game menu", async () => {
    vi.stubGlobal("fetch", mapsFetchMock());
    await mountReady();

    // The Base UI menubar opens reliably from the keyboard in jsdom (its click-to-open path depends
    // on layout measurement that jsdom does not provide).
    screen.getByRole("menuitem", { name: t("editor.shell.menu.game") }).focus();
    await userEvent.keyboard("{Enter}");
    const database = await screen.findByRole("menuitem", { name: t("editor.shell.database") });
    // No longer disabled: it now opens the registry dialog.
    expect(database).not.toHaveAttribute("aria-disabled", "true");

    await userEvent.click(database);
    // The registry dialog's own title appears (distinct from the menu item's "Database…").
    expect(await screen.findByText(t("editor.registry.title"))).toBeInTheDocument();
    expect(previewMock.startMapPreview).not.toHaveBeenCalled();
    expect(useUiStore.getState().screen).toBe("adventure-editor");
  });

  it("opens the stage once on mount and disposes it once on unmount, never touching #stage", async () => {
    vi.stubGlobal("fetch", mapsFetchMock());
    const rendered = await mountReady();

    expect(stageMock.openMapEditorStage).toHaveBeenCalledTimes(1);
    expect(document.querySelector("#stage")).toBeNull();

    rendered.unmount();
    await waitFor(() => expect(stageMock.dispose).toHaveBeenCalledTimes(1));
  });

  /** Marks the open map dirty by feeding the stage's onChange the dirty state, so the switch guard
   *  has something to guard. */
  function markDirty(): void {
    const callback = stageMock.openMapEditorStage.mock.calls[0]?.[1];
    act(() => {
      callback?.(payloadFor(oneMap[0] as MapSummary), {
        canUndo: true,
        canRedo: false,
        dirty: true,
        selection: null,
      });
    });
  }

  it("raises the dirty guard when switching maps: cancel stays, confirm switches, no save on cancel", async () => {
    const mock = mapsBackend(twoMaps);
    vi.stubGlobal("fetch", mock);
    await mountReady();
    await screen.findByRole("button", { name: "Frostfen" });
    markDirty();

    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await userEvent.click(screen.getByRole("button", { name: "Frostfen" }));
    expect(confirm).toHaveBeenCalledWith(t("editor.shell.exit.confirm"));
    // Cancelled: the stage was not reopened for m2, and nothing was saved.
    expect(stageMock.openMapEditorStage).toHaveBeenCalledTimes(1);
    expect(mock).not.toHaveBeenCalledWith(
      "/api/maps/m1",
      expect.objectContaining({ method: "PUT" }),
    );

    confirm.mockReturnValue(true);
    await userEvent.click(screen.getByRole("button", { name: "Frostfen" }));
    await waitFor(() => expect(mock).toHaveBeenCalledWith("/api/maps/m2", expect.anything()));
    await waitFor(() => expect(stageMock.openMapEditorStage).toHaveBeenCalledTimes(2));
  });

  it("ignores an older map response that arrives after a newer selection", async () => {
    let resolveM2: ((response: Response) => void) | undefined;
    let resolveM3: ((response: Response) => void) | undefined;
    const mock = vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (url.startsWith("/api/maps?adventure=") && method === "GET") {
        return Promise.resolve(jsonResponse(threeMaps));
      }
      if (url === "/api/maps/m1" && method === "GET") {
        return Promise.resolve(jsonResponse(payloadFor(threeMaps[0] as MapSummary)));
      }
      if (url === "/api/maps/m2" && method === "GET") {
        return new Promise<Response>((resolve) => {
          resolveM2 = resolve;
        });
      }
      if (url === "/api/maps/m3" && method === "GET") {
        return new Promise<Response>((resolve) => {
          resolveM3 = resolve;
        });
      }
      return Promise.resolve(jsonResponse({ error: "map_not_found" }, 404));
    });
    vi.stubGlobal("fetch", mock);
    await mountReady();

    await userEvent.click(await screen.findByRole("button", { name: "Frostfen" }));
    await userEvent.click(screen.getByRole("button", { name: "Ashen Keep" }));
    if (!resolveM2 || !resolveM3) throw new Error("expected both map requests");

    await act(async () => resolveM3?.(jsonResponse(payloadFor(threeMaps[2] as MapSummary))));
    await waitFor(() => expect(stageMock.openMapEditorStage).toHaveBeenCalledTimes(2));
    expect(stageMock.openMapEditorStage).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: "Ashen Keep" }),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
    );

    await act(async () => resolveM2?.(jsonResponse(payloadFor(threeMaps[1] as MapSummary))));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(stageMock.openMapEditorStage).toHaveBeenCalledTimes(2);
  });

  it("places a spawn EVENT: the EV spawn kind places one, and the inspector deletes it", async () => {
    vi.stubGlobal("fetch", mapsFetchMock());
    await mountReady();

    // Enter EV mode, then pick the spawn anchor — the event tool it pushes carries eventKind: "spawn".
    await userEvent.click(screen.getByRole("button", { name: t("editor.shell.mode.event") }));
    await userEvent.click(screen.getByRole("button", { name: t("editor.event.kind.spawn") }));
    expect(stageMock.setTool).toHaveBeenLastCalledWith({ kind: "event", eventKind: "spawn" });

    // A selected event lights the inspector: its EV id shows, and Delete reaches deleteSelected.
    stageMock.current.mockReturnValue({
      name: "Verdant Reach",
      layers: [],
      elements: [],
      spawn: { col: 20, row: 15 },
      markers: EMPTY_MARKERS,
      events: [
        {
          id: "ev-door",
          col: 1,
          row: 1,
          name: "Hero start",
          ordinal: 1,
          kind: "spawn",
          species: null,
          patrolRadius: null,
          pages: [defaultEventPage()],
        },
      ],
    });
    const callback = stageMock.openMapEditorStage.mock.calls[0]?.[1];
    act(() => {
      callback?.(payloadFor(oneMap[0] as MapSummary), {
        canUndo: false,
        canRedo: false,
        dirty: false,
        selection: { kind: "event", id: "ev-door" },
      });
    });

    // The inspector shows the entry event (its EV id and name), and Delete reaches deleteSelected.
    // Scoped to the inspector: the D14 sidebar event list now also carries this event's EV001 chip.
    const inspector = screen.getByRole("complementary", { name: t("editor.inspector.title") });
    expect(within(inspector).getByText(/EV001/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: t("editor.delete") }));
    expect(stageMock.deleteSelected).toHaveBeenCalledTimes(1);
  });

  it("places the spawn/monster events and forwards monster species and radius to the stage", async () => {
    vi.stubGlobal("fetch", mapsFetchMock());
    await mountReady();

    await userEvent.click(screen.getByRole("button", { name: t("editor.shell.mode.event") }));

    // Entry/exit authoring is gone; the spawn anchor and the monster placement remain.
    await userEvent.click(screen.getByRole("button", { name: t("editor.event.kind.spawn") }));
    expect(stageMock.setTool).toHaveBeenLastCalledWith({ kind: "event", eventKind: "spawn" });

    await userEvent.click(screen.getByRole("button", { name: t("editor.event.kind.monster") }));
    expect(stageMock.setTool).toHaveBeenLastCalledWith({
      kind: "event",
      eventKind: "monster",
      species: "spear_goblin",
      patrolRadius: 96,
    });

    // Only one species is curated now (UX wave #13), so the species select offers just it. Exercise
    // the same re-push path through the patrol radius: changing it re-pushes the monster event tool
    // with the new radius (and the curated species) onto the stage.
    fireEvent.change(screen.getByLabelText(t("editor.markers.radius")), {
      target: { value: "128" },
    });
    expect(stageMock.setTool).toHaveBeenLastCalledWith(
      expect.objectContaining({
        kind: "event",
        eventKind: "monster",
        species: "spear_goblin",
        patrolRadius: 128,
      }),
    );
  });

  it("saves the stage's current map to the update endpoint", async () => {
    const edited = {
      name: "Verdant Reach",
      layers: OPEN_TILE_LAYERS,
      elements: [
        {
          col: 2,
          row: 3,
          offsetX: 0,
          offsetY: 0,
          assetId: "resource.terrain-resources-wood-trees.tree4" as const,
        },
      ],
      spawn: { col: 20, row: 15 },
      markers: EMPTY_MARKERS,
      events: [],
    };
    stageMock.current.mockReturnValue(edited);
    const mock = mapsBackend(twoMaps);
    vi.stubGlobal("fetch", mock);
    await mountReady();

    // C10 removed the toolbar's Save icon button — saving now goes through ⌘S or, as exercised
    // here, the File menu's own Save item.
    screen.getByRole("menuitem", { name: t("editor.shell.menu.file") }).focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.click(await screen.findByRole("menuitem", { name: /^Save/ }));
    await waitFor(() =>
      expect(mock).toHaveBeenCalledWith(
        "/api/maps/m1",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ ...toSaveInput(edited), expectedRevision: 1 }),
        }),
      ),
    );
    expect(stageMock.markSaved).toHaveBeenCalledTimes(1);
  });

  it("deduplicates an in-flight save and anchors it to the captured snapshot", async () => {
    const savedSnapshot = {
      name: "Before request",
      layers: OPEN_TILE_LAYERS,
      elements: [],
      spawn: { col: 20, row: 15 },
      markers: EMPTY_MARKERS,
      events: [],
    };
    const laterEdit = { ...savedSnapshot, name: "Edited while saving" };
    stageMock.current.mockReturnValue(savedSnapshot);
    let resolveSave: ((response: Response) => void) | undefined;
    const mock = vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (url.startsWith("/api/maps?adventure=") && method === "GET") {
        return Promise.resolve(jsonResponse(twoMaps));
      }
      if (url === "/api/maps/m1" && method === "GET") {
        return Promise.resolve(jsonResponse(payloadFor(twoMaps[0] as MapSummary)));
      }
      if (url === "/api/maps/m1" && method === "PUT") {
        return new Promise<Response>((resolve) => {
          resolveSave = resolve;
        });
      }
      return Promise.resolve(jsonResponse({ error: "map_not_found" }, 404));
    });
    vi.stubGlobal("fetch", mock);
    const rendered = await mountReady();
    const host = rendered.container.firstElementChild as HTMLElement;

    fireEvent.keyDown(host, { key: "s", metaKey: true });
    fireEvent.keyDown(host, { key: "s", metaKey: true });
    await waitFor(() => expect(resolveSave).toBeDefined());
    expect(
      mock.mock.calls.filter(
        ([url, init]) => url === "/api/maps/m1" && (init as RequestInit)?.method === "PUT",
      ),
    ).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Frostfen" })).toBeDisabled();

    const callback = stageMock.openMapEditorStage.mock.calls[0]?.[1];
    act(() => {
      callback?.(laterEdit, {
        canUndo: true,
        canRedo: false,
        dirty: true,
        selection: null,
      });
    });
    await act(async () => resolveSave?.(jsonResponse({ id: "m1", revision: 2 })));
    await waitFor(() => expect(stageMock.markSaved).toHaveBeenCalledTimes(1));
    expect(stageMock.markSaved).toHaveBeenCalledWith(savedSnapshot);
  });

  it("previews the stage's current map, then Esc returns to editing with edits intact", async () => {
    const edited = {
      name: "Verdant Reach",
      layers: OPEN_TILE_LAYERS,
      elements: [
        {
          col: 2,
          row: 3,
          offsetX: 0,
          offsetY: 0,
          assetId: "resource.terrain-resources-wood-trees.tree4" as const,
        },
      ],
      spawn: { col: 20, row: 15 },
      markers: EMPTY_MARKERS,
      events: [],
    };
    stageMock.current.mockReturnValue(edited);
    vi.stubGlobal("fetch", mapsFetchMock());
    await mountReady();

    await userEvent.click(screen.getByRole("button", { name: t("editor.shell.test") }));
    await waitFor(() =>
      expect(previewMock.startMapPreview).toHaveBeenCalledWith(toMapData(edited)),
    );
    expect(screen.queryByRole("button", { name: t("editor.shell.test") })).not.toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(stageMock.openMapEditorStage).toHaveBeenLastCalledWith(
        edited,
        expect.any(Function),
        expect.any(Function),
        expect.any(Function),
        expect.any(Function),
      ),
    );
  });

  it("forwards undo and redo once the stage reports available history", async () => {
    vi.stubGlobal("fetch", mapsFetchMock());
    await mountReady();
    const callback = stageMock.openMapEditorStage.mock.calls[0]?.[1];
    act(() => {
      callback?.(payloadFor(oneMap[0] as MapSummary), {
        canUndo: true,
        canRedo: true,
        dirty: true,
        selection: null,
      });
    });

    screen.getByRole("menuitem", { name: t("editor.shell.menu.edit") }).focus();
    await userEvent.keyboard("{Enter}");
    // The item's accessible name carries its ⌘Z shortcut, so match on the label prefix.
    await userEvent.click(await screen.findByRole("menuitem", { name: /^Undo/ }));
    expect(stageMock.undo).toHaveBeenCalledTimes(1);

    screen.getByRole("menuitem", { name: t("editor.shell.menu.edit") }).focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.click(await screen.findByRole("menuitem", { name: /^Redo/ }));
    expect(stageMock.redo).toHaveBeenCalledTimes(1);
  });

  it("creates a map through the new-map dialog and opens it in the stage", async () => {
    const mock = mapsBackend(twoMaps);
    vi.stubGlobal("fetch", mock);
    await mountReady();

    // The new-map dialog now takes only a name: a map belongs to one adventure and the server builds
    // a fixed 5x5 template, so the client no longer sends terrain or size — just adventure + name. The
    // field is prefilled with the default MapN (UX wave #16); clear it to type a custom name.
    await userEvent.click(
      screen.getAllByRole("button", { name: t("editor.new") })[0] as HTMLElement,
    );
    const nameField = await screen.findByLabelText(t("editor.name"));
    await userEvent.clear(nameField);
    await userEvent.type(nameField, "Third map");
    await userEvent.click(screen.getByRole("button", { name: t("editor.shell.maps.create") }));

    await waitFor(() =>
      expect(mock).toHaveBeenCalledWith(
        "/api/maps",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ adventureId: "adv-1", name: "Third map" }),
        }),
      ),
    );
    await waitFor(() => expect(stageMock.openMapEditorStage).toHaveBeenCalledTimes(2));
  });

  it("composes the toolbar tool with the palette's elevation, terrain and stairs selections", async () => {
    vi.stubGlobal("fetch", mapsFetchMock());
    await mountReady();

    await userEvent.click(
      screen.getByRole("button", { name: t("editor.shell.terrain.level", { level: 2 }) }),
    );
    expect(stageMock.setTool).toHaveBeenLastCalledWith({ kind: "elevation", level: 2 });

    await userEvent.click(screen.getByRole("button", { name: t("editor.tool.grass") }));
    expect(stageMock.setTool).toHaveBeenLastCalledWith({ kind: "block", block: "grass" });

    await userEvent.click(screen.getByRole("button", { name: t("editor.shell.tool.stairs") }));
    expect(stageMock.setTool).toHaveBeenLastCalledWith({ kind: "stairs" });
  });

  it("gates the fill+water dead combination: the water swatch is disabled while fill is active", async () => {
    vi.stubGlobal("fetch", mapsFetchMock());
    await mountReady();

    await userEvent.click(screen.getByRole("button", { name: t("editor.shell.tool.fill") }));
    const water = screen.getByRole("button", { name: t("editor.tool.water") });
    expect(water).toBeDisabled();

    // A disabled swatch dispatches nothing, so no fill+water tool ever reaches the stage.
    const before = stageMock.setTool.mock.calls.length;
    await userEvent.click(water);
    expect(stageMock.setTool.mock.calls).toHaveLength(before);
    expect(stageMock.setTool).not.toHaveBeenCalledWith({
      kind: "fill",
      content: { kind: "block", block: "water" },
    });
  });

  it("reports the hovered cell to the status bar and clears it to (—, —) on leave", async () => {
    vi.stubGlobal("fetch", mapsFetchMock());
    await mountReady();
    const cursorCb = stageMock.openMapEditorStage.mock.calls[0]?.[2];

    act(() => cursorCb?.(3, 5));
    expect(
      screen.getByText(t("editor.shell.status.cursor", { cursor: "(3, 5)" })),
    ).toBeInTheDocument();

    act(() => cursorCb?.(null, null));
    expect(
      screen.getByText(t("editor.shell.status.cursor", { cursor: "(—, —)" })),
    ).toBeInTheDocument();
  });

  it("searches the catalogue palette and selects a visible variant directly", async () => {
    vi.stubGlobal("fetch", mapsFetchMock());
    await mountReady();

    // The catalogue only renders in Element mode (Task 11 split the sidebar per mode).
    await userEvent.click(screen.getByRole("button", { name: t("editor.shell.mode.element") }));

    const search = screen.getByRole("searchbox", { name: t("editor.palette.search") });
    // `fireEvent.change` rather than `userEvent.type`: this suite's jsdom focus resolution for this
    // particular input delivers keydown events with `target` on the shortcut-host container instead
    // of the input (the same pre-existing gap `keeps tool shortcuts inert…`'s sibling test documents
    // below) — real keystrokes here would leak "r"/"e"/"3" to the global shortcut handler and switch
    // modes/tools out from under this search, which is not what this test is about.
    fireEvent.change(search, { target: { value: "tree3" } });
    // D4 relabels the collision badge from "Solid" to "Collision" to stay truthful about sub-cell
    // collision (a tree blocks only its trunk, not the whole cell).
    await userEvent.click(screen.getByRole("button", { name: /tree3grasscollision/i }));
    await waitFor(() =>
      expect(stageMock.setTool).toHaveBeenCalledWith({
        kind: "element",
        assetId: "resource.terrain-resources-wood-trees.tree3",
      }),
    );
  });

  describe("keyboard shortcuts", () => {
    /** The shell's own root: the shortcut listener lives here, never on `document`, so every
     *  shortcut test dispatches directly on it rather than on `window`/`document`. */
    function shell(rendered: { container: HTMLElement }): HTMLElement {
      return rendered.container.firstElementChild as HTMLElement;
    }

    it("dispatches the paint-tool, mode and grid shortcuts to the same actions the toolbar uses", async () => {
      vi.stubGlobal("fetch", mapsFetchMock());
      const rendered = await mountReady();
      const host = shell(rendered);

      fireEvent.keyDown(host, { key: "r" });
      expect(stageMock.setTool).toHaveBeenLastCalledWith({
        kind: "rect",
        content: { kind: "block", block: "grass" },
      });

      fireEvent.keyDown(host, { key: "f" });
      expect(stageMock.setTool).toHaveBeenLastCalledWith({
        kind: "fill",
        content: { kind: "block", block: "grass" },
      });

      fireEvent.keyDown(host, { key: "e" });
      expect(stageMock.setTool).toHaveBeenLastCalledWith({ kind: "eraser" });

      fireEvent.keyDown(host, { key: "s" });
      expect(stageMock.setTool).toHaveBeenLastCalledWith({ kind: "select" });

      fireEvent.keyDown(host, { key: "p" });
      expect(stageMock.setTool).toHaveBeenLastCalledWith({ kind: "block", block: "grass" });

      fireEvent.keyDown(host, { key: "2" });
      expect(stageMock.setActiveMode).toHaveBeenLastCalledWith("element");
      expect(screen.getByRole("button", { name: t("editor.shell.mode.element") })).toHaveAttribute(
        "aria-pressed",
        "true",
      );

      const gridButton = screen.getByRole("button", { name: t("editor.shell.grid.aria") });
      expect(gridButton).toHaveAttribute("aria-pressed", "true");
      fireEvent.keyDown(host, { key: "g" });
      expect(gridButton).toHaveAttribute("aria-pressed", "false");
    });

    it("re-selecting the current mode via its shortcut leaves the active tool untouched", async () => {
      vi.stubGlobal("fetch", mapsFetchMock());
      const rendered = await mountReady();
      const host = shell(rendered);

      // Field is the default mode; pick a non-default tool inside it.
      fireEvent.keyDown(host, { key: "r" });
      expect(stageMock.setTool).toHaveBeenLastCalledWith({
        kind: "rect",
        content: { kind: "block", block: "grass" },
      });
      const callsBeforeReselect = stageMock.setTool.mock.calls.length;

      // "1" re-selects Field — the mode does not change, so this must be a no-op for the tool. This
      // is the unguarded entry point: unlike the segmented control (which never re-fires a click on
      // its own active segment), the shortcut calls `selectMode` unconditionally.
      fireEvent.keyDown(host, { key: "1" });

      expect(stageMock.setTool).toHaveBeenCalledTimes(callsBeforeReselect);
      expect(stageMock.setTool).toHaveBeenLastCalledWith({
        kind: "rect",
        content: { kind: "block", block: "grass" },
      });

      // A genuine mode change still resets the tool to that mode's default: switching to Event via
      // "3" re-arms the event tool regardless of the rect tool still active in Field.
      fireEvent.keyDown(host, { key: "3" });
      expect(stageMock.setTool).toHaveBeenLastCalledWith({
        kind: "event",
        eventKind: "normal",
        preset: "raw",
        selfMapId: "m1",
      });
    });

    it("forwards ⌘Z to undo and ⇧⌘Z to redo on the stage handle", async () => {
      vi.stubGlobal("fetch", mapsFetchMock());
      const rendered = await mountReady();
      const host = shell(rendered);

      fireEvent.keyDown(host, { key: "z", metaKey: true });
      expect(stageMock.undo).toHaveBeenCalledTimes(1);
      expect(stageMock.redo).not.toHaveBeenCalled();

      fireEvent.keyDown(host, { key: "z", metaKey: true, shiftKey: true });
      expect(stageMock.redo).toHaveBeenCalledTimes(1);
      expect(stageMock.undo).toHaveBeenCalledTimes(1);
    });

    /** Counts only the map-save PUT — the settings dialog's own save hits a different endpoint
     *  entirely, so this stays a precise assertion of "did the editor's own save fire", not a
     *  proxy for "was fetch called at all". */
    function mapSaveCalls(mock: ReturnType<typeof mapsBackend>): number {
      return mock.mock.calls.filter(
        ([url, init]) =>
          url === "/api/maps/m1" && (init as RequestInit | undefined)?.method === "PUT",
      ).length;
    }

    it("saves and prevents the browser save dialog on ⌘S", async () => {
      const edited = {
        name: "Verdant Reach",
        layers: OPEN_TILE_LAYERS,
        elements: [],
        spawn: { col: 20, row: 15 },
        markers: EMPTY_MARKERS,
      };
      stageMock.current.mockReturnValue(edited);
      const mock = mapsBackend(twoMaps);
      vi.stubGlobal("fetch", mock);
      const rendered = await mountReady();
      const host = shell(rendered);

      const notCancelled = fireEvent.keyDown(host, { key: "s", metaKey: true });
      // fireEvent returns the DOM dispatch result: false once preventDefault() was called on a
      // cancelable event — exactly what must happen so the browser's own save dialog never opens.
      expect(notCancelled).toBe(false);

      await waitFor(() => expect(mapSaveCalls(mock)).toBe(1));
      expect(stageMock.markSaved).toHaveBeenCalledTimes(1);
    });

    it('does not switch tools while typing "r" into the new-map dialog\'s name input', async () => {
      const mock = mapsBackend(twoMaps);
      vi.stubGlobal("fetch", mock);
      await mountReady();

      await userEvent.click(
        screen.getAllByRole("button", { name: t("editor.new") })[0] as HTMLElement,
      );
      const nameInput = await screen.findByLabelText(t("editor.name"));
      // The field is prefilled with the default MapN (UX wave #16); clear it so the typed "r" is the
      // whole value.
      await userEvent.clear(nameInput);

      const before = stageMock.setTool.mock.calls.length;
      await userEvent.type(nameInput, "r");
      expect(nameInput).toHaveValue("r");
      expect(stageMock.setTool.mock.calls).toHaveLength(before);
    });

    // The new-map dialog above is doubly guarded: it is both a focused input *and* an open dialog,
    // so it alone cannot prove the input-focus gate is what is doing the work — the dialog-open gate
    // would still block the shortcut even without it. This test isolates the input-focus gate with a
    // keydown targeted straight at a text input that is not inside any tracked dialog: the terrain
    // palette's own search box, rendered straight into this screen's container (no portal). Dispatched
    // with `fireEvent` rather than `userEvent.type`, because jsdom's click-driven focus resolution for
    // this input is unreliable in this suite (confirmed independent of this change: the same gap
    // reproduces on `main`) — `fireEvent.keyDown(search, ...)` sidesteps it by delivering an event
    // whose `target` is genuinely `search`, exactly the condition the gate has to recognise.
    it("does not switch tools on a keydown targeting the palette search box (no dialog open)", async () => {
      vi.stubGlobal("fetch", mapsFetchMock());
      await mountReady();

      // The catalogue only renders in Element mode (Task 11 split the sidebar per mode).
      await userEvent.click(screen.getByRole("button", { name: t("editor.shell.mode.element") }));

      const search = screen.getByRole("searchbox", { name: t("editor.palette.search") });
      const before = stageMock.setTool.mock.calls.length;
      fireEvent.keyDown(search, { key: "r" });
      expect(stageMock.setTool.mock.calls).toHaveLength(before);
    });

    it("does not fire the map save while the settings dialog is open", async () => {
      const mock = mapsBackend(twoMaps);
      vi.stubGlobal("fetch", mock);
      const rendered = await mountReady();
      const host = shell(rendered);

      screen.getByRole("menuitem", { name: t("editor.shell.menu.file") }).focus();
      await userEvent.keyboard("{Enter}");
      await userEvent.click(
        await screen.findByRole("menuitem", { name: t("editor.shell.settings") }),
      );
      await screen.findByRole("dialog");

      fireEvent.keyDown(host, { key: "s", metaKey: true });
      expect(mapSaveCalls(mock)).toBe(0);
    });

    // MapListPanel's rename dialog is local, un-lifted state — this screen has no boolean flag for
    // it the way it does for `newMapOpen`/`confirmDeleteId`/`settingsOpen`. Typing in the rename
    // input is already caught by the INPUT-tag check, but once focus moves onto the dialog's own
    // Cancel/Save button, only the `closest('[data-slot="dialog-content"]')` search stands between
    // a shortcut and the map behind the (portaled) modal.
    it("blocks shortcuts once focus reaches the rename dialog's own button, not just its input", async () => {
      const mock = mapsBackend(twoMaps);
      vi.stubGlobal("fetch", mock);
      const rendered = await mountReady();
      const host = shell(rendered);
      await screen.findByRole("button", { name: "Frostfen" });

      await userEvent.click(
        screen.getByRole("button", { name: `${t("editor.shell.maps.rename")} Verdant Reach` }),
      );
      const dialog = await screen.findByRole("dialog");
      const cancelButton = within(dialog).getByRole("button", { name: t("editor.delete.cancel") });
      cancelButton.focus();
      expect(cancelButton).toHaveFocus();

      // The stage-open effect already calls `setActiveMode("field")` once while wiring the handle, so
      // the gate is proven by an unchanged call count, not "never called at all".
      const before = stageMock.setActiveMode.mock.calls.length;
      // React portal events still bubble to this screen's React ancestors, which is exactly why a
      // shortcut fired at the dialog's button used to reach `handleShortcutKeyDown` at all.
      fireEvent.keyDown(cancelButton, { key: "2" });
      expect(stageMock.setActiveMode.mock.calls).toHaveLength(before);

      await userEvent.click(cancelButton);
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

      fireEvent.keyDown(host, { key: "2" });
      expect(stageMock.setActiveMode).toHaveBeenLastCalledWith("element");
    });
  });

  describe("canvas focus loss recovery", () => {
    /** The shell's own root: same helper as the keyboard-shortcuts block above. */
    function shell(rendered: { container: HTMLElement }): HTMLElement {
      return rendered.container.firstElementChild as HTMLElement;
    }

    it("refocuses the container after a real blur that lands nowhere, the way clicking the non-focusable #stage canvas does", async () => {
      vi.stubGlobal("fetch", mapsFetchMock());
      const rendered = await mountReady();
      const host = shell(rendered);
      // The mount effect already claimed focus for the container — confirm that, so the recovery
      // asserted below is a genuine round-trip and not a no-op on an element that was never focused.
      expect(host).toHaveFocus();

      // jsdom's native `.blur()` reports `relatedTarget: null` here (verified independently of this
      // change) rather than `document.body`, which is exactly the "focus went nowhere" signature a
      // real click on the non-focusable canvas produces in a browser.
      act(() => {
        host.blur();
      });
      expect(host).toHaveFocus();
    });

    it("does not steal focus back from a dialog: a relatedTarget:null blur is a no-op while the settings dialog is open", async () => {
      vi.stubGlobal("fetch", mapsFetchMock());
      const rendered = await mountReady();
      const host = shell(rendered);

      screen.getByRole("menuitem", { name: t("editor.shell.menu.file") }).focus();
      await userEvent.keyboard("{Enter}");
      await userEvent.click(
        await screen.findByRole("menuitem", { name: t("editor.shell.settings") }),
      );
      await screen.findByRole("dialog");

      // Dispatched straight at the container regardless of where real focus currently sits (inside
      // the dialog) — this isolates the dialog-open gate from the relatedTarget condition, which a
      // `relatedTarget: null` blur would otherwise satisfy on its own.
      fireEvent.blur(host, { relatedTarget: null });
      expect(host).not.toHaveFocus();
    });

    it("does not refocus a blur whose relatedTarget is a real, concrete node, even with every dialog closed", async () => {
      vi.stubGlobal("fetch", mapsFetchMock());
      const rendered = await mountReady();
      const host = shell(rendered);
      const elsewhere = screen.getByRole("button", { name: t("editor.shell.grid.aria") });
      elsewhere.focus();
      expect(elsewhere).toHaveFocus();

      // Base UI moves focus to a concrete node inside a dialog when one opens — never to `null` or
      // `document.body` — so this is the condition that keeps the recovery from ever fighting a
      // dialog's own focus management. Isolated here from the dialog-open flags, which are false.
      fireEvent.blur(host, { relatedTarget: elsewhere });
      expect(host).not.toHaveFocus();
      expect(elsewhere).toHaveFocus();
    });
  });

  describe("editor chrome (UX wave #15/#16)", () => {
    /** A second adventure `adv-2` (one map `m2b`) the load dialog can switch to, plus the standard
     *  `adv-1` map backend so the shell mounts. */
    function loadableBackend() {
      const adv2 = {
        id: "adv-2",
        accountId: "acct",
        title: "Second",
        maxPlayers: 4,
        version: 1,
        mapIds: ["m2b"],
        graph: { start: null, links: [] },
        registry: { switches: [], variables: [] },
      };
      const m2b: MapSummary = {
        id: "m2b",
        name: "Map1",
        revision: 1,
        cols: 40,
        rows: 30,
        isFirst: true,
      };
      return vi.fn((url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        if (url.startsWith("/api/maps?adventure=") && method === "GET")
          return Promise.resolve(jsonResponse(oneMap));
        if (url === "/api/adventures" && method === "GET")
          return Promise.resolve(
            jsonResponse([
              { id: "adv-1", title: "First", maxPlayers: 4, mapCount: 1, playable: true },
              { id: "adv-2", title: "Second", maxPlayers: 4, mapCount: 1, playable: false },
            ]),
          );
        if (url === "/api/adventures/adv-2" && method === "GET")
          return Promise.resolve(jsonResponse(adv2));
        if (url === "/api/maps/m2b" && method === "GET")
          return Promise.resolve(jsonResponse(payloadFor(m2b)));
        const idMatch = url.match(/^\/api\/maps\/([^/]+)$/);
        const summary = idMatch?.[1] ? oneMap.find((m) => m.id === idMatch[1]) : undefined;
        if (summary && method === "GET") return Promise.resolve(jsonResponse(payloadFor(summary)));
        return Promise.resolve(jsonResponse({ error: "not_found" }, 404));
      });
    }

    it("shows a static Editor brand chip beside a dedicated Quit button (UX wave #16, C8)", async () => {
      vi.stubGlobal("fetch", mapsFetchMock());
      await mountReady();

      // The brand text is present…
      expect(screen.getByText(t("editor.shell.brand"))).toBeInTheDocument();
      // …but the chip itself is not a button: leaving is a distinct affordance beside it.
      expect(screen.queryByRole("button", { name: t("editor.shell.brand") })).toBeNull();
      // C8: a small icon-only Quit button now sits in the menu bar row, discoverable without opening
      // the File menu.
      expect(screen.getByRole("button", { name: t("editor.shell.exit.aria") })).toBeInTheDocument();
    });

    it("the menu bar's Quit button leaves the editor, dirty-guarded like the File-menu item (C8)", async () => {
      vi.stubGlobal("fetch", mapsFetchMock());
      await mountReady();
      markDirty();

      const quitButton = screen.getByRole("button", { name: t("editor.shell.exit.aria") });
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
      await userEvent.click(quitButton);
      expect(confirm).toHaveBeenCalledWith(t("editor.shell.exit.confirm"));
      expect(useUiStore.getState().screen).toBe("adventure-editor");

      confirm.mockReturnValue(true);
      await userEvent.click(quitButton);
      expect(useUiStore.getState().screen).toBe("title");
      confirm.mockRestore();
    });

    it("opens the Load-adventure dialog from the File menu and switching swaps the session", async () => {
      vi.stubGlobal("fetch", loadableBackend());
      await mountReady();

      screen.getByRole("menuitem", { name: t("editor.shell.menu.file") }).focus();
      await userEvent.keyboard("{Enter}");
      await userEvent.click(await screen.findByRole("menuitem", { name: t("editor.shell.load") }));

      // The dialog lists the account's adventures; open the second.
      expect(await screen.findByText(t("editor.load.title"))).toBeInTheDocument();
      const row = (await screen.findByText("Second")).closest("li");
      if (!row) throw new Error("adventure row not found");
      await userEvent.click(within(row).getByRole("button", { name: t("editor.picker.open") }));

      await waitFor(() =>
        expect(useUiStore.getState().adventureEditorSession?.adventureId).toBe("adv-2"),
      );
    });

    it("guards a dirty switch from the Load dialog: cancel keeps the current adventure", async () => {
      vi.stubGlobal("fetch", loadableBackend());
      await mountReady();
      markDirty();

      screen.getByRole("menuitem", { name: t("editor.shell.menu.file") }).focus();
      await userEvent.keyboard("{Enter}");
      await userEvent.click(await screen.findByRole("menuitem", { name: t("editor.shell.load") }));
      await screen.findByText(t("editor.load.title"));

      const row = (await screen.findByText("Second")).closest("li");
      if (!row) throw new Error("adventure row not found");
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
      await userEvent.click(within(row).getByRole("button", { name: t("editor.picker.open") }));
      expect(confirm).toHaveBeenCalledWith(t("editor.shell.exit.confirm"));
      // Cancelled: still on adv-1.
      expect(useUiStore.getState().adventureEditorSession?.adventureId).toBe("adv-1");
      confirm.mockRestore();
    });

    it("Quit returns to the title screen, dirty-guarded (cancel stays in the editor)", async () => {
      vi.stubGlobal("fetch", mapsFetchMock());
      await mountReady();
      markDirty();

      const openQuit = async () => {
        screen.getByRole("menuitem", { name: t("editor.shell.menu.file") }).focus();
        await userEvent.keyboard("{Enter}");
        await userEvent.click(
          await screen.findByRole("menuitem", { name: t("editor.shell.quit") }),
        );
      };

      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
      await openQuit();
      expect(confirm).toHaveBeenCalledWith(t("editor.shell.exit.confirm"));
      // Cancelled: still in the editor.
      expect(useUiStore.getState().screen).toBe("adventure-editor");

      confirm.mockReturnValue(true);
      await openQuit();
      expect(useUiStore.getState().screen).toBe("title");
      confirm.mockRestore();
    });

    it("closes the database dialog on Retour without unloading the editor (campaign fix)", async () => {
      vi.stubGlobal("fetch", mapsFetchMock());
      await mountReady();

      screen.getByRole("menuitem", { name: t("editor.shell.menu.game") }).focus();
      await userEvent.keyboard("{Enter}");
      await userEvent.click(
        await screen.findByRole("menuitem", { name: t("editor.shell.database") }),
      );
      expect(await screen.findByText(t("editor.registry.title"))).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: t("editor.back") }));
      // The dialog closes…
      await waitFor(() => expect(screen.queryByText(t("editor.registry.title"))).toBeNull());
      // …and the editor SURVIVES: still mounted on adv-1, never unloaded to a bare/parties screen.
      expect(useUiStore.getState().adventureEditorSession?.adventureId).toBe("adv-1");
      expect(useUiStore.getState().screen).toBe("adventure-editor");
    });
  });
});

describe("AdventureEditorScreen first-save name popup (UX wave #14)", () => {
  /** The one-map session the editor opens, flagged unnamed so the first save prompts for a name. */
  function seedUnnamed(titleUntouched: boolean): void {
    useUiStore.setState({
      screen: "adventure-editor",
      adventureEditorSession: {
        adventureId: "adv-1",
        draftId: "draft-1",
        draft: {
          title: t("adventure.default_title"),
          maxPlayers: 4,
          members: [
            {
              mapId: "m1",
              name: "Verdant Reach",
              revision: 1,
              solid: ["."],
              monsterCount: 0,
              entryIds: ["door"],
              exitIds: ["gate"],
              entryLabels: {},
              exitLabels: {},
            },
          ],
          registry: { switches: [], variables: [] },
        },
        invalidatedLinks: [],
        savedDraft: null,
        titleUntouched,
      },
    });
  }

  const adventurePayload = {
    id: "adv-1",
    accountId: "acct",
    title: t("adventure.default_title"),
    maxPlayers: 4,
    version: 1,
    mapIds: ["m1"],
    graph: { start: { mapId: "m1", entryId: "door" }, links: [] },
    registry: { switches: [], variables: [] },
  };

  /** A /api/maps + /api/adventures backend that answers the atomic map+adventure save and reloads. */
  function editorBackend() {
    return vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (url.startsWith("/api/maps?adventure=") && method === "GET")
        return Promise.resolve(jsonResponse(oneMap));
      const mapMatch = url.match(/^\/api\/maps\/([^/]+)$/);
      if (mapMatch?.[1] && method === "GET") {
        const summary = oneMap.find((m) => m.id === mapMatch[1]);
        if (summary) return Promise.resolve(jsonResponse(payloadFor(summary)));
      }
      if (mapMatch?.[1] && method === "PUT")
        return Promise.resolve(jsonResponse({ id: mapMatch[1], revision: 2 }));
      if (url === "/api/adventures/adv-1" && method === "PUT") {
        const body: unknown = JSON.parse(String(init?.body ?? "{}"));
        return Promise.resolve(jsonResponse({ ...(body as object), id: "adv-1", version: 2 }));
      }
      if (url === "/api/adventures/adv-1" && method === "GET")
        return Promise.resolve(jsonResponse(adventurePayload));
      return Promise.resolve(jsonResponse({ error: "not_found" }, 404));
    });
  }

  const editedMap = {
    name: "Verdant Reach",
    layers: OPEN_TILE_LAYERS,
    elements: [],
    spawn: { col: 20, row: 15 },
    markers: EMPTY_MARKERS,
  };

  function adventurePutCalls(mock: ReturnType<typeof editorBackend>): unknown[][] {
    return mock.mock.calls.filter(
      ([url, init]) =>
        url === "/api/adventures/adv-1" && (init as RequestInit | undefined)?.method === "PUT",
    );
  }
  function mapPutCalls(mock: ReturnType<typeof editorBackend>): unknown[][] {
    return mock.mock.calls.filter(
      ([url, init]) =>
        url === "/api/maps/m1" && (init as RequestInit | undefined)?.method === "PUT",
    );
  }

  async function mountReady(): Promise<ReturnType<typeof render>> {
    const rendered = render(<AdventureEditorScreen />);
    await waitFor(() => expect(stageMock.openMapEditorStage).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(stageMock.setTool).toHaveBeenCalled());
    return rendered;
  }

  function shell(rendered: { container: HTMLElement }): HTMLElement {
    return rendered.container.firstElementChild as HTMLElement;
  }

  beforeEach(() => {
    setLocale("en");
    for (const fn of Object.values(stageMock)) fn.mockReset();
    stageMock.openMapEditorStage.mockResolvedValue(stageHandle());
    stageMock.current.mockReturnValue(editedMap);
    previewMock.startMapPreview.mockReset();
    previewMock.startMapPreview.mockResolvedValue({ stop: previewMock.stop });
  });

  it("opens the name popup on the first ⌘S instead of saving the map", async () => {
    seedUnnamed(true);
    const mock = editorBackend();
    vi.stubGlobal("fetch", mock);
    const rendered = await mountReady();

    fireEvent.keyDown(shell(rendered), { key: "s", metaKey: true });

    expect(await screen.findByText(t("editor.firstSave.title"))).toBeInTheDocument();
    // The map is NOT saved yet — the name must be confirmed first.
    expect(mapPutCalls(mock)).toHaveLength(0);
    expect(adventurePutCalls(mock)).toHaveLength(0);
  });

  it("confirm saves title and map atomically; a second save does not re-prompt", async () => {
    seedUnnamed(true);
    const mock = editorBackend();
    vi.stubGlobal("fetch", mock);
    const rendered = await mountReady();

    fireEvent.keyDown(shell(rendered), { key: "s", metaKey: true });
    const dialog = await screen.findByRole("dialog");
    const title = within(dialog).getByLabelText(t("adventure.name"));
    await userEvent.clear(title);
    await userEvent.type(title, "Ashen Keep");
    await userEvent.click(
      within(dialog).getByRole("button", { name: t("editor.firstSave.confirm") }),
    );

    // One write lands: the map endpoint carries the adventure shell in the same D1 transaction.
    await waitFor(() => expect(mapPutCalls(mock)).toHaveLength(1));
    expect(adventurePutCalls(mock)).toHaveLength(0);
    const body = JSON.parse(String((mapPutCalls(mock)[0]?.[1] as RequestInit)?.body)) as {
      adventure: { title: string };
    };
    expect(body.adventure.title).toBe("Ashen Keep");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // A second save writes the map straight through — the popup never re-appears.
    fireEvent.keyDown(shell(rendered), { key: "s", metaKey: true });
    await waitFor(() => expect(mapPutCalls(mock)).toHaveLength(2));
    expect(screen.queryByText(t("editor.firstSave.title"))).toBeNull();
    // No standalone title PUT at all: the name was confirmed once inside the map write.
    expect(adventurePutCalls(mock)).toHaveLength(0);
  });

  it("cancel aborts the whole save: neither the title nor the map is written", async () => {
    seedUnnamed(true);
    const mock = editorBackend();
    vi.stubGlobal("fetch", mock);
    const rendered = await mountReady();

    fireEvent.keyDown(shell(rendered), { key: "s", metaKey: true });
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: t("editor.firstSave.cancel") }),
    );

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(adventurePutCalls(mock)).toHaveLength(0);
    expect(mapPutCalls(mock)).toHaveLength(0);
  });

  it("keeps ⌘S inert while the popup is open, so it cannot double-fire a save", async () => {
    seedUnnamed(true);
    const mock = editorBackend();
    vi.stubGlobal("fetch", mock);
    const rendered = await mountReady();

    fireEvent.keyDown(shell(rendered), { key: "s", metaKey: true });
    const dialog = await screen.findByRole("dialog");

    // A second ⌘S — on the host, and targeted inside the (portaled) dialog — must not save: the
    // firstSaveOpen flag gates the host, the closest('[data-slot=dialog-content]') gate the dialog.
    fireEvent.keyDown(shell(rendered), { key: "s", metaKey: true });
    fireEvent.keyDown(dialog, { key: "s", metaKey: true });
    expect(mapPutCalls(mock)).toHaveLength(0);
    expect(adventurePutCalls(mock)).toHaveLength(0);
  });

  it("suppresses the popup once the title is confirmed through the settings dialog", async () => {
    seedUnnamed(true);
    const mock = editorBackend();
    vi.stubGlobal("fetch", mock);
    const rendered = await mountReady();

    // Rename through the adventure settings dialog and save it: an explicit naming.
    screen.getByRole("menuitem", { name: t("editor.shell.menu.file") }).focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.click(
      await screen.findByRole("menuitem", { name: t("editor.shell.settings") }),
    );
    const settings = await screen.findByRole("dialog");
    const title = within(settings).getByLabelText(t("adventure.name"));
    await userEvent.clear(title);
    await userEvent.type(title, "Ironhold");
    await userEvent.click(within(settings).getByRole("button", { name: t("editor.save") }));
    await waitFor(() => expect(mapPutCalls(mock)).toHaveLength(1));
    const settingsBody = JSON.parse(String((mapPutCalls(mock)[0]?.[1] as RequestInit)?.body)) as {
      adventure: { title: string };
    };
    expect(settingsBody.adventure.title).toBe("Ironhold");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // A normal Save now writes the map directly — no first-save popup, because the title is
    // confirmed. C10 removed the toolbar's Save button, so this exercises ⌘S instead.
    fireEvent.keyDown(shell(rendered), { key: "s", metaKey: true });
    await waitFor(() => expect(mapPutCalls(mock)).toHaveLength(2));
    expect(screen.queryByText(t("editor.firstSave.title"))).toBeNull();
  });

  it("reaches the settings dialog from the File menu and edits max players there", async () => {
    seedUnnamed(false);
    const mock = editorBackend();
    vi.stubGlobal("fetch", mock);
    await mountReady();

    screen.getByRole("menuitem", { name: t("editor.shell.menu.file") }).focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.click(
      await screen.findByRole("menuitem", { name: t("editor.shell.settings") }),
    );
    const settings = await screen.findByRole("dialog");

    const players = within(settings).getByLabelText(t("adventure.players"));
    await userEvent.clear(players);
    await userEvent.type(players, "2");
    await userEvent.click(within(settings).getByRole("button", { name: t("editor.save") }));

    await waitFor(() => {
      const put = mapPutCalls(mock)[0];
      expect(put).toBeDefined();
      const body = JSON.parse(String((put?.[1] as RequestInit)?.body)) as {
        adventure: { maxPlayers: number };
      };
      expect(body.adventure.maxPlayers).toBe(2);
    });
  });
});

describe("main menu → editor navigation", () => {
  beforeEach(() => {
    setLocale("en");
    useUiStore.setState({ screen: "menu", accountId: "me", activeParty: null });
  });

  it("routes the discreet editor button to the merged adventure editor", async () => {
    render(<MainMenu />);

    await userEvent.click(await screen.findByRole("button", { name: "Editor" }));
    expect(useUiStore.getState().screen).toBe("adventure-editor");
  });
});
