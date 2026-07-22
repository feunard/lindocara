import { PARTY_COLORS, type PartyColor } from "@lindocara/engine/party.js";
import { TinyButton } from "@/ui/tiny-swords/TinyButton.js";
import { t, useLocale } from "../i18n.js";

/** Hex per colour so swatches read even without art; kept minimal and legible. */
const SWATCH: Record<PartyColor, string> = {
  blue: "#3b82f6",
  red: "#ef4444",
  yellow: "#eab308",
  purple: "#a855f7",
};

export function ColorPicker(props: {
  value: PartyColor | null;
  taken: readonly PartyColor[];
  onPick(color: PartyColor): void;
}) {
  useLocale();
  return (
    <fieldset className="color-picker" aria-label={t("party.color.label")}>
      {PARTY_COLORS.map((color) => {
        const isTaken = props.taken.includes(color) && props.value !== color;
        return (
          <TinyButton
            key={color}
            type="button"
            variant={props.value === color ? "default" : "secondary"}
            aria-pressed={props.value === color}
            disabled={isTaken}
            onClick={() => props.onPick(color)}
            style={{ borderLeft: `12px solid ${SWATCH[color]}` }}
          >
            {t(`party.color.${color}`)}
          </TinyButton>
        );
      })}
    </fieldset>
  );
}
