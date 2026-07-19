import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale, t } from "../../src/client/i18n.js";
import type { AdventureEditorSession } from "../../src/client/store.js";
import { AdventurePicker } from "../../src/client/ui/editor/AdventurePicker.js";
import { layersFromBlocks } from "../../src/shared/map-migrate.js";
import { encodeTileLayer } from "../../src/shared/tile-layer-codec.js";
import { TINY_SWORDS_TILESET_ID } from "../../src/shared/tilesets/tiny-swords.js";

const LAYERS = layersFromBlocks(Array.from({ length: 15 }, () => ".".repeat(20))).layers.map(
  encodeTileLayer,
);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mapPayload(id: string): Record<string, unknown> {
  return {
    id,
    name: "Map",
    revision: 1,
    tilesetId: TINY_SWORDS_TILESET_ID,
    cols: 20,
    rows: 15,
    layers: LAYERS,
    elements: [],
    spawn: { col: 9, row: 7 },
    markers: { entries: [], exits: [], monsterSpawns: [] },
    // Entries and exits are typed events now (UX wave #12); the graph binds their uuids. `memberInfo`
    // derives the member's entry/exit ids from these, so the loaded session's start matches the graph.
    events: [
      {
        id: "start",
        col: 9,
        row: 7,
        name: "",
        ordinal: 1,
        kind: "entry",
        species: null,
        patrolRadius: null,
        pages: [],
      },
      {
        id: "exit",
        col: 7,
        row: 5,
        name: "",
        ordinal: 2,
        kind: "exit",
        species: null,
        patrolRadius: null,
        pages: [],
      },
    ],
  };
}

const noop = () => {};

describe("AdventurePicker", () => {
  beforeEach(() => {
    setLocale("en");
  });

  it("lists the account's adventures with a map count and a playable/draft badge", async () => {
    const mock = vi.fn((url: string) => {
      if (url === "/api/adventures")
        return Promise.resolve(
          jsonResponse([
            { id: "a1", title: "Playable one", maxPlayers: 4, mapCount: 3, playable: true },
            { id: "a2", title: "Draft one", maxPlayers: 2, mapCount: 1, playable: false },
          ]),
        );
      return Promise.resolve(jsonResponse({ error: "not_found" }, 404));
    });
    vi.stubGlobal("fetch", mock);

    render(<AdventurePicker onOpen={noop} onExit={noop} onSessionExpired={noop} />);

    expect(await screen.findByText("Playable one")).toBeInTheDocument();
    expect(screen.getByText("Draft one")).toBeInTheDocument();
    // The playable badge and the draft badge both render, one per card.
    expect(screen.getByText(t("editor.picker.playable"))).toBeInTheDocument();
    expect(screen.getByText(t("editor.picker.draft"))).toBeInTheDocument();
    expect(screen.getByText(t("editor.picker.maps", { count: 3 }))).toBeInTheDocument();
  });

  it("has no creation form — just a single New-adventure button (UX wave #14)", async () => {
    const mock = vi.fn((url: string) => {
      if (url === "/api/adventures") return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse({ error: "not_found" }, 404));
    });
    vi.stubGlobal("fetch", mock);

    render(<AdventurePicker onOpen={noop} onExit={noop} onSessionExpired={noop} />);

    // The create button is present…
    expect(
      await screen.findByRole("button", { name: t("editor.picker.create.heading") }),
    ).toBeInTheDocument();
    // …but the name/players form fields the create page used to carry are gone: naming is deferred to
    // the first save, max players to the settings dialog.
    expect(screen.queryByLabelText(t("adventure.name"))).toBeNull();
    expect(screen.queryByLabelText(t("adventure.players"))).toBeNull();
  });

  it("creates immediately with the localized default title + 4 players and hands the session to the editor (UX wave #14)", async () => {
    let opened: AdventureEditorSession | null = null;
    const mock = vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (url === "/api/adventures" && method === "GET") return Promise.resolve(jsonResponse([]));
      if (url === "/api/adventures" && method === "POST") {
        return Promise.resolve(
          jsonResponse(
            {
              id: "adv-new",
              accountId: "acct",
              title: t("adventure.default_title"),
              maxPlayers: 4,
              version: 1,
              mapIds: ["m0"],
              graph: { start: { mapId: "m0", entryId: "start" }, links: [] },
              registry: { switches: [], variables: [] },
              defaultMap: mapPayload("m0"),
            },
            201,
          ),
        );
      }
      // loadAdventureSession after create: GET the adventure, then GET its one map.
      if (url === "/api/adventures/adv-new" && method === "GET")
        return Promise.resolve(
          jsonResponse({
            id: "adv-new",
            accountId: "acct",
            title: t("adventure.default_title"),
            maxPlayers: 4,
            version: 1,
            mapIds: ["m0"],
            graph: { start: { mapId: "m0", entryId: "start" }, links: [] },
            registry: { switches: [], variables: [] },
          }),
        );
      if (url === "/api/maps/m0" && method === "GET")
        return Promise.resolve(jsonResponse(mapPayload("m0")));
      return Promise.resolve(jsonResponse({ error: "not_found" }, 404));
    });
    vi.stubGlobal("fetch", mock);

    render(
      <AdventurePicker
        onOpen={(session) => {
          opened = session;
        }}
        onExit={noop}
        onSessionExpired={noop}
      />,
    );

    await userEvent.click(
      await screen.findByRole("button", { name: t("editor.picker.create.heading") }),
    );

    await waitFor(() => expect(opened).not.toBeNull());
    // Exactly one POST /api/adventures — the atomic create, not a create-then-add-map sequence.
    const posts = mock.mock.calls.filter(
      ([url, init]) => url === "/api/adventures" && (init as RequestInit)?.method === "POST",
    );
    expect(posts).toHaveLength(1);
    const body = JSON.parse(String((posts[0]?.[1] as RequestInit)?.body)) as {
      title: string;
      maxPlayers: number;
    };
    // The default title is the localized DATA the picker sends; max players defaults to 4 (never a
    // create-time form field any more).
    expect(body.title).toBe(t("adventure.default_title"));
    expect(body.maxPlayers).toBe(4);
    const session = opened as unknown as AdventureEditorSession;
    expect(session.adventureId).toBe("adv-new");
    // The session is flagged unnamed so the editor's first save prompts for the real title.
    expect(session.titleUntouched).toBe(true);
  });
});
