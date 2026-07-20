import { describe, expect, it, vi } from "vitest";
import { authRequestAllowed } from "../src/server/auth-rate-limit.js";

function limiter(success: boolean): RateLimit & { limit: ReturnType<typeof vi.fn> } {
  return {
    limit: vi.fn(async () => ({ success })),
  };
}

describe("authentication rate limiting", () => {
  it("combines normalized credentials, route and connecting address", async () => {
    const credential = limiter(true);
    const origin = limiter(true);
    const request = new Request("https://lindocara.test/api/session", {
      headers: { "CF-Connecting-IP": "203.0.113.10" },
    });

    expect(
      await authRequestAllowed(
        request,
        {
          AUTH_CREDENTIAL_RATE_LIMITER: credential,
          AUTH_ORIGIN_RATE_LIMITER: origin,
        },
        "Player_One",
      ),
    ).toBe(true);
    expect(credential.limit).toHaveBeenCalledWith({
      key: "/api/session:player_one:203.0.113.10",
    });
    expect(origin.limit).toHaveBeenCalledWith({ key: "/api/session:203.0.113.10" });
  });

  it("rejects when either Cloudflare counter is exhausted", async () => {
    expect(
      await authRequestAllowed(
        new Request("https://lindocara.test/api/register"),
        {
          AUTH_CREDENTIAL_RATE_LIMITER: limiter(true),
          AUTH_ORIGIN_RATE_LIMITER: limiter(false),
        },
        "new_user",
      ),
    ).toBe(false);
  });

  it("allows the explicit test-only bypass without touching bindings", async () => {
    const credential = limiter(false);
    const origin = limiter(false);
    expect(
      await authRequestAllowed(
        new Request("https://lindocara.test/api/session"),
        {
          AUTH_CREDENTIAL_RATE_LIMITER: credential,
          AUTH_ORIGIN_RATE_LIMITER: origin,
          AUTH_RATE_LIMIT_DISABLED: "true",
        },
        "test_user",
      ),
    ).toBe(true);
    expect(credential.limit).not.toHaveBeenCalled();
    expect(origin.limit).not.toHaveBeenCalled();
  });
});
