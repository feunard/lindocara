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
  /** Walkable flat top surface. Kept as the backward-compatible form for props and old maps. */
  top?: number;
  /** Round towers and mills collide as their visible footprint instead of an invisible square. */
  footprint?: "ellipse";
  /** A non-flat walkable roof, sampled at the hero's local X/Z position. */
  surface?: ColliderRoofSurface;
  /** Buildings support a landing only once the body's centre is over the roof, never from a wall graze. */
  support?: "center";
}

export type ColliderRoofSurface =
  | {
      shape: "gable";
      eave: number;
      peak: number;
      /** The cross-roof axis. The ridge follows the other world axis. */
      axis: "x" | "z";
    }
  | { shape: "cone"; eave: number; peak: number };

export interface ColliderIndex {
  readonly all: readonly ColliderRect[];
  add(rect: ColliderRect): void;
  /** `true` if a disc of radius `r` centered at `(x, z)` overlaps a rectangle. */
  blocked(x: number, z: number, r: number, y?: number): boolean;
  /**
   * Whether an already-overlapping disc may move to another overlapping point. Every obstacle at
   * the destination must already block the origin, and the move may not deepen either overlap.
   */
  allowsEscape(fromX: number, fromZ: number, x: number, z: number, r: number, y?: number): boolean;
  /**
   * Height a disc must clear at this point, `Infinity` for a wall, or `null` when nothing overlaps.
   * The movement rule uses it only for a rising jump over a one-level finite prop.
   */
  heightToClear(x: number, z: number, r: number): number | null;
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

/** Whether a point is on the collider footprint, optionally inset by a body's radius. */
export function colliderContainsPoint(
  rect: ColliderRect,
  x: number,
  z: number,
  inset = 0,
): boolean {
  if (rect.footprint === "ellipse") {
    const rx = rect.w / 2 - inset;
    const rz = rect.h / 2 - inset;
    if (rx <= 0 || rz <= 0) return false;
    const dx = x - (rect.x + rect.w / 2);
    const dz = z - (rect.z + rect.h / 2);
    return (dx * dx) / (rx * rx) + (dz * dz) / (rz * rz) <= 1 + 1e-9;
  }
  return (
    x >= rect.x + inset &&
    x <= rect.x + rect.w - inset &&
    z >= rect.z + inset &&
    z <= rect.z + rect.h - inset
  );
}

/** Disc/footprint overlap. Ellipses use a conservative radius expansion for the broad body. */
export function colliderOverlapsDisc(rect: ColliderRect, x: number, z: number, r: number): boolean {
  if (rect.footprint === "ellipse") {
    const rx = rect.w / 2 + r;
    const rz = rect.h / 2 + r;
    const dx = x - (rect.x + rect.w / 2);
    const dz = z - (rect.z + rect.h / 2);
    return (dx * dx) / (rx * rx) + (dz * dz) / (rz * rz) < 1;
  }
  const px = Math.min(Math.max(x, rect.x), rect.x + rect.w);
  const pz = Math.min(Math.max(z, rect.z), rect.z + rect.h);
  const dx = x - px;
  const dz = z - pz;
  return dx * dx + dz * dz < r * r;
}

/** Exact walkable surface under a point, or `null` outside it / for an infinite wall. */
export function colliderSurfaceHeightAt(rect: ColliderRect, x: number, z: number): number | null {
  if (!colliderContainsPoint(rect, x, z)) return null;
  const surface = rect.surface;
  if (!surface) return rect.top ?? null;
  if (surface.shape === "gable") {
    const start = surface.axis === "x" ? rect.x : rect.z;
    const span = surface.axis === "x" ? rect.w : rect.h;
    const coordinate = surface.axis === "x" ? x : z;
    const normalized = Math.min(1, Math.max(0, (coordinate - start) / span));
    const rise = 1 - Math.abs(normalized * 2 - 1);
    return surface.eave + (surface.peak - surface.eave) * rise;
  }
  const rx = rect.w / 2;
  const rz = rect.h / 2;
  const dx = (x - (rect.x + rx)) / rx;
  const dz = (z - (rect.z + rz)) / rz;
  const radial = Math.min(1, Math.hypot(dx, dz));
  return surface.eave + (surface.peak - surface.eave) * (1 - radial);
}

/** Surface at the footprint point nearest a disc centre, including just outside an edge. */
export function colliderSurfaceHeightNear(rect: ColliderRect, x: number, z: number): number | null {
  if (colliderContainsPoint(rect, x, z)) return colliderSurfaceHeightAt(rect, x, z);
  if (rect.footprint === "ellipse") {
    const rx = rect.w / 2;
    const rz = rect.h / 2;
    const cx = rect.x + rx;
    const cz = rect.z + rz;
    const dx = x - cx;
    const dz = z - cz;
    const norm = Math.sqrt((dx * dx) / (rx * rx) + (dz * dz) / (rz * rz));
    if (!Number.isFinite(norm) || norm <= 0) return colliderSurfaceHeightAt(rect, cx, cz);
    return colliderSurfaceHeightAt(rect, cx + dx / norm, cz + dz / norm);
  }
  return colliderSurfaceHeightAt(
    rect,
    Math.min(Math.max(x, rect.x), rect.x + rect.w),
    Math.min(Math.max(z, rect.z), rect.z + rect.h),
  );
}

function blocksAt(rect: ColliderRect, x: number, z: number, y: number | undefined): boolean {
  if (y === undefined) return true;
  const surface = colliderSurfaceHeightNear(rect, x, z);
  return surface === null || y < surface - 1e-3;
}

/** A monotone overlap score: zero outside, increasing as a disc penetrates farther into a shape. */
function overlapDepth(rect: ColliderRect, x: number, z: number, r: number): number {
  if (!colliderOverlapsDisc(rect, x, z, r)) return 0;
  if (rect.footprint === "ellipse") {
    const rx = rect.w / 2 + r;
    const rz = rect.h / 2 + r;
    const dx = x - (rect.x + rect.w / 2);
    const dz = z - (rect.z + rect.h / 2);
    return 1 - Math.hypot(dx / rx, dz / rz);
  }
  const dx = Math.max(rect.x - x, 0, x - (rect.x + rect.w));
  const dz = Math.max(rect.z - z, 0, z - (rect.z + rect.h));
  if (dx > 0 || dz > 0) return r - Math.hypot(dx, dz);
  const inside = Math.min(x - rect.x, rect.x + rect.w - x, z - rect.z, rect.z + rect.h - z);
  return r + Math.max(0, inside);
}

export function createColliderIndex(): ColliderIndex {
  const grid = new Map<number, ColliderRect[]>();
  const all: ColliderRect[] = [];
  const key = (i: number, j: number) => i * 10007 + j;
  const candidates = (x: number, z: number, r: number): readonly ColliderRect[] => {
    if (r <= QUERY_PAD) {
      return grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) ?? [];
    }
    const seen = new Set<ColliderRect>();
    for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++) {
      for (let j = Math.floor((z - r) / CELL); j <= Math.floor((z + r) / CELL); j++) {
        const bucket = grid.get(key(i, j));
        if (!bucket) continue;
        for (const rect of bucket) seen.add(rect);
      }
    }
    return [...seen];
  };

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
    blocked(x, z, r, y) {
      return candidates(x, z, r).some(
        (rect) => colliderOverlapsDisc(rect, x, z, r) && blocksAt(rect, x, z, y),
      );
    },
    allowsEscape(fromX, fromZ, x, z, r, y) {
      const destinationBlockers = candidates(x, z, r).filter(
        (rect) => colliderOverlapsDisc(rect, x, z, r) && blocksAt(rect, x, z, y),
      );
      return destinationBlockers.every((rect) => {
        if (!blocksAt(rect, fromX, fromZ, y)) return false;
        const before = overlapDepth(rect, fromX, fromZ, r);
        return before > 0 && overlapDepth(rect, x, z, r) <= before + 1e-9;
      });
    },
    heightToClear(x, z, r) {
      let height: number | null = null;
      for (const rect of candidates(x, z, r)) {
        if (!colliderOverlapsDisc(rect, x, z, r)) continue;
        const surface = colliderSurfaceHeightNear(rect, x, z);
        if (surface === null) return Number.POSITIVE_INFINITY;
        height = height === null ? surface : Math.max(height, surface);
      }
      return height;
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
