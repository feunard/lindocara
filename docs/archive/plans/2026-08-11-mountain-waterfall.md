# Mountain and Waterfall Island Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fifth island to `apps/lab` carrying a terraced mountain and a three-drop waterfall with its own roar, zone, mist, spray and rainbow.

**Architecture:** The island and mountain are author data in the existing `ILES` list — no new generation mechanism. The one new piece of render code (`waterfall.ts`) is built in `@lindocara/hd2d`, because `apps/lab` is that package's witness and never owns render code itself. Sound, zone and particle effects each re-instantiate a pattern the polar chantier already proved. **Nothing here touches `@lindocara/engine`**: every task below lives in `apps/lab` or in the one new `hd2d` module.

**Tech Stack:** TypeScript, three.js, Vite, Vitest, Biome. Assets generated locally with `studio/studio.py` (sfx and music lanes) and `apps/lab/scripts/compose-tileset.py`.

**Spec:** [`docs/archive/specs/2026-08-11-mountain-waterfall-design.md`](../specs/2026-08-11-mountain-waterfall-design.md)

## Before you start: a concurrent refactor

At the time this plan was written, another session was **mid-flight removing the thin-ice
mechanic** — uncommitted changes across `packages/engine`, `packages/renderer`, `packages/client`
and `packages/audio`, with `thin-ice.ts`, its test and five `.ogg` files deleted, and
`TerrainMaterial` reduced from five members to four (`glace-fine` is gone).

**No task below touches any of those files**, which is why this plan is executable alongside it.
But two things follow:

- `apps/lab` had not been updated to match when this was written — [`island.ts`](../../../apps/lab/src/world/island.ts) still generates `"glace-fine"` and [`audio.ts`](../../../apps/lab/src/core/audio.ts) still switches on it — so **the tree may not typecheck for reasons that have nothing to do with your task**. Confirm with `git status` and `npm run typecheck:lab` before assuming you broke something.
- A wet-rock terrain material was originally Task 8 and has been **cut**. Do not add it back; the spec's "Wet rock, and why it is not here" records the measurement that killed it.

## Global Constraints

- **The dev server is on port 5273**, never 5173. `npm run lab` serves `apps/lab` on **5174** (its own Vite config).
- **The map is baked and committed.** Any change to `ILES`, `renderMaterialAt`, or the material assignment in `island.ts` MUST be followed by `npm run build:map -w @lindocara/lab`, and `public/maps/ile.json` committed with it. Skipping this leaves the dev server loading a stale map with no error.
- **60 fps is a hard constraint, not a goal.** Every task that adds a mesh or a particle pool ends with a check against the page's own fps counter.
- **New identifiers, comments and docstrings are written in English.** Existing French symbols are not renamed.
- **Never hand-copy a file into `apps/lab/public/`** from a *pack*: that is `scripts/sync-assets.sh`'s job. Studio-generated one-offs DO go straight into `public/` with `studio.py --out`, are processed in place, and the underscore-prefixed raw file is deleted and never committed.
- **No `vi.mock`.** Tests drive real code.
- **Biome's `noNonNullAssertion` is on**: no `!`, narrow properly.
- **Terrain atlases need `atlas: true`** in `TEXTURE_URLS`. Without it they get mipmaps, whose lower levels blend neighbouring tiles into bleeding borders.

## File Structure

**Created:**
- `packages/hd2d/src/terrain/waterfall.ts` — the falling sheet, the basin and the plunge ring. Render primitives only; knows nothing about islands, zones or the hero.
- `packages/hd2d/test/waterfall.test.ts` — geometry and uniform assertions, Node env (no DOM needed, same as `water.test.ts`).
- `apps/lab/src/world/waterfall-fx.ts` — the lab-side mist and spray pools, plus the rainbow. Content, not engine.
- `apps/lab/test/waterfall-placement.test.ts` — asserts the authored drops actually sit on the terrace walls the mountain provides.

**Modified:**
- `apps/lab/src/settings.ts` — `WEST`, `MOUNTAIN`, `WATERFALLS`, `ZONE_FALLS`, `MIST`, `SPRAY`, `RAINBOW`, `FALLS_FOG`, new `TEXTURE_URLS` entries, new `HERO.friction`/`vitesseSol` members.
- `apps/lab/src/world/island.ts` — `ILES[4]`, `LEVEL_SET`, `renderMaterialAt`, `WEST_REACH_MAX`.
- `apps/lab/src/boot.ts` — the `roche` atlas, the waterfall group, the fx group, the roar distance call, `updateCamera`'s zone parameter.
- `apps/lab/src/core/audio.ts` — `BoucleKey`, `BOUCLES`, `NIVEAUX`, `LOOP_END_S`, `MUSIQUE`, `PORTEE_CASCADE`, `setCascadeDistance`.
- `apps/lab/test/island.test.ts` — the west corridor, the rock band, the terraces.
- `apps/lab/test/zone-precede-matiere.test.ts` — the falls zone's own ordering invariant.

---

### Task 1: The island, the mountain and the rock band

The island is author data, the mountain is four concentric relief discs, and the rock look is a render band derived from elevation — not a new material. All three land together because `meshTerrain` throws the moment `field.materialAt` returns an atlas key that `atlases` has no entry for.

**Files:**
- Modify: `apps/lab/src/settings.ts` (add `WEST`/`MOUNTAIN`, one `TEXTURE_URLS` entry)
- Modify: `apps/lab/src/world/island.ts` (`ILES`, `LEVEL_SET`, `levelSet`, `renderMaterialAt`, `WEST_REACH_MAX`)
- Modify: `apps/lab/src/boot.ts` (the `roche` atlas entry)
- Test: `apps/lab/test/island.test.ts`
- Asset: `apps/lab/public/tex/tileset-roche.png`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `WEST: { readonly x: -25; readonly z: 10; readonly r: 7 }` and `MOUNTAIN: { readonly x: number; readonly z: number }` in `settings.ts`
  - `WEST_REACH_MAX: number` exported from `island.ts` — the island's widest effective shoreline radius, consumed by Task 5's zone-ordering test
  - a `"roche"` atlas key returned by `renderMaterialAt` for any level ≥ 3

**Geometry, already measured** (do not re-derive; these figures come from sampling the real `makeHeightmap` threshold against every existing island):

| quantity | value |
| --- | --- |
| island centre / radius | (−25, 10) / 7 |
| effective shoreline reach | 5.46 – 7.70 |
| water gap to nearest existing land | 5.70 |
| margin to the grid edge (`WORLD.size` 72) | 3.30 |
| mountain centre (shifted west of the island's) | (−26.4, 10) |
| terrace discs | r 4.2 → h1, r 3.2 → h2, r 2.2 → h3, r 1.2 → h4 |
| resulting cells | 81 at level 0, 26 at 1, 16 at 2, 12 at 3, 4 at 4 |
| level-0 ring on the east face | 3.00 units (the approach beach) |
| level-0 ring on the west/south-west face | 0.85 – 1.00 units |

The mountain is shifted **west** of the island centre on purpose: it widens the eastern beach, which is the face the hero swims toward and the face the waterfall runs down. The discs are concentric with each other (not staggered) so the three drops stack in one clean vertical line.

- [ ] **Step 1: Write the failing test**

Append to `apps/lab/test/island.test.ts`:

```ts
describe("the west island", () => {
  const { field } = generateIsland({ size: WORLD.size, seed: WORLD.seed });

  it("exists, and its summit reaches level 4", () => {
    expect(field.levelAt(toCell(WEST.x), toCell(WEST.z))).not.toBeNull();
    let highest = 0;
    for (let j = 0; j < WORLD.size; j++) {
      for (let i = 0; i < WORLD.size; i++) {
        const x = i + 0.5 - WORLD.size / 2;
        const z = j + 0.5 - WORLD.size / 2;
        if (Math.hypot(x - WEST.x, z - WEST.z) > 12) continue;
        highest = Math.max(highest, field.levelAt(i, j) ?? 0);
      }
    }
    expect(highest).toBe(4);
  });

  it("carries every terrace from 0 to 4, so no wall is ever taller than one level", () => {
    const seen = new Set<number>();
    for (let j = 0; j < WORLD.size; j++) {
      for (let i = 0; i < WORLD.size; i++) {
        const x = i + 0.5 - WORLD.size / 2;
        const z = j + 0.5 - WORLD.size / 2;
        if (Math.hypot(x - WEST.x, z - WEST.z) > 12) continue;
        const h = field.levelAt(i, j);
        if (h !== null) seen.add(h);
      }
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it("renders levels 3 and up with the rock atlas, and 0/1/2 with the grass bands", () => {
    expect(renderMaterialAt("herbe", 0)).toBe("lvl0");
    expect(renderMaterialAt("herbe", 1)).toBe("lvl1");
    expect(renderMaterialAt("herbe", 2)).toBe("lvl2");
    expect(renderMaterialAt("herbe", 3)).toBe("roche");
    expect(renderMaterialAt("herbe", 4)).toBe("roche");
  });

  // Same discipline as the north corridor test above: no hard-coded x bound, because any such
  // value goes stale the first time `ILES` is retuned. Walk EAST from a cell known to be west
  // island land (its centre) until land ends, then walk WEST from a cell known to be main island
  // land (the origin) until land ends, and assert nothing reappears between the two. Sweeping
  // several z values, not just the axis, is what would catch a diagonal land bridge.
  it("is separated from the main island by open water on the corridor's whole width", () => {
    for (let z = 4; z <= 16; z++) {
      let xWestShore = WEST.x;
      while (field.levelAt(toCell(xWestShore + 1), toCell(z)) !== null) xWestShore += 1;
      let xMainShore = 0;
      while (field.levelAt(toCell(xMainShore - 1), toCell(z)) !== null) xMainShore -= 1;
      for (let x = xWestShore + 1; x < xMainShore; x += 1) {
        expect(field.levelAt(toCell(x), toCell(z))).toBeNull();
      }
    }
  });

  it("WEST_REACH_MAX bounds the real shoreline", () => {
    for (let j = 0; j < WORLD.size; j++) {
      for (let i = 0; i < WORLD.size; i++) {
        const x = i + 0.5 - WORLD.size / 2;
        const z = j + 0.5 - WORLD.size / 2;
        const d = Math.hypot(x - WEST.x, z - WEST.z);
        if (d > 12 || field.levelAt(i, j) === null) continue;
        expect(d).toBeLessThanOrEqual(WEST_REACH_MAX);
      }
    }
  });
});
```

Extend the file's existing imports:

```ts
import { NORD, WEST, WORLD } from "../src/settings.js";
import {
  generateIsland,
  isBeach,
  mulberry32,
  renderMaterialAt,
  waterDistance,
  WEST_REACH_MAX,
} from "../src/world/island.js";
```

And add `"roche"` to the allowed atlas keys in the existing `"matériaux de terrain cohérents avec le palier"` test:

```ts
        expect(["lvl0", "lvl1", "lvl2", "roche", "sable", "neige", "glace"]).toContain(m);
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -w @lindocara/lab -- island
```

Expected: FAIL — `WEST` and `WEST_REACH_MAX` are not exported.

- [ ] **Step 3: Add the island settings**

In `apps/lab/src/settings.ts`, immediately after the `NORD` declaration:

```ts
/** The west island. Reached only by swimming, like the frozen one: 5.70 units of open water
 *  separate it from the main island's shore at the closest point, and 3.30 units of sea remain
 *  between its own shore and the edge of the grid — so `WORLD.size` stays at 72 and the terrain
 *  mesh does not grow by a quarter for one island. */
export const WEST = { x: -25, z: 10, r: 7 } as const;

/** The mountain's centre, shifted WEST of the island's own. Two things come out of that offset:
 *  the eastern beach widens to 3 units — the face the hero swims toward, and the one the falls
 *  run down, needs somewhere to stand and look up from — while the western side keeps a 0.85-unit
 *  strip, which is exactly the narrow shelf the lowest basin spills across into the sea. */
export const MOUNTAIN = { x: WEST.x - 1.4, z: WEST.z } as const;
```

Add the tileset to `TEXTURE_URLS`, beside the other generated ones:

```ts
  // The mountain's rock (Task 1 of the waterfall chantier): a generated surface on the original
  // Tiny Swords block geometry, same path as `tileset-neige`/`tileset-glace`. `atlas: true` is
  // mandatory like every other tileset — with mipmaps the lower levels blend neighbouring tiles
  // and the borders bleed (see `docs/hd2d-rendering.md`).
  { url: "/tex/tileset-roche.png", atlas: true },
```

- [ ] **Step 4: Add the island, the mountain and the rock band**

In `apps/lab/src/world/island.ts`, extend the import:

```ts
import { MOUNTAIN, NORD, WEST, WORLD } from "../settings.js";
```

Append a fifth entry to `ILES`:

```ts
  // The fifth, west (see `WEST`, `settings.ts`): a terraced mountain, reached only by swimming.
  // Four CONCENTRIC relief discs of shrinking radius give levels 1 to 4, so every wall on this
  // island is exactly one level (0.9) tall. That is not decoration — `mesh.ts` stretches ONE UV
  // cell over a wall's full drop ("preserving a single tall-block silhouette"), which is right for
  // a level-2 cliff and would smear the rock over 3.6 units on a mountain face. Keeping the discs
  // concentric rather than staggered also stacks the three waterfall drops in one clean vertical
  // line down the east face.
  {
    x: WEST.x,
    z: WEST.z,
    r: WEST.r,
    onde: (a) => 0.12 * Math.sin(a * 3 + 2.2) + 0.05 * Math.sin(a * 5 - 0.4),
    reliefs: [
      { x: MOUNTAIN.x, z: MOUNTAIN.z, r: 4.2, h: 1 },
      { x: MOUNTAIN.x, z: MOUNTAIN.z, r: 3.2, h: 2 },
      { x: MOUNTAIN.x, z: MOUNTAIN.z, r: 2.2, h: 3 },
      { x: MOUNTAIN.x, z: MOUNTAIN.z, r: 1.2, h: 4 },
    ],
  },
```

Replace `LEVEL_SET`/`levelSet`:

```ts
const LEVEL_SET = ["lvl0", "lvl1", "lvl2", "roche"] as const;
/** Levels 0-2 keep their own grass band; everything at 3 or above is rock. The clamp is what makes
 *  a mountain of any height legal without a fifth atlas — the terraces above 3 all share one. */
const levelSet = (h: number): string => LEVEL_SET[Math.min(h, LEVEL_SET.length - 1)] ?? "roche";
```

Add the exported reach bound, next to `NORD_EMPRISE`:

```ts
/** The west island's widest effective shoreline radius: `r · (0.94 − onde(a))` sampled around the
 *  full circle, which is exactly the threshold `makeHeightmap` applies. Exported so
 *  `test/zone-precede-matiere.test.ts` can pin `ZONE_FALLS.rayon` above it against the REAL symbol
 *  rather than a copied number — the same reason `NORD_EMPRISE` is exported. Computed once at
 *  module load: 720 samples of two sines, paid once per process, never per frame. */
export const WEST_REACH_MAX = ((): number => {
  const onde = (a: number): number => 0.12 * Math.sin(a * 3 + 2.2) + 0.05 * Math.sin(a * 5 - 0.4);
  let max = 0;
  for (let k = 0; k < 720; k++) max = Math.max(max, WEST.r * (0.94 - onde((k * Math.PI) / 360)));
  return max;
})();
```

> The `onde` here and the one in `ILES[4]` are the same expression written twice. That duplication is deliberate and must stay: `ILES` is a literal list of island shapes, and hoisting one member's `onde` into a named binding to share it would make that entry read differently from its four neighbours for no gain. If you change one, change both — the `WEST_REACH_MAX bounds the real shoreline` test fails loudly if you do not.

- [ ] **Step 5: Register the rock atlas**

In `apps/lab/src/boot.ts`, add to the `atlases` record after `glace`:

```ts
  // The mountain's rock (Task 1 of the waterfall chantier). `block: "cliff-edge"` like `lvl1`/
  // `lvl2`: a rock terrace always overlooks a lower neighbour, never the sea directly, so it needs
  // the tufted border block that joins onto a wall — not the water-edge one with foam painted in.
  roche: {
    texture: textures.get("/tex/tileset-roche.png"),
    cols: 9,
    rows: 6,
    block: "cliff-edge",
    wallRow: 4,
    tilePx: 64,
  },
```

- [ ] **Step 6: Generate the rock tileset**

Generate the surface, then transfer it onto the Tiny Swords block geometry. The two-step shape is the point: a diffusion model cannot produce a 4×4 autotile block whose borders join at the pixel, so it only ever paints the FILL, and `compose-tileset.py` keeps the original's alpha, its border lacing and its wall-row silhouette.

```bash
python3 studio/studio.py sprite --prompt "seamless grey mountain rock surface, cracked stone, top-down texture" --seed 42 --variants 3 --out apps/lab/public/tex/_roche.png
```

Judge the three variants on screen, keep one, then:

```bash
python3 apps/lab/scripts/compose-tileset.py --base packages/catalog/assets/tiny-swords/Terrain/Ground/Tilemap_Elevation.png --out apps/lab/public/tex/tileset-roche.png --mode generated --surface apps/lab/public/tex/_roche.png --wall-row 4 --hue 30 --sat 0.10 --gamma 0.9
```

If the generated fill does not convince, the documented fallback is the procedural one — a decision the snow island planned for, not a failure:

```bash
python3 apps/lab/scripts/compose-tileset.py --base packages/catalog/assets/tiny-swords/Terrain/Ground/Tilemap_Elevation.png --out apps/lab/public/tex/tileset-roche.png --mode retint --wall-row 4 --hue 30 --sat 0.10 --gamma 0.9
```

Delete the raw file — it is never committed:

```bash
rm apps/lab/public/tex/_roche.png
```

- [ ] **Step 7: Run the test to verify it passes**

```bash
npm test -w @lindocara/lab -- island
```

Expected: PASS, all five new cases.

- [ ] **Step 8: Re-bake the map**

```bash
npm run build:map -w @lindocara/lab
```

Expected: `apps/lab/public/maps/ile.json` changes. It is committed, not generated at dev-server start — an edit to `ILES` that skips this step silently drifts from what the browser loads.

- [ ] **Step 9: Check it on screen**

```bash
npm run lab
```

Open <http://localhost:5174>, swim west, and confirm: the island is there, the mountain terraces read as four distinct steps, each step is jumpable, the top two terraces are rock and the lower ones grass, and the fps counter still reads 60.

- [ ] **Step 10: Commit**

```bash
git add apps/lab/src/settings.ts apps/lab/src/world/island.ts apps/lab/src/boot.ts apps/lab/test/island.test.ts apps/lab/public/tex/tileset-roche.png apps/lab/public/maps/ile.json
git commit -m "feat(lab): west island with a terraced mountain and a rock render band"
```

---

### Task 2: The falling sheet

The one genuinely new piece of render code, built in the package rather than the app because `apps/lab` is `@lindocara/hd2d`'s witness and never owns render code itself.

**Files:**
- Create: `packages/hd2d/src/terrain/waterfall.ts`
- Test: `packages/hd2d/test/waterfall.test.ts`
- Modify: `apps/lab/src/settings.ts` (the `WATERFALLS` placement data)
- Modify: `apps/lab/src/boot.ts` (build one sheet, update it in the frame loop)

**Interfaces:**
- Consumes: `WEST`, `MOUNTAIN` and `WORLD.levelHeight` from Task 1.
- Produces:
  - `createWaterfallSheet(ctx: Hd2dContext, opts: WaterfallSheetOptions): WaterfallSheet`
  - `interface WaterfallSheetOptions { texture: THREE.Texture; x: number; z: number; width: number; topY: number; bottomY: number; facing: "east" | "west" | "north" | "south"; speed?: number; lipSquash?: number; flare?: number }`
  - `interface WaterfallSheet { mesh: THREE.Mesh; update(dt: number): void; dispose(): void }`
  - `WATERFALLS: readonly WaterfallPlacement[]` in `settings.ts`, with `interface WaterfallPlacement { x: number; z: number; width: number; topLevel: number; bottomLevel: number; facing: "east" }`

- [ ] **Step 1: Write the failing test**

Create `packages/hd2d/test/waterfall.test.ts`:

```ts
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createHd2dContext } from "../src/context.js";
import { createWaterfallSheet } from "../src/terrain/waterfall.js";

const texture = (): THREE.Texture => new THREE.Texture();

const sheet = (over: Partial<Parameters<typeof createWaterfallSheet>[1]> = {}) =>
  createWaterfallSheet(createHd2dContext(), {
    texture: texture(),
    x: -24.2,
    z: 10,
    width: 1.8,
    topY: 2.7,
    bottomY: 1.8,
    facing: "east",
    ...over,
  });

describe("createWaterfallSheet", () => {
  it("spans exactly the requested drop, vertically", () => {
    const s = sheet();
    s.mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(s.mesh);
    expect(box.min.y).toBeCloseTo(1.8, 5);
    expect(box.max.y).toBeCloseTo(2.7, 5);
  });

  it("faces east: its plane is normal to X, so it is thin along X and wide along Z", () => {
    const s = sheet();
    s.mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(s.mesh);
    const size = box.getSize(new THREE.Vector3());
    expect(size.z).toBeGreaterThan(size.x);
  });

  it("flares at the base: the bottom edge is wider than the lip", () => {
    const s = sheet({ flare: 0.4, lipSquash: 0 });
    const pos = s.mesh.geometry.getAttribute("position");
    let lipHalf = 0;
    let baseHalf = 0;
    for (let k = 0; k < pos.count; k++) {
      const y = pos.getY(k);
      const half = Math.abs(pos.getX(k));
      if (y > 0.99) lipHalf = Math.max(lipHalf, half);
      if (y < 0.01) baseHalf = Math.max(baseHalf, half);
    }
    expect(baseHalf).toBeGreaterThan(lipHalf);
  });

  it("scrolls its texture downward over time, and only downward", () => {
    const s = sheet();
    const offset = (s.mesh.material as THREE.ShaderMaterial).uniforms.uScroll;
    const before = offset?.value as number;
    s.update(0.5);
    const after = offset?.value as number;
    expect(after).toBeGreaterThan(before);
  });

  it("releases its own geometry and material on dispose", () => {
    const s = sheet();
    let disposed = 0;
    s.mesh.geometry.addEventListener("dispose", () => {
      disposed++;
    });
    s.mesh.material.addEventListener("dispose", () => {
      disposed++;
    });
    s.dispose();
    expect(disposed).toBe(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -w @lindocara/hd2d -- waterfall
```

Expected: FAIL — `Cannot find module '../src/terrain/waterfall.js'`.

- [ ] **Step 3: Write the sheet**

Create `packages/hd2d/src/terrain/waterfall.ts`:

```ts
import * as THREE from "three";
import type { Hd2dContext } from "../context.js";

/**
 * A falling sheet of water: one vertical quad hugging a cliff face, scrolling its texture
 * downward.
 *
 * Authored, never derived. `foam.ts` can find a shoreline by asking the height field where land
 * meets water, but nothing in the field knows about water ABOVE ground — `waterLevel` is one
 * global scalar for the whole world (see `water.ts`, and `TerrainQuerySource.waterLevel` in
 * `@lindocara/engine`). A waterfall is therefore a placement its caller declares, not a feature
 * this module can detect.
 *
 * Opaque, like `createWater` and for the same reason: foam is painted with `alphaTest`, so it
 * draws BEFORE transparent materials. A translucent sheet would draw over the foam at the shore
 * and haze it. The softening at the lateral edges is done in the fragment shader by fading toward
 * the terrain behind, not by turning the material transparent.
 */
export interface WaterfallSheetOptions {
  /** Surface texture, scrolled downward. The lab passes the same `/tex/water.png` the sea uses:
   *  a fall and the sea it ends in must read as one substance. Cloned internally, so the caller's
   *  registry copy keeps its own wrap/repeat/offset — same discipline as `createWater`. */
  texture: THREE.Texture;
  /** World position of the sheet's centre, on the cliff face. */
  x: number;
  z: number;
  /** Width of the sheet at the lip, in world units. */
  width: number;
  /** World height of the lip and of the base. `topY > bottomY`. */
  topY: number;
  bottomY: number;
  /** Which way the cliff face looks. Decides the plane's orientation and its normal. */
  facing: "east" | "west" | "north" | "south";
  /** Texture rows scrolled per second. Higher reads as a faster fall. */
  speed?: number;
  /** Horizontal squash at the lip, 0..1 — water narrows as it accelerates off the edge. */
  lipSquash?: number;
  /** Fractional widening at the base, 0..1 — the sheet spreads as it hits. */
  flare?: number;
}

export interface WaterfallSheet {
  mesh: THREE.Mesh;
  update(dt: number): void;
  dispose(): void;
}

const YAW: Record<WaterfallSheetOptions["facing"], number> = {
  east: Math.PI / 2,
  west: -Math.PI / 2,
  north: Math.PI,
  south: 0,
};

export function createWaterfallSheet(
  _ctx: Hd2dContext,
  opts: WaterfallSheetOptions,
): WaterfallSheet {
  const drop = opts.topY - opts.bottomY;
  const squash = opts.lipSquash ?? 0.15;
  const flare = opts.flare ?? 0.25;

  // Built by hand rather than with `PlaneGeometry` because the lip and the base have DIFFERENT
  // widths: the quad is a trapezoid, not a rectangle. Y runs 0..1 (the shader and the flare test
  // both read it as a fraction of the drop) and the mesh is positioned and scaled into world
  // space below, so the same geometry maths holds at any drop height.
  const ROWS = 8;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let r = 0; r <= ROWS; r++) {
    const v = r / ROWS;
    const half = (opts.width / 2) * (1 - squash * (1 - v) ** 2 + flare * (1 - v));
    positions.push(-half, v, 0, half, v, 0);
    uvs.push(0, v, 1, v);
  }
  for (let r = 0; r < ROWS; r++) {
    const a = r * 2;
    indices.push(a, a + 1, a + 3, a, a + 3, a + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const map = opts.texture.clone();
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.needsUpdate = true;

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: map },
      uScroll: { value: 0 },
      // Two tones, like the sea's shallow/deep pair: the sheet is brighter where it breaks at the
      // edges and darker in the fast core.
      uCore: { value: new THREE.Color("#5fc9d8") },
      uFoam: { value: new THREE.Color("#eafaff") },
      uRepeat: { value: new THREE.Vector2(1, Math.max(1, Math.round(drop))) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform float uScroll;
      uniform vec3 uCore;
      uniform vec3 uFoam;
      uniform vec2 uRepeat;
      varying vec2 vUv;
      void main() {
        vec2 uv = vec2(vUv.x, vUv.y * uRepeat.y - uScroll) * vec2(uRepeat.x, 1.0);
        float grain = texture2D(uMap, uv).r;
        // Foam at the two lateral edges and at the base, core in the middle of the fall.
        float edge = smoothstep(0.5, 0.0, abs(vUv.x - 0.5) * 2.0);
        float base = smoothstep(0.35, 0.0, vUv.y);
        vec3 col = mix(uFoam, uCore, clamp(edge - base, 0.0, 1.0));
        gl_FragColor = vec4(col * (0.75 + 0.45 * grain), 1.0);
      }
    `,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.scale.set(1, drop, 1);
  mesh.position.set(opts.x, opts.bottomY, opts.z);
  mesh.rotation.y = YAW[opts.facing];
  // Slightly off the terrain face so it never z-fights the cliff it hangs on.
  mesh.renderOrder = 1;

  const speed = opts.speed ?? 1.6;

  return {
    mesh,
    update(dt) {
      const u = material.uniforms.uScroll;
      if (u) u.value = (u.value as number) + dt * speed;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      map.dispose();
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -w @lindocara/hd2d -- waterfall
```

Expected: PASS, all five cases.

- [ ] **Step 5: Declare the placements**

In `apps/lab/src/settings.ts`, after `MOUNTAIN`:

```ts
/** One authored drop of the west island's cascade. Authored rather than derived: nothing in the
 *  height field knows about water above ground (`waterLevel` is one global scalar), so a fall
 *  cannot be detected the way `foamPlacements` detects a shoreline.
 *
 *  Every drop spans exactly ONE level, because every wall on this island does — see the concentric
 *  relief discs in `ILES[4]` (`world/island.ts`). A sheet spanning two levels would have no wall
 *  to hang on. */
export interface WaterfallPlacement {
  x: number;
  z: number;
  /** Width of the sheet at its lip, world units. */
  width: number;
  /** The terrace it falls FROM and the one it lands ON. `topLevel === bottomLevel + 1`. */
  topLevel: number;
  bottomLevel: number;
  facing: "east";
}

/** The three drops, stacked down the mountain's EAST face — the one the hero swims toward, and
 *  the one whose beach is 3 units wide instead of 0.85 (see `MOUNTAIN`). Each sits on the wall of
 *  the terrace disc of the same radius: 4→3 at r 1.2, 3→2 at r 2.2, 2→1 at r 3.2.
 *
 *  The chain is closed at both ends without a fourth sheet: a spring pool on the summit feeds the
 *  first drop (Task 3 builds it — a basin with no sheet above it), and the lowest basin sits on a
 *  level-1 terrace whose outer lip is close enough to the shore that it reads as draining into the
 *  sea across the existing beach and foam. */
export const WATERFALLS: readonly WaterfallPlacement[] = [
  { x: MOUNTAIN.x + 1.2, z: MOUNTAIN.z, width: 0.9, topLevel: 4, bottomLevel: 3, facing: "east" },
  { x: MOUNTAIN.x + 2.2, z: MOUNTAIN.z, width: 1.8, topLevel: 3, bottomLevel: 2, facing: "east" },
  { x: MOUNTAIN.x + 3.2, z: MOUNTAIN.z, width: 1.4, topLevel: 2, bottomLevel: 1, facing: "east" },
];
```

- [ ] **Step 6: Wire one sheet into the scene**

In `apps/lab/src/boot.ts`, after the `foam` block:

```ts
// The waterfall (Task 2 of the waterfall chantier): one sheet per authored drop. It shares the
// sea's own texture on purpose — a fall and the sea it ends in must read as one substance.
const waterfalls = WATERFALLS.map((w) =>
  createWaterfallSheet(ctx, {
    texture: textures.get("/tex/water.png"),
    x: w.x,
    z: w.z,
    width: w.width,
    topY: w.topLevel * WORLD.levelHeight,
    bottomY: w.bottomLevel * WORLD.levelHeight,
    facing: w.facing,
  }),
);
for (const w of waterfalls) scene.add(w.mesh);
```

In the `frame()` function, beside `water.update(dt)`:

```ts
  for (const w of waterfalls) w.update(dt);
```

Add the imports at the top of `boot.ts`:

```ts
import { createWaterfallSheet } from "@lindocara/hd2d/terrain/waterfall.js";
```

and add `WATERFALLS` to the existing `../settings.js` import list.

- [ ] **Step 7: Check it on screen**

```bash
npm run lab
```

Swim to the west island and look at the east face. Three sheets should hang on three terrace walls, scrolling downward. They will look unfinished — no basin, no ripple, no sound. That is what Task 3 and Task 4 are for. Confirm 60 fps.

- [ ] **Step 8: Commit**

```bash
git add packages/hd2d/src/terrain/waterfall.ts packages/hd2d/test/waterfall.test.ts apps/lab/src/settings.ts apps/lab/src/boot.ts
git commit -m "feat(hd2d): falling water sheet, wired into the lab's west island"
```

---

### Task 3: Basins, plunge rings, and the composed waterfall

Turn the bare sheet into a complete fall, and hoist the three-part composition into the package so `boot.ts` builds one object per drop instead of wiring three primitives by hand.

**Files:**
- Modify: `packages/hd2d/src/terrain/waterfall.ts` (add the basin, the ring, and `createWaterfall`)
- Modify: `packages/hd2d/test/waterfall.test.ts`
- Modify: `apps/lab/src/boot.ts` (build `createWaterfall` per placement, plus the summit spring pool)
- Test: `apps/lab/test/waterfall-placement.test.ts` (new)

**Interfaces:**
- Consumes: `createWaterfallSheet`, `WaterfallSheetOptions`, `WATERFALLS` from Task 2.
- Produces:
  - `createWaterfallBasin(ctx: Hd2dContext, opts: WaterfallBasinOptions): WaterfallBasin`
  - `interface WaterfallBasinOptions { texture: THREE.Texture; x: number; z: number; radius: number; y: number }`
  - `interface WaterfallBasin { mesh: THREE.Mesh; update(dt: number): void; dispose(): void }`
  - `createWaterfall(ctx: Hd2dContext, opts: WaterfallOptions): Waterfall`
  - `interface WaterfallOptions extends WaterfallSheetOptions { basinRadius: number }`
  - `interface Waterfall { group: THREE.Group; impact: THREE.Vector3; update(dt: number): void; dispose(): void }` — `impact` is the world point where the sheet meets the basin, consumed by Tasks 4, 6 and 7.

- [ ] **Step 1: Write the failing test**

Append to `packages/hd2d/test/waterfall.test.ts`:

```ts
import { createWaterfall, createWaterfallBasin } from "../src/terrain/waterfall.js";

describe("createWaterfallBasin", () => {
  it("lies flat at its own height", () => {
    const b = createWaterfallBasin(createHd2dContext(), {
      texture: texture(),
      x: -24.2,
      z: 10,
      radius: 1.1,
      y: 1.8,
    });
    b.mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(b.mesh);
    expect(box.min.y).toBeCloseTo(1.8, 3);
    expect(box.max.y).toBeCloseTo(1.8, 3);
    expect(box.getSize(new THREE.Vector3()).x).toBeCloseTo(2.2, 3);
  });
});

describe("createWaterfall", () => {
  const fall = () =>
    createWaterfall(createHd2dContext(), {
      texture: texture(),
      x: -24.2,
      z: 10,
      width: 1.8,
      topY: 2.7,
      bottomY: 1.8,
      facing: "east",
      basinRadius: 1.1,
    });

  it("groups a sheet, a basin and a ring", () => {
    expect(fall().group.children).toHaveLength(3);
  });

  it("reports the impact point at the foot of the sheet", () => {
    const f = fall();
    expect(f.impact.x).toBeCloseTo(-24.2, 5);
    expect(f.impact.y).toBeCloseTo(1.8, 5);
    expect(f.impact.z).toBeCloseTo(10, 5);
  });

  it("disposes every part", () => {
    const f = fall();
    let disposed = 0;
    f.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.addEventListener("dispose", () => {
          disposed++;
        });
      }
    });
    f.dispose();
    expect(disposed).toBe(3);
  });
});
```

Create `apps/lab/test/waterfall-placement.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { WATERFALLS, WORLD } from "../src/settings.js";
import { generateIsland } from "../src/world/island.js";

const toCell = (w: number) => Math.floor(w + WORLD.size / 2);

describe("the authored waterfall drops sit on real terrace walls", () => {
  const { field } = generateIsland({ size: WORLD.size, seed: WORLD.seed });

  it("spans exactly one level each — the only wall height this island has", () => {
    for (const w of WATERFALLS) {
      expect(w.topLevel - w.bottomLevel).toBe(1);
    }
  });

  // A drop is only real if the terrain actually steps down across it: the cell just BEHIND the
  // lip must stand at `topLevel`, and the cell just in FRONT of the base at `bottomLevel`. Without
  // this the sheets would hang in mid-air the first time a relief disc is retuned, and nothing on
  // screen would say why.
  it("has the terrace above behind the lip and the terrace below in front of the base", () => {
    for (const w of WATERFALLS) {
      expect(field.levelAt(toCell(w.x - 0.6), toCell(w.z))).toBe(w.topLevel);
      expect(field.levelAt(toCell(w.x + 0.6), toCell(w.z))).toBe(w.bottomLevel);
    }
  });

  it("chains: each drop lands on the terrace the next one falls from", () => {
    for (let k = 1; k < WATERFALLS.length; k++) {
      const above = WATERFALLS[k - 1];
      const below = WATERFALLS[k];
      expect(above).toBeDefined();
      expect(below).toBeDefined();
      expect(below?.topLevel).toBe(above?.bottomLevel);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test -w @lindocara/hd2d -- waterfall && npm test -w @lindocara/lab -- waterfall-placement
```

Expected: the hd2d suite FAILS on the missing `createWaterfallBasin` export. The lab suite should already PASS — Task 2's placements were authored against the real terraces. If it fails, the placements are wrong and must be fixed before continuing.

- [ ] **Step 3: Add the basin, the ring and the composition**

Append to `packages/hd2d/src/terrain/waterfall.ts`:

```ts
export interface WaterfallBasinOptions {
  texture: THREE.Texture;
  x: number;
  z: number;
  /** Radius of the disc, world units. */
  radius: number;
  /** World height of its surface — the terrace it sits on. */
  y: number;
}

export interface WaterfallBasin {
  mesh: THREE.Mesh;
  update(dt: number): void;
  dispose(): void;
}

/**
 * A catch basin: a small horizontal disc of water on the terrace a fall lands on.
 *
 * DECORATIVE, and not by omission. `TerrainQuery` reads one global `waterLevel` for the whole
 * world, so water at altitude cannot exist as far as collision is concerned — the hero wades
 * through this, and teaching the engine about per-cell water height would change a contract shared
 * with the game's authoritative server for the sake of a visual feature.
 *
 * It reuses the sea's texture and a two-tone gradient like `createWater`'s, but with no
 * depth-range grading: a basin has no open sea to fade toward. What it must not lose is the
 * FAMILY resemblance — a basin that reads as a different substance from the ocean it drains into
 * breaks the island in two.
 */
export function createWaterfallBasin(
  _ctx: Hd2dContext,
  opts: WaterfallBasinOptions,
): WaterfallBasin {
  const geometry = new THREE.CircleGeometry(opts.radius, 24);
  geometry.rotateX(-Math.PI / 2);

  const map = opts.texture.clone();
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.needsUpdate = true;

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: map },
      uTime: { value: 0 },
      uShallow: { value: new THREE.Color("#3fb6b0") },
      uDeep: { value: new THREE.Color("#116a7a") },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform float uTime;
      uniform vec3 uShallow;
      uniform vec3 uDeep;
      varying vec2 vUv;
      void main() {
        vec2 uv = vUv * 3.0 + vec2(uTime * 0.05, uTime * 0.03);
        float grain = texture2D(uMap, uv).r;
        // Deep in the middle, shallow at the rim — a bowl, not a puddle.
        float rim = smoothstep(0.5, 0.0, distance(vUv, vec2(0.5)));
        gl_FragColor = vec4(mix(uShallow, uDeep, rim) * (0.8 + 0.4 * grain), 1.0);
      }
    `,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(opts.x, opts.y, opts.z);

  return {
    mesh,
    update(dt) {
      const u = material.uniforms.uTime;
      if (u) u.value = (u.value as number) + dt;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      map.dispose();
    },
  };
}

export interface WaterfallOptions extends WaterfallSheetOptions {
  /** Radius of the catch basin under the sheet. */
  basinRadius: number;
}

export interface Waterfall {
  group: THREE.Group;
  /** The world point where the sheet meets the basin. Mist, spray, the rainbow and the roar's
   *  distance are all anchored to this rather than each recomputing it from the placement. */
  impact: THREE.Vector3;
  update(dt: number): void;
  dispose(): void;
}

/** One complete drop: a falling sheet, the basin it lands in, and the ring where the two meet. */
export function createWaterfall(ctx: Hd2dContext, opts: WaterfallOptions): Waterfall {
  const sheet = createWaterfallSheet(ctx, opts);
  const basin = createWaterfallBasin(ctx, {
    texture: opts.texture,
    x: opts.x,
    z: opts.z,
    radius: opts.basinRadius,
    y: opts.bottomY,
  });

  // The plunge ring: a flat annulus that grows and fades on a loop, the way `makeRipple` animates
  // the hero's swim wake. Built here rather than reusing `makeRipple` because that one is sized
  // and paced for a swimmer, and a plunge pool ripples continuously rather than once per stroke.
  const ringGeometry = new THREE.RingGeometry(0.1, 1, 24);
  ringGeometry.rotateX(-Math.PI / 2);
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
  });
  const ring = new THREE.Mesh(ringGeometry, ringMaterial);
  ring.position.set(opts.x, opts.bottomY + 0.02, opts.z);

  const group = new THREE.Group();
  group.add(sheet.mesh, basin.mesh, ring);

  let t = 0;
  return {
    group,
    impact: new THREE.Vector3(opts.x, opts.bottomY, opts.z),
    update(dt) {
      sheet.update(dt);
      basin.update(dt);
      t = (t + dt * 0.9) % 1;
      ring.scale.setScalar(0.3 + t * opts.basinRadius);
      ringMaterial.opacity = 0.5 * (1 - t);
    },
    dispose() {
      sheet.dispose();
      basin.dispose();
      ringGeometry.dispose();
      ringMaterial.dispose();
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test -w @lindocara/hd2d -- waterfall && npm test -w @lindocara/lab -- waterfall-placement
```

Expected: PASS on both.

- [ ] **Step 5: Replace the bare sheets with complete falls, and add the spring pool**

In `apps/lab/src/boot.ts`, replace the `waterfalls` block from Task 2 with:

```ts
// The waterfall (Task 3 of the waterfall chantier): one complete drop per authored placement —
// sheet, catch basin, plunge ring.
const waterfalls = WATERFALLS.map((w) =>
  createWaterfall(ctx, {
    texture: textures.get("/tex/water.png"),
    x: w.x,
    z: w.z,
    width: w.width,
    topY: w.topLevel * WORLD.levelHeight,
    bottomY: w.bottomLevel * WORLD.levelHeight,
    facing: w.facing,
    basinRadius: w.width * 0.75,
  }),
);
for (const w of waterfalls) scene.add(w.group);

// The spring pool on the summit: a basin with no sheet above it, which is what closes the chain at
// the top. A fall whose source is off-screen reads as a leak rather than a spring.
const springPool = createWaterfallBasin(ctx, {
  texture: textures.get("/tex/water.png"),
  x: MOUNTAIN.x,
  z: MOUNTAIN.z,
  radius: 0.9,
  y: 4 * WORLD.levelHeight,
});
scene.add(springPool.mesh);
```

Update the frame loop line:

```ts
  for (const w of waterfalls) w.update(dt);
  springPool.update(dt);
```

Update the import:

```ts
import { createWaterfall, createWaterfallBasin } from "@lindocara/hd2d/terrain/waterfall.js";
```

and add `MOUNTAIN` to the `../settings.js` import list.

- [ ] **Step 6: Check it on screen**

```bash
npm run lab
```

Three complete drops, each landing in a rippling basin, fed from a pool on the summit. Confirm the basins read as the same substance as the sea, that the hero wades through them without swimming, and that the fps counter still reads 60. Ten added meshes is the budget the spec set — if the number moved, measure it properly with `bench.measure()` through the `readPixels` method rather than trusting a glance.

- [ ] **Step 7: Commit**

```bash
git add packages/hd2d/src/terrain/waterfall.ts packages/hd2d/test/waterfall.test.ts apps/lab/src/boot.ts apps/lab/test/waterfall-placement.test.ts
git commit -m "feat(hd2d): catch basins and plunge rings, three drops chained in the lab"
```

---

### Task 4: The roar

A held loop whose gain follows distance — the third instance of the campfire's proven pattern, not a new audio system.

**Files:**
- Modify: `apps/lab/src/core/audio.ts` (`BoucleKey`, `BOUCLES`, `NIVEAUX`, `LOOP_END_S`, `PORTEE_CASCADE`, `setCascadeDistance`)
- Modify: `apps/lab/src/boot.ts` (call it each frame)
- Asset: `apps/lab/public/sfx/cascade.ogg`

**Interfaces:**
- Consumes: `Waterfall.impact` from Task 3.
- Produces: `setCascadeDistance(d: number): void` exported from `core/audio.ts`.

- [ ] **Step 1: Generate the loop**

```bash
python3 studio/studio.py sfx --prompt "a steady waterfall, heavy water falling onto rock into a pool, continuous white noise roar with low rumble" --duration 20 --seed 42 --variants 3 --out apps/lab/public/sfx/_cascade.wav
```

Judge the three variants, keep one, and encode it with the tail margin the polar chantier established. Opus perceptibly deforms the last samples of an encoded stream — its transform window has no context past end-of-file — which produced a measurable click at the loop seam until `LOOP_END_S` was made to loop BEFORE the damaged zone:

```bash
ffmpeg -i apps/lab/public/sfx/_cascade.wav -c:a libopus -b:a 96k apps/lab/public/sfx/cascade.ogg
rm apps/lab/public/sfx/_cascade.wav
```

Note the encoded duration; `LOOP_END_S.cascade` goes about 0.5 s below it.

- [ ] **Step 2: Write the failing test**

There is no test harness for WebAudio in this app — `core/audio.ts` is verified on screen, like the rest of the lab's sound. What IS testable is that the roar is not accidentally reachable as a zone soundscape. Append to `apps/lab/test/waterfall-placement.test.ts`:

```ts
import { ZONES } from "../src/settings.js";

describe("the roar is a held sound, not a zone soundscape", () => {
  // `cascade` borrows the loop infrastructure the way `glisse` does — created once, silent by
  // default, driven frame by frame by its own setter. If a zone ever named it as its `nappe`,
  // `setAmbience` would raise it to full level regardless of distance and the fall would roar
  // across the whole island.
  it("no zone names the roar as its soundscape", () => {
    for (const zone of ZONES) expect(zone.nappe).not.toBe("cascade");
  });
});
```

- [ ] **Step 3: Run the test to verify it passes**

```bash
npm test -w @lindocara/lab -- waterfall-placement
```

Expected: PASS. This one is a guard rail, not a red-then-green cycle — it must hold before and after.

- [ ] **Step 4: Add the loop and its setter**

In `apps/lab/src/core/audio.ts`, add `"cascade"` to the `BoucleKey` union, then:

```ts
  // The waterfall's roar (Task 4 of the waterfall chantier): NOT a zone soundscape — a held sound
  // whose gain follows the hero's distance to the nearest drop, driven by `setCascadeDistance`
  // below. It borrows this loop infrastructure rather than inventing a second one, exactly as
  // `glisse` does: `demarrerBoucles` creates it once, silent, because `ambiance` never takes the
  // value "cascade".
  cascade: "/sfx/cascade.ogg",
```

In `NIVEAUX`:

```ts
  // The ceiling at zero distance. Below the polar bed (0.42) on purpose: standing at the foot of
  // the falls should not drown the zone's own theme.
  cascade: 0.55,
```

In `LOOP_END_S` — replace `19.5` with the real encoded duration minus ~0.5 s:

```ts
  cascade: 19.5,
```

Beside `PORTEE_FEU`:

```ts
// Beyond this, the falls are inaudible. Wider than the fire's 13: a waterfall carries much further
// than a campfire, and the hero should hear it while still swimming toward the island.
const PORTEE_CASCADE = 22;
```

And beside `setFireDistance`:

```ts
/**
 * The waterfall's roar, by distance — the same shape as `setFireDistance` above, with its own
 * range. Squared falloff, so the sound builds late and fast as you approach rather than sitting at
 * half volume across the whole bay.
 */
export function setCascadeDistance(d: number): void {
  const cascade = boucles.cascade;
  if (!cascade || !ctx) return;
  const v = Math.max(0, 1 - d / PORTEE_CASCADE) ** 2;
  cascade.gain.gain.setTargetAtTime(NIVEAUX.cascade * v, ctx.currentTime, 0.15);
}
```

- [ ] **Step 5: Drive it from the frame loop**

In `apps/lab/src/boot.ts`, beside the existing `setFireDistance` call:

```ts
  // The falls are heard from the NEAREST drop, not from the island's centre: walking up the
  // terraces should keep the roar close rather than fading it as you leave the middle.
  let nearestFall = Number.POSITIVE_INFINITY;
  for (const w of waterfalls) {
    nearestFall = Math.min(nearestFall, hero.position.distanceTo(w.impact));
  }
  setCascadeDistance(nearestFall);
```

Add `setCascadeDistance` to the existing `./core/audio.js` import list.

- [ ] **Step 6: Check it on screen**

```bash
npm run lab
```

Swim toward the west island: the roar should begin faintly mid-crossing and build as you approach. Walk up the terraces — it should stay loud, not fade. Walk away east — it should die out well before the main island.

- [ ] **Step 7: Commit**

```bash
git add apps/lab/src/core/audio.ts apps/lab/src/boot.ts apps/lab/public/sfx/cascade.ogg apps/lab/test/waterfall-placement.test.ts
git commit -m "feat(lab): the waterfall's roar, gained by distance"
```

---

### Task 5: The falls zone

Its own soundscape and its own theme, fading in while the hero is still swimming — the lesson `ZONE_POLAIRE` encodes, with the ordering pinned by a test rather than by a comment.

**Files:**
- Modify: `apps/lab/src/settings.ts` (`ZONE_FALLS`, `ZONES`)
- Modify: `apps/lab/src/core/audio.ts` (`BoucleKey`, `BOUCLES`, `NIVEAUX`, `LOOP_END_S`, `MUSIQUE`)
- Modify: `apps/lab/test/zone-precede-matiere.test.ts`
- Assets: `apps/lab/public/sfx/amb-falls.ogg`, `apps/lab/public/music/falls.ogg`

**Interfaces:**
- Consumes: `WEST` and `WEST_REACH_MAX` from Task 1.
- Produces: `ZONE_FALLS: Zone`, inserted into `ZONES` before `ZONE_LARGE`.

- [ ] **Step 1: Write the failing test**

Append to `apps/lab/test/zone-precede-matiere.test.ts`:

```ts
import { ZONE_FALLS, ZONE_LARGE, ZONES } from "../src/settings.js";
import { WEST_REACH_MAX } from "../src/world/island.js";

describe("the falls ambience precedes the shore", () => {
  // Same invariant as the polar zone's above, on the west island: the zone must be wider than the
  // island's widest shoreline reach, so the soundscape and the theme install themselves WHILE the
  // hero is still swimming rather than on the frame their foot lands. Both real symbols are
  // imported rather than their values copied, so this reddens if the relation breaks — not merely
  // if a number changes.
  it("ZONE_FALLS.rayon stays strictly wider than the island's shoreline", () => {
    expect(ZONE_FALLS.rayon).toBeGreaterThan(WEST_REACH_MAX);
  });

  it("ZONE_FALLS comes before the catch-all, whose infinite radius would swallow it", () => {
    expect(ZONES.indexOf(ZONE_FALLS)).toBeLessThan(ZONES.indexOf(ZONE_LARGE));
  });

  it("the catch-all stays last", () => {
    expect(ZONES[ZONES.length - 1]).toBe(ZONE_LARGE);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -w @lindocara/lab -- zone-precede-matiere
```

Expected: FAIL — `ZONE_FALLS` is not exported.

- [ ] **Step 3: Generate the two assets**

The ambience bed — wet stone and dripping, meant to sit UNDER the roar without fighting it:

```bash
python3 studio/studio.py sfx --prompt "a damp rocky gorge, water dripping on stone, distant birds, gentle wind through a narrow valley" --duration 20 --seed 42 --variants 3 --out apps/lab/public/sfx/_amb-falls.wav
```

The theme. `--no-theme` is deliberate for a quiet cue: the art direction injection pushes toward heroic instrumentation, which is wrong for a piece that has to sit beneath falling water:

```bash
python3 studio/studio.py music --prompt "calm valley beneath a waterfall, soft strings, sparse harp, slow and open, fading out at the end" --duration 60 --seed 42 --no-theme --out apps/lab/public/music/_falls.wav
```

Judge the variants, keep one of each, encode both with the tail margin, and delete the raws:

```bash
ffmpeg -i apps/lab/public/sfx/_amb-falls.wav -c:a libopus -b:a 96k apps/lab/public/sfx/amb-falls.ogg
ffmpeg -i apps/lab/public/music/_falls.wav -c:a libopus -b:a 128k apps/lab/public/music/falls.ogg
rm apps/lab/public/sfx/_amb-falls.wav apps/lab/public/music/_falls.wav
```

Prefer a take whose ending fades out **on its own** — that is what makes the thirty-second pause `MUSIQUE_PAUSE` imposes afterwards indistinguishable from the piece simply ending, which is the judgement the polar theme was picked on.

- [ ] **Step 4: Declare the zone**

In `apps/lab/src/settings.ts`, after `ZONE_POLAIRE`:

```ts
/** The falls zone, around the west island (`WEST`). Its radius runs past the island's widest
 *  shoreline (`WEST_REACH_MAX`, `world/island.ts`) so the theme and the soundscape install
 *  themselves DURING the swim, before the first step ashore — the same reason `ZONE_POLAIRE` is
 *  `NORD.r + 3`, and `test/zone-precede-matiere.test.ts` pins both relations.
 *
 *  `souffle: 1`, deliberately: the doubled breath drain belongs to the polar chantier's icy water,
 *  and there is no reason this water is crueller than the open sea. */
export const ZONE_FALLS: Zone = {
  nom: "falls",
  centre: [WEST.x, WEST.z],
  rayon: WEST.r + 3,
  musique: "falls",
  nappe: "falls",
  souffle: 1,
};
```

Update `ZONES` — the order IS the priority, and the infinite-radius catch-all must stay last:

```ts
export const ZONES: readonly Zone[] = [ZONE_POLAIRE, ZONE_FALLS, ZONE_LARGE];
```

- [ ] **Step 5: Register the soundscape and the theme**

In `apps/lab/src/core/audio.ts`, add `"falls"` to the `BoucleKey` union, then in `BOUCLES`:

```ts
  // The falls zone's soundscape (Task 5): damp stone and dripping, written to sit UNDER the roar
  // (`cascade` above) rather than compete with it. Distinct from the roar in every way that
  // matters — this one is a zone `nappe` raised by `setAmbience`, that one is a held sound gained
  // by distance.
  falls: "/sfx/amb-falls.ogg",
```

In `NIVEAUX`:

```ts
  falls: 0.38,
```

In `LOOP_END_S` — the real encoded duration minus ~0.5 s:

```ts
  falls: 19.5,
```

In `MUSIQUE`:

```ts
  // The falls theme (Task 5), generated with `--no-theme`: the art direction injection pushes
  // toward heroic instrumentation, which is exactly wrong for a piece meant to sit beneath falling
  // water. Picked, like the polar theme, for an ending that fades out on its own — that is what
  // makes `MUSIQUE_PAUSE`'s thirty seconds of silence read as the piece ending rather than being
  // cut off.
  falls: "/music/falls.ogg",
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
npm test -w @lindocara/lab -- zone-precede-matiere
```

Expected: PASS, all three cases.

- [ ] **Step 7: Check it on screen**

```bash
npm run lab
```

Swim west. The soundscape and the theme should both change **before** you reach the shore, and the polar zone must still behave exactly as it did — swim north afterwards and confirm nothing regressed there. Leaving the zone should fade the theme out rather than cut it, and re-entering within a few seconds should resume rather than restart.

- [ ] **Step 8: Commit**

```bash
git add apps/lab/src/settings.ts apps/lab/src/core/audio.ts apps/lab/test/zone-precede-matiere.test.ts apps/lab/public/sfx/amb-falls.ogg apps/lab/public/music/falls.ogg
git commit -m "feat(lab): the falls zone, its soundscape and its theme"
```

---

### Task 6: Mist, spray and low fog

Two recycled particle pools and one fog channel. No allocation during play — the discipline every pool in the lab already follows.

**Files:**
- Create: `apps/lab/src/world/waterfall-fx.ts`
- Modify: `apps/lab/src/settings.ts` (`MIST`, `SPRAY`, `FALLS_FOG`)
- Modify: `apps/lab/src/boot.ts` (build the fx, update them, drive the fog, change `updateCamera`'s zone parameter)

**Interfaces:**
- Consumes: `Waterfall.impact` (Task 3), `ZONE_FALLS` (Task 5).
- Produces: `createWaterfallFx(ctx: Hd2dContext, impacts: readonly THREE.Vector3[]): WaterfallFx`, with `interface WaterfallFx { group: THREE.Group; update(dt: number, active: boolean): void }`.

- [ ] **Step 1: Add the settings**

In `apps/lab/src/settings.ts`, after `VAPEUR_SOURCE`:

```ts
/** The mist rising off each landing (Task 6 of the waterfall chantier) — the hot spring's recycled
 *  puff pool (`VAPEUR_SOURCE`, `world/props.ts`), retuned: denser, wider, faster-rising, and cool
 *  instead of warm. Same machine, no allocation during play. */
export interface MistSettings {
  /** Size of the recycled pool — never an allocation mid-game. */
  count: number;
  /** Lifetime of one puff, seconds. */
  vie: number;
  /** World height of a puff. */
  taille: number;
  /** Radius of the disc around the impact point where a puff can be born. */
  rayon: number;
  /** Rise speed, units per second. */
  montee: number;
  /** End-of-life expansion factor (0 = original size at the end, 1 = doubled). */
  expansion: number;
  /** Opacity at emission; falls linearly to 0 afterwards. */
  opaciteInitiale: number;
  /** Seconds between two puffs, per impact point. Continuous — a fall does not stop falling. */
  emission: number;
}
export const MIST: MistSettings = {
  count: 26,
  vie: 3.2,
  taille: 0.85,
  rayon: 0.55,
  montee: 0.8,
  expansion: 2.2,
  opaciteInitiale: 0.42,
  emission: 0.12,
};

/** The spray bursting where a sheet strikes its basin (Task 6): short-lived, fast, low. Where the
 *  mist above drifts upward and lingers, this is the hard scatter at the point of impact — the two
 *  read as one phenomenon only because they share an origin, not a pool. */
export interface SpraySettings {
  count: number;
  vie: number;
  taille: number;
  /** Horizontal launch speed, units per second. */
  vitesse: number;
  /** Upward launch speed, units per second. */
  montee: number;
  /** Downward acceleration, units per second squared. */
  gravite: number;
  opaciteInitiale: number;
  emission: number;
}
export const SPRAY: SpraySettings = {
  count: 34,
  vie: 0.75,
  taille: 0.16,
  vitesse: 1.4,
  montee: 1.9,
  gravite: 5.5,
  opaciteInitiale: 0.8,
  emission: 0.05,
};

/** The low fog that hangs in the falls zone (Task 6). Rides the SAME `fogPulse` channel the
 *  blizzard uses (`BLIZZARD`) — a second contribution, not a second mechanism — but with its own
 *  period and depth: this one breathes slowly and shallowly, where a blizzard gusts. The two zones
 *  are dozens of units apart and never both active. */
export const FALLS_FOG = {
  /** Seconds to settle in / lift when entering or leaving the zone. */
  fade: 2,
  /** Period of one full breath, seconds. */
  periode: 14,
  /** Maximum fraction by which the fog's reach (`fog.far`) closes at the peak. */
  intensite: 0.22,
};
```

- [ ] **Step 2: Write the fx module**

Create `apps/lab/src/world/waterfall-fx.ts`:

```ts
import { makeBillboard, type Billboard } from "@lindocara/hd2d/billboard.js";
import type { Hd2dContext } from "@lindocara/hd2d/context.js";
import * as THREE from "three";
import { MIST, SPRAY } from "../settings.js";

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
   *  the way the snowfall is gated on `enPolaire` in the frame loop. */
  update(dt: number, active: boolean): void;
}

/**
 * The mist and the spray of every drop, as two recycled pools shared across all impact points.
 * Pools are shared rather than one per fall because the total is what costs — three separate
 * 26-puff pools would be three times the billboards for the same visible density, since the hero
 * is never close enough to see all three landings at full strength at once.
 */
export function createWaterfallFx(
  ctx: Hd2dContext,
  impacts: readonly THREE.Vector3[],
): WaterfallFx {
  const group = new THREE.Group();

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

  let mistNext = 0;
  let sprayNext = 0;
  let mistTimer = 0;
  let sprayTimer = 0;
  let impactNext = 0;

  // Deterministic angle sequence rather than `Math.random()`: this file is lab content and not
  // bound by `@lindocara/engine`'s purity rule, but a fixed sequence still makes a screenshot
  // reproducible, which is worth more here than true randomness nobody can see.
  let phase = 0;
  const nextAngle = (): number => {
    phase = (phase + 2.399963) % (Math.PI * 2); // golden angle: even coverage, no clumping
    return phase;
  };

  function emitMist(at: THREE.Vector3): void {
    const p = mist[mistNext];
    if (!p) return;
    mistNext = (mistNext + 1) % MIST.count;
    const a = nextAngle();
    const r = MIST.rayon * (0.3 + 0.7 * ((phase / (Math.PI * 2)) % 1));
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
    update(dt, active) {
      group.visible = active;
      if (!active) return;

      mistTimer -= dt;
      sprayTimer -= dt;
      // Round-robin across impact points rather than emitting at all three every tick: one shared
      // pool, so the emission budget is shared too.
      if (mistTimer <= 0 || sprayTimer <= 0) {
        const at = impacts[impactNext % impacts.length];
        if (at) {
          if (mistTimer <= 0) {
            emitMist(at);
            mistTimer = MIST.emission;
          }
          if (sprayTimer <= 0) {
            emitSpray(at);
            sprayTimer = SPRAY.emission;
          }
        }
        impactNext = (impactNext + 1) % Math.max(1, impacts.length);
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
    },
  };
}
```

- [ ] **Step 3: Wire it into the scene**

In `apps/lab/src/boot.ts`, after the waterfalls block:

```ts
const waterfallFx = createWaterfallFx(
  ctx,
  waterfalls.map((w) => w.impact),
);
scene.add(waterfallFx.group);
```

Add the import:

```ts
import { createWaterfallFx } from "./world/waterfall-fx.js";
```

- [ ] **Step 4: Add the zone flag and the fog**

In the `frame()` function, beside the existing `enPolaire`:

```ts
  const enCascade = zone === ZONE_FALLS;
```

Beside `fogPulseAmount`:

```ts
  const fallsFogCible = enCascade ? 1 : 0;
  fallsFogAmount += (fallsFogCible - fallsFogAmount) * (1 - Math.exp(-dt / FALLS_FOG.fade));
```

Beside the other particle updates:

```ts
  waterfallFx.update(dt, enCascade);
```

Declare the new accumulator beside `auroraAmount`/`fogPulseAmount`:

```ts
// The falls zone's own low fog, on its own fade — a second contribution to the same `fog.far`
// multiplier the blizzard drives, never a second mechanism. The two zones are dozens of units
// apart and are never both non-zero.
let fallsFogAmount = 0;
```

Change `updateCamera`'s last parameter from `enPolaire: boolean` to `zone: Zone`, and derive both flags inside it — this is what stops the signature growing a boolean every time a zone is added:

```ts
function updateCamera(
  dt: number,
  cmd: InputSample,
  move: { x: number; z: number },
  t: number,
  zone: Zone,
): void {
  const enPolaire = zone === ZONE_POLAIRE;
```

Then, at the `pulse` line inside it, add the falls' own contribution:

```ts
  const pulse = Math.min(1, mood.value.fogPulse + fogPulseAmount) * rafale * BLIZZARD.intensite;
  // The falls' own slow breath, on its own period — multiplied rather than summed, so neither zone
  // can push `fog.far` negative no matter how the two are retuned.
  const respire =
    0.5 + 0.5 * Math.sin(((t / FALLS_FOG.periode) % 1) * Math.PI * 2);
  const pulseFalls = fallsFogAmount * respire * FALLS_FOG.intensite;
  fog.far = mood.value.fog.far * k ** CAMERA.fogFar * (1 - pulse) * (1 - pulseFalls);
```

Update the call site in `frame()`:

```ts
  updateCamera(dt, cmd, move, elapsed, zone);
```

Add `FALLS_FOG`, `MIST`, `SPRAY` and `ZONE_FALLS` to the `./settings.js` import list.

- [ ] **Step 5: Run the full lab suite**

```bash
npm test -w @lindocara/lab && npm run typecheck:lab
```

Expected: PASS. The `updateCamera` signature change is exactly the kind of edit `typecheck` exists to catch if a call site was missed.

- [ ] **Step 6: Check it on screen**

```bash
npm run lab
```

Mist should rise off each landing and drift; spray should burst at the impact points; the distance should close slightly and breathe while you are in the zone. Leave the zone and confirm the pools stop drawing entirely — `group.visible` false, not merely invisible puffs. Then swim north and confirm the blizzard's own fog pulse still behaves exactly as before. Confirm 60 fps.

- [ ] **Step 7: Commit**

```bash
git add apps/lab/src/world/waterfall-fx.ts apps/lab/src/settings.ts apps/lab/src/boot.ts
git commit -m "feat(lab): mist, spray and low fog at the falls"
```

---

### Task 7: The rainbow

An additive arc in the mist, gated to daytime and to the zone — the same shape as the aurora's gating, mirrored across the day/night line.

**Files:**
- Modify: `apps/lab/src/world/waterfall-fx.ts` (add the arc)
- Modify: `apps/lab/src/settings.ts` (`RAINBOW`)
- Modify: `apps/lab/src/boot.ts` (pass the daylight gate)

**Interfaces:**
- Consumes: `WaterfallFx` from Task 6.
- Produces: `WaterfallFx.update(dt: number, active: boolean, daylight: number): void` — the third parameter is 0..1, and Task 6's two-argument call sites must be updated.

- [ ] **Step 1: Add the settings**

In `apps/lab/src/settings.ts`, after `FALLS_FOG`:

```ts
/** The rainbow in the main drop's mist (Task 7 of the waterfall chantier). Procedural, not a
 *  generated asset: a spectrum arc is a gradient, and a canvas one can be tuned by eye in the
 *  browser instead of regenerated. Gated to DAYTIME and to the zone, mirroring `applyAurora`'s
 *  night-and-polar gate across the day/night line. */
export const RAINBOW = {
  /** Seconds to fade in / out when the gate opens or closes. */
  fade: 2.5,
  /** World radius of the arc. */
  rayon: 3.2,
  /** Thickness of the band, world units. */
  epaisseur: 0.9,
  /** Peak opacity. Deliberately low — a rainbow that reads clearly is a rainbow that reads fake. */
  opacite: 0.3,
  /** How far the arc's brightness swings as the sun drifts (`SUN_DRIFT`), 0..1: a rainbow depends
   *  on where the sun stands, and one that never changes betrays that nothing is being computed. */
  sunSwing: 0.55,
};
```

- [ ] **Step 2: Add the arc**

In `apps/lab/src/world/waterfall-fx.ts`, add the import of `RAINBOW` and, before the `return`, build the arc:

```ts
  // --- the rainbow ------------------------------------------------------------------------------
  // A half annulus with a spectrum painted along its radial axis, drawn additively so it lightens
  // the mist rather than covering it. Anchored to the WIDEST drop (the middle one, which throws the
  // most mist), not to the island centre: a rainbow lives in spray, not in air.
  const widest = impacts[Math.min(1, impacts.length - 1)] ?? new THREE.Vector3();

  const arcCanvas = document.createElement("canvas");
  arcCanvas.width = 8;
  arcCanvas.height = 64;
  const acx = arcCanvas.getContext("2d");
  if (!acx) throw new Error("2D context unavailable");
  const spectrum = acx.createLinearGradient(0, 0, 0, 64);
  spectrum.addColorStop(0.0, "rgba(255,255,255,0)");
  spectrum.addColorStop(0.15, "rgba(148,90,220,0.55)");
  spectrum.addColorStop(0.35, "rgba(80,150,235,0.7)");
  spectrum.addColorStop(0.55, "rgba(110,215,140,0.7)");
  spectrum.addColorStop(0.75, "rgba(250,225,110,0.7)");
  spectrum.addColorStop(0.9, "rgba(240,120,90,0.5)");
  spectrum.addColorStop(1.0, "rgba(255,255,255,0)");
  acx.fillStyle = spectrum;
  acx.fillRect(0, 0, 8, 64);
  const arcTexture = new THREE.CanvasTexture(arcCanvas);

  const arcGeometry = new THREE.RingGeometry(
    RAINBOW.rayon,
    RAINBOW.rayon + RAINBOW.epaisseur,
    48,
    1,
    0,
    Math.PI,
  );
  const arcMaterial = new THREE.MeshBasicMaterial({
    map: arcTexture,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const arc = new THREE.Mesh(arcGeometry, arcMaterial);
  // Standing upright, facing east down the valley the falls run into — the direction the hero
  // approaches from, which is the only direction it needs to read from.
  arc.position.set(widest.x + 1.6, widest.y, widest.z);
  arc.rotation.y = Math.PI / 2;
  group.add(arc);

  let rainbowAmount = 0;
```

Change the returned `update` signature and add the arc's own fade at the end of its body:

```ts
    update(dt, active, daylight) {
      group.visible = active;
      if (!active) return;
      // ... existing mist and spray bodies unchanged ...

      // The rainbow's own fade, independent of the zone's: entering at night must not pop an arc
      // into a dark sky the moment dawn arrives, and `MOOD_FADE` knows nothing about where the
      // hero is standing. Same two-gate shape as `applyAurora`, mirrored across day and night.
      rainbowAmount += (daylight - rainbowAmount) * (1 - Math.exp(-dt / RAINBOW.fade));
      arcMaterial.opacity = RAINBOW.opacite * rainbowAmount;
    },
```

Update the interface:

```ts
export interface WaterfallFx {
  group: THREE.Group;
  /** `active` is the zone gate; `daylight` (0..1) is the rainbow's own — an arc belongs to
   *  sunlight, and the two gates fade independently because the hero's position and the hour move
   *  on unrelated clocks. */
  update(dt: number, active: boolean, daylight: number): void;
}
```

- [ ] **Step 3: Drive the daylight gate and the sun swing**

In `apps/lab/src/boot.ts`, replace the Task 6 call:

```ts
  // Daylight gate for the rainbow, times the sun's own drift: `SUN_DRIFT` already swings the
  // azimuth ±22° over 96 s, and a rainbow that ignored where the sun stands would betray that
  // nothing is being computed.
  const solaire = 0.5 + 0.5 * Math.sin((elapsed / SUN_DRIFT.period) * Math.PI * 2);
  const daylight =
    mood.name === "day" ? 1 - RAINBOW.sunSwing + RAINBOW.sunSwing * solaire : 0;
  waterfallFx.update(dt, enCascade, daylight);
```

Add `RAINBOW` to the `./settings.js` import list (`SUN_DRIFT` is already imported).

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck:lab && npm test -w @lindocara/lab
```

Expected: PASS.

- [ ] **Step 5: Check it on screen**

```bash
npm run lab
```

Stand east of the main drop by day: a faint arc should sit in the mist and slowly brighten and dim as the sun drifts. Press `N` for night: it should fade out rather than blink off. Leave the zone: gone. Confirm it reads as *faint* — if it is obviously a rainbow, lower `RAINBOW.opacite` until it is not.

- [ ] **Step 6: Commit**

```bash
git add apps/lab/src/world/waterfall-fx.ts apps/lab/src/settings.ts apps/lab/src/boot.ts
git commit -m "feat(lab): a rainbow in the falls' mist, gated to daylight"
```

---

## Self-Review

**Spec coverage.** Every section of the spec maps to a task: the island and its measured placement → Task 1; the terraced mountain and the rock render band → Task 1; the falling sheet as authored-not-derived render code in `hd2d` → Task 2; basins, plunge rings, the three-drop chain, the summit spring pool and the shoreline spill → Task 3; the distance-driven roar → Task 4; `ZONE_FALLS`, its bed and its theme, with the swim-before-shore ordering pinned → Task 5; mist, spray and low fog → Task 6; the rainbow → Task 7. The spec's "what this deliberately does not do" list is honoured: no swimmable water at altitude (Task 3's basin docstring says why), no summit content beyond the spring pool, no stairs, no `WORLD.size` change, no wet-rock material and no `@lindocara/engine` edit.

**Type consistency.** `createWaterfallSheet` / `WaterfallSheetOptions` / `WaterfallSheet` (Task 2) are consumed unchanged by `createWaterfall` / `WaterfallOptions` / `Waterfall` (Task 3). `Waterfall.impact` is produced in Task 3 and consumed in Tasks 4, 6 and 7. `WaterfallFx.update` gains its third parameter in Task 7, and Task 7 explicitly updates Task 6's call site. `WEST_REACH_MAX` is produced in Task 1 and consumed in Task 5.

**Two things an implementer must not skip:**

- **Re-bake the map in Task 1** (`npm run build:map -w @lindocara/lab`) and commit `public/maps/ile.json` with it. It is the only task that changes what `build-map.ts` serialises, and nothing fails loudly if it is missed — the dev server just keeps loading the old four-island map, and the new island simply is not there.
- **Read "Before you start: a concurrent refactor" above.** A pre-existing typecheck failure in `apps/lab` is expected until that other work lands, and it is not yours.
