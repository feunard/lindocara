import type { GroundVector } from "@lindocara/engine/ground.js";

/**
 * Anything the room can index: an id and a position **on the ground plane**.
 *
 * It used to be `extends Vec2`, and that was this increment's central bug wearing a green suite.
 * Every three-axis runtime — `PlayerRuntime`, `MonsterRuntime`, `GroundLoot` — still satisfied
 * `Vec2` structurally once it grew a `z`, so the grid went on bucketing each entity by its ground
 * `x` against its **elevation** `y`: every body sat in the `y = 0` row, every query compared a
 * ground distance against an elevation one, and neither the compiler nor a single test noticed.
 * `GroundVector` is the fix and the fence: `{x, z}` and `{x, y}` are the one field name apart that
 * makes a half-converted call site fail to compile.
 */
export interface SpatialEntity extends GroundVector {
  id: string;
}

/**
 * A non-authoritative spatial index. Callers retain ownership of entity state; the grid only
 * stores references and cell membership so nearby queries do not scan an entire room.
 *
 * `cellSize` is in tile units, like everything it indexes.
 */
export class SpatialGrid<T extends SpatialEntity> {
  readonly cellSize: number;
  #cells = new Map<string, Map<string, T>>();
  #cellById = new Map<string, string>();

  constructor(cellSize: number) {
    if (!Number.isFinite(cellSize) || cellSize <= 0) {
      throw new Error("SpatialGrid cellSize must be a positive finite number");
    }
    this.cellSize = cellSize;
  }

  insert(entity: T): void {
    this.remove(entity.id);
    const key = this.#key(entity);
    let cell = this.#cells.get(key);
    if (!cell) {
      cell = new Map();
      this.#cells.set(key, cell);
    }
    cell.set(entity.id, entity);
    this.#cellById.set(entity.id, key);
  }

  update(entity: T, _previousPosition: GroundVector): void {
    const previousKey = this.#cellById.get(entity.id);
    const nextKey = this.#key(entity);
    if (previousKey === nextKey) return;
    this.remove(entity.id);
    this.insert(entity);
  }

  remove(entityId: string): void {
    const key = this.#cellById.get(entityId);
    if (!key) return;
    const cell = this.#cells.get(key);
    cell?.delete(entityId);
    if (cell?.size === 0) this.#cells.delete(key);
    this.#cellById.delete(entityId);
  }

  clear(): void {
    this.#cells.clear();
    this.#cellById.clear();
  }

  queryRadius(position: GroundVector, radius: number): T[] {
    if (!Number.isFinite(radius) || radius < 0) return [];
    const minX = Math.floor((position.x - radius) / this.cellSize);
    const maxX = Math.floor((position.x + radius) / this.cellSize);
    const minZ = Math.floor((position.z - radius) / this.cellSize);
    const maxZ = Math.floor((position.z + radius) / this.cellSize);
    const radiusSquared = radius * radius;
    const result: T[] = [];
    for (let cellZ = minZ; cellZ <= maxZ; cellZ++) {
      for (let cellX = minX; cellX <= maxX; cellX++) {
        const cell = this.#cells.get(`${cellX}:${cellZ}`);
        if (!cell) continue;
        for (const entity of cell.values()) {
          const dx = entity.x - position.x;
          const dz = entity.z - position.z;
          if (dx * dx + dz * dz <= radiusSquared) result.push(entity);
        }
      }
    }
    return result;
  }

  #key(position: GroundVector): string {
    return `${Math.floor(position.x / this.cellSize)}:${Math.floor(position.z / this.cellSize)}`;
  }
}

/** Keeps known entities through the wider exit radius while new entities use the enter radius. */
export function queryWithHysteresis<T extends SpatialEntity>(
  grid: SpatialGrid<T>,
  position: GroundVector,
  enterRadius: number,
  hysteresis: number,
  previouslyVisible: ReadonlySet<string>,
): { entities: T[]; visibleIds: Set<string> } {
  const exitRadius = enterRadius + hysteresis;
  const exitRadiusSquared = exitRadius * exitRadius;
  const enterRadiusSquared = enterRadius * enterRadius;
  const entities = grid.queryRadius(position, exitRadius).filter((entity) => {
    const dx = entity.x - position.x;
    const dz = entity.z - position.z;
    const distanceSquared = dx * dx + dz * dz;
    return previouslyVisible.has(entity.id)
      ? distanceSquared <= exitRadiusSquared
      : distanceSquared <= enterRadiusSquared;
  });
  return { entities, visibleIds: new Set(entities.map((entity) => entity.id)) };
}
