import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseAdventureBundle } from "../src/adventure-bundle.js";
import { colliderIndexFrom } from "../src/collider.js";
import { isWalkable, type TerrainGeometry } from "../src/game.js";
import { bakeCollision, elementColliders, parseMapData } from "../src/map-data.js";
import type { MapEvent } from "../src/map-events.js";
import { PLAYER_SIZE } from "../src/simulation.js";
import { TILE_SIZE } from "../src/tilemap.js";

const BUNDLE_URL = new URL("../../../adventures/liin-adventure-ia.json", import.meta.url);

function eventCommands(event: MapEvent): unknown[] {
  const flattened: unknown[] = [];
  const visit = (commands: readonly Record<string, unknown>[]) => {
    for (const command of commands) {
      flattened.push(command);
      if (command.t === "if") {
        visit(command.then as readonly Record<string, unknown>[]);
        visit(command.else as readonly Record<string, unknown>[]);
      } else if (command.t === "choices") {
        for (const option of command.options as { body: readonly Record<string, unknown>[] }[]) {
          visit(option.body);
        }
      } else if (command.t === "loop") {
        visit(command.body as readonly Record<string, unknown>[]);
      }
    }
  };
  for (const page of event.pages) visit(page.commands as readonly Record<string, unknown>[]);
  return flattened;
}

function reachableCells(
  map: NonNullable<ReturnType<typeof parseMapData>>,
  starts: readonly { col: number; row: number }[],
): Set<string> {
  const geometry: TerrainGeometry = {
    width: map.cols * TILE_SIZE,
    height: map.rows * TILE_SIZE,
    obstacles: [],
    spawnPoints: [],
    safeZone: null,
    tiles: bakeCollision(map),
    colliders: colliderIndexFrom(elementColliders(map.elements), map.cols, map.rows),
  };
  const key = (col: number, row: number) => `${col},${row}`;
  const walkable = (col: number, row: number) =>
    isWalkable(
      { x: col * TILE_SIZE + TILE_SIZE / 2, y: row * TILE_SIZE + TILE_SIZE / 2 },
      PLAYER_SIZE,
      geometry,
    );
  const seen = new Set<string>();
  const queue: { col: number; row: number }[] = [];
  for (const start of starts) {
    if (!walkable(start.col, start.row)) continue;
    seen.add(key(start.col, start.row));
    queue.push(start);
  }
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    if (!current) continue;
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const col = current.col + dc;
      const row = current.row + dr;
      const cell = key(col, row);
      if (
        col < 0 ||
        row < 0 ||
        col >= map.cols ||
        row >= map.rows ||
        seen.has(cell) ||
        !walkable(col, row)
      )
        continue;
      seen.add(cell);
      queue.push({ col, row });
    }
  }
  return seen;
}

describe("Liin Adventure IA portable bundle", () => {
  it("is complete, connected and traversable from beginning to end", () => {
    const bundle = parseAdventureBundle(JSON.parse(readFileSync(BUNDLE_URL, "utf8")));
    expect(bundle).not.toBeNull();
    if (!bundle) return;

    expect(bundle.adventure.title).toBe("Liin Adventure IA");
    expect(bundle.maps).toHaveLength(5);
    expect(bundle.graph.links).toHaveLength(9);
    expect(bundle.adventure.registry.quests).toHaveLength(10);
    expect(bundle.adventure.registry.quests?.slice(0, 5).map((quest) => quest.id)).toEqual([
      "0001",
      "0002",
      "0003",
      "0004",
      "0005",
    ]);
    expect(bundle.adventure.registry.quests?.slice(5).map((quest) => quest.id)).toEqual([
      "0006",
      "0007",
      "0008",
      "0009",
      "0010",
    ]);

    const events = new Map(
      bundle.maps.flatMap((map) => map.events.map((event) => [event.id, { map, event }] as const)),
    );
    const spawns = bundle.maps.flatMap((map) =>
      map.events.filter((event) => event.kind === "spawn").map((event) => ({ map, event })),
    );
    expect(spawns).toHaveLength(1);
    expect(spawns[0]?.map.id).toBe(bundle.maps[0]?.id);

    for (const link of bundle.graph.links) {
      const source = events.get(link.exitId);
      expect(source?.map.id).toBe(link.mapId);
      expect(source?.event.kind).toBe("exit");
      if (link.dest !== "end") {
        const destination = events.get(link.dest.entryId);
        expect(destination?.map.id).toBe(link.dest.mapId);
        expect(destination?.event.kind).toBe("entry");
      }
    }

    for (const map of bundle.maps) {
      expect(map.cols, map.name).toBeGreaterThanOrEqual(60);
      expect(map.rows, map.name).toBeGreaterThanOrEqual(45);
      expect(map.cols * map.rows, map.name).toBeGreaterThanOrEqual(20 * 15 * 9);
      const parsed = parseMapData({
        ...map,
        markers: { entries: [], exits: [], monsterSpawns: [] },
      });
      expect(parsed, map.name).not.toBeNull();
      if (!parsed) continue;
      const starts = map.events
        .filter((event) => event.kind === "spawn" || event.kind === "entry")
        .map(({ col, row }) => ({ col, row }));
      const reachable = reachableCells(parsed, starts.length > 0 ? starts : [map.spawn]);
      for (const event of map.events.filter((event) =>
        ["entry", "exit", "monster", "normal"].includes(event.kind),
      )) {
        const nearest = [...reachable]
          .map((cell) => {
            const [col = 0, row = 0] = cell.split(",").map(Number);
            return { cell, distance: Math.abs(col - event.col) + Math.abs(row - event.row) };
          })
          .sort((left, right) => left.distance - right.distance)[0];
        expect(
          reachable.has(`${event.col},${event.row}`),
          `${map.name}: ${event.name}; nearest walkable cell ${nearest?.cell ?? "none"}`,
        ).toBe(true);
      }
      expect(reachable.size).toBeGreaterThanOrEqual(Math.floor(map.cols * map.rows * 0.55));
      if (map.name.includes("Sanctuaire")) {
        expect(
          bakeCollision(parsed).kinds.filter((kind) => kind === "ramp").length,
        ).toBeGreaterThan(1);
      }
    }

    const teleports = bundle.maps.flatMap((map) =>
      map.events.flatMap((event) =>
        eventCommands(event).filter(
          (command): command is { t: "teleport"; mapId: string; col: number; row: number } =>
            typeof command === "object" &&
            command !== null &&
            (command as { t?: unknown }).t === "teleport",
        ),
      ),
    );
    expect(teleports).toHaveLength(0);
    for (const teleport of teleports) {
      const destination = bundle.maps.find((map) => map.id === teleport.mapId);
      expect(destination).toBeDefined();
      const parsed = destination
        ? parseMapData({
            ...destination,
            markers: { entries: [], exits: [], monsterSpawns: [] },
          })
        : null;
      expect(parsed).not.toBeNull();
      if (!parsed) continue;
      const geometry: TerrainGeometry = {
        width: parsed.cols * TILE_SIZE,
        height: parsed.rows * TILE_SIZE,
        obstacles: [],
        spawnPoints: [],
        safeZone: null,
        tiles: bakeCollision(parsed),
        colliders: colliderIndexFrom(elementColliders(parsed.elements), parsed.cols, parsed.rows),
      };
      expect(
        isWalkable(
          {
            x: teleport.col * TILE_SIZE + TILE_SIZE / 2,
            y: teleport.row * TILE_SIZE + TILE_SIZE / 2,
          },
          PLAYER_SIZE,
          geometry,
        ),
      ).toBe(true);
    }

    const bosses = bundle.maps.map((map) =>
      map.events.find((event) => event.kind === "monster" && event.monsterRank === "boss"),
    );
    expect(bosses.every(Boolean)).toBe(true);
    expect(bosses.map((boss) => boss?.monsterMaxHp)).toEqual([900, 1300, 1800, 2400, 3600]);
    expect(new Set(bosses.map((boss) => boss?.monsterSpecialTechnique))).toEqual(
      new Set(["ground_slam", "shadow_cone", "soul_drain"]),
    );

    const allCommands = bundle.maps.flatMap((map) =>
      map.events.flatMap((event) => eventCommands(event)),
    ) as Record<string, unknown>[];
    expect(allCommands.filter((command) => command.t === "choices").length).toBeGreaterThanOrEqual(
      4,
    );
    expect(
      new Set(
        allCommands
          .filter((command) => command.t === "completeActivity")
          .map((command) => command.activityId),
      ),
    ).toEqual(
      new Set([
        "pacte_des_racines",
        "cloches_noyees",
        "brasiers_du_serment",
        "destin_de_la_source",
      ]),
    );
    expect(
      bundle.maps.flatMap((map) =>
        map.events.flatMap((event) =>
          event.pages.filter((page) => page.trigger === "auto" || page.trigger === "parallel"),
        ),
      ),
    ).toHaveLength(0);

    for (const quest of bundle.adventure.registry.quests ?? []) {
      expect(quest.description.length, quest.title).toBeGreaterThan(80);
      expect(
        Object.values(quest.dialogues).reduce((length, text) => length + text.length, 0),
        quest.title,
      ).toBeGreaterThan(250);
      const references = [quest.giver, quest.turnInTarget].filter(
        (reference): reference is NonNullable<typeof reference> => reference !== null,
      );
      for (const objective of quest.objectives) {
        if (objective.type === "defeat-target" || objective.type === "interact") {
          references.push(objective.targetRef);
        } else if (objective.type === "use-item" && objective.context?.kind === "event") {
          references.push({
            mapId: objective.context.mapId,
            eventId: objective.context.eventId,
          });
        }
      }
      for (const reference of references) {
        expect(events.get(reference.eventId)?.map.id).toBe(reference.mapId);
      }
    }
  });
});
