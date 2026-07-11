import { useEffect, useState } from "react";
import type { MessageKey } from "../../../shared/i18n/index.js";
import { CLASS_SKILLS } from "../../../shared/skills.js";
import { skillIconSource } from "../../game/tiny-swords-art.js";
import { t } from "../../i18n.js";
import { useUiStore } from "../../store.js";

export function SkillBar() {
  const self = useUiStore((state) => state.self);
  const game = useUiStore((state) => state.game);
  const cooldowns = useUiStore((state) => state.skillCooldowns);
  const [now, setNow] = useState(() => performance.now());

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      setNow(performance.now());
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  if (!self) return null;

  return (
    <section className="skill-bar panel" aria-label={t("hud.abilities")}>
      {CLASS_SKILLS[self.class].map((skill) => {
        const remaining = Math.max(0, cooldowns[skill.slot] - now);
        const cooling = remaining > 0;
        const name = t(`skill.${self.class}.${skill.id}.name` as MessageKey);
        return (
          <button
            type="button"
            key={skill.id}
            className={cooling ? "skill-slot cooling" : "skill-slot"}
            disabled={!game || self.dead || cooling}
            onClick={() => game?.castSkill(skill.slot)}
            aria-label={`${skill.slot}. ${name}`}
            aria-keyshortcuts={String(skill.slot)}
            title={`${name} · ${skill.cooldownMs / 1000}s`}
          >
            <span className="skill-slot__key">{skill.slot}</span>
            <img
              className="skill-slot__icon"
              src={skillIconSource(self.class, skill.slot)}
              alt=""
            />
            <span className="skill-slot__name">{name}</span>
            {cooling && (
              <span className="skill-slot__cooldown" aria-hidden="true">
                {(remaining / 1000).toFixed(remaining < 950 ? 1 : 0)}
              </span>
            )}
          </button>
        );
      })}
    </section>
  );
}
