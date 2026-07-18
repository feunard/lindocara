import { t, useLocale } from "../i18n.js";
import { useUiStore } from "../store.js";
import { Button } from "./pixelact-ui/button/index.js";
import { TinySwordsMenuScene } from "./TinySwordsMenuScene.js";

export function TitleScreen() {
  useLocale();
  const setScreen = useUiStore((state) => state.setScreen);
  return (
    <main className="auth-shell title-screen">
      <TinySwordsMenuScene variant="gate" />
      <section className="title-screen__panel" aria-labelledby="lindocara-title">
        <span className="eyebrow">{t("title.eyebrow")}</span>
        <h1 id="lindocara-title">lindocara</h1>
        <p>{t("title.tagline")}</p>
        <Button type="button" onClick={() => setScreen("auth")}>
          {t("title.start")}
        </Button>
      </section>
    </main>
  );
}
