import type { TalentEffect } from "@lindocara/engine/talents.js";
import type {
  CleanseableNegativeEffect,
  NegativeEffectRuntime,
  PlayerRuntime,
} from "./world-runtime.js";

type EmergencyMendEffect = Extract<TalentEffect, { kind: "emergency_mend" }>;
type LuminousTransfigurationEffect = Extract<TalentEffect, { kind: "luminous_transfiguration" }>;
type SanctuaryEffect = Extract<TalentEffect, { kind: "sanctuary" }>;
type NovaJudgmentEffect = Extract<TalentEffect, { kind: "nova_judgment" }>;
type NovaMercyEffect = Extract<TalentEffect, { kind: "nova_mercy" }>;
type LifeLinkEffect = Extract<TalentEffect, { kind: "life_link" }>;
type LumenGateEffect = Extract<TalentEffect, { kind: "lumen_gate" }>;
type PolarityOrbEffect = Extract<TalentEffect, { kind: "polarity_orb" }>;

export interface SanctuaryRuntime {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  radius: number;
  power: number;
  nextTickAt: number;
  intervalMs: number;
  ticksRemaining: number;
}

export interface LumenPortalRuntime {
  id: string;
  ownerId: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  expiresAt: number;
  triggerRadius: number;
  usedPlayerIds: Set<string>;
  healingPower: number;
}

export interface PolarityOrbRuntime {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  maximumRadius: number;
  startedAt: number;
  returnsAt: number;
  endsAt: number;
  previousRadius: number;
  outwardHitIds: Set<string>;
  returnHitIds: Set<string>;
}

export function armLifeLink(
  caster: PlayerRuntime,
  targetId: string,
  effect: LifeLinkEffect,
  now: number,
  variant: "base" | "chain" | "emergency",
): void {
  const ratio =
    variant === "chain"
      ? effect.chainRatio
      : variant === "emergency"
        ? effect.emergencyRatio
        : effect.ratio;
  const next = {
    targetId,
    expiresAt: now + Math.max(0, effect.durationMs),
    range: Math.max(0, effect.range),
    ratio: Math.max(0, Math.min(1, ratio)),
    maximumMirroredPower: Math.max(0, effect.maximumMirroredPower),
  };
  caster.priestLifeLinks = caster.priestLifeLinks
    .filter((link) => link.expiresAt > now && link.targetId !== targetId)
    .concat(next)
    .slice(variant === "chain" ? -2 : -1);
}

export function mirroredLifeLinkPower(
  usefulHealing: number,
  link: PlayerRuntime["priestLifeLinks"][number],
): number {
  return Math.max(
    0,
    Math.min(link.maximumMirroredPower, Math.round(Math.max(0, usefulHealing) * link.ratio)),
  );
}

export function startLumenPortal(
  portals: LumenPortalRuntime[],
  options: {
    ownerId: string;
    from: { x: number; y: number };
    to: { x: number; y: number };
    effect: LumenGateEffect;
    now: number;
    transfiguration: boolean;
    healingPower: number;
  },
): LumenPortalRuntime {
  removeLumenPortalsByOwner(portals, options.ownerId);
  const duration = options.transfiguration
    ? options.effect.transfigurationDurationMs
    : options.effect.durationMs;
  const portal: LumenPortalRuntime = {
    id: crypto.randomUUID(),
    ownerId: options.ownerId,
    from: { ...options.from },
    to: { ...options.to },
    expiresAt: options.now + Math.max(0, duration),
    triggerRadius: Math.max(1, options.effect.triggerRadius),
    usedPlayerIds: new Set(),
    healingPower: Math.max(0, Math.round(options.healingPower)),
  };
  portals.push(portal);
  return portal;
}

export function expireLumenPortals(portals: LumenPortalRuntime[], now: number): void {
  for (let index = portals.length - 1; index >= 0; index--) {
    if ((portals[index]?.expiresAt ?? 0) <= now) portals.splice(index, 1);
  }
}

export function removeLumenPortalsByOwner(portals: LumenPortalRuntime[], ownerId: string): void {
  for (let index = portals.length - 1; index >= 0; index--) {
    if (portals[index]?.ownerId === ownerId) portals.splice(index, 1);
  }
}

export function startPolarityOrb(
  orbs: PolarityOrbRuntime[],
  ownerId: string,
  center: { x: number; y: number },
  maximumRadius: number,
  effect: PolarityOrbEffect,
  now: number,
): PolarityOrbRuntime {
  removePolarityOrbsByOwner(orbs, ownerId);
  const outwardMs = Math.max(100, effect.outwardMs);
  const returnMs = Math.max(100, effect.returnMs);
  const orb: PolarityOrbRuntime = {
    id: crypto.randomUUID(),
    ownerId,
    ...center,
    maximumRadius: Math.max(0, maximumRadius),
    startedAt: now,
    returnsAt: now + outwardMs,
    endsAt: now + outwardMs + returnMs,
    previousRadius: 0,
    outwardHitIds: new Set(),
    returnHitIds: new Set(),
  };
  orbs.push(orb);
  return orb;
}

export function polarityOrbRadius(orb: PolarityOrbRuntime, now: number): number {
  if (now <= orb.startedAt) return 0;
  if (now < orb.returnsAt)
    return orb.maximumRadius * ((now - orb.startedAt) / (orb.returnsAt - orb.startedAt));
  if (now < orb.endsAt)
    return orb.maximumRadius * (1 - (now - orb.returnsAt) / (orb.endsAt - orb.returnsAt));
  return 0;
}

export function advancePolarityOrbs(
  orbs: PolarityOrbRuntime[],
  now: number,
  advance: (
    orb: PolarityOrbRuntime,
    fromRadius: number,
    toRadius: number,
    returning: boolean,
  ) => void,
): void {
  for (let index = orbs.length - 1; index >= 0; index--) {
    const orb = orbs[index];
    if (!orb) continue;
    const radius = polarityOrbRadius(orb, now);
    advance(orb, orb.previousRadius, radius, now >= orb.returnsAt);
    orb.previousRadius = radius;
    if (now >= orb.endsAt) orbs.splice(index, 1);
  }
}

export function removePolarityOrbsByOwner(orbs: PolarityOrbRuntime[], ownerId: string): void {
  for (let index = orbs.length - 1; index >= 0; index--) {
    if (orbs[index]?.ownerId === ownerId) orbs.splice(index, 1);
  }
}

export function emergencyMendPower(
  basePower: number,
  targetHp: number,
  targetMaxHp: number,
  effect: EmergencyMendEffect,
): number {
  const woundedRatio = Math.max(0, targetHp) / Math.max(1, targetMaxHp);
  const multiplier = woundedRatio <= effect.threshold ? 1 + effect.powerMultiplier : 1;
  return Math.max(0, Math.round(basePower * multiplier));
}

export function luminousTransfigurationPower(
  level: number,
  effect: LuminousTransfigurationEffect,
): number {
  return Math.max(
    0,
    Math.round(effect.power + Math.max(0, Math.floor(level) - 1) * effect.powerPerLevel),
  );
}

export function novaJudgmentDamageMultiplier(
  targetHp: number,
  targetMaxHp: number,
  effect: NovaJudgmentEffect | undefined,
): number {
  if (!effect) return 1;
  const healthRatio = Math.max(0, targetHp) / Math.max(1, targetMaxHp);
  const execution = healthRatio <= effect.executeThreshold ? 1 + effect.executeMultiplier : 1;
  return Math.max(0, effect.damageMultiplier) * Math.max(0, execution);
}

/** Mercy revives at most one corpse, selected by distance then stable hero id. */
export function nearestMercyCorpse<T extends { id: string }>(
  candidates: Iterable<T>,
  distanceToCorpse: (candidate: T) => number,
  canRevive: (candidate: T) => boolean,
): T | null {
  return (
    [...candidates]
      .filter(canRevive)
      .sort(
        (left, right) =>
          distanceToCorpse(left) - distanceToCorpse(right) || left.id.localeCompare(right.id),
      )[0] ?? null
  );
}

/**
 * Returns every crossed ally once in stable id order. A zero-length movement segment must pass a
 * false `crosses` predicate, so standing still can never manufacture passage healing.
 */
export function sacredPassageTargets<T extends { id: string }>(
  targets: Iterable<T>,
  healedIds: Set<string>,
  crosses: (target: T) => boolean,
): T[] {
  const result: T[] = [];
  for (const target of [...targets].sort((left, right) => left.id.localeCompare(right.id))) {
    if (healedIds.has(target.id) || !crosses(target)) continue;
    healedIds.add(target.id);
    result.push(target);
  }
  return result;
}

export function applyCleanseableNegativeEffect(
  player: PlayerRuntime,
  effect: NegativeEffectRuntime,
): void {
  const current = player.negativeEffects.get(effect.kind);
  if (!current || current.expiresAt <= effect.expiresAt)
    player.negativeEffects.set(effect.kind, { ...effect });
}

/** The cleanse contract is intentionally narrow: callers must name one supported effect kind. */
export function cleanseNegativeEffect(
  player: PlayerRuntime,
  kind: CleanseableNegativeEffect,
): boolean {
  return player.negativeEffects.delete(kind);
}

export function startSanctuary(
  sanctuaries: SanctuaryRuntime[],
  options: {
    ownerId: string;
    x: number;
    y: number;
    radius: number;
    power: number;
    effect: SanctuaryEffect;
    now: number;
  },
): SanctuaryRuntime {
  removeSanctuariesByOwner(sanctuaries, options.ownerId);
  const ticks = Math.max(1, Math.min(8, Math.floor(options.effect.ticks)));
  const intervalMs = Math.max(100, Math.min(2_000, Math.floor(options.effect.intervalMs)));
  const sanctuary: SanctuaryRuntime = {
    id: crypto.randomUUID(),
    ownerId: options.ownerId,
    x: options.x,
    y: options.y,
    radius: Math.max(0, options.radius),
    power: Math.max(0, Math.round(options.power * Math.max(0, options.effect.tickPowerRatio))),
    nextTickAt: options.now + intervalMs,
    intervalMs,
    ticksRemaining: ticks,
  };
  sanctuaries.push(sanctuary);
  return sanctuary;
}

export function advanceSanctuaries(
  sanctuaries: SanctuaryRuntime[],
  now: number,
  ownerIsActive: (ownerId: string) => boolean,
  healTick: (sanctuary: SanctuaryRuntime) => void,
): void {
  const survivors: SanctuaryRuntime[] = [];
  for (const sanctuary of sanctuaries) {
    if (!ownerIsActive(sanctuary.ownerId)) continue;
    while (sanctuary.ticksRemaining > 0 && now >= sanctuary.nextTickAt) {
      healTick(sanctuary);
      sanctuary.ticksRemaining -= 1;
      sanctuary.nextTickAt += sanctuary.intervalMs;
    }
    if (sanctuary.ticksRemaining > 0) survivors.push(sanctuary);
  }
  sanctuaries.splice(0, sanctuaries.length, ...survivors);
}

export function removeSanctuariesByOwner(sanctuaries: SanctuaryRuntime[], ownerId: string): void {
  for (let index = sanctuaries.length - 1; index >= 0; index--) {
    if (sanctuaries[index]?.ownerId === ownerId) sanctuaries.splice(index, 1);
  }
}

export function novaSpecializationMultipliers(
  judgment: NovaJudgmentEffect | undefined,
  mercy: NovaMercyEffect | undefined,
): { damage: number; healing: number } {
  if (judgment)
    return {
      damage: Math.max(0, judgment.damageMultiplier),
      healing: Math.max(0, judgment.healMultiplier),
    };
  if (mercy)
    return {
      damage: Math.max(0, mercy.damageMultiplier),
      healing: Math.max(0, mercy.healMultiplier),
    };
  return { damage: 1, healing: 1 };
}
