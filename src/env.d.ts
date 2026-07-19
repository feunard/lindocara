/**
 * Secrets are not declared in wrangler.jsonc — that file is committed, and secrets are set
 * out of band (`wrangler secret put`, or a `.dev.vars` file locally). `wrangler types` can
 * infer them from `.dev.vars`, but that file is gitignored, so CI would typecheck against a
 * different `Env` than a developer's laptop.
 *
 * Declaring them here instead keeps the type identical everywhere. This merges with the
 * generated `Env` in worker-configuration.d.ts rather than replacing it, so regenerating
 * those types never clobbers this.
 */

interface Env {
  /** HMAC key for signing session cookies. See README for how to set it. */
  SESSION_SECRET: string;
  /** Optional local-only navigation overlay gate. Keep unset in production. */
  NAVIGATION_DEBUG?: string;
  /** Local/test-only authoritative chat commands. Keep unset in production. */
  CHEATS_ENABLED?: string;
  /**
   * Test-only presence lease clock, in milliseconds. Both are absent in production and in
   * `wrangler.jsonc`, so `presenceTiming()` falls back to `PRESENCE_TTL_MS` /
   * `PRESENCE_HEARTBEAT_MS` and nothing changes. They shorten the lease so the fencing tests can
   * prove a room invalidates itself without sleeping through a real 30-second lease.
   */
  PRESENCE_TTL_MS_OVERRIDE?: string;
  PRESENCE_HEARTBEAT_MS_OVERRIDE?: string;
}
