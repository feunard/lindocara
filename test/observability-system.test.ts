import {
  createRoomObservability,
  observeSend,
  observeTick,
  snapshotRoomObservability,
} from "@lindocara/server/world/observability-system.js";
import { describe, expect, it } from "vitest";

describe("room observability aggregation", () => {
  it("summarizes a bounded window and resets counters", () => {
    const metrics = createRoomObservability(1_000);
    observeTick(metrics, 2);
    observeTick(metrics, 4);
    observeTick(metrics, 60);
    observeSend(metrics, 100, false);
    observeSend(metrics, 240, true);
    metrics.d1Saves = 2;
    metrics.saturatedCommandQueues = 1;
    metrics.transitions = 1;

    const first = snapshotRoomObservability(metrics, {
      now: 21_000,
      roomKey: "verdant-reach:main",
      players: 10,
      monsters: 12,
      loot: 3,
      navigationPaths: 8,
      navigationNodes: 120,
    });

    expect(first).toMatchObject({
      event: "world_metrics",
      windowMs: 20_000,
      tick: { count: 3, averageMs: 22, p95Ms: 60, maxMs: 60, overBudget: 1 },
      room: { players: 10, monsters: 12, loot: 3 },
      network: { messages: 2, bytes: 340, averageDeltaBytes: 240, maxDeltaBytes: 240 },
      persistence: { saves: 2, errors: 0 },
      navigation: { pathsCalculated: 8, nodesExpanded: 120 },
      lifecycle: { transitions: 1, reconnections: 0 },
    });

    const second = snapshotRoomObservability(metrics, {
      now: 41_000,
      roomKey: "verdant-reach:main",
      players: 0,
      monsters: 12,
      loot: 0,
      navigationPaths: 10,
      navigationNodes: 150,
    });
    expect(second.tick.count).toBe(0);
    expect(second.network.messages).toBe(0);
    expect(second.security.saturatedCommandQueues).toBe(0);
    expect(second.navigation).toEqual({ pathsCalculated: 2, nodesExpanded: 30 });
  });
});
