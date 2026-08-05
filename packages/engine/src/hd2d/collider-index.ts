// Axis-aligned-rectangle collision, tested from a disc: the hero KEEPS its round footprint
// (Task 8, a risk-reducing plan decision) — sliding along an obstacle comes from the
// AXIS-BY-AXIS test in `hero-step.ts`, not from the obstacle's shape, so turning a circle into a
// rectangle only changes the corner you slide along, never how you slide along it.
//
// The grid stays the sparse `Map` from the old `colliders.ts` — suited to a wide, sparsely
// populated map, unlike the dense buckets of `packages/engine/src/collider.ts` — but a rectangle
// can now span SEVERAL cells (a long wall, the case the circle could not model), and so must be
// inserted into every cell it covers, not just the one at its corner.

const CELL = 4;
// Margin of the FAST path in `blocked` (small query radius): only a single cell is queried there.
// For that path to never miss a rectangle near a cell boundary, insertion pads the same amount on
// every side — a rectangle therefore spills a little into the cells neighboring its actual
// footprint, exactly the reasoning of the old `colliders.ts` carried over to the rectangle (there,
// the pad included the object's radius; here the rectangle's footprint IS already its size).
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
  /** `true` if a disc of radius `r` centered at `(x, z)` overlaps a rectangle. */
  blocked(x: number, z: number, r: number): boolean;
  /**
   * Broad phase for a SWEPT query: every distinct rectangle whose bucket the axis-aligned box
   * touches. It over-reports (a bucket is coarser than a rectangle) and never under-reports, so
   * the caller still tests each candidate exactly — which is the whole contract, because a swept
   * projectile that only samples points along its path is a projectile that tunnels.
   *
   * `blocked` cannot serve here: it answers about one disc at one instant, and a tick's travel is
   * a segment, not a point.
   */
  inBox(minX: number, minZ: number, maxX: number, maxZ: number): readonly ColliderRect[];
}

/** Squared distance from the disc's center to the closest point of the rectangle. */
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
      // Final review (point C2, inherited from `colliders.ts`): this function, promoted to
      // AUTHORITATIVE server-side collision in S2, will receive radii decided by ENTITY DATA, so a
      // badly tuned radius must never take down a simulation tick. We widen the queried cell
      // window to the actual query size instead of throwing: wider than the fast path above,
      // never narrower, so never fewer rectangles found.
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
    inBox(minX, minZ, maxX, maxZ) {
      const seen = new Set<ColliderRect>();
      for (let i = Math.floor(minX / CELL); i <= Math.floor(maxX / CELL); i++) {
        for (let j = Math.floor(minZ / CELL); j <= Math.floor(maxZ / CELL); j++) {
          const bucket = grid.get(key(i, j));
          if (!bucket) continue;
          for (const rect of bucket) seen.add(rect);
        }
      }
      return [...seen];
    },
  };
}
