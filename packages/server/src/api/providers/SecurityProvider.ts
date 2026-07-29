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
 */
export class SecurityProvider {
  realm = $realm({
    settings: {
      username: "required",
      usernameRegExp: "^[A-Za-z0-9_-]{3,16}$",
      email: "none",
      resetPasswordAllowed: false,
      verifyEmailRequired: false,
    },
    identities: { credentials: true },
  });
}
