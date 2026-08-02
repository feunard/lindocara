import { useState } from "react";
import { t, useLocale } from "../../i18n.js";
import { useUiStore } from "../../store.js";
import { TinyButton } from "../tiny-swords/TinyButton.js";
import { TinyInput } from "../tiny-swords/TinyInput.js";
import { TinyPanel } from "../tiny-swords/TinyPanel.js";

export function CampBankPanel() {
  useLocale();
  const bank = useUiStore((state) => state.campBank);
  const personalGold = useUiStore((state) => state.selfState?.inventory.gold ?? 0);
  const game = useUiStore((state) => state.game);
  const setCampBank = useUiStore((state) => state.setCampBank);
  const [amount, setAmount] = useState("1");
  if (!bank) return null;

  const parsed = Number(amount);
  const valid = Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 1_000_000;
  const transfer = (operation: "deposit" | "withdraw") => {
    if (!valid) return;
    game?.campGold?.(bank.id, operation, parsed);
  };

  return (
    <TinyPanel
      className="camp-bank"
      role="dialog"
      aria-modal="false"
      aria-labelledby="camp-bank-title"
    >
      <div className="camp-bank__heading">
        <div>
          <strong id="camp-bank-title">{t("camp.bank.title")}</strong>
          <span>{t("camp.bank.shared")}</span>
        </div>
        <TinyButton
          type="button"
          size="sm"
          variant="secondary"
          aria-label={t("camp.bank.close")}
          onClick={() => setCampBank(null)}
        >
          ×
        </TinyButton>
      </div>
      <div className="camp-bank__balances" aria-live="polite">
        <span>
          {t("camp.bank.personal")} <strong>{personalGold}</strong>
        </span>
        <span>
          {t("camp.bank.chest")} <strong>{bank.gold}</strong>
        </span>
      </div>
      <label className="camp-bank__amount" htmlFor="camp-bank-amount">
        <span>{t("camp.bank.amount")}</span>
        <TinyInput
          id="camp-bank-amount"
          className="camp-bank__input"
          type="number"
          inputMode="numeric"
          min={1}
          max={1_000_000}
          step={1}
          value={amount}
          onChange={(event) => setAmount(event.currentTarget.value)}
        />
      </label>
      <div className="camp-bank__actions">
        <TinyButton
          className="camp-bank__action"
          type="button"
          size="sm"
          disabled={!valid || parsed > personalGold}
          onClick={() => transfer("deposit")}
        >
          {t("camp.bank.deposit")}
        </TinyButton>
        <TinyButton
          className="camp-bank__action"
          type="button"
          size="sm"
          variant="secondary"
          disabled={!valid || parsed > bank.gold}
          onClick={() => transfer("withdraw")}
        >
          {t("camp.bank.withdraw")}
        </TinyButton>
      </div>
    </TinyPanel>
  );
}
