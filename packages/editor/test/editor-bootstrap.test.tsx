import { setLocale, t } from "@lindocara/client/i18n.js";
import { adventureEditorSessionAtom } from "@lindocara/client/state/atoms.js";
import { AdventureEditorScreen } from "@lindocara/editor/ui/editor/AdventureEditorScreen.js";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Alepha } from "alepha";
import { AlephaReact } from "alepha/react";
import { ReactRouter } from "alepha/react/router";
import { renderWithAlepha } from "alepha/react/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** `AdventureEditorScreen` (and the `AdventurePickerScreen` it falls back to with no session) read
 *  `adventureEditorSessionAtom` and call `useRouter()` directly (Task 6) — both need a real Alepha
 *  instance with `AlephaReact` registered to mount at all. None of these tests click the picker's
 *  "Quit" button, so a bare `AlephaReact` (no full `AppRouter` page tree) is enough — but
 *  `ReactRouter` still has to be injected HERE, before `renderWithAlepha`'s `start()` locks the
 *  container: a component's first `useRouter()` call happens after that lock, and `alepha.react.
 *  router`'s module is only ever registered by touching one of its services first (mirrors
 *  `AppRouter`'s own eager `reactAuth = $inject(ReactAuth)` field — see its docblock). */
function mountScreen() {
  const alepha = Alepha.create().with(AlephaReact);
  alepha.inject(ReactRouter);
  return renderWithAlepha(<AdventureEditorScreen />, { alepha });
}

const stageMock = vi.hoisted(() => ({ openMapEditorStage: vi.fn() }));
vi.mock("@lindocara/editor/game/map-editor-stage.js", () => ({
  openMapEditorStage: stageMock.openMapEditorStage,
}));
vi.mock("@lindocara/editor/game/map-preview.js", () => ({ startMapPreview: vi.fn() }));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function adventurePayload(id: string, title: string): Record<string, unknown> {
  return {
    id,
    accountId: "acct",
    title,
    maxPlayers: 4,
    version: 1,
    mapIds: [],
    graph: { start: null, links: [] },
    registry: { switches: [], variables: [] },
  };
}

describe("AdventureEditorScreen explicit picker", () => {
  let alephaInstances: Array<{ stop(): Promise<void> }> = [];

  beforeEach(() => {
    setLocale("en");
    localStorage.clear();
  });

  afterEach(async () => {
    for (const alepha of alephaInstances) await alepha.stop();
    alephaInstances = [];
  });

  it("does not reopen the remembered adventure until the author explicitly selects one", async () => {
    localStorage.setItem("lindocara:editor:last-adventure:acct", "adv-remembered");
    const mock = vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (url === "/api/adventures" && method === "GET") {
        return Promise.resolve(
          jsonResponse([
            {
              id: "adv-remembered",
              title: "Remembered",
              maxPlayers: 4,
              mapCount: 0,
              playable: false,
            },
          ]),
        );
      }
      if (url === "/api/adventures/adv-remembered" && method === "GET") {
        return Promise.resolve(jsonResponse(adventurePayload("adv-remembered", "Remembered")));
      }
      return Promise.resolve(jsonResponse({ error: "not_found" }, 404));
    });
    vi.stubGlobal("fetch", mock);

    const { alepha } = await mountScreen();
    alephaInstances.push(alepha);

    expect(await screen.findByRole("heading", { name: t("editor.picker.title") })).toBeVisible();
    expect(alepha.store.get(adventureEditorSessionAtom)).toBeNull();
    expect(mock.mock.calls.some(([url]) => url === "/api/adventures?scope=all")).toBe(false);
    expect(mock.mock.calls.some(([url]) => url === "/api/adventures/adv-remembered")).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: t("editor.picker.open") }));
    await waitFor(() =>
      expect(alepha.store.get(adventureEditorSessionAtom)?.adventureId).toBe("adv-remembered"),
    );
  });

  it("does not create anything until the new-adventure form is submitted", async () => {
    const mock = vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (url === "/api/adventures" && method === "GET") {
        return Promise.resolve(jsonResponse([]));
      }
      if (url === "/api/adventures" && method === "POST") {
        return Promise.resolve(
          jsonResponse(
            {
              ...adventurePayload("adv-new", "Moon Keep"),
              defaultMap: { id: "unused-by-session-loader" },
            },
            201,
          ),
        );
      }
      if (url === "/api/adventures/adv-new" && method === "GET") {
        return Promise.resolve(jsonResponse(adventurePayload("adv-new", "Moon Keep")));
      }
      return Promise.resolve(jsonResponse({ error: "not_found" }, 404));
    });
    vi.stubGlobal("fetch", mock);

    const { alepha } = await mountScreen();
    alephaInstances.push(alepha);
    await screen.findByText(t("editor.picker.empty"));
    expect(mock.mock.calls.some(([, init]) => (init as RequestInit)?.method === "POST")).toBe(
      false,
    );

    await userEvent.type(screen.getByLabelText(t("adventure.name")), "Moon Keep");
    await userEvent.click(screen.getByRole("button", { name: t("editor.picker.create.submit") }));

    await waitFor(() =>
      expect(alepha.store.get(adventureEditorSessionAtom)?.adventureId).toBe("adv-new"),
    );
    expect(
      mock.mock.calls.filter(
        ([url, init]) => url === "/api/adventures" && (init as RequestInit)?.method === "POST",
      ),
    ).toHaveLength(1);
  });

  it("deletes an adventure from the picker after the same forced-delete confirmation", async () => {
    const mock = vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (url === "/api/adventures" && method === "GET") {
        return Promise.resolve(
          jsonResponse([
            {
              id: "adv-old",
              title: "Old Keep",
              maxPlayers: 4,
              mapCount: 2,
              playable: true,
            },
          ]),
        );
      }
      if (url === "/api/adventures/adv-old?force=true" && method === "DELETE") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(jsonResponse({ error: "not_found" }, 404));
    });
    vi.stubGlobal("fetch", mock);

    const { alepha } = await mountScreen();
    alephaInstances.push(alepha);

    await screen.findByText("Old Keep");
    await userEvent.click(screen.getByRole("button", { name: t("editor.delete") }));
    expect(
      await screen.findByText(t("adventure.delete.title", { name: "Old Keep" })),
    ).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: t("editor.delete.confirm") }));

    await waitFor(() =>
      expect(mock).toHaveBeenCalledWith(
        "/api/adventures/adv-old?force=true",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
    expect(screen.queryByText("Old Keep")).toBeNull();
  });
});
