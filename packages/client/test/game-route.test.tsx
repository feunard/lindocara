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
 * Task 5: the `/game` route renders the in-game React tree (`AppRouter.tsx`'s `GameScreen`) behind
 * a loader guard — a live session (`store.ts`'s `game`/`heroLoading`) is required to reach it, since
 * neither survives a reload (see that loader's own docblock for the full ordering proof). Uses the
 * same real-`AppRouter` harness as `app-router.test.tsx`/`launch-screens.test.tsx`.
 */

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
      throw new Error(`game-route.test.tsx: unexpected fetch ${path}`);
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

describe("the /game route", () => {
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
    // Cross-test hygiene: a stray `game`/`self`/`selfState` from one test must never let a LATER
    // test's redirect-guard assertion pass by accident (`useUiStore` is a module-level singleton,
    // same gotcha as the server's Durable Object tests — see the root AGENTS.md).
    useUiStore.setState({ game: null, heroLoading: null, self: null, selfState: null });
  });

  it("redirects a direct navigation (no live session — a reload or a typed URL) to /menu", async () => {
    // Nothing has launched a session: `game` and `heroLoading` are both at their default `null`,
    // exactly like a fresh reload (the bridge lives only in browser memory) or a genuinely fresh
    // server-side render (a brand-new `useUiStore` either way — the loader's own docblock).
    history.pushState({}, "", "/game");
    const instance = Alepha.create().with(AlephaReact).with(AppRouter);
    alepha = instance;
    await act(async () => {
      await instance.start();
    });
    const router = instance.inject(ReactRouter<AppRouter>);

    await waitFor(() => {
      expect(document.querySelector(".main-menu")).toBeTruthy();
    });
    expect(router.state.url.pathname).toBe("/menu");
    // No flash: the game shell never mounted even for a frame.
    expect(document.querySelector("#hud")).toBeNull();
    expect(document.querySelector("[data-route-stub]")).toBeNull();
  });

  it("renders the HUD tree for a live session, with the game chrome staying visible (not immersive)", async () => {
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

    // The stand-in for `game/session.ts`'s `launchGameIdentity`: a real launch sets `game` (and,
    // earlier, `heroLoading`) on the bridge before the route is ever entered — see the loader's
    // docblock for why that ordering is guaranteed, not a race this test happens to dodge.
    useUiStore.setState({
      game: fakeGameHandle(),
      self: SELF_FIXTURE,
      selfState: SELF_STATE_FIXTURE,
    });

    await act(async () => {
      await router.push("/game");
    });

    await waitFor(() => {
      expect(document.querySelector("#hud")).toBeTruthy();
    });
    expect(router.state.url.pathname).toBe("/game");
    expect(document.querySelector(".main-menu")).toBeNull();
    // Bridge content actually rendered, not just the aside shell.
    expect(document.querySelector("#minimap")).toBeTruthy();
    expect(document.querySelector(".mobile-controls")).toBeTruthy();

    // `/game` is deliberately absent from `AppRouter.tsx`'s `IMMERSIVE_PATHS` (matching the
    // pre-router `App.tsx`'s `immersive` set, which never included `"game"` either — see that
    // set's docblock): the status pill stays visible, while language selection lives in Settings.
    expect(document.querySelector("#locale-toggle")).toBeNull();
    expect(document.querySelector("#status")).toBeTruthy();
  });
});
