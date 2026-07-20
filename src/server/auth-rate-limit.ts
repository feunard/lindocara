import { normalizeUsername } from "./accounts.js";

export interface AuthRateLimitBindings {
  AUTH_CREDENTIAL_RATE_LIMITER: RateLimit;
  AUTH_ORIGIN_RATE_LIMITER: RateLimit;
  AUTH_RATE_LIMIT_DISABLED?: string;
}

function clientAddress(request: Request): string {
  // Cloudflare supplies and protects this header at the edge. Do not trust caller-controlled
  // forwarding headers as a fallback; local development deliberately shares the `unknown` key.
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
}

/**
 * Two complementary limits: a narrow credential+origin fence for password guessing and a wider
 * origin fence for account-creation floods. Cloudflare counters are per location and deliberately
 * permissive, so these complement (rather than replace) a zone-level WAF/Turnstile rule.
 */
export async function authRequestAllowed(
  request: Request,
  env: AuthRateLimitBindings,
  username: string,
): Promise<boolean> {
  if (env.AUTH_RATE_LIMIT_DISABLED === "true") return true;
  const route = new URL(request.url).pathname;
  const address = clientAddress(request);
  const normalized = normalizeUsername(username);
  const [credential, origin] = await Promise.all([
    env.AUTH_CREDENTIAL_RATE_LIMITER.limit({ key: `${route}:${normalized}:${address}` }),
    env.AUTH_ORIGIN_RATE_LIMITER.limit({ key: `${route}:${address}` }),
  ]);
  return credential.success && origin.success;
}
