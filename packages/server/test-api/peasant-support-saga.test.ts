import type { PartyMaterialReservationResult } from "@lindocara/server/api/realtime/PartyRoom.js";
import { runPeasantSupportSaga } from "@lindocara/server/api/realtime/peasantSupportSaga.js";
import { describe, expect, it, vi } from "vitest";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accepted, refused) => {
    resolve = accepted;
    reject = refused;
  });
  return { promise, resolve, reject };
}

const held: PartyMaterialReservationResult = {
  ok: true,
  reservationId: "reservation-1",
  status: "held",
  materials: { wood: 4, stone: 2, meat: 2 },
};
const committed: PartyMaterialReservationResult = {
  ...held,
  status: "committed",
  materials: { wood: 0, stone: 0, meat: 0 },
};
const released: PartyMaterialReservationResult = {
  ...held,
  status: "released",
};
const settled: PartyMaterialReservationResult = {
  ...committed,
  status: "settled",
};

function harness(
  overrides: {
    reserve?: () => Promise<PartyMaterialReservationResult>;
    commit?: () => Promise<PartyMaterialReservationResult>;
    settle?: () => Promise<PartyMaterialReservationResult>;
    isValid?: () => boolean;
  } = {},
) {
  const release = vi.fn(async () => released);
  const cancelLocal = vi.fn();
  const activate = vi.fn(() => true);
  const onError = vi.fn();
  const run = () =>
    runPeasantSupportSaga({
      reserve: overrides.reserve ?? (async () => held),
      commit: overrides.commit ?? (async () => committed),
      release,
      settle: overrides.settle ?? (async () => settled),
      cancelLocal,
      isValid: overrides.isValid ?? (() => true),
      activate,
      onError,
    });
  return { run, release, cancelLocal, activate, onError };
}

describe("Peasant material saga", () => {
  it("releases a hold when the hero moves while reserve is in flight", async () => {
    const reserve = deferred<PartyMaterialReservationResult>();
    let position = 10;
    const frozenPosition = position;
    const test = harness({
      reserve: () => reserve.promise,
      isValid: () => position === frozenPosition,
    });
    const result = test.run();
    position = 11;
    reserve.resolve(held);

    await expect(result).resolves.toBe("invalidated");
    expect(test.release).toHaveBeenCalledOnce();
    expect(test.cancelLocal).toHaveBeenCalledOnce();
    expect(test.activate).not.toHaveBeenCalled();
  });

  it("refunds a committed spend when the hero disconnects while commit is in flight", async () => {
    const commit = deferred<PartyMaterialReservationResult>();
    let connected = true;
    const test = harness({ commit: () => commit.promise, isValid: () => connected });
    const result = test.run();
    await Promise.resolve();
    connected = false;
    commit.resolve(committed);

    await expect(result).resolves.toBe("invalidated");
    expect(test.release).toHaveBeenCalledOnce();
    expect(test.cancelLocal).toHaveBeenCalledOnce();
    expect(test.activate).not.toHaveBeenCalled();
  });

  it("retries an idempotent compensation when the first coordinator reply is lost", async () => {
    const release = vi
      .fn<() => Promise<PartyMaterialReservationResult>>()
      .mockRejectedValueOnce(new Error("reply lost"))
      .mockResolvedValue(released);
    const onError = vi.fn();

    await expect(
      runPeasantSupportSaga({
        reserve: async () => held,
        commit: async () => committed,
        release,
        settle: async () => settled,
        cancelLocal: vi.fn(),
        isValid: () => false,
        activate: vi.fn(() => true),
        onError,
      }),
    ).resolves.toBe("invalidated");
    expect(release).toHaveBeenCalledTimes(2);
    expect(onError).not.toHaveBeenCalled();
  });

  it("keeps a created action paid when settlement acknowledgement is lost", async () => {
    const test = harness({ settle: async () => Promise.reject(new Error("transport lost")) });

    await expect(test.run()).resolves.toBe("activated_unsettled");
    expect(test.activate).toHaveBeenCalledOnce();
    expect(test.release).not.toHaveBeenCalled();
    expect(test.onError).toHaveBeenCalledWith("settle", expect.any(Error));
  });

  it("does not activate, spend cooldown or attempt commit when stock is insufficient", async () => {
    const commit = vi.fn(async () => committed);
    const test = harness({
      reserve: async () => ({ ok: false, reason: "insufficient" }),
      commit,
    });

    await expect(test.run()).resolves.toBe("insufficient");
    expect(commit).not.toHaveBeenCalled();
    expect(test.activate).not.toHaveBeenCalled();
    expect(test.release).not.toHaveBeenCalled();
    expect(test.cancelLocal).toHaveBeenCalledOnce();
  });
});
