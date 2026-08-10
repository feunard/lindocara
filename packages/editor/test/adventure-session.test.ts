import { setLocale, t } from "@lindocara/client/i18n.js";
import { ensureScratchAdventure } from "@lindocara/editor/ui/editor/adventure-session.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A minimal `MapPayload` shaped enough for `solidMaskFromMapPayload` and the event readers. */
function blankMap(id: string) {
  return {
    id,
    name: "Map 1",
    revision: 1,
    tilesetId: "tiny-swords",
    cols: 2,
    rows: 2,
    layers: [[], [], []],
    elements: [],
    events: [],
    markers: [],
    spawn: { col: 0, row: 0 },
    heightfield: "",
  };
}

describe("ensureScratchAdventure", () => {
  beforeEach(() => setLocale("en"));

  it("creates one adventure with the default title and needs no second request", async () => {
    const mock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/adventures" && init?.method === "POST") {
        return Promise.resolve(
          jsonResponse(
            {
              id: "adv-scratch",
              accountId: "acct",
              title: t("adventure.default_title"),
              maxPlayers: 4,
              version: 1,
              mapIds: ["map-1"],
              graph: { start: null, links: [] },
              registry: { switches: [], variables: [] },
              defaultMap: blankMap("map-1"),
            },
            201,
          ),
        );
      }
      return Promise.resolve(jsonResponse({ error: "unexpected_request" }, 500));
    });
    vi.stubGlobal("fetch", mock);

    const session = await ensureScratchAdventure();

    expect(session.adventureId).toBe("adv-scratch");
    expect(session.titleUntouched).toBe(true);
    expect(session.draft.title).toBe(t("adventure.default_title"));
    expect(session.draft.members.map((member) => member.mapId)).toEqual(["map-1"]);
    // Exactly one call, and it is the POST: no follow-up GET of the adventure or its maps.
    expect(mock).toHaveBeenCalledTimes(1);
    const [url, init] = mock.mock.calls[0] ?? [];
    expect(url).toBe("/api/adventures");
    expect((init as RequestInit | undefined)?.method).toBe("POST");
  });

  it("sends the localized default title", async () => {
    setLocale("fr");
    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        bodies.push(String(init?.body ?? ""));
        return Promise.resolve(
          jsonResponse(
            {
              id: "adv-fr",
              accountId: "acct",
              title: "Nouvelle aventure",
              maxPlayers: 4,
              version: 1,
              mapIds: ["map-1"],
              graph: { start: null, links: [] },
              registry: { switches: [], variables: [] },
              defaultMap: blankMap("map-1"),
            },
            201,
          ),
        );
      }),
    );

    await ensureScratchAdventure();

    expect(JSON.parse(bodies[0] ?? "{}").title).toBe("Nouvelle aventure");
  });
});
