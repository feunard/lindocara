import type { WorldEventSnapshot } from "@lindocara/engine/protocol.js";
import {
  LINDOCARA_CHEST_CLOSED_ASSET_ID,
  LINDOCARA_CHEST_OPEN_ASSET_ID,
} from "@lindocara/engine/tiny-swords-catalog.js";
import { describe, expect, it } from "vitest";

import { ChestFeedbackTracker } from "../src/game/chest-feedback.js";

function chest(graphicAssetId: string): WorldEventSnapshot {
  return {
    id: "chest-1",
    col: 4,
    row: 3,
    graphicAssetId,
    graphicTint: 0xffffff,
    onTop: false,
    moveSpeed: 0,
    moveFrequency: 0,
    moveAnimation: false,
    directionFixed: true,
    presentation: "marker",
  };
}

describe("event chest feedback", () => {
  it("stays silent on admission and reports both server-confirmed state changes once", () => {
    const tracker = new ChestFeedbackTracker();
    tracker.reset([chest(LINDOCARA_CHEST_CLOSED_ASSET_ID)]);
    expect(tracker.sync([chest(LINDOCARA_CHEST_CLOSED_ASSET_ID)])).toEqual([]);
    expect(tracker.sync([chest(LINDOCARA_CHEST_OPEN_ASSET_ID)])).toEqual(["open"]);
    expect(tracker.sync([chest(LINDOCARA_CHEST_OPEN_ASSET_ID)])).toEqual([]);
    expect(tracker.sync([chest(LINDOCARA_CHEST_CLOSED_ASSET_ID)])).toEqual(["close"]);
  });
});
