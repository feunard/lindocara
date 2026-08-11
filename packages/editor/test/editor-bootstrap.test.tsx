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
import { ReactRouter } from "alepha/react/router";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function mountScreen() {
  const alepha = Alepha.create().with(AlephaReact);
  alepha.inject(ReactRouter);
  await alepha.start();
  const result = render(
    <StrictMode>
      <AlephaContext.Provider value={alepha}>
        <AdventureEditorScreen />
      </AlephaContext.Provider>
    </StrictMode>,
  );
  return { ...result, alepha };
}

const stageMock = vi.hoisted(() => ({ openMapEditorStage: vi.fn() }));
vi.mock("@lindocara/editor/game/map-editor-stage.js", () => ({
  openMapEditorStage: stageMock.openMapEditorStage,
}));
vi.mock("@lindocara/editor/game/map-preview.js", () => ({ startMapPreview: vi.fn() }));

const OPEN_LAYERS = layersFromBlocks(Array.from({ length: 15 }, () => ".".repeat(20))).layers.map(
  encodeTileLayer,
);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mapPayload(id: string, name: string) {
  return {
    id,
    name,
    revision: 1,
    tilesetId: TINY_SWORDS_TILESET_ID,
    cols: 20,
    rows: 15,
    layers: OPEN_LAYERS,
    elements: [],
    events: [],
    markers: EMPTY_MARKERS,
    spawn: { col: 10, row: 7 },
    dayNightCycle: true,
    fixedLighting: "day",
    heightfield: null,
  };
}

function adventurePayload(id: string, title: string, mapIds: string[]) {
  return {
    id,
    accountId: "acct",
    title,
    maxPlayers: 4,
    version: 1,
    mapIds,
    graph: { start: null, links: [] },
    registry: { switches: [], variables: [] },
  };
}

describe("AdventureEditorScreen map picker", () => {
  let alephaInstances: Array<{ stop(): Promise<void> }> = [];

  beforeEach(() => {
    setLocale("en");
    localStorage.clear();
    stageMock.openMapEditorStage.mockReset();
    stageMock.openMapEditorStage.mockReturnValue(new Promise(() => {}));
  });

  afterEach(async () => {
    for (const alepha of alephaInstances) await alepha.stop();
    alephaInstances = [];
  });

  it("lists existing maps without creating a scratch adventure on entry", async () => {
    const mock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/adventures" && (init?.method ?? "GET") === "GET") {
        return Promise.resolve(
          jsonResponse([
            { id: "adv-1", title: "Moon Keep", maxPlayers: 4, mapCount: 1, playable: true },
            { id: "adv-2", title: "Sunken Road", maxPlayers: 4, mapCount: 1, playable: true },
          ]),
        );
      }
      if (url === "/api/maps?adventure=adv-1") {
        return Promise.resolve(
          jsonResponse([
            { id: "map-1", name: "Moon Gate", revision: 1, cols: 20, rows: 15, isFirst: true },
          ]),
        );
      }
      if (url === "/api/maps?adventure=adv-2") {
        return Promise.resolve(
          jsonResponse([
            { id: "map-2", name: "Flooded Path", revision: 1, cols: 24, rows: 18, isFirst: false },
          ]),
        );
      }
      return Promise.resolve(jsonResponse({ error: "unexpected_request" }, 500));
    });
    vi.stubGlobal("fetch", mock);

    const { alepha } = await mountScreen();
    alephaInstances.push(alepha);

    expect(await screen.findByRole("heading", { name: t("editor.picker.title") })).toBeVisible();
    expect(await screen.findByText("Moon Gate")).toBeVisible();
    expect(screen.getByText("Flooded Path")).toBeVisible();
    expect(alepha.store.get(adventureEditorSessionAtom)).toBeNull();
    expect(
      mock.mock.calls.filter(
        ([url, init]) =>
          url === "/api/adventures" && (init as RequestInit | undefined)?.method === "POST",
      ),
    ).toHaveLength(0);
    expect(mock.mock.calls.filter(([url]) => url === "/api/adventures")).toHaveLength(1);
  });

  it("opens the exact map selected on the landing page", async () => {
    const payload = mapPayload("map-2", "Flooded Path");
    const mock = vi.fn((url: string) => {
      if (url === "/api/adventures") {
        return Promise.resolve(
          jsonResponse([
            { id: "adv-2", title: "Sunken Road", maxPlayers: 4, mapCount: 1, playable: true },
          ]),
        );
      }
      if (url === "/api/maps?adventure=adv-2") {
        return Promise.resolve(
          jsonResponse([
            { id: "map-2", name: "Flooded Path", revision: 1, cols: 20, rows: 15, isFirst: true },
          ]),
        );
      }
      if (url === "/api/adventures/adv-2") {
        return Promise.resolve(jsonResponse(adventurePayload("adv-2", "Sunken Road", ["map-2"])));
      }
      if (url === "/api/maps/map-2") return Promise.resolve(jsonResponse(payload));
      return Promise.resolve(jsonResponse({ error: "unexpected_request" }, 500));
    });
    vi.stubGlobal("fetch", mock);

    const { alepha } = await mountScreen();
    alephaInstances.push(alepha);
    await userEvent.click(await screen.findByRole("button", { name: /Flooded Path/ }));

    await waitFor(() =>
      expect(alepha.store.get(adventureEditorSessionAtom)).toMatchObject({
        adventureId: "adv-2",
        initialMapId: "map-2",
      }),
    );
  });

  it("creates a new map only after the explicit action", async () => {
    const createdMap = mapPayload("map-new", "Map 1");
    const mock = vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (url === "/api/adventures" && method === "GET") return Promise.resolve(jsonResponse([]));
      if (url === "/api/adventures" && method === "POST") {
        return Promise.resolve(
          jsonResponse(
            {
              ...adventurePayload("adv-new", t("adventure.default_title"), ["map-new"]),
              defaultMap: createdMap,
            },
            201,
          ),
        );
      }
      if (url === "/api/maps?adventure=adv-new") return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse({ error: "unexpected_request" }, 500));
    });
    vi.stubGlobal("fetch", mock);

    const { alepha } = await mountScreen();
    alephaInstances.push(alepha);
    await screen.findByText(t("editor.picker.empty"));
    expect(
      mock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST"),
    ).toHaveLength(0);

    await userEvent.click(screen.getByRole("button", { name: t("editor.picker.create") }));

    await waitFor(() =>
      expect(alepha.store.get(adventureEditorSessionAtom)).toMatchObject({
        adventureId: "adv-new",
        initialMapId: "map-new",
        titleUntouched: true,
      }),
    );
    expect(
      mock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST"),
    ).toHaveLength(1);
  });
});
