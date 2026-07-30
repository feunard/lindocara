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
 * store's deprecated `setScreen` shim (`store.ts`), which now pushes through the navigation seam
 * this layout installs below (`state/navigation.ts`) rather than writing a `screen` field nobody
 * reads anymore.
 */

import { useAlepha } from "alepha/react";
import { $page, NestedView, useRouter, useRouterState } from "alepha/react/router";
import { useEffect } from "react";
import { fetchMe } from "../api.js";
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
import { setGameNavigation } from "../state/navigation.js";
import { useUiStore } from "../store.js";
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
  const setAccountId = useUiStore((s) => s.setAccountId);
  const alepha = useAlepha();
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

  // Installs the navigation seam (`state/navigation.ts`) `game/session.ts` and the store's
  // deprecated editor-facing shims (`setScreen`, `setAdventureEditorSession`,
  // `setAdventureTestSession`) route through — the ONE place in the app that actually closes over
  // both `router.push` and `alepha.store.set/get`, since neither `game/**` nor the zustand store
  // itself may import `alepha`/`alepha/react` (see the repo AGENTS.md and `state/navigation.ts`'s
  // docblock). Cleared on unmount so a stale seam never survives into the next mount (a fresh test,
  // or a future hot reload).
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
      setAdventureEditorSession: (session) => alepha.store.set(adventureEditorSessionAtom, session),
      push: (routeName) => void router.push(routeName),
    };
    setGameNavigation(nav);
    return () => setGameNavigation(null);
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
