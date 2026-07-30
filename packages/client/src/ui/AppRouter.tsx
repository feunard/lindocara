/**
 * The `$page` route tree — Alepha's router replacing the zustand `screen` machine (App.tsx). Only
 * `title`/`menu`/`credits`/`auth` are live; the remaining five fields exist now (per the plan's
 * Global Constraints route map) purely so `router.push("game")` etc. typecheck from the next task
 * onward — each renders a bare, textless marker div until its own task builds the real screen.
 *
 * The root `layout` carries the chrome App.tsx used to own directly: the boot ping (now
 * `ReactAuth.ping()` -> guest fallback -> /auth, replacing the old `fetchMe()`, `App.tsx:49-65`),
 * the launch-menu music effect and the LocaleToggle/StatusBar immersive toggle (`App.tsx:70-84`),
 * all now driven by the URL instead of `screen`. `TitleScreen`/`MainMenu`/`CreditsScreen` are
 * reused unmodified — they still call the store's deprecated `setScreen` shim (`store.ts`), which
 * now pushes through the navigation seam this layout installs below (`state/navigation.ts`) rather
 * than writing a `screen` field nobody reads anymore.
 *
 * Task 3 also adds the lore idiom's global 401 recovery: an `AppRouter`-class `$hook({ on:
 * "client:onError" })`, below, for anything that goes through Alepha's own `HttpClient`
 * (`ReactAuth`'s own calls today). See `state/navigation.ts`'s `onUnauthorized` docblock for why
 * this is only HALF of the seam — `api.ts`'s plain-`fetch` calls reach the same recovery closure
 * directly, since that event never fires for them.
 */

import { $hook, $inject, Alepha } from "alepha";
import { useAlepha } from "alepha/react";
import { ReactAuth } from "alepha/react/auth";
import { $page, NestedView, useRouter, useRouterState } from "alepha/react/router";
import { currentUserAtom } from "alepha/security";
import { HttpError } from "alepha/server";
import { useEffect, useRef } from "react";
import { menuAudio } from "../game/menu-audio.js";
import { continueAsGuest } from "../guest.js";
import { useLocale } from "../i18n.js";
import {
  activePartyAtom,
  adventureEditorSessionAtom,
  adventureTestSessionAtom,
  quickItemsAtom,
} from "../state/atoms.js";
import type { GameNavigation } from "../state/navigation.js";
import { onUnauthorized, setGameNavigation, setOnUnauthorized } from "../state/navigation.js";
import { AuthScreen } from "./AuthScreen.js";
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

/** A textless marker for a route whose real screen is a later task's job — see the file docblock. */
function RouteStub({ name }: { name: string }) {
  return <div data-route-stub={name} />;
}

function AppLayout() {
  useLocale();
  const alepha = useAlepha();
  const router = useRouter<AppRouter>();
  const { url } = useRouterState();
  const pathname = url.pathname;
  const booted = useRef(false);

  // The boot ping. App.tsx ran this once per app mount and always landed on "title" (its own
  // initial `screen` was a blank "boot" state); the router already resolved the right page from
  // the URL, so this effect only needs to authenticate and handle total failure — forcing a
  // navigation on success would fight a real deep link (or this component's own test).
  //
  // `ReactAuth.ping()` replaces the old `fetchMe()`: AlephaReact does not auto-ping on browser
  // start (there is no such hook under `alepha/react/auth` — only `ReactAuthProvider`'s SSR-only
  // `react:server:render:begin` hydration, which never runs for this `ssr: false` root layout), so
  // this effect is the one place that does it. `ping()` fills `currentUserAtom` itself as a side
  // effect when a session cookie resolves to a user; nothing else here needs to touch the atom
  // directly for that branch. Anonymous falls back to the SAME plain-fetch guest flow as before
  // (`guest.ts`, unchanged — it has no Alepha instance to reach, see its own docblock), then an
  // explicit re-`ping()` syncs the atom the guest login itself never touches (chosen over a second
  // `ReactAuth.login()` call: `continueAsGuest()` already authenticated the cookie, so a second
  // login would just be a redundant round trip to learn what `ping()` can read directly).
  //
  // Skipped entirely when the FIRST-resolved `pathname` is `/auth`: landing there already means
  // "let the human decide" (a 401 redirect, or a direct deep link) — silently signing the visitor
  // in as a fresh guest behind their back would both surprise them and race the auth form's own
  // login/register/guest actions, which drive the exact same `continueAsGuest()`/`ping()` calls.
  // See the `booted` guard inside for why this is a one-shot decision, not "keep checking until
  // we're off /auth".
  useEffect(() => {
    // `booted` is consulted (and flipped) AT MOST ONCE — not "once we finally see a non-/auth
    // pathname". A route change later in the session (successful login pushing to /menu, a
    // deep-linked reload elsewhere) must never come back and retroactively run the automatic
    // ping/guest flow: if the FIRST consultation lands on /auth, the boot effect skips itself
    // permanently for this mount and the auth form owns authentication start to finish. Getting
    // this wrong is a real bug, not just test noise — a deferred boot run firing AFTER a
    // successful login (because the form's own `ping()`/`login()` call raced this effect's first,
    // still-/auth render) would `router.push("auth")` on ITS OWN failure and silently undo a login
    // that had already succeeded.
    if (booted.current) return;
    booted.current = true;
    if (pathname === "/auth") return;
    const auth = alepha.inject(ReactAuth);
    void (async () => {
      const user = await auth.ping().catch(() => undefined);
      if (user) return;
      try {
        await continueAsGuest();
        await auth.ping();
      } catch {
        await router.push("auth");
      }
    })();
  }, [alepha, router, pathname]);

  useEffect(() => {
    if (LAUNCH_MENU_PATHS.has(pathname)) menuAudio.startMusic();
    else menuAudio.stopMusic();
  }, [pathname]);

  // Installs the navigation seam (`state/navigation.ts`) `game/session.ts` and the store's
  // deprecated editor-facing shims (`setScreen`, `setAdventureEditorSession`,
  // `setAdventureTestSession`) route through — the ONE place in the app that actually closes over
  // both `router.push` and `alepha.store.set/get`, since neither `game/**` nor the zustand store
  // itself may import `alepha`/`alepha/react` (see the repo AGENTS.md and `state/navigation.ts`'s
  // docblock). Also installs the sibling 401 seam (`onUnauthorized`/`setOnUnauthorized`): the ONE
  // place "clear the auth atom, go to /auth" is implemented, called both by this class's own
  // `client:onError` $hook below and by `api.ts`'s plain-`fetch` 401 path. Both seams are cleared on
  // unmount so neither survives into the next mount (a fresh test, or a future hot reload).
  useEffect(() => {
    const nav: GameNavigation = {
      toGame: () => void router.push("game"),
      toMenu: () => void router.push("menu"),
      toAuth: () => void router.push("auth"),
      setActiveParty: (party) => alepha.store.set(activePartyAtom, party),
      getActiveParty: () => alepha.store.get(activePartyAtom),
      setAdventureTestSession: (session) => alepha.store.set(adventureTestSessionAtom, session),
      getAdventureTestSession: () => alepha.store.get(adventureTestSessionAtom),
      getQuickItems: () => alepha.store.get(quickItemsAtom),
      logout: () => alepha.inject(ReactAuth).logout(),
      setAdventureEditorSession: (session) => alepha.store.set(adventureEditorSessionAtom, session),
      push: (routeName) => void router.push(routeName),
    };
    setGameNavigation(nav);
    setOnUnauthorized(() => {
      if (router.state.url.pathname === router.path("auth")) return;
      alepha.store.set(currentUserAtom, undefined);
      void router.push("auth");
    });
    return () => {
      setGameNavigation(null);
      setOnUnauthorized(null);
    };
  }, [alepha, router]);

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
  alepha = $inject(Alepha);
  // Eagerly injected (rather than only reached later via `useAlepha().inject(ReactAuth)` in
  // `AppLayout`/`AuthScreen`) so `ReactAuth`'s own module — and this class's OWN `$hook` field
  // below — get registered on the event bus DURING boot, before Alepha's container locks (`ready`
  // fires, then React mounts and the container refuses to register anything new). Mirrors lore's
  // own `AppRouter` (`auth = $inject(ReactAuth)`) — see the Task 3 report for the recon that ruled
  // out registering `AlephaReactAuth` explicitly in `main.browser.ts` instead. Named `reactAuth`,
  // not `auth`: the route map below already claims that field name for the `/auth` `$page`.
  reactAuth = $inject(ReactAuth);

  /**
   * The lore idiom (`AppRouter.ts:133-150` there): global 401 recovery for every request that goes
   * through Alepha's own `HttpClient`. `api.ts`'s plain-`fetch` calls never raise this event (see
   * `state/navigation.ts`'s `onUnauthorized` docblock) — they call the SAME seam directly instead,
   * so recovery has exactly one implementation (`AppLayout`'s installed closure, above) regardless
   * of which fetch mechanism noticed the 401.
   */
  onUnauthorizedFetch = $hook({
    on: "client:onError",
    handler: async ({ error }) => {
      if (this.alepha.isBrowser() && HttpError.is(error, 401)) {
        onUnauthorized();
      }
    },
  });

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

  auth = $page({ path: "/auth", component: AuthScreen });

  // Stubs — later tasks replace `component` with the real screen. Field names are the typed
  // `push()`/`path()` keys (the plan's Global Constraints route map); do not rename them.
  playContinue = $page({
    path: "/play/continue",
    component: () => <RouteStub name="playContinue" />,
  });
  playNew = $page({ path: "/play/new", component: () => <RouteStub name="playNew" /> });
  playJoin = $page({ path: "/play/join", component: () => <RouteStub name="playJoin" /> });
  game = $page({ path: "/game", component: () => <RouteStub name="game" /> });
  editor = $page({ path: "/editor", component: () => <RouteStub name="editor" /> });
}
