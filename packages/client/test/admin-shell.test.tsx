import { setLocale } from "@lindocara/client/i18n.js";
import { AppRouter } from "@lindocara/client/ui/AppRouter.js";
import { screen, waitFor } from "@testing-library/dom";
import { Alepha } from "alepha";
import { AlephaReact } from "alepha/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * RULING (pre-flight, human-decided, `.superpowers/sdd/2026-08-11-admin-console-and-logout/
 * task-2-brief.md`): the NEGATIVE branch only. A session with no permissions is the real
 * provider's default state — `LinkProvider.can()` (`.vendor/alepha/src/server/links/providers/
 * LinkProvider.ts`) reads a permission set that stays empty until something fetches
 * `/api/_links`, which this test never triggers — so no harness or mock is needed to prove
 * `$secure({ permissions: ["admin:ui"] })` refuses this session. Seeding a positive admin session
 * would mean reaching into alepha's `LinkProvider`/`PermissionRegistryProvider` internals, a
 * harness coupled to a vendored provider's private shape that the next `vendor sync` could break.
 * The positive branch (the sidebar and its five pages render for a real admin) is proven in
 * Task 4's browser pass, where a real admin session exists.
 *
 * Mounts the real `AppRouter` at `/admin` directly (the same technique `auth-screen.test.tsx` uses
 * to land on `/auth`), so the layout's boot ping sees `/admin` on its very first render and the
 * lazy `AdminRouter`/`AdminShell` route resolves through the real dynamic `import()` — no
 * `vi.mock`. Reuses the deleted `admin-screen.test.tsx`'s `/_auth/userinfo` stub pattern rather
 * than inventing another, per the brief.
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
      throw new Error(`admin-shell.test.tsx: unexpected fetch ${path}`);
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
    stubFetch();
  });

  afterEach(async () => {
    await alepha?.stop();
    alepha = undefined;
  });

  it("does not render the admin sidebar for a session without admin:ui", async () => {
    // `$secure({ permissions: ["admin:ui"] })` on `AdminRouter.adminLayout` now guards the route
    // itself — the superseded `AdminScreen`'s hand-rolled `has("admin:*")` check is gone, and
    // there is no manual guard to reintroduce. An authenticated session with no permissions is
    // refused (403) before `AdminShell` (and its `NavShell` sidebar) ever mounts.
    alepha = Alepha.create().with(AlephaReact).with(AppRouter);
    await act(async () => {
      await alepha?.start();
    });

    await waitFor(() => {
      expect(document.body.textContent).not.toBe("");
    });

    // The sidebar is derived from `AdminRouter`'s `navPage` tree — none of its nav labels
    // (Users / Sessions / API keys / Audit log) may appear when the route was refused.
    expect(screen.queryByText("Users")).toBeNull();
    expect(screen.queryByText("Sessions")).toBeNull();
    expect(screen.queryByText("API keys")).toBeNull();
    expect(screen.queryByText("Audit log")).toBeNull();
  });
});
