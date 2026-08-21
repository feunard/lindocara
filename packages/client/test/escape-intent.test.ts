import type { EscapeContext } from "@lindocara/client/game/escape-intent.js";
import { escapeIntent } from "@lindocara/client/game/escape-intent.js";
import { describe, expect, it } from "vitest";

function context(overrides: Partial<EscapeContext> = {}): EscapeContext {
  return {
    interiorOpen: false,
    mapOpen: false,
    talentsOpen: false,
    questJournalOpen: false,
    inventoryOpen: false,
    merchantOpen: false,
    settingsOpen: false,
    adventureTestRunning: false,
    ...overrides,
  };
}

describe("escapeIntent", () => {
  it("opens the game menu on a clear screen, outside a playtest", () => {
    expect(escapeIntent(context())).toBe("open-settings");
  });

  it("leaves the playtest instead of opening the game menu", () => {
    expect(escapeIntent(context({ adventureTestRunning: true }))).toBe("leave-adventure-test");
  });

  it("still closes what is open first, even in a playtest", () => {
    // The rung matters: a creator with the map open presses Escape to close the map, not to be
    // thrown back into the editor. Only an empty screen means "I am done with this test".
    const inTest = { adventureTestRunning: true };
    expect(escapeIntent(context({ ...inTest, interiorOpen: true }))).toBe("close-interior");
    expect(escapeIntent(context({ ...inTest, mapOpen: true }))).toBe("close-map");
    expect(escapeIntent(context({ ...inTest, talentsOpen: true }))).toBe("close-talents");
    expect(escapeIntent(context({ ...inTest, questJournalOpen: true }))).toBe(
      "close-quest-journal",
    );
    expect(escapeIntent(context({ ...inTest, inventoryOpen: true }))).toBe("close-inventory");
    expect(escapeIntent(context({ ...inTest, merchantOpen: true }))).toBe("close-inventory");
    expect(escapeIntent(context({ ...inTest, settingsOpen: true }))).toBe("close-settings");
  });

  it("keeps the settings menu a toggle", () => {
    expect(escapeIntent(context({ settingsOpen: true }))).toBe("close-settings");
  });

  it("closes the interior panel before anything else", () => {
    expect(escapeIntent(context({ interiorOpen: true, mapOpen: true, inventoryOpen: true }))).toBe(
      "close-interior",
    );
  });
});
