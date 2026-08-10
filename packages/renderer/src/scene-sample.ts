import type {
  CorpseSnapshot,
  GuardSnapshot,
  LootSnapshot,
  MonsterSnapshot,
  PlayerSnapshot,
  ProjectileSnapshot,
  SeaGuardianSnapshot,
  WorldEventSnapshot,
} from "@lindocara/engine/protocol.js";

/**
 * One interpolated frame of the world, as the renderer consumes it. Composed entirely of engine
 * wire-snapshot types, so it lives in the renderer package (where both the running-game renderer
 * and the minimap read it) rather than in the client's net layer. The net layer imports it back
 * from here, which keeps the package graph acyclic (client -> renderer, never the reverse).
 */
export interface SceneSample {
  players: PlayerSnapshot[];
  seaGuardians: SeaGuardianSnapshot[];
  monsters: MonsterSnapshot[];
  guards: GuardSnapshot[];
  loot: LootSnapshot[];
  projectiles: ProjectileSnapshot[];
  /** Bodies do not move, so they are never interpolated. The newest word is the only word. */
  corpses: CorpseSnapshot[];
  /** Target cells are not buffered; the renderer locally tweens moving NPCs between server steps. */
  events: readonly WorldEventSnapshot[];
}
