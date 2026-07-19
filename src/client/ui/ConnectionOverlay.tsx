import type { CSSProperties } from "react";
import type { MessageKey } from "../../shared/i18n/index.js";
import { TINY_SWORDS_ENEMIES } from "../game/enemy-art.js";
import { TINY_SWORDS_EFFECT_SHEETS, unitSheet } from "../game/tiny-swords-art.js";
import { t } from "../i18n.js";
import { useUiStore } from "../store.js";
import { TinySwordsMenuScene } from "./TinySwordsMenuScene.js";

type CinematicStyle = CSSProperties & {
  "--actor-frames": number;
};

/** A deliberately small, local-only overlay while the socket moves/reconnects. */
export function ConnectionOverlay() {
  const reconnect = useUiStore((state) => state.reconnect);
  const loading = useUiStore((state) => state.heroLoading);
  if (!reconnect && !loading) return null;
  if (loading && !reconnect) {
    const heroes = [
      unitSheet(loading.class, { body: "wayfarer", primaryColor: loading.color }, "run"),
      unitSheet(
        loading.class === "warrior" ? "ranger" : "warrior",
        { body: "wayfarer", primaryColor: loading.color === "moss" ? "azure" : "moss" },
        "attack",
      ),
      unitSheet(
        loading.class === "priest" ? "ranger" : "priest",
        { body: "wayfarer", primaryColor: "violet" },
        "attack",
      ),
    ];
    const monsters = [
      TINY_SWORDS_ENEMIES.spear_goblin.run,
      TINY_SWORDS_ENEMIES.gnoll_marauder.attack,
    ];
    const phaseKey = `loading.hero.${loading.phase}` as MessageKey;
    return (
      <section className="connection-overlay hero-loading" role="status" aria-live="polite">
        <TinySwordsMenuScene variant="courtyard" />
        <div className="hero-loading__battle" aria-hidden="true">
          <div className="hero-loading__party">
            {heroes.map((hero, index) => (
              <span
                className={`hero-loading__actor hero-loading__actor--hero-${index + 1}`}
                key={hero.source}
              >
                <img
                  src={hero.source}
                  alt=""
                  style={{ "--actor-frames": hero.frames } as CinematicStyle}
                />
              </span>
            ))}
          </div>
          <span className="hero-loading__clash">
            <img
              src={TINY_SWORDS_EFFECT_SHEETS.explosion.source}
              alt=""
              style={
                {
                  "--actor-frames": TINY_SWORDS_EFFECT_SHEETS.explosion.frames,
                } as CinematicStyle
              }
            />
          </span>
          <div className="hero-loading__monsters">
            {monsters.map((monster, index) => (
              <span
                className={`hero-loading__actor hero-loading__actor--monster-${index + 1}`}
                key={monster.source}
              >
                <img
                  src={monster.source}
                  alt=""
                  style={{ "--actor-frames": monster.frames } as CinematicStyle}
                />
              </span>
            ))}
          </div>
        </div>
        <div className="connection-overlay__panel hero-loading__panel">
          <p className="hero-loading__kicker">{t("loading.hero.eyebrow")}</p>
          <h2>{t("loading.hero.title", { name: loading.name })}</h2>
          <p>{t(phaseKey)}</p>
          <div className="hero-loading__progress-line">
            <div
              className="hero-loading__progress"
              role="progressbar"
              aria-label={t("loading.hero.progress")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={loading.progress}
            >
              <span style={{ width: `${loading.progress}%` }} />
            </div>
            <strong>{loading.progress}%</strong>
          </div>
        </div>
      </section>
    );
  }
  if (!reconnect) return null;
  const transition = reconnect.kind === "transition";
  return (
    <section className="connection-overlay" role="status" aria-live="polite">
      <div className="connection-overlay__panel">
        <h2>{t(transition ? "transition.title" : "reconnect.title")}</h2>
        <p>
          {t(
            transition ? "transition.copy" : "reconnect.copy",
            transition ? undefined : { attempt: reconnect.attempt },
          )}
        </p>
        <button type="button" onClick={reconnect.cancelReconnect}>
          {t("reconnect.cancel")}
        </button>
      </div>
    </section>
  );
}
