import { CONSUMABLE_IDS, normalizeConsumables } from "@lindocara/engine/consumables.js";
import { useEffect, useRef, useState } from "react";
import { firstConnectedGamepad } from "../game/input-settings.js";
import { consumableIconSource } from "../game/tiny-swords-art.js";
import { t, useLocale } from "../i18n.js";
import { useUiStore } from "../store.js";
import { CurrencyAmount } from "./CurrencyAmount.js";
import { TinyButton } from "./tiny-swords/TinyButton.js";

export function InventoryOverlay() {
  useLocale();
  const open = useUiStore((state) => state.inventoryOpen);
  const selfState = useUiStore((state) => state.selfState);
  const quickItems = useUiStore((state) => state.quickItems);
  const setQuickItem = useUiStore((state) => state.setQuickItem);
  const setOpen = useUiStore((state) => state.setInventoryOpen);
  const [selectedItem, setSelectedItem] = useState(0);
  const [selectedSlot, setSelectedSlot] = useState<0 | 1 | 2>(0);
  const selectedItemRef = useRef(0);
  const selectedSlotRef = useRef<0 | 1 | 2>(0);
  useEffect(() => {
    if (!open) return;
    let frame = 0;
    let previous = new Set<number>();
    const poll = () => {
      const pad = firstConnectedGamepad();
      const pressed = new Set<number>();
      if (pad) {
        for (const index of [0, 1, 12, 13, 14, 15])
          if (pad.buttons[index]?.pressed) pressed.add(index);
        if (pressed.has(12) && !previous.has(12)) {
          selectedItemRef.current =
            (selectedItemRef.current + CONSUMABLE_IDS.length - 1) % CONSUMABLE_IDS.length;
          setSelectedItem(selectedItemRef.current);
        }
        if (pressed.has(13) && !previous.has(13)) {
          selectedItemRef.current = (selectedItemRef.current + 1) % CONSUMABLE_IDS.length;
          setSelectedItem(selectedItemRef.current);
        }
        if (pressed.has(14) && !previous.has(14)) {
          selectedSlotRef.current = ((selectedSlotRef.current + 2) % 3) as 0 | 1 | 2;
          setSelectedSlot(selectedSlotRef.current);
        }
        if (pressed.has(15) && !previous.has(15)) {
          selectedSlotRef.current = ((selectedSlotRef.current + 1) % 3) as 0 | 1 | 2;
          setSelectedSlot(selectedSlotRef.current);
        }
        if (pressed.has(0) && !previous.has(0)) {
          const item = CONSUMABLE_IDS[selectedItemRef.current];
          if (item) setQuickItem(selectedSlotRef.current, item);
        }
        if (pressed.has(1) && !previous.has(1)) setOpen(false);
      }
      previous = pressed;
      frame = window.requestAnimationFrame(poll);
    };
    frame = window.requestAnimationFrame(poll);
    return () => window.cancelAnimationFrame(frame);
  }, [open, setOpen, setQuickItem]);
  if (!open) return null;

  const counts = normalizeConsumables(
    selfState?.inventory.consumables,
    selfState?.inventory.potions ?? 0,
  );

  return (
    <section
      className="item-overlay panel"
      role="dialog"
      aria-modal="true"
      aria-label={t("inventory.title")}
    >
      <header className="item-overlay__header">
        <div>
          <span className="item-overlay__eyebrow">{t("inventory.eyebrow")}</span>
          <h2>{t("inventory.title")}</h2>
        </div>
        <fieldset className="currency-wallet" aria-label={t("merchant.wallet")}>
          <CurrencyAmount
            currency="gold"
            amount={selfState?.inventory.gold ?? 0}
            label={t("item.gold")}
          />
          <CurrencyAmount
            currency="crystals"
            amount={selfState?.inventory.crystals ?? 0}
            label={t("item.crystal")}
          />
        </fieldset>
        <TinyButton size="sm" variant="secondary" onClick={() => setOpen(false)}>
          {t("common.close")}
        </TinyButton>
      </header>
      <p className="item-overlay__hint">{t("inventory.hint")}</p>
      <p className="item-overlay__hint item-overlay__hint--controller">
        {t("inventory.controller_hint")}
      </p>
      <div className="item-grid">
        {CONSUMABLE_IDS.map((item, itemIndex) => (
          <article
            className={`item-card${selectedItem === itemIndex ? " selected" : ""}`}
            key={item}
          >
            <img src={consumableIconSource(item)} alt="" className="item-card__icon" />
            <div className="item-card__copy">
              <strong>{t(`consumable.${item}.name`)}</strong>
              <span>{t(`consumable.${item}.description`)}</span>
            </div>
            <b className="item-card__count">×{counts[item]}</b>
            <fieldset className="item-card__slots">
              <legend className="sr-only">{t("inventory.assign")}</legend>
              {([0, 1, 2] as const).map((slot) => (
                <button
                  type="button"
                  key={slot}
                  className={`${quickItems[slot] === item ? "active" : ""}${selectedItem === itemIndex && selectedSlot === slot ? " selected" : ""}`}
                  onClick={() => setQuickItem(slot, item)}
                  aria-pressed={quickItems[slot] === item}
                >
                  {slot + 1}
                </button>
              ))}
            </fieldset>
          </article>
        ))}
      </div>
    </section>
  );
}
