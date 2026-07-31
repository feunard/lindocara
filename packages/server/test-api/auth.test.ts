import { MeController } from "@lindocara/server/api/controllers/MeController.js";
import { RealmProvider, UserController } from "alepha/api/users";
import { CacheProvider } from "alepha/cache";
import { DatabaseCacheProvider } from "alepha/cache/database";
import { ServerProvider } from "alepha/server";
import { afterEach, beforeEach, test } from "vitest";
import { createTestApp } from "./helpers.ts";

// Meets the realm's default password policy (min length 8, upper + lower +
// number; special characters not required — see `realmAuthSettingsAtom`'s
// `passwordPolicy` default).
const PASSWORD = "Sup3rSecret";

let alepha: ReturnType<typeof createTestApp>;

beforeEach(async () => {
  alepha = createTestApp();
  await alepha.start();
});

afterEach(async () => {
  await alepha.stop();
});

// `UserController`/`MeController` are `$action`s, so `.fetch()` (the Task 4
// idiom) round-trips real HTTP + schema validation. The realm's own
// `/_auth/token` (credentials login) and `/_auth/userinfo` are the lower
// level `$route` primitive, which has no `.fetch()` — those two are driven
// with a plain `fetch()` against `ServerProvider.hostname`, the same idiom
// alepha's own `ServerAuthProvider.spec.ts` uses.
test("register with username only, then login", async ({ expect }) => {
  const users = alepha.inject(UserController);
  const me = alepha.inject(MeController);
  const hostname = alepha.inject(ServerProvider).hostname;

  // Phase 1: register intent — username + password only, no email.
  const intent = await users.createRegistrationIntent.fetch({
    body: { username: "nifoures", password: PASSWORD },
  });
  expect(intent.data.expectEmailVerification).toBe(false);
  expect(intent.data.expectPhoneVerification).toBe(false);

  // Phase 2: complete registration from the intent — no verification codes
  // required since the realm has no email/phone flows.
  const registered = await users.createUserFromIntent.fetch({
    body: { intentId: intent.data.intentId },
  });
  expect(registered.data.username).toBe("nifoures");
  expect(registered.status).toBe(200);

  // A `whoami` call with no credentials is rejected.
  await expect(me.whoami.fetch()).rejects.toMatchObject({ status: 401 });

  // A wrong password is rejected.
  const badLogin = await fetch(`${hostname}/_auth/token?provider=credentials`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "nifoures", password: "wrong-password" }),
  });
  expect(badLogin.status).toBe(401);

  // Login with the credentials provider.
  const login = await fetch(`${hostname}/_auth/token?provider=credentials`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "nifoures", password: PASSWORD }),
  });
  expect(login.status).toBe(200);
  const tokens = (await login.json()) as {
    access_token: string;
    user: { id: string; username?: string };
  };
  expect(tokens.user.username).toBe("nifoures");

  // `/_auth/userinfo` round-trips the same username from the access token.
  const userinfo = await fetch(`${hostname}/_auth/userinfo`, {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  });
  expect(userinfo.status).toBe(200);
  const info = (await userinfo.json()) as { user?: { username?: string } };
  expect(info.user?.username).toBe("nifoures");

  // `$secure({})` on an ordinary `$action` accepts the same access token and
  // injects the authenticated user, whose id matches the registered user.
  const authenticated = await me.whoami.fetch({
    headers: { authorization: `Bearer ${tokens.access_token}` },
  });
  expect(authenticated.data.id).toBe(registered.data.id);
});

test("username shorter than 3 or with illegal chars is rejected", async ({ expect }) => {
  // Raw `fetch()`, not `.fetch()`: the action client validates the request
  // body against `registerRequestSchema` (`username: z.string().min(3)`)
  // and throws locally before ever sending "ab" over the wire. A real HTTP
  // call is the only way to see the server's own 400 for both cases —
  // the schema-level one (too short) and the realm's runtime
  // `usernameRegExp` check (illegal characters, length already valid).
  const hostname = alepha.inject(ServerProvider).hostname;

  const short = await fetch(`${hostname}/api/users/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "ab", password: PASSWORD }),
  });
  expect(short.status).toBe(400);

  const illegal = await fetch(`${hostname}/api/users/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "bad name!", password: PASSWORD }),
  });
  expect(illegal.status).toBe(400);
});

test("login rate limits use the new D1-compatible cache and preserve legacy thresholds", async ({
  expect,
}) => {
  expect(alepha.inject(CacheProvider)).toBeInstanceOf(DatabaseCacheProvider);

  const settings = await alepha.inject(RealmProvider).getRealm().getSettings();
  expect(settings.loginRateLimit).toEqual({
    ipMaxAttempts: 30,
    accountMaxAttempts: 8,
    windowMs: 60_000,
  });

  const users = alepha.inject(UserController);
  const hostname = alepha.inject(ServerProvider).hostname;
  const intent = await users.createRegistrationIntent.fetch({
    body: { username: "ratelimited", password: PASSWORD },
  });
  await users.createUserFromIntent.fetch({
    body: { intentId: intent.data.intentId },
  });

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await fetch(`${hostname}/_auth/token?provider=credentials`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "ratelimited",
        password: "wrong-password",
      }),
    });
    expect(response.status).toBe(401);
  }

  const locked = await fetch(`${hostname}/_auth/token?provider=credentials`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "ratelimited", password: PASSWORD }),
  });
  expect(locked.status).toBe(401);
});
