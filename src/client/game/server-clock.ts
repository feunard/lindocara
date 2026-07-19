export interface ServerCombatTimeline {
  startedAt: number;
  impactAt: number;
  recoveryEndsAt: number;
}

export interface ServerClockSample {
  serverNow: number;
  localPerformanceNow: number;
}

/** Projects one absolute Worker timestamp onto the browser's monotonic performance clock. */
export function serverTimestampToLocal(serverTimestamp: number, sample: ServerClockSample): number {
  return sample.localPerformanceNow + (serverTimestamp - sample.serverNow);
}

/**
 * One session-owned source of Worker time for both cooldowns and combat presentation. The sample
 * is replaced atomically whenever a SelfState arrives, so browser wall-clock skew is irrelevant.
 */
export class ServerClock {
  #sample: ServerClockSample | null = null;

  sample(serverNow: number, localPerformanceNow: number): ServerClockSample | null {
    if (!Number.isFinite(serverNow) || !Number.isFinite(localPerformanceNow)) return this.#sample;
    this.#sample = { serverNow, localPerformanceNow };
    return this.#sample;
  }

  currentSample(): ServerClockSample | null {
    return this.#sample ? { ...this.#sample } : null;
  }

  toLocal(serverTimestamp: number): number | null {
    return this.#sample ? serverTimestampToLocal(serverTimestamp, this.#sample) : null;
  }

  /**
   * Before the first server sample, preserve only the action's relative timing from receipt. This
   * is deliberately not a guess that Date.now() matches the Worker clock.
   */
  combatTimeline(timeline: ServerCombatTimeline, receivedAt: number): ServerCombatTimeline {
    if (this.#sample) {
      return {
        startedAt: serverTimestampToLocal(timeline.startedAt, this.#sample),
        impactAt: serverTimestampToLocal(timeline.impactAt, this.#sample),
        recoveryEndsAt: serverTimestampToLocal(timeline.recoveryEndsAt, this.#sample),
      };
    }
    return {
      startedAt: receivedAt,
      impactAt: receivedAt + Math.max(0, timeline.impactAt - timeline.startedAt),
      recoveryEndsAt: receivedAt + Math.max(0, timeline.recoveryEndsAt - timeline.startedAt),
    };
  }
}
