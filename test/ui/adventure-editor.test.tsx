import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../src/client/i18n.js";
import { useUiStore } from "../../src/client/store.js";
import { AdventureEditor } from "../../src/client/ui/AdventureEditor.js";

const MAP_A = {
  id: "m1",
  name: "Verdant",
  blocks: ["...."],
  elements: [],
  spawn: { col: 0, row: 0 },
  markers: {
    entries: [{ id: "door", col: 1, row: 1 }],
    exits: [{ id: "east", col: 2, row: 2 }],
    monsterSpawns: [],
  },
};
const MAP_B = {
  id: "m2",
  name: "Frostfen",
  blocks: ["...."],
  elements: [],
  spawn: { col: 0, row: 0 },
  markers: {
    entries: [{ id: "west", col: 1, row: 1 }],
    exits: [{ id: "boss", col: 2, row: 2 }],
    monsterSpawns: [],
  },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fetchMock() {
  const adventures: Record<string, unknown>[] = [];
  return vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (url === "/api/maps" && method === "GET") {
      return jsonResponse([
        { id: "m1", name: "Verdant", isFirst: true },
        { id: "m2", name: "Frostfen", isFirst: false },
      ]);
    }
    if (url === "/api/maps/m1") return jsonResponse(MAP_A);
    if (url === "/api/maps/m2") return jsonResponse(MAP_B);
    if (url === "/api/adventures" && method === "GET") {
      return jsonResponse(
        adventures.map((a) => ({ id: a.id, title: a.title, maxPlayers: a.maxPlayers })),
      );
    }
    if (url === "/api/adventures" && method === "POST") {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const stored = { ...body, id: "adv-1", accountId: "acct", version: 1 };
      adventures.push(stored);
      return jsonResponse(stored, 201);
    }
    const one = url.match(/^\/api\/adventures\/([A-Za-z0-9-]+)$/);
    if (one) {
      const found = adventures.find((a) => a.id === one[1]);
      if (!found) return jsonResponse({ error: "adventure_not_found" }, 404);
      if (method === "GET") return jsonResponse(found);
      if (method === "DELETE") {
        adventures.splice(adventures.indexOf(found), 1);
        return jsonResponse(undefined, 204);
      }
    }
    return jsonResponse({ error: "not found" }, 404);
  });
}

describe("AdventureEditor", () => {
  beforeEach(() => {
    setLocale("en");
    useUiStore.setState({ screen: "adventures", characters: null });
  });

  it("builds and saves a complete adventure", async () => {
    const mock = fetchMock();
    vi.stubGlobal("fetch", mock);
    render(<AdventureEditor />);

    await userEvent.click(await screen.findByRole("button", { name: "New adventure" }));
    await userEvent.type(screen.getByLabelText("Title"), "Donjon");

    await userEvent.selectOptions(await screen.findByLabelText("Add a map"), "m1");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await within(screen.getByRole("region", { name: "Maps" })).findByText("Verdant");
    await userEvent.selectOptions(screen.getByLabelText("Add a map"), "m2");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await within(screen.getByRole("region", { name: "Maps" })).findByText("Frostfen");

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    await userEvent.selectOptions(screen.getByLabelText("Starting map"), "m1");
    await userEvent.selectOptions(screen.getByLabelText("Entry"), "door");
    await userEvent.selectOptions(screen.getByLabelText("east"), "m2::west");
    await userEvent.selectOptions(screen.getByLabelText("boss"), "end");

    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeEnabled();
    await userEvent.click(save);

    await waitFor(() =>
      expect(mock).toHaveBeenCalledWith(
        "/api/adventures",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            title: "Donjon",
            maxPlayers: 4,
            mapIds: ["m1", "m2"],
            graph: {
              start: { mapId: "m1", entryId: "door" },
              links: [
                { mapId: "m1", exitId: "east", dest: { mapId: "m2", entryId: "west" } },
                { mapId: "m2", exitId: "boss", dest: "end" },
              ],
            },
          }),
        }),
      ),
    );
    expect(await screen.findByText("Donjon")).toBeInTheDocument();
  });

  it("asks for confirmation before deleting", async () => {
    const mock = fetchMock();
    vi.stubGlobal("fetch", mock);
    render(<AdventureEditor />);
    // seed one adventure through the same mock backend
    await mock("/api/adventures", {
      method: "POST",
      body: JSON.stringify({
        title: "Donjon",
        maxPlayers: 4,
        mapIds: ["m1"],
        graph: { start: { mapId: "m1", entryId: "door" }, links: [] },
      }),
    });
    await userEvent.click(await screen.findByRole("button", { name: "Refresh" }));
    await screen.findByText("Donjon");

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Delete Donjon?");
    await userEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
    await waitFor(() => expect(screen.queryByText("Donjon")).not.toBeInTheDocument());
  });
});
