import {
  blankMap,
  croppedForSave,
  toMapData,
  toSaveInput,
} from "@lindocara/editor/game/editor-state.js";
import {
  generateProceduralMap,
  PROCEDURAL_MAP_COMPLEXITIES,
  PROCEDURAL_MAP_GENRES,
  PROCEDURAL_MAP_SIZES,
  type ProceduralMapOptions,
} from "@lindocara/editor/game/procedural-map.js";
import { nativeHarvestProfileForAsset } from "@lindocara/engine/harvest-presets.js";
import { compileAuthoredMap } from "@lindocara/engine/hd2d/authored-map.js";
import { parseMapData, sameElementSlot } from "@lindocara/engine/map-data.js";
import { parseMapEvents } from "@lindocara/engine/map-events.js";
import { MAP_MAX_COLS, MAP_MAX_ROWS, MAP_OCEAN_MARGIN } from "@lindocara/engine/map-limits.js";
import { nativeHarvestEvents } from "@lindocara/engine/native-harvest.js";
import {
  BODY_RADIUS,
  canStand,
  zoneTerrainFromHeightfield,
} from "@lindocara/engine/terrain-access.js";
import { EMPTY_TILE } from "@lindocara/engine/tileset.js";
import {
  type EditorAssetId,
  editorAsset,
  LINDOCARA_RUNNER_ASSET_IDS,
} from "@lindocara/engine/tiny-swords-catalog.js";
import { describe, expect, it } from "vitest";

const BASE_OPTIONS: ProceduralMapOptions = {
  genre: "forest",
  complexity: "balanced",
  size: "standard",
  seed: "LINDOCARA-42",
};

function isForbiddenGeneratedResource(assetId: string): boolean {
  const profile = nativeHarvestProfileForAsset(assetId as EditorAssetId);
  return (
    /stump|gold/i.test(assetId) ||
    (/meat/i.test(assetId) && !/sheep/i.test(assetId)) ||
    profile?.resource === "gold" ||
    (profile?.resource === "meat" && !/sheep/i.test(assetId))
  );
}

function runnerGroundDistance(map: ReturnType<typeof croppedForSave>): number {
  const layer = map.layers[0];
  const finish = map.events.find((event) =>
    event.pages.some((page) => page.commands.some((command) => command.t === "endAdventure")),
  );
  if (!layer || !finish) return -1;
  const startIndex = map.spawn.row * layer.cols + map.spawn.col;
  const finishIndex = finish.row * layer.cols + finish.col;
  const distances = new Array<number>(layer.ids.length).fill(-1);
  const queue = [startIndex];
  distances[startIndex] = 0;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const currentIndex: number | undefined = queue[cursor];
    if (currentIndex === undefined || currentIndex === finishIndex) break;
    const col: number = currentIndex % layer.cols;
    const row: number = Math.floor(currentIndex / layer.cols);
    for (const [colOffset, rowOffset] of [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ] as const) {
      const nextCol: number = col + colOffset;
      const nextRow: number = row + rowOffset;
      if (nextCol < 0 || nextRow < 0 || nextCol >= layer.cols || nextRow >= layer.rows) continue;
      const next = nextRow * layer.cols + nextCol;
      if (distances[next] !== -1 || layer.ids[next] === EMPTY_TILE) continue;
      distances[next] = (distances[currentIndex] ?? -1) + 1;
      queue.push(next);
    }
  }
  return distances[finishIndex] ?? -1;
}

describe("procedural map authoring", () => {
  it("is deterministic and preserves the open map's shell settings", () => {
    const base = {
      ...blankMap("Moonwood", 20, 15),
      dayNightCycle: false,
      fixedLighting: "night-middle" as const,
    };
    const first = generateProceduralMap(base, BASE_OPTIONS);
    const second = generateProceduralMap(base, BASE_OPTIONS);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      name: "Moonwood",
      dayNightCycle: false,
      fixedLighting: "night-middle",
      spawn: { col: 128, row: 128 },
    });
    expect(first.layers).toHaveLength(3);
    expect(
      first.layers.every((layer) => layer.cols === MAP_MAX_COLS && layer.rows === MAP_MAX_ROWS),
    ).toBe(true);
  });

  it("builds playable structure, harvest scenery, landmarks and encounters", () => {
    const generated = generateProceduralMap(blankMap("Generated", 20, 15), BASE_OPTIONS);
    const saved = croppedForSave(generated);
    const heightfield = compileAuthoredMap(toMapData(saved), saved.events);
    const spawnIndex = saved.spawn.row * heightfield.size + saved.spawn.col;

    expect(heightfield.levels[spawnIndex]).not.toBeNull();
    expect(saved.spawn.col).toBeGreaterThanOrEqual(0);
    expect(saved.spawn.col).toBeLessThan(saved.layers[0]?.cols ?? 0);
    expect(saved.spawn.row).toBeGreaterThanOrEqual(0);
    expect(saved.spawn.row).toBeLessThan(saved.layers[0]?.rows ?? 0);
    expect(generated.events.some((event) => event.kind === "monster")).toBe(true);
    expect(generated.events.some((event) => event.kind === "npc")).toBe(true);
    expect(
      generated.events.some(
        (event) =>
          event.kind === "normal" &&
          event.pages.some((page) => page.commands.some((command) => command.t === "changeGold")),
      ),
    ).toBe(true);
    const harvestResources = new Set(
      nativeHarvestEvents(generated.elements).map((event) => event.harvestProfile?.resource),
    );
    expect(harvestResources).toEqual(new Set(["wood", "stone", "meat"]));
    expect(
      generated.elements.some((element) => isForbiddenGeneratedResource(element.assetId)),
    ).toBe(false);

    const category = (value: string): string | null => editorAsset(value)?.editor.category ?? null;
    const buildings = generated.elements.filter(
      (element) => category(element.assetId) === "buildings",
    );
    const bridges = generated.elements.filter((element) => category(element.assetId) === "bridges");
    const villagers = generated.events.filter((event) => event.kind === "npc");
    expect(buildings.length).toBeGreaterThanOrEqual(4);
    expect(bridges.length).toBeGreaterThanOrEqual(1);
    expect(generated.elements.some((element) => category(element.assetId) === "trees")).toBe(true);
    expect(generated.elements.some((element) => category(element.assetId) === "small-decor")).toBe(
      true,
    );
    expect(villagers.length).toBeGreaterThanOrEqual(1);
    expect(
      villagers.every(
        (villager) =>
          villager.pages[0]?.moveType === "custom" &&
          (villager.pages[0]?.moveRoute?.length ?? 0) >= 4,
      ),
    ).toBe(true);

    // A bridge deck is authored over actual water; its terrain override is what makes that river
    // crossing walkable in the compiled map.
    for (const bridge of bridges) {
      const asset = editorAsset(bridge.assetId);
      expect(asset?.editor.terrainOverride).toBe("walkable");
      for (const offset of asset?.editor.visualFootprint ?? []) {
        const index = (bridge.row + offset.row) * MAP_MAX_COLS + bridge.col + offset.col;
        expect(generated.layers[0]?.ids[index]).toBe(EMPTY_TILE);
      }
    }

    const hostileBuildings = buildings.filter((element) =>
      /goblin|buildings-(?:red|black)-buildings/i.test(element.assetId),
    );
    const monsters = generated.events.filter((event) => event.kind === "monster");
    expect(hostileBuildings.length).toBeGreaterThanOrEqual(1);
    expect(
      monsters.every((monster) =>
        hostileBuildings.some(
          (building) => Math.hypot(building.col - monster.col, building.row - monster.row) <= 8,
        ),
      ),
    ).toBe(true);
  });

  it("makes every size selectable and changes topology with genre and seed", () => {
    const savedAreas: number[] = [];
    for (const [size, dimensions] of Object.entries(PROCEDURAL_MAP_SIZES)) {
      const generated = generateProceduralMap(blankMap("Generated", 20, 15), {
        ...BASE_OPTIONS,
        size: size as keyof typeof PROCEDURAL_MAP_SIZES,
      });
      const saved = croppedForSave(generated);
      expect(generated.layers[0]).toMatchObject({ cols: MAP_MAX_COLS, rows: MAP_MAX_ROWS });
      expect(saved.layers[0]?.cols).toBeLessThanOrEqual(dimensions.cols + MAP_OCEAN_MARGIN * 2);
      expect(saved.layers[0]?.rows).toBeLessThanOrEqual(dimensions.rows + MAP_OCEAN_MARGIN * 2);
      savedAreas.push((saved.layers[0]?.cols ?? 0) * (saved.layers[0]?.rows ?? 0));
    }
    expect(savedAreas).toEqual([...savedAreas].sort((left, right) => left - right));

    const forest = generateProceduralMap(blankMap("Generated", 20, 15), BASE_OPTIONS);
    const archipelago = generateProceduralMap(blankMap("Generated", 20, 15), {
      ...BASE_OPTIONS,
      genre: "archipelago",
    });
    const anotherSeed = generateProceduralMap(blankMap("Generated", 20, 15), {
      ...BASE_OPTIONS,
      seed: "ANOTHER-SEED",
    });
    const waterCells = (map: typeof forest): number =>
      croppedForSave(map).layers[0]?.ids.filter((id) => id === EMPTY_TILE).length ?? 0;

    expect(waterCells(archipelago)).toBeGreaterThan(waterCells(forest));
    expect(croppedForSave(anotherSeed).layers[0]?.ids).not.toEqual(
      croppedForSave(forest).layers[0]?.ids,
    );
  });

  it("adds denser content only when requested", () => {
    const light = generateProceduralMap(blankMap("Generated", 20, 15), {
      ...BASE_OPTIONS,
      complexity: "light",
    });
    const dense = generateProceduralMap(blankMap("Generated", 20, 15), {
      ...BASE_OPTIONS,
      complexity: "dense",
    });

    expect(dense.elements.length).toBeGreaterThan(light.elements.length);
    expect(dense.events.length).toBeGreaterThanOrEqual(light.events.length);
  });

  it("builds a deterministic editable runner course", () => {
    const options: ProceduralMapOptions = {
      ...BASE_OPTIONS,
      genre: "runner",
      complexity: "dense",
    };
    const first = generateProceduralMap(blankMap("Escape", 20, 15), options);
    const second = generateProceduralMap(blankMap("Escape", 20, 15), options);

    expect(first).toEqual(second);
    expect(first.audio).toMatchObject({
      explorationProfile: "runner",
      combatProfile: "runner",
      bossProfile: "runner",
    });
    expect(
      first.elements.some((element) => element.assetId === LINDOCARA_RUNNER_ASSET_IDS.barricade),
    ).toBe(true);
    expect(first.events.some((event) => event.monsterPursuitMode === "relentless")).toBe(true);
    const runnerHeroSpeeds = Object.values(first.heroSettings?.classes ?? {}).map(
      (settings) => settings.stats.movementSpeed,
    );
    expect(runnerHeroSpeeds).toHaveLength(5);
    expect(new Set(runnerHeroSpeeds)).toEqual(new Set([7.15]));
    expect(
      first.events.some((event) =>
        event.pages.some((page) => page.commands.some((command) => command.t === "damage")),
      ),
    ).toBe(true);
    const trapElements = first.elements.filter(
      (element) => element.assetId === LINDOCARA_RUNNER_ASSET_IDS.spikeTrap,
    );
    const trapEvents = first.events.filter((event) =>
      event.pages.some((page) => page.commands.some((command) => command.t === "damage")),
    );
    expect(trapElements.length).toBeGreaterThan(0);
    expect(trapEvents).toHaveLength(trapElements.length);
    expect(
      trapEvents.every(
        (event) =>
          event.pages[0]?.graphicAssetId === null &&
          trapElements.some((element) => element.col === event.col && element.row === event.row),
      ),
    ).toBe(true);
    expect(
      first.events.some((event) =>
        event.pages.some((page) => page.commands.some((command) => command.t === "endAdventure")),
      ),
    ).toBe(true);
    const saved = croppedForSave(first);
    const compiled = compileAuthoredMap(toMapData(saved), saved.events);
    expect(compiled.ramps?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(compiled.ramps?.length ?? 0).toBeLessThanOrEqual(3);
    expect(compiled.ramps?.every((ramp) => ramp.lowLevel >= 0 && ramp.lowLevel < 5)).toBe(true);
    const groundLevels = compiled.levels.filter((level): level is number => level !== null);
    for (const level of [-2, 0, 1, 2, 5]) expect(groundLevels).toContain(level);
    expect(Math.min(...groundLevels)).toBe(-2);
    expect(Math.max(...groundLevels)).toBe(5);
    const shoreIndices = compiled.levels.flatMap((level, index) => {
      if (level === null) return [];
      const col = index % compiled.size;
      const row = Math.floor(index / compiled.size);
      if (col === 0 || row === 0 || col === compiled.size - 1 || row === compiled.size - 1) {
        return [];
      }
      const bordersSea = [index - compiled.size, index + 1, index + compiled.size, index - 1].some(
        (neighbour) => compiled.levels[neighbour] === null,
      );
      return bordersSea ? [index] : [];
    });
    expect(shoreIndices.length).toBeGreaterThan(0);
    expect(shoreIndices.every((index) => (compiled.levels[index] ?? -3) >= 2)).toBe(true);
    const shoreIndex = shoreIndices[0];
    expect(shoreIndex).toBeDefined();
    if (shoreIndex === undefined) throw new Error("runner shore is missing");
    const shoreTerrain = zoneTerrainFromHeightfield(compiled);
    const shoreCol = shoreIndex % compiled.size;
    const shoreRow = Math.floor(shoreIndex / compiled.size);
    expect(
      canStand(
        shoreTerrain,
        shoreCol + 0.5 - compiled.size / 2,
        shoreRow + 0.5 - compiled.size / 2,
        BODY_RADIUS,
        compiled.waterLevel,
      ),
    ).toBe(false);
    const runnerMonsters = first.events.filter((event) => event.kind === "monster");
    expect(runnerMonsters.length).toBeGreaterThanOrEqual(3);
    expect(
      runnerMonsters.every(
        (event) =>
          event.species === "war_pig" &&
          event.monsterOneHitKill === true &&
          event.monsterPursuitMode === "relentless" &&
          event.showMarker === false,
      ),
    ).toBe(true);
    expect(first.events.filter((event) => event.kind === "sea-guardian").length).toBeGreaterThan(0);
    const pickups = saved.events.filter((event) =>
      event.pages.some((page) => page.commands.some((command) => command.t === "movementEffect")),
    );
    expect(pickups.length).toBeGreaterThan(2);
    expect(pickups.every((event) => event.pages[0]?.optFloat === true)).toBe(true);
    expect(
      pickups.some((event) => compiled.levels[event.row * compiled.size + event.col] === null),
    ).toBe(true);
    expect(
      compiled.levels.some((level, index) => {
        if (level !== -2) return false;
        const col = index % compiled.size;
        const row = Math.floor(index / compiled.size);
        if (col === 0 || row === 0 || col === compiled.size - 1 || row === compiled.size - 1)
          return false;
        const neighbours = [index - compiled.size, index + 1, index + compiled.size, index - 1];
        return neighbours.some((neighbour) => (compiled.levels[neighbour] ?? -3) >= 3);
      }),
    ).toBe(true);
    expect(parseMapData(toSaveInput(first))).not.toBeNull();
  });

  it("makes the epic runner several times longer than the standard course", () => {
    const standard = croppedForSave(
      generateProceduralMap(blankMap("Standard runner", 20, 15), {
        ...BASE_OPTIONS,
        genre: "runner",
        complexity: "dense",
        size: "standard",
      }),
    );
    const epic = croppedForSave(
      generateProceduralMap(blankMap("Epic runner", 20, 15), {
        ...BASE_OPTIONS,
        genre: "runner",
        complexity: "dense",
        size: "epic",
      }),
    );
    const standardDistance = runnerGroundDistance(standard);
    const epicDistance = runnerGroundDistance(epic);
    expect(standardDistance).toBeGreaterThan(70);
    expect(epicDistance).toBeGreaterThan(450);
    expect(epicDistance).toBeGreaterThan(standardDistance * 4);
    expect(epic.events.length).toBeGreaterThan(standard.events.length * 4);
  });

  it("serializes every genre, size and density through the shared map parsers", () => {
    for (const genre of PROCEDURAL_MAP_GENRES) {
      for (const size of Object.keys(PROCEDURAL_MAP_SIZES) as Array<
        keyof typeof PROCEDURAL_MAP_SIZES
      >) {
        for (const complexity of PROCEDURAL_MAP_COMPLEXITIES) {
          for (const seed of ["EXHAUSTIVE", "LOGIC-CHECK"]) {
            const generated = generateProceduralMap(blankMap("Generated", 20, 15), {
              genre,
              size,
              complexity,
              seed,
            });
            const saved = toSaveInput(generated);
            const context = `${genre}/${size}/${complexity}/${seed}`;
            expect(parseMapData(saved), context).not.toBeNull();
            expect(parseMapEvents(saved.events, saved.cols, saved.rows), context).not.toBeNull();
            expect(
              generated.elements.some((element) => isForbiddenGeneratedResource(element.assetId)),
              context,
            ).toBe(false);
            if (genre === "runner") {
              expect(
                generated.events.some((event) => event.monsterPursuitMode === "relentless"),
                context,
              ).toBe(true);
              expect(
                generated.events
                  .filter((event) => event.kind === "monster")
                  .every((event) => event.species === "war_pig"),
                context,
              ).toBe(true);
              expect(
                generated.events.some((event) => event.kind === "sea-guardian"),
                context,
              ).toBe(true);
              expect(
                generated.elements.some(
                  (element) => element.assetId === LINDOCARA_RUNNER_ASSET_IDS.barricade,
                ),
                context,
              ).toBe(true);
            } else {
              expect(
                generated.elements.some(
                  (element) => editorAsset(element.assetId)?.editor.category === "buildings",
                ),
                context,
              ).toBe(true);
              expect(
                generated.elements.some(
                  (element) => editorAsset(element.assetId)?.editor.category === "bridges",
                ),
                context,
              ).toBe(true);
              for (const category of ["trees", "small-decor", "rocks"]) {
                expect(
                  generated.elements.some(
                    (element) => editorAsset(element.assetId)?.editor.category === category,
                  ),
                  `${context}/${category}`,
                ).toBe(true);
              }
              expect(
                generated.events.some((event) => event.kind === "monster"),
                context,
              ).toBe(true);
              expect(
                generated.events.some(
                  (event) =>
                    event.kind === "npc" &&
                    event.pages[0]?.moveType === "custom" &&
                    (event.pages[0]?.moveRoute?.length ?? 0) >= 4,
                ),
                context,
              ).toBe(true);
            }
            expect(
              generated.elements.some((element, index) =>
                generated.elements.slice(0, index).some((other) => sameElementSlot(other, element)),
              ),
            ).toBe(false);
          }
        }
      }
    }
  }, 10_000);
});
