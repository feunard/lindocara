import type {
  CorpseSnapshot,
  EntityDelta,
  GuardSnapshot,
  LootSnapshot,
  MonsterSnapshot,
  PlayerSnapshot,
  ProjectileSnapshot,
  WorldEventSnapshot,
  WorldView,
} from "./protocol.js";

export const WORLD_POSITION_DELTA_THRESHOLD = 0.5;

export interface WorldCache {
  players: Map<string, PlayerSnapshot>;
  monsters: Map<string, MonsterSnapshot>;
  guards: Map<string, GuardSnapshot>;
  loot: Map<string, LootSnapshot>;
  corpses: Map<string, CorpseSnapshot>;
  projectiles: Map<string, ProjectileSnapshot>;
  /**
   * The events baseline this recipient was last sent. Kept out of `WorldView` on purpose: events
   * do not move and must never enter the interpolation buffer, so they are diffed here as a bespoke
   * room-scoped collection rather than folded into the positional entity machinery above. Managed
   * only by `seedEventCache`/`buildEventDelta`/`applyEventDelta` — `replaceWorldCache`,
   * `buildWorldDelta` and `applyWorldDelta` never touch it.
   */
  events: Map<string, WorldEventSnapshot>;
}

export interface WorldDeltaPayload {
  players: EntityDelta<PlayerSnapshot>;
  monsters: EntityDelta<MonsterSnapshot>;
  guards: EntityDelta<GuardSnapshot>;
  loot: EntityDelta<LootSnapshot>;
  corpses: EntityDelta<CorpseSnapshot>;
  projectiles: EntityDelta<ProjectileSnapshot>;
}

export function createWorldCache(view?: WorldView): WorldCache {
  const cache: WorldCache = {
    players: new Map(),
    monsters: new Map(),
    guards: new Map(),
    loot: new Map(),
    corpses: new Map(),
    projectiles: new Map(),
    events: new Map(),
  };
  if (view) replaceWorldCache(cache, view);
  return cache;
}

export function replaceWorldCache(cache: WorldCache, view: WorldView): void {
  replaceMap(cache.players, view.players);
  replaceMap(cache.monsters, view.monsters);
  replaceMap(cache.guards, view.guards);
  replaceMap(cache.loot, view.loot);
  replaceMap(cache.corpses, view.corpses);
  replaceMap(cache.projectiles, view.projectiles);
}

export function buildWorldDelta(cache: WorldCache, view: WorldView): WorldDeltaPayload {
  return {
    players: diffMap(cache.players, view.players),
    monsters: diffMap(cache.monsters, view.monsters),
    guards: diffMap(cache.guards, view.guards),
    loot: diffMap(cache.loot, view.loot),
    corpses: diffMap(cache.corpses, view.corpses),
    projectiles: diffMap(cache.projectiles, view.projectiles),
  };
}

export function applyWorldDelta(cache: WorldCache, delta: WorldDeltaPayload): WorldView | null {
  if (
    !applyEntityDelta(cache.players, delta.players) ||
    !applyEntityDelta(cache.monsters, delta.monsters) ||
    !applyEntityDelta(cache.guards, delta.guards) ||
    !applyEntityDelta(cache.loot, delta.loot) ||
    !applyEntityDelta(cache.corpses, delta.corpses) ||
    !applyEntityDelta(cache.projectiles, delta.projectiles)
  ) {
    return null;
  }
  return worldViewFromCache(cache);
}

export function worldViewFromCache(cache: WorldCache): WorldView {
  return {
    players: [...cache.players.values()],
    monsters: [...cache.monsters.values()],
    guards: [...cache.guards.values()],
    loot: [...cache.loot.values()],
    corpses: [...cache.corpses.values()],
    projectiles: [...cache.projectiles.values()],
  };
}

export function countDeltaEntities(delta: WorldDeltaPayload): number {
  return [
    delta.players,
    delta.monsters,
    delta.guards,
    delta.loot,
    delta.corpses,
    delta.projectiles,
  ].reduce((total, part) => total + part.upsert.length + part.remove.length, 0);
}

export function interpolateSnapshots<T extends { id: string; x: number; y: number }>(
  older: readonly T[],
  newer: readonly T[],
  alpha: number,
): T[] {
  const previous = new Map(older.map((entity) => [entity.id, entity]));
  return newer.map((entity) => {
    const before = previous.get(entity.id);
    if (!before) return entity;
    return {
      ...entity,
      x: before.x + (entity.x - before.x) * alpha,
      y: before.y + (entity.y - before.y) * alpha,
    };
  });
}

/**
 * Reset the events baseline to a full set — used at welcome and resync, where the recipient is
 * handed the complete active-event list rather than a diff. Separate from `replaceWorldCache`
 * because events live outside `WorldView` (they never interpolate).
 */
export function seedEventCache(cache: WorldCache, events: readonly WorldEventSnapshot[]): void {
  cache.events.clear();
  for (const event of events) cache.events.set(event.id, event);
}

/**
 * Diff the recipient's events baseline against the room's current active events, mutating the
 * baseline to the new set. Upserts an event whose active page is new or changed; removes an event
 * that went dormant. Events carry no position, so equality is a full-object compare rather than the
 * positional threshold `diffMap` uses. The removal branch is load-bearing: without it a dormant
 * event lingers on the client forever.
 */
export function buildEventDelta(
  cache: WorldCache,
  events: readonly WorldEventSnapshot[],
): EntityDelta<WorldEventSnapshot> {
  const currentIds = new Set(events.map((event) => event.id));
  const remove = [...cache.events.keys()].filter((id) => !currentIds.has(id));
  for (const id of remove) cache.events.delete(id);

  const upsert: WorldEventSnapshot[] = [];
  for (const event of events) {
    const previous = cache.events.get(event.id);
    if (!previous || JSON.stringify(previous) !== JSON.stringify(event)) {
      upsert.push(event);
      cache.events.set(event.id, event);
    }
  }
  return { upsert, remove };
}

/**
 * Apply an events delta to the recipient's baseline with the same rigor as `applyEntityDelta`: no
 * duplicate upsert id, no duplicate/unknown removal. Returns the materialized set, or `null` on a
 * malformed delta so the caller can fall back to a bounded resync.
 */
export function applyEventDelta(
  cache: WorldCache,
  delta: EntityDelta<WorldEventSnapshot>,
): WorldEventSnapshot[] | null {
  const upsertIds = new Set<string>();
  for (const event of delta.upsert) {
    if (upsertIds.has(event.id)) return null;
    upsertIds.add(event.id);
  }
  const removeIds = new Set<string>();
  for (const id of delta.remove) {
    if (removeIds.has(id) || upsertIds.has(id) || !cache.events.has(id)) return null;
    removeIds.add(id);
  }
  for (const id of removeIds) cache.events.delete(id);
  for (const event of delta.upsert) cache.events.set(event.id, event);
  return [...cache.events.values()];
}

function replaceMap<T extends { id: string }>(
  target: Map<string, T>,
  entities: readonly T[],
): void {
  target.clear();
  for (const entity of entities) target.set(entity.id, entity);
}

function diffMap<T extends { id: string; x: number; y: number }>(
  known: Map<string, T>,
  current: readonly T[],
): EntityDelta<T> {
  const currentIds = new Set(current.map((entity) => entity.id));
  const remove = [...known.keys()].filter((id) => !currentIds.has(id));
  for (const id of remove) known.delete(id);

  const upsert: T[] = [];
  for (const entity of current) {
    const previous = known.get(entity.id);
    if (!previous || visiblyChanged(previous, entity)) {
      upsert.push(entity);
      known.set(entity.id, entity);
    }
  }
  return { upsert, remove };
}

function visiblyChanged<T extends { x: number; y: number }>(previous: T, current: T): boolean {
  if (
    Math.abs(previous.x - current.x) >= WORLD_POSITION_DELTA_THRESHOLD ||
    Math.abs(previous.y - current.y) >= WORLD_POSITION_DELTA_THRESHOLD
  ) {
    return true;
  }
  return JSON.stringify({ ...previous, x: 0, y: 0 }) !== JSON.stringify({ ...current, x: 0, y: 0 });
}

function applyEntityDelta<T extends { id: string }>(
  cache: Map<string, T>,
  delta: EntityDelta<T>,
): boolean {
  const upsertIds = new Set<string>();
  for (const entity of delta.upsert) {
    if (upsertIds.has(entity.id)) return false;
    upsertIds.add(entity.id);
  }
  const removeIds = new Set<string>();
  for (const id of delta.remove) {
    if (removeIds.has(id) || upsertIds.has(id) || !cache.has(id)) return false;
    removeIds.add(id);
  }
  for (const id of removeIds) cache.delete(id);
  for (const entity of delta.upsert) cache.set(entity.id, entity);
  return true;
}
