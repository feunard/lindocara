/**
 * The renderer contract `game/session.ts` consumes — every method it calls, and nothing else.
 *
 * It was extracted so the PixiJS `Renderer` and the HD-2D `Hd2dRenderer` could satisfy ONE named
 * contract while both existed. The PixiJS path is gone (S3, 2026-08-04) and `Hd2dRenderer` is the
 * only implementation, but the interface stays: it is the seam `session.ts` is written against, and
 * an editor preview or a headless harness is expected to satisfy it next. Adding a method the
 * session calls means adding it here first — a member that exists only on the class is a method the
 * session can call without the contract knowing.
 */

import type { AuthoredQuestMarker } from "@lindocara/engine/adventure-state.js";
import type { PrimaryColor } from "@lindocara/engine/character.js";
import type { MonsterSpecies, PlayerClass } from "@lindocara/engine/game.js";
import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import type { MapElement } from "@lindocara/engine/map-data.js";
import type { MerchantDefinition } from "@lindocara/engine/merchant.js";
import type {
  CombatAnimation,
  MonsterSpecialImpact,
  PeasantBombImpactVisual,
  PeasantCampVisual,
  PlayerSnapshot,
  PriestLumenPortalVisual,
  PriestLumenTrailVisual,
  PriestPolarityOrbVisual,
  QuestState,
  RogueShadowDanceSequence,
  WorldEventSnapshot,
} from "@lindocara/engine/protocol.js";
import type { Vec2 } from "@lindocara/engine/simulation.js";
import type { TileMap } from "@lindocara/engine/tilemap.js";
import type { MonsterImpactSound } from "./combat-art.js";
import type { HealthBarMode } from "./display-settings.js";
import type { SceneSample } from "./scene-sample.js";

/**
 * The per-frame view state the session hands the renderer beside the interpolated sample.
 *
 * It lived in `renderer.ts` until that file was deleted with the PixiJS path (S3, 2026-08-04). It is
 * a plain data shape with no render-engine types in it, so its home is the contract, not an
 * implementation of it.
 */
export interface RenderContext {
  self?: PlayerSnapshot;
  quest: QuestState;
  now: number;
  healthBars: HealthBarMode;
  grid: boolean;
}

export interface RendererLike {
  /**
   * Install the map the room is running.
   *
   * `heightfield` is the welcome's decoded `MapData` (`WorldInfo.heightfield`), or `null` when the
   * room has none — the only thing the HD-2D path draws its ground from. `tiles`/`elements`/
   * `appearance` are the older wire terrain: still passed, still what the minimap and the movement
   * rule read, and drawn by nothing since the PixiJS path was deleted.
   */
  configureMapTerrain(
    zoneId: string,
    tiles: TileMap,
    elements: readonly MapElement[],
    revision: number,
    heightfield: MapData | null,
    appearance?: { tilesetId: string; layers: readonly string[] },
  ): void;
  configureMerchant(merchant: MerchantDefinition | null): void;
  destroy(): void;
  diagnostics(): Record<string, number>;
  hidePeasantBombAim(): void;
  hideQuestSite(id: string, durationMs: number): void;
  onFrame(callback: (nowMs: number, deltaSeconds: number) => void): void;
  playCombatAnimation(animation: CombatAnimation): void;
  playCombatImpact(
    playerId: string,
    skillId: string,
    x: number,
    y: number,
  ): PlayerClass | undefined;
  playHealingImpact(
    color: PrimaryColor,
    skillId?: "mend" | "prayer" | "divine_nova",
    x?: number,
    y?: number,
  ): void;
  playInteraction(): void;
  playLumenPortal(portal: PriestLumenPortalVisual): void;
  playLumenTrail(trail: PriestLumenTrailVisual): void;
  playMonsterImpact(species: MonsterSpecies, x?: number, y?: number): void;
  playMonsterSpecialImpact(impact: MonsterSpecialImpact): MonsterImpactSound | undefined;
  playPeasantBombImpact(impact: PeasantBombImpactVisual): void;
  playPolarityOrb(orb: PriestPolarityOrbVisual): void;
  playRoguePoisonImpact(x: number, y: number, rupture: boolean): PlayerClass;
  playShadowDance(sequence: RogueShadowDanceSequence): void;
  playTeleportEffect(x?: number, y?: number): void;
  preloadWorldEventAssets(events: readonly WorldEventSnapshot[]): void;
  removePeasantCamp(id: string): void;
  render(sample: SceneSample, context: RenderContext): void;
  screenToWorld(clientX: number, clientY: number): Vec2;
  setAuthoredQuestMarkers(markers: readonly AuthoredQuestMarker[]): void;
  setSelfId(id: string): void;
  showPeasantBombAim(origin: Vec2, direction: Vec2, range: number): void;
  showPeasantCamp(camp: PeasantCampVisual): void;
  showWorldEvent(text: string, tone: "info" | "good" | "bad", x?: number, y?: number): void;
}
