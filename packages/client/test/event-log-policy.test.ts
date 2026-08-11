import { shouldLogEvent } from "@lindocara/client/game/event-log-policy.js";
import { describe, expect, it } from "vitest";

describe("top-right event log policy", () => {
  it.each([
    "skill.cast",
    "skill.blocked",
    "skill.no_target",
    "skill.locked",
    "skill.disabled",
    "interact.nothing",
    "combat.hit",
    "combat.hurt",
    "heal.cast",
    "heal.received",
    "resurrect.nobody",
    "resource.insufficient",
    "zone.transition",
  ] as const)("hides noisy transient event %s", (code) => {
    expect(shouldLogEvent(code)).toBe(false);
  });

  it.each([
    "item.used",
    "potion.used",
    "loot.picked",
    "death.fallen",
    "death.released",
    "death.reclaimed",
    "death.resurrected",
    "resurrect.cast",
    "level_up",
    "quest.fulfilled",
    "party.kicked",
    "presence.lost",
  ] as const)("keeps important outcome %s", (code) => {
    expect(shouldLogEvent(code)).toBe(true);
  });

  it("keeps explicit test-command feedback", () => {
    expect(shouldLogEvent("cheat.where")).toBe(true);
    expect(shouldLogEvent("cheat.unknown")).toBe(true);
  });
});
