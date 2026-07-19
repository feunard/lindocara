import { type CSSProperties, useEffect, useState } from "react";
import type { MessageKey } from "../../../shared/i18n/index.js";
import { skillResourceCost } from "../../../shared/resources.js";
import { CLASS_SKILLS, isSkillUnlocked, SKILL_UNLOCK_LEVEL } from "../../../shared/skills.js";
import { skillIconArt } from "../../game/tiny-swords-art.js";
import { t } from "../../i18n.js";
import { useUiStore } from "../../store.js";

export function SkillBar() {
  const self = useUiStore((state) => state.self);
  const game = useUiStore((state) => state.game);
  const selfState = useUiStore((state) => state.selfState);
  const attackCooldownUntil = useUiStore((state) => state.attackCooldownUntil);
  const cooldowns = useUiStore((state) => state.skillCooldowns);
  const [now, setNow] = useState(() => performance.now());

  useEffect(() => {
    const latestDeadline = Math.max(attackCooldownUntil, ...Object.values(cooldowns));
    const startedAt = performance.now();
    setNow(startedAt);
    if (latestDeadline <= startedAt) return;
    let timer: number | null = null;
    const tick = () => {
      const next = performance.now();
      setNow(next);
      if (next >= latestDeadline && timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    };
    timer = window.setInterval(tick, 100);
    return () => {
      if (timer !== null) window.clearInterval(timer);
    };
  }, [attackCooldownUntil, cooldowns]);

  if (!self) return null;
  const ironGuardActive = self.class === "warrior" && self.guarding === true;

  return (
    <section className="skill-bar panel" aria-label={t("hud.abilities")}>
      {CLASS_SKILLS[self.class].map((skill) => {
        const cooldownUntil = skill.slot === 1 ? attackCooldownUntil : cooldowns[skill.slot];
        const remaining = Math.max(0, cooldownUntil - now);
        const cooling = remaining > 0;
        const name = t(`skill.${self.class}.${skill.id}.name` as MessageKey);
        const description = t(`skill.${self.class}.${skill.id}.description` as MessageKey);
        const requiredLevel = SKILL_UNLOCK_LEVEL[skill.slot];
        const unlocked = isSkillUnlocked(self.level, skill.slot);
        const manaCost = skillResourceCost(self.class, skill.slot);
        const lacksMana =
          manaCost > 0 && (selfState?.resource?.current ?? Number.NEGATIVE_INFINITY) < manaCost;
        const guardToggle = self.class === "warrior" && skill.id === "iron_guard";
        const blockedByGuard = ironGuardActive && !guardToggle;
        const unavailable = !unlocked || cooling || lacksMana || blockedByGuard;
        const manaText = manaCost > 0 ? t("skill.mana_cost", { cost: manaCost }) : null;
        const icon = skillIconArt(self.class, skill.slot);
        const iconStyle = {
          backgroundImage: `url("${icon.source}")`,
          backgroundSize: `${icon.frames * 100}% 100%`,
          backgroundPosition: `${icon.frames === 1 ? 0 : (icon.frame / (icon.frames - 1)) * 100}% center`,
        } satisfies CSSProperties;
        return (
          <button
            type="button"
            key={skill.id}
            className={`skill-slot${unavailable ? " cooling" : ""}${guardToggle && ironGuardActive ? " active" : ""}`}
            disabled={!game || self.life !== "alive" || unavailable}
            onClick={() => game?.castSkill(skill.slot)}
            aria-pressed={guardToggle ? ironGuardActive : undefined}
            aria-label={`${skill.slot}. ${name}`}
            aria-keyshortcuts={String(skill.slot)}
            title={
              unlocked
                ? `${name} — ${description} · ${skill.cooldownMs / 1000}s${manaText ? ` · ${manaText}` : ""}`
                : `${name} — ${t("skill.unlock_at", { level: requiredLevel })}`
            }
          >
            <span className="skill-slot__key">{skill.slot}</span>
            <span
              className={`skill-slot__icon skill-slot__icon--${icon.variant}`}
              style={iconStyle}
              aria-hidden="true"
            />
            <span className="skill-slot__name">{name}</span>
            {manaCost > 0 && <span className="skill-slot__cost">{manaCost}</span>}
            {!unlocked && <span className="skill-slot__lock">{requiredLevel}</span>}
            {cooling && (
              <span className="skill-slot__cooldown" aria-hidden="true">
                {(remaining / 1000).toFixed(remaining < 950 ? 1 : 0)}
              </span>
            )}
            <span className="skill-slot__tooltip" role="tooltip">
              {unlocked
                ? `${description}${manaText ? ` · ${manaText}` : ""}`
                : t("skill.unlock_at", { level: requiredLevel })}
            </span>
          </button>
        );
      })}
    </section>
  );
}
