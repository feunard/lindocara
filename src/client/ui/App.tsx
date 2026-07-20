import { lazy, Suspense, useEffect } from "react";
import { fetchMe } from "../api.js";
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
import { LocaleToggle } from "./LocaleToggle.js";
import { MerchantOverlay } from "./MerchantOverlay.js";
import { MobileControls } from "./MobileControls.js";
import { PartiesScreen } from "./PartiesScreen.js";
import { PartyScreen } from "./PartyScreen.js";
import { Prompt } from "./Prompt.js";
import { SettingsMenu } from "./SettingsMenu.js";
import { StatusBar } from "./StatusBar.js";
import { TalentTree } from "./TalentTree.js";
import { VictoryOverlay } from "./VictoryOverlay.js";
import { WorldMap } from "./WorldMap.js";

const AdventureEditorScreen = lazy(async () => {
  const module = await import("./editor/AdventureEditorScreen.js");
  return { default: module.AdventureEditorScreen };
});

export function App() {
  const screen = useUiStore((s) => s.screen);
  const setScreen = useUiStore((s) => s.setScreen);
  const setAccountId = useUiStore((s) => s.setAccountId);

  useEffect(() => {
    fetchMe().then((me) => {
      setAccountId(me?.id ?? null);
      setScreen(me ? "parties" : "auth");
    });
  }, [setScreen, setAccountId]);

  return (
    <>
      {/* The floating game-chrome locale chip and status pill are anchored bottom-right and would
          collide with the editor's own bottom-right chrome (the "Adventure settings" button). The
          dense editor shell owns its whole viewport, so keep these Tiny Swords widgets off it. */}
      {screen !== "adventure-editor" && <LocaleToggle />}
      {screen !== "adventure-editor" && <StatusBar />}
      {screen === "auth" && <AuthScreen />}
      {screen === "adventure-editor" && (
        <Suspense fallback={null}>
          <AdventureEditorScreen />
        </Suspense>
      )}
      {screen === "parties" && <PartiesScreen />}
      {screen === "party" && <PartyScreen />}
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
