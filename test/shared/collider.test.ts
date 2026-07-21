import {
  colliderIndexFrom,
  emptyColliderIndex,
  flattenColliderIndex,
  overlapsCollider,
} from "@lindocara/engine/collider.js";
import type { Rect } from "@lindocara/engine/game.js";
import type { Vec2 } from "@lindocara/engine/simulation.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import { describe, expect, it } from "vitest";

const COLS = 4;
const ROWS = 4;

describe("collider index", () => {
  it("reports no overlap when empty", () => {
    const index = emptyColliderIndex(COLS, ROWS);
    expect(overlapsCollider(index, { x: 0, y: 0 }, 32)).toBe(false);
  });

  it("detects a body overlapping a sub-cell rect", () => {
    // A 24x20 trunk in the middle of cell (1,1).
    const index = colliderIndexFrom(
      [{ x: TILE_SIZE + 20, y: TILE_SIZE + 40, width: 24, height: 20 }],
      COLS,
      ROWS,
    );
    expect(overlapsCollider(index, { x: TILE_SIZE + 16, y: TILE_SIZE + 36 }, 32)).toBe(true);
  });

  it("lets a body pass beside a sub-cell rect inside the same cell", () => {
    // This is the whole point of the tranche: the cell is occupied, the cell is not blocked.
    const index = colliderIndexFrom(
      [{ x: TILE_SIZE + 40, y: TILE_SIZE + 40, width: 16, height: 16 }],
      COLS,
      ROWS,
    );
    expect(overlapsCollider(index, { x: TILE_SIZE, y: TILE_SIZE }, 32)).toBe(false);
  });

  it("treats the far edge as exclusive, like isWalkableBox", () => {
    const index = colliderIndexFrom([{ x: 32, y: 0, width: 16, height: 16 }], COLS, ROWS);
    // Body [0,32) ends exactly where the rect starts: touching, not overlapping.
    expect(overlapsCollider(index, { x: 0, y: 0 }, 32)).toBe(false);
    expect(overlapsCollider(index, { x: 1, y: 0 }, 32)).toBe(true);
  });

  it("finds a rect from any cell it spans", () => {
    // Spans the (0,0)/(1,0)/(0,1)/(1,1) corner. A bucket lookup must never consult neighbours.
    const index = colliderIndexFrom(
      [{ x: TILE_SIZE - 8, y: TILE_SIZE - 8, width: 16, height: 16 }],
      COLS,
      ROWS,
    );
    expect(overlapsCollider(index, { x: TILE_SIZE - 12, y: TILE_SIZE - 12 }, 8)).toBe(true);
    expect(overlapsCollider(index, { x: TILE_SIZE + 4, y: TILE_SIZE + 4 }, 8)).toBe(true);
  });

  it("ignores rects outside the grid and degenerate bodies", () => {
    const index = colliderIndexFrom(
      [
        { x: -100, y: -100, width: 16, height: 16 },
        { x: 0, y: 0, width: 0, height: 16 },
      ],
      COLS,
      ROWS,
    );
    expect(overlapsCollider(index, { x: 0, y: 0 }, 32)).toBe(false);
    expect(overlapsCollider(emptyColliderIndex(COLS, ROWS), { x: 0, y: 0 }, 0)).toBe(false);
  });
});

describe("flattenColliderIndex", () => {
  it("emits an empty list for an empty index", () => {
    expect(flattenColliderIndex(emptyColliderIndex(COLS, ROWS))).toEqual([]);
  });

  it("emits a rect spanning several cells exactly once", () => {
    // Same corner-straddling rect as above: it lands in all four buckets it touches, so a naive
    // flatten without a Set would emit it four times.
    const rect = { x: TILE_SIZE - 8, y: TILE_SIZE - 8, width: 16, height: 16 };
    const index = colliderIndexFrom([rect], COLS, ROWS);
    expect(flattenColliderIndex(index)).toEqual([[rect.x, rect.y, rect.width, rect.height]]);
  });

  it("keeps two different rects distinct even when their fields would concatenate identically", () => {
    // Without a delimiter, key(a) = "1" + "22" + "3" + "4" = "12234" and
    // key(b) = "12" + "2" + "3" + "4" = "12234" too, even though a and b are different rects.
    const a: Rect = { x: 1, y: 22, width: 3, height: 4 };
    const b: Rect = { x: 12, y: 2, width: 3, height: 4 };
    const index = colliderIndexFrom([a, b], COLS, ROWS);
    const flat = flattenColliderIndex(index);
    const asSet = new Set(flat.map((tuple) => tuple.join(",")));
    expect(asSet).toEqual(
      new Set([[a.x, a.y, a.width, a.height].join(","), [b.x, b.y, b.width, b.height].join(",")]),
    );
  });

  it("round-trips through the wire format with identical overlap answers", () => {
    const rects: Rect[] = [
      // Straddles the (0,0)/(1,0)/(0,1)/(1,1) corner, so it lives in four buckets pre-flatten.
      { x: TILE_SIZE - 8, y: TILE_SIZE - 8, width: 16, height: 16 },
      // A single-cell trunk elsewhere on the grid.
      { x: TILE_SIZE * 2 + 20, y: TILE_SIZE + 10, width: 24, height: 20 },
    ];
    const original = colliderIndexFrom(rects, COLS, ROWS);
    const rebuilt = colliderIndexFrom(
      flattenColliderIndex(original).map(([x, y, width, height]) => ({ x, y, width, height })),
      COLS,
      ROWS,
    );

    const probes: { position: Vec2; size: number }[] = [
      { position: { x: TILE_SIZE - 12, y: TILE_SIZE - 12 }, size: 8 }, // straddling body: overlaps
      { position: { x: TILE_SIZE + 4, y: TILE_SIZE + 4 }, size: 8 }, // straddling body: overlaps
      { position: { x: TILE_SIZE * 2 + 16, y: TILE_SIZE + 6 }, size: 8 }, // trunk: overlaps
      { position: { x: 0, y: 0 }, size: 32 }, // far from either rect: no overlap
    ];
    for (const probe of probes) {
      expect(overlapsCollider(rebuilt, probe.position, probe.size)).toBe(
        overlapsCollider(original, probe.position, probe.size),
      );
    }
  });
});
