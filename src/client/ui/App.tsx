import { useEffect } from "react";
import { fetchMe } from "../api.js";
import { useUiStore } from "../store.js";
import { AdventureEditor } from "./AdventureEditor.js";
import { AuthScreen } from "./AuthScreen.js";
import { Chat } from "./Chat.js";
import { ConnectionOverlay } from "./ConnectionOverlay.js";
import { EventLog } from "./EventLog.js";
import { HelpBar } from "./HelpBar.js";
import { Hud } from "./hud/Hud.js";
import { Minimap } from "./hud/Minimap.js";
import { TargetFrame } from "./hud/TargetFrame.js";
import { InteriorOverlay } from "./InteriorOverlay.js";
import { LocaleToggle } from "./LocaleToggle.js";
import { MapEditor } from "./MapEditor.js";
import { MobileControls } from "./MobileControls.js";
import { PartiesScreen } from "./PartiesScreen.js";
import { PartyScreen } from "./PartyScreen.js";
import { Prompt } from "./Prompt.js";
import { SettingsMenu } from "./SettingsMenu.js";
import { StatusBar } from "./StatusBar.js";
import { TitleScreen } from "./TitleScreen.js";
import { VictoryOverlay } from "./VictoryOverlay.js";
import { WorldMap } from "./WorldMap.js";

export function App() {
  const screen = useUiStore((s) => s.screen);
  const setScreen = useUiStore((s) => s.setScreen);
  const setAccountId = useUiStore((s) => s.setAccountId);

  useEffect(() => {
    fetchMe().then((me) => {
      setAccountId(me?.id ?? null);
      setScreen(me ? "parties" : "title");
    });
  }, [setScreen, setAccountId]);

  return (
    <>
      <LocaleToggle />
      <StatusBar />
      {screen === "title" && <TitleScreen />}
      {screen === "auth" && <AuthScreen />}
      {screen === "map-editor" && <MapEditor />}
      {screen === "adventures" && <AdventureEditor />}
      {screen === "parties" && <PartiesScreen />}
      {screen === "party" && <PartyScreen />}
      {screen === "game" && (
        <>
          <Hud />
          <TargetFrame />
          <Minimap />
          <Chat />
          <EventLog />
          <Prompt />
          <HelpBar />
          <InteriorOverlay />
          <WorldMap />
          <MobileControls />
          <ConnectionOverlay />
          <VictoryOverlay />
        </>
      )}
      <SettingsMenu inGame={screen === "game"} />
    </>
  );
}
