import {
  type Animator,
  type Billboard,
  createAnimator,
  makeBillboard,
} from "@lindocara/hd2d/billboard.js";
import type { Hd2dContext } from "@lindocara/hd2d/context.js";
import type { TextureRegistry } from "@lindocara/hd2d/textures.js";
import * as THREE from "three";
import { bleat, pop } from "../core/audio.js";
import { CAMERA } from "../settings.js";
import type { TerrainQuery } from "./terrain-query.js";

// HappySheep_All : 8 colonnes x 2 lignes de 128px. Ligne 0 au repos, ligne 1 le
// sautillement (6 frames utiles seulement).
// Bas du sprite (ombre peinte comprise) mesuré à 85 px sur 128.
const SHEET = { cols: 8, rows: 2, height: 1.5, foot: 0.34 };
const IDLE = { row: 0, frames: 8, fps: 6 };
const HOP = { row: 1, frames: 6, fps: 9 };

const SPEED = 0.85;
const WANDER = { idle: [1.2, 4.0] as const, walk: [0.8, 2.2] as const }; // durées min/max, en secondes
const CLICKS_TO_POP = 4; // comme les critters de Warcraft 3

// Explosions.png : 9 frames de 192px.
const BLAST = { cols: 9, frames: 9, fps: 12, height: 2.6, foot: 0.3 };

interface SheepState {
  billboard: Billboard;
  anim: Animator;
  x: number;
  z: number;
  level: number | null;
  dir: [number, number];
  state: "idle" | "walk";
  timer: number;
  facing: 1 | -1;
  clicks: number;
  pitch: number; // chaque mouton a sa voix
  dead: boolean;
}

interface Blast {
  billboard: Billboard;
  t: number;
}

export interface Flock {
  group: THREE.Group;
  onExplode: ((x: number, z: number) => void) | null;
  readonly meshes: readonly THREE.Mesh[];
  /** Clic sur un mouton : il bêle, de plus en plus aigu. Au bout, il éclate. */
  hit(mesh: THREE.Object3D): void;
  update(dt: number): void;
}

export function createFlock(
  ctx: Hd2dContext,
  textures: TextureRegistry,
  query: TerrainQuery,
  positions: readonly (readonly [number, number])[],
  rng: () => number = Math.random,
): Flock {
  const group = new THREE.Group();
  const sheep: SheepState[] = [];
  const blasts: Blast[] = [];

  for (const [x, z] of positions) {
    const billboard = makeBillboard(ctx, {
      texture: textures.get("/tex/sheep.png"),
      cols: SHEET.cols,
      rows: SHEET.rows,
      height: SHEET.height,
      aspect: 1,
      foot: SHEET.foot,
      pitch: CAMERA.pitch,
    });
    const y = query.heightAt(x, z) ?? 0;
    billboard.placeAt(x, y, z);
    group.add(billboard.mesh);

    const anim = createAnimator(billboard, { ...IDLE }, SHEET.cols);
    anim.setPhase(rng() * 40);

    const s: SheepState = {
      billboard,
      anim,
      x,
      z,
      level: query.levelAt(x, z),
      dir: [0, 0],
      state: "idle",
      timer: rng() * 2,
      facing: rng() > 0.5 ? 1 : -1,
      clicks: 0,
      pitch: (rng() - 0.5) * 7,
      dead: false,
    };
    billboard.mesh.userData.sheep = s;
    sheep.push(s);
  }

  const between = ([a, b]: readonly [number, number]): number => a + rng() * (b - a);

  function retarget(s: SheepState): void {
    const a = rng() * Math.PI * 2;
    s.dir = [Math.cos(a), Math.sin(a)];
    s.facing = s.dir[0] >= 0 ? 1 : -1;
  }

  // La caméra vient s'y accrocher : une détonation sans secousse n'a pas de poids.
  let onExplode: ((x: number, z: number) => void) | null = null;

  function explode(s: SheepState): void {
    s.dead = true;
    group.remove(s.billboard.mesh);
    s.billboard.dispose();

    const billboard = makeBillboard(ctx, {
      texture: textures.get("/tex/explosion.png"),
      cols: BLAST.cols,
      rows: 1,
      height: BLAST.height,
      aspect: 1,
      foot: BLAST.foot,
      lit: false,
      pitch: CAMERA.pitch,
    });
    billboard.placeAt(s.x, query.heightAt(s.x, s.z) ?? 0, s.z);
    group.add(billboard.mesh);
    blasts.push({ billboard, t: 0 });
    pop();
    onExplode?.(s.x, s.z);
  }

  return {
    group,
    get onExplode() {
      return onExplode;
    },
    set onExplode(fn) {
      onExplode = fn;
    },

    get meshes() {
      return sheep.filter((s) => !s.dead).map((s) => s.billboard.mesh);
    },

    hit(mesh) {
      const s = (mesh.userData as { sheep?: SheepState }).sheep;
      if (!s || s.dead) return;
      s.clicks++;
      if (s.clicks >= CLICKS_TO_POP) explode(s);
      // 1.5 demi-ton par clic, contre 2.5 du temps où le bêlement était
      // synthétisé : transposer une VRAIE prise coûte cher. Au troisième clic
      // l'ancien pas montait le mouton de 7.5 demi-tons, soit une lecture à
      // 1.55x — un dessin animé, plus un animal.
      else bleat(s.pitch + s.clicks * 1.5);
    },

    update(dt) {
      for (const s of sheep) {
        if (s.dead) continue;

        s.timer -= dt;
        if (s.timer <= 0) {
          if (s.state === "idle") {
            s.state = "walk";
            s.timer = between(WANDER.walk);
            retarget(s);
          } else {
            s.state = "idle";
            s.timer = between(WANDER.idle);
          }
        }

        if (s.state === "walk") {
          const nx = s.x + s.dir[0] * SPEED * dt;
          const nz = s.z + s.dir[1] * SPEED * dt;
          // Demi-tour plutôt que de franchir un bord : le mouton reste sur son
          // palier et ne tombe jamais à l'eau.
          if (query.levelAt(nx, nz) === s.level) {
            s.x = nx;
            s.z = nz;
          } else {
            retarget(s);
          }
        }

        s.anim.play(s.state === "walk" ? HOP : IDLE);
        s.anim.update(dt);
        s.billboard.setFlip(s.facing < 0);
        s.billboard.placeAt(s.x, query.heightAt(s.x, s.z) ?? 0, s.z);
      }

      // Les explosions jouent une fois puis disparaissent.
      for (let i = blasts.length - 1; i >= 0; i--) {
        const b = blasts[i];
        if (!b) continue;
        b.t += dt * BLAST.fps;
        if (b.t >= BLAST.frames) {
          group.remove(b.billboard.mesh);
          b.billboard.dispose();
          blasts.splice(i, 1);
        } else {
          b.billboard.setFrame(Math.floor(b.t));
        }
      }
    },
  };
}
