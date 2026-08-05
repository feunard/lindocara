/**
 * The game's renderer — the only one, since S3 retired the PixiJS path (2026-08-04).
 *
 * It draws the world's GROUND — terrain, sea, foam, sky and light, from the welcome's heightfield —
 * its ACTORS, as billboards the camera follows (`billboards.ts`), and the map's own SCENERY, the
 * heightfield's elements and authored events (`static-content.ts`). Nothing else. Every other
 * method of `RendererLike` is an explicit, marked no-op rather than a missing member: the session
 * calls all of them, and a silent partial implementation would be a renderer that looks finished.
 * Grep `NOT YET DRAWN ON THE HD-2D PATH` for the full list of what is still owed.
 *
 * An actor is drawn AT REST: it faces the way the server says, but it does not animate. `sync` has
 * no clock and `ActorView` carries no clip, and giving it one is a later piece — a visible gap,
 * named here rather than left to be discovered.
 */

import type { AuthoredQuestMarker } from "@lindocara/engine/adventure-state.js";
import { PRIMARY_COLORS, type PrimaryColor } from "@lindocara/engine/character.js";
import { type MonsterSpecies, PLAYER_CLASSES, type PlayerClass } from "@lindocara/engine/game.js";
import type { GroundVector } from "@lindocara/engine/ground.js";
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
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import { editorAsset, guardPrimaryColorForAsset } from "@lindocara/engine/tiny-swords-catalog.js";
import type { Facing } from "@lindocara/hd2d/billboard.js";
import { fetchAll } from "@lindocara/hd2d/loader.js";
import type { TextureRegistry, TextureSpec } from "@lindocara/hd2d/textures.js";
import { createTextureRegistry } from "@lindocara/hd2d/textures.js";
import type { MonsterImpactSound } from "../combat-art.js";
import { TINY_SWORDS_ENEMIES } from "../enemy-art.js";
import { sameRenderedMap } from "../map-render-cache.js";
import type { RenderContext, RendererLike } from "../renderer-api.js";
import type { SceneSample } from "../scene-sample.js";
import { ServerClock } from "../server-clock.js";
import { unitSheet } from "../tiny-swords-art.js";
import { tinySwordsSourceUrl } from "../tiny-swords-assets.js";
import type { ActorView, BillboardRegistry, BillboardScene } from "./billboards.js";
import { createBillboardRegistry } from "./billboards.js";
import type { Hd2dScene } from "./scene.js";
import { createHd2dScene, HD2D_TEXTURE_URLS } from "./scene.js";
import type { StaticContent, StaticSpriteArt } from "./static-content.js";
import { placeStaticContent } from "./static-content.js";

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
 *  one — the deleted PixiJS path drew the authored art on top of the same species model. */
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
/** `z` is the screen-down ground axis, so a negative `z` faces north exactly as a negative pixel
 *  `y` used to. */
function facingOf(vector: GroundVector): Facing {
  if (vector.x === 0 && vector.z === 0) return "north";
  if (Math.abs(vector.x) >= Math.abs(vector.z)) return vector.x < 0 ? "west" : "east";
  return vector.z < 0 ? "north" : "south";
}

/** A guard is a Tiny Swords unit like any other — the same warrior sheet the deleted PixiJS path
 *  gave it, in the faction colour its authored asset id implies. */
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

// --- scenery art direction ------------------------------------------------------------------------

/**
 * One catalogue asset, resolved: the file it draws from and the geometry a billboard is built with.
 * `StaticSpriteArt` minus its texture, because the sheet has to be NAMED before it can be
 * downloaded and TEXTURED only afterwards — see `staticAssetSpec`.
 */
export interface StaticAssetSpec extends Omit<StaticSpriteArt, "texture"> {
  url: string;
}

/**
 * A catalogue asset id, read as everything the HD-2D path needs to draw it — or `null` when this
 * build cannot draw it at all. The ADAPTER's knowledge, exactly like `playerTextureKey` above and
 * the terrain atlases in `scene.ts`.
 *
 * ONE function, deliberately, and exported so it can be pinned by a test: the url and the geometry
 * were briefly two functions with the REFUSALS in only one of them, which made "never ask for the
 * geometry of an asset the other one rejected" an invariant living in neither — a second call site
 * (an editor preview, which the spec anticipates) would have quietly framed a whole shared sheet as
 * one sprite. The refusals and the arithmetic now sit together, and every caller gets both.
 *
 * Four honest refusals. `placeStaticContent` turns each into one skipped sprite and a console
 * warning, never a thrown error:
 *
 * - an id no catalogue entry answers to — a map authored against a newer pack;
 * - an entry whose art is a sub-RECTANGLE of a shared sheet (`editor.sourceRect`: the six Update-010
 *   trees all live in one 768x576 image). A billboard frames a regular `cols x rows` grid and
 *   nothing else, so cropping one of those would need a second framing path. NOT YET DRAWN ON THE
 *   HD-2D PATH: sub-rect crops — 9 of the catalogue's 144 placeable assets;
 * - an entry NOT anchored on the bottom of its frame. `foot` is measured up from the frame's bottom
 *   edge, which is only the sprite's ground line when `anchor.y === 1`. The deleted PixiJS path read
 *   the real anchor; this one cannot express it. No shipped asset has any
 *   other anchor today, so this guard costs nothing and stops the first one that does from floating;
 * - a file the Vite glob never bundled (`tinySwordsSourceUrl` throws on those, by design).
 *
 * `definition.width`/`height` are the FRAME's size, not the sheet's, so a frame count along its own
 * axis is what gives the grid. The scale rule is the pack's own and the same one `billboards.ts`
 * gives actors: a frame is worth its native pixels at 64 to the tile, so an authored tree and the
 * hero beside it stay in proportion. `footOffset` is `frameHeight - alphaBboxBottom` — the visible
 * ground line measured up from the bottom of the frame — which is precisely what `foot` wants, and
 * the same number the deleted PixiJS path used to stand the very same sprite on the very same cell.
 */
export function staticAssetSpec(assetId: string): StaticAssetSpec | null {
  const definition = editorAsset(assetId);
  if (!definition || definition.editor.sourceRect || definition.anchor.y !== 1) return null;
  const frame = definition.frame;
  const framePx = {
    width: frame?.width ?? definition.width,
    height: frame?.height ?? definition.height,
  };
  if (framePx.width <= 0 || framePx.height <= 0) return null;
  const count = Math.max(1, frame?.count ?? 1);
  const alongX = (frame?.axis ?? "x") === "x";
  let url: string;
  try {
    url = tinySwordsSourceUrl(definition.sourcePath);
  } catch {
    // The Vite glob is the only boundary to the raw pack and it throws on a path it never bundled.
    // A catalogue entry pointing at a file this build does not ship is one lost prop, not a crash.
    return null;
  }
  return {
    url,
    cols: alongX ? count : 1,
    rows: alongX ? 1 : count,
    height: framePx.height / TILE_SIZE,
    aspect: framePx.width / framePx.height,
    foot: definition.footOffset / framePx.height,
  };
}

/** Every catalogue id a map's scenery names, deduplicated and in placement order. */
function staticAssetIds(map: MapData): string[] {
  const ids = new Set<string>();
  for (const element of map.elements) ids.add(element.assetId);
  for (const event of map.events) {
    if (event.graphicAssetId !== null) ids.add(event.graphicAssetId);
  }
  return [...ids];
}

export class Hd2dRenderer implements RendererLike {
  #canvas: HTMLCanvasElement;
  #textures: TextureRegistry;
  /** Built on the first `configureMapTerrain` carrying a heightfield, not at construction: the map
   *  only exists once the welcome has landed. */
  #scene: Hd2dScene | null = null;
  /** Lives and dies with the scene: its billboards are parented to that scene's graph. */
  #actors: BillboardRegistry | null = null;
  /** The map's scenery, placed once per map. Lives and dies with the scene, like the actors. */
  #content: StaticContent | null = null;
  /** The scenery's own textures. A second registry rather than an addition to `#textures`: which
   *  catalogue sheets a map needs is only known once that map has landed, and the actor/terrain
   *  registry is fixed at construction so the first frame can be correct. */
  #contentTextures: TextureRegistry | null = null;
  /** Bumped by every map change and every teardown, so a download still in flight for the previous
   *  map cannot land its scenery in the new one's scene. */
  #contentToken = 0;
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
   * The frame loop. The deleted PixiJS renderer borrowed a shared `Application`'s ticker; there is
   * no such ticker here, so this owns a `requestAnimationFrame` loop and hands the session the same
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
    _elements: readonly MapElement[],
    revision: number,
    heightfield: MapData,
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
    const scene = createHd2dScene(this.#canvas, heightfield, this.#textures);
    this.#scene = scene;
    this.#actors = createBillboardRegistry(
      scene.ctx,
      this.#sceneFor(scene, heightfield),
      this.#textures,
    );
    // Fire and forget, but never silently: a failed scenery download costs the map its props and
    // must say so, while the ground and the actors carry on.
    void this.#loadStaticContent(scene, heightfield).catch((error: unknown) => {
      console.warn("[hd2d] map scenery could not be loaded", error);
    });
  }

  /** What `billboards.ts` and `static-content.ts` both need of the scene they draw into. */
  #sceneFor(scene: Hd2dScene, heightfield: MapData): BillboardScene {
    return {
      root: scene.scene,
      query: scene.query,
      size: heightfield.size,
      waterLevel: heightfield.waterLevel,
    };
  }

  /**
   * Downloads the map's own scenery sheets, then places them.
   *
   * Asynchronous where `configureMapTerrain` is not, and it has to be: the catalogue holds 480
   * assets and a map names a handful of them, so preloading the lot beside the terrain would trade
   * a two-second first frame for scenery that could simply arrive a moment later. The ground, the
   * sea and the actors are already on screen while this runs.
   *
   * `token` is the guard that makes that safe. Two maps in quick succession — a map transition, a
   * reconnect onto a different map — must not let the first one's download graft its trees onto the
   * second one's scene, so a load that is no longer the current one gives its textures straight
   * back.
   */
  async #loadStaticContent(scene: Hd2dScene, heightfield: MapData): Promise<void> {
    const token = ++this.#contentToken;
    const assetIds = staticAssetIds(heightfield);
    if (assetIds.length === 0) return;

    // Resolved ONCE, BEFORE the download, and reused as the placement's own resolver below: an id
    // this build cannot draw must not become a 404 that fails the whole batch, and — because the
    // spec carries the geometry as well as the url — there is no second lookup that could disagree
    // with this one about what is drawable. An unresolved id stays out of the map, `resolve`
    // answers `null` for it, and `placeStaticContent` skips it with a warning.
    const specByAsset = new Map<string, StaticAssetSpec>();
    for (const assetId of assetIds) {
      const spec = staticAssetSpec(assetId);
      if (spec) specByAsset.set(assetId, spec);
    }
    // `atlas` stays false, as it does for every sprite sheet: a prop is seen at every distance, so
    // it keeps its mipmaps. Same reasoning as `HD2D_ACTOR_TEXTURE_URLS`.
    const specs: TextureSpec[] = [...new Set([...specByAsset.values()].map((s) => s.url))].map(
      (url) => ({ url }),
    );

    let textures: TextureRegistry | null = null;
    if (specs.length > 0) {
      const blobs = await fetchAll(
        specs.map((spec) => spec.url),
        () => {},
      );
      const registry = createTextureRegistry(specs);
      await registry.decode(blobs, () => {});
      textures = registry;
    }

    if (this.#destroyed || token !== this.#contentToken || this.#scene !== scene) {
      textures?.dispose();
      return;
    }
    this.#contentTextures = textures;
    this.#content = placeStaticContent(
      scene.ctx,
      this.#sceneFor(scene, heightfield),
      heightfield,
      (assetId) => {
        const spec = specByAsset.get(assetId);
        if (!spec || !textures) return null;
        const { url, ...geometry } = spec;
        return { texture: textures.get(url), ...geometry };
      },
    );
  }

  render(sample: SceneSample, context: RenderContext): void {
    if (this.#destroyed) return;
    const scene = this.#scene;
    if (!scene) return;

    this.#actors?.sync(this.#collectActors(sample));

    // The camera follows the local player, and only it: every other actor is drawn where the
    // interpolated view puts it. `focusOn` takes a GROUND point — `x` and `z` — and the snapshot is
    // already in the scene's own tile units, so nothing is converted here. `self.y` is the
    // ELEVATION; handing it over as the second ground axis parks the camera on the horizon.
    // A player the view has not sent yet leaves the camera wherever it last was, which is the map's
    // spawn on the very first frames.
    const self = sample.players.find((player) => player.id === this.#selfId);
    if (self) scene.focusOn(self.x, self.z);

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
   * - A **dead monster** is skipped. The deleted PixiJS path kept it for a death animation this one
   *   does not play, so leaving it in would stand a corpse upright until the server swept it. NOT YET
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
        z: player.z,
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
        z: monster.z,
        facing: facingOf(monster.facing),
        textureKey: monsterTextureKey(monster),
      });
    }
    for (const guard of sample.guards)
      views.push({
        id: guard.id,
        kind: "guard",
        x: guard.x,
        z: guard.z,
        // A guard carries no facing on the wire. `"north"` is `facingToFlip`'s no-op, so it keeps
        // whichever profile the guard already had rather than snapping it east every frame.
        facing: "north",
        textureKey: guardTextureKey(guard),
      });
    return views;
  }

  #disposeScene(): void {
    // Billboards first: they are parented to the scene's graph, and disposing that graph out from
    // under them would leave the context's yaw registry holding meshes nothing can reach. The
    // token bump is part of the same teardown — a scenery download still in flight belongs to a
    // scene that no longer exists.
    this.#contentToken += 1;
    this.#content?.dispose();
    this.#content = null;
    this.#contentTextures?.dispose();
    this.#contentTextures = null;
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
    _z: number,
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
  playMonsterImpact(_species: MonsterSpecies, _x?: number, _z?: number): void {}

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
  playRoguePoisonImpact(_x: number, _z: number, _rupture: boolean): PlayerClass {
    return "rogue";
  }

  /** NOT YET DRAWN ON THE HD-2D PATH — wired in a later S3 piece. */
  playShadowDance(_sequence: RogueShadowDanceSequence): void {}

  /** NOT YET DRAWN ON THE HD-2D PATH — wired in a later S3 piece. */
  playTeleportEffect(_x?: number, _z?: number): void {}

  /**
   * NOT YET DRAWN ON THE HD-2D PATH — wired in a later S3 piece.
   *
   * **The invariant this owes, rescued from the deleted `world-event-art.ts`:** collect ONLY the
   * explicit visual ids the authoritative snapshot carries — `event.graphicAssetId` and
   * `event.harvest.exhaustedAssetId`, each validated by `isEditorAssetId`. In particular **never
   * inspect an asset's name or path to guess that a resource might need a stump, an empty rock or
   * any other harvested replacement.** Guessing from a filename makes the preload set drift the day
   * an asset is renamed, and a harvest that lands on an unpreloaded texture initiates its download
   * from the last authoritative hit — which is exactly the frame it must not.
   *
   * The point of preloading here at all is that timing: queue every replacement before the first
   * playable frame, so the swap is a texture already in memory.
   */
  preloadWorldEventAssets(_events: readonly WorldEventSnapshot[]): void {}

  /** NOT YET DRAWN ON THE HD-2D PATH — wired in a later S3 piece. */
  removePeasantCamp(_id: string): void {}

  /**
   * NOT YET WIRED ON THE HD-2D PATH — GAMEPLAY, NOT RENDERING — owed by a later S3 piece.
   *
   * Deliberately a different marker from the `NOT YET DRAWN` no-ops around it, because it is a
   * different kind of gap and must not be triaged beside them: every other stub here withholds
   * PIXELS, and the worst a missing bloom or camp sprite can do is look plain. This one withholds
   * an ANSWER the session turns into an authoritative intent — `session.ts` builds the peasant's
   * bomb direction from it and sends `skill(5, direction)` over the wire. A wrong value here is a
   * wrong bomb throw, not a missing effect.
   *
   * So it returns `null` — the contract's word for "I cannot answer" (`renderer-api.ts`) — and the
   * session refuses to aim or confirm rather than send a direction it invented. Implementing it
   * means a ray cast through the ground for a tile position plus the tile->pixel half of the bridge
   * (`billboards.ts` carries the pixel->tile half, the direction actors need); until then, nothing
   * is sent at all, which is the only honest option.
   */
  screenToWorld(_clientX: number, _clientY: number): GroundVector | null {
    return null;
  }

  /** NOT YET DRAWN ON THE HD-2D PATH — wired in a later S3 piece. */
  setAuthoredQuestMarkers(_markers: readonly AuthoredQuestMarker[]): void {}

  /** NOT YET DRAWN ON THE HD-2D PATH — wired in a later S3 piece. */
  showPeasantBombAim(_origin: GroundVector, _direction: GroundVector, _range: number): void {}

  /** NOT YET DRAWN ON THE HD-2D PATH — wired in a later S3 piece. */
  showPeasantCamp(_camp: PeasantCampVisual): void {}

  /** NOT YET DRAWN ON THE HD-2D PATH — wired in a later S3 piece. */
  showWorldEvent(_text: string, _tone: "info" | "good" | "bad", _x?: number, _z?: number): void {}
}
