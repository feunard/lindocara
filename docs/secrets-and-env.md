# Secrets and environment variables

What has to be set, where it is stored, and which of them are authoritative in both directions.

## Secrets

`APP_SECRET` is the one production secret: alepha's SecretProvider derives session encryption
from it and **throws in production when it is defaulted** â€” that throw is the guarantee. Dev
needs nothing; the framework default applies.

- production: stored as a GitHub repository secret (`gh secret set APP_SECRET`); the deploy job
  exports it and `alepha platform up` pushes it to the Worker. Rotating it is `gh secret set`
  with a new value plus a redeploy â€” this invalidates every live session.
- CI/deploy also needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (and `SEED_PASSWORD`
  for the Liin adventure publish step) as repository secrets.

The three game envs â€” `WEBSOCKET_MAX_PAYLOAD`, `NAVIGATION_DEBUG`, `CHEATS_ENABLED` â€” are `$env`
primitives with safe defaults; being `$env`-declared is what puts them on the manifest allowlist
`platform up` pushes from the deploy job's environment, so set them there only if a non-default
production value is ever wanted. `$env` parses once per Alepha instance from a boot-time env
snapshot â€” there is no live env mutation, in tests or on Workers.

`ADMIN_USERNAMES` is a fourth `$env` primitive, and the only way anyone gets the `admin` role.
Comma-separated usernames; `AdminRoleProvider` reconciles it against the realm at boot.

**It is authoritative only when SET.** Unset or empty, the provider does nothing at all - no grants,
no revocations. Set, it is authoritative in both directions: listed accounts gain `admin`, and any
account holding `admin` that is not listed loses it. The asymmetry is the safety property: a plain
reconciliation would silently demote every admin in any environment where the variable happens to be
absent - a contributor's checkout, the CI boot smoke - at boot, with nothing failing. Revoking is
therefore a redeploy, not a hand-written `UPDATE`.

It grants a role to an account that EXISTS and never creates one, so a typo grants nobody (logged and
skipped). And because it reconciles **at boot**, granting admin to an account registered *after*
startup needs a restart - run with the variable set, register, then restart.

`/admin` itself is guarded server-side by `$secure({ permissions: ["admin:ui"] })` on the route, not
by any client check; the menu's ADMIN button is an affordance only. Enabling it also turned on the
realm's `audits` and `apiKeys` features - see `AppSecurityProvider`'s docblock, which records that
`apiKeys` opens a second authentication path into the whole API and that leaving it open to every
account was a deliberate decision.

The console itself is the VENDORED admin shell — `@alepha/ui/components/admin/admin-router`,
injected by `AppRouter` — not app code: the hand-written `AdminRouter.tsx`/`AdminShell.tsx` pair is
deleted. Pages this app does not back (notifications, files, parameters, payments) hide themselves
through each page's `can()` gate against `/api/_links`; there is no allowlist to maintain. The gate
cuts both ways: Jobs is genuinely backed (alepha's scheduler registers `listJobs`; the framework's
own cron jobs — verification cleanup, audit retention — run in this app), so the vendored shell
shows a working Jobs page the hand-written router's five-page list had silently omitted. Everything app-specific rides `adminRouterOptionsAtom`, set on the browser entry from
`packages/client/src/ui/admin/adminChrome.tsx` — the `.admin-root` fence class (vignette lift +
light tokens, `legacy.css`), `colorScheme: false` (the game owns `<html class="dark">`), the
back-to-menu brand and the hidden username-only user columns. Logout is the vendored
`ButtonUser.LogoutMenuItem`; it was a hand-rolled item routed through the navigation seam until
guest accounts were removed, because signing out any other way used to have the next boot mint a
junk guest account. To add an admin page, use
`$pageAdmin` (`@alepha/ui/components/admin/admin-router-page`) with `order: 100`+ or an own
`nav.group`, gated by `can`.
