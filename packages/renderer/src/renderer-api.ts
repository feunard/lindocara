/**
 * The renderer contract `game/session.ts` consumes — every method it calls, and nothing else.
 *
 * Extracted so the PixiJS `Renderer` and the HD-2D `Hd2dRenderer` satisfy ONE named contract
 * instead of the session duck-typing whichever object it happens to hold. Two implementations
 * behind an implicit shape is how a method silently exists on one path and not the other; the
 * `implements` clause on each class is what turns that into a compile error.
 *
 * Every signature below is copied verbatim from `renderer.ts`, with one deliberate exception:
 * `configureMapTerrain` gained the decoded heightfield (see its own docblock). If `npm run
 * typecheck:renderer` complains after a change here, the interface is wrong, not the class.
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
  PriestLumenPortalVisual,
  PriestLumenTrailVisual,
  PriestPolarityOrbVisual,
  RogueShadowDanceSequence,
  WorldEventSnapshot,
} from "@lindocara/engine/protocol.js";
import type { Vec2 } from "@lindocara/engine/simulation.js";
import type { TileMap } from "@lindocara/engine/tilemap.js";
import type { ZoneId } from "@lindocara/engine/zones.js";
import type { MonsterImpactSound } from "./combat-art.js";
import type { RenderContext } from "./renderer.js";
import type { SceneSample } from "./scene-sample.js";

export interface RendererLike {
  configureZone(zoneId: ZoneId): void;
  /**
   * The wire-terrain twin of `configureZone`.
   *
   * `heightfield` is the welcome's decoded `MapData` (`WorldInfo.heightfield`), or `null` when the
   * room has none. It is the ONLY thing the HD-2D path draws its ground from; the PixiJS path
   * ignores it and keeps reading `tiles`/`layers`/`elements`. Both live in the same signature on
   * purpose — the day the PixiJS path goes away, the parameters it alone reads go with it, and a
   * grep for the survivors names every call site.
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
