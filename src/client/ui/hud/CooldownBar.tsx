import { useEffect, useState } from "react";
import { ATTACK_COOLDOWN_MS } from "../../../shared/game.js";
import { t } from "../../i18n.js";
import { useUiStore } from "../../store.js";
import { Bar } from "./Bar.js";

/** Remaining cooldown, clamped to 0, for the given deadline at `now`. */
function remainingAt(now: number, until: number): number {
  return Math.max(0, until - now);
}

export function CooldownBar() {
  const attackCooldownUntil = useUiStore((s) => s.attackCooldownUntil);
  const [remaining, setRemaining] = useState(() =>
    remainingAt(performance.now(), attackCooldownUntil),
  );

  useEffect(() => {
    let frame: number | null = null;
    const tick = () => {
      const next = remainingAt(performance.now(), attackCooldownUntil);
      setRemaining(next);
      // Stop rescheduling once the cooldown drains; setAttackCooldownUntil on the next
      // attack changes the effect's dependency and restarts the loop.
      if (next > 0) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [attackCooldownUntil]);

  if (remaining <= 0) return null;

  return (
    <section className="panel combat">
      <div className="panel-title">
        <span className="panel-icon panel-icon--sword" aria-hidden="true" />
        <strong>{t("hud.strike")}</strong>
      </div>
      <Bar value={ATTACK_COOLDOWN_MS - remaining} max={ATTACK_COOLDOWN_MS} variant="quest" />
    </section>
  );
}
