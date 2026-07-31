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
 */
export class AppSecurityProvider {
  realm = $realm({
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
