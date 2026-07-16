# Sunken Isles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `sunken-isles`, a scenery-only archipelago zone, reached through an invisible portal in Verdant Reach's top-left.

**Architecture:** Terrain source rects live in `src/shared/zones/sunken-isles.ts` and are rasterised into generated tiles by a new `rasteriseIslands()` in `scripts/build-map.ts` — the inverse of the existing rasterisers, which default a cell to grass. The zone joins the existing `ZONES` catalogue, so the epoch-fenced handoff, routing and presence machinery carry it unchanged. The client gets a `ZONE_VISUALS` entry and, new, the zone's portals plumbed to the renderer so the grid toggle can draw their interaction radius.

**Tech Stack:** TypeScript, Vitest in workerd, PixiJS, Cloudflare Durable Objects.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-16-sunken-isles-design.md`.
- Scenery only: no monsters, quests or guards.
- `SOLID_COVERAGE` is 0.5 and `coverage()` is reused verbatim — the island rule must be the same rule that decides Verdant Reach's walls.
- Walkable cells form exactly one connected component. Detached islets are scenery.
- `INTERACTION_RANGE` is 92. Paired portals must be further apart than that, or they revolve.
- Tiles are generated. Never hand-edit `src/shared/zones/*-tiles.ts`; run `npm run map:build`.
- Every player-facing string lands in both `src/shared/i18n/en.ts` and `fr.ts`.
- `npm run check` (lint, typecheck, test, test:ui) must pass before each commit.
- Biome formats: run `npx biome check --write src/ test/ scripts/` before committing.

---

### Task 1: Terrain source and the island rasteriser

**Files:**
- Create: `src/shared/zones/sunken-isles.ts`
- Modify: `scripts/build-map.ts`
- Modify: `package.json:21` (the `map:check` file list)
- Create (generated): `src/shared/zones/sunken-isles-tiles.ts`
- Test: `test/tilemap-data.test.ts`

**Interfaces:**
- Consumes: `Rect`, `TerrainGeometry`, `WorldLandmark` from `src/shared/game.js`; `TileKind`, `TILE_SIZE` from `src/shared/tilemap.js`.
- Produces: `SUNKEN_ISLES_BOUNDS`, `SUNKEN_ISLES_LAND`, `SUNKEN_ISLES_FORESTS`, `SUNKEN_ISLES_LANDMARKS`, `SUNKEN_ISLES_SPAWNS`, `SUNKEN_ISLES_SAFE_ZONE`, `SUNKEN_ISLES_TERRAIN` from `src/shared/zones/sunken-isles.js`; `SUNKEN_ISLES_TILES` from `src/shared/zones/sunken-isles-tiles.js`.

The land rects below overlap on purpose — that is what welds them into one component. A–B share `x 768..896, y 576..832`; B–C share `x 1216..1280, y 576..896`; B–D share `x 1024..1280, y 832..896`; D–E share `x 1024..1408, y 1280..1344`.

- [ ] **Step 1: Write the terrain source**

Create `src/shared/zones/sunken-isles.ts`:

```ts
/**
 * Sunken Isles — an archipelago in the composition of Tiny Swords' promo art.
 *
 * Land is the positive space here: `scripts/build-map.ts` starts every cell as water and paints
 * these rects as grass, which is the inverse of how Verdant Reach is built. See
 * `docs/superpowers/specs/2026-07-16-sunken-isles-design.md`.
 *
 * The five land rects OVERLAP deliberately. There are no bridges in this game, so detached land is
 * land nobody can ever stand on: the walkable cells must be a single connected component, and the
 * overlaps are the necks that weld the lobes together. `test/zone-connectivity.test.ts` fails if a
 * lobe ever floats free. The islets below are detached ON PURPOSE and carry nothing — no spawn, no
 * portal, no building — precisely because they are unreachable.
 */
import type { Rect, TerrainGeometry, WorldLandmark } from "../game.js";
import type { Vec2, WorldBounds } from "../simulation.js";
import { SUNKEN_ISLES_TILES } from "./sunken-isles-tiles.js";

export const SUNKEN_ISLES_BOUNDS: WorldBounds = { width: 2560, height: 1920 };

/** The single walkable landmass, as overlapping lobes: NW castle, E village, S tower. */
export const SUNKEN_ISLES_LAND: readonly Rect[] = [
  { x: 192, y: 256, width: 704, height: 576 }, // A — NW lobe, the castle
  { x: 768, y: 576, width: 512, height: 320 }, // B — central spine, welds A/C/D
  { x: 1216, y: 384, width: 1152, height: 640 }, // C — E lobe, the village
  { x: 1024, y: 832, width: 384, height: 512 }, // D — S neck
  { x: 704, y: 1280, width: 1024, height: 448 }, // E — S lobe, the tower
] as const;

/** Scenery only — deliberately unreachable, exactly like the promo's rock islets. */
export const SUNKEN_ISLES_ISLETS: readonly Rect[] = [
  { x: 2176, y: 1408, width: 192, height: 128 },
  { x: 256, y: 1536, width: 192, height: 128 },
  { x: 2048, y: 128, width: 128, height: 128 },
] as const;

/** Treelines. Land you cannot walk into, drawn as trees standing on grass. */
export const SUNKEN_ISLES_FORESTS: readonly Rect[] = [
  { x: 192, y: 256, width: 704, height: 128 }, // A's northern treeline
  { x: 2048, y: 384, width: 320, height: 640 }, // C's eastern treeline
  { x: 704, y: 1600, width: 1024, height: 128 }, // E's southern treeline
] as const;

export const SUNKEN_ISLES_LANDMARKS: readonly WorldLandmark[] = [
  {
    id: "isles-castle",
    kind: "building",
    x: 448,
    y: 544,
    width: 224,
    height: 192,
    collider: { x: 384, y: 512, width: 192, height: 128 },
  },
  {
    id: "isles-house-north",
    kind: "building",
    x: 1520,
    y: 560,
    width: 160,
    height: 144,
    collider: { x: 1472, y: 544, width: 128, height: 96 },
  },
  {
    id: "isles-house-east",
    kind: "building",
    x: 1808,
    y: 704,
    width: 160,
    height: 144,
    collider: { x: 1760, y: 688, width: 128, height: 96 },
  },
  {
    id: "isles-house-south",
    kind: "building",
    x: 1616,
    y: 880,
    width: 160,
    height: 144,
    collider: { x: 1568, y: 864, width: 128, height: 96 },
  },
  {
    id: "isles-tower",
    kind: "building",
    x: 1120,
    y: 1424,
    width: 160,
    height: 192,
    collider: { x: 1072, y: 1408, width: 128, height: 128 },
  },
] as const;

/** On the central spine (rect B), which every lobe connects through. */
export const SUNKEN_ISLES_SPAWNS: readonly Vec2[] = [
  { x: 1050, y: 720 },
  { x: 986, y: 720 },
  { x: 1114, y: 720 },
] as const;

export const SUNKEN_ISLES_SAFE_ZONE: Rect = { x: 960, y: 576, width: 384, height: 320 };

export const SUNKEN_ISLES_TERRAIN: TerrainGeometry = {
  width: SUNKEN_ISLES_BOUNDS.width,
  height: SUNKEN_ISLES_BOUNDS.height,
  // `obstacles` is minimap-only legacy (see TerrainGeometry's doc comment); tiles are the collision
  // truth. Listing every water rect here would be a second, drifting description of the sea.
  obstacles: [],
  spawnPoints: SUNKEN_ISLES_SPAWNS,
  safeZone: SUNKEN_ISLES_SAFE_ZONE,
  tiles: SUNKEN_ISLES_TILES,
};
```

- [ ] **Step 2: Add the island rasteriser**

In `scripts/build-map.ts`, add after `rasteriseFlat` (around line 149):

```ts
/**
 * Land as the positive space.
 *
 * Both rasterisers above start a cell as `grass` and paint water onto it. An archipelago is the
 * inverse: the sea is the default and land is what gets painted. Same `coverage` and same
 * `SOLID_COVERAGE` as everything else — an island rasteriser with its own idea of what
 * "half-covered" means is two zones disagreeing about collision.
 */
function rasteriseIslands(
  bounds: WorldBounds,
  landRects: readonly Rect[],
  layers: readonly Layer[],
): { cols: number; rows: number; kinds: TileKind[] } {
  const cols = Math.ceil(bounds.width / TILE_SIZE);
  const rows = Math.ceil(bounds.height / TILE_SIZE);
  const kinds: TileKind[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (coverage(landRects, col, row) < SOLID_COVERAGE) {
        kinds.push("water");
        continue;
      }
      let kind: TileKind = "grass";
      for (const layer of layers) {
        if (coverage(layer.rects, col, row) >= SOLID_COVERAGE) kind = layer.kind;
      }
      kinds.push(kind);
    }
  }
  return { cols, rows, kinds };
}
```

Add the imports at the top of the file:

```ts
import {
  SUNKEN_ISLES_BOUNDS,
  SUNKEN_ISLES_FORESTS,
  SUNKEN_ISLES_ISLETS,
  SUNKEN_ISLES_LAND,
  SUNKEN_ISLES_LANDMARKS,
} from "../src/shared/zones/sunken-isles.js";
```

Add before the final `console.log` calls:

```ts
const isles = rasteriseIslands(
  SUNKEN_ISLES_BOUNDS,
  [...SUNKEN_ISLES_LAND, ...SUNKEN_ISLES_ISLETS],
  [
    { rects: SUNKEN_ISLES_FORESTS, kind: "forest" },
    ...SUNKEN_ISLES_LANDMARKS.flatMap((landmark): Layer[] =>
      landmark.collider === undefined ? [] : [{ rects: [landmark.collider], kind: "building" }],
    ),
  ],
);
writeFileSync(
  "src/shared/zones/sunken-isles-tiles.ts",
  emit("Sunken Isles", "SUNKEN_ISLES_TILES", isles),
);
```

And extend the final log:

```ts
console.log(
  `verdant-reach ${verdant.cols}x${verdant.rows}, mmo-test-zone ${test.cols}x${test.rows}, sunken-isles ${isles.cols}x${isles.rows}`,
);
```

**Circular import note:** `sunken-isles.ts` imports `SUNKEN_ISLES_TILES` from the file build-map generates. The generated file must exist before `build-map` can run. Create a stub first:

```bash
cat > src/shared/zones/sunken-isles-tiles.ts <<'EOF'
// GENERATED by scripts/build-map.ts — do not edit by hand. Run: npm run map:build

import type { TileMap } from "../tilemap.js";
import { decodeTileMap } from "../tilemap-codec.js";

const ROWS = ["#"];

/** Sunken Isles */
export const SUNKEN_ISLES_TILES: TileMap = decodeTileMap(ROWS);
EOF
```

- [ ] **Step 3: Guard the generated file in CI**

In `package.json`, change the `map:check` script to include the new file:

```json
"map:check": "npm run map:build && git diff --exit-code -- src/shared/zones/verdant-reach-tiles.ts src/shared/zones/mmo-test-zone-tiles.ts src/shared/zones/sunken-isles-tiles.ts",
```

A generated file outside this list is a file CI stops guarding.

- [ ] **Step 4: Generate and eyeball the map**

Run: `npm run map:build`

Expected: `... sunken-isles 40x30`

Then print it and confirm the shape is an archipelago with one connected landmass:

```bash
node -e "
const src = require('fs').readFileSync('src/shared/zones/sunken-isles-tiles.ts','utf8');
const rows = [...src.matchAll(/\"([.^TB#=]+)\",/g)].map(m => m[1]);
rows.forEach((r,i) => console.log(String(i).padStart(2), r));
"
```

Expected: a water border all round, one connected blob of `.`/`T`/`B`, three small detached blobs.

- [ ] **Step 5: Write the failing tile test**

Add to `test/tilemap-data.test.ts`:

```ts
describe("sunken isles tiles", () => {
  it("is a 40x30 map framed by water", () => {
    expect(SUNKEN_ISLES_TILES.cols).toBe(40);
    expect(SUNKEN_ISLES_TILES.rows).toBe(30);
    for (let col = 0; col < SUNKEN_ISLES_TILES.cols; col++) {
      expect(kindAt(SUNKEN_ISLES_TILES, col, 0)).toBe("water");
      expect(kindAt(SUNKEN_ISLES_TILES, col, SUNKEN_ISLES_TILES.rows - 1)).toBe("water");
    }
    for (let row = 0; row < SUNKEN_ISLES_TILES.rows; row++) {
      expect(kindAt(SUNKEN_ISLES_TILES, 0, row)).toBe("water");
      expect(kindAt(SUNKEN_ISLES_TILES, SUNKEN_ISLES_TILES.cols - 1, row)).toBe("water");
    }
  });

  it("is mostly sea — it is an archipelago, not a rectangle with ponds", () => {
    const water = SUNKEN_ISLES_TILES.kinds.filter((k) => k === "water").length;
    expect(water / SUNKEN_ISLES_TILES.kinds.length).toBeGreaterThan(0.35);
  });

  it("puts every spawn point on walkable land", () => {
    for (const spawn of SUNKEN_ISLES_SPAWNS) {
      expect(isWalkableBox(SUNKEN_ISLES_TILES, spawn, PLAYER_SIZE)).toBe(true);
    }
  });
});
```

Import at the top of the file: `SUNKEN_ISLES_TILES` from `../src/shared/zones/sunken-isles-tiles.js`, and `SUNKEN_ISLES_SPAWNS` from `../src/shared/zones/sunken-isles.js`. `kindAt`, `isWalkableBox` come from `../src/shared/tilemap.js` and `PLAYER_SIZE` from `../src/shared/simulation.js` — check which are already imported before adding.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run test/tilemap-data.test.ts`
Expected: PASS. If "mostly sea" fails, the land rects are too greedy — shrink them rather than lowering the threshold.

- [ ] **Step 7: Commit**

```bash
npx biome check --write src/ test/ scripts/
git add src/shared/zones/sunken-isles.ts src/shared/zones/sunken-isles-tiles.ts scripts/build-map.ts package.json test/tilemap-data.test.ts
git commit -m "Rasterise land as positive space for the Sunken Isles"
```

---

### Task 2: The zone catalogue entry and its portals

**Files:**
- Modify: `src/shared/zones.ts`
- Modify: `src/shared/i18n/en.ts`
- Modify: `src/shared/i18n/fr.ts`
- Test: `test/zones.test.ts` (create if absent), `test/zone-connectivity.test.ts`

**Interfaces:**
- Consumes: `SUNKEN_ISLES_TERRAIN` from Task 1.
- Produces: `ZoneId` gains `"sunken-isles"`; `ZONES["sunken-isles"]`.

- [ ] **Step 1: Add the zone and both portals**

In `src/shared/zones.ts`, extend the id union:

```ts
export type ZoneId = "verdant-reach" | "mmo-test-zone" | "sunken-isles";
```

Import the terrain:

```ts
import { SUNKEN_ISLES_TERRAIN } from "./zones/sunken-isles.js";
```

Add to `ZONES`:

```ts
  "sunken-isles": {
    id: "sunken-isles",
    nameKey: "zone.sunken_isles.name",
    type: "open_world",
    defaultInstanceId: "main",
    maxPlayers: 16,
    terrain: SUNKEN_ISLES_TERRAIN,
    quests: [],
    questSites: [],
    monsters: [],
    guards: [],
    portals: [
      {
        id: "sunken-isles-return",
        nameKey: "portal.sunken_isles_return",
        x: 1180,
        y: 700,
        destination: {
          zoneId: "verdant-reach",
          instanceId: "main",
          // Clear of the outbound gate at (256, 320) by 140px: arriving inside its
          // INTERACTION_RANGE (92) would make the two gates a revolving door.
          spawn: { x: 256, y: 460 },
        },
      },
    ],
    navigation: { ...DEFAULT_ZONE_NAVIGATION },
  },
```

And add the outbound gate to `verdant-reach`'s `portals` array, alongside the existing `verdant-gate`:

```ts
      {
        id: "sunken-isles-gate",
        nameKey: "portal.sunken_isles_gate",
        // Verdant Reach's top-left: columns 0-1 are the boundary wall and rows 1-2 a treeline, so
        // the first open grass is around (128, 192). This sits clear of both, and clear of the
        // building at columns 12-15.
        x: 256,
        y: 320,
        destination: {
          zoneId: "sunken-isles",
          instanceId: "main",
          spawn: { x: 1050, y: 720 },
        },
      },
```

- [ ] **Step 2: Add both dictionaries**

`src/shared/i18n/en.ts`, beside the existing `zone.mmo_test_zone.name`:

```ts
  "zone.sunken_isles.name": "Sunken Isles",
  "portal.sunken_isles_gate": "Isles crossing",
  "portal.sunken_isles_return": "Mainland crossing",
```

`src/shared/i18n/fr.ts`:

```ts
  "zone.sunken_isles.name": "Îles Englouties",
  "portal.sunken_isles_gate": "Passage des îles",
  "portal.sunken_isles_return": "Passage du continent",
```

- [ ] **Step 3: Write the failing catalogue test**

Add to `test/zones.test.ts` (create with the imports it needs if the file does not exist):

```ts
describe("sunken isles", () => {
  it("resolves as a room of its own", () => {
    const location = resolveZoneLocation("sunken-isles", "main");
    expect(location?.roomKey).toBe("sunken-isles:main");
    expect(location?.definition.maxPlayers).toBe(16);
  });

  it("carries no gameplay content — it is scenery", () => {
    const zone = ZONES["sunken-isles"];
    expect(zone.monsters).toEqual([]);
    expect(zone.quests).toEqual([]);
    expect(zone.guards).toEqual([]);
  });

  it("pairs its gate with a return that does not land you back inside the gate", () => {
    const gate = ZONES["verdant-reach"].portals.find((p) => p.id === "sunken-isles-gate");
    const back = ZONES["sunken-isles"].portals.find((p) => p.id === "sunken-isles-return");
    expect(gate).toBeDefined();
    expect(back).toBeDefined();
    if (!gate || !back) return;
    expect(gate.destination.zoneId).toBe("sunken-isles");
    expect(back.destination.zoneId).toBe("verdant-reach");
    // Arriving within INTERACTION_RANGE of the gate you just used is a revolving door.
    expect(pointDistance(back.destination.spawn, gate)).toBeGreaterThan(INTERACTION_RANGE);
    expect(pointDistance(gate.destination.spawn, back)).toBeGreaterThan(INTERACTION_RANGE);
  });
});
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/zones.test.ts test/zone-connectivity.test.ts test/i18n.test.ts`
Expected: PASS. `zone-connectivity` flood-fills `ZONES` and now covers the new zone — if it fails, a lobe is detached and the land rects need a wider neck. Do not fix it by moving the spawn.

- [ ] **Step 5: Assert the castle and tower are reachable**

In `test/zone-connectivity.test.ts`, add Sunken Isles targets — the return portal and each landmark — so "reachable" means the places that matter, not merely some land. Follow the file's existing `ConnectivityTarget` shape:

```ts
it("connects the isles spawn to its return portal and every building", () => {
  const zone = ZONES["sunken-isles"];
  const spawn = zone.terrain.spawnPoints[0];
  expect(spawn).toBeDefined();
  if (!spawn) return;
  const targets: ConnectivityTarget[] = [
    ...zone.portals.map((p) => ({ x: p.x, y: p.y, label: p.id })),
    ...SUNKEN_ISLES_LANDMARKS.map((l) => ({ x: l.x, y: l.y + 96, label: l.id })),
  ];
  for (const target of targets) {
    expect(reachable(zone.terrain.tiles, spawn, target)).toBe(true);
  }
});
```

Use whatever the file already calls its flood-fill helper rather than adding a second one; read the file first. A landmark's `x,y` is its sprite anchor and may sit inside its own collider, so aim at a point just below it.

- [ ] **Step 6: Run and commit**

```bash
npx vitest run test/zones.test.ts test/zone-connectivity.test.ts test/i18n.test.ts
npx biome check --write src/ test/
git add src/shared/zones.ts src/shared/i18n/en.ts src/shared/i18n/fr.ts test/zones.test.ts test/zone-connectivity.test.ts
git commit -m "Add the Sunken Isles to the zone catalogue, paired with Verdant Reach"
```

---

### Task 3: Client visuals

**Files:**
- Modify: `src/client/game/world-layout.ts`
- Test: `test/tile-render-props.test.ts` or `test/world-view.test.ts` (read both; use whichever already covers layout)

**Interfaces:**
- Consumes: `SUNKEN_ISLES_LANDMARKS` from Task 1; `ZoneId` from Task 2.
- Produces: `ZONE_VISUALS["sunken-isles"]`.

`ZONE_VISUALS` is a `Record<RuntimeZoneId, ZoneVisualConfig>`. Adding `"sunken-isles"` to `ZoneId` in Task 2 makes this record fail to typecheck until an entry exists — that is the compiler telling you the zone has no visuals, and is the intended order.

- [ ] **Step 1: Add a visual region for the biome tint**

`ZoneVisualConfig.worldRegions` drives `terrainTintsAt`, which tints land and water. An empty list means `terrainTintsAt` returns neutral white for both — which is exactly Tiny Swords' authored palette, and fine. Give the isles one region so the sea reads slightly cooler than the mainland's.

In `src/client/game/world-layout.ts`, extend the visual `ZoneId` union (the region names, not the runtime zones):

```ts
export type ZoneId =
  | "heartroot"
  | "old-road"
  | "sunwake"
  | "gloamwood"
  | "old-root-farm"
  | "moonmere"
  | "wayfarer-camp"
  | "elderfall"
  | "duskmire"
  | "sealed-gate"
  | "sunken-isles";
```

Add the region and the config:

```ts
const SUNKEN_ISLES_REGIONS: readonly ZoneDefinition[] = [
  {
    id: "sunken-isles",
    nameKey: "zone.sunken_isles.name",
    biome: "meadow",
    x: 1280,
    y: 960,
    radiusX: 1280,
    radiusY: 960,
    tint: 0xffffff,
  },
] as const;

const SUNKEN_ISLES_DECOR: readonly DecorRegion[] = [
  { id: "isles-castle-verge", theme: "meadow", x: 540, y: 620, radiusX: 300, radiusY: 220, count: 14, seed: 41 },
  { id: "isles-village-verge", theme: "village", x: 1790, y: 700, radiusX: 420, radiusY: 280, count: 18, seed: 42 },
  { id: "isles-tower-verge", theme: "forest", x: 1180, y: 1460, radiusX: 400, radiusY: 180, count: 16, seed: 43 },
] as const;
```

Then the entry:

```ts
  "sunken-isles": {
    safeZone: null,
    landmarks: SUNKEN_ISLES_LANDMARKS,
    roads: [],
    decorRegions: SUNKEN_ISLES_DECOR,
    pointsOfInterest: [],
    worldRegions: SUNKEN_ISLES_REGIONS,
    ambientRegions: [],
  },
```

Import `SUNKEN_ISLES_LANDMARKS` from `../../shared/zones/sunken-isles.js`.

`safeZone: null` because there are no guards to define one — the terrain's `safeZone` rect exists only to satisfy `TerrainGeometry`.

- [ ] **Step 2: Run the typecheck**

Run: `npm run typecheck`
Expected: clean. An error on `ZONE_VISUALS` means the entry is missing or a key is misspelled.

- [ ] **Step 3: Write the failing test**

```ts
it("gives every runtime zone its own visuals", () => {
  for (const zoneId of Object.keys(ZONES) as RuntimeZoneId[]) {
    expect(visualConfigFor(zoneId)).toBeDefined();
  }
});

it("draws no safe zone or roads on the isles — there are neither", () => {
  const config = visualConfigFor("sunken-isles");
  expect(config.safeZone).toBeNull();
  expect(config.roads).toEqual([]);
  expect(config.landmarks.length).toBeGreaterThan(0);
});
```

- [ ] **Step 4: Run and commit**

```bash
npx vitest run -c vitest.ui.config.ts
npm run check
npx biome check --write src/ test/
git add src/client/game/world-layout.ts test/
git commit -m "Give the Sunken Isles its buildings, decor and palette"
```

---

### Task 4: Portals are invisible until the grid is on

**Files:**
- Modify: `src/client/game/renderer.ts`
- Modify: `src/client/game/session.ts` (only if the portals are not already reaching `configureZone`)
- Test: `test/tile-render-props.test.ts`

**Interfaces:**
- Consumes: `WorldInfo.portals` (id, nameKey, x, y), already sent by `src/server/world.ts:409`.
- Produces: `Renderer.setPortals(portals)`.

Read `src/client/game/net.ts` and `session.ts` first to find where `welcome`'s `world` payload is handled and whether `portals` already survives parsing. `world.ts` sends them; the client currently ignores them.

- [ ] **Step 1: Store the zone's portals on the renderer**

In `renderer.ts`, beside the other private fields:

```ts
  #portals: readonly Vec2[] = [];
```

And a setter:

```ts
  /** The current zone's portals. Replaced wholesale on a zone change: a portal from the zone you
   *  left must never draw over the one you arrived in. */
  setPortals(portals: readonly Vec2[]): void {
    this.#portals = portals.map((portal) => ({ x: portal.x, y: portal.y }));
  }
```

Call `this.#portals = []` wherever the renderer already tears down a zone (see `#buildWorldFurniture`'s inverse, around `renderer.ts:835`).

- [ ] **Step 2: Draw them in the grid overlay**

Portals have no art of their own by design. The only way to see one is the grid toggle, and what it draws is the true `INTERACTION_RANGE` — the same distance `#interact` tests server-side, so the circle is the rule rather than a decoration.

At the end of `#drawGrid`, before the final `stroke`, append:

```ts
    for (const portal of this.#portals) {
      this.#gridOverlay.circle(portal.x, portal.y, INTERACTION_RANGE);
    }
```

That reuses the grid's own stroke. Import `INTERACTION_RANGE` from `../../shared/game.js`.

- [ ] **Step 3: Wire the welcome to the setter**

Wherever `session.ts` calls `renderer.configureZone(...)` from the welcome, add:

```ts
    renderer.setPortals(world.portals ?? []);
```

Read the surrounding code for the exact name of the welcome payload variable before editing.

- [ ] **Step 4: Write the failing test**

```ts
it("draws portals only when the grid is on", () => {
  // Assert through whatever seam this file already uses for renderer state; if there is none,
  // assert on the pure part instead: that setPortals stores a copy and an empty zone clears it.
  const renderer = makeRenderer();
  renderer.setPortals([{ x: 100, y: 100 }]);
  expect(renderer.diagnostics().portals).toBe(1);
  renderer.setPortals([]);
  expect(renderer.diagnostics().portals).toBe(0);
});
```

Add `portals: this.#portals.length` to `diagnostics()` in `renderer.ts` so this is observable — it sits beside the counters already there.

- [ ] **Step 5: Run and commit**

```bash
npm run check
npx biome check --write src/ test/
git add src/client/game/renderer.ts src/client/game/session.ts test/
git commit -m "Show portal interaction radius with the grid overlay"
```

---

### Task 5: The round trip, against a real Durable Object

**Files:**
- Test: `test/world.test.ts`

**Interfaces:**
- Consumes: everything above.

Read the existing `mmo-test-zone` handoff tests in this file first and follow them exactly. Do not mock the Durable Object; this suite opens real WebSockets against real workerd. Assert on *which* character ids are present, never how many — the world DO is a singleton across the file and a straggler from an earlier test must not fail this one.

- [ ] **Step 1: Write the failing handoff test**

```ts
it("carries a character to the Sunken Isles and back", async () => {
  // 1. connect in verdant-reach, walk to (256, 320), interact
  // 2. expect the socket to close with WS_CLOSE.ZONE_TRANSITION
  // 3. expect D1 to hold zone_id "sunken-isles" and the spawn (1050, 720), epoch incremented
  // 4. reconnect, interact at the return portal (1180, 700)
  // 5. expect D1 to hold zone_id "verdant-reach" at (256, 460)
  // Mirror the existing mmo-test-zone handoff test's structure and helpers verbatim.
});

it("refuses a save from the zone the character just left", async () => {
  // The source's epoch is stale after handoff: assert the row is unchanged and that
  // stale_character_save_rejected is the outcome. Mirror the existing stale-save test.
});
```

- [ ] **Step 2: Run**

Run: `npx vitest run test/world.test.ts`
Expected: PASS.

- [ ] **Step 3: Full gate**

Run: `npm run check && npm run map:check`
Expected: all green, and `map:check` produces no diff.

- [ ] **Step 4: Drive it in the real game**

Run `npm run dev`, walk to Verdant Reach's top-left, press E, and confirm you arrive in the isles; turn the grid on and confirm the portal circle; walk back. Tests do not tell you the island looks like the reference.

- [ ] **Step 5: Commit**

```bash
git add test/world.test.ts
git commit -m "Cover the Sunken Isles handoff round trip"
```

---

## Self-review

**Spec coverage:** identity/size → Task 1; third rasteriser → Task 1; connectivity → Tasks 1–2; portals + placement → Task 2; invisible portals + grid circle → Task 4; client visuals → Task 3; i18n → Task 2; tests → all; `map:check` → Task 1.

**Known softness:** Tasks 2 (Step 5), 4 (Step 4) and 5 (Step 1) describe tests against files whose exact helpers I have not read (`zone-connectivity.test.ts`'s flood-fill helper, `world.test.ts`'s handoff harness, the renderer test seam). Each says to read the file and follow its existing pattern rather than inventing one. That is deliberate — inventing a second flood-fill or a mocked DO would be worse than the indirection — but it means those steps need the implementer's judgement, not just transcription.
