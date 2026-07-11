import { useState } from "react";
import {
  DEFAULT_APPEARANCE,
  PRIMARY_COLORS,
  type PrimaryColor,
  starterEquipmentFor,
} from "../../shared/character.js";
import { CLASS_STATS, PLAYER_CLASSES, type PlayerClass } from "../../shared/game.js";
import { api, authErrorText, type CharacterSummary, errorCode } from "../api.js";
import { t, useLocale } from "../i18n.js";
import { CharacterPreview, type PreviewMotion } from "./CharacterPreview.js";
import { Button } from "./pixelact-ui/button/index.js";
import { Input } from "./pixelact-ui/input.js";
import { Label } from "./pixelact-ui/label.js";

const DEFAULT_CLASS: PlayerClass = "warrior";
const SKILL_SLOTS = [1, 2, 3, 4, 5] as const;
const MOTIONS: PreviewMotion[] = ["idle", "walk", "attack"];

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
  const appearance = { body: DEFAULT_APPEARANCE.body, primaryColor } as const;
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
    setPrimaryColor(randomFrom(PRIMARY_COLORS));
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
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t("chars.create.cancel")}
        </Button>
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
                <Label className="creator-field-label" htmlFor="character-name">
                  {t("chars.create.name")}
                </Label>
                <Input
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

              <fieldset className="creator-section creator-color-picker">
                <legend>
                  <span className="creator-step-number">03</span>
                  {t("chars.create.appearance")}
                </legend>
                <p>{t("chars.create.palette_help")}</p>
                <div className="creator-swatches">
                  {PRIMARY_COLORS.map((color) => (
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
              </fieldset>

              <section className="creator-section creator-skills" aria-labelledby="future-skills">
                <div className="creator-section-heading">
                  <div>
                    <span className="creator-step-number">04</span>
                    <h2 id="future-skills">{t("chars.create.skills")}</h2>
                  </div>
                  <small>{t("chars.create.skills_future")}</small>
                </div>
                <div className="creator-skill-grid">
                  {SKILL_SLOTS.map((slot) => (
                    <article key={slot}>
                      <span>{slot}</span>
                      <p>{t(`class.${playerClass}.skill.${slot}`)}</p>
                    </article>
                  ))}
                </div>
              </section>

              <div className="creator-footer">
                {error && <p role="alert">{authErrorText(error)}</p>}
                <Button
                  type="button"
                  disabled={!/^[A-Za-z0-9_-]{2,16}$/.test(name)}
                  onClick={() => setConfirming(true)}
                >
                  {t("chars.create.review")}
                </Button>
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
                <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
                  {t("chars.create.back")}
                </Button>
                <Button type="button" disabled={submitting} onClick={() => void create()}>
                  {submitting ? t("chars.create.creating") : t("chars.create.confirm")}
                </Button>
              </div>
              {error && <p role="alert">{authErrorText(error)}</p>}
            </section>
          )}
        </section>
      </div>
    </main>
  );
}
