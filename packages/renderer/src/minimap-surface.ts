/**
 * The canvas shell for both maps. Bakes the world once, then only ever blits it. The bake is
 * expensive enough (see bakeWorldTexture below) that a caller reconnecting into the same zone
 * should keep an existing instance rather than construct a new one — `matches()` is how it asks.
 * All geometry lives in minimap.ts, which is pure and tested; this file is the part that
 * touches the DOM, so it is deliberately thin.
 */
import type { GroundVector } from "@lindocara/engine/ground.js";
import { decodeMap } from "@lindocara/engine/hd2d/map-data.js";
import type { PlayerSnapshot, WorldInfo } from "@lindocara/engine/protocol.js";
import {
  bakeTerrain,
  clampToRing,
  MINIMAP_TEXELS_PER_TILE,
  MINIMAP_WORLD_RADIUS,
  projectToMinimap,
  projectToWorldMap,
  sameBakedWorld,
} from "./minimap.js";
import type { SceneSample } from "./scene-sample.js";

const SELF_COLOR = "#ffffff";
const PLAYER_COLOR = "#6cc6ff";
const QUEST_NPC_COLOR = "#ffd257";
const QUEST_SITE_COLOR = "#c78bff";
const CORPSE_COLOR = "#ff6b6b";

const BLIP_RADIUS = 2.5;
const SELF_RADIUS = 3.5;

/** Matches Pixi's `resolution: min(2, dpr)`, so the two canvases look like one HUD. */
function backingScale(): number {
  return Math.min(2, globalThis.devicePixelRatio || 1);
}

/**
 * Size the backing store to the laid-out element, and report whether it is drawable yet.
 *
 * This runs per frame rather than once at attach: React hands us the ref before the browser has
 * laid the element out, so `clientWidth` is 0 on the first call. Sizing once at attach would
 * leave a permanently zero-sized canvas. Re-checking also handles window resizes for free.
 */
function ensureCanvasSize(canvas: HTMLCanvasElement): boolean {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width === 0 || height === 0) return false;
  const dpr = backingScale();
  const backingWidth = Math.round(width * dpr);
  const backingHeight = Math.round(height * dpr);
  if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
    canvas.width = backingWidth;
    canvas.height = backingHeight;
  }
  const context = canvas.getContext("2d");
  if (!context) return false;
  // Reset each frame: setting canvas.width above clears the transform, and it is cheap.
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.imageSmoothingEnabled = false;
  return true;
}

function dot(context: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  context.beginPath();
  context.arc(x, y, r, 0, Math.PI * 2);
  context.fillStyle = color;
  context.fill();
}

export class MapSurface {
  readonly #world: WorldInfo;
  readonly #texture: HTMLCanvasElement;
  #minimap: HTMLCanvasElement | null = null;
  #worldMap: HTMLCanvasElement | null = null;

  constructor(world: WorldInfo) {
    this.#world = world;
    this.#texture = bakeWorldTexture(world);
  }

  /** Whether `world` would bake to the exact same texture this instance already holds — the
   *  caller's cue to keep reusing this instance instead of paying for a fresh bake. */
  matches(world: WorldInfo): boolean {
    return sameBakedWorld(this.#world, world);
  }

  attachMinimap(canvas: HTMLCanvasElement | null): void {
    this.#minimap = canvas;
  }

  attachWorldMap(canvas: HTMLCanvasElement | null): void {
    this.#worldMap = canvas;
  }

  draw(sample: SceneSample, self: PlayerSnapshot | undefined, corpse: GroundVector | null): void {
    if (!self) return;
    this.#drawMinimap(sample, self, corpse);
    this.#drawWorldMap(sample, self, corpse);
  }

  #drawMinimap(sample: SceneSample, self: PlayerSnapshot, corpse: GroundVector | null): void {
    const canvas = this.#minimap;
    if (!canvas || !ensureCanvasSize(canvas)) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const size = canvas.clientWidth;
    const half = size / 2;

    context.clearRect(0, 0, size, size);
    context.save();
    context.beginPath();
    context.arc(half, half, half, 0, Math.PI * 2);
    context.clip();

    // The minimap shows MINIMAP_WORLD_RADIUS tiles either side of the viewer, so blit exactly
    // that window of the texture, stretched to the widget. The `+ size / 2` is the origin shift a
    // grid-centred coordinate needs before it indexes a top-left texture; without it the window
    // sits a half-map north-west of the hero. Near a world edge the source window runs off the
    // texture and the uncovered part stays the dark backdrop, which reads correctly as "there is
    // no world there".
    const halfGrid = this.#world.size / 2;
    const windowTexels = MINIMAP_WORLD_RADIUS * 2 * MINIMAP_TEXELS_PER_TILE;
    const sourceX = (self.x + halfGrid - MINIMAP_WORLD_RADIUS) * MINIMAP_TEXELS_PER_TILE;
    const sourceY = (self.z + halfGrid - MINIMAP_WORLD_RADIUS) * MINIMAP_TEXELS_PER_TILE;
    context.drawImage(
      this.#texture,
      sourceX,
      sourceY,
      windowTexels,
      windowTexels,
      0,
      0,
      size,
      size,
    );

    for (const marker of catalogueMarkers(this.#world)) {
      const point = projectToMinimap(marker.at, self, size);
      if (point.inside) dot(context, point.x, point.y, BLIP_RADIUS, marker.color);
    }
    for (const player of sample.players) {
      if (player.id === self.id) continue;
      const point = projectToMinimap(player, self, size);
      if (point.inside) dot(context, point.x, point.y, BLIP_RADIUS, PLAYER_COLOR);
    }
    if (corpse) this.#drawCorpseMarker(context, corpse, self, size);
    dot(context, half, half, SELF_RADIUS, SELF_COLOR);

    context.restore();
  }

  /** Inside the radius: a skull where the body lies. Outside: an arrow on the ring pointing at it. */
  #drawCorpseMarker(
    context: CanvasRenderingContext2D,
    corpse: GroundVector,
    self: PlayerSnapshot,
    size: number,
  ): void {
    const ring = clampToRing(corpse, self, size);
    if (ring.inside) {
      dot(context, ring.x, ring.y, BLIP_RADIUS + 1, CORPSE_COLOR);
      return;
    }
    context.save();
    context.translate(ring.x, ring.y);
    context.rotate(ring.angle);
    context.beginPath();
    context.moveTo(4, 0);
    context.lineTo(-4, -4);
    context.lineTo(-4, 4);
    context.closePath();
    context.fillStyle = CORPSE_COLOR;
    context.fill();
    context.restore();
  }

  #drawWorldMap(sample: SceneSample, self: PlayerSnapshot, corpse: GroundVector | null): void {
    const canvas = this.#worldMap;
    if (!canvas || !ensureCanvasSize(canvas)) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const size = { width: canvas.clientWidth, height: canvas.clientHeight };

    context.clearRect(0, 0, size.width, size.height);
    context.drawImage(this.#texture, 0, 0, size.width, size.height);

    for (const marker of catalogueMarkers(this.#world)) {
      const point = projectToWorldMap(marker.at, this.#world, size);
      dot(context, point.x, point.y, BLIP_RADIUS, marker.color);
    }
    for (const player of sample.players) {
      if (player.id === self.id) continue;
      const point = projectToWorldMap(player, this.#world, size);
      dot(context, point.x, point.y, BLIP_RADIUS, PLAYER_COLOR);
    }
    if (corpse) {
      const point = projectToWorldMap(corpse, this.#world, size);
      dot(context, point.x, point.y, BLIP_RADIUS + 1, CORPSE_COLOR);
    }
    const you = projectToWorldMap(self, this.#world, size);
    dot(context, you.x, you.y, SELF_RADIUS, SELF_COLOR);
  }
}

/**
 * The compiled catalogue's quest markers, in the ONE place their unit system is decided.
 *
 * `questNpcs`/`questSites` are pixel `Vec2` authored content and are EMPTY on every live room —
 * `zoneFromMapPayload` bakes `quests: []` and `questSites: []` for an authored map, and an authored
 * map is the only thing a room is ever built from. They are read through this seam rather than
 * inline so the pixel-to-ground reinterpretation is stated once, and so the day a heightfield map
 * authors its own markers there is a single site to point at real data.
 */
function catalogueMarkers(world: WorldInfo): { at: GroundVector; color: string }[] {
  return [
    ...world.questNpcs.map((npc) => ({ at: { x: npc.x, z: npc.y }, color: QUEST_NPC_COLOR })),
    ...world.questSites.map((site) => ({ at: { x: site.x, z: site.y }, color: QUEST_SITE_COLOR })),
  ];
}

/**
 * Once per map, not once per connection — MapSurface#matches lets the caller skip this for a
 * reconnect into the same map. A 64-cell grid bakes to a 512x512 canvas: the loop runs ~262,000
 * times, each iteration one array lookup plus a colour blend. Not free at that count, and running
 * it on every welcome would cost dropped frames at the worst possible moment: the instant control
 * returns to the player after a map transition.
 *
 * It bakes from the room's OWN heightfield — the exact string the server baked its collision from —
 * so what is painted and what is walkable cannot disagree. There is no compiled-in fallback to fall
 * back to any more, which is the point: painting one map's terrain over another's is precisely the
 * bug the old `zoneId` lookup had to be guarded against.
 */
function bakeWorldTexture(world: WorldInfo): HTMLCanvasElement {
  const map = decodeMap(world.heightfield);
  const canvas = document.createElement("canvas");
  // `parseServerMessage` already refused any welcome whose heightfield does not decode, so this is
  // unreachable from a real socket; a blank canvas is still the honest answer for a map that
  // cannot be read, rather than another map's terrain.
  if (!map) return canvas;
  const terrain = bakeTerrain(map);
  canvas.width = terrain.width;
  canvas.height = terrain.height;
  const context = canvas.getContext("2d");
  if (!context) return canvas;

  const image = context.createImageData(terrain.width, terrain.height);
  for (let ty = 0; ty < terrain.height; ty++) {
    for (let tx = 0; tx < terrain.width; tx++) {
      const color = terrain.colorAt(tx, ty);
      const offset = (ty * terrain.width + tx) * 4;
      image.data[offset] = (color >> 16) & 0xff;
      image.data[offset + 1] = (color >> 8) & 0xff;
      image.data[offset + 2] = color & 0xff;
      image.data[offset + 3] = 0xff;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}
