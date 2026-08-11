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
 * The root `layout` carries the chrome the old `App.tsx` used to own directly: the launch-menu
 * music effect and the LocaleToggle/StatusBar immersive toggle, both now driven by the URL instead
 * of `screen`. The boot ping (`ReactAuth.ping()` -> guest fallback -> /auth, replacing the old
 * `fetchMe()`) is NOT part of this layout's render — it is `AppRouter`'s own `bootPing` `$hook({
 * on: "start" })`, below, which must fully resolve before the router's first route transition
 * evaluates any `$secure` guard on the initial URL. See that field's own docblock for why a React
 * effect could not do this safely.
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
import { I18nProvider } from "alepha/react/i18n";
import { $page, NestedView, Redirection, useRouter, useRouterState } from "alepha/react/router";
import { currentUserAtom } from "alepha/security";
import { HttpError } from "alepha/server";
import { useEffect } from "react";
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
import { AdminRouter } from "./admin/AdminRouter.js";
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
 *
 * `/admin` isn't a member of this exact-match `Set` because its subtree has nested paths
 * (`/admin/users`, `/admin/users/:id`, ...) that a `Set.has()` lookup can never match — see the
 * `pathname.startsWith("/admin")` check folded into `immersive` below instead. Same dense,
 * full-viewport reasoning as `/editor`: `AdminShell`'s own `@alepha/ui` `NavShell` sidebar/topbar
 * is the surface's real chrome, and the floating Tiny Swords `LocaleToggle`/`StatusBar` would
 * otherwise render on top of it.
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
 * How long `AppRouter.bootPing` waits for the FIRST `ping()` before letting the app mount anyway.
 * Alepha's `HttpClient` has no timeout or `AbortSignal` support of its own, so without this bound
 * a hanging (not merely failing) `/_auth/userinfo` would hang the `"start"` lifecycle phase
 * forever — and a `"start"` hook that never resolves means the whole app never reaches `"ready"`,
 * i.e. never mounts React at all. Kept short deliberately: this is the one thing every route pays
 * for (see `bootPing`'s own docblock), and a slow/dead auth endpoint should degrade to "renders
 * anonymous, the real session attaches late in the background" rather than "blank page for N
 * seconds then blank page forever."
 */
const BOOT_PING_TIMEOUT_MS = 2500;

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

  // The boot ping used to live here, in a `useEffect`. It now runs from `AppRouter`'s own
  // `bootPing` `$hook({ on: "start" })` instead — see that field's docblock for why: a React
  // effect runs after first paint, which is after the router's OWN first route transition already
  // evaluated any `$secure` guard on the initial URL. `$secure` reads `currentUserAtom`
  // synchronously and denies outright when it is still empty, so a guarded route hit cold (a
  // bookmark, a typed URL, a refresh) saw "Authentication required" instead of the panel — even
  // for a real admin — regardless of how quickly `ping()` would otherwise have resolved. Moving the
  // ping into a lifecycle hook that is fully awaited before `ReactBrowserProvider`'s own `ready`
  // hook performs that first transition removes the race instead of racing it.

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

  const immersive = IMMERSIVE_PATHS.has(pathname) || pathname.startsWith("/admin");

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
   * The `/admin` route subtree, owned by a separate class (`AdminRouter.tsx`) rather than declared
   * inline here — its own docblock explains why (the "pages from an injected router in another
   * package" shape `PagePrimitiveOptions.children` documents). Eagerly injected, like `reactAuth`
   * above: `AdminRouter`'s field initializers are what register its six `$page`s with
   * `ReactPageService`, and that must happen during boot, before Alepha's container locks — not
   * only if/when something else happens to inject `AdminRouter` first.
   */
  adminRouter = $inject(AdminRouter);

  /**
   * Found while fixing the cold-load race below (Task 2, fix round 1): `@alepha/ui`'s `AppShell`
   * (under `AdminShell`'s `NavShell`) unconditionally wraps its content in a `<DialogProvider>`
   * (`.vendor/@alepha/ui/src/components/app-shell/app-shell.tsx`), and `DialogProvider` calls
   * `useI18n()` on every render, no matter whether a dialog is ever opened
   * (`.vendor/@alepha/ui/src/components/use-dialog/use-dialog.tsx`). `useI18n()` → `useInject(
   * I18nProvider)`, and NOTHING in this app registers `alepha/react/i18n`'s module anywhere else —
   * this app has never used a `@alepha/ui` component that needed it before `AdminShell`. The first
   * time React tries to construct `I18nProvider` is therefore mid-render, well after
   * `alepha.start()` has already locked the container, which throws `ContainerLockedError`
   * ("Module 'alepha.react.i18n' is not registered") instead of quietly auto-registering it the
   * way injecting a not-yet-touched service normally does at boot. Concretely: without this field,
   * EVERY successful admin session — not merely a cold-loaded one — crashed the instant
   * `AdminShell` mounted, because reaching the shell at all means reaching `AppShell`'s
   * `DialogProvider`. Eagerly injecting `I18nProvider` here, alongside `reactAuth`/`adminRouter`
   * above, registers `alepha.react.i18n` during boot instead. `I18nProvider` tolerates zero
   * registered `$dictionary`s fine (`ButtonLanguage`'s own docblock: "renders nothing when only
   * one language is registered") — this app has none, and needs none for `DialogProvider` to work.
   */
  i18nProvider = $inject(I18nProvider);

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

  /**
   * The boot ping — browser-only, and deliberately a lifecycle `$hook` rather than a React
   * `useEffect` on `AppLayout` (where it lived before Task 2's fix round 1). `"start"` hooks are
   * fully awaited, across every service, before the `"ready"` phase runs — and
   * `ReactBrowserProvider`'s own `on: "ready"` hook is what performs React's initial mount AND the
   * router's first route transition. `$secure`'s browser guard reads `currentUserAtom`
   * SYNCHRONOUSLY during that first transition (`ReactPageProvider.createLayers` →
   * `denyGuardedPage`), so an effect that only starts populating the atom AFTER first paint is
   * already too late for whatever route the visitor is cold-loading, guarded or not — see fix
   * round 1's report for the full "Authentication required" latch this closed.
   *
   * **What this hook blocks `"ready"` (and therefore first paint) on, precisely: ONE `ping()`
   * call, capped at `BOOT_PING_TIMEOUT_MS`. Nothing else.** That is deliberately the SMALLEST
   * thing that can close the race above — a route guard only needs to know "is there already a
   * returning, authenticated session," and that is exactly what one `ping()` answers.
   *
   * **What it does NOT block on: the guest-registration fallback.** Fix round 1 awaited the whole
   * chain — `ping()` → `continueAsGuest()` (a real register/login POST doing server-side password
   * hashing) → `ping()` again — which was caught in review as a real regression, worse than the
   * bug it fixed:
   * - it made EVERY route pay for fixing ONE guarded route: `/` and `/menu` had no loader and no
   *   network before first paint at all before this; guest registration used to happen underneath
   *   an already-visible title screen, not in front of it;
   * - a RETURNING user paid one blocking round trip, and a FIRST-TIME/anonymous visitor paid
   *   THREE sequential ones, all before a single pixel;
   * - worst of all, Alepha's `HttpClient` has no timeout or `AbortSignal` of its own — a hanging
   *   (not merely failing) `/_auth/userinfo` blocked `alepha.start()` forever, and a `"start"`
   *   hook that never resolves means the app never reaches `"ready"` at all: a permanently blank
   *   page, strictly worse than the pre-fix behaviour (renders fine, only auth degrades).
   *
   * So: the first `ping()` is raced against `BOOT_PING_TIMEOUT_MS` — a timeout counts as "no user
   * yet," exactly like a rejection, and lets mount proceed either way. The guest-registration
   * fallback (`continueAsGuest()` + a second `ping()`) then runs COMPLETELY UNAWAITED, as a
   * fire-and-forget background chain: if the visitor turns out to be anonymous, they see the app
   * render first and the guest session attach a moment later (or, on total failure — both the real
   * ping AND guest registration failing — get sent to `/auth` via a hard `window.location`
   * assignment a moment later; still not `router.push`, since React has not mounted yet when this
   * hook runs and there is no live SPA router to push through). The race's LOSING timer callback
   * calling `resolve()` on an already-settled promise is a harmless no-op — nothing needs to
   * cancel it.
   *
   * Skipped entirely when the browser's OWN current location is `/auth`: landing there already
   * means "let the human decide" (a 401 redirect, or a direct deep link), and silently signing the
   * visitor in as a guest behind their back would both surprise them and race `AuthScreen`'s own
   * login/register/guest actions, which drive the exact same `continueAsGuest()`/`ping()` calls.
   * Reads `window.location.pathname` rather than router state: the router has not resolved
   * anything yet at `"start"` time, and `window.location` IS the value its first transition is
   * about to use.
   */
  bootPing = $hook({
    on: "start",
    handler: async () => {
      if (!this.alepha.isBrowser()) return;
      if (window.location.pathname === "/auth") return;

      const user = await Promise.race([
        this.reactAuth.ping().catch(() => undefined),
        new Promise<undefined>((resolve) => setTimeout(resolve, BOOT_PING_TIMEOUT_MS)),
      ]);
      if (user) return;

      // Deliberately fire-and-forget — see this field's own docblock for why blocking mount on
      // this chain is exactly the regression fix round 2 closed.
      void (async () => {
        try {
          await continueAsGuest();
          await this.reactAuth.ping();
        } catch {
          window.location.href = "/auth";
        }
      })();
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
      this.adminRouter.adminLayout,
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
