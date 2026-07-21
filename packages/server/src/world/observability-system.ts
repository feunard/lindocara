import { TICK_HZ, TICK_MS } from "@lindocara/engine/simulation.js";

export const OBSERVABILITY_INTERVAL_TICKS = TICK_HZ * 20;

export interface RoomObservability {
  windowStartedAt: number;
  tickDurations: number[];
  ticksOverBudget: number;
  tickErrors: number;
  sentMessages: number;
  sentBytes: number;
  deltaMessages: number;
  deltaBytes: number;
  maxDeltaBytes: number;
  d1Saves: number;
  d1Errors: number;
  saturatedCommandQueues: number;
  oversizedFrames: number;
  malformedFrames: number;
  rateLimitedConnections: number;
  throttledResyncs: number;
  transitions: number;
  reconnections: number;
  navigationPathsBaseline: number;
  navigationNodesBaseline: number;
}

export interface RoomObservabilitySnapshot {
  event: "world_metrics";
  roomKey: string;
  windowMs: number;
  tick: {
    count: number;
    averageMs: number;
    p95Ms: number;
    maxMs: number;
    overBudget: number;
    errors: number;
    budgetMs: number;
  };
  room: { players: number; monsters: number; loot: number };
  network: {
    messages: number;
    bytes: number;
    averageDeltaBytes: number;
    maxDeltaBytes: number;
  };
  persistence: { saves: number; errors: number };
  security: {
    saturatedCommandQueues: number;
    oversizedFrames: number;
    malformedFrames: number;
    rateLimitedConnections: number;
    throttledResyncs: number;
  };
  navigation: { pathsCalculated: number; nodesExpanded: number };
  lifecycle: { transitions: number; reconnections: number };
}

export function createRoomObservability(now = Date.now()): RoomObservability {
  return {
    windowStartedAt: now,
    tickDurations: [],
    ticksOverBudget: 0,
    tickErrors: 0,
    sentMessages: 0,
    sentBytes: 0,
    deltaMessages: 0,
    deltaBytes: 0,
    maxDeltaBytes: 0,
    d1Saves: 0,
    d1Errors: 0,
    saturatedCommandQueues: 0,
    oversizedFrames: 0,
    malformedFrames: 0,
    rateLimitedConnections: 0,
    throttledResyncs: 0,
    transitions: 0,
    reconnections: 0,
    navigationPathsBaseline: 0,
    navigationNodesBaseline: 0,
  };
}

export function observeTick(metrics: RoomObservability, durationMs: number): void {
  metrics.tickDurations.push(durationMs);
  if (durationMs > TICK_MS) metrics.ticksOverBudget += 1;
}

export function observeSend(metrics: RoomObservability, bytes: number, isDelta: boolean): void {
  metrics.sentMessages += 1;
  metrics.sentBytes += bytes;
  if (!isDelta) return;
  metrics.deltaMessages += 1;
  metrics.deltaBytes += bytes;
  metrics.maxDeltaBytes = Math.max(metrics.maxDeltaBytes, bytes);
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

function percentile95(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const index = Math.min(ordered.length - 1, Math.ceil(ordered.length * 0.95) - 1);
  return ordered[index] ?? 0;
}

export function snapshotRoomObservability(
  metrics: RoomObservability,
  input: {
    now: number;
    roomKey: string;
    players: number;
    monsters: number;
    loot: number;
    navigationPaths: number;
    navigationNodes: number;
  },
): RoomObservabilitySnapshot {
  const samples = metrics.tickDurations;
  const totalTickMs = samples.reduce((sum, value) => sum + value, 0);
  const snapshot: RoomObservabilitySnapshot = {
    event: "world_metrics",
    roomKey: input.roomKey,
    windowMs: Math.max(0, input.now - metrics.windowStartedAt),
    tick: {
      count: samples.length,
      averageMs: rounded(samples.length === 0 ? 0 : totalTickMs / samples.length),
      p95Ms: rounded(percentile95(samples)),
      maxMs: rounded(samples.length === 0 ? 0 : Math.max(...samples)),
      overBudget: metrics.ticksOverBudget,
      errors: metrics.tickErrors,
      budgetMs: TICK_MS,
    },
    room: { players: input.players, monsters: input.monsters, loot: input.loot },
    network: {
      messages: metrics.sentMessages,
      bytes: metrics.sentBytes,
      averageDeltaBytes: rounded(
        metrics.deltaMessages === 0 ? 0 : metrics.deltaBytes / metrics.deltaMessages,
      ),
      maxDeltaBytes: metrics.maxDeltaBytes,
    },
    persistence: { saves: metrics.d1Saves, errors: metrics.d1Errors },
    security: {
      saturatedCommandQueues: metrics.saturatedCommandQueues,
      oversizedFrames: metrics.oversizedFrames,
      malformedFrames: metrics.malformedFrames,
      rateLimitedConnections: metrics.rateLimitedConnections,
      throttledResyncs: metrics.throttledResyncs,
    },
    navigation: {
      pathsCalculated: Math.max(0, input.navigationPaths - metrics.navigationPathsBaseline),
      nodesExpanded: Math.max(0, input.navigationNodes - metrics.navigationNodesBaseline),
    },
    lifecycle: { transitions: metrics.transitions, reconnections: metrics.reconnections },
  };

  metrics.windowStartedAt = input.now;
  metrics.tickDurations = [];
  metrics.ticksOverBudget = 0;
  metrics.tickErrors = 0;
  metrics.sentMessages = 0;
  metrics.sentBytes = 0;
  metrics.deltaMessages = 0;
  metrics.deltaBytes = 0;
  metrics.maxDeltaBytes = 0;
  metrics.d1Saves = 0;
  metrics.d1Errors = 0;
  metrics.saturatedCommandQueues = 0;
  metrics.oversizedFrames = 0;
  metrics.malformedFrames = 0;
  metrics.rateLimitedConnections = 0;
  metrics.throttledResyncs = 0;
  metrics.transitions = 0;
  metrics.reconnections = 0;
  metrics.navigationPathsBaseline = input.navigationPaths;
  metrics.navigationNodesBaseline = input.navigationNodes;
  return snapshot;
}
