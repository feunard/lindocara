/**
 * The credits screen — third-party assets and their licences, reached from the main menu.
 * Immersive over the courtyard backdrop like the other launch screens; B/Esc or the back button
 * return to the menu (same nav + back sound as the carousels). Styled inline so it stands on its
 * own regardless of the launch stylesheet.
 */
import type { CSSProperties } from "react";
import { menuAudio } from "../game/menu-audio.js";
import { t } from "../i18n.js";
import { useUiStore } from "../store.js";
import { TinySwordsMenuScene } from "./TinySwordsMenuScene.js";
import { MenuNav } from "./tiny-swords/menu-nav.js";

interface Credit {
  work: string;
  by: string;
  licence: string;
}

/** Art: Tiny Swords is Pixel Frog's; the repo records provenance, not licence, so link to "pack terms". */
const ART: Credit[] = [{ work: "Tiny Swords", by: "Pixel Frog", licence: "pack terms" }];
const MUSIC: Credit[] = [
  { work: "The Field of Dreams", by: "pauliuw", licence: "CC0" },
  { work: "New Sunrise", by: "nene", licence: "CC0" },
];
const SFX: Credit[] = [{ work: "10 Retro RPG Menu Sounds", by: "leohpaz", licence: "CC-BY 4.0" }];

const styles: Record<string, CSSProperties> = {
  screen: {
    position: "fixed",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px",
  },
  panel: {
    width: "min(92vw, 620px)",
    maxHeight: "78vh",
    overflowY: "auto",
    background: "rgba(24, 18, 12, 0.84)",
    border: "1px solid rgba(214, 180, 110, 0.35)",
    borderRadius: "14px",
    padding: "28px 32px",
    color: "#f3ead6",
    boxShadow: "0 18px 48px rgba(0, 0, 0, 0.5)",
    backdropFilter: "blur(2px)",
  },
  title: {
    margin: "0 0 4px",
    fontSize: "1.8rem",
    letterSpacing: "0.08em",
    textAlign: "center",
    color: "#f0d9a0",
  },
  intro: {
    margin: "0 0 22px",
    textAlign: "center",
    opacity: 0.72,
    fontSize: "0.9rem",
  },
  sectionTitle: {
    margin: "18px 0 8px",
    fontSize: "0.78rem",
    textTransform: "uppercase",
    letterSpacing: "0.15em",
    color: "#d6b46e",
    borderBottom: "1px solid rgba(214, 180, 110, 0.22)",
    paddingBottom: "6px",
  },
  item: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: "12px",
    padding: "5px 0",
    fontSize: "0.95rem",
  },
  work: { fontWeight: 600 },
  by: { opacity: 0.8 },
  licence: {
    flex: "none",
    fontSize: "0.72rem",
    opacity: 0.85,
    border: "1px solid rgba(214, 180, 110, 0.3)",
    borderRadius: "999px",
    padding: "2px 9px",
    whiteSpace: "nowrap",
  },
  back: {
    marginTop: "18px",
    background: "transparent",
    border: "1px solid rgba(214, 180, 110, 0.4)",
    borderRadius: "10px",
    color: "#f0d9a0",
    padding: "8px 18px",
    fontSize: "0.95rem",
    cursor: "pointer",
  },
};

function Section({ label, credits }: { label: string; credits: Credit[] }) {
  return (
    <>
      <h2 style={styles.sectionTitle}>{label}</h2>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {credits.map((c) => (
          <li key={c.work} style={styles.item}>
            <span>
              <span style={styles.work}>{c.work}</span> <span style={styles.by}>· {c.by}</span>
            </span>
            <span style={styles.licence}>{c.licence}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

export function CreditsScreen() {
  const setScreen = useUiStore((s) => s.setScreen);
  const back = () => setScreen("menu");
  return (
    <main style={styles.screen}>
      <TinySwordsMenuScene variant="courtyard" />
      <MenuNav
        orientation="vertical"
        className="credits-nav"
        aria-label={t("credits.title")}
        onBack={back}
      >
        <div style={styles.panel}>
          <h1 style={styles.title}>{t("credits.title")}</h1>
          <p style={styles.intro}>{t("credits.intro")}</p>
          <Section label={t("credits.art")} credits={ART} />
          <Section label={t("credits.music")} credits={MUSIC} />
          <Section label={t("credits.sfx")} credits={SFX} />
        </div>
      </MenuNav>
      <button
        type="button"
        style={styles.back}
        onClick={() => {
          menuAudio.playBack();
          back();
        }}
      >
        ‹ {t("menu.back")}
      </button>
    </main>
  );
}
