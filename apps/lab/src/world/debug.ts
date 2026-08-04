import type { ColliderIndex } from "@lindocara/engine/hd2d/collider-index.js";
import type { TerrainQuery } from "@lindocara/engine/hd2d/terrain-query.js";
import type { HeightField } from "@lindocara/hd2d/terrain/field.js";
import * as THREE from "three";
import { HERO, WORLD } from "../settings.js";
import type { Hero } from "./hero.js";

// Vue de contrôle des collisions : on ne montre QUE les volumes réellement
// testés, pas les sprites. Quand un déplacement paraît anormal, c'est ici qu'on
// voit pourquoi — une case plus haute qu'on croyait, un collider de travers.

const COL = {
  sol: 0x2fe08a, // arêtes des cases praticables
  paroi: 0xff5d5d, // arêtes qu'on ne peut pas franchir à pied
  prop: 0xffc14d, // empreintes des props
  hero: 0x4db8ff, // empreinte du héros
};

function circle(radius: number, segments = 28): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
  }
  return new THREE.BufferGeometry().setFromPoints(pts);
}

/** Contour d'un rectangle (Task 8 : les colliders de props sont désormais des rectangles, pas des
 *  cercles), centré sur l'origine locale — la position du mesh porte le coin `(rect.x, rect.z)`. */
function rectangle(w: number, h: number): THREE.BufferGeometry {
  const pts = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(w, 0, 0),
    new THREE.Vector3(w, 0, h),
    new THREE.Vector3(0, 0, h),
    new THREE.Vector3(0, 0, 0),
  ];
  return new THREE.BufferGeometry().setFromPoints(pts);
}

export interface DebugView {
  group: THREE.Group;
  readonly enabled: boolean;
  toggle(): boolean;
  update(hero: Hero): void;
}

export function createDebugView(
  field: HeightField,
  query: TerrainQuery,
  colliders: ColliderIndex,
): DebugView {
  const group = new THREE.Group();
  group.visible = false;

  const size = WORLD.size;
  const levelHeight = WORLD.levelHeight;
  const c = size / 2;
  const sol: number[] = [];
  const paroi: number[] = [];
  const maxStep = WORLD.maxStep * levelHeight + 1e-3;

  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const h = field.levelAt(i, j);
      if (h === null) continue;
      const y = h * levelHeight + 0.03;
      const [x0, z0] = [i - c, j - c];
      const [x1, z1] = [x0 + 1, z0 + 1];

      // Contour du dessus de la case.
      for (const [a, b] of [
        [
          [x0, z0],
          [x1, z0],
        ],
        [
          [x1, z0],
          [x1, z1],
        ],
        [
          [x1, z1],
          [x0, z1],
        ],
        [
          [x0, z1],
          [x0, z0],
        ],
      ] as const)
        sol.push(a[0], y, a[1], b[0], y, b[1]);

      // Arêtes infranchissables : voisin absent, ou trop haut pour un pas.
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const n = field.levelAt(i + di, j + dj);
        if (n !== null && n * levelHeight - h * levelHeight <= maxStep) continue;
        const [a, b] =
          di === 1
            ? [
                [x1, z0],
                [x1, z1],
              ]
            : di === -1
              ? [
                  [x0, z0],
                  [x0, z1],
                ]
              : dj === 1
                ? [
                    [x0, z1],
                    [x1, z1],
                  ]
                : [
                    [x0, z0],
                    [x1, z0],
                  ];
        const av = a as [number, number];
        const bv = b as [number, number];
        paroi.push(av[0], y, av[1], bv[0], y, bv[1]);
        // Un montant vertical à chaque bout, pour lire la hauteur de la marche.
        const ny = n === null ? y - levelHeight : n * levelHeight + 0.03;
        paroi.push(av[0], y, av[1], av[0], ny, av[1]);
        paroi.push(bv[0], y, bv[1], bv[0], ny, bv[1]);
      }
    }
  }

  const lines = (verts: number[], color: number) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    return new THREE.LineSegments(
      g,
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.75, depthTest: false }),
    );
  };
  group.add(lines(sol, COL.sol));
  group.add(lines(paroi, COL.paroi));

  // Empreintes des props : au rectangle exact utilisé par le test de collision (Task 8 — le héros
  // seul reste rond, cf. le ring ci-dessous).
  const propMat = new THREE.LineBasicMaterial({ color: COL.prop, depthTest: false });
  for (const rect of colliders.all) {
    const cx = rect.x + rect.w / 2;
    const cz = rect.z + rect.h / 2;
    const outline = new THREE.Line(rectangle(rect.w, rect.h), propMat);
    outline.position.set(rect.x, (query.heightAt(cx, cz) ?? 0) + 0.05, rect.z);
    group.add(outline);
  }

  // Empreinte du héros : la même face au relief et face aux props.
  const heroRing = new THREE.Line(
    circle(HERO.radius),
    new THREE.LineBasicMaterial({ color: COL.hero, depthTest: false }),
  );
  group.add(heroRing);

  return {
    group,
    get enabled() {
      return group.visible;
    },
    toggle() {
      group.visible = !group.visible;
      return group.visible;
    },
    update(hero) {
      if (!group.visible) return;
      heroRing.position.set(hero.position.x, hero.position.y + 0.06, hero.position.z - HERO.offset);
    },
  };
}
