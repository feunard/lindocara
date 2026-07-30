import { normalizeConsumables } from "@lindocara/engine/consumables.js";
import { consumableIconSource } from "@lindocara/renderer/tiny-swords-art.js";
import { useSelector } from "alepha/react";
import { useEffect, useMemo, useState } from "react";
import { t, useLocale } from "../../i18n.js";
import { quickItemsAtom } from "../../state/atoms.js";
import { useUiStore } from "../../store.js";
import { controlBindingLabel, useInputModeSettings } from "../input-hints.js";

const QUICK_SLOT_KEYS = ["quick-item-1", "quick-item-2", "quick-item-3"] as const;
const QUICK_SLOT_CONTROLS = ["item1", "item2", "item3"] as const;

export function QuickItemBar() {
  useLocale();
  const { mode, settings } = useInputModeSettings();
  const game = useUiStore((state) => state.game);
  const self = useUiStore((state) => state.self);
  const selfState = useUiStore((state) => state.selfState);
  const quickItems = useSelector(quickItemsAtom, (s) => s);
  const [now, setNow] = useState(() => performance.now());
  const localDeadline = useMemo(() => {
    const remaining = Math.max(
      0,
      (selfState?.consumableCooldownUntil ?? 0) - (selfState?.serverNow ?? 0),
    );
    return performance.now() + remaining;
  }, [selfState?.consumableCooldownUntil, selfState?.serverNow]);

  useEffect(() => {
    setNow(performance.now());
    if (localDeadline <= performance.now()) return;
    const timer = window.setInterval(() => setNow(performance.now()), 100);
    return () => window.clearInterval(timer);
  }, [localDeadline]);

  if (!game || !self || !selfState) return null;
  const counts = normalizeConsumables(selfState.inventory.consumables, selfState.inventory.potions);
  const remaining = Math.max(0, localDeadline - now);
  const consumeQuickItem = game.useItem;

  return (
    <section className="quick-item-bar panel" aria-label={t("inventory.quickbar")}>
      {quickItems.map((item, index) => {
        const unavailable = !item || counts[item] <= 0 || remaining > 0 || self.life === "ghost";
        return (
          <button
            type="button"
            key={QUICK_SLOT_KEYS[index]}
            disabled={unavailable}
            onClick={() => item && consumeQuickItem?.(item)}
            aria-label={
              item
                ? t("inventory.use", { item: t(`consumable.${item}.name`) })
                : t("inventory.empty")
            }
          >
            <span className="quick-item-bar__key">
              {controlBindingLabel(QUICK_SLOT_CONTROLS[index] ?? "item1", mode, settings)}
            </span>
            {item ? <img src={consumableIconSource(item)} alt="" /> : <span>+</span>}
            {item && <b>×{counts[item]}</b>}
            {remaining > 0 && <em>{(remaining / 1_000).toFixed(remaining < 950 ? 1 : 0)}</em>}
          </button>
        );
      })}
    </section>
  );
}
