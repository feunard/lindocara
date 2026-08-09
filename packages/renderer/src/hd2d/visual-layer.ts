import type { AuthoredQuestMarker } from "@lindocara/engine/adventure-state.js";
import type { GroundVector } from "@lindocara/engine/ground.js";
import type { ColliderRect } from "@lindocara/engine/hd2d/collider-index.js";
import type { HeroEvent } from "@lindocara/engine/hd2d/hero-state.js";
import type { TerrainRamp } from "@lindocara/engine/hd2d/terrain-query.js";
import type { MerchantDefinition } from "@lindocara/engine/merchant.js";
import type {
  PeasantCampVisual,
  PlayerSnapshot,
  WorldEventSnapshot,
} from "@lindocara/engine/protocol.js";
import type { Billboard, Sprite } from "@lindocara/hd2d/billboard.js";
import { makeBillboard, makeFlatSprite } from "@lindocara/hd2d/billboard.js";
import { meshStairs } from "@lindocara/hd2d/terrain/stairs.js";
import type { TextureRegistry } from "@lindocara/hd2d/textures.js";
import * as THREE from "three";
import { type ProjectileVisualDefinition, projectileVisual } from "../projectile-visuals.js";
import type { LocalMovementVisualState } from "../renderer-api.js";
import type { SceneSample } from "../scene-sample.js";
import { HD2D_CAMERA, type Hd2dScene, terrainAtlases } from "./scene.js";
import {
  isColdBiomeMaterial,
  type StaticSpriteArt,
  staticAnimationFrame,
} from "./static-content.js";

export const HD2D_SPLASH_TEXTURE_URL = "/assets/lindocara/hd2d/splash.png";
export const HD2D_SHEEP_EXPLOSION_TEXTURE_URL = "/assets/lindocara/hd2d/sheep-explosion.png";

interface TimedVisual {
  object: THREE.Object3D;
  startedAt: number;
  endsAt: number;
  update(progress: number): void;
  dispose?: () => void;
}

interface LabelVisual {
  element: HTMLDivElement;
  point: THREE.Vector3;
  endsAt: number;
}

interface CampEntry {
  object: THREE.Object3D;
  endsAt: number;
}

export interface Hd2dEditorOverlay {
  cols: number;
  rows: number;
  showGrid: boolean;
  showCollisions: boolean;
  dim: boolean;
  colliders: readonly ColliderRect[];
  hover?: GroundVector | null;
  selection?: GroundVector | null;
  stairsPreview?: { ramp: TerrainRamp; valid: boolean; levelHeight: number } | null;
  assetPreview?: {
    point: GroundVector;
    footprint: readonly GroundVector[];
    valid: boolean;
    skyAltitude?: number;
  } | null;
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (
      !(child instanceof THREE.Mesh) &&
      !(child instanceof THREE.Line) &&
      !(child instanceof THREE.Sprite)
    )
      return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) material.dispose();
  });
  object.removeFromParent();
}

function transparentMaterial(
  color: THREE.ColorRepresentation,
  opacity = 0.9,
): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    opacity,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
}

function materialOpacity(object: THREE.Object3D, opacity: number): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      material.transparent = true;
      material.opacity = opacity;
    }
  });
}

function colorFromText(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return new THREE.Color().setHSL(((hash >>> 0) % 360) / 360, 0.62, 0.58).getHex();
}

function projectileMaterial(color: number, opacity = 0.96): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    toneMapped: false,
  });
}

function projectileMesh(
  definition: ProjectileVisualDefinition,
  radius: number,
  factionColor: number,
): THREE.Group {
  const root = new THREE.Group();
  const spinRoot = new THREE.Group();
  root.add(spinRoot);
  const color = definition.color === "faction" ? factionColor : definition.color;
  const body = projectileMaterial(color);
  const accent = projectileMaterial(definition.accent, 0.9);
  const size = Math.max(0.08, radius) * definition.scale;

  if (definition.shape === "arrow" || definition.shape === "harpoon") {
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(size * 0.18, size * 0.18, size * 3.2, 8),
      body,
    );
    shaft.rotation.x = Math.PI / 2;
    spinRoot.add(shaft);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(size * 0.72, size * 1.35, 8), accent);
    tip.rotation.x = Math.PI / 2;
    tip.position.z = size * 2.1;
    spinRoot.add(tip);
    if (definition.shape === "harpoon") {
      for (const side of [-1, 1]) {
        const barb = new THREE.Mesh(new THREE.ConeGeometry(size * 0.32, size * 0.9, 6), accent);
        barb.rotation.x = Math.PI / 2;
        barb.rotation.z = side * 0.7;
        barb.position.set(side * size * 0.5, 0, size * 1.35);
        spinRoot.add(barb);
      }
    }
  } else if (definition.shape === "orb") {
    spinRoot.add(new THREE.Mesh(new THREE.IcosahedronGeometry(size, 1), body));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(size * 1.35, size * 0.12, 8, 24), accent);
    ring.rotation.x = Math.PI / 2;
    spinRoot.add(ring);
  } else if (definition.shape === "heart") {
    for (const side of [-1, 1]) {
      const lobe = new THREE.Mesh(new THREE.SphereGeometry(size * 0.65, 12, 8), body);
      lobe.position.set(side * size * 0.5, size * 0.38, 0);
      spinRoot.add(lobe);
    }
    const point = new THREE.Mesh(new THREE.ConeGeometry(size, size * 1.8, 12), accent);
    point.rotation.z = Math.PI;
    point.position.y = -size * 0.55;
    spinRoot.add(point);
  } else {
    spinRoot.add(new THREE.Mesh(new THREE.DodecahedronGeometry(size, 0), body));
    const fuse = new THREE.Mesh(
      new THREE.TorusGeometry(size * 0.48, size * 0.12, 6, 12, Math.PI),
      accent,
    );
    fuse.position.y = size * 0.95;
    fuse.rotation.z = -0.6;
    spinRoot.add(fuse);
  }

  if (definition.trailLength > 0) {
    const trail = new THREE.Mesh(
      new THREE.ConeGeometry(size * 0.45, definition.trailLength, 8, 1, true),
      projectileMaterial(color, 0.34),
    );
    trail.rotation.x = -Math.PI / 2;
    trail.position.z = -definition.trailLength / 2 - size * 0.7;
    root.add(trail);
  }
  root.userData.spinRoot = spinRoot;
  return root;
}

/** Dynamic presentation parented to the same scene graph as terrain and billboards. */
export class Hd2dVisualLayer {
  readonly #scene: Hd2dScene;
  readonly #canvas: HTMLCanvasElement;
  readonly #size: number;
  readonly #waterLevel: number;
  readonly #textures: TextureRegistry | null;
  readonly #materialAt: (x: number, z: number) => unknown;
  readonly #root = new THREE.Group();
  readonly #editorRoot = new THREE.Group();
  readonly #editorPreviewRoot = new THREE.Group();
  readonly #effects: TimedVisual[] = [];
  readonly #loot = new Map<string, THREE.Object3D>();
  readonly #projectiles = new Map<string, THREE.Object3D>();
  readonly #eventMarkers = new Map<string, THREE.Object3D>();
  readonly #camps = new Map<string, CampEntry>();
  readonly #questMarkers = new Map<string, THREE.Object3D>();
  readonly #hiddenQuestSites = new Map<string, number>();
  readonly #labels: LabelVisual[] = [];
  readonly #raycaster = new THREE.Raycaster();
  readonly #swimDisc: THREE.Mesh;
  readonly #breathBar = new THREE.Group();
  readonly #breathFill: THREE.Mesh;
  readonly #crackDisc: THREE.Group;
  readonly #skid: THREE.Mesh;
  #events: readonly WorldEventSnapshot[] = [];
  #questState: readonly AuthoredQuestMarker[] = [];
  #questVisualKey = "";
  #merchant: THREE.Object3D | null = null;
  #aim: THREE.Object3D | null = null;
  #nextRippleAt = 0;
  #editorOverlay: Hd2dEditorOverlay | null = null;
  readonly #editorPreviews: {
    sprite: Billboard | Sprite;
    art: StaticSpriteArt;
    cold: boolean;
  }[] = [];

  constructor(
    scene: Hd2dScene,
    canvas: HTMLCanvasElement,
    size: number,
    waterLevel = 0,
    textures: TextureRegistry | null = null,
    materialAt: (x: number, z: number) => unknown = () => null,
  ) {
    this.#scene = scene;
    this.#canvas = canvas;
    this.#size = size;
    this.#waterLevel = waterLevel;
    this.#textures = textures;
    this.#materialAt = materialAt;
    this.#root.name = "game-presentation";
    this.#editorRoot.name = "editor-overlay";
    this.#editorPreviewRoot.name = "editor-asset-preview";
    this.#root.add(this.#editorRoot);
    this.#root.add(this.#editorPreviewRoot);
    scene.scene.add(this.#root);

    this.#swimDisc = new THREE.Mesh(
      new THREE.CircleGeometry(0.55, 32),
      transparentMaterial(0x18384b, 0.38),
    );
    this.#swimDisc.rotation.x = -Math.PI / 2;
    this.#swimDisc.visible = false;
    this.#swimDisc.renderOrder = 2;
    this.#root.add(this.#swimDisc);

    const breathBackground = new THREE.Mesh(
      new THREE.PlaneGeometry(1.04, 0.16),
      new THREE.MeshBasicMaterial({
        color: 0x102938,
        transparent: true,
        opacity: 0.88,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    breathBackground.renderOrder = 20;
    this.#breathFill = new THREE.Mesh(
      new THREE.PlaneGeometry(0.94, 0.09),
      new THREE.MeshBasicMaterial({
        color: 0x73ddf2,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.#breathFill.position.z = 0.006;
    this.#breathFill.renderOrder = 21;
    this.#breathBar.add(breathBackground, this.#breathFill);
    this.#breathBar.visible = false;
    this.#root.add(this.#breathBar);

    this.#crackDisc = new THREE.Group();
    const crackPositions: number[] = [];
    for (let ray = 0; ray < 9; ray += 1) {
      const angle = (ray / 9) * Math.PI * 2;
      const inner = 0.1 + (ray % 3) * 0.035;
      const outer = 0.5 + (ray % 2) * 0.16;
      crackPositions.push(
        Math.cos(angle) * inner,
        0,
        Math.sin(angle) * inner,
        Math.cos(angle + (ray % 2 ? 0.16 : -0.1)) * outer,
        0,
        Math.sin(angle + (ray % 2 ? 0.16 : -0.1)) * outer,
      );
    }
    const crackGeometry = new THREE.BufferGeometry();
    crackGeometry.setAttribute("position", new THREE.Float32BufferAttribute(crackPositions, 3));
    this.#crackDisc.add(
      new THREE.LineSegments(
        crackGeometry,
        new THREE.LineBasicMaterial({
          color: 0x173746,
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
        }),
      ),
    );
    this.#crackDisc.visible = false;
    this.#root.add(this.#crackDisc);

    this.#skid = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.012, 0.055),
      transparentMaterial(0xc7efff, 0.62),
    );
    this.#skid.visible = false;
    this.#root.add(this.#skid);
  }

  #groundY(x: number, z: number, lift = 0.04): number {
    return (this.#scene.query.heightAt(x, z) ?? 0) + lift;
  }

  pulse(
    x: number,
    z: number,
    color: THREE.ColorRepresentation,
    radius = 1,
    durationMs = 480,
    startedAt = performance.now(),
  ): void {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.72, 1, 48), transparentMaterial(color));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, this.#groundY(x, z), z);
    this.#root.add(mesh);
    this.#effects.push({
      object: mesh,
      startedAt,
      endsAt: startedAt + Math.max(1, durationMs),
      update(progress) {
        const scale = radius * (0.18 + progress * 0.82);
        mesh.scale.setScalar(scale);
        materialOpacity(mesh, 1 - progress);
      },
    });
  }

  beam(
    from: GroundVector,
    to: GroundVector,
    width: number,
    color: THREE.ColorRepresentation,
    durationMs = 420,
    startedAt = performance.now(),
  ): void {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const length = Math.hypot(dx, dz);
    if (length <= 0.001) {
      this.pulse(from.x, from.z, color, width * 2, durationMs, startedAt);
      return;
    }
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(length, 0.035, Math.max(0.03, width)),
      transparentMaterial(color, 0.75),
    );
    const x = (from.x + to.x) / 2;
    const z = (from.z + to.z) / 2;
    mesh.position.set(x, this.#groundY(x, z, 0.07), z);
    mesh.rotation.y = -Math.atan2(dz, dx);
    this.#root.add(mesh);
    this.#effects.push({
      object: mesh,
      startedAt,
      endsAt: startedAt + Math.max(1, durationMs),
      update(progress) {
        materialOpacity(mesh, 0.75 * (1 - progress));
      },
    });
  }

  orb(
    x: number,
    z: number,
    color: THREE.ColorRepresentation,
    radius: number,
    durationMs: number,
    startedAt = performance.now(),
  ): void {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(Math.max(0.08, radius), 18, 12),
      transparentMaterial(color, 0.82),
    );
    mesh.position.set(x, this.#groundY(x, z, radius + 0.12), z);
    this.#root.add(mesh);
    this.#effects.push({
      object: mesh,
      startedAt,
      endsAt: startedAt + Math.max(1, durationMs),
      update(progress) {
        const breathe = 1 + Math.sin(progress * Math.PI * 6) * 0.16;
        mesh.scale.setScalar(breathe);
        materialOpacity(mesh, Math.min(0.82, (1 - progress) * 1.5));
      },
    });
  }

  #ripple(x: number, z: number, strength = 1, now = performance.now()): void {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.28, 0.38, 40),
      transparentMaterial(0xcff5ff, 0.55),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, this.#waterLevel + 0.025, z);
    mesh.renderOrder = 3;
    this.#root.add(mesh);
    this.#effects.push({
      object: mesh,
      startedAt: now,
      endsAt: now + 2_400,
      update(progress) {
        mesh.scale.setScalar(strength * (0.5 + Math.sqrt(progress) * 2.6));
        materialOpacity(mesh, (1 - progress) * 0.55);
      },
    });
  }

  #splash(x: number, y: number, z: number, now = performance.now()): void {
    if (!this.#textures) {
      this.pulse(x, z, 0xd8f7ff, 0.9, 450, now);
      return;
    }
    const map = this.#textures.get(HD2D_SPLASH_TEXTURE_URL).clone();
    map.repeat.set(1 / 9, 1);
    map.offset.set(0, 0);
    map.needsUpdate = true;
    const material = new THREE.SpriteMaterial({
      map,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.center.set(0.5, 0.32);
    sprite.scale.set(1.7, 1.7, 1);
    sprite.position.set(x, y, z);
    sprite.renderOrder = 4;
    this.#root.add(sprite);
    const duration = (9 / 20) * 1_000;
    this.#effects.push({
      object: sprite,
      startedAt: now,
      endsAt: now + duration,
      update(progress) {
        map.offset.x = Math.min(8, Math.floor(progress * 9)) / 9;
      },
      dispose() {
        sprite.removeFromParent();
        sprite.geometry.dispose();
        material.dispose();
        map.dispose();
      },
    });
  }

  /** Exact lab critter blast: the authored nine-frame, unlit sheet at 12 fps and 2.6 tiles high. */
  playSheepExplosion(x: number, z: number, now = performance.now()): void {
    if (!this.#textures) {
      this.pulse(x, z, 0xff9f45, 1.2, 750, now);
      return;
    }
    const billboard = makeBillboard(this.#scene.ctx, {
      texture: this.#textures.get(HD2D_SHEEP_EXPLOSION_TEXTURE_URL),
      cols: 9,
      rows: 1,
      height: 2.6,
      aspect: 1,
      foot: 0.3,
      lit: false,
    });
    billboard.placeAt(x, this.#groundY(x, z, 0), z);
    this.#root.add(billboard.mesh);
    const duration = (9 / 12) * 1_000;
    this.#effects.push({
      object: billboard.mesh,
      startedAt: now,
      endsAt: now + duration,
      update(progress) {
        billboard.setFrame(Math.min(8, Math.floor(progress * 9)));
      },
      dispose() {
        billboard.mesh.removeFromParent();
        billboard.dispose();
      },
    });
  }

  #footprint(event: Extract<HeroEvent, { t: "trace" }>, hero: PlayerSnapshot, now: number): void {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.012, 0.4),
      transparentMaterial(0x536d78, 0.7),
    );
    mesh.position.set(event.x, this.#groundY(event.x, event.z, 0.025), event.z);
    mesh.rotation.y = -Math.atan2(hero.facing.z, hero.facing.x);
    this.#root.add(mesh);
    this.#effects.push({
      object: mesh,
      startedAt: now,
      endsAt: now + 4_500,
      update(progress) {
        materialOpacity(mesh, 0.7 * (1 - progress));
      },
    });
  }

  #breath(hero: PlayerSnapshot, now: number): void {
    const puff = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 10, 7),
      transparentMaterial(0xeaf8ff, 0.88),
    );
    puff.position.set(hero.x + hero.facing.x * 0.22, hero.y + 1.8, hero.z + hero.facing.z * 0.22);
    const startY = puff.position.y;
    this.#root.add(puff);
    this.#effects.push({
      object: puff,
      startedAt: now,
      endsAt: now + 900,
      update(progress) {
        puff.position.y = startY + progress * 0.5;
        puff.scale.setScalar(1 + progress * 1.4);
        materialOpacity(puff, 0.88 * (1 - progress));
      },
    });
  }

  playHeroMovement(events: readonly HeroEvent[], hero: PlayerSnapshot | null): void {
    const now = performance.now();
    let skid = 0;
    for (const event of events) {
      if (event.t === "glisse") skid = Math.max(skid, event.intensite);
      else if (event.t === "trace" && hero) this.#footprint(event, hero, now);
      else if (event.t === "haleine" && hero) this.#breath(hero, now);
      else if (event.t === "brasse" && hero) this.#ripple(hero.x, hero.z, 0.8, now);
      else if (event.t === "entree-eau" || event.t === "sortie-eau" || event.t === "noyade")
        this.#splash(event.x, event.y, event.z, now);
      else if (event.t === "reception" && hero)
        this.pulse(hero.x, hero.z, 0xd8c49c, Math.min(1.2, 0.45 + event.force * 0.04), 360, now);
      else if (event.t === "glace-craque") this.pulse(event.x, event.z, 0x294e63, 0.9, 520, now);
    }
    this.#skid.visible = hero !== null && skid > 0.03;
    if (hero && this.#skid.visible) {
      this.#skid.position.set(
        hero.x - hero.facing.x * 0.38,
        this.#groundY(hero.x, hero.z, 0.035),
        hero.z - hero.facing.z * 0.38,
      );
      this.#skid.rotation.y = -Math.atan2(hero.facing.z, hero.facing.x);
      this.#skid.scale.x = 0.45 + skid * 0.9;
      materialOpacity(this.#skid, 0.25 + skid * 0.5);
    }
  }

  syncLocalHero(
    hero: PlayerSnapshot | null,
    movement: LocalMovementVisualState | null,
    now: number,
  ): void {
    this.#swimDisc.visible = hero?.swimming ?? false;
    if (hero?.swimming) {
      this.#swimDisc.position.set(hero.x, this.#waterLevel + 0.03, hero.z);
      if (now >= this.#nextRippleAt) {
        this.#ripple(hero.x, hero.z, 1, now);
        this.#nextRippleAt = now + 550;
      }
    } else this.#nextRippleAt = now;

    const maxBreath = movement?.maxBreath ?? 0;
    const showBreath = hero !== null && movement?.swimming === true && maxBreath > 0;
    this.#breathBar.visible = showBreath;
    if (showBreath && hero && movement) {
      const ratio = THREE.MathUtils.clamp(movement.breath / maxBreath, 0, 1);
      this.#breathBar.position.set(hero.x, Math.max(hero.y, this.#waterLevel) + 1.82, hero.z);
      this.#breathBar.rotation.y = this.#scene.ctx.yaw();
      this.#breathFill.scale.x = Math.max(0.001, ratio);
      this.#breathFill.position.x = -(1 - ratio) * 0.47;
      const material = this.#breathFill.material as THREE.MeshBasicMaterial;
      material.color.setHex(ratio <= 0.25 ? 0xf06b5d : ratio <= 0.5 ? 0xf2bd56 : 0x73ddf2);
    }

    const crack = movement?.iceCrack ?? null;
    this.#crackDisc.visible = crack !== null;
    if (crack)
      this.#crackDisc.position.set(crack.x, this.#groundY(crack.x, crack.z, 0.035), crack.z);
  }

  setMerchant(merchant: MerchantDefinition | null): void {
    if (this.#merchant) disposeObject(this.#merchant);
    this.#merchant = null;
    if (!merchant) return;
    const marker = new THREE.Mesh(
      new THREE.TorusGeometry(0.46, 0.09, 10, 32),
      transparentMaterial(0xf5c451),
    );
    marker.rotation.x = Math.PI / 2;
    marker.position.set(merchant.x, this.#groundY(merchant.x, merchant.y, 0.72), merchant.y);
    this.#root.add(marker);
    this.#merchant = marker;
  }

  showCamp(camp: PeasantCampVisual, endsAt: number): void {
    this.removeCamp(camp.id);
    const group = new THREE.Group();
    const tent = new THREE.Mesh(
      new THREE.ConeGeometry(0.62, 1.15, 4),
      new THREE.MeshStandardMaterial({ color: 0xc7894d, roughness: 0.9 }),
    );
    tent.rotation.y = Math.PI / 4;
    tent.position.y = 0.58;
    const range = new THREE.Mesh(
      new THREE.RingGeometry(0.97, 1, 48),
      transparentMaterial(0xf2c879, 0.38),
    );
    range.rotation.x = -Math.PI / 2;
    range.scale.setScalar(camp.radius);
    group.add(tent, range);
    group.position.set(camp.x, this.#groundY(camp.x, camp.z), camp.z);
    this.#root.add(group);
    this.#camps.set(camp.id, { object: group, endsAt });
  }

  removeCamp(id: string): void {
    const camp = this.#camps.get(id);
    if (!camp) return;
    disposeObject(camp.object);
    this.#camps.delete(id);
  }

  setAim(origin: GroundVector, direction: GroundVector, range: number): void {
    this.hideAim();
    const to = { x: origin.x + direction.x * range, z: origin.z + direction.z * range };
    const dx = to.x - origin.x;
    const dz = to.z - origin.z;
    const length = Math.max(0.01, Math.hypot(dx, dz));
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(length, 0.025, 0.08),
      transparentMaterial(0xffd45c, 0.8),
    );
    const x = (origin.x + to.x) / 2;
    const z = (origin.z + to.z) / 2;
    mesh.position.set(x, this.#groundY(x, z, 0.08), z);
    mesh.rotation.y = -Math.atan2(dz, dx);
    this.#root.add(mesh);
    this.#aim = mesh;
  }

  hideAim(): void {
    if (!this.#aim) return;
    disposeObject(this.#aim);
    this.#aim = null;
  }

  setQuestMarkers(markers: readonly AuthoredQuestMarker[]): void {
    this.#questState = markers;
    this.#questVisualKey = "";
    this.#rebuildQuestMarkers();
  }

  hideQuestSite(id: string, durationMs: number): void {
    this.#hiddenQuestSites.set(id, performance.now() + Math.max(0, durationMs));
    this.#questVisualKey = "";
    const marker = this.#questMarkers.get(id);
    if (!marker) return;
    disposeObject(marker);
    this.#questMarkers.delete(id);
  }

  #rebuildQuestMarkers(): void {
    for (const marker of this.#questMarkers.values()) disposeObject(marker);
    this.#questMarkers.clear();
    const eventById = new Map(this.#events.map((event) => [event.id, event]));
    const colors = { available: 0xf2d14f, active: 0x62aaf7, ready: 0x5de28a } as const;
    for (const marker of this.#questState) {
      if ((this.#hiddenQuestSites.get(marker.eventId) ?? 0) > performance.now()) continue;
      const event = eventById.get(marker.eventId);
      if (!event) continue;
      const x = event.col + 0.5 - this.#size / 2;
      const z = event.row + 0.5 - this.#size / 2;
      const mesh = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.22),
        transparentMaterial(colors[marker.kind]),
      );
      mesh.position.set(x, this.#groundY(x, z, 1.55), z);
      this.#root.add(mesh);
      this.#questMarkers.set(marker.eventId, mesh);
    }
  }

  sync(sample: SceneSample, now: number): void {
    this.#events = sample.events;
    this.#syncLoot(sample);
    this.#syncProjectiles(sample, now);
    this.#syncEventMarkers(sample.events);
    const eventById = new Map(sample.events.map((event) => [event.id, event]));
    const questVisualKey = this.#questState
      .map((marker) => {
        const event = eventById.get(marker.eventId);
        return `${marker.eventId}:${marker.kind}:${event?.col ?? ""}:${event?.row ?? ""}`;
      })
      .join("|");
    if (questVisualKey !== this.#questVisualKey) {
      this.#questVisualKey = questVisualKey;
      this.#rebuildQuestMarkers();
    }
    this.update(now);
  }

  #syncLoot(sample: SceneSample): void {
    const present = new Set<string>();
    for (const loot of sample.loot) {
      present.add(loot.id);
      let object = this.#loot.get(loot.id);
      if (!object) {
        object = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.18),
          new THREE.MeshStandardMaterial({
            color: colorFromText(loot.kind),
            emissive: colorFromText(loot.kind),
            emissiveIntensity: 0.22,
          }),
        );
        this.#root.add(object);
        this.#loot.set(loot.id, object);
      }
      object.position.set(loot.x, loot.y + 0.24, loot.z);
    }
    for (const [id, object] of this.#loot) {
      if (present.has(id)) continue;
      disposeObject(object);
      this.#loot.delete(id);
    }
  }

  #syncProjectiles(sample: SceneSample, now: number): void {
    const present = new Set<string>();
    for (const projectile of sample.projectiles) {
      present.add(projectile.id);
      let object = this.#projectiles.get(projectile.id);
      if (!object) {
        object = projectileMesh(
          projectileVisual(projectile.kind),
          projectile.radius,
          colorFromText(projectile.color),
        );
        this.#root.add(object);
        this.#projectiles.set(projectile.id, object);
      }
      object.position.set(projectile.x, projectile.y, projectile.z);
      object.rotation.y = Math.atan2(projectile.direction.x, projectile.direction.z);
      const definition = projectileVisual(projectile.kind);
      const age = Math.max(0, now - projectile.spawnedAt) / 1_000;
      const pulse = 1 + Math.sin(age * 11) * definition.pulse;
      object.scale.setScalar(pulse);
      const spinRoot = object.userData.spinRoot;
      if (spinRoot instanceof THREE.Object3D) spinRoot.rotation.z = age * definition.spin;
    }
    for (const [id, object] of this.#projectiles) {
      if (present.has(id)) continue;
      disposeObject(object);
      this.#projectiles.delete(id);
    }
  }

  #syncEventMarkers(events: readonly WorldEventSnapshot[]): void {
    const present = new Set<string>();
    for (const event of events) {
      const needsMarker =
        event.presentation !== "native" || event.graphicAssetId === null || !!event.harvest;
      if (!needsMarker) continue;
      present.add(event.id);
      let object = this.#eventMarkers.get(event.id);
      if (!object) {
        object = new THREE.Mesh(
          new THREE.TorusGeometry(0.25, 0.045, 8, 24),
          transparentMaterial(0x73d6b2, 0.6),
        );
        object.rotation.x = Math.PI / 2;
        this.#root.add(object);
        this.#eventMarkers.set(event.id, object);
      }
      const x = event.col + 0.5 - this.#size / 2;
      const z = event.row + 0.5 - this.#size / 2;
      object.position.set(x, this.#groundY(x, z, 0.06), z);
      object.visible =
        event.harvest?.state !== "depleted" || event.harvest.exhaustionBehavior !== "hide";
      materialOpacity(object, event.harvest?.state === "depleted" ? 0.2 : 0.6);
    }
    for (const [id, object] of this.#eventMarkers) {
      if (present.has(id)) continue;
      disposeObject(object);
      this.#eventMarkers.delete(id);
    }
  }

  showWorldEvent(
    text: string,
    tone: "info" | "good" | "bad",
    x: number,
    z: number,
    now = performance.now(),
  ): void {
    if (typeof document === "undefined") return;
    const element = document.createElement("div");
    element.textContent = text;
    element.dataset.tone = tone;
    Object.assign(element.style, {
      position: "fixed",
      zIndex: "40",
      pointerEvents: "none",
      transform: "translate(-50%, -100%)",
      color: tone === "bad" ? "#ff8b77" : tone === "good" ? "#8ff0ad" : "#f8e6b4",
      fontFamily: '"Alegreya Sans SC", sans-serif',
      fontWeight: "800",
      fontSize: "15px",
      textShadow: "0 2px 3px #142019, 0 0 8px #142019",
      whiteSpace: "nowrap",
    });
    document.body.append(element);
    this.#labels.push({
      element,
      point: new THREE.Vector3(x, this.#groundY(x, z, 1.4), z),
      endsAt: now + 1500,
    });
  }

  screenToWorld(clientX: number, clientY: number): GroundVector | null {
    const rect = this.#canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.#scene.camera.updateMatrixWorld();
    this.#raycaster.setFromCamera(ndc, this.#scene.camera);
    const point = this.#scene.pickGround(this.#raycaster);
    if (!point) return null;
    const half = this.#size / 2;
    if (point.x < -half || point.x > half || point.z < -half || point.z > half) {
      return null;
    }
    return point;
  }

  setEditorOverlay(overlay: Hd2dEditorOverlay | null): void {
    this.#editorOverlay = overlay;
    for (const child of [...this.#editorRoot.children]) disposeObject(child);
    this.#editorRoot.clear();
    if (!overlay) {
      this.#positionEditorPreview();
      return;
    }

    const half = this.#size / 2;
    const lift = overlay.dim ? 0.085 : 0.06;
    if (overlay.showGrid) {
      const positions: number[] = [];
      const point = (x: number, z: number): void => {
        positions.push(x, this.#groundY(x, z, lift), z);
      };
      for (let col = 0; col <= overlay.cols; col += 1) {
        const x = col - half;
        for (let row = 0; row < overlay.rows; row += 1) {
          point(x, row - half);
          point(x, row + 1 - half);
        }
      }
      for (let row = 0; row <= overlay.rows; row += 1) {
        const z = row - half;
        for (let col = 0; col < overlay.cols; col += 1) {
          point(col - half, z);
          point(col + 1 - half, z);
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      const material = new THREE.LineBasicMaterial({
        color: overlay.dim ? 0x9fc4c0 : 0xdce8cb,
        transparent: true,
        opacity: overlay.dim ? 0.5 : 0.3,
        depthWrite: false,
        toneMapped: false,
      });
      this.#editorRoot.add(new THREE.LineSegments(geometry, material));
    }

    if (overlay.showCollisions) {
      for (const collider of overlay.colliders) {
        const x = collider.x + collider.w / 2;
        const z = collider.z + collider.h / 2;
        const mesh = new THREE.Mesh(
          new THREE.PlaneGeometry(collider.w, collider.h),
          transparentMaterial(0xd84b3e, 0.38),
        );
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(x, this.#groundY(x, z, 0.1), z);
        this.#editorRoot.add(mesh);
      }
    }

    const addCursor = (point: GroundVector, color: number, scale: number): void => {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.42 * scale, 0.5 * scale, 4),
        transparentMaterial(color, 0.92),
      );
      ring.rotation.set(-Math.PI / 2, 0, Math.PI / 4);
      ring.position.set(point.x, this.#groundY(point.x, point.z, 0.13), point.z);
      this.#editorRoot.add(ring);
    };
    if (overlay.hover) addCursor(overlay.hover, 0xffd66b, 1);
    if (overlay.selection) addCursor(overlay.selection, 0x57d6ff, 1.12);
    if (overlay.assetPreview) {
      for (const point of overlay.assetPreview.footprint) {
        const cell = new THREE.Mesh(
          new THREE.PlaneGeometry(0.96, 0.96),
          transparentMaterial(overlay.assetPreview.valid ? 0xffd66b : 0xe34d42, 0.22),
        );
        cell.rotation.x = -Math.PI / 2;
        cell.position.set(point.x, this.#groundY(point.x, point.z, 0.105), point.z);
        this.#editorRoot.add(cell);
      }
    }
    if (overlay.stairsPreview) {
      const atlas = this.#textures ? terrainAtlases(this.#textures).lvl0 : null;
      if (atlas) {
        const preview = meshStairs([overlay.stairsPreview.ramp], {
          levelHeight: overlay.stairsPreview.levelHeight,
          atlas,
          color: overlay.stairsPreview.valid ? 0xffd66b : 0xe34d42,
          opacity: 0.58,
          lift: 0.03,
        });
        this.#editorRoot.add(preview.group);
      }
    }
    this.#positionEditorPreview();
  }

  setEditorPreviewArt(art: StaticSpriteArt | null): void {
    for (const preview of this.#editorPreviews) {
      preview.sprite.mesh.removeFromParent();
      preview.sprite.dispose();
    }
    this.#editorPreviews.length = 0;
    this.#editorPreviewRoot.clear();
    if (!art) return;
    const layers: StaticSpriteArt[] = [];
    const coldLayers: StaticSpriteArt[] = [];
    const collect = (layer: StaticSpriteArt, target: StaticSpriteArt[]): void => {
      target.push(layer);
      for (const companion of layer.companions ?? []) collect(companion, target);
    };
    collect(art, layers);
    if (art.coldVariant) collect(art.coldVariant, coldLayers);
    for (const [layer, cold] of [
      ...layers.map((entry) => [entry, false] as const),
      ...coldLayers.map((entry) => [entry, true] as const),
    ]) {
      const sky = layer.renderLayer === "sky";
      const flat = sky || layer.renderMode === "flat";
      const preview = flat
        ? makeFlatSprite(this.#scene.ctx, {
            texture: layer.texture,
            cols: layer.cols ?? 1,
            rows: layer.rows ?? 1,
            size: layer.flatSize ?? layer.height * (layer.aspect ?? 1),
            aspect: 1 / (layer.aspect ?? 1),
            alphaTest: 0.5,
            graftCloudShadow: () => undefined,
          })
        : makeBillboard(this.#scene.ctx, {
            texture: layer.texture,
            cols: layer.cols ?? 1,
            rows: layer.rows ?? 1,
            height: layer.height,
            aspect: layer.aspect ?? 1,
            foot: layer.foot ?? 0,
            ...(layer.uvRect ? { uvRect: layer.uvRect } : {}),
            ...(layer.lit === undefined ? {} : { lit: layer.lit }),
            pitch: HD2D_CAMERA.pitch,
          });
      materialOpacity(preview.mesh, 0.62);
      preview.mesh.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) material.depthWrite = false;
      });
      preview.mesh.renderOrder = 8;
      this.#editorPreviews.push({ sprite: preview, art: layer, cold });
      this.#editorPreviewRoot.add(preview.mesh);
    }
    this.#positionEditorPreview();
  }

  #positionEditorPreview(): void {
    const placement = this.#editorOverlay?.assetPreview;
    if (!placement) {
      for (const preview of this.#editorPreviews) preview.sprite.mesh.visible = false;
      return;
    }
    const coldMaterial = isColdBiomeMaterial(
      this.#materialAt(placement.point.x, placement.point.z),
    );
    const hasColdVariant = this.#editorPreviews.some((preview) => preview.cold);
    for (const preview of this.#editorPreviews) {
      preview.sprite.mesh.visible = !hasColdVariant || preview.cold === coldMaterial;
      if (preview.art.renderLayer === "sky") {
        preview.sprite.mesh.position.set(
          placement.point.x,
          placement.skyAltitude ?? this.#waterLevel + 2,
          placement.point.z,
        );
      } else if (preview.art.renderMode === "flat") {
        preview.sprite.mesh.position.set(
          placement.point.x,
          this.#groundY(placement.point.x, placement.point.z, 0.055),
          placement.point.z,
        );
      } else {
        (preview.sprite as Billboard).placeAt(
          placement.point.x,
          this.#groundY(placement.point.x, placement.point.z, 0.025),
          placement.point.z,
        );
      }
    }
  }

  update(now: number): void {
    for (const preview of this.#editorPreviews) {
      const frames = (preview.art.cols ?? 1) * (preview.art.rows ?? 1);
      preview.sprite.setFrame(
        staticAnimationFrame(now, preview.art.animationDurationMs ?? 0, frames),
      );
    }
    for (let index = this.#effects.length - 1; index >= 0; index -= 1) {
      const effect = this.#effects[index];
      if (!effect) continue;
      effect.object.visible = now >= effect.startedAt;
      if (now < effect.startedAt) continue;
      if (now >= effect.endsAt) {
        if (effect.dispose) effect.dispose();
        else disposeObject(effect.object);
        this.#effects.splice(index, 1);
        continue;
      }
      effect.update(
        THREE.MathUtils.clamp((now - effect.startedAt) / (effect.endsAt - effect.startedAt), 0, 1),
      );
    }
    for (const [id, camp] of this.#camps) {
      if (now < camp.endsAt) continue;
      disposeObject(camp.object);
      this.#camps.delete(id);
    }
    for (const [id, until] of this.#hiddenQuestSites) {
      if (now < until) continue;
      this.#hiddenQuestSites.delete(id);
      this.#questVisualKey = "";
    }
    for (let index = this.#labels.length - 1; index >= 0; index -= 1) {
      const label = this.#labels[index];
      if (!label) continue;
      if (now >= label.endsAt) {
        label.element.remove();
        this.#labels.splice(index, 1);
        continue;
      }
      const projected = label.point.clone().project(this.#scene.camera);
      const rect = this.#canvas.getBoundingClientRect();
      label.element.style.left = `${rect.left + (projected.x * 0.5 + 0.5) * rect.width}px`;
      label.element.style.top = `${rect.top + (-projected.y * 0.5 + 0.5) * rect.height}px`;
      label.element.style.opacity = String(Math.min(1, (label.endsAt - now) / 350));
    }
  }

  diagnostics(): Record<string, number> {
    return {
      actorsSecondary: this.#loot.size + this.#projectiles.size,
      camps: this.#camps.size,
      effects: this.#effects.length,
      movementSurfaces:
        Number(this.#swimDisc.visible) +
        Number(this.#breathBar.visible) +
        Number(this.#crackDisc.visible) +
        Number(this.#skid.visible),
      eventMarkers: this.#eventMarkers.size,
      labels: this.#labels.length,
      questMarkers: this.#questMarkers.size,
    };
  }

  dispose(): void {
    this.setEditorPreviewArt(null);
    for (const label of this.#labels) label.element.remove();
    this.#labels.length = 0;
    for (const effect of this.#effects) {
      if (effect.dispose) effect.dispose();
    }
    disposeObject(this.#root);
    this.#effects.length = 0;
    this.#loot.clear();
    this.#projectiles.clear();
    this.#eventMarkers.clear();
    this.#camps.clear();
    this.#questMarkers.clear();
    this.#hiddenQuestSites.clear();
    this.#merchant = null;
    this.#aim = null;
  }
}
