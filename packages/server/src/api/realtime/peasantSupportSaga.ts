import type { PartyMaterialReservationResult } from "./PartyRoom.ts";

export type PeasantSupportSagaStage = "reserve" | "commit" | "release" | "settle";
export type PeasantSupportSagaResult =
  | "activated"
  | "activated_unsettled"
  | "insufficient"
  | "unavailable"
  | "invalidated"
  | "failed";

/**
 * Two-phase material saga around one synchronous WorldRoom activation. Movement, disconnect,
 * transition and epoch changes are sampled after each coordinator await. Before activation an
 * abort compensates a committed spend; after activation a lost settlement deliberately does not.
 */
export async function runPeasantSupportSaga(options: {
  readonly reserve: () => Promise<PartyMaterialReservationResult>;
  readonly commit: () => Promise<PartyMaterialReservationResult>;
  readonly release: () => Promise<PartyMaterialReservationResult>;
  readonly settle: () => Promise<PartyMaterialReservationResult>;
  readonly cancelLocal: () => void;
  readonly isValid: () => boolean;
  readonly activate: () => boolean;
  readonly onError: (stage: PeasantSupportSagaStage, error: unknown) => void;
}): Promise<PeasantSupportSagaResult> {
  const abort = async (): Promise<void> => {
    options.cancelLocal();
    let lastError: unknown;
    // A call can reject after the coordinator committed its reply. Immediate idempotent retries
    // classify both "failed before execution" and "reply lost after execution" without a timer.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const released = await options.release();
        if (!released.ok || (released.status !== "released" && released.status !== "refunded")) {
          throw new Error("support-spend release was not acknowledged");
        }
        return;
      } catch (error) {
        lastError = error;
      }
    }
    options.onError("release", lastError);
  };

  let reserved: PartyMaterialReservationResult;
  try {
    reserved = await options.reserve();
  } catch (error) {
    options.cancelLocal();
    options.onError("reserve", error);
    return "failed";
  }
  if (!reserved.ok) {
    options.cancelLocal();
    return reserved.reason === "insufficient" ? "insufficient" : "unavailable";
  }
  if (reserved.status !== "held") {
    options.cancelLocal();
    return "unavailable";
  }
  if (!options.isValid()) {
    await abort();
    return "invalidated";
  }

  let committed: PartyMaterialReservationResult;
  try {
    committed = await options.commit();
  } catch (error) {
    await abort();
    options.onError("commit", error);
    return "failed";
  }
  if (!committed.ok || committed.status !== "committed") {
    await abort();
    return "unavailable";
  }
  if (!options.isValid()) {
    await abort();
    return "invalidated";
  }
  if (!options.activate()) {
    await abort();
    return "invalidated";
  }

  try {
    const settled = await options.settle();
    if (!settled.ok || settled.status !== "settled") {
      throw new Error("support-spend settlement was not acknowledged");
    }
    return "activated";
  } catch (error) {
    options.onError("settle", error);
    return "activated_unsettled";
  }
}
