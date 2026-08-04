/**
 * The HD-2D renderer, beside the PixiJS one and selected by `?hd2d=1` (see
 * `packages/client/src/game/session.ts`).
 *
 * It draws the world's GROUND — terrain, sea, foam, sky and light, from the welcome's heightfield —
 * and its ACTORS, as billboards the camera follows (`billboards.ts`). Nothing else. Every other
 * method of `RendererLike` is an explicit, marked no-op rather than a missing member: the session
 * calls all of them, and a silent partial implementation would be a renderer that looks finished.
 * Grep `NOT YET DRAWN ON THE HD-2D PATH` for the full list of what is still owed; the next S3 piece
 * takes the elements and events.
 *
 * An actor is drawn AT REST: it faces the way the server says, but it does not animate. `sync` has
 * no clock and `ActorView` carries no clip, and giving it one is a later piece — a visible gap,
 * named here rather than left to be discovered.
 */

import type { AuthoredQuestMarker } from "@lindocara/engine/adventure-state.js";
import { PRIMARY_COLORS, type PrimaryColor } from "@lindocara/engine/character.js";
import { type MonsterSpecies, PLAYER_CLASSES, type PlayerClass } from "@lindocara/engine/game.js";
import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import type { MapElement } from "@lindocara/engine/map-data.js";
import type { MerchantDefinition } from "@lindocara/engine/merchant.js";
import type {
  CombatAnimation,
  GuardSnapshot,
  MonsterSnapshot,
  MonsterSpecialImpact,
  PeasantBombImpactVisual,
  PeasantCampVisual,
  PlayerSnapshot,
  PriestLumenPortalVisual,
  PriestLumenTrailVisual,
  PriestPolarityOrbVisual,
  RogueShadowDanceSequence,
  WorldEventSnapshot,
} from "@lindocara/engine/protocol.js";
import type { Vec2 } from "@lindocara/engine/simulation.js";
import type { TileMap } from "@lindocara/engine/tilemap.js";
import { guardPrimaryColorForAsset } from "@lindocara/engine/tiny-swords-catalog.js";
import type { ZoneId } from "@lindocara/engine/zones.js";
import type { Facing } from "@lindocara/hd2d/billboard.js";
import { fetchAll } from "@lindocara/hd2d/loader.js";
import type { TextureRegistry, TextureSpec } from "@lindocara/hd2d/textures.js";
import { createTextureRegistry } from "@lindocara/hd2d/textures.js";
import type { MonsterImpactSound } from "../combat-art.js";
import { TINY_SWORDS_ENEMIES } from "../enemy-art.js";
import { sameRenderedMap } from "../map-render-cache.js";
import type { RenderContext } from "../renderer.js";
import type { RendererLike } from "../renderer-api.js";
import type { SceneSample } from "../scene-sample.js";
import { ServerClock } from "../server-clock.js";
import { unitSheet } from "../tiny-swords-art.js";
import type { ActorView, BillboardRegistry } from "./billboards.js";
import { createBillboardRegistry } from "./billboards.js";
import type { Hd2dScene } from "./scene.js";
import { createHd2dScene, HD2D_TEXTURE_URLS } from "./scene.js";

// --- actor art direction --------------------------------------------------------------------------

/**
 * Which sheet each kind of actor draws with — the ADAPTER's knowledge, exactly like the terrain
 * atlases in `scene.ts`. `billboards.ts` never sees a class, a species or a faction colour.
 *
 * The IDLE sheet only. This path draws an actor where the server says it is; it does not animate it
 * yet, so a run or attack sheet would be three quarters of a download for a frame never shown.
 */
function playerTextureKey(player: PlayerSnapshot): string {
  return unitSheet(player.class, player.appearance, "idle").source;
}

/** The SPECIES, never `graphicAssetId`: an authored catalogue appearance is one more sheet per
 *  authored monster, and preloading a set that only the running adventure knows is a later piece.
 *  The species is the authoritative combat model, so it is never a wrong answer, only a plainer
 *  one — the PixiJS path draws the authored art on top of the same species model. */
function monsterTextureKey(monster: MonsterSnapshot): string {
  return TINY_SWORDS_ENEMIES[monster.species].idle.source;
}

/**
 * The wire's last-accepted movement vector, as one of the four names a billboard understands.
 *
 * The dominant axis wins. A ZERO vector answers `"north"` rather than falling through to `"east"`:
 * north and south are `facingToFlip`'s no-ops, so "no direction" leaves the sprite turned the way
 * it already was — where `"east"` would snap a westward hero around the instant the server ever
 * sent a zeroed facing.
 */
function facingOf(vector: Vec2): Facing {
  if (vector.x === 0 && vector.y === 0) return "north";
  if (Math.abs(vector.x) >= Math.abs(vector.y)) return vector.x < 0 ? "west" : "east";
  return vector.y < 0 ? "north" : "south";
}

/** A guard is a Tiny Swords unit like any other — the same warrior sheet the PixiJS path gives it,
 *  in the faction colour its authored asset id implies. */
function guardTextureKey(guard: GuardSnapshot): string {
  return unitSheet(
    "warrior",
    { body: "wayfarer", primaryColor: guardPrimaryColorForAsset(guard.graphicAssetId) },
    "idle",
  ).source;
}

/**
 * Every sheet the three functions above can name, deduplicated — the registry's `get` throws on a
 * texture nobody preloaded, and a hero walking into a species that was never downloaded must not be
 * the thing that finds out.
 *
 * `atlas` stays false, as it does for every sprite sheet in the lab's own catalogue: a sprite is
 * sampled frame by frame but it is also seen at every distance, so it keeps its mipmaps (the
 * tilesets and the foam are the atlases, and `scene.ts` marks them).
 */
export const HD2D_ACTOR_TEXTURE_URLS: readonly TextureSpec[] = [
  ...new Set([
    ...PLAYER_CLASSES.flatMap((playerClass) =>
      PRIMARY_COLORS.map(
        (primaryColor) => unitSheet(playerClass, { body: "wayfarer", primaryColor }, "idle").source,
      ),
    ),
    ...Object.values(TINY_SWORDS_ENEMIES).map((art) => art.idle.source),
  ]),
].map((url) => ({ url }));

export class Hd2dRenderer implements RendererLike {
  #canvas: HTMLCanvasElement;
  #textures: TextureRegistry;
  /** Built on the first `configureMapTerrain` carrying a heightfield, not at construction: the map
   *  only exists once the welcome has landed. */
  #scene: Hd2dScene | null = null;
  /** Lives and dies with the scene: its billboards are parented to that scene's graph. */
  #actors: BillboardRegistry | null = null;
  /** Rebuilt every frame into the same array — `render` runs 60 times a second, and a fresh array
   *  per frame is garbage for nothing. */
  #actorViews: ActorView[] = [];
  #selfId: string | null = null;
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
    const specs = [...HD2D_TEXTURE_URLS, ...HD2D_ACTOR_TEXTURE_URLS];
    const blobs = await fetchAll(
      specs.map((spec) => spec.url),
      () => {},
    );
    const textures = createTextureRegistry(specs);
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
    this.#disposeScene();
    if (!heightfield) return;
    const scene = createHd2dScene(this.#canvas, heightfield, this.#textures);
    this.#scene = scene;
    this.#actors = createBillboardRegistry(
      scene.ctx,
      {
        root: scene.scene,
        query: scene.query,
        size: heightfield.size,
        waterLevel: heightfield.waterLevel,
      },
      this.#textures,
    );
  }

  render(sample: SceneSample, context: RenderContext): void {
    if (this.#destroyed) return;
    const scene = this.#scene;
    if (!scene) return;

    this.#actors?.sync(this.#collectActors(sample));

    // The camera follows the local player, and only it: every other actor is drawn where the
    // interpolated view puts it. `focusOn` takes the snapshot's own pixels and converts them
    // itself, so this renderer never touches the TILE→PIXEL bridge. A player the view has not sent
    // yet leaves the camera wherever it last was, which is the map's spawn on the very first frames.
    const self = sample.players.find((player) => player.id === this.#selfId);
    if (self) scene.focusOn(self.x, self.y);

    // `context.now` rather than a clock read of our own: it is the very `now` this frame's callback
    // was handed, so the scene's animations advance on the same timeline as everything else in it.
    scene.render(context.now);
  }

  /**
   * The frame's actors, in the one shape the registry understands. Positions ride across in the
   * snapshot's own PIXELS — the conversion lives inside `sync`.
   *
   * Two skips, and one thing still owed for each:
   *
   * - A **dead monster** is skipped. The PixiJS path keeps it for a death animation this one does
   *   not play, so leaving it in would stand a corpse upright until the server swept it. NOT YET
   *   DRAWN ON THE HD-2D PATH: the death animation itself.
   * - A player in the **`corpse`** life state is skipped for the same reason — a body lies down,
   *   and an idle billboard standing to attention over it is worse than nothing. Its body rides in
   *   `sample.corpses`, which this path does not draw yet either. NOT YET DRAWN ON THE HD-2D PATH:
   *   corpses.
   * - A **`ghost`** is deliberately KEPT. Its pose is right (a ghost walks), it is very often the
   *   local player mid-corpse-run, and skipping it would blank the one actor whose screen this is.
   *   NOT YET DRAWN ON THE HD-2D PATH: the translucency that tells a ghost from the living.
   */
  #collectActors(sample: SceneSample): readonly ActorView[] {
    const views = this.#actorViews;
    views.length = 0;
    for (const player of sample.players) {
      if (player.life === "corpse") continue;
      views.push({
        id: player.id,
        kind: "player",
        x: player.x,
        y: player.y,
        facing: facingOf(player.facing),
        textureKey: playerTextureKey(player),
      });
    }
    for (const monster of sample.monsters) {
      if (monster.dead) continue;
      views.push({
        id: monster.id,
        kind: "monster",
        x: monster.x,
        y: monster.y,
        facing: facingOf(monster.facing),
        textureKey: monsterTextureKey(monster),
      });
    }
    for (const guard of sample.guards)
      views.push({
        id: guard.id,
        kind: "guard",
        x: guard.x,
        y: guard.y,
        // A guard carries no facing on the wire. `"north"` is `facingToFlip`'s no-op, so it keeps
        // whichever profile the guard already had rather than snapping it east every frame.
        facing: "north",
        textureKey: guardTextureKey(guard),
      });
    return views;
  }

  #disposeScene(): void {
    // Billboards first: they are parented to the scene's graph, and disposing that graph out from
    // under them would leave the context's yaw registry holding meshes nothing can reach.
    this.#actors?.dispose();
    this.#actors = null;
    this.#scene?.dispose();
    this.#scene = null;
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    removeEventListener("resize", this.#onResize);
    if (this.#rafHandle !== null) cancelAnimationFrame(this.#rafHandle);
    this.#rafHandle = null;
    this.#frameCallbacks = [];
    this.#disposeScene();
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
    this.#disposeScene();
  }

  /** Which of the frame's players the camera follows. Not a no-op any more: this is the one actor
   *  the view is built around. */
  setSelfId(id: string): void {
    this.#selfId = id;
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
   * The origin in the game's PIXEL space. `billboards.ts` carries the pixel->tile half of the
   * bridge, which is the direction actors need; this method wants the other one, plus a ray cast
   * through the ground to have a tile position to convert at all. Returning the origin keeps the
   * peasant's bomb aim pointing at a fixed, obviously-wrong spot rather than at a plausible lie.
   */
  screenToWorld(_clientX: number, _clientY: number): Vec2 {
    return { x: 0, y: 0 };
  }

  /** NOT YET DRAWN ON THE HD-2D PATH — wired in a later S3 piece. */
  setAuthoredQuestMarkers(_markers: readonly AuthoredQuestMarker[]): void {}

  /** NOT YET DRAWN ON THE HD-2D PATH — wired in a later S3 piece. */
  showPeasantBombAim(_origin: Vec2, _direction: Vec2, _range: number): void {}

  /** NOT YET DRAWN ON THE HD-2D PATH — wired in a later S3 piece. */
  showPeasantCamp(_camp: PeasantCampVisual): void {}

  /** NOT YET DRAWN ON THE HD-2D PATH — wired in a later S3 piece. */
  showWorldEvent(_text: string, _tone: "info" | "good" | "bad", _x?: number, _y?: number): void {}
}
