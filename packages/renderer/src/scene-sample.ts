import type {
  CorpseSnapshot,
  GuardSnapshot,
  LootSnapshot,
  MonsterSnapshot,
  PlayerSnapshot,
  ProjectileSnapshot,
  WorldEventSnapshot,
} from "@lindocara/engine/protocol.js";

/**
 * One interpolated frame of the world, as the renderer consumes it. Composed entirely of engine
 * wire-snapshot types, so it lives in the renderer package (where both the running-game renderer
 * and the minimap read it) rather than in the client's net layer — the net layer imports it back
 * from here, which keeps the package graph acyclic (client -> renderer, never the reverse).
 */
export interface SceneSample {
  players: PlayerSnapshot[];
  monsters: MonsterSnapshot[];
  guards: GuardSnapshot[];
  loot: LootSnapshot[];
  projectiles: ProjectileSnapshot[];
  /** Bodies do not move, so they are never interpolated — the newest word is the only word. */
  corpses: CorpseSnapshot[];
  /** Authored events, appearance only. Static decor: never interpolated and never buffered, the
   *  active set is drawn as-is. Room-scoped — the same set for everyone in the room. */
  events: readonly WorldEventSnapshot[];
}
