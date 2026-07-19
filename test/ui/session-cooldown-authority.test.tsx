import { describe, expect, it } from "vitest";
import sessionSource from "../../src/client/game/session.ts?raw";

describe("authoritative session cooldown ownership", () => {
  it("never mutates cooldown deadlines from skill.cast", () => {
    expect(sessionSource).not.toContain('case "skill.cast"');
    expect(sessionSource).not.toMatch(/performance\.now\(\)\s*\+\s*[^;]*cooldownMs/);
  });

  it("writes every cooldown store field only from applyAuthoritativeState", () => {
    expect(sessionSource.match(/setAttackCooldownUntil\(/g)).toHaveLength(1);
    expect(sessionSource.match(/setHealCooldownUntil\(/g)).toHaveLength(1);
    expect(sessionSource.match(/setSkillCooldown\(/g)).toHaveLength(1);

    const authoritativeBlock = sessionSource.slice(
      sessionSource.indexOf("const applyAuthoritativeState"),
      sessionSource.indexOf("const playerClass"),
    );
    expect(authoritativeBlock).toContain("clientCooldownDeadlines(state.cooldowns, serverClock)");
    expect(authoritativeBlock).toContain("setAttackCooldownUntil");
    expect(authoritativeBlock).toContain("setHealCooldownUntil");
    expect(authoritativeBlock).toContain("setSkillCooldown");
  });
});
