import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdventureDraft, DraftMemberInfo } from "../../src/client/adventure-draft.js";
import { setLocale, t } from "../../src/client/i18n.js";
import { useUiStore } from "../../src/client/store.js";
import { AdventureSettingsDialog } from "../../src/client/ui/editor/AdventureSettingsDialog.js";
import { EMPTY_REGISTRY } from "../../src/shared/adventure-state.js";
import { layersFromBlocks } from "../../src/shared/map-migrate.js";
import { encodeTileLayer } from "../../src/shared/tile-layer-codec.js";
import { TINY_SWORDS_TILESET_ID } from "../../src/shared/tilesets/tiny-swords.js";

const OPEN_LAYERS = layersFromBlocks(Array.from({ length: 30 }, () => ".".repeat(40))).layers.map(
  encodeTileLayer,
);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mapPayload(
  id: string,
  name: string,
  entryId: string,
  exitId: string,
): Record<string, unknown> {
  return {
    id,
    name,
    revision: 1,
    tilesetId: TINY_SWORDS_TILESET_ID,
    cols: 40,
    rows: 30,
    layers: OPEN_LAYERS,
    elements: [],
    spawn: { col: 20, row: 15 },
    markers: {
      entries: [{ id: entryId, col: 1, row: 1 }],
      exits: [{ id: exitId, col: 2, row: 2 }],
      monsterSpawns: [],
    },
  };
}

/** A /api/adventures + /api/maps backend for the settings dialog. */
function backend() {
  const adventures: Record<string, unknown>[] = [];
  return vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (url.startsWith("/api/maps?adventure=") && method === "GET") {
      return Promise.resolve(
        jsonResponse([
          { id: "m1", name: "Verdant", revision: 1, cols: 40, rows: 30, isFirst: true },
          { id: "m2", name: "Frostfen", revision: 1, cols: 40, rows: 30, isFirst: false },
        ]),
      );
    }
    if (url === "/api/maps/m1")
      return Promise.resolve(jsonResponse(mapPayload("m1", "Verdant", "door", "east")));
    if (url === "/api/maps/m2")
      return Promise.resolve(jsonResponse(mapPayload("m2", "Frostfen", "west", "boss")));
    if (url === "/api/adventures" && method === "GET") {
      return Promise.resolve(
        jsonResponse(
          adventures.map((a) => ({ id: a.id, title: a.title, maxPlayers: a.maxPlayers })),
        ),
      );
    }
    if (url === "/api/adventures" && method === "POST") {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const stored = { ...body, id: "adv-1", accountId: "acct", version: 1 };
      adventures.push(stored);
      return Promise.resolve(jsonResponse(stored, 201));
    }
    const one = url.match(/^\/api\/adventures\/([A-Za-z0-9-]+)$/);
    if (one?.[1] && method === "PUT") {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Promise.resolve(jsonResponse({ ...body, id: one[1], accountId: "acct", version: 2 }));
    }
    if (one?.[1] && method === "DELETE") {
      const index = adventures.findIndex((a) => a.id === one[1]);
      if (index >= 0) adventures.splice(index, 1);
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    return Promise.resolve(jsonResponse({ error: "not_found" }, 404));
  });
}

function member(mapId: string, name: string, entryId: string, exitId: string): DraftMemberInfo {
  return {
    mapId,
    name,
    revision: 1,
    solid: ["."],
    monsterCount: 0,
    entryIds: [entryId],
    exitIds: [exitId],
    entryLabels: {},
    exitLabels: {},
  };
}

function seedSession(draft: AdventureDraft, adventureId: string | null): void {
  useUiStore.setState({
    adventureEditorSession: {
      adventureId,
      draftId: "draft-1",
      draft,
      invalidatedLinks: [],
      savedDraft: adventureId ? JSON.stringify(draft) : null,
    },
  });
}

const noop = () => {};

describe("AdventureSettingsDialog", () => {
  beforeEach(() => {
    setLocale("en");
    useUiStore.setState({ adventureEditorSession: null });
  });

  it("round-trips the title and max players through the update endpoint", async () => {
    const complete: AdventureDraft = {
      title: "Original",
      maxPlayers: 4,
      members: [member("m1", "Verdant", "door", "east")],
      start: { mapId: "m1", entryId: "door" },
      bindings: [{ mapId: "m1", exitId: "east", dest: "end" }],
      registry: EMPTY_REGISTRY,
    };
    seedSession(complete, "adv-1");
    const mock = backend();
    vi.stubGlobal("fetch", mock);
    render(
      <AdventureSettingsDialog open onOpenChange={noop} onSaved={noop} onSessionExpired={noop} />,
    );

    const title = await screen.findByLabelText(t("adventure.name"));
    await userEvent.clear(title);
    await userEvent.type(title, "Renamed");
    const players = screen.getByLabelText(t("adventure.players"));
    await userEvent.clear(players);
    await userEvent.type(players, "3");

    await userEvent.click(screen.getByRole("button", { name: t("editor.save") }));

    await waitFor(() => {
      const put = mock.mock.calls.find(
        ([url, init]) => url === "/api/adventures/adv-1" && (init as RequestInit)?.method === "PUT",
      );
      expect(put).toBeDefined();
      const body = JSON.parse(String((put?.[1] as RequestInit)?.body)) as {
        title: string;
        maxPlayers: number;
      };
      expect(body.title).toBe("Renamed");
      expect(body.maxPlayers).toBe(3);
    });
  });

  it("deletes the edited adventure behind a confirm and clears the editing session", async () => {
    const complete: AdventureDraft = {
      title: "Donjon",
      maxPlayers: 4,
      members: [member("m1", "Verdant", "door", "east")],
      start: { mapId: "m1", entryId: "door" },
      bindings: [{ mapId: "m1", exitId: "east", dest: "end" }],
      registry: EMPTY_REGISTRY,
    };
    seedSession(complete, "adv-1");
    const mock = backend();
    vi.stubGlobal("fetch", mock);
    render(
      <AdventureSettingsDialog open onOpenChange={noop} onSaved={noop} onSessionExpired={noop} />,
    );

    // Delete is confirm-gated: the first click only raises the confirm, it does not call the endpoint.
    await userEvent.click(await screen.findByRole("button", { name: t("editor.delete") }));
    expect(await screen.findByText(t("adventure.delete.title", { name: "Donjon" }))).toBeVisible();
    expect(
      mock.mock.calls.find(([, init]) => (init as RequestInit)?.method === "DELETE"),
    ).toBeUndefined();

    await userEvent.click(screen.getByRole("button", { name: t("editor.delete.confirm") }));

    await waitFor(() =>
      expect(mock).toHaveBeenCalledWith(
        "/api/adventures/adv-1",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
    // The deleted adventure's editing session is torn down, so the dialog falls back to the picker.
    await waitFor(() => expect(useUiStore.getState().adventureEditorSession).toBeNull());
  });

  it("renders the validation message for a graph with an unbound exit", async () => {
    const withUnbound: AdventureDraft = {
      title: "Draft",
      maxPlayers: 4,
      members: [member("m1", "Verdant", "door", "gate")],
      start: { mapId: "m1", entryId: "door" },
      bindings: [{ mapId: "m1", exitId: "gate", dest: null }],
      registry: EMPTY_REGISTRY,
    };
    seedSession(withUnbound, "adv-1");
    vi.stubGlobal("fetch", backend());
    render(
      <AdventureSettingsDialog open onOpenChange={noop} onSaved={noop} onSessionExpired={noop} />,
    );

    expect(
      await screen.findByText(
        t("adventure.validation.unbound_exit", { map: "Verdant", exit: "gate" }),
      ),
    ).toBeInTheDocument();
  });

  it("saves a partially-wired adventure — no start, unbound exit — with Save enabled (D25)", async () => {
    const partial: AdventureDraft = {
      title: "Draft",
      maxPlayers: 4,
      members: [member("m1", "Verdant", "door", "gate")],
      // No start and the sole exit unbound: the old model blocked Save here; it must persist now.
      start: null,
      bindings: [{ mapId: "m1", exitId: "gate", dest: null }],
      registry: EMPTY_REGISTRY,
    };
    seedSession(partial, "adv-1");
    const mock = backend();
    vi.stubGlobal("fetch", mock);
    render(
      <AdventureSettingsDialog open onOpenChange={noop} onSaved={noop} onSessionExpired={noop} />,
    );

    const save = await screen.findByRole("button", { name: t("editor.save") });
    expect(save).toBeEnabled();
    await userEvent.click(save);

    await waitFor(() => {
      const put = mock.mock.calls.find(
        ([url, init]) => url === "/api/adventures/adv-1" && (init as RequestInit)?.method === "PUT",
      );
      expect(put).toBeDefined();
      const body = JSON.parse(String((put?.[1] as RequestInit)?.body)) as {
        graph: { start: unknown; links: unknown[] };
      };
      // The unwired graph rides the PUT: a null start and no links (the unbound exit is omitted).
      expect(body.graph.start).toBeNull();
      expect(body.graph.links).toEqual([]);
    });
  });
});
