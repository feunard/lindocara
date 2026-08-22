import { type Billboard, createAnimator, makeBillboard } from "@lindocara/hd2d/billboard.js";
import type { Hd2dContext } from "@lindocara/hd2d/context.js";
import * as THREE from "three";

import { MIST, RAINBOW, SPRAY, WATER_FOG } from "../settings.js";

// Procedural textures, built once in canvas and never rebuilt — the same pattern as
// `textureVapeur` (`world/props.ts`) and `textureHaleine`/`textureTrace` (`world/hero.ts`).
// Neither the mist nor the spray has a generated artefact planned: the spec's asset list covers
// the rock tileset, the roar, the soundscape and the theme, and nothing else.
let mistTex: THREE.CanvasTexture | undefined;
function textureMist(): THREE.CanvasTexture {
  if (mistTex) return mistTex;
  const S = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = S;
  const cx = canvas.getContext("2d");
  if (!cx) throw new Error("2D context unavailable");
  const g = cx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  // Cool and barely tinted, against the hot spring's warm steam: this is water thrown off cold
  // rock, not vapour off a hot pool.
  g.addColorStop(0, "rgba(226,244,255,0.8)");
  g.addColorStop(0.5, "rgba(210,236,255,0.35)");
  g.addColorStop(1, "rgba(210,236,255,0)");
  cx.fillStyle = g;
  cx.fillRect(0, 0, S, S);
  mistTex = new THREE.CanvasTexture(canvas);
  return mistTex;
}

let sprayTex: THREE.CanvasTexture | undefined;
function textureSpray(): THREE.CanvasTexture {
  if (sprayTex) return sprayTex;
  const S = 32;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = S;
  const cx = canvas.getContext("2d");
  if (!cx) throw new Error("2D context unavailable");
  const g = cx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.6, "rgba(236,250,255,0.6)");
  g.addColorStop(1, "rgba(236,250,255,0)");
  cx.fillStyle = g;
  cx.fillRect(0, 0, S, S);
  sprayTex = new THREE.CanvasTexture(canvas);
  return sprayTex;
}

/**
 * The spectrum band of the rainbow, painted once down a thin strip: the annulus below maps it
 * along its RADIAL axis, so the gradient runs from the arc's inner edge to its outer one. Both
 * ends fade to transparent, which is what keeps the band from reading as a hard-edged ribbon.
 */
function textureRainbow(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 8;
  canvas.height = 64;
  const cx = canvas.getContext("2d");
  if (!cx) throw new Error("2D context unavailable");
  const spectrum = cx.createLinearGradient(0, 0, 0, 64);
  spectrum.addColorStop(0.0, "rgba(255,255,255,0)");
  spectrum.addColorStop(0.15, "rgba(148,90,220,0.55)");
  spectrum.addColorStop(0.35, "rgba(80,150,235,0.7)");
  spectrum.addColorStop(0.55, "rgba(110,215,140,0.7)");
  spectrum.addColorStop(0.75, "rgba(250,225,110,0.7)");
  spectrum.addColorStop(0.9, "rgba(240,120,90,0.5)");
  spectrum.addColorStop(1.0, "rgba(255,255,255,0)");
  cx.fillStyle = spectrum;
  cx.fillRect(0, 0, 8, 64);
  return new THREE.CanvasTexture(canvas);
}

/**
 * A half-annulus in the XY plane, with RADIAL uv mapping: `u` runs along the arc, `v` runs from
 * the inner edge (0) to the outer edge (1).
 *
 * Built by hand rather than with `THREE.RingGeometry`, which looks like exactly the right
 * primitive and is not. Three maps a ring's uvs PLANARLY across its bounding square, not by
 * (angle, radius) — so a gradient painted across `v`, as the spectrum above is, lands almost
 * entirely in the strip's transparent ends and the whole arc renders as one thin vertical line.
 * That is what it did on the first run, at full opacity, with nothing failing anywhere.
 */
function arcBand(inner: number, outer: number, segments: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let s = 0; s <= segments; s++) {
    const t = s / segments;
    const a = t * Math.PI;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    positions.push(c * inner, sn * inner, 0, c * outer, sn * outer, 0);
    uvs.push(t, 0, t, 1);
  }
  for (let s = 0; s < segments; s++) {
    const i = s * 2;
    indices.push(i, i + 1, i + 3, i, i + 3, i + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

interface Puff {
  billboard: Billboard;
  material: THREE.MeshBasicMaterial;
  t: number;
}

interface Drop extends Puff {
  vx: number;
  vy: number;
  vz: number;
}

export interface WaterfallFx {
  group: THREE.Group;
  /** `active` is the zone gate: outside the falls zone the pools neither update nor draw, exactly
   *  the way the snowfall is gated on `enPolaire` in the frame loop. `daylight` (0..1) is the
   *  rainbow's own gate — an arc belongs to sunlight, and the two fade independently because the
   *  hero's position and the hour move on unrelated clocks. */
  update(dt: number, active: boolean, daylight: number): void;
}

/**
 * The mist, the spray and the rainbow of the west island's cascade.
 *
 * The two particle pools are SHARED across every impact point rather than one pool per fall:
 * the total is what costs, and three separate 26-puff pools would be three times the billboards
 * for the same visible density, since the hero is never close enough to see all three landings at
 * full strength at once.
 */
export function createWaterfallFx(
  ctx: Hd2dContext,
  impacts: readonly THREE.Vector3[],
  fogTexture?: THREE.Texture,
): WaterfallFx {
  const group = new THREE.Group();

  // --- the churn at the foot of the fall ---------------------------------------------------------
  // The generated foam sheet (`/tex/water-fog.png`), played as a flip-book. The recycled puff pools
  // below give DRIFT — individual specks rising and fading — and cannot give mass: a dense
  // continuous cloud where the water strikes is one sprite, not thirty. Both run together.
  const fogs = fogTexture
    ? impacts.map((at) => {
        const billboard = makeBillboard(ctx, {
          texture: fogTexture,
          cols: WATER_FOG.frames,
          rows: 1,
          height: WATER_FOG.height,
          aspect: WATER_FOG.width / WATER_FOG.height,
          foot: 0.5,
          lit: false,
        });
        billboard.mesh.position.set(at.x, at.y + WATER_FOG.hauteur, at.z + WATER_FOG.avance);
        (billboard.mesh.material as THREE.MeshBasicMaterial).opacity = WATER_FOG.opacite;
        (billboard.mesh.material as THREE.MeshBasicMaterial).transparent = true;
        group.add(billboard.mesh);
        return createAnimator(
          billboard,
          { row: 0, frames: WATER_FOG.frames, fps: WATER_FOG.fps },
          WATER_FOG.frames,
        );
      })
    : [];

  const makePool = <T extends Puff>(
    count: number,
    texture: THREE.CanvasTexture,
    height: number,
    extra: (base: Puff) => T,
  ): T[] =>
    Array.from({ length: count }, () => {
      const billboard = makeBillboard(ctx, {
        texture,
        height,
        aspect: 1,
        foot: 0.5, // centre pivot: neither mist nor spray rests on anything
        // Unlit, like the hero's breath and the spring's steam: at the night mood the hemisphere
        // and the rim light are nearly black, and a LIT puff would vanish exactly when it matters.
        lit: false,
      });
      billboard.mesh.visible = false;
      group.add(billboard.mesh);
      return extra({
        billboard,
        material: billboard.mesh.material as THREE.MeshBasicMaterial,
        t: Number.POSITIVE_INFINITY,
      });
    });

  const mist = makePool(MIST.count, textureMist(), MIST.taille, (b) => b);
  const spray = makePool<Drop>(SPRAY.count, textureSpray(), SPRAY.taille, (b) => ({
    ...b,
    vx: 0,
    vy: 0,
    vz: 0,
  }));

  // --- the rainbow -------------------------------------------------------------------------------
  // A half annulus with the spectrum painted along its radial axis, drawn additively so it
  // lightens the mist rather than covering it. Anchored to the WIDEST drop (the middle one, which
  // throws the most mist), not to the island centre: a rainbow lives in spray, not in air.
  const widest = impacts[Math.min(1, Math.max(0, impacts.length - 1))] ?? new THREE.Vector3();
  const arcTexture = textureRainbow();
  const arcGeometry = arcBand(RAINBOW.rayon, RAINBOW.rayon + RAINBOW.epaisseur, 48);
  const arcMaterial = new THREE.MeshBasicMaterial({
    map: arcTexture,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const arc = new THREE.Mesh(arcGeometry, arcMaterial);
  // Standing upright in the world XY plane, so its normal points SOUTH — at the camera, not down
  // the valley. Facing east instead (rotating by π/2, the intuitive "face the way the water
  // flows") puts the arc's plane almost exactly edge-on to this camera: the rig sits 38° above the
  // horizon looking north, so the view vector is nearly perpendicular to +X, and the whole arc
  // collapses to a one-pixel vertical line. It did, at full opacity, and read as a rendering
  // failure rather than as a wrong angle.
  arc.position.set(widest.x, widest.y, widest.z + 0.6);
  group.add(arc);

  let mistNext = 0;
  let sprayNext = 0;
  let mistTimer = 0;
  let sprayTimer = 0;
  let impactNext = 0;
  let rainbowAmount = 0;

  // Deterministic angle sequence rather than `Math.random()`: this file is lab content and not
  // bound by `@lindocara/engine`'s purity rule, but a fixed sequence still makes a screenshot
  // reproducible, which is worth more here than randomness nobody can see. The golden angle keeps
  // successive puffs spread evenly instead of clumping.
  let phase = 0;
  const nextAngle = (): number => {
    phase = (phase + 2.399963) % (Math.PI * 2);
    return phase;
  };

  function emitMist(at: THREE.Vector3): void {
    const p = mist[mistNext];
    if (!p) return;
    mistNext = (mistNext + 1) % MIST.count;
    const a = nextAngle();
    const r = MIST.rayon * (0.3 + 0.7 * (phase / (Math.PI * 2)));
    p.t = 0;
    p.billboard.mesh.position.set(at.x + Math.cos(a) * r, at.y + 0.15, at.z + Math.sin(a) * r);
    p.billboard.mesh.scale.setScalar(1);
    p.material.opacity = MIST.opaciteInitiale;
    p.billboard.mesh.visible = true;
  }

  function emitSpray(at: THREE.Vector3): void {
    const p = spray[sprayNext];
    if (!p) return;
    sprayNext = (sprayNext + 1) % SPRAY.count;
    const a = nextAngle();
    p.t = 0;
    p.vx = Math.cos(a) * SPRAY.vitesse;
    p.vz = Math.sin(a) * SPRAY.vitesse;
    p.vy = SPRAY.montee;
    p.billboard.mesh.position.set(at.x, at.y + 0.05, at.z);
    p.material.opacity = SPRAY.opaciteInitiale;
    p.billboard.mesh.visible = true;
  }

  return {
    group,
    update(dt, active, daylight) {
      group.visible = active;
      if (!active) return;

      for (const fog of fogs) fog.update(dt);

      mistTimer -= dt;
      sprayTimer -= dt;
      // Round-robin across impact points rather than emitting at all three every tick: one shared
      // pool, so the emission budget is shared too.
      const at = impacts[impactNext % Math.max(1, impacts.length)];
      if (at) {
        if (mistTimer <= 0) {
          emitMist(at);
          mistTimer = MIST.emission;
          impactNext = (impactNext + 1) % Math.max(1, impacts.length);
        }
        if (sprayTimer <= 0) {
          emitSpray(at);
          sprayTimer = SPRAY.emission;
        }
      }

      for (const p of mist) {
        if (p.t === Number.POSITIVE_INFINITY) continue;
        p.t += dt;
        if (p.t >= MIST.vie) {
          p.t = Number.POSITIVE_INFINITY;
          p.billboard.mesh.visible = false;
          continue;
        }
        const k = p.t / MIST.vie;
        p.billboard.mesh.position.y += MIST.montee * dt;
        p.billboard.mesh.scale.setScalar(1 + MIST.expansion * k);
        p.material.opacity = MIST.opaciteInitiale * (1 - k);
      }

      for (const p of spray) {
        if (p.t === Number.POSITIVE_INFINITY) continue;
        p.t += dt;
        if (p.t >= SPRAY.vie) {
          p.t = Number.POSITIVE_INFINITY;
          p.billboard.mesh.visible = false;
          continue;
        }
        p.vy -= SPRAY.gravite * dt;
        p.billboard.mesh.position.x += p.vx * dt;
        p.billboard.mesh.position.y += p.vy * dt;
        p.billboard.mesh.position.z += p.vz * dt;
        p.material.opacity = SPRAY.opaciteInitiale * (1 - p.t / SPRAY.vie);
      }

      // The rainbow's own fade, independent of the zone's: entering at night must not pop an arc
      // into a dark sky the moment dawn arrives, and `MOOD_FADE` knows nothing about where the
      // hero is standing. Same two-gate shape as `applyAurora`, mirrored across day and night.
      rainbowAmount += (daylight - rainbowAmount) * (1 - Math.exp(-dt / RAINBOW.fade));
      arcMaterial.opacity = RAINBOW.opacite * rainbowAmount;
    },
  };
}
