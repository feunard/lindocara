import * as THREE from "three";
import type { Hd2dContext } from "./context.js";
import type { ResolvedMood } from "./mood.js";

/**
 * Trois nuées de points additifs : les braises au-dessus du foyer, les lucioles de la nuit, le
 * pollen du jour. Rien de tout ça n'éclaire quoi que ce soit — c'est de l'échelle et du mouvement
 * dans le vide entre les sprites, et c'est surtout la nuit que ça manquait : hors du halo du feu,
 * la scène était morte.
 *
 * Les positions sont calculées en JS : quelques centaines de points, ça ne vaut pas un shader, et
 * on garde le droit de faire tourner chaque particule autour d'un point précis (le foyer) sans le
 * passer en uniforme.
 */

// Cache de MODULE, pas de contexte : une image immuable, sans état de scène, identique pour toute
// la page (même raisonnement que `discTexture`/`glowCache` dans `billboard.ts`). La dupliquer par
// contexte gâcherait de la mémoire GPU pour rien, et surtout aucun `dispose()` de champ de
// particules ne doit la libérer : elle est partagée par toutes les nuées, présentes et futures.
let pointSprite: THREE.CanvasTexture | undefined;

/**
 * Un point doux : sans lui, `PointsMaterial` dessine des carrés. Paresseuse — construite au
 * premier appel EN NAVIGATEUR seulement : `document.createElement("canvas")` casserait le projet
 * vitest `hd2d`, qui tourne en `node`. Sans DOM, `PointsMaterial.map` reste `null` ; les tests
 * n'y regardent jamais, ils ne font que construire des `THREE.Points` et lire leurs positions.
 */
function pointTexture(): THREE.CanvasTexture | undefined {
  if (pointSprite) return pointSprite;
  if (typeof document === "undefined") return undefined;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const cx = canvas.getContext("2d");
  if (!cx) throw new Error("Contexte 2D indisponible");
  const g = cx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  cx.fillStyle = g;
  cx.fillRect(0, 0, size, size);
  pointSprite = new THREE.CanvasTexture(canvas);
  return pointSprite;
}

/** Une particule vivante d'une nuée : sa position, sa vitesse, sa phase et le temps qu'il lui
 *  reste à vivre. */
interface Grain {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  seed: number;
}

interface Swarm {
  points: THREE.Points;
  material: THREE.PointsMaterial;
  update(dt: number): void;
}

/**
 * Nuée générique. `respawn(p)` replace une particule morte, `move(p, dt)` la fait vivre ;
 * l'intensité de sa couleur porte sa transparence, l'additif se chargeant de faire disparaître ce
 * qui tend vers le noir.
 */
function swarm(
  count: number,
  size: number,
  color: THREE.ColorRepresentation,
  respawn: (p: Grain) => void,
  move: (p: Grain, dt: number) => void,
  blending: THREE.Blending = THREE.AdditiveBlending,
): Swarm {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const positionAttr = new THREE.BufferAttribute(pos, 3);
  const colorAttr = new THREE.BufferAttribute(col, 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", positionAttr);
  geo.setAttribute("color", colorAttr);

  const material = new THREE.PointsMaterial({
    size,
    map: pointTexture() ?? null,
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;

  const base = new THREE.Color(color);
  const grains: Grain[] = [];
  for (let i = 0; i < count; i++) {
    const p: Grain = {
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      life: 0,
      max: 1,
      seed: Math.random(),
    };
    respawn(p);
    p.life = Math.random() * p.max; // phases décalées : pas de bouffée initiale
    grains.push(p);
  }

  return {
    points,
    material,
    update(dt) {
      if (material.opacity < 0.002) return; // éteinte : inutile de la faire vivre
      grains.forEach((p, i) => {
        p.life -= dt;
        if (p.life <= 0) respawn(p);
        move(p, dt);
        pos[i * 3] = p.x;
        pos[i * 3 + 1] = p.y;
        pos[i * 3 + 2] = p.z;
        // Fondu en cloche : ni apparition ni disparition sèche.
        const t = p.life / p.max;
        const a = Math.min(1, Math.sin(Math.PI * Math.min(1, Math.max(0, t))) * 1.6);
        col[i * 3] = base.r * a;
        col[i * 3 + 1] = base.g * a;
        col[i * 3 + 2] = base.b * a;
      });
      positionAttr.needsUpdate = true;
      colorAttr.needsUpdate = true;
    },
  };
}

/** Libère la géométrie et le matériau d'une nuée — jamais la texture de point, partagée. */
function disposeSwarm(s: Swarm): void {
  s.points.geometry.dispose();
  s.material.dispose();
}

export interface ParticleField {
  group: THREE.Group;
  /** L'ambiance décide qui vit : lucioles la nuit, pollen le jour. */
  apply(mood: ResolvedMood): void;
  update(dt: number): void;
  dispose(): void;
}

export interface ParticleFieldOptions {
  firePosition: THREE.Vector3;
  worldRadius: number;
}

// `_ctx` n'est lu par aucun calcul ici : aucune des trois nuées ne suit le yaw ni ne greffe
// l'ombre des nuages (des points additifs, pas des sprites éclairés), et aucune ne dépend d'un
// réglage de `Hd2dConfig`. Le paramètre reste dans la signature parce que toutes les fabriques de
// scène du package prennent le `Hd2dContext` du jeu/éditeur qui les appelle — un appelant n'a pas
// à se demander au cas par cas laquelle en a réellement besoin.
export function createParticleField(_ctx: Hd2dContext, opts: ParticleFieldOptions): ParticleField {
  const { firePosition, worldRadius } = opts;
  const group = new THREE.Group();

  // --- braises : elles montent du foyer, dérivent et s'éteignent -------------
  const embers = swarm(
    46,
    0.13,
    "#ffb457",
    (p) => {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.28;
      p.x = firePosition.x + Math.cos(a) * r;
      p.y = firePosition.y + 0.25;
      p.z = firePosition.z + Math.sin(a) * r;
      p.vx = (Math.random() - 0.5) * 0.35;
      p.vy = 0.8 + Math.random() * 1.1;
      p.vz = (Math.random() - 0.5) * 0.35;
      p.max = 1.5 + Math.random() * 1.4;
      p.life = p.max;
    },
    (p, dt) => {
      // Elles ralentissent en montant et partent en vrille : une braise qui s'élève tout droit à
      // vitesse constante se lit comme une étincelle de jeu.
      p.vy -= dt * 0.28;
      p.x += (p.vx + Math.sin(p.life * 3.1 + p.seed * 9) * 0.22) * dt;
      p.y += p.vy * dt;
      p.z += (p.vz + Math.cos(p.life * 2.7 + p.seed * 7) * 0.22) * dt;
    },
  );

  // --- lucioles : elles flânent au-dessus de l'herbe, la nuit ---------------
  const fireflies = swarm(
    70,
    0.16,
    "#c8ff8a",
    (p) => {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * worldRadius;
      p.x = Math.cos(a) * r;
      p.z = Math.sin(a) * r;
      p.y = 0.4 + Math.random() * 1.6;
      p.max = 5 + Math.random() * 6;
      p.life = p.max;
    },
    (p, dt) => {
      const t = p.life * 0.9 + p.seed * 30;
      p.x += Math.sin(t) * 0.35 * dt;
      p.z += Math.cos(t * 0.77) * 0.35 * dt;
      p.y += Math.sin(t * 1.9) * 0.22 * dt;
    },
  );

  // --- pollen : en plein jour, une poussière lente prise dans la lumière ----
  const motes = swarm(
    120,
    0.09,
    "#fff0c8",
    (p) => {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * worldRadius;
      p.x = Math.cos(a) * r;
      p.z = Math.sin(a) * r;
      p.y = 0.3 + Math.random() * 3.4;
      p.max = 7 + Math.random() * 7;
      p.life = p.max;
    },
    (p, dt) => {
      p.x += (0.18 + Math.sin(p.life * 0.6 + p.seed * 12) * 0.16) * dt;
      p.y += Math.sin(p.life * 0.9 + p.seed * 5) * 0.1 * dt;
      p.z += Math.cos(p.life * 0.5 + p.seed * 3) * 0.14 * dt;
    },
  );

  for (const s of [embers, fireflies, motes]) group.add(s.points);

  // Sous ce seuil, une nuée est aussi bien invisible : `Points.visible` le porte explicitement
  // (pas seulement l'opacité, à zéro les points restent quand même rendus) pour que jour et nuit
  // montrent VRAIMENT des nuages de points différents, et que le renderer ait le droit de sauter
  // une nuée éteinte plutôt que de rasteriser des points d'opacité nulle.
  const eteinte = (opacity: number) => opacity < 0.002;

  return {
    group,
    apply(mood) {
      fireflies.material.opacity = mood.fireflies;
      fireflies.points.visible = !eteinte(mood.fireflies);
      motes.material.opacity = mood.motes;
      motes.points.visible = !eteinte(mood.motes);
      // Les braises suivent l'intensité du foyer : à peine visibles de jour.
      const fireOpacity = THREE.MathUtils.clamp(mood.fire / 4.4, 0.22, 1);
      embers.material.opacity = fireOpacity;
      embers.points.visible = !eteinte(fireOpacity);
    },
    update(dt) {
      embers.update(dt);
      fireflies.update(dt);
      motes.update(dt);
    },
    dispose() {
      for (const s of [embers, fireflies, motes]) disposeSwarm(s);
      group.clear();
    },
  };
}

/**
 * Pétales de cerisier. En fusion NORMALE et non additive : un pétale rose en additif vire au blanc
 * et se met à luire comme une braise. Ils tombent en vrille — une dérive latérale sinusoïdale,
 * chacune à sa propre phase — au lieu de descendre en ligne droite comme de la neige.
 */
export interface PetalFall {
  group: THREE.Group;
  update(dt: number): void;
  dispose(): void;
}

export interface PetalFallOptions {
  centre: THREE.Vector3;
  radius: number;
  height: number;
}

// `_ctx` n'est lu par aucun calcul ici, même raison que `createParticleField` ci-dessus.
export function createPetalFall(_ctx: Hd2dContext, opts: PetalFallOptions): PetalFall {
  const { centre, radius, height } = opts;
  const group = new THREE.Group();
  const sol = centre.y;

  const nuee = swarm(
    170,
    0.3, // à 0.13 ils ne faisaient que quelques pixels et passaient inaperçus
    0xff8fbe,
    (p) => {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * radius; // racine : répartition uniforme sur le disque
      p.x = centre.x + Math.cos(a) * d;
      p.z = centre.z + Math.sin(a) * d;
      p.y = sol + height * (0.55 + Math.random() * 0.45);
      p.vy = -(0.28 + Math.random() * 0.22);
      p.vx = (Math.random() - 0.5) * 0.18;
      p.vz = (Math.random() - 0.5) * 0.18;
      p.seed = Math.random() * Math.PI * 2;
      p.max = (p.y - sol) / -p.vy; // il vit exactement le temps de sa chute
      p.life = p.max;
    },
    (p, dt) => {
      p.y += p.vy * dt;
      // La vrille : l'amplitude latérale suit la phase propre du pétale.
      const t = p.seed + p.life * 2.4;
      p.x += (p.vx + Math.cos(t) * 0.22) * dt;
      p.z += (p.vz + Math.sin(t * 0.8) * 0.22) * dt;
    },
    THREE.NormalBlending,
  );
  nuee.material.opacity = 1;
  group.add(nuee.points);

  return {
    group,
    update(dt) {
      nuee.update(dt);
    },
    dispose() {
      disposeSwarm(nuee);
      group.clear();
    },
  };
}
