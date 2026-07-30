import { setLocale } from "@lindocara/client/i18n.js";
import { AppRouter } from "@lindocara/client/ui/AppRouter.js";
import { waitFor } from "@testing-library/dom";
import { Alepha } from "alepha";
import { AlephaReact } from "alepha/react";
import { ReactRouter } from "alepha/react/router";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Stubs the two calls the layout's boot effect and `MainMenu`'s own "has saves" probe make, so
 *  neither falls through to a real network request under jsdom. */
function stubFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.startsWith("/_auth/userinfo")) {
        return new Response(JSON.stringify({ user: { id: "acc-1", username: "nico" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (path.startsWith("/api/parties")) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`app-router.test.tsx: unexpected fetch ${path}`);
    }),
  );
}

describe("AppRouter", () => {
  let alepha: Alepha | undefined;

  beforeEach(() => {
    setLocale("en");
    document.title = "";
    document.head.innerHTML = "";
    // The real served shell already ships `#root` (Alepha's own HTML template, `ViteUtils.
    // generateIndexHtml`); the client bootstrap under test below (`bootClient`) is what adds
    // `#stage` beside it.
    document.body.innerHTML = '<div id="root"></div>';
    stubFetch();
  });

  afterEach(async () => {
    await alepha?.stop();
  });

  it("boots the canvas beside #root, then renders title -> menu through the router", async () => {
    const { bootClient } = await import("@lindocara/client/main.js");
    expect(bootClient()).toBe(true);

    const stage = document.querySelector("#stage");
    const root = document.querySelector("#root");
    expect(stage).toBeTruthy();
    expect(root).toBeTruthy();
    // The canvas is not React's (see the repo AGENTS.md gotcha): a sibling of #root, placed
    // BEFORE it, so #root's chrome paints on top of it.
    const children = Array.from(document.body.children);
    expect(children.indexOf(stage as Element)).toBeLessThan(children.indexOf(root as Element));

    alepha = Alepha.create().with(AlephaReact).with(AppRouter);
    await alepha.start();
    const router = alepha.inject(ReactRouter);

    await act(async () => {
      await router.push("/");
    });
    await waitFor(() => {
      expect(document.querySelector(".title-screen")).toBeTruthy();
    });

    await act(async () => {
      await router.push("/menu");
    });
    await waitFor(() => {
      expect(document.querySelector(".main-menu")).toBeTruthy();
      expect(document.querySelector(".title-screen")).toBeNull();
    });
  });

  // Task 2 replaced the temporary screen-to-router bridge with the `state/navigation.ts` seam: the
  // layout installs a `GameNavigation` on mount and clears it on unmount. Proves a reused screen's
  // still-unmigrated `setScreen(...)` call (the store's now-deprecated shim) lands on the router
  // through that seam, so main stays clickable for `TitleScreen`/`MainMenu`/etc. until they are
  // wired onto the router directly.
  it("installs the navigation seam on mount so a legacy setScreen(...) call still lands on the router", async () => {
    const { useUiStore } = await import("@lindocara/client/store.js");
    const { getGameNavigation } = await import("@lindocara/client/state/navigation.js");
    alepha = Alepha.create().with(AlephaReact).with(AppRouter);
    await alepha.start();
    const router = alepha.inject(ReactRouter);

    await act(async () => {
      await router.push("/");
    });
    await waitFor(() => {
      expect(document.querySelector(".title-screen")).toBeTruthy();
      expect(getGameNavigation()).not.toBeNull();
    });

    await act(async () => {
      useUiStore.getState().setScreen("menu");
    });

    await waitFor(() => {
      expect(document.querySelector(".main-menu")).toBeTruthy();
      expect(document.querySelector(".title-screen")).toBeNull();
    });
  });
});
