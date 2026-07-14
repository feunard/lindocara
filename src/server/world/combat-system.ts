import type { TerrainGeometry } from "../../shared/game.js";
import { applyDamage, hasLineOfSight, maxHpForLevel, withinRange } from "../../shared/game.js";
import type { GuardRuntime, MonsterRuntime, PlayerRuntime } from "./world-runtime.js";

export interface TargetSelection<T> {
  target: T | undefined;
  blockedInRange: boolean;
}

export type FriendlyTargetSelection =
  | { kind: "player"; target: PlayerRuntime; socket: WebSocket; maxHp: number }
  | { kind: "guard"; target: GuardRuntime; maxHp: number };

export function resolveFriendlyTarget(
  socketByPlayerId: ReadonlyMap<string, WebSocket>,
  players: ReadonlyMap<WebSocket, PlayerRuntime>,
  guards: readonly GuardRuntime[],
  targetId: string,
): FriendlyTargetSelection | undefined {
  const socket = socketByPlayerId.get(targetId);
  const player = socket ? players.get(socket) : undefined;
  if (socket && player) {
    return { kind: "player", target: player, socket, maxHp: maxHpForLevel(player.level) };
  }
  const guard = guards.find((candidate) => candidate.id === targetId);
  return guard ? { kind: "guard", target: guard, maxHp: guard.maxHp } : undefined;
}

export function resolveAttackTarget(
  player: PlayerRuntime,
  monsters: readonly MonsterRuntime[],
  targetId: string,
  range: number,
  now: number,
  terrain: TerrainGeometry,
): TargetSelection<MonsterRuntime> {
  const target = monsters.find((monster) => monster.id === targetId && monster.deadUntil <= now);
  if (!target || !withinRange(player, target, range)) {
    return { target: undefined, blockedInRange: false };
  }
  if (!hasLineOfSight(player, target, terrain.tiles)) {
    return { target: undefined, blockedInRange: true };
  }
  return { target, blockedInRange: false };
}

export function guardedDamage(player: PlayerRuntime, damage: number, now: number) {
  const amount =
    player.guardUntil > now ? Math.max(1, Math.ceil(damage * (1 - player.guardReduction))) : damage;
  return { amount, result: applyDamage(player.hp, amount) };
}
