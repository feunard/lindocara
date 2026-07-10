import { cn } from "@/lib/utils.js";
import { setLocale, useLocale } from "../i18n.js";

const LOCALES = ["en", "fr"] as const;

export function LocaleToggle() {
  const locale = useLocale();
  return (
    <fieldset id="locale-toggle" aria-label="Language / Langue">
      {LOCALES.map((code) => (
        <button
          key={code}
          type="button"
          className={cn(locale === code && "active")}
          onClick={() => setLocale(code)}
        >
          {code.toUpperCase()}
        </button>
      ))}
    </fieldset>
  );
}
