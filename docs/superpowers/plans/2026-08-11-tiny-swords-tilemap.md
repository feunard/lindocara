# Tiny Swords tilemap fidelity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the HD-2D mesher use every band the Tiny Swords terrain sheets carry — the
water-footed cliff face, foam at any waterline, and a real sloped ramp — and prove it with a
hand-authored showcase adventure playable in the game.

**Architecture:** All three rendering fixes land in `packages/hd2d/src/terrain/`, which the lab
witness and the game renderer both consume, so one change reaches both. The showcase map is a dev
script pair under the repo's root `scripts/`, modelled on the existing proving-map pair.

**Tech Stack:** TypeScript, three.js, Vitest (Node env for `hd2d`), `tsx` for dev scripts.

## Global Constraints

- Everything in English — code, comments, commit messages — EXCEPT identifiers and comments already
  French inside `packages/engine/src/hd2d/` and `packages/hd2d/src/`, which stay French by the
  standing decision in `packages/engine/CLAUDE.md`. Match the file you are editing.
- No `Math.random`, no clock reads in the map generator: regenerating twice must give the same map.
- Biome formats and lints; `noNonNullAssertion` is on — narrow, never `!`.
- No `vi.mock`. Tests drive the real functions.
- `packages/hd2d` depends on `three` only. Do not add an import from `engine`, `renderer` or `apps`.

---

### Task 1: The water-footed cliff face

**Files:**
- Modify: `packages/hd2d/src/terrain/atlas.ts` (the `TerrainAtlas` interface and its doc)
- Modify: `packages/hd2d/src/terrain/mesh.ts:248-296` (the wall loop)
- Modify: `apps/lab/src/boot.ts` (the `atlases` record)
- Modify: `packages/renderer/src/hd2d/scene.ts` (`terrainAtlases`)
- Test: `packages/hd2d/test/terrain-mesh.test.ts`

**Interfaces:**
- Produces: `TerrainAtlas.wallRowInWater?: number`.

- [ ] **Step 1: Write the failing tests**

In `terrain-mesh.test.ts`, the local `atlas()` helper gains `wallRowInWater: 5`. Add:

```ts
  it("prend la rangée de paroi à pied d'eau quand la falaise tombe dans le vide", () => {
    // Un seul îlot au palier 1 : ses quatre côtés donnent sur `null`, donc sur la mer.
    const built = meshTerrain(ctx(), fieldFrom([".1."]), { atlases: { herbe: atlas() }, levelHeight: 1 });
    const vs = wallV(built.group);
    // Rangée 5 sur 6 : v va de 1 - 6/6 = 0 à 1 - 5/6.
    expect(Math.max(...vs)).toBeLessThan(1 / 6 + 1e-3);
    built.dispose();
  });

  it("garde la rangée à pied de terre quand la falaise domine un voisin plus bas", () => {
    const built = meshTerrain(ctx(), fieldFrom(["10"]), { atlases: { herbe: atlas() }, levelHeight: 1 });
    const vs = wallV(built.group);
    // Rangée 4 : v va de 1 - 5/6 à 1 - 4/6.
    expect(Math.max(...vs)).toBeGreaterThan(1 / 6);
    built.dispose();
  });
```

with a helper that reads the V coordinates of every vertex whose Y varies (the wall quads):

```ts
/** Les V de toutes les faces verticales : un quad de paroi a deux Y distincts, un dessus un seul. */
function wallV(group: THREE.Group): number[] {
  const out: number[] = [];
  for (const child of group.children) {
    if (!(child instanceof THREE.Mesh)) continue;
    const pos = child.geometry.getAttribute("position");
    const uv = child.geometry.getAttribute("uv");
    for (let q = 0; q + 3 < pos.count; q += 4) {
      const ys = [0, 1, 2, 3].map((k) => pos.getY(q + k));
      if (Math.max(...ys) - Math.min(...ys) < 1e-6) continue;
      for (let k = 0; k < 4; k += 1) out.push(uv.getY(q + k));
    }
  }
  return out;
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @lindocara/hd2d -- terrain-mesh`
Expected: the void-facing test FAILS (row 4's V band, not row 5's).

- [ ] **Step 3: Add the field to `TerrainAtlas`**

In `atlas.ts`, add to the interface and correct the doc block, which currently claims row 5 is a
repeatable extension:

```ts
  /** La rangée de paroi dont le PIED touche la terre — petites touffes d'herbe à sa base. */
  wallRow: number;
  /**
   * La rangée de paroi dont le pied touche l'EAU — un feston d'écume blanche à sa base. Le pack en
   * dessine bien deux, l'une SOUS l'autre, et ce ne sont pas une bande et sa répétition : ce sont
   * deux variantes ALTERNATIVES, choisies par ce qui se trouve en bas de la falaise. Facultative :
   * la feuille de sable (10x4) n'a aucune bande de paroi, et le sable ne descend jamais.
   */
  wallRowInWater?: number;
```

- [ ] **Step 4: Choose the row per wall segment**

In `mesh.ts`, replace the single `tileUV(atlas, wallCol, atlas.wallRow)` call (around line 263) with:

```ts
        // Deux variantes de paroi, choisies par ce que la falaise touche EN BAS : le pied dans
        // l'eau porte un feston d'écume, le pied sur la terre de petites touffes. Un voisin sans
        // palier EST la mer (`levelAt` répond `null` hors grille comme sur l'eau), et c'est
        // exactement le côté que `wallDrop` fait descendre jusqu'en bas.
        const footInWater = field.levelAt(i + di, j + dj) === null;
        const wallRow = footInWater ? (atlas.wallRowInWater ?? atlas.wallRow) : atlas.wallRow;
        const w = tileUV(atlas, wallCol, wallRow);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -w @lindocara/hd2d -- terrain-mesh`
Expected: PASS.

- [ ] **Step 6: Wire both composition roots**

Add `wallRowInWater: 5` to every 9x6 atlas in `apps/lab/src/boot.ts` (`lvl0`, `lvl1`, `lvl2`,
`neige`, `glace`, `roche`) and in `packages/renderer/src/hd2d/scene.ts`'s `sheet()` helper — the
helper builds all of them, so set it there once and leave `sable` (10x4) to override it away by
passing `undefined`, or simpler: give `sheet()` a `wallRowInWater: 5` and let `sable` keep it
harmlessly, since sand never carries a wall (`wallDrop` never fires at level 0 facing water
… it does: level 0 facing water has drop 0 because `h - drop` with `h = 0`. Confirm by test rather
than by reasoning — see Step 7).

- [ ] **Step 7: Prove sand is unaffected**

```ts
  it("ne descend aucune paroi depuis le palier 0", () => {
    const built = meshTerrain(ctx(), fieldFrom([".0."]), { atlases: { herbe: atlas() }, levelHeight: 1 });
    expect(wallV(built.group)).toHaveLength(0);
    built.dispose();
  });
```

Run: `npm test -w @lindocara/hd2d -- terrain-mesh`
Expected: PASS. If it fails, level 0 does carry walls and `sable` must NOT receive
`wallRowInWater`.

- [ ] **Step 8: Typecheck and commit**

```bash
npm run typecheck:hd2d && npm run typecheck:renderer && npm run typecheck:lab
git add packages/hd2d apps/lab/src/boot.ts packages/renderer/src/hd2d/scene.ts
git commit -m "feat(terrain): draw the water-footed cliff face where a wall falls into the sea"
```

---

### Task 2: Foam at every waterline

**Files:**
- Modify: `packages/hd2d/src/terrain/foam.ts:62-72` (`foamPlacements`)
- Test: `packages/hd2d/test/foam.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: no signature change — `foamPlacements(field)` keeps returning `{i, j}[]`.

- [ ] **Step 1: Replace the test that pins the old behaviour**

`foam.test.ts` currently asserts the opposite of what we want. Replace the third test:

```ts
  it("pose une tache au pied d'une falaise qui tombe dans la mer", () => {
    // L'écume est le liseré de TOUT terrain qui touche l'eau, pas seulement du palier 0 : une
    // falaise qui plonge dans la mer en porte un, sinon sa base est un trait net posé sur l'eau.
    expect(foamPlacements(fieldFrom([".1."]))).toEqual([{ i: 1, j: 0 }]);
  });

  it("pose une tache quel que soit le palier du rivage", () => {
    expect(foamPlacements(fieldFrom(["2"]))).toEqual([{ i: 0, j: 0 }]);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w @lindocara/hd2d -- foam`
Expected: FAIL — `[]` received.

- [ ] **Step 3: Widen the placement rule**

In `foam.ts`, replace `if (field.levelAt(i, j) !== 0) continue;` with:

```ts
      // N'IMPORTE quel palier, pas seulement le 0 : la tache se pose au niveau de l'eau et le
      // volume de l'île la masque (la coque de paroi de `mesh.ts` ferme les découpes), donc seul
      // son débord dépasse au pied de la falaise — exactement le liseré voulu.
      if (field.levelAt(i, j) === null) continue;
```

and update the function's doc block, which says "seule une case de terre au palier 0 porte une
tache".

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -w @lindocara/hd2d -- foam`
Expected: PASS, all five tests.

- [ ] **Step 5: Commit**

```bash
git add packages/hd2d/src/terrain/foam.ts packages/hd2d/test/foam.test.ts
git commit -m "feat(terrain): foam at every waterline, not only at level 0"
```

---

### Task 3: Stairs as real sloped ground

**Files:**
- Modify: `packages/hd2d/src/terrain/atlas.ts` (receives the block-origin helpers)
- Modify: `packages/hd2d/src/terrain/mesh.ts` (loses them, imports them back)
- Rewrite: `packages/hd2d/src/terrain/stairs.ts`
- Modify: `packages/renderer/src/hd2d/scene.ts:337` and
  `packages/renderer/src/hd2d/visual-layer.ts:1231` (the two `meshStairs` callers)
- Modify: `packages/engine/src/hd2d/terrain-query.ts:16-18` (the `TerrainRamp` doc, which promises
  "discrete visible steps")
- Test: `packages/hd2d/test/terrain-stairs.test.ts` (rewritten)

**Interfaces:**
- Consumes: `TerrainAtlas` from Task 1, including `wallRowInWater`.
- Produces:
  - `atlas.ts`: `export const WATER_EDGE_COL = 0`, `export const CLIFF_EDGE_COL = 5`,
    `export function blockOrigin(atlas: TerrainAtlas): number | null`.
  - `stairs.ts`: `MeshStairsOptions { levelHeight: number; atlasFor(level: number): TerrainAtlas;
    color?: THREE.ColorRepresentation; opacity?: number; lift?: number }` — `atlas` and `steps` are
    gone. `meshStairs` keeps its `(ramps, options) => { group, dispose }` shape.

- [ ] **Step 1: Move the block-origin helpers into `atlas.ts`**

Cut `WATER_EDGE_COL`, `CLIFF_EDGE_COL` and `blockOrigin` out of `mesh.ts` into `atlas.ts`, exported,
keeping their comments. `mesh.ts` imports them back from `./atlas.js`. This is a pure move — run
`npm test -w @lindocara/hd2d` and commit it on its own so the rewrite below has a clean diff.

```bash
git commit -m "refactor(terrain): move the block-origin helpers beside TerrainAtlas"
```

- [ ] **Step 2: Write the failing test**

Replace the whole body of `terrain-stairs.test.ts`:

```ts
import { meshStairs } from "@lindocara/hd2d/terrain/stairs.js";
import type { TerrainAtlas } from "@lindocara/hd2d/terrain/atlas.js";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

function atlas(): TerrainAtlas {
  return {
    texture: new THREE.Texture(),
    cols: 9,
    rows: 6,
    block: "cliff-edge",
    wallRow: 4,
    wallRowInWater: 5,
    tilePx: 64,
  };
}

const RAMP = { x: -1, z: -1, width: 2, depth: 1, direction: "east", lowLevel: 1 } as const;

describe("meshStairs", () => {
  it("builds a continuous slope, not steps", () => {
    const built = meshStairs([RAMP], { levelHeight: 0.9, lift: 0, atlasFor: atlas });
    const meshes = built.group.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh);
    // One mesh for the surface and its cheeks, not one per tread.
    expect(meshes).toHaveLength(1);
    built.dispose();
  });

  it("agrees with the height rampSampleAt walks the hero up", () => {
    const levelHeight = 0.9;
    const built = meshStairs([RAMP], { levelHeight, lift: 0, atlasFor: atlas });
    const mesh = built.group.children[0];
    if (!(mesh instanceof THREE.Mesh)) throw new Error("expected the ramp mesh");
    const pos = mesh.geometry.getAttribute("position");
    // `east` climbs towards +x: the low edge sits at lowLevel, the high edge one level up.
    let lowY = Number.POSITIVE_INFINITY;
    let highY = Number.NEGATIVE_INFINITY;
    for (let v = 0; v < pos.count; v += 1) {
      if (Math.abs(pos.getX(v) - RAMP.x) < 1e-6) lowY = Math.min(lowY, pos.getY(v));
      if (Math.abs(pos.getX(v) - (RAMP.x + RAMP.width)) < 1e-6) highY = Math.max(highY, pos.getY(v));
    }
    expect(lowY).toBeCloseTo(RAMP.lowLevel * levelHeight, 6);
    expect(highY).toBeCloseTo((RAMP.lowLevel + 1) * levelHeight, 6);
    built.dispose();
  });

  it("climbs towards -x when the ramp faces west", () => {
    const built = meshStairs([{ ...RAMP, direction: "west" }], {
      levelHeight: 0.9,
      lift: 0,
      atlasFor: atlas,
    });
    const mesh = built.group.children[0];
    if (!(mesh instanceof THREE.Mesh)) throw new Error("expected the ramp mesh");
    const pos = mesh.geometry.getAttribute("position");
    let atLowX = Number.NEGATIVE_INFINITY;
    for (let v = 0; v < pos.count; v += 1) {
      if (Math.abs(pos.getX(v) - RAMP.x) < 1e-6) atLowX = Math.max(atLowX, pos.getY(v));
    }
    expect(atLowX).toBeCloseTo((RAMP.lowLevel + 1) * 0.9, 6);
    built.dispose();
  });

  it("asks for the atlas of the bank it climbs to", () => {
    const asked: number[] = [];
    const built = meshStairs([RAMP], {
      levelHeight: 0.9,
      atlasFor: (level) => {
        asked.push(level);
        return atlas();
      },
    });
    expect(asked).toEqual([RAMP.lowLevel + 1]);
    built.dispose();
  });

  it("releases its geometry on dispose", () => {
    const built = meshStairs([RAMP], { levelHeight: 0.9, atlasFor: atlas });
    built.dispose();
    expect(built.group.children).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -w @lindocara/hd2d -- terrain-stairs`
Expected: FAIL — `atlasFor` is not an option and the group holds eight meshes.

- [ ] **Step 4: Rewrite `stairs.ts`**

Build one `BufferGeometry` per ramp with a hand-rolled quad accumulator, exactly as `mesh.ts` does:

- **Top surface:** four corners at `(x, lowOrHighY, z)` / `(x + width, …, z)` and the same at
  `z + depth`. Y at a corner is `lerp(low, high, progress)` where `progress` is `0`/`1` per the
  `direction` convention `rampSampleAt` uses (`east` → `progress = along`, `west` → `1 - along`).
  UV: the plain fill tile, `tileUV(atlas, (blockOrigin(atlas) ?? 0) + 1, 1)`, stretched over the
  whole quad. Normal: the slope's own normal, `(∓levelHeight, width, 0)` normalised.
- **Two cheeks:** on the `z` side and the `z + depth` side, each a quad whose two lower vertices sit
  at the low level and whose upper edge follows the slope — degenerate at the low end, full height
  at the high end. UV from `tileUV(atlas, CLIFF_EDGE_COL + 1, atlas.wallRow)` (the middle of the
  land-footed run: a ramp's flank is always between two banks, never against the sea).
- **Vertex colour:** `tintAt(x, z)` times the wall-foot factor
  `1 - AO_WALL * (1 - min(1, (y - lowY) / AO_WALL_HEIGHT))`, both imported (`tintAt` from
  `./mesh.js`, the constants from `./field.js`).
- One `MeshLambertMaterial` per ramp with `map: atlas.texture`, `vertexColors: true`,
  `alphaTest: 0.5`, `side: THREE.DoubleSide`, `shadowSide: THREE.DoubleSide`, honouring `color` and
  `opacity`. `castShadow`/`receiveShadow` true when opaque. `lift` still raises the whole ramp.
- Delete `stairUvRect` and `mapTopUv`.

Update `tintAt`'s doc block in `mesh.ts`: it now has a second real consumer, not only the test.

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -w @lindocara/hd2d -- terrain-stairs`
Expected: PASS, all five.

- [ ] **Step 6: Update the three callers**

- `scene.ts:337`: replace `atlas: stairsAtlas` with
  `atlasFor: (level) => atlases[terrainAtlasKey("herbe", level)] ?? stairsAtlas`, and drop the
  now-misleading `stairsAtlas` error message about level 0 being "required".
- `visual-layer.ts:1231`: same closure over whatever atlas record that call site holds.
- `terrain-query.ts:16-18`: correct the `TerrainRamp` doc — the renderer builds a continuous slope
  now, not "discrete visible steps".

- [ ] **Step 7: Typecheck, test, commit**

```bash
npm run typecheck:hd2d && npm run typecheck:renderer && npm run typecheck:engine && npm run typecheck:lab
npm test -w @lindocara/hd2d
git add packages/hd2d packages/renderer packages/engine
git commit -m "feat(terrain): draw a ramp as real sloped ground instead of eight textured boxes"
```

---

### Task 4: The showcase map

**Files:**
- Create: `scripts/build-showcase-map.ts`
- Create: `scripts/seed-showcase-adventure.ts`
- Modify: `package.json` (two scripts)
- Test: `packages/hd2d/test/showcase-coverage.test.ts` — NO. The generator lives in `scripts/`,
  which no package's Vitest project covers. Coverage is asserted by the builder itself throwing,
  plus the ASCII preview. See Step 4.

**Interfaces:**
- Consumes: `MapData` from `@lindocara/engine/hd2d/map-data.js`; `TerrainRamp` from
  `@lindocara/engine/hd2d/terrain-query.js`.
- Produces: `export function buildShowcaseMap(): MapData` and
  `export function showcaseAscii(map: MapData): string`.

- [ ] **Step 1: Write the builder**

`scripts/build-showcase-map.ts` paints a fixed-size grid (48x48) cell by cell from a small set of
named regions, then derives `levels`/`materials`/`ramps`. No `Math.random`, no clock. Regions,
laid out left to right so a single camera sweep reads them all:

| Region | What it proves |
| --- | --- |
| the `edge16` garden | all sixteen variants: an isolated 1x1, a 1x3 column, a 3x1 row, a 3x3 block (four corners, four edges, one fill) |
| the beach | a sand strip meeting grass inland and the sea outward |
| the twin cliff | one level-1 plateau, dropping onto level-0 land on its west side and straight into the sea on its east — the two wall rows side by side |
| the mesa | a level-2 block over the level-1 plateau, for a two-level drop |
| the lake | a land-locked pocket of water inside level-0 ground |
| the ramps | one `east` ramp 0→1, one `west` ramp 1→2 |

- [ ] **Step 2: Make the coverage claim self-checking**

The builder ends with an assertion pass that recomputes, for every level-0 grass cell, the
`edge16` mask its neighbourhood produces, and throws if the sixteen masks are not all present:

```ts
/** The map's own acceptance test. A showcase that quietly stops covering a variant is worse than
 *  no showcase: it still looks fine, and the thing it was built to prove is gone. */
function assertEveryEdge16Variant(size: number, levels: readonly (number | null)[]): void {
  const at = (i: number, j: number): number | null =>
    i < 0 || j < 0 || i >= size || j >= size ? null : (levels[j * size + i] ?? null);
  const seen = new Set<number>();
  for (let j = 0; j < size; j += 1) {
    for (let i = 0; i < size; i += 1) {
      if (at(i, j) !== 0) continue;
      const same = (di: number, dj: number): number => (at(i + di, j + dj) === 0 ? 1 : 0);
      seen.add(same(0, -1) | (same(1, 0) << 1) | (same(0, 1) << 2) | (same(-1, 0) << 3));
    }
  }
  const missing = [...Array(16).keys()].filter((mask) => !seen.has(mask));
  if (missing.length > 0) {
    throw new Error(`showcase map misses edge16 variants: ${missing.join(", ")}`);
  }
}
```

- [ ] **Step 3: Write the ASCII preview**

`showcaseAscii(map)` renders one character per cell — `~` water, `.` sand, digits for grass levels,
`<`/`>` for a ramp's footprint — so the layout is reviewable before anything boots. The CLI prints
it on `--dry-run`.

- [ ] **Step 4: Run the builder dry and read the picture**

```bash
npx tsx scripts/build-showcase-map.ts --dry-run
```

Expected: the coverage assertion passes and the ASCII shows every region. **Look at it.** If a
region is not identifiable in the picture, the map does not showcase it.

- [ ] **Step 5: Write the seeder**

`scripts/seed-showcase-adventure.ts` is `seed-showcase-adventure`'s twin of
`seed-proving-adventure.ts` — same `ApiClient`, same `ensureAdventure`/`stampHeightfield`, same
remote gating — with `title: "Tiny Swords Tilemap Showcase"` and `username: "showcase-pilot"`.
Extract nothing: the two files are short and the duplication is deliberate in this repo's dev
scripts (see the header of `seed-proving-adventure.ts`).

- [ ] **Step 6: Add the npm scripts**

```json
    "map:showcase": "tsx scripts/build-showcase-map.ts",
    "adventure:showcase": "tsx scripts/seed-showcase-adventure.ts",
```

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck   # tsconfig.tooling.json covers scripts/
git add scripts package.json
git commit -m "feat(scripts): a showcase map that exercises every Tiny Swords terrain tile"
```

---

### Task 5: See it, then document it

**Files:**
- Modify: `docs/hd2d-rendering.md`
- Modify: `packages/hd2d/AGENTS.md`

- [ ] **Step 1: Boot and seed**

```bash
npm run dev
```

then, in another shell:

```bash
npm run adventure:showcase
```

- [ ] **Step 2: Look at it**

Use the `playwright-cli` skill against `http://localhost:5273`: log in as the seeded account, open
the showcase adventure, and screenshot the twin cliff (both wall rows in one frame), the two ramps,
the beach and the lake. Never the Claude-in-Chrome extension.

- [ ] **Step 3: Write down what the sheet holds**

Add the sheet-anatomy table from the spec to `docs/hd2d-rendering.md`, under a heading that names
the trap: rows 4 and 5 are alternatives chosen by what lies below the cliff, not a band and its
repeat. Add a short pointer in `packages/hd2d/AGENTS.md`.

- [ ] **Step 4: Full verification and commit**

```bash
npm run check
git add docs packages/hd2d/AGENTS.md
git commit -m "docs(hd2d): record what each band of the Tiny Swords terrain sheet is for"
```

---

## Self-review notes

- **Spec coverage:** T1 → Task 1; T2 → Task 2; T3 (including the per-level `atlasFor` added during
  spec review) → Task 3; T4 → Task 4; T5 → Task 5. The spec's "Risks" eye-check of the composed
  `neige`/`glace`/`roche` sheets happens in Task 5 Step 2.
- **Known open question, resolved by test not by argument:** Task 1 Step 6/7 — whether a level-0
  cell facing water carries a wall at all. `wallDrop` returns `h` facing the void, which is `0` at
  level 0, so it should not; Step 7 asserts it rather than trusting the reading.
- **Type consistency:** `atlasFor(level: number): TerrainAtlas` is used identically in Task 3's
  test, implementation and all three call sites. `wallRowInWater` is optional everywhere it appears.
