/** Measures rendered frame intervals on the real clock, publishing at most twice a second. */
export function createFrameRateMeter() {
  let startedAt: number | null = null;
  let frames = 0;
  return {
    reset(): void {
      startedAt = null;
      frames = 0;
    },
    sample(nowMs: number): number | undefined {
      if (startedAt === null || nowMs < startedAt) {
        startedAt = nowMs;
        frames = 0;
        return;
      }
      frames++;
      const elapsed = nowMs - startedAt;
      if (elapsed < 500) return;
      const fps = Math.round((frames * 1000) / elapsed);
      startedAt = nowMs;
      frames = 0;
      return fps;
    },
  };
}
