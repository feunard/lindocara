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
  const TEST_TIMEOUT_MS = 15_000;

  it(
    "refuses a session without admin:ui with a 403, never a stuck 401",
    async () => {
      // `$secure({ permissions: ["admin:ui"] })` on `AdminRouter.adminLayout` is the route's ONLY
      // guard — the superseded `AdminScreen`'s hand-rolled `has("admin:*")` check is gone, and there
      // is no manual guard to reintroduce.
      //
      // The assertion is POSITIVE (matches the exact text `ReactPageProvider.denyGuardedPage`
      // renders for an authenticated-but-forbidden visitor) rather than only checking that the
      // sidebar's nav labels are absent. A labels-absent-only check passes just as happily if
      // `AdminRouter` never registered, a `lazy: import()` path were wrong, or `AdminShell` threw —
      // none of those are the guard doing its job, and a bare 404/import-failure is indistinguishable
      // from a correct denial to that assertion alone.
      //
      // The status matters too, not just the message: this session (real userinfo response, empty
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
        expect(screen.getByText(/you do not have permission to access this page/i)).toBeTruthy();
      });
      expect(screen.getByText("403")).toBeTruthy();
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
      // Direct regression test for the finding: before this fix, the boot ping ran from
      // `AppLayout`'s `useEffect`, which only runs AFTER first paint — after the router's own FIRST
      // route transition had already evaluated `$secure` against a still-empty `currentUserAtom`.
      // `ReactPageProvider.denyGuardedPage`'s anonymous-visitor branch looks for a route named
      // exactly "login" to redirect to; this app's equivalent route is named "auth", so that
      // fallback never fired, and the resulting 401 "Authentication required" error latched in
      // `NestedView`'s `ErrorBoundary` — whose `resetKeys` is only the pathname, not the atom — so a
      // real admin who bookmarked, typed, or refreshed `/admin` got stuck on that error page even
      // though `ping()` would have resolved a moment later. `AppRouter.bootPing` (a `$hook({ on:
      // "start" })`) now fully resolves before the router's first transition runs at all, closing
      // the window this regression lived in.
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
});
