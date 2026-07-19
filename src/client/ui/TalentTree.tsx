import { type CSSProperties, useEffect, useState } from "react";
import type { MessageKey } from "../../shared/i18n/index.js";
import { isSkillUnlocked, skillFor } from "../../shared/skills.js";
import {
  CLASS_TALENTS,
  type TalentEffect,
  type TalentLabel,
  unlockTalent,
} from "../../shared/talents.js";
import { skillIconArt } from "../game/tiny-swords-art.js";
import { t, useLocale } from "../i18n.js";
import { useUiStore } from "../store.js";
import { TinyButton } from "./tiny-swords/TinyButton.js";

const NODE_GLYPHS: Readonly<Record<Exclude<TalentLabel, "root">, string>> = {
  power: "+",
  range: "◎",
  distance: "➜",
  cooldown: "↻",
  guard_reduction: "◆",
  perfect_parry: "✦",
  perfect_retaliation: "↯",
  ricochet: "⌁",
  extra_projectiles: "⋰",
  dash_invulnerability: "◇",
  execute: "✧",
  chain_heal: "∞",
  blink_heal: "✚",
  mastery: "★",
};

function effectValue(effects: readonly TalentEffect[]): string | number {
  const effect = effects[0];
  if (!effect) return "";
  if (
    effect.kind === "power_multiplier" ||
    effect.kind === "range_multiplier" ||
    effect.kind === "distance_multiplier" ||
    effect.kind === "cooldown_multiplier" ||
    effect.kind === "guard_reduction"
  )
    return Math.round(effect.value * 100);
  if (effect.kind === "perfect_parry") return effect.windowMs;
  if (effect.kind === "perfect_retaliation" || effect.kind === "chain_heal")
    return Math.round(effect.ratio * 100);
  if (effect.kind === "ricochet") return Math.round(effect.ratio * 100);
  if (effect.kind === "extra_projectiles" || effect.kind === "blink_heal") return effect.value;
  if (effect.kind === "execute") return Math.round(effect.threshold * 100);
  return "";
}

export function TalentTree() {
  useLocale();
  const open = useUiStore((state) => state.talentsOpen);
  const setOpen = useUiStore((state) => state.setTalentsOpen);
  const self = useUiStore((state) => state.self);
  const talentState = useUiStore((state) => state.selfState?.talents);
  const game = useUiStore((state) => state.game);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    if (!open) setConfirmReset(false);
  }, [open]);

  if (!open || !self || !talentState) return null;
  const selected = new Set(talentState.selected);
  const branches = [2, 3, 4, 5] as const;

  return (
    <section
      className="talent-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="talent-title"
    >
      <div className="talent-panel">
        <header className="talent-header">
          <div>
            <p className="talent-kicker">{t(`class.${self.class}` as MessageKey)}</p>
            <h2 id="talent-title">{t("talent.title")}</h2>
            <p>
              {t("talent.points", { available: talentState.pointsAvailable, total: self.level })}
            </p>
          </div>
          <TinyButton
            type="button"
            size="sm"
            onClick={() => setOpen(false)}
            aria-label={t("talent.close")}
          >
            ×
          </TinyButton>
        </header>

        <p className="talent-hint">{t("talent.hint")}</p>
        <div className="talent-branches">
          {branches.map((slot) => {
            const skill = skillFor(self.class, slot);
            const skillName = t(`skill.${self.class}.${skill.id}.name` as MessageKey);
            const nodes = CLASS_TALENTS[self.class].filter((node) => node.slot === slot);
            const icon = skillIconArt(self.class, slot);
            const iconStyle = {
              backgroundImage: `url("${icon.source}")`,
              backgroundSize: `${icon.frames * 100}% 100%`,
              backgroundPosition: `${icon.frames === 1 ? 0 : (icon.frame / (icon.frames - 1)) * 100}% center`,
            } satisfies CSSProperties;
            return (
              <article className="talent-branch" key={skill.id}>
                <h3>{skillName}</h3>
                <div className="talent-grid">
                  {nodes.map((node) => {
                    const rootActive = node.root && isSkillUnlocked(self.level, slot);
                    const active = rootActive || selected.has(node.id);
                    const result = unlockTalent(
                      self.class,
                      self.level,
                      talentState.selected,
                      node.id,
                    );
                    const available = !node.root && !active && result.ok;
                    const name = node.root
                      ? skillName
                      : t(`talent.node.${node.label}.name` as MessageKey);
                    const description = node.root
                      ? t(`skill.${self.class}.${skill.id}.description` as MessageKey)
                      : t(`talent.node.${node.label}.description` as MessageKey, {
                          skill: skillName,
                          value: effectValue(node.effects),
                        });
                    return (
                      <button
                        type="button"
                        key={node.id}
                        className={`talent-node${active ? " talent-node--active" : ""}${available ? " talent-node--available" : ""}`}
                        style={{ gridRow: node.tier + 1, gridColumn: node.column + 2 }}
                        disabled={!available}
                        onClick={() => game?.unlockTalent?.(node.id)}
                        aria-label={`${name}. ${description}`}
                        title={`${name} — ${description}`}
                      >
                        {node.root ? (
                          <span
                            className="talent-node__icon"
                            style={iconStyle}
                            aria-hidden="true"
                          />
                        ) : (
                          <span className="talent-node__glyph" aria-hidden="true">
                            {NODE_GLYPHS[node.label as Exclude<TalentLabel, "root">]}
                          </span>
                        )}
                        <span className="talent-node__name">{name}</span>
                        <span className="talent-node__cost" aria-hidden="true">
                          {node.root ? "0" : "1"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>

        <footer className="talent-footer">
          {!confirmReset ? (
            <TinyButton
              type="button"
              onClick={() => setConfirmReset(true)}
              disabled={talentState.pointsSpent === 0}
            >
              {t("talent.reset")}
            </TinyButton>
          ) : (
            <div
              className="talent-reset-confirm"
              role="alertdialog"
              aria-label={t("talent.reset.confirm")}
            >
              <span>{t("talent.reset.confirm")}</span>
              <TinyButton
                type="button"
                onClick={() => {
                  game?.resetTalents?.();
                  setConfirmReset(false);
                }}
              >
                {t("talent.reset.yes")}
              </TinyButton>
              <TinyButton type="button" onClick={() => setConfirmReset(false)}>
                {t("talent.reset.no")}
              </TinyButton>
            </div>
          )}
          <span>{t("talent.free_reset")}</span>
        </footer>
      </div>
    </section>
  );
}
