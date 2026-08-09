import type { WorldEventSnapshot } from "@lindocara/engine/protocol.js";
import { isSheepAssetId } from "@lindocara/engine/sheep.js";

interface SheepState {
  assetId: string;
  generation: number;
  hits: number;
  state: "intact" | "depleted";
}

export type SheepFeedback =
  | { type: "bleat"; eventId: string; hit: number; x: number; z: number }
  | { type: "explode"; eventId: string; x: number; z: number };

/** Turns authoritative harvest transitions into one-shot local presentation without replaying a
 * welcome or a resync as a fresh hit. */
export class SheepFeedbackTracker {
  readonly #state = new Map<string, SheepState>();
  #mapSize = 0;

  reset(mapSize: number, events: readonly WorldEventSnapshot[]): void {
    this.#mapSize = mapSize;
    this.#state.clear();
    this.#remember(events);
  }

  sync(events: readonly WorldEventSnapshot[]): readonly SheepFeedback[] {
    const feedback: SheepFeedback[] = [];
    const present = new Set<string>();
    for (const event of events) {
      const harvest = event.harvest;
      const previous = this.#state.get(event.id);
      const assetId = isSheepAssetId(event.graphicAssetId)
        ? event.graphicAssetId
        : previous?.assetId;
      if (!harvest || !assetId) continue;
      present.add(event.id);
      const current: SheepState = {
        assetId,
        generation: harvest.generation,
        hits: harvest.hits,
        state: harvest.state,
      };
      this.#state.set(event.id, current);
      if (!previous || previous.generation !== current.generation) continue;
      const x = event.col + 0.5 - this.#mapSize / 2;
      const z = event.row + 0.5 - this.#mapSize / 2;
      for (let hit = previous.hits + 1; hit <= current.hits; hit += 1) {
        const finalHit = current.state === "depleted" && hit === current.hits;
        if (!finalHit) feedback.push({ type: "bleat", eventId: event.id, hit, x, z });
      }
      if (previous.state !== "depleted" && current.state === "depleted") {
        feedback.push({ type: "explode", eventId: event.id, x, z });
      }
    }
    for (const id of this.#state.keys()) if (!present.has(id)) this.#state.delete(id);
    return feedback;
  }

  #remember(events: readonly WorldEventSnapshot[]): void {
    for (const event of events) {
      if (!event.harvest || !isSheepAssetId(event.graphicAssetId)) continue;
      this.#state.set(event.id, {
        assetId: event.graphicAssetId,
        generation: event.harvest.generation,
        hits: event.harvest.hits,
        state: event.harvest.state,
      });
    }
  }
}
