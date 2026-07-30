/**
 * The `$page` route tree — Alepha's router replacing the zustand `screen` machine (App.tsx). Only
 * `title`/`menu`/`credits` are live; the other six fields exist now (per the plan's Global
 * Constraints route map) purely so `router.push("game")` etc. typecheck from the next task
 * onward — each renders a bare, textless marker div until its own task builds the real screen.
 *
 * The root `layout` carries the chrome App.tsx used to own directly: the boot ping (fetchMe ->
 * guest fallback -> /auth, `App.tsx:49-65`), the launch-menu music effect and the
 * LocaleToggle/StatusBar immersive toggle (`App.tsx:70-84`), all now driven by the URL instead of
 * `screen`. `TitleScreen`/`MainMenu`/`CreditsScreen` are reused unmodified — they still call the
 * store's `setScreen`, which is now a write nobody reads; wiring their navigation through the
 * router is the session/atoms seam a later task builds (see the task brief).
 */

import { $page, NestedView, useRouter, useRouterState } from "alepha/react/router";
import { useEffect } from "react";
import { fetchMe } from "../api.js";
import { menuAudio } from "../game/menu-audio.js";
import { continueAsGuest } from "../guest.js";
import { useLocale } from "../i18n.js";
import { type UiScreen, useUiStore } from "../store.js";
import { CreditsScreen } from "./CreditsScreen.js";
import { LocaleToggle } from "./LocaleToggle.js";
import { MainMenu } from "./MainMenu.js";
import { SettingsMenu } from "./SettingsMenu.js";
import { StatusBar } from "./StatusBar.js";
import { TitleScreen } from "./TitleScreen.js";

/** Paths where the game-chrome LocaleToggle/StatusBar hide (`App.tsx:77-84`'s `immersive` set,
 *  ported verbatim). Kept as pathnames rather than page names: pathname is what the layout's
 *  `useRouterState()` naturally exposes, and every route below is still flat (no params). */
const IMMERSIVE_PATHS = new Set<string>([
  "/",
  "/menu",
  "/credits",
  "/play/continue",
  "/play/new",
  "/play/join",
  "/editor",
]);

/** Paths where the launch-menu music bed plays (`App.tsx:71-72`). */
const LAUNCH_MENU_PATHS = new Set<string>(["/menu", "/play/continue", "/play/new", "/play/join"]);

/**
 * @deprecated Task 2 removes this bridge along with the screen field.
 *
 * `screen` -> `{ name, path }` for the temporary screen-to-router bridge below. `name` is the
 * `$page` field to push by (the typed `push()` key); `path` is what that route resolves to, kept
 * alongside it so the bridge's effect can compare against `useRouterState()`'s pathname without a
 * second lookup. "boot" has no entry: it is the store's blank initial state, never a real
 * destination, and must not push anywhere.
 */
const SCREEN_TO_ROUTE: Partial<Record<UiScreen, { name: string; path: string }>> = {
  title: { name: "title", path: "/" },
  menu: { name: "menu", path: "/menu" },
  auth: { name: "auth", path: "/auth" },
  new: { name: "playNew", path: "/play/new" },
  continue: { name: "playContinue", path: "/play/continue" },
  join: { name: "playJoin", path: "/play/join" },
  credits: { name: "credits", path: "/credits" },
  game: { name: "game", path: "/game" },
  "adventure-editor": { name: "editor", path: "/editor" },
};

/** A textless marker for a route whose real screen is a later task's job — see the file docblock. */
function RouteStub({ name }: { name: string }) {
  return <div data-route-stub={name} />;
}

function AppLayout() {
  useLocale();
  const setAccountId = useUiStore((s) => s.setAccountId);
  const screen = useUiStore((s) => s.screen);
  const router = useRouter<AppRouter>();
  const { url } = useRouterState();
  const pathname = url.pathname;

  // The boot ping. App.tsx ran this once per app mount and always landed on "title" (its own
  // initial `screen` was a blank "boot" state); the router already resolved the right page from
  // the URL, so this effect only needs to authenticate and handle total failure — forcing a
  // navigation on success would fight a real deep link (or this component's own test). Task 3
  // replaces `fetchMe`/`continueAsGuest` with `useAuth()`.
  useEffect(() => {
    void (async () => {
      const me = await fetchMe();
      if (me) {
        setAccountId(me.id);
        return;
      }
      try {
        const guest = await continueAsGuest();
        setAccountId(guest.id);
      } catch {
        await router.push("auth");
      }
    })();
  }, [router, setAccountId]);

  useEffect(() => {
    if (LAUNCH_MENU_PATHS.has(pathname)) menuAudio.startMusic();
    else menuAudio.stopMusic();
  }, [pathname]);

  /**
   * @deprecated Task 2 removes this bridge along with the screen field.
   *
   * Temporary compatibility bridge so main stays clickable while the migration is in flight.
   * `TitleScreen`/`MainMenu`/`CreditsScreen`/`LaunchScreens`/`AuthScreen`/`AdventureTestOverlay`
   * are all reused unmodified per the Task 1 brief and still call the zustand store's `setScreen`
   * — without this, that write would go nowhere (nothing reads `screen` once `App.tsx` isn't
   * mounted), so pressing Start or any menu button would silently do nothing. This subscribes to
   * `screen` (via the ordinary selector — reactive, no manual `useUiStore.subscribe`) and forwards
   * each write onto the router through `SCREEN_TO_ROUTE`.
   *
   * One-way only: `screen` -> router. Nothing pushes back from the router onto `screen`, so there
   * is no bridge-vs-bridge loop — the `route.path === pathname` guard below exists only to skip a
   * redundant `push()` when `screen` changes to a value that already matches the current route
   * (e.g. a direct `/menu` load, where `screen` is later set to `"menu"` by nothing in particular
   * but would otherwise still fire a no-op navigation).
   */
  useEffect(() => {
    const route = SCREEN_TO_ROUTE[screen];
    if (!route) return; // "boot" — the store's blank initial state, never a real destination.
    if (route.path === pathname) return;
    void router.push(route.name);
  }, [screen, pathname, router]);

  const immersive = IMMERSIVE_PATHS.has(pathname);

  return (
    <>
      {!immersive && <LocaleToggle />}
      {!immersive && <StatusBar />}
      <NestedView />
      <SettingsMenu inGame={pathname === "/game"} />
    </>
  );
}

export class AppRouter {
  layout = $page({
    ssr: false,
    component: AppLayout,
    children: () => [
      this.title,
      this.menu,
      this.credits,
      this.auth,
      this.playContinue,
      this.playNew,
      this.playJoin,
      this.game,
      this.editor,
    ],
  });

  title = $page({ path: "/", component: TitleScreen });
  menu = $page({ path: "/menu", component: MainMenu });
  credits = $page({ path: "/credits", component: CreditsScreen });

  // Stubs — later tasks replace `component` with the real screen. Field names are the typed
  // `push()`/`path()` keys (the plan's Global Constraints route map); do not rename them.
  auth = $page({ path: "/auth", component: () => <RouteStub name="auth" /> });
  playContinue = $page({
    path: "/play/continue",
    component: () => <RouteStub name="playContinue" />,
  });
  playNew = $page({ path: "/play/new", component: () => <RouteStub name="playNew" /> });
  playJoin = $page({ path: "/play/join", component: () => <RouteStub name="playJoin" /> });
  game = $page({ path: "/game", component: () => <RouteStub name="game" /> });
  editor = $page({ path: "/editor", component: () => <RouteStub name="editor" /> });
}
