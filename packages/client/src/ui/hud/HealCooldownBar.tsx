import { CLASS_STATS } from "@lindocara/engine/game.js";
import { useEffect, useState } from "react";
import { t } from "../../i18n.js";
import { useUiStore } from "../../store.js";
import { Bar } from "./Bar.js";

const PRIEST_HEAL = CLASS_STATS.priest.heal;
if (!PRIEST_HEAL) throw new Error("priest heal stats missing");
const HEAL_COOLDOWN_MS = PRIEST_HEAL.cooldownMs;

/** Remaining cooldown, clamped to 0, for the given deadline at `now`. */
function remainingAt(now: number, until: number): number {
  return Math.max(0, until - now);
}

export function HealCooldownBar() {
  const healCooldownUntil = useUiStore((s) => s.healCooldownUntil);
  const [remaining, setRemaining] = useState(() =>
    remainingAt(performance.now(), healCooldownUntil),
  );

  useEffect(() => {
    let frame: number | null = null;
    const tick = () => {
      const next = remainingAt(performance.now(), healCooldownUntil);
      setRemaining(next);
      // Stop rescheduling once the cooldown drains; setHealCooldownUntil on the next
      // heal changes the effect's dependency and restarts the loop.
      if (next > 0) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [healCooldownUntil]);

  if (remaining <= 0) return null;

  return (
    <section className="panel combat">
      <div className="panel-title">
        {/* panel-icon--sword is a blade; --oath's sparkle (styles/legacy.css) reads closer to
            a priest's blessing. panel-icon--pack would be a no-op here — it shares --sword's
            sprite frame exactly. */}
        <span className="panel-icon panel-icon--oath" aria-hidden="true" />
        <strong>{t("hud.heal")}</strong>
      </div>
      <Bar value={HEAL_COOLDOWN_MS - remaining} max={HEAL_COOLDOWN_MS} variant="xp" />
    </section>
  );
}
