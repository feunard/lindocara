// Collisions en cercles dans le plan XZ : les props sont debout et immobiles, une empreinte
// circulaire suffit et le glissement le long des obstacles vient gratuitement en testant chaque
// axe séparément (voir `hero.ts`).

const CELL = 4;
// Les colliders sont insérés dans les cases qu'ils touchent, élargis de cette marge : une seule
// case est alors interrogée à la lecture, sans rien rater.
const QUERY_PAD = 0.6;

export interface Collider {
  x: number;
  z: number;
  r: number;
}

export interface Colliders {
  readonly all: readonly Collider[];
  add(x: number, z: number, r: number): void;
  /** `true` si un disque de rayon `r` centré en `(x, z)` chevauche un collider. */
  blocked(x: number, z: number, r: number): boolean;
}

export function createColliders(): Colliders {
  const grid = new Map<number, Collider[]>();
  const all: Collider[] = [];
  const key = (i: number, j: number) => i * 10007 + j;

  return {
    all,
    add(x, z, r) {
      const c: Collider = { x, z, r };
      all.push(c);
      const pad = r + QUERY_PAD;
      for (let i = Math.floor((x - pad) / CELL); i <= Math.floor((x + pad) / CELL); i++) {
        for (let j = Math.floor((z - pad) / CELL); j <= Math.floor((z + pad) / CELL); j++) {
          const k = key(i, j);
          const bucket = grid.get(k);
          if (bucket) bucket.push(c);
          else grid.set(k, [c]);
        }
      }
    },
    blocked(x, z, r) {
      if (r > QUERY_PAD) throw new Error(`Rayon de requête trop grand : ${r} > ${QUERY_PAD}`);
      const bucket = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
      if (!bucket) return false;
      for (const c of bucket) {
        const sum = c.r + r;
        const dx = c.x - x;
        const dz = c.z - z;
        if (dx * dx + dz * dz < sum * sum) return true;
      }
      return false;
    },
  };
}
