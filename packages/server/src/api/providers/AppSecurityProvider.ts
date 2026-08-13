import { $realm } from "alepha/api/users";

/**
 * Registers the app's realm: username + password credentials only, no
 * email/OAuth flows. `$realm()` runs inside this field initializer and
 * injects `RealmProvider`/`SessionService` (from `alepha/api/users`) and
 * `SecurityProvider` (from `alepha/security`) — Alepha auto-registers the
 * owning module of everything a service injects the moment that service
 * itself is constructed, so declaring `realm` here is what pulls in the
 * whole `alepha.api.users` module (its `users`/`identities`/`sessions`
 * entities and every HTTP route: `/api/users/register`, `/_auth/token`,
 * `/_auth/userinfo`, ...) and `alepha.security`/`alepha.orm` beneath it.
 *
 * Named `AppSecurityProvider`, not `SecurityProvider`: the latter name
 * collides with `alepha/security`'s own `SecurityProvider` (referenced
 * above), which this class's `$realm()` call transitively injects — two
 * distinct classes sharing one name across this app's DI graph is exactly
 * the kind of "which one did I actually get" trap the rename avoids.
 *
 * This class MUST be listed in `LindocaraApi`'s `services[]`
 * (`packages/server/src/api/index.ts`) — nothing else in the app injects
 * it, so leaving it out of that array means none of the above ever runs
 * and every realm setting silently falls back to the framework default
 * (email-required registration). This is a known Alepha pitfall.
 *
 * Settings (`.vendor/alepha/src/api/users/atoms/realmAuthSettingsAtom.ts`):
 * - `username: "required"` + `usernameRegExp` — the only registration
 *   identity.
 * - `email: "none"` — the sibling field requirement key; without setting
 *   it explicitly it defaults to `"required"` and registration would
 *   demand an email even though nothing here collects or verifies one.
 * - `resetPasswordAllowed`/`verifyEmailRequired: false` — no email means
 *   no verification/reset flows; `$realm()` would force these off anyway
 *   once `features.notifications` stays at its default `false`, but they
 *   are set explicitly here for clarity.
 * - The login window also keeps the retired Worker's two production guards:
 * 30 failed attempts per source IP and 8 per account in 60 seconds. Their
 * counters use the D1-backed cache selected by `LindocaraApi`.
 *
 * `features` (`.vendor/alepha/src/api/users/primitives/$realm.ts`, merged
 * over a default that leaves every flag `false`):
 * - `audits: true` — registers `alepha.api.audits` (`UserAudits`/
 *   `SessionAudits` log to it) and its `AdminAuditController`, so the admin
 *   shell's Audits page (`admin-audits`, mounted by the vendored
 *   `@alepha/ui/components/admin/admin-router`) has a real controller to
 *   call instead of 401ing.
 * - `apiKeys: true` — backs the admin shell's API keys page (`admin-keys`,
 *   `AdminApiKeyController`), but that is the SMALLER half of what this flag
 *   does. It also opens a SECOND, standing authentication path into the
 *   whole API for every account, not only admins:
 *   - Registers `ApiKeyService.createResolver()` as an issuer resolver
 *     (`$realm.ts`'s `customResolvers`), so a request carrying `?api_key=`
 *     or `Authorization: Bearer <token>` authenticates without ever going
 *     through `SessionService`/`$issuer`'s normal login flow — no
 *     `session_epoch`, no `PresenceRoom` lease, and none of this app's two
 *     login-rate-limit windows (30/IP, 8/account per 60s), because those all
 *     guard the credentials-login path this bypasses entirely.
 *   - Registers the user-facing `ApiKeyController` (`create`/`list`/`revoke`
 *     one's OWN keys), gated by `api-key:create`/`api-key:read`/
 *     `api-key:delete`. Those are ordinary, non-`admin:*` permission names,
 *     so the DEFAULT `user` role's wildcard grant (`{ name: "*", exclude:
 *     ["admin:*"] }`, `$realm.ts`'s own default roles) already covers all
 *     three — every account this game mints, including every anonymous
 *     "continue as guest" registration, can self-service a long-lived
 *     bearer credential today, not just an operator granted `admin`.
 *   - A minted key authenticates for up to 15 minutes AFTER being revoked
 *     (`ApiKeyService.validationCache`'s TTL, per-isolate) — revocation is
 *     not immediate.
 *   The human was shown this exact surface and chose, deliberately, to keep
 *   it open for every account rather than narrowing it — do not gate it
 *   further, and do not read its current shape as an oversight.
 * Both features add a table (`audits`, `api_keys` — see
 * `apps/main/migrations/sqlite/`); neither is a module this app imports
 * directly — `$realm`'s own `features` merge is what turns them on.
 */
export class AppSecurityProvider {
  realm = $realm({
    features: {
      audits: true,
      apiKeys: true,
    },
    settings: {
      username: "required",
      usernameRegExp: "^[A-Za-z0-9_-]{3,16}$",
      email: "none",
      resetPasswordAllowed: false,
      verifyEmailRequired: false,
      loginRateLimit: {
        // Preserve the two legacy production guards while storing their
        // counters in the new Alepha D1: origin/IP and credential/account.
        ipMaxAttempts: 30,
        accountMaxAttempts: 8,
        windowMs: 60_000,
      },
    },
    identities: { credentials: true },
  });
}
