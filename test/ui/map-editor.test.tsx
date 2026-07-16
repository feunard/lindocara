import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CharacterSummary, MapPayload, MapSummary } from "../../src/client/api.js";
import { setLocale } from "../../src/client/i18n.js";
import { useUiStore } from "../../src/client/store.js";
import { CharacterSelect } from "../../src/client/ui/CharacterSelect.js";
import { MapEditor } from "../../src/client/ui/MapEditor.js";
import { starterEquipmentFor } from "../../src/shared/character.js";

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

/** A tiny fake /api/maps* backend: list, create, delete, and flag stay consistent with each
 *  other across calls the same way the real server's D1-backed one does. */
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
      };
      list.push({ id: created.id, name: created.name, isFirst: false });
      return Promise.resolve(jsonResponse(created, 201));
    }
    const deleteMatch = url.match(/^\/api\/maps\/([^/]+)$/);
    if (deleteMatch?.[1] && method === "DELETE") {
      const index = list.findIndex((m) => m.id === deleteMatch[1]);
      if (index >= 0) list.splice(index, 1);
      return Promise.resolve(new Response(null, { status: 204 }));
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
  });

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
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

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
});
