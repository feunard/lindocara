import type { ConsumableCurrency } from "../../shared/consumables.js";

interface CurrencyAmountProps {
  currency: ConsumableCurrency;
  amount: number;
  label: string;
  compact?: boolean;
}

export function CurrencyAmount({ currency, amount, label, compact = false }: CurrencyAmountProps) {
  const icon = currency === "gold" ? "gold" : "crystal";
  return (
    <span
      className={`currency-amount${compact ? " currency-amount--compact" : ""}`}
      role="img"
      aria-label={`${amount} ${label}`}
      title={label}
    >
      <span className={`currency-amount__icon currency-amount__icon--${icon}`} aria-hidden="true" />
      <span aria-hidden="true">{amount}</span>
    </span>
  );
}
