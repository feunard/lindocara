/**
 * The HD-2D renderer, beside the PixiJS one and selected by `?hd2d=1` (see
 * `packages/client/src/game/session.ts`).
 *
 * It draws the world's GROUND — terrain, sea, foam, sky and light, from the welcome's heightfield —
 * and nothing else. Every other method of `RendererLike` is an explicit, marked no-op rather than a
 * missing member: the session calls all of them, and a silent partial implementation would be a
 * renderer that looks finished. Grep `NOT YET DRAWN ON THE HD-2D PATH` for the full list of what is
 * still owed; Task 7 takes the actors, Task 8 the elements and events.
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
import { fetchAll } from "@lindocara/hd2d/loader.js";
import type { TextureRegistry } from "@lindocara/hd2d/textures.js";
import { createTextureRegistry } from "@lindocara/hd2d/textures.js";
import type { MonsterImpactSound } from "../combat-art.js";
import { sameRenderedMap } from "../map-render-cache.js";
import type { RenderContext } from "../renderer.js";
import type { RendererLike } from "../renderer-api.js";
import type { SceneSample } from "../scene-sample.js";
import { ServerClock } from "../server-clock.js";
import type { Hd2dScene } from "./scene.js";
import { createHd2dScene, HD2D_TEXTURE_URLS } from "./scene.js";

export class Hd2dRenderer implements RendererLike {
  #canvas: HTMLCanvasElement;
  #textures: TextureRegistry;
  /** Built on the first `configureMapTerrain` carrying a heightfield, not at construction: the map
   *  only exists once the welcome has landed. */
  #scene: Hd2dScene | null = null;
  #frameCallbacks: Array<(nowMs: number, deltaSeconds: number) => void> = [];
  #rafHandle: number | null = null;
  #lastFrameMs: number | null = null;
  #destroyed = false;
  #currentMapId: string | null = null;
  #currentMapRevision = -1;
  #onResize = (): void => this.#scene?.resize();

  private constructor(canvas: HTMLCanvasElement, textures: TextureRegistry) {
    this.#canvas = canvas;
    this.#textures = textures;
    addEventListener("resize", this.#onResize);
    this.#startLoop();
  }

  /**
   * Downloads and decodes every texture BEFORE returning, exactly as the lab does: a scene built on
   * textures still decoding clones empty ones, and three complains once per frame about it.
   *
   * `_serverClock` is accepted for signature parity with `Renderer.create` and is not read — it
   * times combat visuals, and this path draws none of them yet.
   */
  static async create(
    canvas: HTMLCanvasElement,
    _serverClock: ServerClock = new ServerClock(),
  ): Promise<Hd2dRenderer> {
    const urls = HD2D_TEXTURE_URLS.map((spec) => spec.url);
    const blobs = await fetchAll(urls, () => {});
    const textures = createTextureRegistry(HD2D_TEXTURE_URLS);
    await textures.decode(blobs, () => {});
    return new Hd2dRenderer(canvas, textures);
  }

  /**
   * The frame loop. The PixiJS renderer borrows the shared `Application`'s ticker; there is no such
   * ticker here, so this owns a `requestAnimationFrame` loop and hands the session the same
   * `(nowMs, deltaSeconds)` it has always received. The session's callback is what calls `render`,
   * so the scene advances from inside the callback, never beside it.
   */
  #startLoop(): void {
    const step = (now: number): void => {
      this.#rafHandle = requestAnimationFrame(step);
      const dt = this.#lastFrameMs === null ? 0 : (now - this.#lastFrameMs) / 1000;
      this.#lastFrameMs = now;
      for (const callback of this.#frameCallbacks) callback(now, dt);
    };
    this.#rafHandle = requestAnimationFrame(step);
  }

  onFrame(callback: (nowMs: number, deltaSeconds: number) => void): void {
    this.#frameCallbacks.push(callback);
  }

  /**
   * Builds the scene from the welcome's heightfield.
   *
   * `tiles`/`elements`/`appearance` are the tile path's, and go unread here — the appearance this
   * renderer draws comes from the heightfield, and a heightfield-backed room ships blank tile
   * layers precisely so its welcome still validates. A `null` heightfield leaves the scene unbuilt
   * and the screen empty, which is the honest state of a room this path cannot draw.
   */
  configureMapTerrain(
    zoneId: string,
    _tiles: TileMap,
    _elements: readonly MapElement[],
    revision: number,
    heightfield: MapData | null,
    _appearance?: { tilesetId: string; layers: readonly string[] },
  ): void {
    if (
      this.#currentMapId !== null &&
      sameRenderedMap(
        { mapId: zoneId, revision },
        { mapId: this.#currentMapId, revision: this.#currentMapRevision },
      )
    )
      return;
    this.#currentMapId = zoneId;
    this.#currentMapRevision = revision;
    this.#scene?.dispose();
    this.#scene = null;
    if (!heightfield) return;
    this.#scene = createHd2dScene(this.#canvas, heightfield, this.#textures);
  }

  render(_sample: SceneSample, context: RenderContext): void {
    if (this.#destroyed) return;
    // `context.now` rather than a clock read of our own: it is the very `now` this frame's callback
    // was handed, so the scene's animations advance on the same timeline as everything else in it.
    this.#scene?.render(context.now);
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    removeEventListener("resize", this.#onResize);
    if (this.#rafHandle !== null) cancelAnimationFrame(this.#rafHandle);
    this.#rafHandle = null;
    this.#frameCallbacks = [];
    this.#scene?.dispose();
    this.#scene = null;
    this.#textures.dispose();
  }

  /**
   * A compiled-catalogue zone has no heightfield, so there is nothing for this path to draw. It
   * clears whatever was on screen rather than leaving the previous map's ground under a zone that
   * has replaced it.
   */
  configureZone(_zoneId: ZoneId): void {
    this.#currentMapId = null;
    this.#currentMapRevision = -1;
    this.#scene?.dispose();
    this.#scene = null;
  }

  // --- not yet drawn ------------------------------------------------------------------------------
  // Everything below is an explicit no-op. Each carries the same marker so one grep finds them all.

  /** NOT YET DRAWN ON THE HD-2D PATH — wired in a later S3 piece. */
  configureMerchant(_merchant: MerchantDefinition | null): void {}

  /** NOT YET DRAWN ON THE HD-2D PATH — wired in a later S3 piece. */
  diagnostics(): Record<string, number> {
    return {};
  }

  /** NOT YET DRAWN ON THE HD-2D PATH — wired in a later S3 piece. */
  hidePeasantBombAim(): void {}

  /** NOT YET DRAWN ON THE HD-2D PATH — wired in a later S3 piece. */
  hideQuestSite(_id: string, _durationMs: number): void {}

  /** NOT YET DRAWN ON THE HD-2D PATH — wired in a later S3 piece. */
  playCombatAnimation(_animation: CombatAnimation): void {}

  /** NOT YET DRAWN ON THE HD-2D PATH — wired in a later S3 piece. */
  playCombatImpact(
    _playerId: string,
    _skillId: string,
    _x: number,
    _y: number,
  ): PlayerClass | undefined {
    return undefined;
  }

  /** NOT YET DRAWN ON THE HD-2D PATH — wired in a later S3 piece. */
  playHealingImpact(
    _color: PrimaryColor,
    _skillId?: "mend" | "prayer" | "divine_nova",
    _x?: number,
    _y?: number,
  ): void {}

  /** NOT YET DRAWN ON THE HD-2D PATH — wired in a later S3 piece. */
  playInteraction(): void {}

  /** NOT YET DRAWN ON THE HD-2D PATH — wired in a later S3 piece. */
  playLumenPortal(_portal: PriestLumenPortalVisual): void {}

  /** NOT YET DRAWN ON THE HD-2D PATH — wired in a later S3 piece. */
  playLumenTrail(_trail: PriestLumenTrailVisual): void {}

  /** NOT YET DRAWN ON THE HD-2D PATH — wired in a later S3 piece. */
  playMonsterImpact(_species: MonsterSpecies, _x?: number, _y?: number): void {}

  /** NOT YET DRAWN ON THE HD-2D PATH — wired in a later S3 piece. */
  playMonsterSpecialImpact(_impact: MonsterSpecialImpact): MonsterImpactSound | undefined {
    return undefined;
  }

  /** NOT YET DRAWN ON THE HD-2D PATH — wired in a later S3 piece. */
  playPeasantBombImpact(_impact: PeasantBombImpactVisual): void {}

  /** NOT YET DRAWN ON THE HD-2D PATH — wired in a later S3 piece. */
  playPolarityOrb(_orb: PriestPolarityOrbVisual): void {}

  /**
   * NOT YET DRAWN ON THE HD-2D PATH — wired in a later S3 piece.
   *
   * The one no-op that cannot return nothing: its caller uses the answer to pick an impact SOUND,
   * and poison is the rogue's, on this path as on the other.
   */
  playRoguePoisonImpact(_x: number, _y: number, _rupture: boolean): PlayerClass {
    return "rogue";
  }

  /** NOT YET DRAWN ON THE HD-2D PATH — wired in a later S3 piece. */
  playShadowDance(_sequence: RogueShadowDanceSequence): void {}

  /** NOT YET DRAWN ON THE HD-2D PATH — wired in a later S3 piece. */
  playTeleportEffect(_x?: number, _y?: number): void {}

  /** NOT YET DRAWN ON THE HD-2D PATH — wired in a later S3 piece. */
  preloadWorldEventAssets(_events: readonly WorldEventSnapshot[]): void {}

  /** NOT YET DRAWN ON THE HD-2D PATH — wired in a later S3 piece. */
  removePeasantCamp(_id: string): void {}

  /**
   * NOT YET DRAWN ON THE HD-2D PATH — wired in a later S3 piece.
   *
   * The origin in the game's PIXEL space, which this path has no projection into yet (that
   * conversion is Task 7's). Returning the origin keeps the peasant's bomb aim pointing at a fixed,
   * obviously-wrong spot rather than at a plausible lie.
   */
  screenToWorld(_clientX: number, _clientY: number): Vec2 {
    return { x: 0, y: 0 };
  }

  /** NOT YET DRAWN ON THE HD-2D PATH — wired in a later S3 piece. */
  setAuthoredQuestMarkers(_markers: readonly AuthoredQuestMarker[]): void {}

  /** NOT YET DRAWN ON THE HD-2D PATH — wired in a later S3 piece. */
  setSelfId(_id: string): void {}

  /** NOT YET DRAWN ON THE HD-2D PATH — wired in a later S3 piece. */
  showPeasantBombAim(_origin: Vec2, _direction: Vec2, _range: number): void {}

  /** NOT YET DRAWN ON THE HD-2D PATH — wired in a later S3 piece. */
  showPeasantCamp(_camp: PeasantCampVisual): void {}

  /** NOT YET DRAWN ON THE HD-2D PATH — wired in a later S3 piece. */
  showWorldEvent(_text: string, _tone: "info" | "good" | "bad", _x?: number, _y?: number): void {}
}
