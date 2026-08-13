import { setLocale, t } from "@lindocara/client/i18n.js";
import type { GameNavigation } from "@lindocara/client/state/navigation.js";
import { setGameNavigation } from "@lindocara/client/state/navigation.js";
import { AppRouter } from "@lindocara/client/ui/AppRouter.js";
import { screen, waitFor } from "@testing-library/dom";
import userEvent from "@testing-library/user-event";
import { Alepha } from "alepha";
import { AlephaReact } from "alepha/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Task 3 (`.superpowers/sdd/2026-08-11-admin-console-and-logout/task-3-brief.md`): QUIT now signs
 * the player out through the navigation seam (`getGameNavigation()?.logout()`), and Escape/gamepad
 * B — which shares `<MenuNav onBack>` with QUIT today — must keep doing exactly what it always did
 * (`router.push("title")`), never logout. These tests boot the real `AppRouter` the same way
 * `auth-screen.test.tsx`/`launch-screens.test.tsx` do (landing directly on `/menu` via
 * `history.pushState` before `alepha.start()`), then install a plain fake `GameNavigation` by
 * reassignment AFTER the layout's own mount effect has installed the real one — the documented test
 * path (`state/navigation.ts`'s docblock) that keeps this covered without `vi.mock`.
 */

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Stubs the boot ping (`GET /_auth/userinfo`) with a signed-in user carrying the given permissions,
 * and MainMenu's own "has saves" probe (`GET /api/parties`) with an empty list. A real, resolved
 * user is what lets `AppRouter.bootPing` skip its guest-registration fallback entirely (`if (user)
 * return;`), so no `/api/users/register*` stub is needed here.
 */
function stubBoot(permissions: string[] = []): void {
  const mock = vi.fn((input: RequestInfo | URL) => {
    const path = String(input);
    if (path.startsWith("/_auth/userinfo")) {
      return Promise.resolve(
        jsonResponse(200, {
          user: { id: "acc-1", username: "nico" },
          api: { actions: {}, permissions },
        }),
      );
    }
    if (path.startsWith("/api/parties")) {
      return Promise.resolve(jsonResponse(200, []));
    }
    throw new Error(`main-menu.test.tsx: unexpected fetch ${path}`);
  });
  vi.stubGlobal("fetch", mock);
}

/** A plain, non-Alepha fake — `setGameNavigation` never requires a real Alepha instance (see the
 *  module's docblock). Mirrors `store.test.tsx`/`game-launch-abort.test.tsx`'s own fakes. */
function installFakeNavigation(overrides: Partial<GameNavigation> = {}): GameNavigation {
  const nav: GameNavigation = {
    toGame: vi.fn(),
    toMenu: vi.fn(),
    toAuth: vi.fn(),
    toEditor: vi.fn(),
    setActiveParty: vi.fn(),
    getActiveParty: () => null,
    setAdventureTestSession: vi.fn(),
    getAdventureTestSession: () => null,
    getQuickItems: () => [null, null, null],
    logout: vi.fn(),
    ...overrides,
  };
  setGameNavigation(nav);
  return nav;
}

let alepha: Alepha | undefined;

async function renderMainMenu(permissions: string[] = []): Promise<void> {
  stubBoot(permissions);
  document.title = "";
  document.head.innerHTML = "";
  document.body.innerHTML = '<div id="root"></div>';
  // Land directly on `/menu`, BEFORE `alepha.start()` — the same technique `auth-screen.test.tsx`
  // uses for `/auth` — so the router's first transition resolves to MainMenu straight away.
  history.pushState({}, "", "/menu");
  alepha = Alepha.create().with(AlephaReact).with(AppRouter);
  await act(async () => {
    await alepha?.start();
  });
  await waitFor(() => expect(document.querySelector(".main-menu")).toBeTruthy());
}

describe("MainMenu", () => {
  beforeEach(() => setLocale("en"));

  afterEach(async () => {
    setGameNavigation(null);
    await alepha?.stop();
    alepha = undefined;
    // The backdrop toggle persists through `backdropVersionAtom` — don't leak a v2 choice
    // (or any other persisted atom) into the next test's boot.
    localStorage.clear();
  });

  it("logs out when QUIT is activated", async () => {
    await renderMainMenu();
    const nav = installFakeNavigation();
    await userEvent.click(screen.getByRole("button", { name: /quit/i }));
    expect(nav.logout).toHaveBeenCalledTimes(1);
  });

  it("does NOT log out when Escape is pressed", async () => {
    // onBack and QUIT are the same harmless action today, and the hints row used to label Escape
    // "Quit". Fusing them once QUIT logs out means a stray Escape on the main menu signs the
    // player out — this is exactly the regression the ruling in the brief guards against.
    await renderMainMenu();
    const nav = installFakeNavigation();
    await userEvent.keyboard("{Escape}");
    expect(nav.logout).not.toHaveBeenCalled();
  });

  it("labels the Escape/B hint as Back, not Quit", async () => {
    await renderMainMenu();
    const hints = document.querySelector(".menu-hints");
    expect(hints?.textContent).toContain(t("menu.hint.back"));
    expect(hints?.textContent).not.toContain(t("menu.quit"));
    // The QUIT button itself keeps its own label — only the hint moved.
    expect(screen.getByRole("button", { name: /quit/i })).toBeInTheDocument();
  });

  it("shows the admin corner button for an admin session", async () => {
    await renderMainMenu(["admin:ui"]);
    const admin = screen.getByRole("button", { name: t("menu.admin") });
    expect(admin).toBeInTheDocument();
  });

  it("hides the admin corner button for a non-admin session", async () => {
    await renderMainMenu([]);
    expect(screen.queryByRole("button", { name: t("menu.admin") })).not.toBeInTheDocument();
  });

  it("toggles the living backdrop and persists the choice", async () => {
    await renderMainMenu();
    // v1 by default: the Tiny Swords diorama, with a corner button offering V2.
    expect(document.querySelector(".menu-scene")).toBeTruthy();
    expect(document.querySelector(".launch-backdrop")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: t("menu.backdrop.v2") }));
    expect(document.querySelector(".launch-backdrop")).toBeTruthy();
    expect(document.querySelector(".menu-scene")).toBeNull();
    expect(localStorage.getItem("lindocara.backdropVersion")).toBe(JSON.stringify("v2"));

    // The same button now offers the way back.
    await userEvent.click(screen.getByRole("button", { name: t("menu.backdrop.v1") }));
    expect(document.querySelector(".menu-scene")).toBeTruthy();
    expect(document.querySelector(".launch-backdrop")).toBeNull();
    expect(localStorage.getItem("lindocara.backdropVersion")).toBe(JSON.stringify("v1"));
  });

  it("boots straight into the v2 backdrop when the choice was persisted", async () => {
    localStorage.setItem("lindocara.backdropVersion", JSON.stringify("v2"));
    await renderMainMenu();
    expect(document.querySelector(".launch-backdrop")).toBeTruthy();
    expect(screen.getByRole("button", { name: t("menu.backdrop.v1") })).toBeInTheDocument();
  });

  it("hides the Credits entry on v2 and restores it on v1", async () => {
    await renderMainMenu();
    expect(screen.getByRole("button", { name: /credits/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: t("menu.backdrop.v2") }));
    expect(screen.queryByRole("button", { name: /credits/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: t("menu.backdrop.v1") }));
    expect(screen.getByRole("button", { name: /credits/i })).toBeInTheDocument();
  });
});
