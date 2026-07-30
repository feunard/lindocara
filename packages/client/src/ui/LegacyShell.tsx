import { lazy, Suspense, useEffect, useState } from "react";
import { fetchMe } from "../api.js";
import { menuAudio } from "../game/menu-audio.js";
import { continueAsGuest } from "../guest.js";
import { t, useLocale } from "../i18n.js";
import type { UiScreen } from "../store.js";
import { CreditsScreen } from "./CreditsScreen.js";
import { LocaleToggle } from "./LocaleToggle.js";
import { MainMenu } from "./MainMenu.js";
import { SettingsMenu } from "./SettingsMenu.js";
import { StatusBar } from "./StatusBar.js";
import { TitleScreen } from "./TitleScreen.js";

const AdventureEditorScreen = lazy(async () => {
  const module = await import("@lindocara/editor/ui/editor/AdventureEditorScreen.js");
  return { default: module.AdventureEditorScreen };
});

/**
 * The pre-router screen machine — the rollback-only counterpart to `ui/AppRouter.tsx`'s `$page`
 * tree, mounted by `main.tsx`'s `mountLegacyApp()` on the separate `vite.legacy.config.ts`
 * Cloudflare-Worker deploy (`npm run dev:legacy`/`deploy:legacy`), which does not (and, being a
 * plain pre-Alepha React tree, cannot) install the `state/navigation.ts` seam `AppRouter.tsx`'s
 * layout installs on mount.
 *
 * Formerly `App.tsx`/`export function App()` — Task 5 renamed both the file and the component
 * once the real `App` concept (the thing that owns the whole UI) fully became `AppRouter.tsx`'s
 * `$page` tree. Nothing else changed: this remains a frozen snapshot of the pre-router shell, kept
 * compiling for the legacy deploy target rather than kept fully interactive.
 *
 * `screen` used to be a zustand field every screen component (`TitleScreen`, `MainMenu`, …) wrote
 * through the store's `setScreen`. Task 2 turned that into a deprecated shim that pushes through
 * the navigation seam instead of writing a field — a no-op here, since no seam is ever installed
 * under this legacy mount. So `screen` is now local, component-owned state that this component's
 * OWN effect can still drive (the boot flow below), but that the shared screen components' clicks
 * no longer advance: this file's shared screens no longer navigate under this mount, only render.
 * The in-game HUD tree (`Hud`, `InventoryOverlay`, `QuestJournalOverlay`, `AdventureTestOverlay`,
 * …) is dropped entirely below for the same reason: `screen` can never actually become `"game"`
 * through this shell anymore, and those components now read the `state/atoms.ts` atoms this
 * legacy tree has no Alepha instance to provide. See `docs/adventure-runtime-architecture.md`/the
 * Task 2 report for the full rationale; `AppRouter.tsx`'s own `/game` route (built Task 5) is the
 * one true home for that tree now.
 *
 * Task 3 shrinks this further: `AuthScreen`/`ContinueScreen`/`NewGameScreen`/`JoinScreen` now call
 * `useAuth()`/`useAlepha()`/`useRouter()` (Task 3's real auth flow), which throw hard without an
 * Alepha context — this legacy mount has none. Importing any of them would ALSO transitively drag
 * `alepha`'s whole source tree into this file's plain, non-`alepha` tsconfig program (the same
 * cascade Task 2's own docblock above already hit for the HUD tree), so their imports are dropped
 * here too, not just their render branches: `screen` can still be SET to `"auth"`/`"continue"`/
 * `"new"`/`"join"` by the boot effect below, it just now renders nothing for those three states.
 * Title/menu/credits (untouched this task) remain the only screens this legacy shell can actually
 * show — `AppRouter.tsx`'s router-driven equivalents are the real, live surface now.
 */
export function LegacyShell() {
  useLocale();
  const [screen, setScreen] = useState<UiScreen>("boot");

  useEffect(() => {
    void (async () => {
      const me = await fetchMe();
      if (me) {
        setScreen("title");
        return;
      }
      try {
        await continueAsGuest();
        setScreen("title");
      } catch {
        setScreen("auth");
      }
    })();
  }, []);

  useEffect(() => {
    const inLaunchMenu =
      screen === "menu" || screen === "continue" || screen === "new" || screen === "join";
    if (inLaunchMenu) menuAudio.startMusic();
    else menuAudio.stopMusic();
  }, [screen]);

  const immersive =
    screen === "adventure-editor" ||
    screen === "title" ||
    screen === "menu" ||
    screen === "new" ||
    screen === "continue" ||
    screen === "join" ||
    screen === "credits";

  return (
    <>
      {!immersive && <LocaleToggle />}
      {!immersive && <StatusBar />}
      {screen === "title" && <TitleScreen />}
      {screen === "menu" && <MainMenu />}
      {screen === "credits" && <CreditsScreen />}
      {screen === "adventure-editor" && (
        <Suspense
          fallback={
            <div className="fixed inset-0 grid place-items-center bg-background text-foreground">
              <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 text-sm shadow-sm">
                <span
                  className="size-4 animate-spin rounded-full border-2 border-muted border-t-foreground"
                  aria-hidden="true"
                />
                <span>{t("editor.stage.loading")}</span>
              </div>
            </div>
          }
        >
          <AdventureEditorScreen />
        </Suspense>
      )}
      <SettingsMenu inGame={false} />
    </>
  );
}
