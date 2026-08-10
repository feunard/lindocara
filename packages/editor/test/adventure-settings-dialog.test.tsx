import type { AdventureDraft, DraftMemberInfo } from "@lindocara/client/adventure-draft.js";
import { setLocale, t } from "@lindocara/client/i18n.js";
import { adventureEditorSessionAtom } from "@lindocara/client/state/atoms.js";
import { AdventureSettingsDialog } from "@lindocara/editor/ui/editor/AdventureSettingsDialog.js";
import { EMPTY_REGISTRY } from "@lindocara/engine/adventure-state.js";
import { DEFAULT_ADVENTURE_AUDIO } from "@lindocara/engine/audio-catalog.js";
import { layersFromBlocks } from "@lindocara/engine/map-migrate.js";
import { encodeTileLayer } from "@lindocara/engine/tile-layer-codec.js";
import { TINY_SWORDS_TILESET_ID } from "@lindocara/engine/tilesets/tiny-swords.js";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Alepha } from "alepha";
import { renderWithAlepha } from "alepha/react/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    const one = url.split("?")[0]?.match(/^\/api\/adventures\/([A-Za-z0-9-]+)$/);
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

interface EditorSessionFixture {
  adventureId: string | null;
  draftId: string;
  draft: AdventureDraft;
  invalidatedLinks: string[];
  savedDraft: string | null;
}

function sessionFixture(draft: AdventureDraft, adventureId: string | null): EditorSessionFixture {
  return {
    adventureId,
    draftId: "draft-1",
    draft,
    invalidatedLinks: [],
    savedDraft: adventureId ? JSON.stringify(draft) : null,
  };
}

const noop = () => {};

/** `AdventureSettingsDialog` reads/writes `adventureEditorSessionAtom` directly (Task 6) — seed the
 *  atom on a pre-configured Alepha instance BEFORE the first render, mirroring
 *  `registry-dialog.test.tsx`'s own helper (same rationale, see that file's docblock). */
function mountDialog(session: EditorSessionFixture, onSaved: () => void = noop) {
  const alepha = Alepha.create();
  alepha.store.set(adventureEditorSessionAtom, session);
  return renderWithAlepha(<AdventureSettingsDialog open onOpenChange={noop} onSaved={onSaved} />, {
    alepha,
  });
}

describe("AdventureSettingsDialog", () => {
  let alephaInstances: Array<{ stop(): Promise<void> }> = [];

  beforeEach(() => {
    setLocale("en");
  });

  afterEach(async () => {
    for (const alepha of alephaInstances) await alepha.stop();
    alephaInstances = [];
  });

  it("round-trips the title and max players through the update endpoint", async () => {
    const complete: AdventureDraft = {
      title: "Original",
      maxPlayers: 4,
      audio: DEFAULT_ADVENTURE_AUDIO,
      members: [member("m1", "Verdant", "door", "east")],
      registry: EMPTY_REGISTRY,
    };
    const mock = backend();
    vi.stubGlobal("fetch", mock);
    const { alepha } = await mountDialog(sessionFixture(complete, "adv-1"));
    alephaInstances.push(alepha);

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
        audio: unknown;
      };
      expect(body.title).toBe("Renamed");
      expect(body.maxPlayers).toBe(3);
      expect(body.audio).toEqual(DEFAULT_ADVENTURE_AUDIO);
    });
  });

  it("deletes the edited adventure behind a confirm and clears the editing session", async () => {
    const complete: AdventureDraft = {
      title: "Donjon",
      maxPlayers: 4,
      audio: DEFAULT_ADVENTURE_AUDIO,
      members: [member("m1", "Verdant", "door", "east")],
      registry: EMPTY_REGISTRY,
    };
    const mock = backend();
    vi.stubGlobal("fetch", mock);
    const { alepha } = await mountDialog(sessionFixture(complete, "adv-1"));
    alephaInstances.push(alepha);

    // Delete is confirm-gated: the first click only raises the confirm, it does not call the endpoint.
    await userEvent.click(await screen.findByRole("button", { name: t("editor.delete") }));
    expect(await screen.findByText(t("adventure.delete.title", { name: "Donjon" }))).toBeVisible();
    expect(
      mock.mock.calls.find(([, init]) => (init as RequestInit)?.method === "DELETE"),
    ).toBeUndefined();

    await userEvent.click(screen.getByRole("button", { name: t("editor.delete.confirm") }));

    await waitFor(() =>
      expect(mock).toHaveBeenCalledWith(
        "/api/adventures/adv-1?force=true",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
    // The deleted adventure's editing session is torn down, so the dialog falls back to the picker.
    await waitFor(() => expect(alepha.store.get(adventureEditorSessionAtom)).toBeNull());
  });

  it("can explicitly force deletion of the active party saves", async () => {
    const complete: AdventureDraft = {
      title: "Donjon",
      maxPlayers: 4,
      audio: DEFAULT_ADVENTURE_AUDIO,
      members: [member("m1", "Verdant", "door", "east")],
      registry: EMPTY_REGISTRY,
    };
    const mock = backend();
    vi.stubGlobal("fetch", mock);
    const { alepha } = await mountDialog(sessionFixture(complete, "adv-1"));
    alephaInstances.push(alepha);

    await userEvent.click(await screen.findByRole("button", { name: t("editor.delete") }));
    await userEvent.click(screen.getByRole("checkbox", { name: t("editor.delete.force") }));
    await userEvent.click(screen.getByRole("button", { name: t("editor.delete.confirm") }));

    await waitFor(() =>
      expect(mock).toHaveBeenCalledWith(
        "/api/adventures/adv-1?force=true",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
  });

  it("shows no graph bindings or validation section — the graph is not authored here", async () => {
    const draft: AdventureDraft = {
      title: "Draft",
      maxPlayers: 4,
      audio: DEFAULT_ADVENTURE_AUDIO,
      members: [member("m1", "Verdant", "door", "gate")],
      registry: EMPTY_REGISTRY,
    };
    vi.stubGlobal("fetch", backend());
    const { alepha } = await mountDialog(sessionFixture(draft, "adv-1"));
    alephaInstances.push(alepha);

    // Only the shell fields remain — no Exits/bindings destination selects, no validation readout.
    expect(await screen.findByLabelText(t("adventure.name"))).toBeInTheDocument();
    expect(screen.getByLabelText(t("adventure.players"))).toBeInTheDocument();
    // The only selects are the six dynamic situations, ambience and two legacy fallbacks; graph
    // destination controls stay gone.
    expect(screen.getAllByRole("combobox")).toHaveLength(9);
    expect(screen.queryByText(/validation/i)).toBeNull();
  });

  it("saves the shell without a graph in the PUT body", async () => {
    const draft: AdventureDraft = {
      title: "Draft",
      maxPlayers: 4,
      audio: DEFAULT_ADVENTURE_AUDIO,
      members: [member("m1", "Verdant", "door", "gate")],
      registry: EMPTY_REGISTRY,
    };
    const mock = backend();
    vi.stubGlobal("fetch", mock);
    const { alepha } = await mountDialog(sessionFixture(draft, "adv-1"));
    alephaInstances.push(alepha);

    const save = await screen.findByRole("button", { name: t("editor.save") });
    expect(save).toBeEnabled();
    await userEvent.click(save);

    await waitFor(() => {
      const put = mock.mock.calls.find(
        ([url, init]) => url === "/api/adventures/adv-1" && (init as RequestInit)?.method === "PUT",
      );
      expect(put).toBeDefined();
      const body = JSON.parse(String((put?.[1] as RequestInit)?.body)) as Record<string, unknown>;
      // No graph rides the PUT: the server preserves the stored graph untouched.
      expect(body.graph).toBeUndefined();
      expect(body.title).toBe("Draft");
    });
  });
});
