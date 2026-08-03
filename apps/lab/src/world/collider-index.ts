// Collisions par rectangles alignés sur les axes, testées depuis un disque : le héros GARDE son
// empreinte ronde (Task 8, décision du plan qui réduit le risque) — le glissement le long d'un
// obstacle vient du test AXE PAR AXE dans `hero-step.ts`, pas de la forme de l'obstacle, donc
// changer un cercle en rectangle ne change que le coin qu'on longe, jamais la façon de le longer.
//
// La grille reste la `Map` creuse de l'ancien `colliders.ts` — adaptée à une carte large et
// clairsemée, contrairement aux seaux denses de `packages/engine/src/collider.ts` — mais un
// rectangle peut désormais s'étendre sur PLUSIEURS cellules (un mur long, le cas que le cercle ne
// savait pas modéliser) et doit donc être inséré dans toutes celles qu'il recouvre, pas seulement
// celle de son coin.

const CELL = 4;
// Marge du chemin RAPIDE de `blocked` (petit rayon de requête) : une seule case y est interrogée.
// Pour que ce chemin ne rate jamais un rectangle proche d'une frontière de case, l'insertion
// pad du même montant de chaque côté — un rectangle déborde donc un peu dans les cases voisines de
// son emprise réelle, exactement le raisonnement de l'ancien `colliders.ts` transposé au rectangle
// (là-bas, le pad incluait le rayon de l'objet ; ici l'emprise du rectangle EST déjà sa taille).
const QUERY_PAD = 0.6;

export interface ColliderRect {
  x: number;
  z: number;
  w: number;
  h: number;
}

export interface ColliderIndex {
  readonly all: readonly ColliderRect[];
  add(rect: ColliderRect): void;
  /** `true` si un disque de rayon `r` centré en `(x, z)` chevauche un rectangle. */
  blocked(x: number, z: number, r: number): boolean;
}

/** Distance au carré du centre du disque au point du rectangle le plus proche. */
function overlaps(rect: ColliderRect, x: number, z: number, r: number): boolean {
  const px = Math.min(Math.max(x, rect.x), rect.x + rect.w);
  const pz = Math.min(Math.max(z, rect.z), rect.z + rect.h);
  const dx = x - px;
  const dz = z - pz;
  return dx * dx + dz * dz < r * r;
}

export function createColliderIndex(): ColliderIndex {
  const grid = new Map<number, ColliderRect[]>();
  const all: ColliderRect[] = [];
  const key = (i: number, j: number) => i * 10007 + j;

  return {
    all,
    add(rect) {
      all.push(rect);
      const i0 = Math.floor((rect.x - QUERY_PAD) / CELL);
      const i1 = Math.floor((rect.x + rect.w + QUERY_PAD) / CELL);
      const j0 = Math.floor((rect.z - QUERY_PAD) / CELL);
      const j1 = Math.floor((rect.z + rect.h + QUERY_PAD) / CELL);
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const k = key(i, j);
          const bucket = grid.get(k);
          if (bucket) bucket.push(rect);
          else grid.set(k, [rect]);
        }
      }
    },
    blocked(x, z, r) {
      if (r <= QUERY_PAD) {
        const bucket = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
        if (!bucket) return false;
        return bucket.some((rect) => overlaps(rect, x, z, r));
      }
      // Revue finale (point C2, héritée de `colliders.ts`) : cette fonction promue en collision
      // AUTORITATIVE serveur en S2 recevra des rayons décidés par la DONNÉE d'entité, un rayon mal
      // réglé ne doit donc jamais abattre un tick de simulation. On élargit la fenêtre de cellules
      // interrogées à la taille réelle de la requête au lieu de lever : plus large que le chemin
      // rapide ci-dessus, jamais plus étroit, donc jamais moins de rectangles trouvés.
      const seen = new Set<ColliderRect>();
      for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++) {
        for (let j = Math.floor((z - r) / CELL); j <= Math.floor((z + r) / CELL); j++) {
          const bucket = grid.get(key(i, j));
          if (!bucket) continue;
          for (const rect of bucket) seen.add(rect);
        }
      }
      for (const rect of seen) if (overlaps(rect, x, z, r)) return true;
      return false;
    },
  };
}
