// `?raw` is a Vite virtual module: the plugin hands back the file's TEXT as the
// default export, which no static resolver can see on the module itself.
// oxlint-disable-next-line import/default
import sessionSource from "@lindocara/client/game/session.ts?raw";
import { describe, expect, it } from "vitest";

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
