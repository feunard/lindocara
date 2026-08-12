import { isGameplayInputPaused } from "@lindocara/client/game/session.js";
import {
  beginHudLayoutEdit,
  cancelHudLayoutEdit,
  reloadHudLayout,
} from "@lindocara/client/state/hud-layout.js";
import { useUiStore } from "@lindocara/client/store.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

function closeBlockingSurfaces(): void {
  cancelHudLayoutEdit();
  useUiStore.setState({
    interiorDoorId: null,
    settingsOpen: false,
    talentsOpen: false,
    inventoryOpen: false,
    questJournalOpen: false,
    merchantOpen: false,
    heroLoading: null,
    eventDialogue: null,
    questDialogue: null,
  });
}

beforeEach(closeBlockingSurfaces);
beforeEach(reloadHudLayout);
afterEach(closeBlockingSurfaces);

describe("dialogue gameplay input", () => {
  it("pauses movement and actions while an event dialogue is open", () => {
    expect(isGameplayInputPaused()).toBe(false);
    useUiStore.setState({
      eventDialogue: { kind: "say", runId: "run-1", text: "Stay awhile." },
    });
    expect(isGameplayInputPaused()).toBe(true);
  });

  it("pauses movement and actions while a quest dialogue is open", () => {
    useUiStore.setState({
      questDialogue: {
        kind: "result",
        conversationId: "conversation-1",
        questId: "quest-1",
        speakerName: "Warden Mira",
        title: "The old road",
        text: "Thank you.",
        outcome: "completed",
      },
    });
    expect(isGameplayInputPaused()).toBe(true);
  });

  it("pauses movement and actions while the HUD layout is being edited", () => {
    expect(isGameplayInputPaused()).toBe(false);
    beginHudLayoutEdit();
    expect(isGameplayInputPaused()).toBe(true);
    cancelHudLayoutEdit();
    expect(isGameplayInputPaused()).toBe(false);
  });
});
