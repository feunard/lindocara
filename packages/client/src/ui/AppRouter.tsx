/**
 * The `$page` route tree — Alepha's router that replaced the old zustand `screen` machine
 * (`App.tsx`, formerly `ui/LegacyShell.tsx`, the frozen rollback-only counterpart to this file
 * until the legacy retirement tranche deleted it entirely). Every route is live now:
 * `title`/`menu`/`credits`/`auth`, the three launch
 * carousels (`playContinue`/`playNew`/`playJoin`, each with a loader — see that field group's own
 * docblock below), `game` (Task 5) and `editor`. `editor` was a lazy-loaded route rendering the real
 * `@lindocara/editor` shell; since S3 retired the PixiJS render path it lazy-loads the rebuilt
 * notice instead, because that package no longer compiles. Its own field docblock has the whole
 * story and the exact code to restore.
 *
 * The root `layout` carries the chrome the old `App.tsx` used to own directly: the boot ping (now
 * `ReactAuth.ping()` -> guest fallback -> /auth, replacing the old `fetchMe()`), the launch-menu music effect and the
 * LocaleToggle/StatusBar immersive toggle, all now driven by the URL instead of `screen`.
 * `TitleScreen`/`MainMenu`/`CreditsScreen` push through `useRouter()` directly (Task 6) — the
 * store's `setScreen`/`screen` machine is fully dead, both as a store field (removed Task 2) and
 * as the deprecated shim that routed through this layout's installed navigation seam (removed
 * Task 6 alongside the editor package's own migration off it).
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
import { $page, NestedView, Redirection, useRouter, useRouterState } from "alepha/react/router";
import { currentUserAtom } from "alepha/security";
import { HttpError } from "alepha/server";
import { useEffect, useRef } from "react";
import { menuAudio } from "../game/menu-audio.js";
import { stopActiveGameSession } from "../game/session.js";
import { continueAsGuest } from "../guest.js";
import { useLocale } from "../i18n.js";
import { activePartyAtom, adventureTestSessionAtom, quickItemsAtom } from "../state/atoms.js";
import type { GameNavigation } from "../state/navigation.js";
import { onUnauthorized, setGameNavigation, setOnUnauthorized } from "../state/navigation.js";
import { useUiStore } from "../store.js";
import { AdventureTestOverlay } from "./AdventureTestOverlay.js";
import { AuthScreen } from "./AuthScreen.js";
import { Chat } from "./Chat.js";
import { ConnectionOverlay } from "./ConnectionOverlay.js";
import { CreditsScreen } from "./CreditsScreen.js";
import { EventLog } from "./EventLog.js";
import { HelpBar } from "./HelpBar.js";
import { EventDialoguePanel } from "./hud/EventDialoguePanel.js";
import { Hud } from "./hud/Hud.js";
import { Minimap } from "./hud/Minimap.js";
import { QuestDialoguePanel } from "./hud/QuestDialoguePanel.js";
import { InteriorOverlay } from "./InteriorOverlay.js";
import { InventoryOverlay } from "./InventoryOverlay.js";
import {
  ContinueScreen,
  JoinScreen,
  loadMyParties,
  loadOpenParties,
  loadPlayableAdventures,
  NewGameScreen,
} from "./LaunchScreens.js";
import { LocaleToggle } from "./LocaleToggle.js";
import { MainMenu } from "./MainMenu.js";
import { MerchantOverlay } from "./MerchantOverlay.js";
import { MobileControls } from "./MobileControls.js";
import { Prompt } from "./Prompt.js";
import { QuestJournalOverlay } from "./QuestJournalOverlay.js";
import { SettingsMenu } from "./SettingsMenu.js";
import { StatusBar } from "./StatusBar.js";
import { TalentTree } from "./TalentTree.js";
import { TitleScreen } from "./TitleScreen.js";
import { VictoryOverlay } from "./VictoryOverlay.js";
import { WorldMap } from "./WorldMap.js";

/**
 * Paths where the game-chrome LocaleToggle/StatusBar hide — the pre-router `immersive` set ported
 * verbatim from what was `App.tsx:77-84`. Kept as pathnames
 * rather than page names: pathname is what the layout's `useRouterState()` naturally exposes, and
 * every route below is still flat (no params).
 *
 * `/game` is DELIBERATELY absent, matching the pre-router set: that floating locale chip/status
 * pill are anchored bottom-right precisely so they stay visible during actual gameplay (see the
 * comment that used to sit next to this toggle in `App.tsx`, before Task 1 folded it into this
 * set) — only `/editor`'s dense, full-viewport chrome and the non-game menu/launch screens hide
 * them. The plan's own Task 5 interface note ("derives from the active route (game + editor)")
 * reads as if `/game` should join this set too; that is a plan-text bug against the verified
 * pre-migration behaviour (`git show 61836eb:packages/client/src/ui/App.tsx`, `immersive` never
 * included `"game"`), not a deviation this task introduces — see the Task 5 report.
 */
const IMMERSIVE_PATHS = new Set<string>([
  "/",
  "/menu",
  "/credits",
  "/play/continue",
  "/play/new",
  "/play/join",
  "/editor",
]);

/**
 * The in-game React tree (Task 5) — every component the old zustand-screen-machine shell (`App.tsx`,
 * formerly `LegacyShell.tsx`, now deleted) rendered under `screen === "game"` before Task 2 dropped
 * that branch. Every one of these already
 * reads the untouched zustand bridge (`store.ts`'s `self`/`selfState`/`party`/overlay
 * flags/`GameHandle`, per the plan's measured line) or a Task 2 atom directly
 * (`AdventureTestOverlay`/`Hud` read `adventureTestSessionAtom`) — nothing here changes what they
 * read, only where they mount. `SettingsMenu` is NOT repeated here: `AppLayout` above already
 * renders exactly one instance for the whole app, toggling `inGame` from the pathname.
 */
function GameScreen() {
  return (
    <div className="game-ui" data-ui-skin="tiny-swords">
      <Hud />
      <Minimap />
      <Chat />
      <EventLog />
      <Prompt />
      <HelpBar />
      <InteriorOverlay />
      <InventoryOverlay />
      <MerchantOverlay />
      <EventDialoguePanel />
      <QuestDialoguePanel />
      <QuestJournalOverlay />
      <WorldMap />
      <TalentTree />
      <MobileControls />
      <ConnectionOverlay />
      <VictoryOverlay />
      <AdventureTestOverlay />
    </div>
  );
}

/** Paths where the launch-menu music bed plays (was `App.tsx:71-72`). */
const LAUNCH_MENU_PATHS = new Set<string>(["/menu", "/play/continue", "/play/new", "/play/join"]);

/**
 * Run a launch carousel's fetch where it can actually succeed — the browser — and report `null`
 * ("not loaded") anywhere else, including when the fetch fails. Never `[]`: an empty array is a
 * real answer the screen renders as "nothing here", and conflating it with a failure is precisely
 * the bug this replaced. See the launch loaders' docblock below for the whole story.
 */
const launchList = async <T,>(load: () => Promise<T[]>): Promise<T[] | null> =>
  typeof window === "undefined" ? null : load().catch(() => null);

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

  // Installs the navigation seam (`state/navigation.ts`) `game/session.ts` routes through — the ONE
  // place in the app that actually closes over both `router.push` and `alepha.store.set/get`, since
  // `game/**` may not import `alepha`/`alepha/react` (see the repo AGENTS.md and
  // `state/navigation.ts`'s docblock). Task 6 removed the store's deprecated `setScreen`/
  // `setAdventureEditorSession` shims that used to route through this same seam — every former
  // caller (the editor package, `TitleScreen`/`MainMenu`/`CreditsScreen`) now reaches `useRouter()`/
  // `useStore(adventureEditorSessionAtom)` directly instead. Also installs the sibling 401 seam
  // (`onUnauthorized`/`setOnUnauthorized`): the ONE place "clear the auth atom, go to /auth" is
  // implemented, called both by this class's own `client:onError` $hook below and by `api.ts`'s
  // plain-`fetch` 401 path. Both seams are cleared on unmount so neither survives into the next
  // mount (a fresh test, or a future hot reload).
  useEffect(() => {
    const nav: GameNavigation = {
      toGame: () => void router.push("game"),
      toMenu: () => void router.push("menu"),
      toAuth: () => void router.push("auth"),
      toEditor: () => void router.push("editor"),
      setActiveParty: (party) => alepha.store.set(activePartyAtom, party),
      getActiveParty: () => alepha.store.get(activePartyAtom),
      setAdventureTestSession: (session) => alepha.store.set(adventureTestSessionAtom, session),
      getAdventureTestSession: () => alepha.store.get(adventureTestSessionAtom),
      getQuickItems: () => alepha.store.get(quickItemsAtom),
      logout: () => alepha.inject(ReactAuth).logout(),
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

  // Browser BACK out of `/game` is not a sanctioned exit: the router re-renders (`GameScreen`
  // unmounts, dropping the HUD/overlays), but nothing tells the live socket/renderer/window input
  // listeners to stop — WASD still drives the hero underneath the menu. Every SANCTIONED path away
  // from `/game` (a natural disconnect, a launch failure, the editor test overlay's "Exit" button)
  // already runs through `game/session.ts`'s `returnFromGameSession()`, which clears `store.game`
  // SYNCHRONOUSLY before it ever calls `nav.toMenu()`/`toEditor()` — so by the time THIS effect
  // observes the resulting `pathname` change, `store.game` is already null for every one of those,
  // and this effect is a no-op for them. The only way to reach here with `store.game` still set and
  // `pathname !== "/game"` is the browser having moved history out from under the router directly
  // (`popstate`), which is exactly the leak this effect closes. Reads `useUiStore.getState()`
  // directly (not `useStore`) — the game bridge deliberately stays off React re-renders for anything
  // written this often, see `store.ts`'s own docblock.
  //
  // `heroLoading` is checked too, not just `game`: `startGameIdentity` (`game/session.ts`) sets
  // `heroLoading` synchronously before its one `await` (`Hd2dRenderer.create()`) and only installs
  // `game` after that await resolves — a BACK landing in THAT window would otherwise be invisible to
  // this effect (`game` still null) and the launch would finish unattended, installing an orphaned
  // live session under the menu a moment later. `stopActiveGameSession()` bumps the module-level
  // launch id unconditionally (see its own docblock), which is exactly what `startGameIdentity`
  // rechecks right after that await — stale, it tears down what it built (the renderer) and returns
  // without ever installing `game`. See `game/session.ts`'s launch-id recheck and
  // `game-launch-abort.test.tsx` for that half; this effect only has to widen its trigger.
  //
  // `{ navigate: false }` matters: `stopActiveGameSession()` normally re-navigates through the SAME
  // seam it's using here — calling that unconditionally would `router.push()` a SECOND time to
  // wherever the browser already put us (duplicating that history entry), or, if a deeper BACK
  // skipped past `/menu`/`/editor` entirely, forcibly override the destination the user actually
  // chose. See `returnFromGameSession`'s own docblock in `game/session.ts` for the full reasoning.
  useEffect(() => {
    if (pathname === "/game") return;
    const state = useUiStore.getState();
    if (!state.game && !state.heroLoading) return;
    stopActiveGameSession({ navigate: false });
  }, [pathname]);

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
    // Without these the shell served the framework's placeholder `<title>App</title>` and no icon
    // link at all, so every page load ended in a 404 on `/favicon.ico`. The asset itself has always
    // been there and has always been served — `packages/client/public/favicon.svg`, reachable at
    // `/favicon.svg` — but the framework's auto-detection looks in `<app root>/public`
    // (`ViteDevServerProvider.detectFavicon`), which is `apps/main/public`, a directory this repo
    // does not have. Declaring the link here keeps the asset where the rest of the client's public
    // files live instead of duplicating it into the app just to be found.
    head: {
      title: "Lindocara",
      link: [{ rel: "icon", type: "image/svg+xml", href: "/favicon.svg" }],
    },
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

  /**
   * The three launch carousels (Task 4). Each loader replaces the screen's old `useEffect` fetch —
   * data is ready before the component ever mounts, so `ContinueScreen`/`NewGameScreen`/
   * `JoinScreen` no longer carry a `loading` local state for their list. All three call `api.ts`'s
   * existing helpers (`fetchParties`/`fetchPlayableAdventures`) rather than a typed `$client<T>()`:
   * a type-only `import type { PartyController } from "@lindocara/server/api/controllers/
   * PartyController.js"` DOES compile cleanly under this package's `tsconfig.api.json` program (
   * verified — `PartyController`/`HeroController`/`AdventureController` all type-check with zero
   * errors), so this is a deliberate choice, not the documented compiler-failure fallback. Two
   * reasons: (1) `PartyController.getParties`/`HeroController.getHeroes` declare `response: z.any()`
   * (see those controllers' `schema`), so a `$client` call would type as `Promise<any>` anyway —
   * no typing win over `api.ts` for the two calls these loaders actually need; (2) `getParties`
   * answers ONE cursor page (`PartyListingPage`), and `fetchParties()` already walks every page and
   * unwraps it into a flat, tested `PartyListing[]` — reimplementing that pagination loop here would
   * duplicate already-covered logic for a return type that is `any` either way. `fetchPlayableAdventures`
   * -> `AdventureController.getAdventures` DOES have a real typed `z.array(adventureSummarySchema)`
   * response and would have been a clean `$client` candidate on its own, but mixing network paths
   * (Alepha's own `HttpClient` for one loader, `api.ts`'s plain `fetch` for the other two) for no
   * behavioural gain was not worth the inconsistency. See the Task 4 report for the compiler
   * evidence both ways.
   *
   * What that reasoning missed: a `$page` loader runs on the SERVER too, and `api.ts` is a plain
   * relative `fetch`. Node cannot even parse `/api/adventures?scope=play` into a URL, and the
   * loader context (`PageLoader`) carries no request, so there is no cookie to forward and no
   * origin to prepend — an SSR fetch could not be authenticated even if the URL were absolute.
   * `ssr: false` would not help either: the framework still runs the loader on the server to
   * serialize its result. The old `.catch(() => [])` then turned that failure into a perfectly
   * plausible EMPTY LIST, which is why a hard load of `/play/new` served "No playable adventure
   * yet" against a server full of them while client-side navigation to the same screen worked.
   *
   * So `launchList` below skips the fetch on the server rather than performing one that cannot
   * succeed, and reports `null` — "not loaded" — instead of `[]`. The screens treat `null` as
   * their cue to fetch on mount (`useLaunchList`, `ui/LaunchScreens.tsx`). The fast path is
   * unchanged: on a client-side navigation the data is still ready before the component mounts.
   */
  playContinue = $page({
    path: "/play/continue",
    component: ContinueScreen,
    loader: async () => ({ parties: await launchList(loadMyParties) }),
  });
  playNew = $page({
    path: "/play/new",
    component: NewGameScreen,
    loader: async () => ({ adventures: await launchList(loadPlayableAdventures) }),
  });
  playJoin = $page({
    path: "/play/join",
    component: JoinScreen,
    loader: async () => ({ parties: await launchList(loadOpenParties) }),
  });

  /**
   * A game session lives only in browser memory — the zustand bridge's `game` handle plus a live
   * WebSocket — and never survives a reload; the server never has one to begin with (every SSR
   * request starts a brand-new `useUiStore`, `store`/`state/atoms.ts`'s docblock). So this loader
   * makes exactly one check and it is correct in BOTH places it runs: a genuine reload, a typed
   * URL, or a bare deep link to `/game` reads `game`/`heroLoading` as null (on the server, always;
   * on a fresh client, always) and redirects to `/menu` BEFORE the game shell ever mounts — no
   * flash, since a loader-thrown `Redirection` is resolved ahead of rendering
   * (`$page.ts`'s sanctioned shape; server-side it becomes a real `Location` redirect,
   * `ReactServerProvider.ts`). A real launch (`game/session.ts`'s `launchGameIdentity`) reads
   * through clean: `nav.toGame()` fires first, but `router.push()` awaits two event-bus emits
   * before it ever reaches this loader (`ReactBrowserRouterProvider.transition`), and `startGameIdentity`
   * sets `heroLoading` synchronously in the very next line of the SAME calling script turn — so by
   * the time this loader's continuation resumes, `heroLoading` is already set. See the Task 5
   * report for the full ordering proof. `game` alone covers the reconnect window once the handle
   * exists (a network drop never clears it — only `endGame` does, which also navigates away).
   */
  game = $page({
    path: "/game",
    component: GameScreen,
    loader: async () => {
      const store = useUiStore.getState();
      if (!store.game && !store.heroLoading) {
        throw new Redirection("/menu");
      }
      return {};
    },
  });

  /**
   * The creator tools, lazy-loaded to keep the game shell independent of the editor package.
   *
   * `@lindocara/editor`'s stage (`game/map-editor-stage.ts`, `game/map-preview.ts`) is built on
   * `renderer.ts`, `stage-application.ts`, `catalog-element-render.ts` and `editor-asset-art.ts`,
   * all of which that increment deleted. The spec chose a deliberate break over keeping a second
   * render path alive for the editor's sake, so the package no longer compiles and is excluded from
   * the verify pipeline (see the root `package.json` and `vitest.config.ts`). This route renders a
   * plain message instead of `import()`ing a module that would throw at load; it is restored, as a
   * lazy import of the real shell, by the S3 piece that rebuilds the editor on `@lindocara/hd2d`.
   *
   * What it looked like, and must look like again:
   *
   * ```ts
   * lazy: async () => {
   *   const module = await import("@lindocara/editor/ui/editor/AdventureEditorScreen.js");
   *   return { default: module.AdventureEditorScreen };
   * }
   * ```
   *
   * That was the ONE undeclared cross-package edge in the whole app —
   * `packages/client/package.json` deliberately does NOT depend on `@lindocara/editor` (see the root
   * AGENTS.md), and `$page`'s `lazy` contract is `() => Promise<{ default: FC }>` while
   * `AdventureEditorScreen` is a named export, which is what the reshaping `.then()` was for. Keep
   * both properties when restoring it.
   */
  editor = $page({
    path: "/editor",
    lazy: async () => {
      const module = await import("@lindocara/editor/ui/editor/AdventureEditorScreen.js");
      return { default: module.AdventureEditorScreen };
    },
  });
}
