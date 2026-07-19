import { type CSSProperties, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { MessageKey } from "../../../shared/i18n/index.js";
import { skillResourceCost } from "../../../shared/resources.js";
import type { SkillSlot } from "../../../shared/skills.js";
import { CLASS_SKILLS, isSkillUnlocked, SKILL_UNLOCK_LEVEL } from "../../../shared/skills.js";
import { evolvedTalent } from "../../../shared/talents.js";
import {
  getInputSettings,
  keyboardBindingLabel,
  subscribeInputSettings,
} from "../../game/input-settings.js";
import { skillIconArt } from "../../game/tiny-swords-art.js";
import { t } from "../../i18n.js";
import { useUiStore } from "../../store.js";

export const SKILL_PAD_LAYOUT: Readonly<
  Record<SkillSlot, { row: 1 | 2; column: 1 | 2 | 3; numpad: 1 | 2 | 3 | 4 | 5 }>
> = {
  1: { row: 1, column: 2, numpad: 5 },
  2: { row: 2, column: 3, numpad: 3 },
  3: { row: 2, column: 2, numpad: 2 },
  4: { row: 2, column: 1, numpad: 1 },
  5: { row: 1, column: 1, numpad: 4 },
};

export function SkillBar() {
  const self = useUiStore((state) => state.self);
  const game = useUiStore((state) => state.game);
  const selfState = useUiStore((state) => state.selfState);
  const attackCooldownUntil = useUiStore((state) => state.attackCooldownUntil);
  const cooldowns = useUiStore((state) => state.skillCooldowns);
  const inputSettings = useSyncExternalStore(
    subscribeInputSettings,
    getInputSettings,
    getInputSettings,
  );
  const [now, setNow] = useState(() => performance.now());
  const heldPointer = useRef<{ pointerId: number; slot: SkillSlot } | null>(null);

  useEffect(() => {
    const releaseHeldPointer = (event: PointerEvent) => {
      const held = heldPointer.current;
      if (!held || held.pointerId !== event.pointerId) return;
      heldPointer.current = null;
      useUiStore.getState().game?.releaseSkill?.(held.slot);
    };
    window.addEventListener("pointerup", releaseHeldPointer);
    window.addEventListener("pointercancel", releaseHeldPointer);
    return () => {
      window.removeEventListener("pointerup", releaseHeldPointer);
      window.removeEventListener("pointercancel", releaseHeldPointer);
      const held = heldPointer.current;
      if (held) useUiStore.getState().game?.releaseSkill?.(held.slot);
      heldPointer.current = null;
    };
  }, []);

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
        const evolved = evolvedTalent(self.class, selfState?.talents?.selected ?? [], skill.slot);
        const name = evolved
          ? t(`talent.evolution.${self.class}.${skill.id}.name` as MessageKey)
          : t(`skill.${self.class}.${skill.id}.name` as MessageKey);
        const description = evolved
          ? t(`talent.evolution.${self.class}.${skill.id}.description` as MessageKey)
          : t(`skill.${self.class}.${skill.id}.description` as MessageKey);
        const requiredLevel = SKILL_UNLOCK_LEVEL[skill.slot];
        const unlocked = isSkillUnlocked(self.level, skill.slot);
        const manaCost = skillResourceCost(self.class, skill.slot);
        const lacksMana =
          manaCost > 0 && (selfState?.resource?.current ?? Number.NEGATIVE_INFINITY) < manaCost;
        const guardToggle = self.class === "warrior" && skill.id === "iron_guard";
        const heldSkill = self.class === "priest" && skill.id === "blink";
        const blockedByGuard = ironGuardActive && !guardToggle;
        const unavailable = !unlocked || cooling || lacksMana || blockedByGuard;
        const manaText = manaCost > 0 ? t("skill.mana_cost", { cost: manaCost }) : null;
        const icon = skillIconArt(self.class, skill.slot);
        const control = `skill${skill.slot}` as const;
        const keyBindings = inputSettings.keyboard[control];
        const layout = SKILL_PAD_LAYOUT[skill.slot];
        const numpadLabel =
          keyBindings
            .filter((binding) => binding.code.startsWith("Numpad"))
            .map(keyboardBindingLabel)[0] ?? `Num ${layout.numpad}`;
        const primaryLabels = keyBindings
          .filter((binding) => !binding.code.startsWith("Numpad"))
          .map(keyboardBindingLabel);
        const iconStyle = {
          backgroundImage: `url("${icon.source}")`,
          backgroundSize: `${icon.frames * 100}% 100%`,
          backgroundPosition: `${icon.frames === 1 ? 0 : (icon.frame / (icon.frames - 1)) * 100}% center`,
        } satisfies CSSProperties;
        return (
          <button
            type="button"
            key={skill.id}
            className={`skill-slot skill-slot--${skill.slot}${unavailable ? " cooling" : ""}${guardToggle && ironGuardActive ? " active" : ""}${evolved ? " evolved" : ""}`}
            style={{ gridRow: layout.row, gridColumn: layout.column }}
            data-numpad={layout.numpad}
            disabled={!game || self.life !== "alive" || unavailable}
            onPointerDown={
              heldSkill
                ? (event) => {
                    event.currentTarget.setPointerCapture?.(event.pointerId);
                    heldPointer.current = { pointerId: event.pointerId, slot: skill.slot };
                    game?.castSkill(skill.slot);
                  }
                : undefined
            }
            onClick={(event) => {
              if (!heldSkill) game?.castSkill(skill.slot);
              else if (event.detail === 0) {
                game?.castSkill(skill.slot);
                game?.releaseSkill?.(skill.slot);
              }
            }}
            aria-pressed={guardToggle ? ironGuardActive : undefined}
            aria-label={`${skill.slot}. ${name}`}
            aria-keyshortcuts={keyBindings.map((binding) => binding.code).join(" ")}
            title={
              unlocked
                ? `${name} — ${description} · ${skill.cooldownMs / 1000}s${manaText ? ` · ${manaText}` : ""}`
                : `${name} — ${t("skill.unlock_at", { level: requiredLevel })}`
            }
          >
            <span className="skill-slot__key">{primaryLabels.join(" / ")}</span>
            <span className="skill-slot__pad" aria-hidden="true">
              {numpadLabel}
            </span>
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
