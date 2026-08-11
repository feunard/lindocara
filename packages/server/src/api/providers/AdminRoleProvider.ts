import { $env, $hook, $inject, z } from "alepha";
import { UserService } from "alepha/api/users";
import { $logger } from "alepha/logger";

/**
 * Reconciles the `admin` role against a list of usernames given by the deploy environment.
 *
 * Declared through `$env` rather than read off `process.env` for the reason `WorldRoom` records:
 * `$env` primitives are what `alepha platform up` puts on the manifest allowlist, so the variable
 * can actually be set on the Bay deploy.
 *
 * THE VARIABLE IS AUTHORITATIVE ONLY WHEN SET, and that asymmetry is the whole design:
 *
 * - unset or empty -> this does NOTHING. No grants, no revocations.
 * - set -> listed accounts gain `admin`; any account holding `admin` that is not listed loses it.
 *
 * A plain full reconciliation would demote every admin in any environment where the variable
 * happens to be absent -- local dev, a contributor's checkout, the CI boot smoke -- silently, at
 * boot, with nothing failing. The "set is authoritative" half is what makes revoking a redeploy
 * instead of a hand-written UPDATE.
 *
 * It grants a role to an account that EXISTS; it never creates one. An unknown username is logged
 * and skipped, so a typo grants nobody rather than conjuring a user.
 */
export const adminRoleEnvSchema = z.object({
  ADMIN_USERNAMES: z
    .string()
    .default("")
    .describe(
      "Comma-separated usernames that hold the `admin` role. Empty or unset disables " +
        "reconciliation entirely; when set it is authoritative in both directions.",
    ),
});

const ADMIN_ROLE = "admin";

/**
 * Page size used while walking every account. `UserService.findUsers` pagination is bounded to
 * 100 per page (`pageQuerySchema`'s `size` max), so a realm larger than one page is the norm, not
 * an edge case -- this always pages through to `page.isLast` rather than trusting a single page.
 */
const RECONCILE_PAGE_SIZE = 100;

export class AdminRoleProvider {
  env = $env(adminRoleEnvSchema);
  userService = $inject(UserService);
  log = $logger();

  /**
   * Reconciliation is a BOOT CHORE, not a boot requirement, so it can never refuse to serve.
   *
   * Alepha aborts startup when a `ready` hook rejects (`Alepha.ts`), and everything this walk
   * touches is out of its own control: the database may be mid-migration, slow, briefly
   * unreachable, or `findUsers` may simply fail on one page of a large realm. Left unguarded, any
   * of those turns "an admin's role is momentarily out of date" into "the game is down" — a
   * strictly worse outcome, and a live one, since `ADMIN_USERNAMES` is set in production. The role
   * grant is also self-healing: the next boot reconciles again, and the `admin` role governs one
   * console, not a player's ability to play.
   *
   * Logged at error level rather than swallowed — a reconciliation that never succeeds must be
   * visible in Bay's logs, because the silent failure mode is an admin who cannot get in and a
   * revoked account that is still an admin.
   */
  ready = $hook({
    on: "ready",
    handler: async () => {
      try {
        await this.reconcile();
      } catch (error) {
        this.log.error("admin role reconciliation failed; continuing to boot", { error });
      }
    },
  });

  async reconcile(): Promise<void> {
    const wanted = this.env.ADMIN_USERNAMES.split(",")
      .map((name) => name.trim())
      .filter((name) => name.length > 0);
    if (wanted.length === 0) return;

    const wantedSet = new Set(wanted);
    // Grant lookups are genuinely by username, so this map only needs (and only gets) the
    // usernamed accounts. The revoke scan below must NOT reuse it: `username` is `.optional()` on
    // alepha's `users` entity (only this app's realm enforces it at registration), so gating the
    // revoke scan on the same map would silently exempt any usernameless admin from ever being
    // revoked -- a permanent hole in "authoritative in both directions". `allFetched` stays
    // ungated for exactly that reason.
    const byUsername = new Map<string, { id: string; roles: string[] }>();
    const allFetched: { id: string; username: string | undefined; roles: string[] }[] = [];

    for (let page = 0; ; page += 1) {
      const result = await this.userService.findUsers({ page, size: RECONCILE_PAGE_SIZE });
      for (const user of result.content) {
        allFetched.push({ id: user.id, username: user.username, roles: user.roles });
        if (user.username) {
          byUsername.set(user.username, { id: user.id, roles: user.roles });
        }
      }
      if (result.page.isLast) break;
    }

    for (const username of wanted) {
      const user = byUsername.get(username);
      if (!user) {
        this.log.warn("ADMIN_USERNAMES names an account that does not exist", { username });
        continue;
      }
      if (user.roles.includes(ADMIN_ROLE)) continue;
      await this.userService.updateUser(user.id, {
        roles: [...user.roles, ADMIN_ROLE],
      });
    }

    for (const user of allFetched) {
      if (!user.roles.includes(ADMIN_ROLE)) continue;
      // A missing/unlisted username reads as "not listed" and is revoked like anything else.
      if (user.username && wantedSet.has(user.username)) continue;
      await this.userService.updateUser(user.id, {
        roles: user.roles.filter((role) => role !== ADMIN_ROLE),
      });
    }
  }
}
