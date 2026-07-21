import { layersFromBlocks } from "@lindocara/engine/map-migrate.js";
import { encodeTileLayer } from "@lindocara/engine/tile-layer-codec.js";
import { TINY_SWORDS_TILESET_ID } from "@lindocara/engine/tilesets/tiny-swords.js";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale, t } from "../../src/client/i18n.js";
import { useUiStore } from "../../src/client/store.js";
import { AdventureEditorScreen } from "../../src/client/ui/editor/AdventureEditorScreen.js";

// The Pixi stage never opens in these tests (the resolved adventure has an empty map list, so the
// shell stays on its empty state), but importing the screen pulls the stage module in — mock it so
// jsdom never touches PixiJS.
const stageMock = vi.hoisted(() => ({ openMapEditorStage: vi.fn(), dispose: vi.fn() }));
vi.mock("../../src/client/game/map-editor-stage.js", () => ({
  openMapEditorStage: stageMock.openMapEditorStage,
}));
vi.mock("../../src/client/game/map-preview.js", () => ({ startMapPreview: vi.fn() }));

const LAYERS = layersFromBlocks(Array.from({ length: 15 }, () => ".".repeat(20))).layers.map(
  encodeTileLayer,
);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function adventurePayload(id: string, mapIds: string[]): Record<string, unknown> {
  return {
    id,
    accountId: "acct",
    title: t("adventure.default_title"),
    maxPlayers: 4,
    version: 1,
    mapIds,
    graph: { start: null, links: [] },
    registry: { switches: [], variables: [] },
  };
}

function mapPayload(id: string): Record<string, unknown> {
  return {
    id,
    name: "Map1",
    revision: 1,
    tilesetId: TINY_SWORDS_TILESET_ID,
    cols: 20,
    rows: 15,
    layers: LAYERS,
    elements: [],
    spawn: { col: 9, row: 7 },
    markers: { entries: [], exits: [], monsterSpawns: [] },
    events: [],
  };
}

const KEY = "lindocara:editor:last-adventure:acct";

describe("AdventureEditorScreen bootstrap (UX wave #15)", () => {
  beforeEach(() => {
    setLocale("en");
    stageMock.openMapEditorStage.mockReset();
    stageMock.openMapEditorStage.mockResolvedValue({ dispose: stageMock.dispose });
    localStorage.clear();
    // No preseeded session: the editor must resolve its own opening adventure.
    useUiStore.setState({
      screen: "adventure-editor",
      accountId: "acct",
      adventureEditorSession: null,
    });
  });

  it("opens the last-edited adventure directly, without a picker or a create POST", async () => {
    localStorage.setItem(KEY, "adv-remembered");
    const mock = vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (url === "/api/adventures/adv-remembered" && method === "GET")
        return Promise.resolve(jsonResponse(adventurePayload("adv-remembered", ["m1"])));
      if (url === "/api/maps/m1" && method === "GET")
        return Promise.resolve(jsonResponse(mapPayload("m1")));
      if (url.startsWith("/api/maps?adventure=") && method === "GET")
        return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse({ error: "not_found" }, 404));
    });
    vi.stubGlobal("fetch", mock);

    render(<AdventureEditorScreen />);

    await waitFor(() =>
      expect(useUiStore.getState().adventureEditorSession?.adventureId).toBe("adv-remembered"),
    );
    // No adventure was created — the remembered one was loaded straight in.
    expect(
      mock.mock.calls.some(
        ([url, init]) => url === "/api/adventures" && (init as RequestInit)?.method === "POST",
      ),
    ).toBe(false);
  });

  it("instant-creates when the remembered adventure is gone (fallback to create)", async () => {
    localStorage.setItem(KEY, "adv-gone");
    const mock = vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      // The remembered id no longer resolves.
      if (url === "/api/adventures/adv-gone" && method === "GET")
        return Promise.resolve(jsonResponse({ error: "not_found" }, 404));
      if (url === "/api/adventures" && method === "POST")
        return Promise.resolve(
          jsonResponse(
            { ...adventurePayload("adv-new", ["m0"]), defaultMap: mapPayload("m0") },
            201,
          ),
        );
      if (url === "/api/adventures/adv-new" && method === "GET")
        return Promise.resolve(jsonResponse(adventurePayload("adv-new", ["m0"])));
      if (url === "/api/maps/m0" && method === "GET")
        return Promise.resolve(jsonResponse(mapPayload("m0")));
      if (url.startsWith("/api/maps?adventure=") && method === "GET")
        return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse({ error: "not_found" }, 404));
    });
    vi.stubGlobal("fetch", mock);

    render(<AdventureEditorScreen />);

    await waitFor(() =>
      expect(useUiStore.getState().adventureEditorSession?.adventureId).toBe("adv-new"),
    );
    // A brand-new adventure is created and flagged unnamed for the first-save popup.
    expect(useUiStore.getState().adventureEditorSession?.titleUntouched).toBe(true);
    const posts = mock.mock.calls.filter(
      ([url, init]) => url === "/api/adventures" && (init as RequestInit)?.method === "POST",
    );
    expect(posts).toHaveLength(1);
  });

  it("instant-creates when there is no remembered adventure at all", async () => {
    // localStorage cleared in beforeEach — no memory.
    const mock = vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (url === "/api/adventures" && method === "POST")
        return Promise.resolve(
          jsonResponse(
            { ...adventurePayload("adv-new", ["m0"]), defaultMap: mapPayload("m0") },
            201,
          ),
        );
      if (url === "/api/adventures/adv-new" && method === "GET")
        return Promise.resolve(jsonResponse(adventurePayload("adv-new", ["m0"])));
      if (url === "/api/maps/m0" && method === "GET")
        return Promise.resolve(jsonResponse(mapPayload("m0")));
      if (url.startsWith("/api/maps?adventure=") && method === "GET")
        return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse({ error: "not_found" }, 404));
    });
    vi.stubGlobal("fetch", mock);

    render(<AdventureEditorScreen />);

    await waitFor(() =>
      expect(useUiStore.getState().adventureEditorSession?.adventureId).toBe("adv-new"),
    );
    const posts = mock.mock.calls.filter(
      ([url, init]) => url === "/api/adventures" && (init as RequestInit)?.method === "POST",
    );
    expect(posts).toHaveLength(1);
    // And the newly opened adventure is remembered for next time.
    expect(localStorage.getItem(KEY)).toBe("adv-new");
  });
});
