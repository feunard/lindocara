import { runRecoverableFrame } from "@lindocara/renderer/frame-recovery.js";
import { describe, expect, it, vi } from "vitest";

describe("runRecoverableFrame", () => {
  it("contains one bad visual frame, recovers transient state and lets the next frame run", () => {
    const failure = new Error("troll action art failed");
    const recover = vi.fn();
    const report = vi.fn();
    let attempts = 0;
    const frame = () => {
      attempts += 1;
      if (attempts === 1) throw failure;
    };

    expect(runRecoverableFrame(frame, recover, report)).toBe(false);
    expect(recover).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(failure);

    expect(runRecoverableFrame(frame, recover, report)).toBe(true);
    expect(attempts).toBe(2);
    expect(recover).toHaveBeenCalledTimes(1);
  });

  it("contains a recovery failure as well as the original frame error", () => {
    const report = vi.fn();

    expect(
      runRecoverableFrame(
        () => {
          throw new Error("frame");
        },
        () => {
          throw new Error("recovery");
        },
        report,
      ),
    ).toBe(false);
    expect(report.mock.calls[0]?.[0]).toBeInstanceOf(AggregateError);
  });
});
