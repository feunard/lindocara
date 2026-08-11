# An admin console, and a QUIT button that quits

Two small, unrelated pieces of housekeeping, specified together because they are one sitting's work
and touch the same file (`AppRouter.tsx`).

## Part A — `/admin`

### What already exists

Almost all of it, which is the point.

`AppSecurityProvider`'s `$realm()` pulls in the whole `alepha.api.users` module — and that includes
**`AdminUserController`, `AdminSessionController` and `AdminIdentityController`**, already registered
and already deployed. Every one of their routes is guarded by
`$secure({ permissions: ["admin:user:read"] })` or a sibling permission.

`@alepha/ui` ships the matching front end: `admin-page`, `admin-users`, `admin-sessions`,
`admin-audits` (and `admin-jobs`, `admin-files`, `admin-notifications`, `admin-payments`, which this
app has no use for — it registers none of those subsystems, so they would render empty or erroring
shells).

Alepha's realm defines two roles by default (`$realm.ts`): **`admin`**, with permission `*`, and
**`user`**, the default one, whose `*` excludes `admin:*`.

So there is no server API to write and no UI to design. What is missing is exactly one thing: **no
account in this app has ever been given the `admin` role**, so the guard holds against everybody.

### Granting the role

A new `ADMIN_USERNAMES` **`$env` primitive** (comma-separated usernames), reconciled at boot by a
small `AdminRoleProvider` in `packages/server/src/api/providers/`. Declared through `$env` rather
than read off `process.env` for the reason `WorldRoom` records: `$env` primitives are what
`platform up` puts on the manifest allowlist, so the variable can actually be set on the deploy.

**The variable is authoritative only when it is set.** That asymmetry is the whole design:

| `ADMIN_USERNAMES` | Behaviour |
| --- | --- |
| unset or empty | **the provider does nothing at all** — no grants, no revocations |
| set | listed accounts gain `admin`; any account holding `admin` that is not listed loses it |

The "unset does nothing" half is not politeness, it is the safety property. A plain full
reconciliation would demote every admin in any environment where the variable happens to be absent —
local dev, a contributor's checkout, the CI boot smoke — silently, at boot, with nothing failing.
The "set is authoritative" half is what makes revocation a redeploy instead of a hand-written
`UPDATE`.

Reconciliation runs once at startup, through `UserService.findUsers`/`updateUser` so the framework's
own role audit (`User roles changed`) fires. An unknown username is logged and skipped, never
created: this grants a role, it does not provision accounts.

### The route and the screen

- An `admin` route at `/admin` on `AppRouter`, **lazy-loaded** exactly like `editor`, so the game
  shell does not carry the admin bundle.
- `packages/client/src/ui/admin/AdminScreen.tsx` — three tabs, **Users / Sessions / Audits**, each
  one `@alepha/ui`'s component inside its `AdminPage` shell.
- **Stock shadcn only.** An admin console is a non-game surface, so the two-tree rule puts it
  squarely in the `@alepha/ui` tree; no Tiny Swords component may be imported to "match the theme".
- It imports `alepha/react`, so the file belongs to `packages/client/tsconfig.api.json` and must be
  `exclude`d from the package's plain `tsconfig.json` — the same split `MainMenu.tsx` already has.
  Getting this wrong type-checks alepha's own source under this repo's stricter base and fails by
  the hundreds.

### Access, twice over

- **Server:** already enforced, per route, by `$secure`. Nothing is added, and nothing may be
  loosened.
- **Client:** the screen reads the session's roles through `useAuth()` (`alepha/react/auth`, the same
  hook `@alepha/ui`'s own admin components use) and renders a short "not authorised" panel with a way
  back to the menu when `admin` is absent. This is a courtesy, not a security boundary — it
  exists so a non-admin sees one honest sentence instead of a page of failed requests. The server
  stays the only thing that decides.
- **Entry point:** a discreet corner button beside the existing EDITOR button, rendered only when the
  session holds `admin`. `/admin` remains reachable by URL regardless; hiding a button is not a
  fence.

## Part B — QUIT actually logs out

Today `menu.quit` runs `router.push("title")` — it returns to the title screen while the session
cookie survives. The fix is to call Alepha's `ReactAuth.logout()`, the `<form>` POST to
`/oauth/logout` that revokes server-side and needs no manual reload. It is already wired as
`GameNavigation.logout()` in `AppRouter.tsx`, and `MainMenu.tsx` is already in the alepha tsconfig
program, so no new import boundary is crossed.

**Escape must keep doing what it does.** This is the part that is easy to get wrong. `MainMenu`'s
`<MenuNav onBack={() => void router.push("title")}>` binds Escape and the gamepad's B, and the hints
row labels that key `menu.quit` — so today the button and the key are the same harmless action, and
the label is honest. Make the button log out while leaving them fused, and a stray Escape on the
main menu signs the player out.

So they separate:

- the **QUIT button** logs out;
- **`onBack` keeps pushing `title`**, unchanged;
- the hint's label moves from `menu.quit` to a new **`menu.hint.back`**, in both `en` and `fr`
  (`packages/engine/src/i18n/`), because it is no longer describing the quit action.

No confirmation dialog. There is no live game session on the main menu, so nothing is lost that
logging back in does not restore, and a modal on the way out is friction for a mis-click that costs
one login.

## Testing

- `packages/server/test-api/` — the real-app harness: with `ADMIN_USERNAMES` unset, a user holding
  `admin` keeps it and a user without it gains nothing; with it set, a listed user gains the role
  and an unlisted admin loses it; an unknown username is skipped without throwing.
- `packages/client/test/` (jsdom) — the QUIT button invokes the navigation seam's `logout`, and
  `onBack` does not; a non-admin session renders the "not authorised" panel rather than the tabs.
- `packages/engine/test/i18n.test.ts` already enforces en/fr parity, so `menu.hint.back` is covered
  by adding it to both dictionaries.
- `npm run check`, and a browser pass over `/admin` and the menu with the `playwright-cli` skill.

## Deliberately not doing

- **The jobs, files, notifications and payments admin pages.** The app registers none of those
  alepha subsystems. Mounting them would ship four tabs that are empty at best.
- **Any new admin API.** Alepha's controllers already cover users, sessions and identities, and they
  are already deployed. Writing a parallel one would be a second, unaudited path to the same rows.
- **Provisioning accounts from `ADMIN_USERNAMES`.** It grants a role to an account that exists; it
  does not create one. A typo should grant nobody, loudly in the log — not conjure a user.
- **A confirmation dialog on QUIT**, and any change to what Escape does.

## Risks

- `ADMIN_USERNAMES` must actually be set in the Bay deploy environment or production has no admin.
  Being `$env`-declared is what allows it; setting it is a separate, manual act.
- Granting `admin` grants permission `*` — alepha's admin role is not scoped to the user console.
  There is no finer-grained role to hand out here, so treat the variable as a short list.
