/**
 * The press-start title: the controller-first entry point. Any face-button press, Enter, Space or a
 * click drops into the main menu. Full-screen art; no chrome, no cursor hunt.
 */
import { firstConnectedGamepad } from "@lindocara/renderer/input-settings.js";
import { useEffect } from "react";
import { menuAudio } from "../game/menu-audio.js";
import { t } from "../i18n.js";
import { useUiStore } from "../store.js";
import { TinySwordsMenuScene } from "./TinySwordsMenuScene.js";

export function TitleScreen() {
  const setScreen = useUiStore((s) => s.setScreen);

  useEffect(() => {
    const start = () => {
      // This press is the user gesture that unlocks audio; play the confirm and hand off.
      menuAudio.playConfirm();
      setScreen("menu");
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") start();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", start);
    let raf = 0;
    let prev = false;
    const poll = () => {
      const pad = firstConnectedGamepad();
      const pressed = pad?.buttons.some((b) => b.pressed) === true;
      if (pressed && !prev) start();
      prev = pressed;
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", start);
      cancelAnimationFrame(raf);
    };
  }, [setScreen]);

  return (
    <main className="title-screen">
      {/* The same illustrated Tiny Swords diorama the login screen uses as its backdrop. */}
      <TinySwordsMenuScene variant="gate" />
      <div className="title-screen__brand">
        <h1 className="title-screen__logo">Lindocara</h1>
      </div>
      <p className="title-screen__prompt">{t("title.press_start")}</p>
    </main>
  );
}
