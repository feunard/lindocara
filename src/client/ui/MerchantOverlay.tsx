import { useEffect, useRef, useState } from "react";
import { CONSUMABLE_IDS, CONSUMABLES, normalizeConsumables } from "../../shared/consumables.js";
import { firstConnectedGamepad } from "../game/input-settings.js";
import { consumableIconSource } from "../game/tiny-swords-art.js";
import { t, useLocale } from "../i18n.js";
import { useUiStore } from "../store.js";
import { CurrencyAmount } from "./CurrencyAmount.js";
import { TinyButton } from "./tiny-swords/TinyButton.js";

export function MerchantOverlay() {
  useLocale();
  const open = useUiStore((state) => state.merchantOpen);
  const selfState = useUiStore((state) => state.selfState);
  const game = useUiStore((state) => state.game);
  const setOpen = useUiStore((state) => state.setMerchantOpen);
  const [selected, setSelected] = useState(0);
  const selectedRef = useRef(0);
  useEffect(() => {
    if (!open) return;
    let frame = 0;
    let previous = new Set<number>();
    const poll = () => {
      const pad = firstConnectedGamepad();
      const pressed = new Set<number>();
      if (pad) {
        for (const index of [0, 1, 12, 13]) if (pad.buttons[index]?.pressed) pressed.add(index);
        if (pressed.has(12) && !previous.has(12)) {
          selectedRef.current =
            (selectedRef.current + CONSUMABLE_IDS.length - 1) % CONSUMABLE_IDS.length;
          setSelected(selectedRef.current);
        }
        if (pressed.has(13) && !previous.has(13)) {
          selectedRef.current = (selectedRef.current + 1) % CONSUMABLE_IDS.length;
          setSelected(selectedRef.current);
        }
        if (pressed.has(0) && !previous.has(0)) {
          const item = CONSUMABLE_IDS[selectedRef.current];
          if (item) game?.buyItem?.(item);
        }
        if (pressed.has(1) && !previous.has(1)) setOpen(false);
      }
      previous = pressed;
      frame = window.requestAnimationFrame(poll);
    };
    frame = window.requestAnimationFrame(poll);
    return () => window.cancelAnimationFrame(frame);
  }, [game, open, setOpen]);
  if (!open || !selfState) return null;
  const counts = normalizeConsumables(selfState.inventory.consumables, selfState.inventory.potions);

  return (
    <section
      className="item-overlay item-overlay--merchant panel"
      role="dialog"
      aria-modal="true"
      aria-label={t("merchant.title")}
    >
      <header className="item-overlay__header">
        <div>
          <span className="item-overlay__eyebrow">{t("merchant.eyebrow")}</span>
          <h2>{t("merchant.title")}</h2>
        </div>
        <div className="currency-wallet" title={t("merchant.wallet")}>
          <CurrencyAmount
            currency="gold"
            amount={selfState.inventory.gold}
            label={t("item.gold")}
          />
          <CurrencyAmount
            currency="crystals"
            amount={selfState.inventory.crystals}
            label={t("item.crystal")}
          />
        </div>
        <TinyButton size="sm" variant="secondary" onClick={() => setOpen(false)}>
          {t("common.close")}
        </TinyButton>
      </header>
      <p className="item-overlay__hint">{t("merchant.hint")}</p>
      <div className="item-grid">
        {CONSUMABLE_IDS.map((item, index) => {
          const definition = CONSUMABLES[item];
          const funds = selfState.inventory[definition.currency];
          return (
            <article className={`item-card${selected === index ? " selected" : ""}`} key={item}>
              <img src={consumableIconSource(item)} alt="" className="item-card__icon" />
              <div className="item-card__copy">
                <strong>{t(`consumable.${item}.name`)}</strong>
                <span>{t(`consumable.${item}.description`)}</span>
              </div>
              <b className="item-card__count">{t("merchant.owned", { count: counts[item] })}</b>
              <TinyButton
                size="sm"
                disabled={!game?.buyItem || funds < definition.price}
                onClick={() => game?.buyItem?.(item)}
              >
                <CurrencyAmount
                  currency={definition.currency}
                  amount={definition.price}
                  label={t(definition.currency === "gold" ? "item.gold" : "item.crystal")}
                  compact
                />
              </TinyButton>
            </article>
          );
        })}
      </div>
    </section>
  );
}
