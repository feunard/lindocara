import { Kbd } from "@/ui/pixelact-ui/kbd.js";

export function InventoryChip({
  icon,
  label,
  value,
  hotkey,
}: {
  icon: "potion" | "gold" | "crystal" | "sword";
  label: string;
  value: string;
  hotkey?: string;
}) {
  return (
    <fieldset
      className="item-chip"
      // .item-chip (style.css) overrides the UA fieldset border/padding, but not its default
      // inline margin - reset that so the four chips line up flush in .item-grid.
      style={{ margin: 0 }}
      title={hotkey ? `${label} [${hotkey}]` : label}
      aria-label={`${label}: ${value}`}
    >
      <span className={`item-icon item-icon--${icon}`} aria-hidden="true" />
      <span className="item-copy">
        <small>{label}</small>
        <strong>{value}</strong>
      </span>
      {hotkey && <Kbd>{hotkey}</Kbd>}
    </fieldset>
  );
}
