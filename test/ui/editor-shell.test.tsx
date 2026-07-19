import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MapPayload, MapSummary } from "../../src/client/api.js";
import { blankMap, toMapData, toSaveInput } from "../../src/client/game/editor-state.js";
import { setLocale, t } from "../../src/client/i18n.js";
import { useUiStore } from "../../src/client/store.js";
import { AdventureEditorScreen } from "../../src/client/ui/editor/AdventureEditorScreen.js";
import { PartiesScreen } from "../../src/client/ui/PartiesScreen.js";
import { EMPTY_MARKERS } from "../../src/shared/map-data.js";
import { layersFromBlocks } from "../../src/shared/map-migrate.js";
import { encodeTileLayer } from "../../src/shared/tile-layer-codec.js";
import { TINY_SWORDS_TILESET_ID } from "../../src/shared/tilesets/tiny-swords.js";

// The painting stage is Pixi on a real canvas — untestable in jsdom. A fake handle stands in so the
// tests exercise the shell's own behaviour: which EditorTool it pushes, that the layer selector
// reaches setActiveLayer, and that mount/unmount open and dispose the stage exactly once each.
const stageMock = vi.hoisted(() => ({
  openMapEditorStage: vi.fn(),
  setTool: vi.fn(),
  setActiveLayer: vi.fn(),
  setDim: vi.fn(),
  current: vi.fn(),
  setName: vi.fn(),
  undo: vi.fn(),
  redo: vi.fn(),
  markSaved: vi.fn(),
  selected: vi.fn(),
  setSelectedMarkerLabel: vi.fn(),
  moveSelected: vi.fn(),
  setSelectedElementAsset: vi.fn(),
  setSelectedMonster: vi.fn(),
  deleteSelected: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock("../../src/client/game/map-editor-stage.js", () => ({
  openMapEditorStage: stageMock.openMapEditorStage,
}));

function stageHandle() {
  return {
    setTool: stageMock.setTool,
    setActiveLayer: stageMock.setActiveLayer,
    setDim: stageMock.setDim,
    current: stageMock.current,
    setName: stageMock.setName,
    undo: stageMock.undo,
    redo: stageMock.redo,
    markSaved: stageMock.markSaved,
    selected: stageMock.selected,
    setSelectedMarkerLabel: stageMock.setSelectedMarkerLabel,
    moveSelected: stageMock.moveSelected,
    setSelectedElementAsset: stageMock.setSelectedElementAsset,
    setSelectedMonster: stageMock.setSelectedMonster,
    deleteSelected: stageMock.deleteSelected,
    dispose: stageMock.dispose,
  };
}

const previewMock = vi.hoisted(() => ({ startMapPreview: vi.fn(), stop: vi.fn() }));
vi.mock("../../src/client/game/map-preview.js", () => ({
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
  };
}

/** A tiny fake /api/maps* backend for the auto-open: list, then open the first map. */
function mapsFetchMock(maps: MapSummary[] = oneMap) {
  return vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (url === "/api/maps" && method === "GET") return Promise.resolve(jsonResponse(maps));
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
    if (url === "/api/maps" && method === "GET") return Promise.resolve(jsonResponse(list));
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

describe("AdventureEditorScreen shell", () => {
  beforeEach(() => {
    setLocale("en");
    useUiStore.setState({
      screen: "adventure-editor",
      adventureEditorSession: null,
      editorReturnContext: null,
    });
    for (const fn of Object.values(stageMock)) fn.mockReset();
    stageMock.openMapEditorStage.mockResolvedValue(stageHandle());
    stageMock.current.mockReturnValue({
      name: "Verdant Reach",
      layers: [],
      elements: [],
      spawn: { col: 20, row: 15 },
      markers: EMPTY_MARKERS,
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

  it("threads the layer selector to setActiveLayer and reflects it in the status bar", async () => {
    vi.stubGlobal("fetch", mapsFetchMock());
    await mountReady();

    expect(screen.getByText(t("editor.shell.layer", { n: 1 }))).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: t("editor.shell.layer", { n: 2 }) }));

    expect(stageMock.setActiveLayer).toHaveBeenLastCalledWith(1);
    expect(screen.getByText(t("editor.shell.layer", { n: 2 }))).toBeInTheDocument();
  });

  it("installs the layer selected while the stage was still opening, not the layer captured when the open effect started", async () => {
    vi.stubGlobal("fetch", mapsFetchMock());
    // Hold the stage-open promise open so the effect's `.then` has not run yet when we click.
    let resolveOpen!: (handle: ReturnType<typeof stageHandle>) => void;
    const openPromise = new Promise<ReturnType<typeof stageHandle>>((resolve) => {
      resolveOpen = resolve;
    });
    stageMock.openMapEditorStage.mockReturnValueOnce(openPromise);

    render(<AdventureEditorScreen />);
    await waitFor(() => expect(stageMock.openMapEditorStage).toHaveBeenCalledTimes(1));

    // The handle does not exist yet, so selecting layer 3 here can only reach the stage through
    // whatever the `.then` callback reads once it resolves — this is the race.
    await userEvent.click(screen.getByRole("button", { name: t("editor.shell.layer", { n: 3 }) }));
    expect(stageMock.setActiveLayer).not.toHaveBeenCalled();

    resolveOpen(stageHandle());
    await waitFor(() => expect(stageMock.setActiveLayer).toHaveBeenCalled());

    // Must be the layer selected during the open window (index 2), never the stale layer (index 0)
    // that was active when the effect started running.
    expect(stageMock.setActiveLayer).toHaveBeenCalledTimes(1);
    expect(stageMock.setActiveLayer).toHaveBeenLastCalledWith(2);
  });

  it("does not dispatch from a disabled menu item", async () => {
    vi.stubGlobal("fetch", mapsFetchMock());
    await mountReady();

    // The Base UI menubar opens reliably from the keyboard in jsdom (its click-to-open path depends
    // on layout measurement that jsdom does not provide).
    screen.getByRole("menuitem", { name: t("editor.shell.menu.game") }).focus();
    await userEvent.keyboard("{Enter}");
    const database = await screen.findByRole("menuitem", { name: t("editor.shell.database") });
    expect(database).toHaveAttribute("aria-disabled", "true");

    await userEvent.click(database);
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

  it("restores marker authoring: the entry tool places an entry and the inspector deletes a marker", async () => {
    vi.stubGlobal("fetch", mapsFetchMock());
    await mountReady();

    // The palette's entry tool pushes the marker-entry EditorTool down to the stage.
    await userEvent.click(screen.getByRole("button", { name: t("editor.tool.entry") }));
    expect(stageMock.setTool).toHaveBeenLastCalledWith({ kind: "marker-entry" });

    // A selected entry lights the inspector: its label shows, and Delete reaches deleteSelected.
    stageMock.current.mockReturnValue({
      name: "Verdant Reach",
      layers: [],
      elements: [],
      spawn: { col: 20, row: 15 },
      markers: {
        entries: [{ id: "door", label: "Front gate", col: 1, row: 1 }],
        exits: [],
        monsterSpawns: [],
      },
    });
    const callback = stageMock.openMapEditorStage.mock.calls[0]?.[1];
    act(() => {
      callback?.(payloadFor(oneMap[0] as MapSummary), {
        canUndo: false,
        canRedo: false,
        dirty: false,
        selection: { kind: "entry", id: "door" },
      });
    });

    expect(screen.getByDisplayValue("Front gate")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: t("editor.delete") }));
    expect(stageMock.deleteSelected).toHaveBeenCalledTimes(1);
  });

  it("selects marker tools and forwards monster species and radius to the stage", async () => {
    vi.stubGlobal("fetch", mapsFetchMock());
    await mountReady();

    await userEvent.click(screen.getByRole("button", { name: t("editor.tool.exit") }));
    expect(stageMock.setTool).toHaveBeenLastCalledWith({ kind: "marker-exit" });

    await userEvent.click(screen.getByRole("button", { name: t("editor.tool.monster") }));
    expect(stageMock.setTool).toHaveBeenLastCalledWith({
      kind: "marker-monster",
      species: "spear_goblin",
      patrolRadius: 96,
    });

    await userEvent.selectOptions(screen.getByLabelText(t("editor.markers.species")), "mire_troll");
    expect(stageMock.setTool).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "marker-monster", species: "mire_troll" }),
    );
  });

  it("saves the stage's current map to the update endpoint", async () => {
    const edited = {
      name: "Verdant Reach",
      layers: OPEN_TILE_LAYERS,
      elements: [
        { col: 2, row: 3, assetId: "resource.terrain-resources-wood-trees.tree4" as const },
      ],
      spawn: { col: 20, row: 15 },
      markers: EMPTY_MARKERS,
    };
    stageMock.current.mockReturnValue(edited);
    const mock = mapsBackend(twoMaps);
    vi.stubGlobal("fetch", mock);
    await mountReady();

    await userEvent.click(screen.getByRole("button", { name: t("editor.save") }));
    await waitFor(() =>
      expect(mock).toHaveBeenCalledWith(
        "/api/maps/m1",
        expect.objectContaining({ method: "PUT", body: JSON.stringify(toSaveInput(edited)) }),
      ),
    );
    expect(stageMock.markSaved).toHaveBeenCalledTimes(1);
  });

  it("previews the stage's current map, then Esc returns to editing with edits intact", async () => {
    const edited = {
      name: "Verdant Reach",
      layers: OPEN_TILE_LAYERS,
      elements: [
        { col: 2, row: 3, assetId: "resource.terrain-resources-wood-trees.tree4" as const },
      ],
      spawn: { col: 20, row: 15 },
      markers: EMPTY_MARKERS,
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

    await userEvent.click(
      screen.getAllByRole("button", { name: t("editor.new") })[0] as HTMLElement,
    );
    // The create form defaults to 40x30, exactly as the old MapEditor list screen did.
    expect(await screen.findByLabelText(t("editor.cols"))).toHaveValue(40);
    expect(screen.getByLabelText(t("editor.rows"))).toHaveValue(30);

    await userEvent.type(screen.getByLabelText(t("editor.name")), "Third map");
    await userEvent.click(screen.getByRole("button", { name: t("editor.shell.maps.create") }));

    await waitFor(() =>
      expect(mock).toHaveBeenCalledWith(
        "/api/maps",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify(toSaveInput(blankMap("Third map", 40, 30))),
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

    const search = screen.getByRole("searchbox", { name: t("editor.palette.search") });
    await userEvent.type(search, "tree3");
    await userEvent.click(screen.getByRole("button", { name: /tree3grasssolid/i }));
    await waitFor(() =>
      expect(stageMock.setTool).toHaveBeenCalledWith({
        kind: "element",
        assetId: "resource.terrain-resources-wood-trees.tree3",
      }),
    );
  });
});

describe("PartiesScreen → editor navigation", () => {
  beforeEach(() => {
    setLocale("en");
    useUiStore.setState({ screen: "parties", accountId: "me", activeParty: null });
  });

  it("routes the creator-tools button to the merged adventure editor", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url === "/api/parties") return Promise.resolve(jsonResponse([]));
        if (url === "/api/adventures") return Promise.resolve(jsonResponse([]));
        return Promise.resolve(jsonResponse({ error: "not_found" }, 404));
      }),
    );
    render(<PartiesScreen />);

    await userEvent.click(await screen.findByRole("button", { name: "Creator tools" }));
    expect(useUiStore.getState().screen).toBe("adventure-editor");
  });
});
