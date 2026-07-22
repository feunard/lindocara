import { lazy, Suspense, useEffect } from "react";
import { fetchMe } from "../api.js";
import { menuAudio } from "../game/menu-audio.js";
import { continueAsGuest } from "../guest.js";
import { t, useLocale } from "../i18n.js";
import { useUiStore } from "../store.js";
import { AuthScreen } from "./AuthScreen.js";
import { Chat } from "./Chat.js";
import { ConnectionOverlay } from "./ConnectionOverlay.js";
import { EventLog } from "./EventLog.js";
import { HelpBar } from "./HelpBar.js";
import { EventDialoguePanel } from "./hud/EventDialoguePanel.js";
import { Hud } from "./hud/Hud.js";
import { Minimap } from "./hud/Minimap.js";
import { InteriorOverlay } from "./InteriorOverlay.js";
import { InventoryOverlay } from "./InventoryOverlay.js";
import { ContinueScreen, JoinScreen, NewGameScreen } from "./LaunchScreens.js";
import { LocaleToggle } from "./LocaleToggle.js";
import { MainMenu } from "./MainMenu.js";
import { MerchantOverlay } from "./MerchantOverlay.js";
import { MobileControls } from "./MobileControls.js";
import { Prompt } from "./Prompt.js";
import { SettingsMenu } from "./SettingsMenu.js";
import { StatusBar } from "./StatusBar.js";
import { TalentTree } from "./TalentTree.js";
import { TitleScreen } from "./TitleScreen.js";
import { VictoryOverlay } from "./VictoryOverlay.js";
import { WorldMap } from "./WorldMap.js";

const AdventureEditorScreen = lazy(async () => {
  const module = await import("@lindocara/editor/ui/editor/AdventureEditorScreen.js");
  return { default: module.AdventureEditorScreen };
});

export function App() {
  useLocale();
  const screen = useUiStore((s) => s.screen);
  const setScreen = useUiStore((s) => s.setScreen);
  const setAccountId = useUiStore((s) => s.setAccountId);

  // There is no login screen in the normal flow: an unauthenticated visitor is signed straight in as
  // the guest this browser already owns (or a freshly minted one, its creds saved to localStorage),
  // so the app always opens on the title. A named-account path will live in Options later. Auth is
  // kept only as a fallback for when the server can't be reached at all, so nobody is ever stranded.
  useEffect(() => {
    void (async () => {
      const me = await fetchMe();
      if (me) {
        setAccountId(me.id);
        setScreen("title");
        return;
      }
      try {
        const guest = await continueAsGuest();
        setAccountId(guest.id);
        setScreen("title");
      } catch {
        setScreen("auth");
      }
    })();
  }, [setScreen, setAccountId]);

  // The piano bed plays across the whole launch menu (the central menu and its carousels), and
  // stops the moment the player drops into the game, the editor, the title or auth. Audio was
  // already unlocked by the title-screen press, so the context is running by the time we get here.
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
    screen === "join";

  return (
    <>
      {/* The floating game-chrome locale chip and status pill are anchored bottom-right and would
          collide with the editor's own bottom-right chrome (the "Adventure settings" button). The
          dense editor shell owns its whole viewport, so keep these Tiny Swords widgets off it. */}
      {!immersive && <LocaleToggle />}
      {!immersive && <StatusBar />}
      {screen === "auth" && <AuthScreen />}
      {screen === "title" && <TitleScreen />}
      {screen === "menu" && <MainMenu />}
      {screen === "continue" && <ContinueScreen />}
      {screen === "new" && <NewGameScreen />}
      {screen === "join" && <JoinScreen />}
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
      {screen === "game" && (
        <>
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
          <WorldMap />
          <TalentTree />
          <MobileControls />
          <ConnectionOverlay />
          <VictoryOverlay />
        </>
      )}
      <SettingsMenu inGame={screen === "game"} />
    </>
  );
}
