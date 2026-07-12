import type { Vec2 } from "../shared/simulation.js";

export interface SpatialEntity extends Vec2 {
  id: string;
}

/**
 * A non-authoritative spatial index. Callers retain ownership of entity state; the grid only
 * stores references and cell membership so nearby queries do not scan an entire room.
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

  update(entity: T, _previousPosition: Vec2): void {
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

  queryRadius(position: Vec2, radius: number): T[] {
    if (!Number.isFinite(radius) || radius < 0) return [];
    const minX = Math.floor((position.x - radius) / this.cellSize);
    const maxX = Math.floor((position.x + radius) / this.cellSize);
    const minY = Math.floor((position.y - radius) / this.cellSize);
    const maxY = Math.floor((position.y + radius) / this.cellSize);
    const radiusSquared = radius * radius;
    const result: T[] = [];
    for (let cellY = minY; cellY <= maxY; cellY++) {
      for (let cellX = minX; cellX <= maxX; cellX++) {
        const cell = this.#cells.get(`${cellX}:${cellY}`);
        if (!cell) continue;
        for (const entity of cell.values()) {
          const dx = entity.x - position.x;
          const dy = entity.y - position.y;
          if (dx * dx + dy * dy <= radiusSquared) result.push(entity);
        }
      }
    }
    return result;
  }

  #key(position: Vec2): string {
    return `${Math.floor(position.x / this.cellSize)}:${Math.floor(position.y / this.cellSize)}`;
  }
}

/** Keeps known entities through the wider exit radius while new entities use the enter radius. */
export function queryWithHysteresis<T extends SpatialEntity>(
  grid: SpatialGrid<T>,
  position: Vec2,
  enterRadius: number,
  hysteresis: number,
  previouslyVisible: ReadonlySet<string>,
): { entities: T[]; visibleIds: Set<string> } {
  const exitRadius = enterRadius + hysteresis;
  const exitRadiusSquared = exitRadius * exitRadius;
  const enterRadiusSquared = enterRadius * enterRadius;
  const entities = grid.queryRadius(position, exitRadius).filter((entity) => {
    const dx = entity.x - position.x;
    const dy = entity.y - position.y;
    const distanceSquared = dx * dx + dy * dy;
    return previouslyVisible.has(entity.id)
      ? distanceSquared <= exitRadiusSquared
      : distanceSquared <= enterRadiusSquared;
  });
  return { entities, visibleIds: new Set(entities.map((entity) => entity.id)) };
}
