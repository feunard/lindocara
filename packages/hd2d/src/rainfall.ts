import * as THREE from "three";

import type { Hd2dContext } from "./context.js";

/**
 * Rain, as a curtain of falling streaks that travels with the camera.
 *
 * **Streaks, not points, and that is the whole reason this is not `createPetalFall` with a grey
 * colour.** Every swarm in `particles.ts` draws `THREE.Points`, whose sprite is a round dot: a
 * cloud of falling dots reads as snow at any speed, because what says "rain" is the vertical smear
 * a drop leaves, not the drop. A line segment IS that smear, for two vertices instead of one.
 *
 * **It travels, rather than covering the map.** A curtain wide enough for a 60-cell map would be
 * tens of thousands of drops to keep the same density in front of the camera, and every one of them
 * outside the frustum costs the same as one inside it. The caller moves `setCentre` to whatever the
 * camera is looking at, the drops stay in LOCAL coordinates, and moving the group moves the whole
 * curtain for one transform. Rain has no parallax to lose: one wall of water looks like any other.
 *
 * The drops are recycled, never allocated: a drop that falls past the floor is respawned at the top
 * with a fresh position in the disc, so the buffer is written and never resized.
 */
export interface Rainfall {
  group: THREE.Group;
  /** Move the curtain to follow the camera's focus, in world units. */
  setCentre(x: number, z: number): void;
  /** 0 stops the rain without freeing it, which is how a weather change fades rather than cuts. */
  setIntensity(intensity: number): void;
  update(dt: number): void;
  dispose(): void;
}

export interface RainfallOptions {
  /** Radius of the disc drops fall inside, in world units (1 = one cell). */
  radius: number;
  /** How high above the centre a drop is born, and therefore how long it lives. */
  height: number;
  /** Drops in flight. The default is tuned for the game's camera framing, not for a wide shot. */
  count?: number;
  color?: THREE.ColorRepresentation;
  /** Fall speed, world units per second. */
  speed?: number;
  /** Streak length, world units. Kept proportional to `speed` by the default. */
  streak?: number;
  /** Wind, world units per second, as `[x, z]`. A dead-vertical drop reads as a hanging thread. */
  wind?: readonly [number, number];
  /** Where the drops die, relative to the centre. Below the ground so they never end mid-air. */
  floor?: number;
}

interface Drop {
  x: number;
  y: number;
  z: number;
}

// `_ctx` is read by nothing here, the same as `createParticleField` and `createPetalFall`: every
// scene factory in this package takes the calling game's or editor's context, so a caller never has
// to ask which of them actually needs one.
export function createRainfall(_ctx: Hd2dContext, opts: RainfallOptions): Rainfall {
  const {
    radius,
    height,
    count = 900,
    color = 0xbcd8e6,
    speed = 14,
    streak = 0.55,
    wind = [1.1, 0.35],
    floor = -0.5,
  } = opts;

  const group = new THREE.Group();
  group.name = "rainfall";
  // Two vertices per drop: the head where it is, the tail where it was a streak ago.
  const positions = new Float32Array(count * 6);
  const attribute = new THREE.BufferAttribute(positions, 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", attribute);
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.55,
    // Rain in front of a cliff must not punch a hole in the depth buffer the sprites behind it are
    // tested against, and it is far too thin to be worth sorting.
    depthWrite: false,
    toneMapped: false,
  });
  const lines = new THREE.LineSegments(geometry, material);
  // The curtain is centred on the camera's focus and is therefore never fully in front of it; the
  // culling test on its own bounding box would pop the whole thing out at a grazing angle.
  lines.frustumCulled = false;
  group.add(lines);

  const drops: Drop[] = [];
  const respawn = (drop: Drop, everywhere: boolean): void => {
    const angle = Math.random() * Math.PI * 2;
    // Square root, so the disc fills uniformly instead of crowding its centre.
    const distance = Math.sqrt(Math.random()) * radius;
    drop.x = Math.cos(angle) * distance;
    drop.z = Math.sin(angle) * distance;
    // On the first fill the drops are spread through the whole column; afterwards a recycled drop
    // starts at the top. Without that, every drop is born at the same instant and the curtain falls
    // in visible waves.
    drop.y = everywhere ? floor + Math.random() * (height - floor) : height;
  };
  for (let index = 0; index < count; index += 1) {
    const drop: Drop = { x: 0, y: 0, z: 0 };
    respawn(drop, true);
    drops.push(drop);
  }

  const [windX, windZ] = wind;
  // The streak points along the drop's own velocity, so wind slants the smear as well as the path.
  const fall = new THREE.Vector3(windX, -speed, windZ);
  const tail = fall.clone().normalize().multiplyScalar(-streak);

  let intensity = 1;

  const write = (): void => {
    for (let index = 0; index < drops.length; index += 1) {
      const drop = drops[index];
      if (!drop) continue;
      const head = index * 6;
      positions[head] = drop.x;
      positions[head + 1] = drop.y;
      positions[head + 2] = drop.z;
      positions[head + 3] = drop.x + tail.x;
      positions[head + 4] = drop.y + tail.y;
      positions[head + 5] = drop.z + tail.z;
    }
    attribute.needsUpdate = true;
  };
  write();

  return {
    group,
    setCentre(x, z) {
      group.position.x = x;
      group.position.z = z;
    },
    setIntensity(next) {
      intensity = THREE.MathUtils.clamp(next, 0, 1);
      material.opacity = 0.55 * intensity;
      lines.visible = intensity > 0.01;
    },
    update(dt) {
      if (!lines.visible) return;
      for (const drop of drops) {
        drop.x += windX * dt;
        drop.y -= speed * dt;
        drop.z += windZ * dt;
        if (drop.y <= floor) respawn(drop, false);
      }
      write();
    },
    dispose() {
      group.removeFromParent();
      group.clear();
      geometry.dispose();
      material.dispose();
    },
  };
}
