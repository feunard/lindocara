import { t, useLocale } from "../../i18n.js";
import { useUiStore } from "../../store.js";
import { Bar } from "./Bar.js";

export function TargetFrame() {
  useLocale();
  const target = useUiStore((state) => state.combatTarget);
  const game = useUiStore((state) => state.game);
  if (!target) return null;

  return (
    <section
      className={`target-frame panel target-frame--${target.kind}`}
      aria-label={t("hud.target")}
    >
      <div>
        <span>{t(target.kind === "monster" ? "hud.target.hostile" : "hud.target.friendly")}</span>
        <strong>{target.name}</strong>
      </div>
      <Bar value={target.hp} max={target.maxHp} variant="hp" />
      <span>
        {target.hp}/{target.maxHp}
      </span>
      <button
        type="button"
        onClick={() => game?.clearTarget?.()}
        aria-label={t("hud.target.clear")}
      >
        ×
      </button>
    </section>
  );
}
