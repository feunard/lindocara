import { AdminRoleProvider } from "@lindocara/server/api/providers/AdminRoleProvider.js";
import type { UserEntity } from "alepha/api/users";
import { UserService } from "alepha/api/users";
import { afterEach, describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.ts";

let alepha: ReturnType<typeof createTestApp> | undefined;
let savedAdminUsernames: string | undefined;

afterEach(async () => {
  if (alepha) {
    await alepha.stop();
    alepha = undefined;
  }
  if (savedAdminUsernames === undefined) delete process.env.ADMIN_USERNAMES;
  else process.env.ADMIN_USERNAMES = savedAdminUsernames;
});

/**
 * Boots a fresh Alepha app with `ADMIN_USERNAMES` already set (or deleted) before `AdminRoleProvider.env`
 * resolves it. `$env` fields resolve once at construction — matching real Cloudflare Workers
 * semantics, where there is no live env to mutate mid-request — so a test needing a different value
 * must boot a new app rather than flip `process.env` under an already-started one. Mirrors
 * `world-room-transition.test.ts`'s `bootAppWithCheats`.
 */
async function bootApp(env: {
  ADMIN_USERNAMES: string | undefined;
}): Promise<ReturnType<typeof createTestApp>> {
  savedAdminUsernames = process.env.ADMIN_USERNAMES;
  if (env.ADMIN_USERNAMES === undefined) delete process.env.ADMIN_USERNAMES;
  else process.env.ADMIN_USERNAMES = env.ADMIN_USERNAMES;
  alepha = createTestApp();
  await alepha.start();
  return alepha;
}

async function makeUser(
  app: ReturnType<typeof createTestApp>,
  data: { username: string; roles: string[] },
): Promise<UserEntity> {
  return app.inject(UserService).createUser({ username: data.username, roles: data.roles });
}

async function getUser(app: ReturnType<typeof createTestApp>, id: string): Promise<UserEntity> {
  return app.inject(UserService).getUserById(id);
}

describe("AdminRoleProvider", () => {
  it("does nothing at all when ADMIN_USERNAMES is unset", async () => {
    // The safety property: a plain reconciliation would demote every admin in any environment
    // where the variable is absent — local dev, a contributor's checkout, the CI boot smoke —
    // silently, at boot, with nothing failing.
    const app = await bootApp({ ADMIN_USERNAMES: undefined });
    const before = await makeUser(app, { username: "keeper", roles: ["admin", "user"] });
    await app.inject(AdminRoleProvider).reconcile();
    expect((await getUser(app, before.id)).roles).toContain("admin");
  });

  it("grants admin to a listed account", async () => {
    const app = await bootApp({ ADMIN_USERNAMES: "chosen" });
    const user = await makeUser(app, { username: "chosen", roles: ["user"] });
    await app.inject(AdminRoleProvider).reconcile();
    expect((await getUser(app, user.id)).roles).toContain("admin");
  });

  it("revokes admin from an account that is no longer listed", async () => {
    const app = await bootApp({ ADMIN_USERNAMES: "chosen" });
    const stale = await makeUser(app, { username: "former", roles: ["admin", "user"] });
    await app.inject(AdminRoleProvider).reconcile();
    const after = await getUser(app, stale.id);
    expect(after.roles).not.toContain("admin");
    // Revoking admin must not strip the default role with it.
    expect(after.roles).toContain("user");
  });

  it("skips an unknown username without throwing", async () => {
    const app = await bootApp({ ADMIN_USERNAMES: "ghost" });
    await expect(app.inject(AdminRoleProvider).reconcile()).resolves.toBeUndefined();
  });
});
