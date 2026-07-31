import sessionSource from "@lindocara/client/game/session.ts?raw";
import { describe, expect, it } from "vitest";

describe("combat music session triggers", () => {
  it("does not start combat music from an attack intent without a confirmed enemy interaction", () => {
    const attackBlock = sessionSource.slice(
      sessionSource.indexOf("const attack ="),
      sessionSource.indexOf("const interact ="),
    );

    expect(attackBlock).toContain("connection?.attack()");
    expect(attackBlock).not.toContain("combatPulse");
    expect(sessionSource).toContain('case "combat.hit"');
    expect(sessionSource).toContain('case "combat.hurt"');
  });
});
