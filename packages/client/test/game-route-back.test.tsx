import { setLocale } from "@lindocara/client/i18n.js";
import type { GameHandle, SelfHud } from "@lindocara/client/store.js";
import { useUiStore } from "@lindocara/client/store.js";
import { AppRouter } from "@lindocara/client/ui/AppRouter.js";
import type { SelfState } from "@lindocara/engine/protocol.js";
import { waitFor } from "@testing-library/dom";
import { Alepha } from "alepha";
import { AlephaReact } from "alepha/react";
import { ReactRouter } from "alepha/react/router";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `ui/AppRouter.tsx`'s history-BACK leave effect: without it, a browser BACK out of `/game`
 * unmounts `GameScreen` (the router's own re-render) but leaves the live socket/renderer/window
 * input listeners running underneath the menu — WASD still moves the hero. The fix watches
 * `pathname` and, when it leaves `/game` while `store.game` is still set, calls
 * `game/session.ts`'s existing `stopActiveGameSession()` teardown seam with `{ navigate: false }`
 * (it must not ALSO push a route — the browser already moved the URL; see that option's own
 * docblock in `session.ts`).
 *
 * `game/session.ts` is mocked wholesale (the same `sessionMock` reassignment-holder pattern
 * `adventure-test-overlay.test.tsx` already uses): this test is about the ROUTER's leave effect,
 * not about `startGameIdentity`'s real socket/renderer plumbing, which is out of scope here. The
 * mock's `stop` implementation also clears `store.game` itself, standing in for what the real
 * teardown chain (`endGame` -> `returnFromGameSession` -> `store.clearedGameSession()`) does.
 */
const sessionMock = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn() }));
vi.mock("@lindocara/client/game/session.js", () => ({
  startGameAsHero: sessionMock.start,
  stopActiveGameSession: sessionMock.stop,
}));

function stubFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.startsWith("/_auth/userinfo")) {
        return new Response(
          JSON.stringify({ user: { id: "acc-1", username: "nico" }, api: { actions: {} } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (path.startsWith("/api/parties")) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`game-route-back.test.tsx: unexpected fetch ${path}`);
    }),
  );
}

function fakeGameHandle(): GameHandle {
  return {
    attack: vi.fn(),
    interact: vi.fn(),
    usePotion: vi.fn(),
    release: vi.fn(),
    castSkill: vi.fn(),
    sendChat: vi.fn(),
    switchCharacter: vi.fn(),
    logout: vi.fn(),
    returnToTitle: vi.fn(),
    attachMinimap: vi.fn(),
    attachWorldMap: vi.fn(),
  };
}

const SELF_FIXTURE: SelfHud = {
  nick: "Hero",
  level: 3,
  hp: 80,
  maxHp: 124,
  life: "alive",
  corpseDistance: null,
  class: "warrior",
  appearance: { body: "wayfarer", primaryColor: "azure" },
  equipment: { mainHand: "weathered_sword", offHand: "oak_shield" },
};

const SELF_STATE_FIXTURE: SelfState = {
  xp: 40,
  xpToNext: 220,
  life: "alive",
  corpse: null,
  displacement: { seq: 0, x: 0, y: 0, z: 0 },
  inventory: { potions: 2, gold: 9, crystals: 1 },
  quest: { status: "active", progress: 1, target: 3 },
};

describe("leaving /game via history-BACK", () => {
  let alepha: Alepha | undefined;

  beforeEach(() => {
    setLocale("en");
    document.title = "";
    document.head.innerHTML = "";
    document.body.innerHTML = '<div id="root"></div>';
    stubFetch();
    sessionMock.start.mockReset();
    sessionMock.stop.mockReset();
    // Stands in for the real teardown chain's `store.clearedGameSession()` — the assertion below
    // proves the leave effect actually results in a cleared bridge, not just a called mock. The
    // real teardown clears `heroLoading` too (`clearedGameSessionFields()`), which matters for the
    // loading-window test below.
    sessionMock.stop.mockImplementation(() => {
      useUiStore.setState({ game: null, heroLoading: null });
    });
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
    useUiStore.setState({ game: null, heroLoading: null, self: null, selfState: null });
  });

  it("tears down the live session through the existing teardown seam, without re-navigating", async () => {
    const instance = Alepha.create().with(AlephaReact).with(AppRouter);
    alepha = instance;
    await act(async () => {
      await instance.start();
    });
    const router = instance.inject(ReactRouter<AppRouter>);

    await act(async () => {
      await router.push("/menu");
    });
    await waitFor(() => expect(document.querySelector(".main-menu")).toBeTruthy());

    // The stand-in for a real launch: `game` set before `/game` is ever entered (`game-route.
    // test.tsx`'s own precedent — see its loader docblock for why that ordering is guaranteed).
    useUiStore.setState({
      game: fakeGameHandle(),
      self: SELF_FIXTURE,
      selfState: SELF_STATE_FIXTURE,
    });

    await act(async () => {
      await router.push("/game");
    });
    await waitFor(() => expect(document.querySelector("#hud")).toBeTruthy());
    expect(sessionMock.stop).not.toHaveBeenCalled();

    // Simulates the browser BACK button: the pathname changes WITHOUT going through
    // `game/session.ts`'s own teardown (a real `popstate` reaches the router the same way — see
    // `ReactBrowserProvider.ts`'s `popstate` listener, which re-renders from `window.location`
    // rather than calling `push()` itself). What the leave effect reacts to is the resulting
    // `pathname` change, not the mechanism that produced it, so driving it through `router.push()`
    // exercises the exact same effect dependency.
    await act(async () => {
      await router.push("/menu");
    });

    await waitFor(() => expect(document.querySelector(".main-menu")).toBeTruthy());
    expect(sessionMock.stop).toHaveBeenCalledTimes(1);
    expect(sessionMock.stop).toHaveBeenCalledWith({ navigate: false });
    expect(useUiStore.getState().game).toBeNull();
  });

  it("invalidates a mid-flight launch when leaving /game while only heroLoading is set (no game handle yet)", async () => {
    const instance = Alepha.create().with(AlephaReact).with(AppRouter);
    alepha = instance;
    await act(async () => {
      await instance.start();
    });
    const router = instance.inject(ReactRouter<AppRouter>);

    await act(async () => {
      await router.push("/menu");
    });
    await waitFor(() => expect(document.querySelector(".main-menu")).toBeTruthy());

    // Stands in for `startGameIdentity`'s window between "loading started" and "the game handle is
    // installed" — `session.ts`'s own launch-id recheck after its one `await`
    // (`Hd2dRenderer.create()`)
    // is what actually tears the launch down in that window; see `game-launch-abort.test.tsx` for
    // that half. Here the router has not entered `/game` yet, which matches the real ordering:
    // `nav.toGame()` fires first, but `heroLoading` is already set by the time the router's own
    // `/game` loader (or, as here, this leave effect) next runs.
    useUiStore.setState({
      heroLoading: {
        name: "Hero",
        class: "warrior",
        color: "azure",
        phase: "preparing",
        progress: 8,
      },
    });

    await act(async () => {
      await router.push("/game");
    });
    await waitFor(() => expect(document.querySelector(".connection-overlay")).toBeTruthy());
    expect(sessionMock.stop).not.toHaveBeenCalled();

    await act(async () => {
      await router.push("/menu");
    });

    await waitFor(() => expect(document.querySelector(".main-menu")).toBeTruthy());
    expect(sessionMock.stop).toHaveBeenCalledTimes(1);
    expect(sessionMock.stop).toHaveBeenCalledWith({ navigate: false });
    expect(useUiStore.getState().heroLoading).toBeNull();
  });

  it("does nothing when leaving /game through a sanctioned exit that already cleared the session", async () => {
    const instance = Alepha.create().with(AlephaReact).with(AppRouter);
    alepha = instance;
    await act(async () => {
      await instance.start();
    });
    const router = instance.inject(ReactRouter<AppRouter>);

    await act(async () => {
      await router.push("/menu");
    });
    await waitFor(() => expect(document.querySelector(".main-menu")).toBeTruthy());

    useUiStore.setState({
      game: fakeGameHandle(),
      self: SELF_FIXTURE,
      selfState: SELF_STATE_FIXTURE,
    });
    await act(async () => {
      await router.push("/game");
    });
    await waitFor(() => expect(document.querySelector("#hud")).toBeTruthy());

    // A sanctioned exit (a natural disconnect, an editor test "Exit") always clears `store.game`
    // BEFORE it navigates — simulate exactly that ordering without going through the mocked
    // teardown seam, then navigate away the same way `nav.toMenu()` would.
    useUiStore.setState({ game: null });
    await act(async () => {
      await router.push("/menu");
    });
    await waitFor(() => expect(document.querySelector(".main-menu")).toBeTruthy());

    expect(sessionMock.stop).not.toHaveBeenCalled();
  });
});
