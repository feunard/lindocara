export type DamageOverTimeKind = "poison";
export type DamageOverTimeTargetKind = "monster" | "player";

export interface DamageOverTimeTick {
  dueAt: number;
  power: number;
}

export interface DamageOverTimeStack {
  sequence: number;
  appliedAt: number;
  ticks: DamageOverTimeTick[];
}

export interface DamageOverTimeRuntime {
  kind: DamageOverTimeKind;
  sourceId: string;
  sourceSkillId: string;
  targetKind: DamageOverTimeTargetKind;
  targetId: string;
  lastAppliedAt: number;
  nextSequence: number;
  stacks: DamageOverTimeStack[];
}

export interface ApplyDamageOverTimeOptions {
  kind: DamageOverTimeKind;
  sourceId: string;
  sourceSkillId: string;
  targetKind: DamageOverTimeTargetKind;
  targetId: string;
  now: number;
  tickCount: number;
  tickPower: number;
  intervalMs: number;
  maxStacks?: number;
}

export interface AdvanceDamageOverTimeOptions {
  sourceIsActive: (sourceId: string) => boolean;
  targetIsActive: (targetKind: DamageOverTimeTargetKind, targetId: string) => boolean;
  resolveTick: (
    effect: DamageOverTimeRuntime,
    stack: DamageOverTimeStack,
    tick: DamageOverTimeTick,
  ) => void;
}

const MAX_STACKS = 8;
const MAX_TICKS_PER_STACK = 32;
const MIN_INTERVAL_MS = 50;
const MAX_INTERVAL_MS = 60_000;
const MAX_TICK_POWER = 1_000_000;

function sameEffect(
  effect: DamageOverTimeRuntime,
  options: Pick<ApplyDamageOverTimeOptions, "kind" | "sourceId" | "targetKind" | "targetId">,
): boolean {
  return (
    effect.kind === options.kind &&
    effect.sourceId === options.sourceId &&
    effect.targetKind === options.targetKind &&
    effect.targetId === options.targetId
  );
}

function lastDueAt(stack: DamageOverTimeStack): number {
  return stack.ticks.at(-1)?.dueAt ?? stack.appliedAt;
}

function createStack(sequence: number, options: ApplyDamageOverTimeOptions): DamageOverTimeStack {
  const tickCount = Math.max(1, Math.min(MAX_TICKS_PER_STACK, Math.floor(options.tickCount)));
  const tickPower = Math.max(1, Math.min(MAX_TICK_POWER, Math.round(options.tickPower)));
  const intervalMs = Math.max(
    MIN_INTERVAL_MS,
    Math.min(MAX_INTERVAL_MS, Math.floor(options.intervalMs)),
  );
  return {
    sequence,
    appliedAt: options.now,
    ticks: Array.from({ length: tickCount }, (_, index) => ({
      dueAt: options.now + intervalMs * (index + 1),
      power: tickPower,
    })),
  };
}

/**
 * Adds one independently-timed stack. The ordinary one-stack mode replaces its old schedule,
 * while a bounded stacking mode refreshes the stack that would expire first once at capacity.
 */
export function applyDamageOverTime(
  effects: DamageOverTimeRuntime[],
  options: ApplyDamageOverTimeOptions,
): DamageOverTimeRuntime {
  let effect = effects.find((candidate) => sameEffect(candidate, options));
  if (!effect) {
    effect = {
      kind: options.kind,
      sourceId: options.sourceId,
      sourceSkillId: options.sourceSkillId,
      targetKind: options.targetKind,
      targetId: options.targetId,
      lastAppliedAt: options.now,
      nextSequence: 0,
      stacks: [],
    };
    effects.push(effect);
  }

  effect.sourceSkillId = options.sourceSkillId;
  effect.lastAppliedAt = options.now;
  const maxStacks = Math.max(1, Math.min(MAX_STACKS, Math.floor(options.maxStacks ?? 1)));
  const stack = createStack(effect.nextSequence++, options);
  if (maxStacks === 1) {
    effect.stacks = [stack];
    return effect;
  }

  if (effect.stacks.length < maxStacks) {
    effect.stacks.push(stack);
    return effect;
  }

  let refreshIndex = 0;
  for (let index = 1; index < effect.stacks.length; index++) {
    const candidate = effect.stacks[index];
    const current = effect.stacks[refreshIndex];
    if (
      candidate &&
      current &&
      (lastDueAt(candidate) < lastDueAt(current) ||
        (lastDueAt(candidate) === lastDueAt(current) && candidate.sequence < current.sequence))
    )
      refreshIndex = index;
  }
  effect.stacks[refreshIndex] = stack;
  return effect;
}

function removeEffect(effects: DamageOverTimeRuntime[], effect: DamageOverTimeRuntime): void {
  const index = effects.indexOf(effect);
  if (index >= 0) effects.splice(index, 1);
}

/**
 * Drains due ticks from the room clock. A delayed server tick catches up from the frozen schedule;
 * no per-poison timer exists and callback mutations cannot cause a second resolution.
 */
export function advanceDamageOverTime(
  effects: DamageOverTimeRuntime[],
  now: number,
  options: AdvanceDamageOverTimeOptions,
): void {
  const ordered = [...effects].sort(
    (left, right) =>
      left.targetKind.localeCompare(right.targetKind) ||
      left.targetId.localeCompare(right.targetId) ||
      left.sourceId.localeCompare(right.sourceId) ||
      left.kind.localeCompare(right.kind),
  );
  for (const effect of ordered) {
    if (!effects.includes(effect)) continue;
    if (
      !options.sourceIsActive(effect.sourceId) ||
      !options.targetIsActive(effect.targetKind, effect.targetId)
    ) {
      removeEffect(effects, effect);
      continue;
    }
    for (const stack of [...effect.stacks].sort((a, b) => a.sequence - b.sequence)) {
      while (stack.ticks[0] && stack.ticks[0].dueAt <= now) {
        if (
          !options.sourceIsActive(effect.sourceId) ||
          !options.targetIsActive(effect.targetKind, effect.targetId)
        ) {
          removeEffect(effects, effect);
          break;
        }
        const tick = stack.ticks.shift();
        if (!tick) break;
        options.resolveTick(effect, stack, tick);
      }
      if (!effects.includes(effect)) break;
    }
    if (!effects.includes(effect)) continue;
    effect.stacks = effect.stacks.filter((stack) => stack.ticks.length > 0);
    if (effect.stacks.length === 0) removeEffect(effects, effect);
  }
}

export function damageOverTimeRemainingPower(effect: DamageOverTimeRuntime): number {
  return effect.stacks.reduce(
    (total, stack) => total + stack.ticks.reduce((stackTotal, tick) => stackTotal + tick.power, 0),
    0,
  );
}

export function removeDamageOverTimeBySource(
  effects: DamageOverTimeRuntime[],
  sourceId: string,
): void {
  for (let index = effects.length - 1; index >= 0; index--) {
    if (effects[index]?.sourceId === sourceId) effects.splice(index, 1);
  }
}

export function removeDamageOverTimeByTarget(
  effects: DamageOverTimeRuntime[],
  targetKind: DamageOverTimeTargetKind,
  targetId: string,
): void {
  for (let index = effects.length - 1; index >= 0; index--) {
    const effect = effects[index];
    if (effect?.targetKind === targetKind && effect.targetId === targetId) effects.splice(index, 1);
  }
}
