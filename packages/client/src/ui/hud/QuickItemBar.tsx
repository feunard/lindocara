import { normalizeConsumables } from "@lindocara/engine/consumables.js";
import { consumableIconSource } from "@lindocara/renderer/tiny-swords-art.js";
import { useSelector } from "alepha/react";
import { useEffect, useMemo, useState } from "react";
import { t, useLocale } from "../../i18n.js";
import { quickItemsAtom } from "../../state/atoms.js";
import { useUiStore } from "../../store.js";

const QUICK_SLOT_KEYS = ["quick-item-1", "quick-item-2", "quick-item-3"] as const;
const QUICK_SLOT_DIRECTIONS = ["left", "up", "right"] as const;

export function QuickItemBar() {
  useLocale();
  const game = useUiStore((state) => state.game);
  const self = useUiStore((state) => state.self);
  const selfState = useUiStore((state) => state.selfState);
  const inventoryOpen = useUiStore((state) => state.inventoryOpen);
  const setInventoryOpen = useUiStore((state) => state.setInventoryOpen);
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
        const direction = QUICK_SLOT_DIRECTIONS[index] ?? "left";
        return (
          <button
            type="button"
            key={QUICK_SLOT_KEYS[index]}
            className={`quick-item-bar__slot quick-item-bar__slot--${direction}`}
            disabled={unavailable}
            onClick={() => item && consumeQuickItem?.(item)}
            aria-label={
              item
                ? t("inventory.use", { item: t(`consumable.${item}.name`) })
                : t("inventory.empty")
            }
          >
            {item ? (
              <img src={consumableIconSource(item)} alt="" />
            ) : (
              <span className="quick-item-bar__empty">+</span>
            )}
            {item && <b>×{counts[item]}</b>}
            {remaining > 0 && <em>{(remaining / 1_000).toFixed(remaining < 950 ? 1 : 0)}</em>}
          </button>
        );
      })}
      <span className="quick-item-bar__core" aria-hidden="true" />
      <button
        type="button"
        className="quick-item-bar__inventory quick-item-bar__slot--down"
        aria-label={t("inventory.title")}
        aria-pressed={inventoryOpen}
        onClick={() => setInventoryOpen(!inventoryOpen)}
      >
        <span className="quick-item-bar__bag" aria-hidden="true" />
      </button>
    </section>
  );
}
