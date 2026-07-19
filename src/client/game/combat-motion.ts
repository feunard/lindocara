export type MobilitySkillId = "shield_bash" | "dash" | "blink";

export interface MobilityVisual {
  durationMs: number;
  color: number;
  width: number;
}

const MOBILITY_VISUALS: Readonly<Record<MobilitySkillId, MobilityVisual>> = {
  shield_bash: { durationMs: 230, color: 0xffd66b, width: 14 },
  dash: { durationMs: 190, color: 0x6ad9ff, width: 10 },
  blink: { durationMs: 300, color: 0xc9a7ff, width: 18 },
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

/** Fades Lumen Step out, remains clouded while held, then rematerializes after release. */
export function lumenStepOpacity(
  startedAt: number,
  impactAt: number,
  channelEndsAt: number | undefined,
  recoveryEndsAt: number,
  now: number,
): number {
  if (now <= startedAt || now >= recoveryEndsAt) return 1;
  const minimum = 0.06;
  if (now <= impactAt) {
    const progress = (now - startedAt) / Math.max(1, impactAt - startedAt);
    return 1 - (1 - minimum) * Math.max(0, Math.min(1, progress));
  }
  if (channelEndsAt === undefined || now <= channelEndsAt) return minimum;
  const progress = (now - channelEndsAt) / Math.max(1, recoveryEndsAt - channelEndsAt);
  return minimum + (1 - minimum) * Math.max(0, Math.min(1, progress));
}
