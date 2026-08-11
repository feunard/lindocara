import { setLocale } from "@lindocara/client/i18n.js";
import { AppRouter } from "@lindocara/client/ui/AppRouter.js";
import { waitFor } from "@testing-library/dom";
import { Alepha } from "alepha";
import { AlephaReact } from "alepha/react";
import { ReactRouter } from "alepha/react/router";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Stubs the two calls `AppRouter.bootPing` (the `$hook({ on: "start" })`, not a React effect — it
 * has not been one since Task 2's fix round 1) and `MainMenu`'s own "has saves" probe make, so
 * neither falls through to a real network request under jsdom. `/_auth/userinfo` goes through
 * `ReactAuth.ping()` (Alepha's own `HttpClient`, Task 3), which decodes the response against
 * `userinfoResponseSchema` before handing it back — `api: { actions: {} }` is the minimal legal
 * registry that schema requires alongside `user`; a body missing it fails decode and `ping()`
 * silently reads as "anonymous" (see `bootPing`'s `.catch(() => undefined)`), which would send
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
    // `bootPing`'s guest fallback and its one-shot logout suppression both read persistent storage
    // (`guest.ts`), and jsdom keeps both stores for the whole FILE — a credential saved by one test
    // would silently change which branch the next one takes.
    localStorage.clear();
    sessionStorage.clear();
    stubFetch();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
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
  // shared `stubFetch()` above answers `/_auth/userinfo` as already-authenticated, so
  // `AppRouter.bootPing` never falls through to the guest flow and never races these tests' own
  // actions).
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

  /**
   * `AppRouter.bootPing`'s two invariants, both of which cost a real account when broken.
   *
   * The final whole-branch review found the first one HIGH: the hook's `Promise.race` used to
   * collapse "the cap elapsed" and "the ping answered nobody" into one `undefined`, so the guest
   * chain fired on a SLOW-but-real session too — and `continueAsGuest()` logs in or REGISTERS,
   * which makes the server set a NEW session cookie over the real one. A returning player on a
   * slow network lost their saves, a junk account was minted, an admin lost the `admin` role, and
   * nothing failed or logged anywhere.
   *
   * Both tests below deliberately wait out the real `BOOT_PING_TIMEOUT_MS` (2500ms) rather than
   * faking timers: the hook's whole shape is about which of two real clocks wins, and the guest
   * chain it may or may not start is fire-and-forget, so a fake clock would decide the outcome
   * being asserted. Each therefore carries an explicit generous timeout.
   */
  describe("the boot ping", () => {
    /** Comfortably past `BOOT_PING_TIMEOUT_MS` (2500ms) — a SLOW answer, never a hung one. */
    const SLOW_PING_MS = 3_000;
    const TEST_TIMEOUT_MS = 30_000;
    const SETTLE_TIMEOUT_MS = 15_000;

    /**
     * Answers `/_auth/userinfo` with `body`, after `delayMs`, and records every path the app
     * fetched — a guest registration is then provable by the ABSENCE of `/api/users/register`
     * and `/_auth/token` from that record, which asserting on rendered output cannot show.
     * The guest chain's own endpoints answer plausibly rather than throwing, so a regression
     * shows up as a recorded call rather than as a caught exception.
     */
    function stubUserinfo(body: unknown, delayMs = 0): string[] {
      const paths: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          const path = String(input);
          paths.push(path);
          if (path.startsWith("/_auth/userinfo")) {
            if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
            return new Response(JSON.stringify(body), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          if (path.startsWith("/api/users/register") && !path.includes("complete")) {
            return new Response(JSON.stringify({ intentId: "guest-intent" }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          if (path.startsWith("/_auth/token")) {
            return new Response(JSON.stringify({ user: { id: "guest-1", username: "guest-x" } }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          return new Response("{}", {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }),
      );
      return paths;
    }

    const guested = (paths: readonly string[]): boolean =>
      paths.some(
        (path) => path.startsWith("/api/users/register") || path.startsWith("/_auth/token"),
      );

    /** The beat the fire-and-forget guest chain would need to reach its first request. */
    const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

    beforeEach(() => {
      history.pushState({}, "", "/");
    });

    it(
      "never replaces a real session with a guest when the ping resolves AFTER the timeout",
      async () => {
        const paths = stubUserinfo(
          { user: { id: "acc-1", username: "nico" }, api: { actions: {} } },
          SLOW_PING_MS,
        );
        const { currentUserAtom } = await import("alepha/security");

        alepha = Alepha.create().with(AlephaReact).with(AppRouter);
        await act(async () => {
          await alepha?.start();
        });

        // The race genuinely timed out — without this the test could pass on a ping that simply
        // won, proving nothing about the branch under test.
        expect(alepha.store.get(currentUserAtom)).toBeUndefined();

        // The late answer lands and is honoured: the atom fills from the ping the race abandoned
        // waiting on, not from a guest account signed in over the top of it.
        await act(async () => {
          await waitFor(() => expect(alepha?.store.get(currentUserAtom)).toBeTruthy(), {
            timeout: SETTLE_TIMEOUT_MS,
          });
        });
        await settle();

        expect(guested(paths)).toBe(false);
        expect(alepha.store.get(currentUserAtom)).toMatchObject({ username: "nico" });
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "still falls back to a guest when the ping resolves with NO user after the timeout",
      async () => {
        // The other half of the same branch, and what keeps the fix above from being "never guest
        // after a timeout": a legal userinfo response with no `user` is a real answer — nobody is
        // signed in — and an anonymous visitor must still get their guest session, just decided by
        // the ping instead of by the clock.
        const paths = stubUserinfo({ api: { actions: {} } }, SLOW_PING_MS);

        alepha = Alepha.create().with(AlephaReact).with(AppRouter);
        await act(async () => {
          await alepha?.start();
        });

        await waitFor(() => expect(guested(paths)).toBe(true), { timeout: SETTLE_TIMEOUT_MS });
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "leaves the boot after a QUIT anonymous instead of signing a guest straight back in",
      async () => {
        // The navigation seam's `logout` (`AppRouter.tsx`) is what QUIT calls. `ReactAuth.logout()`
        // revokes the session with a form POST whose redirect reloads the app, so without the two
        // guards that seam now installs, signing out reloaded into `bootPing`, which found no user
        // and immediately signed the browser back in — as the same guest account when a credential
        // was stored, as a brand-new one when it was not.
        const { getGameNavigation } = await import("@lindocara/client/state/navigation.js");
        const { readGuest, saveGuest } = await import("@lindocara/client/guest.js");
        // A browser that already owns a guest account: the case where "log out" would otherwise be
        // undone within the second, by the very same account.
        saveGuest({ username: "guest-abc", password: "0123456789abcdef" });
        // jsdom has no navigation, so `form.submit()` would only raise its "not implemented"
        // console error. Stubbing the DOM method (not a module — no `vi.mock` here) both keeps the
        // output clean and lets the sign-out itself be asserted rather than assumed.
        const submit = vi
          .spyOn(HTMLFormElement.prototype, "submit")
          .mockImplementation(() => undefined);

        const signedIn = Alepha.create().with(AlephaReact).with(AppRouter);
        try {
          await act(async () => {
            await signedIn.start();
          });
          await waitFor(() => expect(getGameNavigation()).not.toBeNull());

          act(() => {
            getGameNavigation()?.logout();
          });
          expect(submit).toHaveBeenCalledTimes(1);
          expect(readGuest()).toBeNull();
        } finally {
          await signedIn.stop();
        }

        // The reload that logout's redirect causes: a fresh app on a document whose session is
        // gone. `/_auth/userinfo` answers "nobody" IMMEDIATELY here — this is the definitive
        // no-user answer, the very case the test above requires the guest chain to fire on, so the
        // only thing that can keep it from firing is the one-shot suppression QUIT left behind.
        document.body.innerHTML = '<div id="root"></div>';
        const paths = stubUserinfo({ api: { actions: {} } });
        alepha = Alepha.create().with(AlephaReact).with(AppRouter);
        await act(async () => {
          await alepha?.start();
        });
        await waitFor(() => expect(paths.some((p) => p.startsWith("/_auth/userinfo"))).toBe(true));
        await settle();

        expect(guested(paths)).toBe(false);
        submit.mockRestore();
      },
      TEST_TIMEOUT_MS,
    );
  });
});
