import type { PartyListing, StoredHero } from "@lindocara/client/api.js";
import { startGameAsHero, stopActiveGameSession } from "@lindocara/client/game/session.js";
import type { GameNavigation } from "@lindocara/client/state/navigation.js";
import { setGameNavigation } from "@lindocara/client/state/navigation.js";
import { useUiStore } from "@lindocara/client/store.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `game/session.ts`'s `startGameIdentity` has exactly one `await` between "loading started" and
 * "the game handle is installed" — `Renderer.create()`. It already rechecks `activeLaunchId` right
 * after that await and tears down the renderer when stale, but until this fix it never cleared
 * `heroLoading` on that path — a browser BACK during the loading window (`AppRouter.tsx`'s leave
 * effect, which used to gate on `store.game` alone and ignore `heroLoading`) left the hero-loading
 * spinner state dangling on the store even though the launch was abandoned, and never re-checked the
 * launch id at all for the loading-only case.
 *
 * This test drives the REAL `startGameAsHero`/`startGameIdentity` (unlike `game-route-back.test.tsx`,
 * which mocks `game/session.js` wholesale to test the router's leave effect in isolation) with a
 * controllable gate on `Renderer.create` so the launch can be held open exactly in the window where
 * `heroLoading` is set but `store.game` is not yet. `stopActiveGameSession({ navigate: false })` is
 * called directly mid-flight — the exact seam `AppRouter.tsx`'s leave effect calls — standing in for
 * a real router leave without needing a full router mount (net.js/fetch are never reached on this
 * path: the abort happens before `openConnection()` runs, so nothing needs to be stubbed there).
 */

const rendererMock = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@lindocara/renderer/renderer.js", () => ({
  Renderer: { create: (...args: unknown[]) => rendererMock.create(...args) },
}));

function fakeRenderer() {
  // `destroy` is what the abort path calls; `onFrame` is registered unconditionally once a launch
  // reaches the end of `startGameIdentity` (the "normal launch" test below) — nothing else on
  // `Renderer` is reached synchronously before either of those two points.
  return { destroy: vi.fn(), onFrame: vi.fn() };
}

const HERO: StoredHero = {
  id: "hero-1",
  partyId: "party-1",
  accountId: "acc-1",
  name: "Hero",
  class: "warrior",
  mapId: "verdant_reach",
  x: 0,
  y: 0,
  level: 1,
  xp: 0,
  hp: 100,
  life: "alive",
};

const PARTY: PartyListing = {
  id: "party-1",
  name: null,
  adventureId: "adv-1",
  adventureTitle: "Adventure",
  maxPlayers: 4,
  status: "open",
  hostAccountId: "acc-1",
  colors: ["red"],
  mine: true,
  myColor: "red",
};

describe("aborting a game launch mid-flight", () => {
  let nav: GameNavigation;

  beforeEach(() => {
    document.body.innerHTML = '<canvas id="stage"></canvas>';
    rendererMock.create.mockReset();
    nav = {
      toGame: vi.fn(),
      toMenu: vi.fn(),
      toAuth: vi.fn(),
      toEditor: vi.fn(),
      setActiveParty: vi.fn(),
      getActiveParty: vi.fn(() => null),
      setAdventureTestSession: vi.fn(),
      getAdventureTestSession: vi.fn(() => null),
      getQuickItems: vi.fn(() => [null, null, null] as const),
      logout: vi.fn(),
    };
    setGameNavigation(nav);
  });

  afterEach(() => {
    // Belt-and-braces: the "normal launch" test leaves a real (unstubbed) connection attempt and its
    // reconnect table running in the background — tear it down so no stray timer mutates the store
    // after this test has moved on.
    stopActiveGameSession();
    setGameNavigation(null);
    useUiStore.setState({ game: null, heroLoading: null, self: null, selfState: null });
  });

  it("tears down and installs nothing when navigation leaves before the renderer finishes loading", async () => {
    let resolveRenderer: (renderer: unknown) => void = () => {};
    rendererMock.create.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRenderer = resolve;
        }),
    );

    const launch = startGameAsHero(HERO, PARTY);

    // Loading has started synchronously (everything up to the `await Renderer.create()` runs before
    // control returns to the caller): heroLoading is set, the game handle is not.
    expect(useUiStore.getState().heroLoading).not.toBeNull();
    expect(useUiStore.getState().game).toBeNull();

    // Stand-in for AppRouter.tsx's leave effect firing mid-flight (path left /game while heroLoading
    // was set): it calls this exact seam with `{ navigate: false }`.
    stopActiveGameSession({ navigate: false });

    const renderer = fakeRenderer();
    resolveRenderer(renderer);
    await launch;

    expect(renderer.destroy).toHaveBeenCalledTimes(1);
    expect(useUiStore.getState().game).toBeNull();
    expect(useUiStore.getState().heroLoading).toBeNull();
    // The abort must not navigate: the browser already moved the URL out from under /game.
    expect(nav.toGame).toHaveBeenCalledTimes(1);
    expect(nav.toMenu).not.toHaveBeenCalled();
    expect(nav.toEditor).not.toHaveBeenCalled();
  });

  it("still completes a normal launch when nothing interrupts it", async () => {
    rendererMock.create.mockResolvedValue(fakeRenderer());

    await startGameAsHero(HERO, PARTY);

    expect(useUiStore.getState().game).not.toBeNull();
    expect(nav.toGame).toHaveBeenCalledTimes(1);
  });
});
