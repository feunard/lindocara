import { DEFAULT_APPEARANCE, isPrimaryColor, type PrimaryColor } from "../../shared/character.js";
import type { EventCode } from "../../shared/protocol.js";

export const MAX_ACTIVE_WORLD_EFFECTS = 28;

/** Only immediate spatial combat outcomes belong above actors. */
export function shouldFloatEvent(code: EventCode): boolean {
  return (
    code === "combat.hit" ||
    code === "combat.hurt" ||
    code === "heal.cast" ||
    code === "heal.received" ||
    code === "level_up"
  );
}

/** Healing VFX always inherit the caster's validated Tiny Swords faction colour. */
export function healingEffectColor(value: unknown): PrimaryColor {
  return isPrimaryColor(value) ? value : DEFAULT_APPEARANCE.primaryColor;
}

/** Puzzle presentation intentionally has no expected-order input, so it cannot reveal the answer. */
export function questSiteFeedback(
  active: boolean,
  distance: number,
): {
  signalAlpha: 0;
  labelAlpha: number;
} {
  return { signalAlpha: 0, labelAlpha: active && distance < 145 ? 0.9 : 0 };
}
