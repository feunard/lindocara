import { setLocale, t } from "@lindocara/client/i18n.js";
import { getGameNavigation, setGameNavigation } from "@lindocara/client/state/navigation.js";
import { AppRouter } from "@lindocara/client/ui/AppRouter.js";
import { HeroCreate } from "@lindocara/client/ui/HeroCreate.js";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Alepha } from "alepha";
import { AlephaReact } from "alepha/react";
import { ReactRouter } from "alepha/react/router";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Task 4: the three launch carousels (`playContinue`/`playNew`/`playJoin`) read their list from the
 * route's `loader` (`ui/AppRouter.tsx`) instead of their own `useEffect` fetch. These tests boot the
 * real `AppRouter` (the same harness `app-router.test.tsx`/`auth-screen.test.tsx` use) and land
 * directly on a play route via `history.pushState` before `alepha.start()` — the same technique
 * `auth-screen.test.tsx` uses to land on `/auth` — so `AppRouter.bootPing` (a `$hook({ on:
 * "start" })`, not a React effect) sees the target pathname and MainMenu's own "has saves" probe
 * never mounts, keeping each stubbed `/api/parties`/`/api/adventures` response exact to what the
 * loader under test needs.
 */

interface PartyFixture {
  id: string;
  adventureId: string;
  adventureTitle: string;
  maxPlayers: number;
  status: "open" | "completed";
  colors: string[];
  mine: boolean;
}

function party(fixture: PartyFixture) {
  return {
    ...fixture,
    name: null,
    hostAccountId: "acc-1",
    myColor: fixture.mine ? (fixture.colors[0] ?? null) : null,
  };
}

const PARTIES: PartyFixture[] = [
  {
    id: "p-mine",
    adventureId: "adv-mine",
    adventureTitle: "Mine Adventure",
    maxPlayers: 4,
    status: "open",
    colors: ["blue"],
    mine: true,
  },
  {
    id: "p-other-open",
    adventureId: "adv-other",
    adventureTitle: "Other Open",
    maxPlayers: 4,
    status: "open",
    colors: ["red"],
    mine: false,
  },
  {
    id: "p-mine-completed",
    adventureId: "adv-mine-done",
    adventureTitle: "Finished Adventure",
    maxPlayers: 4,
    status: "completed",
    colors: ["blue"],
    mine: true,
  },
  {
    id: "p-other-full",
    adventureId: "adv-full",
    adventureTitle: "Other Full",
    maxPlayers: 1,
    status: "open",
    colors: ["red"],
    mine: false,
  },
  {
    id: "p-other-completed",
    adventureId: "adv-done",
    adventureTitle: "Other Completed",
    maxPlayers: 4,
    status: "completed",
    colors: ["green"],
    mine: false,
  },
];

const ADVENTURES = [
  { id: "adv-1", title: "Grand Quest", maxPlayers: 4, mapCount: 3, playable: true, author: "nico" },
];

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Authenticated `/_auth/userinfo` (skips `AppRouter.bootPing`'s guest fallback) plus the loader's
 *  own `/api/parties`/`/api/adventures` calls. */
function stubFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.startsWith("/_auth/userinfo")) {
        return jsonResponse(200, {
          user: { id: "acc-1", username: "nico" },
          api: { actions: {} },
        });
      }
      if (path.startsWith("/api/parties")) {
        return jsonResponse(200, PARTIES.map(party));
      }
      if (path.startsWith("/api/adventures")) {
        return jsonResponse(200, ADVENTURES);
      }
      throw new Error(`launch-screens.test.tsx: unexpected fetch ${path}`);
    }),
  );
}

async function mountAt(path: string): Promise<{ alepha: Alepha; router: ReactRouter<AppRouter> }> {
  history.pushState({}, "", path);
  const alepha = Alepha.create().with(AlephaReact).with(AppRouter);
  await act(async () => {
    await alepha.start();
  });
  const router = alepha.inject(ReactRouter);
  return { alepha, router };
}

describe("launch screens (loader-driven routes)", () => {
  let alepha: Alepha | undefined;

  beforeEach(() => {
    setLocale("en");
    document.title = "";
    document.head.innerHTML = "";
    document.body.innerHTML = '<div id="root"></div>';
    stubFetch();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  it("playContinue keeps active saves selectable and archives my completed adventures", async () => {
    ({ alepha } = await mountAt("/play/continue"));

    await waitFor(() => expect(screen.getByText("Mine Adventure")).toBeTruthy());
    expect(screen.getByRole("heading", { name: t("continue.archive.title") })).toBeTruthy();
    expect(screen.getByText("Finished Adventure")).toBeTruthy();
    expect(document.querySelector(".carousel-track")?.textContent).not.toContain(
      "Finished Adventure",
    );
    expect(screen.queryByText("Other Open")).toBeNull();
    expect(screen.queryByText("Other Full")).toBeNull();
    expect(screen.queryByText("Other Completed")).toBeNull();
  });

  it("playContinue's back button routes to /menu", async () => {
    let router: ReactRouter<AppRouter>;
    ({ alepha, router } = await mountAt("/play/continue"));
    await waitFor(() => expect(screen.getByText("Mine Adventure")).toBeTruthy());

    await userEvent.click(screen.getByRole("button", { name: /Back/ }));

    await waitFor(() => expect(document.querySelector(".main-menu")).toBeTruthy());
    expect(router.state.url.pathname).toBe("/menu");
  });

  it("playContinue can abandon an active save after confirmation", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    ({ alepha } = await mountAt("/play/continue"));
    await waitFor(() => expect(screen.getByText("Mine Adventure")).toBeTruthy());

    await userEvent.click(
      screen.getByRole("button", { name: `${t("continue.abandon")} Mine Adventure` }),
    );

    await waitFor(() => expect(screen.queryByText("Mine Adventure")).toBeNull());
    expect(screen.getByText(t("continue.empty"))).toBeTruthy();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "/api/parties/p-mine/membership",
      expect.objectContaining({ method: "DELETE" }),
    );
    confirm.mockRestore();
  });

  it("playContinue can purge a completed adventure from the current account", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    ({ alepha } = await mountAt("/play/continue"));
    await waitFor(() => expect(screen.getByText("Finished Adventure")).toBeTruthy());

    await userEvent.click(
      screen.getByRole("button", { name: `${t("continue.purge")} Finished Adventure` }),
    );

    await waitFor(() => expect(screen.queryByText("Finished Adventure")).toBeNull());
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "/api/parties/p-mine-completed/archive",
      expect.objectContaining({ method: "DELETE" }),
    );
    confirm.mockRestore();
  });

  it("playNew renders the playable adventures from the loader", async () => {
    ({ alepha } = await mountAt("/play/new"));

    await waitFor(() => expect(screen.getByText("Grand Quest")).toBeTruthy());
    expect(screen.getByText(/3 maps/)).toBeTruthy();
    expect(screen.getByText(/by nico/)).toBeTruthy();
  });

  /**
   * The loader cannot always produce its list: on the server it does not even try (a relative
   * `fetch` has no URL to parse and no cookie to send), and in the browser a request can fail. Both
   * arrive at the component the same way — `adventures: null`, meaning "not loaded", as distinct
   * from `[]` meaning "none exist". Before this, both became `[]` and the screen confidently
   * rendered "No playable adventure yet" against a server full of them.
   *
   * Failing the first `/api/adventures` call and serving the second is the browser-reachable way to
   * drive that null: jsdom always has a `window`, so the server branch cannot be reached from here,
   * but the recovery path under test is the same one.
   */
  it("playNew fetches its own list when the loader could not produce one", async () => {
    let adventureCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        if (path.startsWith("/_auth/userinfo")) {
          return jsonResponse(200, {
            user: { id: "acc-1", username: "nico" },
            api: { actions: {} },
          });
        }
        if (path.startsWith("/api/adventures")) {
          adventureCalls += 1;
          if (adventureCalls === 1) throw new Error("loader offline");
          return jsonResponse(200, ADVENTURES);
        }
        if (path.startsWith("/api/parties")) return jsonResponse(200, PARTIES.map(party));
        throw new Error(`launch-screens.test.tsx: unexpected fetch ${path}`);
      }),
    );

    ({ alepha } = await mountAt("/play/new"));

    await waitFor(() => expect(screen.getByText("Grand Quest")).toBeTruthy());
    expect(adventureCalls).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(t("new.empty"))).toBeNull();
  });

  it("playNew's back button routes to /menu", async () => {
    ({ alepha } = await mountAt("/play/new"));
    await waitFor(() => expect(screen.getByText("Grand Quest")).toBeTruthy());

    await userEvent.click(screen.getByRole("button", { name: /Back/ }));

    await waitFor(() => expect(document.querySelector(".main-menu")).toBeTruthy());
  });

  it("playJoin renders only open, non-mine, non-full parties from the loader", async () => {
    ({ alepha } = await mountAt("/play/join"));

    await waitFor(() => expect(screen.getByText("Other Open")).toBeTruthy());
    expect(screen.queryByText("Mine Adventure")).toBeNull();
    expect(screen.queryByText("Other Full")).toBeNull();
    expect(screen.queryByText("Other Completed")).toBeNull();
  });

  it("playJoin's back button routes to /menu", async () => {
    ({ alepha } = await mountAt("/play/join"));
    await waitFor(() => expect(screen.getByText("Other Open")).toBeTruthy());

    await userEvent.click(screen.getByRole("button", { name: /Back/ }));

    await waitFor(() => expect(document.querySelector(".main-menu")).toBeTruthy());
  });
});

/**
 * Hero creation reaches the game through the SAME `state/navigation.ts` seam Task 2 wired
 * `game/session.ts` onto — `startGameAsHero` calls `getGameNavigation()?.toGame()` as the very
 * first thing it does (`game/session.ts`'s `launchGameIdentity`), before it ever touches a canvas
 * or a socket. This renders `HeroCreate` standalone (no `AppRouter`/`Alepha` instance at all, same
 * as the pre-existing `hero-create.test.tsx`) with a plain, test-installed `GameNavigation` fake —
 * the "test-installed nav holder" the task brief asks for — so the assertion is exact (`toGame`
 * fired) without booting the real renderer/WebSocket stack `startGameIdentity` reaches for next
 * (which throws harmlessly on the missing `#stage` canvas and is caught by `HeroCreate.launch()`'s
 * own `try/catch`; irrelevant to what this test checks).
 */
describe("HeroCreate flows to game via the navigation seam", () => {
  const toGame = vi.fn();

  beforeEach(() => {
    setLocale("en");
    toGame.mockReset();
    setGameNavigation({
      toGame,
      toMenu: vi.fn(),
      toAuth: vi.fn(),
      toEditor: vi.fn(),
      setActiveParty: vi.fn(),
      getActiveParty: () => null,
      setAdventureTestSession: vi.fn(),
      getAdventureTestSession: () => null,
      getQuickItems: () => [null, null, null],
      logout: vi.fn(),
    });
  });

  afterEach(() => {
    setGameNavigation(null);
  });

  it("creates the party + hero and calls the installed nav's toGame", async () => {
    // `HeroCreate.launch()` for a "New" pick (`adventureId` set, no `party`) drives three calls:
    // create the party, re-fetch the listing (`fetchParties()`, since the server assigns the
    // colour and `createPartyApi`'s own response doesn't carry it), then create the hero in it.
    const mock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (init?.method === "POST" && path === "/api/parties") {
        return Promise.resolve(
          jsonResponse(201, {
            id: "party-new",
            adventureId: "adv-1",
            adventureVersion: 1,
            maxPlayers: 4,
            hostAccountId: "acc-1",
            name: null,
            status: "open",
          }),
        );
      }
      if (path === "/api/parties") {
        return Promise.resolve(
          jsonResponse(200, [
            {
              id: "party-new",
              name: null,
              adventureId: "adv-1",
              adventureTitle: "Grand Quest",
              maxPlayers: 4,
              status: "open",
              hostAccountId: "acc-1",
              colors: ["blue"],
              mine: true,
              myColor: "blue",
            },
          ]),
        );
      }
      if (init?.method === "POST" && path === "/api/parties/party-new/heroes") {
        return Promise.resolve(
          jsonResponse(201, {
            id: "hero-new",
            partyId: "party-new",
            accountId: "acc-1",
            name: "Elowen",
            class: "warrior",
            mapId: "map-1",
            x: 0,
            y: 0,
            level: 1,
            xp: 0,
            hp: 100,
            life: "alive",
          }),
        );
      }
      throw new Error(`unexpected fetch ${path}`);
    });
    vi.stubGlobal("fetch", mock);

    render(<HeroCreate adventureId="adv-1" onBack={vi.fn()} />);

    await userEvent.clear(screen.getByLabelText("Name"));
    await userEvent.type(screen.getByLabelText("Name"), "Elowen");
    await userEvent.click(screen.getByRole("button", { name: /Warrior\s*Hits hard, up close\./ }));

    await waitFor(() => expect(toGame).toHaveBeenCalledTimes(1));
    expect(getGameNavigation()?.toGame).toBe(toGame);

    const posts = mock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(2);
    const createPartyBody = JSON.parse(String(posts[0]?.[1]?.body)) as { adventureId: string };
    expect(createPartyBody).toEqual({ adventureId: "adv-1" });
    const createHeroBody = JSON.parse(String(posts[1]?.[1]?.body)) as {
      name: string;
      class: string;
    };
    expect(createHeroBody).toEqual({ name: "Elowen", class: "warrior" });
  });
});
