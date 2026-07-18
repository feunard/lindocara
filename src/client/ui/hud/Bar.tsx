import { TinyBarTrack } from "../tiny-swords/TinyBarTrack.js";

const VARIANTS = ["hp", "xp", "quest", "mana"] as const;
type BarVariant = (typeof VARIANTS)[number];

export function Bar({
  value,
  max,
  variant = "hp",
}: {
  value: number;
  max: number;
  variant?: BarVariant;
}) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      className="tiny-bar"
      data-variant={variant}
    >
      <TinyBarTrack className="tiny-bar__track" />
      <div className="tiny-bar__channel">
        <div data-fill className="tiny-bar__clip" style={{ width: `${ratio * 100}%` }}>
          <div className="tiny-bar__fill" />
        </div>
      </div>
    </div>
  );
}
