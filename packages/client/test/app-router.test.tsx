import { setLocale } from "@lindocara/client/i18n.js";
import { AppRouter } from "@lindocara/client/ui/AppRouter.js";
import { waitFor } from "@testing-library/dom";
import { Alepha } from "alepha";
import { AlephaReact } from "alepha/react";
import { ReactRouter } from "alepha/react/router";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Stubs the two calls the layout's boot effect and `MainMenu`'s own "has saves" probe make, so
 * neither falls through to a real network request under jsdom. `/_auth/userinfo` goes through
 * `ReactAuth.ping()` (Alepha's own `HttpClient`, Task 3), which decodes the response against
 * `userinfoResponseSchema` before handing it back — `api: { actions: {} }` is the minimal legal
 * registry that schema requires alongside `user`; a body missing it fails decode and `ping()`
 * silently reads as "anonymous" (see `AppLayout`'s `.catch(() => undefined)`), which would send
 * every test below down the guest-fallback path instead of the authenticated one it expects.
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

  // The layout installs a `GameNavigation` (`state/navigation.ts`) on mount and clears it on
  // unmount — `game/session.ts` is the sole consumer left after Task 6 removed the store's dead
  // `setScreen`/`setAdventureEditorSession` shims (every UI caller reaches `useRouter()`/
  // `useStore()` directly now). Proves the installed seam's `toMenu()` genuinely lands on the
  // router, not just that it was installed.
  it("installs the navigation seam on mount, and its toMenu() genuinely navigates", async () => {
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
      getGameNavigation()?.toMenu();
    });

    await waitFor(() => {
      expect(document.querySelector(".main-menu")).toBeTruthy();
      expect(document.querySelector(".title-screen")).toBeNull();
    });
  });

  // Task 3's 401 seam (`state/navigation.ts`'s `onUnauthorized` docblock): ONE recovery closure,
  // reached from two different fetch mechanisms. Both tests below land on `/menu` first (the
  // shared `stubFetch()` above answers `/_auth/userinfo` as already-authenticated, so the layout's
  // boot ping never falls through to the guest flow and never races these tests' own actions).
  describe("the 401 seam", () => {
    it("routes an alepha HttpClient 401 to /auth and clears the auth atom (the client:onError hook)", async () => {
      stubFetch();
      alepha = Alepha.create().with(AlephaReact).with(AppRouter);
      await alepha.start();
      const router = alepha.inject(ReactRouter);

      await act(async () => {
        await router.push("/menu");
      });
      await waitFor(() => expect(document.querySelector(".main-menu")).toBeTruthy());

      const { HttpError } = await import("alepha/server");
      const { currentUserAtom } = await import("alepha/security");
      await act(async () => {
        await alepha?.events.emit("client:onError", {
          error: new HttpError({ error: "UnauthorizedError", status: 401, message: "Not allowed" }),
        });
      });

      await waitFor(() => expect(document.querySelector(".auth-shell")).toBeTruthy());
      expect(alepha?.store.get(currentUserAtom)).toBeUndefined();
    });

    it("routes an api.ts plain-fetch 401 (UnauthorizedError machine code) to /auth through the SAME seam", async () => {
      // A boolean flag, not a call counter: React StrictMode (Alepha's own root wraps in it, see
      // `ReactPageProvider.ts`) double-invokes a freshly-mounted component's effects, so
      // `MainMenu`'s own "has saves" probe legitimately fires `/api/parties` more than once on its
      // first mount — a count-based "fail on the Nth call" would be timing-dependent noise here.
      let unauthorized = false;
      const mock = vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        if (path.startsWith("/_auth/userinfo")) {
          return new Response(
            JSON.stringify({ user: { id: "acc-1", username: "nico" }, api: { actions: {} } }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (path.startsWith("/api/parties")) {
          if (unauthorized) {
            return new Response(
              JSON.stringify({ error: "UnauthorizedError", status: 401, message: "Not allowed" }),
              { status: 401, headers: { "Content-Type": "application/json" } },
            );
          }
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        throw new Error(`app-router.test.tsx: unexpected fetch ${path}`);
      });
      vi.stubGlobal("fetch", mock);

      alepha = Alepha.create().with(AlephaReact).with(AppRouter);
      await alepha.start();
      const router = alepha.inject(ReactRouter);

      await act(async () => {
        await router.push("/menu");
      });
      await waitFor(() => expect(document.querySelector(".main-menu")).toBeTruthy());

      unauthorized = true;
      const { fetchParties } = await import("@lindocara/client/api.js");
      await act(async () => {
        await fetchParties().catch(() => undefined);
      });

      await waitFor(() => expect(document.querySelector(".auth-shell")).toBeTruthy());
    });
  });
});
