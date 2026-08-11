import { setLocale } from "@lindocara/client/i18n.js";
import { AppRouter } from "@lindocara/client/ui/AppRouter.js";
import { screen, waitFor } from "@testing-library/dom";
import { Alepha } from "alepha";
import { AlephaReact } from "alepha/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mounts the real `AppRouter` at `/admin` directly (the same technique `auth-screen.test.tsx` uses
 * to land on `/auth`), so `AppRouter`'s own `bootPing` `$hook({ on: "start" })` — not a React
 * effect — resolves against `/admin` as the cold-load target, and the lazy `AdminRouter`/
 * `AdminShell` route resolves through the real dynamic `import()`. No `vi.mock`.
 *
 * `stubFetch`'s `permissions` argument is the SAME wire field
 * `PermissionRegistryProvider.granted` reads (`apiRegistryResponseSchema.permissions`,
 * `.vendor/alepha/src/server/links/schemas/apiLinksResponseSchema.ts`) — a public, versioned
 * response shape, not a private/internal one — so a positive (admin) session can be constructed by
 * supplying realistic wire data through the same `/_auth/userinfo` endpoint the app already calls,
 * with no harness reaching into `LinkProvider`/`PermissionRegistryProvider` internals.
 */
function stubFetch(permissions: string[] = []): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.startsWith("/_auth/userinfo")) {
        return new Response(
          JSON.stringify({
            user: { id: "acc-1", username: "nico" },
            api: {
              // `admin-users.tsx` calls `client.findRoles()` (on mount, via `useQuery`) and
              // `client.findUsers()` (the table's data fetcher) through `useClient<
              // AdminUserController>()`, which resolves an action NAME against this registry
              // before ever reaching the network (`LinkProvider`, `.vendor/alepha/src/server/
              // links/providers/LinkProvider.ts`). An entry-less registry (`actions: {}`) makes
              // both resolve as "not found" — a CLIENT-SIDE `UnauthorizedError` (401) with no
              // network call at all — which `AppRouter.onUnauthorizedFetch` then treats exactly
              // like a real server refusal and navigates to `/auth`, unmounting the sidebar this
              // test is asserting on. The path value itself is irrelevant (this stub answers every
              // path with a benign `{}` below); only the KEY needs to exist for resolution to
              // succeed.
              actions: {
                findUsers: { path: "/_admin/users" },
                findRoles: { path: "/_admin/roles" },
              },
              permissions,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      // Anything else (the admin-users table's own data fetch, Spotlight, ...) gets a benign
      // empty 200 rather than throwing: the two tests below assert on the SIDEBAR/denial, which
      // is derived from route/nav metadata and the userinfo response alone, not from whatever a
      // routed leaf page additionally fetches once it mounts.
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }),
  );
}

describe("AdminShell route", () => {
  let alepha: Alepha | undefined;

  beforeEach(() => {
    setLocale("en");
    document.title = "";
    document.head.innerHTML = "";
    document.body.innerHTML = '<div id="root"></div>';
    history.pushState({}, "", "/admin");
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  // Both tests below boot a full Alepha app AND render deep into `@alepha/ui`'s `AppShell` tree
  // (sidebar, dialog/toast providers, icons) — noticeably heavier than this suite's typical test,
  // and close enough to vitest's 5000ms default to time out under load when the whole suite runs
  // in parallel (observed: comfortably under 2s alone, ~5s+ inside a full `npm test -w
  // @lindocara/client` run). A generous explicit timeout avoids that flakiness.
  //
  // Raised from 15s: the last two tests deliberately wait out `BOOT_PING_TIMEOUT_MS` (2500ms)
  // BEFORE their own `waitFor` even starts, so their budget is the sum, not the max. At 15s with
  // a 5s inner wait, a loaded machine had roughly 7s of slack for a lazy route import plus a
  // React render — and one of them was observed going red at 7.6s under `npm run check`.
  const TEST_TIMEOUT_MS = 30_000;
  /** Inner waits in the two timeout-dependent tests, which start AFTER the boot race resolves. */
  const SLOW_RENDER_TIMEOUT_MS = 15_000;

  it(
    "refuses a session without admin:ui with a 403, never a stuck 401",
    async () => {
      // `$secure({ permissions: ["admin:ui"] })` on `AdminRouter.adminLayout` is the route's ONLY
      // guard — the superseded `AdminScreen`'s hand-rolled `has("admin:*")` check is gone, and there
      // is no manual guard to reintroduce.
      //
      // The assertion is POSITIVE (the status `ReactPageProvider.denyGuardedPage` renders for an
      // authenticated-but-forbidden visitor) rather than only checking that the sidebar's nav
      // labels are absent. A labels-absent-only check passes just as happily if `AdminRouter` never
      // registered, a `lazy: import()` path were wrong, or `AdminShell` threw — none of those are
      // the guard doing its job, and a bare 404/import-failure is indistinguishable from a correct
      // denial to that assertion alone.
      //
      // It asserts the STATUS, not the framework's prose: the "you do not have permission…"
      // sentence belongs to the vendored DEV error page, so a routine `npx alepha vendor sync`
      // could reword it and redden this test without anything in this repo changing. `403` carries
      // the same load and is a contract rather than copy.
      //
      // That status is exactly the point: this session (real userinfo response, empty
      // `permissions`) is AUTHENTICATED — so `denyGuardedPage` takes its 403 branch, never the 401
      // ("Authentication required") one an anonymous visitor would get. Seeing 403 here is also the
      // proof that `currentUserAtom` was populated BEFORE this route's first transition evaluated
      // the guard (`AppRouter.bootPing`'s whole point) — an empty atom at that moment would have
      // produced the 401 branch instead, which is exactly the cold-load regression the next test
      // guards against directly.
      stubFetch([]);
      alepha = Alepha.create().with(AlephaReact).with(AppRouter);
      await act(async () => {
        await alepha?.start();
      });

      await waitFor(() => {
        expect(screen.getByText("403")).toBeTruthy();
      });
      expect(screen.queryByText(/authentication required/i)).toBeNull();

      // The sidebar is derived from `AdminRouter`'s `navPage` tree — none of its nav labels
      // (Users / Sessions / API keys / Audit log) may appear when the route was refused.
      expect(screen.queryByText("Users")).toBeNull();
      expect(screen.queryByText("Sessions")).toBeNull();
      expect(screen.queryByText("API keys")).toBeNull();
      expect(screen.queryByText("Audit log")).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "does not dead-end an already-authenticated admin's cold /admin load",
    async () => {
      // Direct regression test for the finding: before fix round 1, the boot ping ran from
      // `AppLayout`'s `useEffect`, which only runs AFTER first paint — after the router's own FIRST
      // route transition had already evaluated `$secure` against a still-empty `currentUserAtom`.
      // `AppRouter.bootPing` (a `$hook({ on: "start" })`) now fully resolves before the router's
      // first transition runs at all, closing that window: for THIS session (a fast, successful
      // `ping()`), the atom is already populated by the time the guard runs, so it never takes the
      // anonymous branch at all — the "login" route rename (fix round 3, see the third test below)
      // is what protects a SLOW-but-real session instead.
      //
      // Grants every permission the admin route tree actually checks — the layout's own `admin:ui`
      // plus each page's own `nav.permission` — so the guard genuinely passes and the full sidebar
      // mounts, rather than only inferring success from the absence of a 401.
      stubFetch([
        "admin:ui",
        "admin:user:read",
        "admin:session:read",
        "admin:api-key:read",
        "admin:audit:read",
      ]);
      alepha = Alepha.create().with(AlephaReact).with(AppRouter);
      await act(async () => {
        await alepha?.start();
      });

      // "Users" appears twice once the redirect to `/admin/users` lands (the sidebar nav item AND
      // the breadcrumb's current-page crumb) — `getAllByText` for that one, `getByText` for the
      // other three sidebar-only labels.
      await waitFor(() => {
        expect(screen.getAllByText("Users").length).toBeGreaterThan(0);
      });
      expect(screen.getByText("Sessions")).toBeTruthy();
      expect(screen.getByText("API keys")).toBeTruthy();
      expect(screen.getByText("Audit log")).toBeTruthy();
      expect(screen.queryByText(/authentication required/i)).toBeNull();
      expect(screen.queryByText(/you do not have permission/i)).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "mounts even when /_auth/userinfo hangs forever",
    async () => {
      // Fix round 2's regression test: `AppRouter.bootPing` used to await the WHOLE
      // ping/guest/re-ping chain before letting `alepha.start()` resolve. Alepha's `HttpClient`
      // has no timeout of its own, so a hanging (never resolving, not merely slow or failing)
      // `/_auth/userinfo` blocked `"start"` forever — and a `"start"` hook that never resolves
      // means the app never reaches `"ready"`, i.e. never mounts React at all. `bootPing` now
      // races its one awaited `ping()` against `BOOT_PING_TIMEOUT_MS` and lets mount proceed
      // either way, so a dead auth endpoint degrades to "renders anonymous" instead of "blank
      // page forever".
      //
      // `/_auth/userinfo` here returns a Promise that never settles — not a slow one, the
      // worst case the finding named explicitly. Every other path (the guest-registration
      // fallback's own calls, fired unawaited in the background) gets a benign, schema-plausible
      // response so that background chain doesn't throw noisily; it has no bearing on this
      // test's assertion either way, since nothing here awaits it.
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          const path = String(input);
          if (path.startsWith("/_auth/userinfo")) {
            return new Promise<Response>(() => {
              /* never resolves */
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

      alepha = Alepha.create().with(AlephaReact).with(AppRouter);
      await act(async () => {
        await alepha?.start();
      });

      // No wall-clock assertion here, deliberately. "`start()` returned instead of hanging on the
      // dead request" is already proven by this test COMPLETING at all: the request never resolves,
      // so a `bootPing` that failed to bound itself would hang `start()` and the test would fail on
      // `TEST_TIMEOUT_MS`. An extra `elapsed < 6000` check proved nothing further and measured the
      // machine instead of the code — it was the one assertion in this file observed going red
      // under `npm run check`'s parallel load while passing in isolation.

      // With `currentUserAtom` still empty (the real ping never returns in this test), `/admin`'s
      // guard denies the ANONYMOUS branch — and since fix round 3 renamed the sign-in route to
      // `login`, `denyGuardedPage` now REDIRECTS there instead of throwing (see the next test,
      // which asserts that redirect precisely). This test isn't about which of those two shapes
      // fires, only that SOMETHING renders promptly either way, rather than an eternally blank
      // `#root` — so the assertion stays deliberately generic.
      await waitFor(
        () => {
          expect(document.body.textContent).not.toBe("");
        },
        { timeout: SLOW_RENDER_TIMEOUT_MS },
      );
      expect(screen.queryByText("Users")).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "redirects to sign-in instead of latching an error when a real session resolves after the boot timeout",
    async () => {
      // Fix round 3's regression test. The residual bug: `bootPing`'s `BOOT_PING_TIMEOUT_MS` cap
      // is required (round 2), but ANY bounded timeout has a "the real answer arrives a moment
      // after the cap" case — a genuinely authenticated admin whose `/_auth/userinfo` legitimately
      // takes longer than the cap (a cold platform boot, a slow network, a DB latency spike; slow,
      // not hung) still has an EMPTY `currentUserAtom` at the guard's first evaluation. Before this
      // round, that dead-ended exactly like a truly anonymous visitor: `denyGuardedPage` threw a
      // 401 that `NestedView`'s `ErrorBoundary` latched permanently (`resetKeys` is only the
      // pathname — never the atom), so the session resolving moments later changed nothing already
      // on screen. Renaming the sign-in route from `auth` to `login` (`AppRouter.tsx`'s `login`
      // field) fixes this unconditionally rather than narrowing the window: `denyGuardedPage` now
      // finds that route and REDIRECTS instead of throwing, for ANY no-user-yet guard evaluation —
      // slow-but-real and truly-anonymous alike.
      //
      // `/_auth/userinfo` resolves SUCCESSFULLY here, carrying full admin permissions — proving the
      // motivating scenario (a real admin, not merely an anonymous visitor) — but only after
      // 3500ms, comfortably past `BOOT_PING_TIMEOUT_MS` (2500ms). `bootPing`'s race times out
      // first, mount proceeds with the atom still empty, and only THEN does the slow ping resolve
      // in the background — after the first transition already ran.
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          const path = String(input);
          if (path.startsWith("/_auth/userinfo")) {
            await new Promise((resolve) => setTimeout(resolve, 3_500));
            return new Response(
              JSON.stringify({
                user: { id: "acc-1", username: "nico" },
                api: {
                  actions: {},
                  permissions: [
                    "admin:ui",
                    "admin:user:read",
                    "admin:session:read",
                    "admin:api-key:read",
                    "admin:audit:read",
                  ],
                },
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }
          // Registration/login stubs kept as a TRIPWIRE's safety net, not because this test needs
          // them: `bootPing` used to fire its guest-registration fallback the moment the race
          // timed out, which is the HIGH finding the final whole-branch review caught — a
          // slow-but-real session being replaced by a guest account. It now waits for the ping's
          // own resolution, so nothing below is reached at all here. `app-router.test.tsx`'s
          // "boot ping" suite asserts that absence directly; these branches only keep a regression
          // from turning into jsdom's noisy "not implemented: navigation" warning via the
          // fallback's total-failure `window.location.href` branch.
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

      alepha = Alepha.create().with(AlephaReact).with(AppRouter);
      await act(async () => {
        await alepha?.start();
      });

      // Redirected to the sign-in screen (route name `login`, URL path `/auth`) — NOT a latched
      // 401/403 error, and NOT the admin sidebar (the atom was still empty at the moment the guard
      // ran, regardless of what the slow ping would eventually grant).
      await waitFor(
        () => {
          expect(document.querySelector(".auth-shell")).toBeTruthy();
        },
        { timeout: SLOW_RENDER_TIMEOUT_MS },
      );
      expect(screen.queryByText(/authentication required/i)).toBeNull();
      expect(screen.queryByText(/you do not have permission/i)).toBeNull();
      expect(screen.queryByText("Users")).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );
});
