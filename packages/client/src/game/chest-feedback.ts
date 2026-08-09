import type { WorldEventSnapshot } from "@lindocara/engine/protocol.js";
import {
  LINDOCARA_CHEST_CLOSED_ASSET_ID,
  LINDOCARA_CHEST_OPEN_ASSET_ID,
} from "@lindocara/engine/tiny-swords-catalog.js";

export type ChestFeedback = "open" | "close";

/** Detects only server-confirmed page changes; welcome/resync states are remembered silently. */
export class ChestFeedbackTracker {
  readonly #state = new Map<string, string>();

  reset(events: readonly WorldEventSnapshot[]): void {
    this.#state.clear();
    for (const event of events) this.#remember(event);
  }

  sync(events: readonly WorldEventSnapshot[]): readonly ChestFeedback[] {
    const feedback: ChestFeedback[] = [];
    const present = new Set<string>();
    for (const event of events) {
      const current = event.graphicAssetId;
      const previous = this.#state.get(event.id);
      if (current !== LINDOCARA_CHEST_CLOSED_ASSET_ID && current !== LINDOCARA_CHEST_OPEN_ASSET_ID) {
        continue;
      }
      present.add(event.id);
      this.#state.set(event.id, current);
      if (previous === LINDOCARA_CHEST_CLOSED_ASSET_ID && current === LINDOCARA_CHEST_OPEN_ASSET_ID)
        feedback.push("open");
      else if (
        previous === LINDOCARA_CHEST_OPEN_ASSET_ID &&
        current === LINDOCARA_CHEST_CLOSED_ASSET_ID
      )
        feedback.push("close");
    }
    for (const id of this.#state.keys()) if (!present.has(id)) this.#state.delete(id);
    return feedback;
  }

  #remember(event: WorldEventSnapshot): void {
    if (
      event.graphicAssetId === LINDOCARA_CHEST_CLOSED_ASSET_ID ||
      event.graphicAssetId === LINDOCARA_CHEST_OPEN_ASSET_ID
    ) {
      this.#state.set(event.id, event.graphicAssetId);
    }
  }
}
