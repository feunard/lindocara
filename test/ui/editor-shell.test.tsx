import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MapPayload, MapSummary } from "../../src/client/api.js";
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

const OPEN_LAYERS = layersFromBlocks(Array.from({ length: 30 }, () => ".".repeat(40))).layers.map(
  encodeTileLayer,
);

const oneMap: MapSummary[] = [{ id: "m1", name: "Verdant Reach", revision: 1, isFirst: true }];

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
