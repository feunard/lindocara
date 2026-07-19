export type MobilitySkillId = "shield_bash" | "dash" | "blink";

export interface MobilityVisual {
  durationMs: number;
  color: number;
  width: number;
}

const MOBILITY_VISUALS: Readonly<Record<MobilitySkillId, MobilityVisual>> = {
  shield_bash: { durationMs: 230, color: 0xffd66b, width: 14 },
  dash: { durationMs: 190, color: 0x6ad9ff, width: 10 },
  blink: { durationMs: 210, color: 0xb48cff, width: 12 },
};

export function mobilityVisual(skillId: string | undefined): MobilityVisual | null {
  if (skillId === "shield_bash" || skillId === "dash" || skillId === "blink")
    return MOBILITY_VISUALS[skillId];
  return null;
}

/** Keeps simulation coordinates authoritative while easing only their rendered presentation. */
export function mobilityRenderOffset(
  offsetX: number,
  offsetY: number,
  startedAt: number,
  durationMs: number,
  now: number,
): { x: number; y: number } {
  const progress = Math.max(0, Math.min(1, (now - startedAt) / Math.max(1, durationMs)));
  if (progress >= 1) return { x: 0, y: 0 };
  const remaining = (1 - progress) ** 2;
  return { x: offsetX * remaining, y: offsetY * remaining };
}
