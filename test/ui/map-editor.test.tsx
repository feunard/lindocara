import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CharacterSummary, MapPayload, MapSummary } from "../../src/client/api.js";
import { setLocale } from "../../src/client/i18n.js";
import { useUiStore } from "../../src/client/store.js";
import { CharacterSelect } from "../../src/client/ui/CharacterSelect.js";
import { MapEditor } from "../../src/client/ui/MapEditor.js";
import { starterEquipmentFor } from "../../src/shared/character.js";
import { EMPTY_MARKERS } from "../../src/shared/map-data.js";

// The painting stage is Pixi on a real canvas — untestable in jsdom and not this suite's subject.
// A fake handle stands in for it so the tests exercise the toolbar's own behaviour: which tool is
// marked, that Save hands the stage's `current()` to the API, and that Back disposes the stage.
const stageMock = vi.hoisted(() => ({
  openMapEditorStage: vi.fn(),
  setTool: vi.fn(),
  setName: vi.fn(),
  current: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock("../../src/client/game/map-editor-stage.js", () => ({
  openMapEditorStage: stageMock.openMapEditorStage,
}));

// The preview is a real Pixi renderer walking a throwaway warrior — untestable in jsdom. A fake
// starter stands in so the tests can assert the button hands it `current()` and Esc stops it.
const previewMock = vi.hoisted(() => ({
  startMapPreview: vi.fn(),
  stop: vi.fn(),
}));

vi.mock("../../src/client/game/map-preview.js", () => ({
  startMapPreview: previewMock.startMapPreview,
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const oneCharacter: CharacterSummary[] = [
  {
    id: "1",
    name: "One",
    appearance: { body: "wayfarer", primaryColor: "azure" },
    equipment: starterEquipmentFor("warrior"),
    level: 1,
    class: "warrior",
  },
];

const twoMaps: MapSummary[] = [
  { id: "m1", name: "Verdant Reach", isFirst: true },
  { id: "m2", name: "Frostfen", isFirst: false },
];

const MARKERS = {
  entries: [{ id: "door", col: 1, row: 1 }],
  exits: [{ id: "gate", col: 2, row: 2 }],
  monsterSpawns: [],
};

function payloadFor(summary: MapSummary): MapPayload {
  return {
    id: summary.id,
    name: summary.name,
    blocks: Array.from({ length: 30 }, () => ".".repeat(40)),
    elements: [],
    spawn: { col: 20, row: 15 },
    markers: MARKERS,
  };
}

/** A tiny fake /api/maps* backend: list, create, open, update, delete, and flag stay consistent
 *  with each other across calls the same way the real server's D1-backed one does. */
function fetchMock(maps: MapSummary[] = twoMaps) {
  const list = maps.map((m) => ({ ...m }));
  return vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (url === "/api/maps" && method === "GET") return Promise.resolve(jsonResponse(list));
    if (url === "/api/maps" && method === "POST") {
      const created: MapPayload = {
        id: "new",
        name: "New map",
        blocks: Array.from({ length: 30 }, () => ".".repeat(40)),
        elements: [],
        spawn: { col: 20, row: 15 },
        markers: EMPTY_MARKERS,
      };
      list.push({ id: created.id, name: created.name, isFirst: false });
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
        return Promise.resolve(jsonResponse({ id: idMatch[1], ...(body as object) }));
      }
      if (method === "DELETE") {
        const index = list.findIndex((m) => m.id === idMatch[1]);
        if (index >= 0) list.splice(index, 1);
        return Promise.resolve(new Response(null, { status: 204 }));
      }
    }
    const firstMatch = url.match(/^\/api\/maps\/([^/]+)\/first$/);
    if (firstMatch?.[1] && method === "POST") {
      for (const m of list) m.isFirst = m.id === firstMatch[1];
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    return Promise.resolve(jsonResponse({ error: "map_not_found" }, 404));
  });
}

describe("MapEditor", () => {
  beforeEach(() => {
    setLocale("en");
    useUiStore.setState({ screen: "map-editor", characters: null });
    for (const fn of Object.values(stageMock)) fn.mockReset();
    stageMock.openMapEditorStage.mockResolvedValue({
      setTool: stageMock.setTool,
      current: stageMock.current,
      setName: stageMock.setName,
      dispose: stageMock.dispose,
    });
    previewMock.startMapPreview.mockReset();
    previewMock.stop.mockReset();
    previewMock.startMapPreview.mockResolvedValue({ stop: previewMock.stop });
  });

  /** Opens the first map (m1) into the painting stage and waits until the stage handle is wired,
   *  so a following toolbar action actually reaches the (fake) handle. */
  async function openFirstMap(): Promise<void> {
    await screen.findByText("Verdant Reach");
    await userEvent.click(screen.getAllByRole("button", { name: "Open" })[0] as HTMLElement);
    await waitFor(() => expect(stageMock.openMapEditorStage).toHaveBeenCalledTimes(1));
    await screen.findByRole("button", { name: "Water" });
  }

  it("is reachable from character select via a Map editor button", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([])));
    useUiStore.setState({ screen: "characters", characters: oneCharacter });
    render(<CharacterSelect onPlay={() => undefined} />);

    await userEvent.click(screen.getByRole("button", { name: "Map editor" }));
    expect(useUiStore.getState().screen).toBe("map-editor");
  });

  it("lists fetched maps with a first-map marker and a create form defaulting to 40x30", async () => {
    vi.stubGlobal("fetch", fetchMock());
    render(<MapEditor />);

    expect(await screen.findByText("Verdant Reach")).toBeInTheDocument();
    expect(screen.getByText("Frostfen")).toBeInTheDocument();
    expect(screen.getByText("Front door")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("");
    expect(screen.getByLabelText("Columns")).toHaveValue(40);
    expect(screen.getByLabelText("Rows")).toHaveValue(30);
  });

  it("asks for confirmation before deleting, then refreshes the list", async () => {
    const mock = fetchMock();
    vi.stubGlobal("fetch", mock);
    render(<MapEditor />);
    await screen.findByText("Frostfen");

    await userEvent.click(screen.getAllByRole("button", { name: "Delete" })[1] as HTMLElement);
    expect(mock).not.toHaveBeenCalledWith(
      "/api/maps/m2",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Delete Frostfen?");

    await userEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
    expect(mock).toHaveBeenCalledWith(
      "/api/maps/m2",
      expect.objectContaining({ method: "DELETE" }),
    );
    await waitFor(() => expect(screen.queryByText("Frostfen")).not.toBeInTheDocument());
  });

  it('calls the "make first" endpoint and refreshes the front-door flag', async () => {
    const mock = fetchMock();
    vi.stubGlobal("fetch", mock);
    render(<MapEditor />);
    await screen.findByText("Frostfen");

    await userEvent.click(screen.getByRole("button", { name: "Make front door" }));
    expect(mock).toHaveBeenCalledWith(
      "/api/maps/m2/first",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("returns to character select via Back", async () => {
    vi.stubGlobal("fetch", fetchMock());
    render(<MapEditor />);
    await screen.findByText("Verdant Reach");

    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(useUiStore.getState().screen).toBe("characters");
  });

  it("never bricks on a failed load: shows the error and keeps Back usable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network down")));
    render(<MapEditor />);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(useUiStore.getState().screen).toBe("characters");
  });

  it("redirects to the auth screen when the session has expired", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: "session_expired" }, 401)),
    );
    render(<MapEditor />);

    await waitFor(() => expect(useUiStore.getState().screen).toBe("auth"));
  });

  it("opens a map into the painting stage and marks the selected tool", async () => {
    vi.stubGlobal("fetch", fetchMock());
    render(<MapEditor />);
    await openFirstMap();

    // Grass is the default tool; selecting Water moves the mark and pushes the tool to the stage.
    expect(screen.getByRole("button", { name: "Grass" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Water" }));

    expect(screen.getByRole("button", { name: "Water" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Grass" })).toHaveAttribute("aria-pressed", "false");
    await waitFor(() =>
      expect(stageMock.setTool).toHaveBeenCalledWith({ kind: "block", block: "water" }),
    );
  });

  it("searches the catalogue palette and selects visible variants directly", async () => {
    vi.stubGlobal("fetch", fetchMock());
    render(<MapEditor />);
    await openFirstMap();

    const search = screen.getByRole("searchbox", { name: "Search placeable assets" });
    await userEvent.type(search, "tree3");
    const treeThree = screen.getByRole("button", { name: /tree3grasssolid/i });
    expect(treeThree).toHaveAttribute("data-collision", "true");
    await userEvent.click(treeThree);
    await waitFor(() =>
      expect(stageMock.setTool).toHaveBeenCalledWith({
        kind: "element",
        assetId: "resource.terrain-resources-wood-trees.tree3",
      }),
    );

    await userEvent.clear(search);
    await userEvent.type(search, "tree4");
    await userEvent.click(screen.getByRole("button", { name: /tree4grasssolid/i }));
    expect(stageMock.setTool).toHaveBeenLastCalledWith({
      kind: "element",
      assetId: "resource.terrain-resources-wood-trees.tree4",
    });
  });

  it("saves the stage's current map to the update endpoint", async () => {
    const edited = {
      name: "Verdant Reach",
      blocks: Array.from({ length: 30 }, () => ".".repeat(40)),
      elements: [
        { col: 2, row: 3, assetId: "resource.terrain-resources-wood-trees.tree4" as const },
      ],
      spawn: { col: 20, row: 15 },
      markers: MARKERS,
    };
    stageMock.current.mockReturnValue(edited);
    const mock = fetchMock();
    vi.stubGlobal("fetch", mock);
    render(<MapEditor />);
    await openFirstMap();

    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mock).toHaveBeenCalledWith(
        "/api/maps/m1",
        expect.objectContaining({ method: "PUT", body: JSON.stringify(edited) }),
      ),
    );
  });

  it("previews the stage's current map, then Esc returns to editing with edits intact", async () => {
    const edited = {
      name: "Verdant Reach",
      blocks: Array.from({ length: 30 }, () => ".".repeat(40)),
      elements: [
        { col: 2, row: 3, assetId: "resource.terrain-resources-wood-trees.tree4" as const },
      ],
      spawn: { col: 20, row: 15 },
    };
    stageMock.current.mockReturnValue(edited);
    vi.stubGlobal("fetch", fetchMock());
    render(<MapEditor />);
    await openFirstMap();

    // Preview starts the sandbox with the current map (its name stripped to MapData) and hides
    // the toolbar.
    await userEvent.click(screen.getByRole("button", { name: "Preview" }));
    await waitFor(() =>
      expect(previewMock.startMapPreview).toHaveBeenCalledWith({
        blocks: edited.blocks,
        elements: edited.elements,
        spawn: edited.spawn,
      }),
    );
    expect(screen.queryByRole("button", { name: "Water" })).not.toBeInTheDocument();

    // Esc stops the preview and reopens the editor from the captured edits — not the pristine map.
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(previewMock.stop).toHaveBeenCalled());
    await screen.findByRole("button", { name: "Water" });
    expect(stageMock.openMapEditorStage).toHaveBeenLastCalledWith(edited, expect.any(Function));
  });

  it("disposes the stage and returns to the list via Back", async () => {
    vi.stubGlobal("fetch", fetchMock());
    render(<MapEditor />);
    await openFirstMap();

    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(stageMock.dispose).toHaveBeenCalled());
    expect(await screen.findByText("Frostfen")).toBeInTheDocument();
  });

  it("selects marker tools and forwards monster species and radius to the stage", async () => {
    vi.stubGlobal("fetch", fetchMock());
    render(<MapEditor />);
    await openFirstMap();

    await userEvent.click(screen.getByRole("button", { name: "Entry" }));
    expect(stageMock.setTool).toHaveBeenLastCalledWith({ kind: "marker-entry" });

    await userEvent.click(screen.getByRole("button", { name: "Exit" }));
    expect(stageMock.setTool).toHaveBeenLastCalledWith({ kind: "marker-exit" });

    await userEvent.click(screen.getByRole("button", { name: "Monster" }));
    expect(stageMock.setTool).toHaveBeenLastCalledWith({
      kind: "marker-monster",
      species: "spear_goblin",
      patrolRadius: 96,
    });

    await userEvent.selectOptions(screen.getByLabelText("Species"), "mire_troll");
    expect(stageMock.setTool).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "marker-monster", species: "mire_troll" }),
    );
  });
});
