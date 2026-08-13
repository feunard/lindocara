/**
 * The press-start title: the controller-first entry point. Any face-button press, Enter, Space or a
 * click drops into the main menu. Full-screen art; no chrome, no cursor hunt.
 */
import { firstConnectedGamepad } from "@lindocara/renderer/input-settings.js";
import { useStore } from "alepha/react";
import { useRouter } from "alepha/react/router";
import { useEffect } from "react";
import { menuAudio } from "../game/menu-audio.js";
import { t } from "../i18n.js";
import { backdropVersionAtom } from "../state/atoms.js";
import type { AppRouter } from "./AppRouter.js";
import { LaunchBackdrop } from "./LaunchBackdrop.js";
import { TinySwordsMenuScene } from "./TinySwordsMenuScene.js";

export function TitleScreen() {
  const router = useRouter<AppRouter>();
  // Read-only here: the toggle lives on the main menu's corner, but the choice covers both screens.
  const [backdrop] = useStore(backdropVersionAtom);

  useEffect(() => {
    const start = () => {
      // This press is the user gesture that unlocks audio; play the confirm and hand off.
      menuAudio.playConfirm();
      void router.push("menu");
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
  }, [router]);

  return (
    // `data-backdrop` lets the stylesheet re-tune text contrast per backdrop: the gold brand
    // that reads fine on the diorama's teal washes out on v2's bright dawn sky.
    <main className="title-screen" data-backdrop={backdrop}>
      {/* v1: the same illustrated Tiny Swords diorama the login screen uses as its backdrop.
          v2: the launch-gate living backdrop, chosen by the menu's corner toggle. */}
      {backdrop === "v2" ? <LaunchBackdrop /> : <TinySwordsMenuScene variant="gate" />}
      <div className="title-screen__brand">
        <h1 className="title-screen__logo">Lindocara</h1>
      </div>
      <p className="title-screen__prompt">{t("title.press_start")}</p>
    </main>
  );
}
