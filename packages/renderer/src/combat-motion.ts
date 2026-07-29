export type MobilitySkillId = "shield_bash" | "dash" | "blink" | "shadow_step";

export interface MobilityVisual {
  durationMs: number;
  color: number;
  width: number;
}

export interface ShadowDanceVisualStrike {
  impactAt: number;
  landing: { x: number; y: number };
}

export interface ScheduledShadowDanceStrike extends ShadowDanceVisualStrike {
  localImpactAt: number;
}

export interface ShadowDanceVisualSchedule<T extends ShadowDanceVisualStrike> {
  strikes: Array<T & { localImpactAt: number }>;
  localEndsAt: number;
}

const MOBILITY_VISUALS: Readonly<Record<MobilitySkillId, MobilityVisual>> = {
  shield_bash: { durationMs: 230, color: 0xffd66b, width: 14 },
  dash: { durationMs: 190, color: 0x6ad9ff, width: 10 },
  blink: { durationMs: 300, color: 0xc9a7ff, width: 18 },
  shadow_step: { durationMs: 180, color: 0x8050c8, width: 13 },
};

export function mobilityVisual(skillId: string | undefined): MobilityVisual | null {
  if (
    skillId === "shield_bash" ||
    skillId === "dash" ||
    skillId === "blink" ||
    skillId === "shadow_step"
  )
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

/**
 * Replays the complete server-authored route from receipt time. Network delay may put every
 * authoritative timestamp in the past, but must never collapse all teleports into one frame.
 */
export function scheduleShadowDanceReplay<T extends ShadowDanceVisualStrike>(
  strikes: readonly T[],
  serverStartedAt: number,
  serverEndsAt: number,
  receivedAt: number,
): ShadowDanceVisualSchedule<T> {
  const durationMs = Math.max(1, serverEndsAt - serverStartedAt);
  let previousImpactAt = receivedAt - 1;
  const scheduled = strikes.map((strike) => {
    const relativeImpactAt = Math.max(0, Math.min(durationMs, strike.impactAt - serverStartedAt));
    const localImpactAt = Math.max(previousImpactAt + 1, receivedAt + relativeImpactAt);
    previousImpactAt = localImpactAt;
    return { ...strike, localImpactAt };
  });
  return {
    strikes: scheduled,
    localEndsAt: Math.max(receivedAt + durationMs, previousImpactAt + 1),
  };
}

/** Returns only a presentation position from the already-authoritative ordered landings. */
export function shadowDancePositionAfter<T extends Pick<ShadowDanceVisualStrike, "landing">>(
  origin: { x: number; y: number },
  strikes: readonly T[],
  completedStrikes: number,
): { x: number; y: number } {
  if (completedStrikes <= 0 || strikes.length === 0) return { ...origin };
  const strike = strikes[Math.min(completedStrikes, strikes.length) - 1];
  return strike ? { ...strike.landing } : { ...origin };
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
