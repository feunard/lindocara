/**
 * The canvas shell for both maps. Bakes the world once, then only ever blits it.
 * All geometry lives in minimap.ts, which is pure and tested; this file is the part that
 * touches the DOM, so it is deliberately thin.
 */
import type { PlayerSnapshot, WorldInfo } from "../../shared/protocol.js";
import type { Vec2 } from "../../shared/simulation.js";
import {
  clampToRing,
  type MapWorld,
  MINIMAP_TEXTURE_SCALE,
  MINIMAP_WORLD_RADIUS,
  projectToMinimap,
  projectToWorldMap,
  terrainColorAt,
} from "./minimap.js";
import type { SceneSample } from "./net.js";

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

  attachMinimap(canvas: HTMLCanvasElement | null): void {
    this.#minimap = canvas;
  }

  attachWorldMap(canvas: HTMLCanvasElement | null): void {
    this.#worldMap = canvas;
  }

  draw(sample: SceneSample, self: PlayerSnapshot | undefined, corpse: Vec2 | null): void {
    if (!self) return;
    this.#drawMinimap(sample, self, corpse);
    this.#drawWorldMap(sample, self, corpse);
  }

  #drawMinimap(sample: SceneSample, self: PlayerSnapshot, corpse: Vec2 | null): void {
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

    // The texture is 1/8 world scale; the minimap shows MINIMAP_WORLD_RADIUS either side of
    // the viewer, so blit exactly that window of it, stretched to the widget. Near a world
    // edge the source window runs off the texture; the uncovered part stays the dark backdrop,
    // which reads correctly as "there is no world there".
    const texelsPerWorld = 1 / MINIMAP_TEXTURE_SCALE;
    const windowTexels = MINIMAP_WORLD_RADIUS * 2 * texelsPerWorld;
    const sourceX = (self.x - MINIMAP_WORLD_RADIUS) * texelsPerWorld;
    const sourceY = (self.y - MINIMAP_WORLD_RADIUS) * texelsPerWorld;
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

    for (const npc of this.#world.questNpcs) {
      const point = projectToMinimap(npc, self, size);
      if (point.inside) dot(context, point.x, point.y, BLIP_RADIUS, QUEST_NPC_COLOR);
    }
    for (const site of this.#world.questSites) {
      const point = projectToMinimap(site, self, size);
      if (point.inside) dot(context, point.x, point.y, BLIP_RADIUS, QUEST_SITE_COLOR);
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
    corpse: Vec2,
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

  #drawWorldMap(sample: SceneSample, self: PlayerSnapshot, corpse: Vec2 | null): void {
    const canvas = this.#worldMap;
    if (!canvas || !ensureCanvasSize(canvas)) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const size = { width: canvas.clientWidth, height: canvas.clientHeight };

    context.clearRect(0, 0, size.width, size.height);
    context.drawImage(this.#texture, 0, 0, size.width, size.height);

    for (const npc of this.#world.questNpcs) {
      const point = projectToWorldMap(npc, this.#world, size);
      dot(context, point.x, point.y, BLIP_RADIUS, QUEST_NPC_COLOR);
    }
    for (const site of this.#world.questSites) {
      const point = projectToWorldMap(site, this.#world, size);
      dot(context, point.x, point.y, BLIP_RADIUS, QUEST_SITE_COLOR);
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

/** Once per connection. 4800x2700 becomes a 600x338 canvas; the loop runs ~200k times, ~5ms. */
function bakeWorldTexture(world: WorldInfo): HTMLCanvasElement {
  const width = Math.ceil(world.width / MINIMAP_TEXTURE_SCALE);
  const height = Math.ceil(world.height / MINIMAP_TEXTURE_SCALE);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return canvas;

  const bounds: MapWorld = {
    width: world.width,
    height: world.height,
    obstacles: world.obstacles,
    safeZone: world.safeZone,
  };
  const image = context.createImageData(width, height);
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const color = terrainColorAt(
        world.zoneNameKey,
        bounds,
        tx * MINIMAP_TEXTURE_SCALE,
        ty * MINIMAP_TEXTURE_SCALE,
      );
      const offset = (ty * width + tx) * 4;
      image.data[offset] = (color >> 16) & 0xff;
      image.data[offset + 1] = (color >> 8) & 0xff;
      image.data[offset + 2] = color & 0xff;
      image.data[offset + 3] = 0xff;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}
