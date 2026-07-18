import { useState } from "react";
import { TinyButton } from "@/ui/tiny-swords/TinyButton.js";
import { TinyInput } from "@/ui/tiny-swords/TinyInput.js";
import { TinyLabel } from "@/ui/tiny-swords/TinyLabel.js";
import {
  DEFAULT_APPEARANCE,
  type PrimaryColor,
  starterEquipmentFor,
} from "../../shared/character.js";
import { CLASS_STATS, PLAYER_CLASSES, type PlayerClass } from "../../shared/game.js";
import type { MessageKey } from "../../shared/i18n/index.js";
import { CLASS_SKILLS } from "../../shared/skills.js";
import { api, authErrorText, type CharacterSummary, errorCode } from "../api.js";
import { skillIconSource } from "../game/tiny-swords-art.js";
import { t, useLocale } from "../i18n.js";
import { CharacterPreview, type PreviewMotion } from "./CharacterPreview.js";

const DEFAULT_CLASS: PlayerClass = "warrior";
const MOTIONS: PreviewMotion[] = ["idle", "walk", "attack"];
const CHARACTER_PALETTES = ["azure", "ember", "moss", "violet"] as const;

function randomFrom<T>(items: readonly T[]): T {
  const item = items[Math.floor(Math.random() * items.length)];
  if (item === undefined) throw new Error("Cannot randomize an empty option list");
  return item;
}

interface CharacterCreatorProps {
  onCancel(): void;
  onCreated(character: CharacterSummary): void;
}

export function CharacterCreator({ onCancel, onCreated }: CharacterCreatorProps) {
  useLocale();
  const [name, setName] = useState("");
  const [playerClass, setPlayerClass] = useState<PlayerClass>(DEFAULT_CLASS);
  const [primaryColor, setPrimaryColor] = useState<PrimaryColor>(DEFAULT_APPEARANCE.primaryColor);
  const [motion, setMotion] = useState<PreviewMotion>("idle");
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const appearance = { ...DEFAULT_APPEARANCE, primaryColor };
  const equipment = starterEquipmentFor(playerClass);

  function reset(): void {
    setName("");
    setPlayerClass(DEFAULT_CLASS);
    setPrimaryColor(DEFAULT_APPEARANCE.primaryColor);
    setMotion("idle");
    setConfirming(false);
    setError(null);
  }

  function randomize(): void {
    setPlayerClass(randomFrom(PLAYER_CLASSES));
    setPrimaryColor(randomFrom(CHARACTER_PALETTES));
    setConfirming(false);
    setError(null);
  }

  async function create(): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      const created = await api<CharacterSummary>("/api/characters", {
        method: "POST",
        body: JSON.stringify({ name, appearance, class: playerClass }),
      });
      onCreated(created);
    } catch (caught) {
      setError(errorCode(caught));
      setConfirming(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="creator-shell">
      <header className="creator-topbar">
        <div>
          <span className="eyebrow">{t("chars.create.eyebrow")}</span>
          <h1>{t("chars.create.title")}</h1>
        </div>
        <TinyButton type="button" variant="secondary" onClick={onCancel}>
          {t("chars.create.cancel")}
        </TinyButton>
      </header>

      <div className="creator-layout">
        <section className="creator-preview-panel framed" aria-labelledby="preview-title">
          <div className="creator-preview-copy">
            <span className="eyebrow">{t("chars.create.preview")}</span>
            <h2 id="preview-title">{name.trim() || t("chars.create.unnamed")}</h2>
            <p>{t(`class.${playerClass}.role`)}</p>
          </div>
          <div className="creator-preview-stage">
            <CharacterPreview
              appearance={appearance}
              equipment={equipment}
              motion={motion}
              label={t("chars.preview.label", {
                class: t(`class.${playerClass}`),
                color: t(`appearance.${primaryColor}`),
              })}
            />
          </div>
          <fieldset className="creator-motion-picker">
            <legend className="sr-only">{t("chars.create.animation")}</legend>
            {MOTIONS.map((value) => (
              <button
                type="button"
                key={value}
                className={motion === value ? "active" : ""}
                aria-pressed={motion === value}
                onClick={() => setMotion(value)}
              >
                {t(`chars.create.animation.${value}`)}
              </button>
            ))}
          </fieldset>
          <dl className="creator-loadout">
            <div>
              <dt>{t("chars.create.main_hand")}</dt>
              <dd>{t(`item.${equipment.mainHand}`)}</dd>
            </div>
            <div>
              <dt>{t("chars.create.off_hand")}</dt>
              <dd>{equipment.offHand ? t(`item.${equipment.offHand}`) : t("item.none")}</dd>
            </div>
          </dl>
        </section>

        <section className="creator-controls parchment framed">
          {!confirming ? (
            <>
              <div className="creator-section">
                <div className="creator-section-heading">
                  <div>
                    <span className="creator-step-number">01</span>
                    <h2>{t("chars.create.identity")}</h2>
                  </div>
                  <div className="creator-utility-actions">
                    <button type="button" onClick={randomize}>
                      {t("chars.create.random")}
                    </button>
                    <button type="button" onClick={reset}>
                      {t("chars.create.reset")}
                    </button>
                  </div>
                </div>
                <TinyLabel className="creator-field-label" htmlFor="character-name">
                  {t("chars.create.name")}
                </TinyLabel>
                <TinyInput
                  id="character-name"
                  value={name}
                  onChange={(event) => setName(event.currentTarget.value)}
                  type="text"
                  minLength={2}
                  maxLength={16}
                  pattern="[A-Za-z0-9_\-]{2,16}"
                  autoComplete="off"
                  required
                />
                <small>{t("chars.create.name_hint")}</small>
              </div>

              <fieldset className="creator-section creator-class-picker">
                <legend>
                  <span className="creator-step-number">02</span>
                  {t("chars.create.class")}
                </legend>
                <div className="creator-class-grid">
                  {PLAYER_CLASSES.map((klass) => {
                    const selected = playerClass === klass;
                    const loadout = starterEquipmentFor(klass);
                    return (
                      <label
                        key={klass}
                        className={selected ? "class-card selected" : "class-card"}
                      >
                        <input
                          type="radio"
                          name="class"
                          value={klass}
                          checked={selected}
                          onChange={() => setPlayerClass(klass)}
                        />
                        <span className="class-card__sigil" aria-hidden="true">
                          {klass === "warrior" ? "⚔" : klass === "ranger" ? "➶" : "✦"}
                        </span>
                        <span className="class-card__copy">
                          <strong>{t(`class.${klass}`)}</strong>
                          <small>{t(`class.${klass}.role`)}</small>
                          <span>
                            {t("chars.create.range", { range: CLASS_STATS[klass].attackRange })}
                          </span>
                          <span>{t(`class.${klass}.difficulty`)}</span>
                          <span>{t(`item.${loadout.mainHand}`)}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                <p className="creator-class-description">{t(`class.${playerClass}.description`)}</p>
              </fieldset>

              <fieldset className="creator-section creator-appearance-picker">
                <legend>
                  <span className="creator-step-number">03</span>
                  {t("chars.create.appearance")}
                </legend>
                <p>{t("chars.create.palette_help")}</p>
                <div className="creator-option-group">
                  <strong>{t("chars.create.banner")}</strong>
                  <div className="creator-swatches">
                    {CHARACTER_PALETTES.map((color) => (
                      <label key={color} className={primaryColor === color ? "selected" : ""}>
                        <input
                          type="radio"
                          name="primaryColor"
                          value={color}
                          checked={primaryColor === color}
                          onChange={() => setPrimaryColor(color)}
                        />
                        <span className={`swatch swatch--${color}`} aria-hidden="true" />
                        <span>{t(`appearance.${color}`)}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </fieldset>

              <section className="creator-section creator-skills" aria-labelledby="future-skills">
                <div className="creator-section-heading">
                  <div>
                    <span className="creator-step-number">04</span>
                    <h2 id="future-skills">{t("chars.create.skills")}</h2>
                  </div>
                  <small>{t("chars.create.skills_ready")}</small>
                </div>
                <div className="creator-skill-grid">
                  {CLASS_SKILLS[playerClass].map((skill) => (
                    <article key={skill.slot}>
                      <span>
                        <img src={skillIconSource(playerClass, skill.slot)} alt="" />
                      </span>
                      <p>{t(`skill.${playerClass}.${skill.id}.name` as MessageKey)}</p>
                      <small>
                        {t("chars.create.skill_cooldown", { seconds: skill.cooldownMs / 1000 })}
                      </small>
                    </article>
                  ))}
                </div>
              </section>

              <div className="creator-footer">
                {error && <p role="alert">{authErrorText(error)}</p>}
                <TinyButton
                  type="button"
                  disabled={!/^[A-Za-z0-9_-]{2,16}$/.test(name)}
                  onClick={() => setConfirming(true)}
                >
                  {t("chars.create.review")}
                </TinyButton>
              </div>
            </>
          ) : (
            <section className="creator-confirm" aria-labelledby="confirm-title">
              <span className="eyebrow">{t("chars.create.final_step")}</span>
              <h2 id="confirm-title">{t("chars.create.confirm_title")}</h2>
              <CharacterPreview
                appearance={appearance}
                equipment={equipment}
                label={t("chars.preview.label", {
                  class: t(`class.${playerClass}`),
                  color: t(`appearance.${primaryColor}`),
                })}
              />
              <dl>
                <div>
                  <dt>{t("chars.create.name")}</dt>
                  <dd>{name}</dd>
                </div>
                <div>
                  <dt>{t("chars.create.class")}</dt>
                  <dd>{t(`class.${playerClass}`)}</dd>
                </div>
                <div>
                  <dt>{t("chars.create.appearance")}</dt>
                  <dd>{t(`appearance.${primaryColor}`)}</dd>
                </div>
                <div>
                  <dt>{t("chars.create.equipment")}</dt>
                  <dd>
                    {t(`item.${equipment.mainHand}`)}
                    {equipment.offHand ? ` · ${t(`item.${equipment.offHand}`)}` : ""}
                  </dd>
                </div>
              </dl>
              <p>{t("chars.create.confirm_copy")}</p>
              <div className="creator-confirm-actions">
                <TinyButton type="button" variant="secondary" onClick={() => setConfirming(false)}>
                  {t("chars.create.back")}
                </TinyButton>
                <TinyButton type="button" disabled={submitting} onClick={() => void create()}>
                  {submitting ? t("chars.create.creating") : t("chars.create.confirm")}
                </TinyButton>
              </div>
              {error && <p role="alert">{authErrorText(error)}</p>}
            </section>
          )}
        </section>
      </div>
    </main>
  );
}
