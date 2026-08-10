import { setLocale, t } from "@lindocara/client/i18n.js";
import { adventureEditorSessionAtom } from "@lindocara/client/state/atoms.js";
import { AdventureEditorScreen } from "@lindocara/editor/ui/editor/AdventureEditorScreen.js";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Alepha } from "alepha";
import { AlephaContext, AlephaReact } from "alepha/react";
import { ReactRouter } from "alepha/react/router";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** `AdventureEditorScreen` reads `adventureEditorSessionAtom` and calls `useRouter()` directly (Task
 *  6) — both need a real Alepha instance with `AlephaReact` registered to mount at all. None of these
 *  tests click the bootstrap's "Quit" button, so a bare `AlephaReact` (no full `AppRouter` page tree)
 *  is enough — but `ReactRouter` still has to be injected HERE, before `start()` locks the container:
 *  a component's first `useRouter()` call happens after that lock, and `alepha.react.router`'s module
 *  is only ever registered by touching one of its services first (mirrors `AppRouter`'s own eager
 *  `reactAuth = $inject(ReactAuth)` field — see its docblock).
 *
 *  This mounts by hand instead of using `renderWithAlepha`, and the ordering is load-bearing: it must
 *  match `ReactPageProvider.root` (`.vendor/alepha/src/react/router/providers/ReactPageProvider.ts`),
 *  which wraps `<StrictMode>` OUTSIDE `<AlephaContext.Provider>` — the real router root every `$page`
 *  (including `editor`) mounts under, with `strictMode` defaulting `true` and never overridden in this
 *  app. `renderWithAlepha`'s own `wrapper` option nests the opposite way (inside the Alepha provider),
 *  which does not reproduce React's real mount→cleanup→mount dance in this environment — a bug this
 *  latched effect actually hit in `npm run dev` and that a prior version of this suite failed to
 *  catch. Composing the tree in the ORDER THE APP ACTUALLY USES is what makes `AdventureEditorScreen`
 *  strict-mode-tested for real. */
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

describe("AdventureEditorScreen scratch entry", () => {
  let alephaInstances: Array<{ stop(): Promise<void> }> = [];

  beforeEach(() => {
    setLocale("en");
    localStorage.clear();
  });

  afterEach(async () => {
    for (const alepha of alephaInstances) await alepha.stop();
    alephaInstances = [];
  });

  function scratchResponse() {
    return jsonResponse(
      {
        ...adventurePayload("adv-scratch", t("adventure.default_title")),
        mapIds: ["map-1"],
        defaultMap: {
          id: "map-1",
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
        },
      },
      201,
    );
  }

  it("mints exactly one scratch adventure on entry and never renders a picker", async () => {
    const mock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/adventures" && init?.method === "POST") {
        return Promise.resolve(scratchResponse());
      }
      if (url === "/api/maps/map-1") {
        return Promise.resolve(jsonResponse({ error: "not_found" }, 404));
      }
      return Promise.resolve(jsonResponse([], 200));
    });
    vi.stubGlobal("fetch", mock);

    const { alepha } = await mountScreen();
    alephaInstances.push(alepha);

    await waitFor(() =>
      expect(alepha.store.get(adventureEditorSessionAtom)?.adventureId).toBe("adv-scratch"),
    );
    expect(alepha.store.get(adventureEditorSessionAtom)?.titleUntouched).toBe(true);
    // The latch: strict mode double-invokes the effect, and every extra POST is a stray
    // untitled adventure that nothing ever cleans up.
    expect(
      mock.mock.calls.filter(
        ([url, init]) => url === "/api/adventures" && (init as RequestInit)?.method === "POST",
      ),
    ).toHaveLength(1);
  });

  it("shows a retry instead of a blank stage when the create fails", async () => {
    let attempts = 0;
    const mock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/adventures" && init?.method === "POST") {
        attempts += 1;
        if (attempts === 1) return Promise.resolve(jsonResponse({ error: "server_error" }, 500));
        return Promise.resolve(scratchResponse());
      }
      return Promise.resolve(jsonResponse([], 200));
    });
    vi.stubGlobal("fetch", mock);

    const { alepha } = await mountScreen();
    alephaInstances.push(alepha);

    const retry = await screen.findByRole("button", { name: t("editor.retry") });
    expect(alepha.store.get(adventureEditorSessionAtom)).toBeNull();

    await userEvent.click(retry);
    await waitFor(() =>
      expect(alepha.store.get(adventureEditorSessionAtom)?.adventureId).toBe("adv-scratch"),
    );
  });

  it("shows no error banner when the session has expired", async () => {
    const mock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/adventures" && init?.method === "POST") {
        return Promise.resolve(jsonResponse({ error: "session_expired" }, 401));
      }
      return Promise.resolve(jsonResponse([], 200));
    });
    vi.stubGlobal("fetch", mock);

    const { alepha } = await mountScreen();
    alephaInstances.push(alepha);

    await waitFor(() => expect(mock).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: t("editor.retry") })).toBeNull();
    expect(alepha.store.get(adventureEditorSessionAtom)).toBeNull();
  });
});
