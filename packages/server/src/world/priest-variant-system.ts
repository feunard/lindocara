import { sweptProjectileEntityImpact } from "@lindocara/engine/directional-combat.js";
import type { GroundVector, WorldPosition } from "@lindocara/engine/ground.js";
import type { TalentEffect } from "@lindocara/engine/talents.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import { BODY_RADIUS } from "./terrain-access.js";
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
type SacredPassageEffect = Extract<TalentEffect, { kind: "sacred_passage" }>;

export interface SanctuaryRuntime extends WorldPosition {
  id: string;
  ownerId: string;
  radius: number;
  power: number;
  nextTickAt: number;
  intervalMs: number;
  ticksRemaining: number;
}

export interface LumenPortalRuntime {
  id: string;
  ownerId: string;
  from: WorldPosition;
  to: WorldPosition;
  startedAt: number;
  expiresAt: number;
  triggerRadius: number;
  usedPlayerIds: Set<string>;
  /** Prevents a hero already standing inside a freshly-created endpoint from bouncing instantly. */
  waitingForExitIds: Set<string>;
  healingPower: number;
}

export interface LumenTrailRuntime {
  id: string;
  ownerId: string;
  /** The swept path on the GROUND plane; a trail has no elevation of its own. */
  points: GroundVector[];
  width: number;
  power: number;
  startedAt: number;
  expiresAt: number;
  healedPlayerIds: Set<string>;
}

export interface PolarityOrbRuntime extends WorldPosition {
  id: string;
  ownerId: string;
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
    from: WorldPosition;
    to: WorldPosition;
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
    startedAt: options.now,
    expiresAt: options.now + Math.max(0, duration),
    // The floor is one PIXEL of extent — "a gate has a mouth" — not one whole tile. At one tile
    // it would bind on the authored 28 px trigger and widen it 2.3x.
    triggerRadius: Math.max(1 / TILE_SIZE, options.effect.triggerRadius),
    usedPlayerIds: new Set(),
    waitingForExitIds: new Set([options.ownerId]),
    healingPower: Math.max(0, Math.round(options.healingPower)),
  };
  portals.push(portal);
  return portal;
}

export function startLumenTrail(
  trails: LumenTrailRuntime[],
  options: {
    id: string;
    ownerId: string;
    origin: GroundVector;
    effect: SacredPassageEffect;
    power: number;
    now: number;
  },
): LumenTrailRuntime {
  removeLumenTrailsByOwner(trails, options.ownerId);
  const trail: LumenTrailRuntime = {
    id: options.id,
    ownerId: options.ownerId,
    points: [{ x: options.origin.x, z: options.origin.z }],
    // Same floor, same reason: one tile would bind on the authored 22 px trail and widen the
    // heal corridor from 0.59 to 1.25 tiles.
    width: Math.max(1 / TILE_SIZE, options.effect.width),
    power: Math.max(0, Math.round(options.power)),
    startedAt: options.now,
    expiresAt: options.now + Math.max(0, options.effect.durationMs),
    healedPlayerIds: new Set(),
  };
  trails.push(trail);
  return trail;
}

/** The pixel version ignored a step under 1 px; this is the same distance in tile units. */
const TRAIL_POINT_MINIMUM_STEP = 1 / TILE_SIZE;

export function appendLumenTrailPoint(trail: LumenTrailRuntime, point: GroundVector): void {
  const last = trail.points.at(-1);
  if (last && Math.hypot(point.x - last.x, point.z - last.z) < TRAIL_POINT_MINIMUM_STEP) return;
  trail.points.push({ x: point.x, z: point.z });
  // A held step is capped at 2.5 s / 20 Hz. This defensive bound also protects protocol replay if
  // the simulation rate ever changes without changing the visual contract.
  if (trail.points.length > 96) trail.points.splice(1, trail.points.length - 96);
}

export function finishLumenTrail(trail: LumenTrailRuntime, now: number, durationMs: number): void {
  trail.startedAt = now;
  trail.expiresAt = now + Math.max(0, durationMs);
}

export function lumenTrailTouches(trail: LumenTrailRuntime, target: GroundVector): boolean {
  // A tile-unit position IS the body's centre; the pixel version's `+ PLAYER_SIZE / 2` recentred a
  // top-left corner and would now offset the ally by half a body.
  const center = { x: target.x, z: target.z };
  for (let index = 1; index < trail.points.length; index++) {
    const from = trail.points[index - 1];
    const to = trail.points[index];
    if (
      from &&
      to &&
      sweptProjectileEntityImpact(
        from,
        to,
        trail.width,
        { center, radius: BODY_RADIUS },
        "lumen-trail-target",
      ) !== null
    )
      return true;
  }
  return false;
}

export function expireLumenTrails(trails: LumenTrailRuntime[], now: number): void {
  for (let index = trails.length - 1; index >= 0; index--) {
    if ((trails[index]?.expiresAt ?? 0) <= now) trails.splice(index, 1);
  }
}

export function removeLumenTrailsByOwner(trails: LumenTrailRuntime[], ownerId: string): void {
  for (let index = trails.length - 1; index >= 0; index--) {
    if (trails[index]?.ownerId === ownerId) trails.splice(index, 1);
  }
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
  center: WorldPosition,
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
    x: center.x,
    y: center.y,
    z: center.z,
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
    z: number;
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
    z: options.z,
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
