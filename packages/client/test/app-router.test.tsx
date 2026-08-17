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
    // jsdom keeps both stores for the whole FILE, so anything one test persists is still there for
    // the next. Nothing in the boot path reads storage any more — the guest credential and the
    // one-shot logout suppression that used to live here went with guest accounts — but the app
    // does persist elsewhere (`quickItemsAtom`, the chat size), and leaking that between tests is
    // the same silent cross-talk for a different key.
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
  // reached from two different fetch mechanisms. Both tests below land on `/menu` first, and the
  // shared `stubFetch()` above answers `/_auth/userinfo` as already-authenticated so the guard on
  // that page passes.
  describe("the 401 seam", () => {
    // Each test here ENDS on `/auth` — that is what the seam does, and what they assert. jsdom
    // carries the URL into the next test, and `bootPing` deliberately does nothing when the boot
    // lands on `/auth` (see its docblock), so without this reset the second test boots with an
    // empty `currentUserAtom` and `$secure({})` bounces its `/menu` push straight back to sign-in
    // before the seam under test is ever exercised. Harmless while `/menu` was unguarded; a
    // confusing failure the moment it was not.
    beforeEach(() => {
      history.pushState({}, "", "/");
    });

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
     * fetched.
     *
     * The registration endpoints below are stubbed to answer PLAUSIBLY rather than to throw, and
     * that is the whole design of this helper: `bootPing` used to end in an automatic guest
     * registration, and the guarantee these tests now defend is that it never registers anything
     * again. A regression therefore has to show up as a RECORDED CALL — visible in `paths`, and
     * asserted by `guested()` — instead of as a caught exception that some `.catch()` upstream
     * could swallow into a passing test. Rendered output cannot show this at all.
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

    /** Did anything mint an account behind the visitor's back? It must never be true again. */
    const guested = (paths: readonly string[]): boolean =>
      paths.some(
        (path) => path.startsWith("/api/users/register") || path.startsWith("/_auth/token"),
      );

    /**
     * The beat a fire-and-forget registration chain would need to reach its first request.
     *
     * Asserting an absence needs somewhere to be absent FROM: without this wait, every test below
     * would pass simply by checking before anything could have happened.
     */
    const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

    beforeEach(() => {
      history.pushState({}, "", "/");
    });

    it(
      "honours a real session whose ping resolves AFTER the timeout",
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

        // The late answer lands and is honoured: the atom fills from the very ping the race
        // abandoned WAITING on. The race bounds the mount; it never discards the request, and
        // nothing signs in over the top of the session it is about to return.
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
      "mints no account at all when the ping resolves with NO user",
      async () => {
        // The direct regression test for removing guest accounts, and the reason this suite still
        // exists. This is the DEFINITIVE anonymous answer — a legal userinfo response carrying no
        // `user`, resolved immediately, so nothing is merely late — and it is precisely the case
        // that used to fire `continueAsGuest()`: register, log in, and hand a public visitor an
        // account they never asked for. Nothing may reach the CA of accounts here now; the visitor
        // stays anonymous and the page guards decide what they may see.
        const paths = stubUserinfo({ api: { actions: {} } });

        alepha = Alepha.create().with(AlephaReact).with(AppRouter);
        await act(async () => {
          await alepha?.start();
        });
        await waitFor(() => expect(paths.some((p) => p.startsWith("/_auth/userinfo"))).toBe(true));
        await settle();

        expect(guested(paths)).toBe(false);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "sends an anonymous visitor from a guarded page to the sign-in screen",
      async () => {
        // The mechanism that REPLACED the guest fallback, asserted end to end rather than assumed
        // from the presence of a `use:` entry. `$secure({})` on `/menu` resolves the route named
        // `login` and returns a redirect to `/auth?redirect=/menu`, so what renders is the auth
        // shell — not the menu, and not a latched "Authentication required" error, which is what
        // a guard without a resolvable `login` route would produce.
        stubUserinfo({ api: { actions: {} } });
        history.pushState({}, "", "/menu");

        alepha = Alepha.create().with(AlephaReact).with(AppRouter);
        await act(async () => {
          await alepha?.start();
        });

        await waitFor(() => expect(document.querySelector(".auth-shell")).toBeTruthy(), {
          timeout: SETTLE_TIMEOUT_MS,
        });
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "leaves the boot after a QUIT anonymous",
      async () => {
        // The navigation seam's `logout` (`AppRouter.tsx`) is what QUIT calls. `ReactAuth.logout()`
        // revokes the session with a form POST whose redirect reloads the app, and this asserts
        // the reload lands anonymous.
        //
        // It used to take real machinery to make that true: the reload ran straight into
        // `bootPing`, which found no user and signed the browser back in a second later — as the
        // same guest account when a credential was stored, as a brand-new one when it was not — so
        // `logout` had to drop the stored credential AND leave a one-shot marker telling the next
        // boot not to re-guest. Both are gone with guest accounts, and this test is kept precisely
        // because the PROPERTY is not: signing out must still leave the player signed out, however
        // few moving parts that now takes.
        const { getGameNavigation } = await import("@lindocara/client/state/navigation.js");
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
        } finally {
          await signedIn.stop();
        }

        // The reload that logout's redirect causes: a fresh app on a document whose session is
        // gone. `/_auth/userinfo` answers "nobody" IMMEDIATELY — the definitive no-user answer,
        // and the exact case that used to mint an account.
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
