# Admin console and logout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reach Alepha's already-deployed admin API from an `/admin` route, grant the `admin` role
from an env var, and make the menu's QUIT button actually end the session.

**Architecture:** Nothing new server-side except role reconciliation — `$realm()` already registered
`AdminUserController`/`AdminSessionController`/`AdminIdentityController` and `$secure` already guards
them. A boot `$hook` reconciles `ADMIN_USERNAMES` against the `admin` role; a lazy `/admin` route
renders `@alepha/ui`'s ready-made admin components.

**Tech Stack:** Alepha (`$env`, `$hook`, `$page`, `$secure`), `@alepha/ui` (stock shadcn), React,
Vitest (node for `server`, jsdom for `client`).

## Global Constraints

- Everything in English — code, comments, commit messages.
- **Two component trees:** `/admin` is a non-game surface, so it uses **`@alepha/ui` only**
  (`import { Button } from "@alepha/ui/components/ui/button"` — note the `ui/` segment, no `.js`).
  Never import a `ui/tiny-swords/` component into it.
- `@alepha/ui` and `.vendor/alepha` are VENDORED. Do not hand-edit either; a local change becomes a
  patch `npx alepha vendor diff` reports forever.
- Any file importing `alepha`/`alepha/react*` must live in `packages/client/tsconfig.api.json`'s
  `include` **and** be `exclude`d from `packages/client/tsconfig.json`. Skipping this typechecks
  alepha's own source under this repo's stricter base and fails by the hundreds.
- Alepha classes use no TypeScript `private`; JSDoc comments are `/** … */` blocks.
- Biome formats and lints; `noNonNullAssertion` is on — narrow, never `!`.
- No `vi.mock`. Server tests drive the real app over HTTP (`packages/server/test-api/`).

## Correction to the spec

The spec says `menu.hint.back` must be added to both dictionaries. **It already exists** —
`en.ts:2034` ("Back") and `fr.ts:2058` ("Retour"). Only `menu.admin` is new. No other spec change.

---

### Task 1: Grant the admin role from `ADMIN_USERNAMES`

**Files:**
- Create: `packages/server/src/api/providers/AdminRoleProvider.ts`
- Modify: `packages/server/src/api/index.ts:13-14` (import) and `:64-65` (the `services[]` array)
- Test: `packages/server/test-api/admin-roles.test.ts`

**Interfaces:**
- Consumes: `UserService.findUsers(q, userRealmName?): Promise<Page<UserEntity>>` and
  `UserService.updateUser(id, data: UpdateUser, userRealmName?): Promise<UserEntity>` from
  `alepha/api/users`.
- Produces: `class AdminRoleProvider` with `reconcile(): Promise<void>`, called from its own
  `$hook({ on: "ready" })`. Exported so the test can drive it directly.

- [ ] **Step 1: Write the failing test**

`packages/server/test-api/admin-roles.test.ts`, following the harness in that folder (it boots the
real Alepha app; see the existing tests for `createApp`/helper names and copy them exactly):

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w @lindocara/server -- admin-roles`
Expected: FAIL — `AdminRoleProvider` does not exist.

- [ ] **Step 3: Write the provider**

```ts
import { $env, $hook, $inject, z } from "alepha";
import { UserService } from "alepha/api/users";

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
 * happens to be absent — local dev, a contributor's checkout, the CI boot smoke — silently, at
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

export class AdminRoleProvider {
  env = $env(adminRoleEnvSchema);
  userService = $inject(UserService);
  log = $inject(Logger);

  ready = $hook({
    on: "ready",
    handler: async () => {
      await this.reconcile();
    },
  });

  async reconcile(): Promise<void> {
    const wanted = this.env.ADMIN_USERNAMES.split(",")
      .map((name) => name.trim())
      .filter((name) => name.length > 0);
    if (wanted.length === 0) return;

    const page = await this.userService.findUsers({ limit: 1000 });
    const byUsername = new Map(page.data.map((user) => [user.username, user]));

    for (const username of wanted) {
      const user = byUsername.get(username);
      if (!user) {
        this.log.warn("ADMIN_USERNAMES names an account that does not exist", { username });
        continue;
      }
      if (user.roles?.includes(ADMIN_ROLE)) continue;
      await this.userService.updateUser(user.id, {
        roles: [...(user.roles ?? []), ADMIN_ROLE],
      });
    }

    for (const user of page.data) {
      if (!user.roles?.includes(ADMIN_ROLE)) continue;
      if (user.username && wanted.includes(user.username)) continue;
      await this.userService.updateUser(user.id, {
        roles: user.roles.filter((role) => role !== ADMIN_ROLE),
      });
    }
  }
}
```

Resolve the exact `Logger` import, the `Page` field name (`data` vs `items`) and `findUsers`'
pagination argument against `.vendor/alepha/src/api/users/services/UserService.ts` — read it, do not
guess. If the realm holds more than 1000 accounts the single page is wrong; page through instead.

- [ ] **Step 4: Register the provider**

In `packages/server/src/api/index.ts`, import `AdminRoleProvider` beside
`HeightfieldBackfillProvider` (line 14) and add it to the `services[]` array (line 65). The array
membership is load-bearing — `AppSecurityProvider`'s docblock records that a provider left out of it
silently never runs.

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -w @lindocara/server -- admin-roles`
Expected: PASS, all four.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck:server
git add packages/server
git commit -m "feat(admin): grant the admin role from ADMIN_USERNAMES at boot"
```

---

### Task 2: The admin shell — sidebar, five pages, audits and API keys

**SUPERSEDES the tabs screen shipped in `43ff732d`.** That commit built a three-tab
`AdminScreen` whose Audits tab was wired to `AdminAuditController` — a controller in
`alepha/api/audits`, a module this app never registered. Opening it 401s, and `AppRouter`'s global
401 handler turns that into a bounce to `/auth`, effectively logging the admin out. Rather than drop
the tab, the human directed: enable audits AND API keys for real, and rebuild the screen as a
sidebar shell modelled on `~/git/alepha/apps/lore/src/web/admin/`.

**Files:**
- Modify: `packages/server/src/api/providers/AppSecurityProvider.ts` (add `features`)
- Create: `apps/main/migrations/sqlite/<timestamp>_admin_audits_and_keys/` (see Step 2)
- Delete: `packages/client/src/ui/admin/AdminScreen.tsx` and `packages/client/test/admin-screen.test.tsx`
- Create: `packages/client/src/ui/admin/AdminRouter.tsx` and `packages/client/src/ui/admin/AdminShell.tsx`
- Modify: `packages/client/src/ui/AppRouter.tsx` (mount the admin subtree in place of the single route)
- Modify: `packages/client/tsconfig.json` / `tsconfig.api.json` (swap the deleted paths for the new ones)
- Test: `packages/client/test/admin-shell.test.tsx`

**Interfaces:**
- Consumes: `AdminRoleProvider` from Task 1 (grants the `admin` role, whose permission is `*`).
- Produces: the route name `"admin"` at `/admin`, redirecting to `/admin/users`.

**THE MODEL — read it before writing anything:**
`~/git/alepha/apps/lore/src/web/admin/AppAdminRouter.tsx` and `AppAdminLayout.tsx`. Copy their
shape, not their content. The essentials:

- A layout page anchors the shell:
  `$page({ name: "admin", path: "/admin", use: [$secure({ permissions: ["admin:ui"] })], nav: { label: "Admin" }, loader: redirect "/admin" -> "/admin/users", lazy: () => import("./AdminShell.js") })`.
- Every leaf is `navPage` from `@alepha/ui/components/nav-shell/nav-page`, carrying its own
  `permission` and `nav: { label, icon, group, order }`, with `parent: this.adminLayout`.
  **The sidebar and breadcrumbs are DERIVED from this tree by `<NavShell root="admin">`** — there is
  no hand-maintained nav list, and you must not write one.
- `AdminShell` renders `<NavShell root="admin" fill brand={...} topbarActions={...} />`, plus
  `<ColorScheme />` (the admin subtree is not under the game's layout, so nothing else applies the
  dark class) and `<Spotlight root="admin" />`.

**The five pages**, all lazy-imported straight from `@alepha/ui/components/admin/`:

| path | component | permission | nav group |
| --- | --- | --- | --- |
| `/admin/users` | `admin-users` | `admin:user:read` | Identity |
| `/admin/users/:id` | `admin-user-detail` | `admin:user:read` | (no `nav` — routed, not listed) |
| `/admin/sessions` | `admin-sessions` | `admin:session:read` | Identity |
| `/admin/keys` | `admin-keys` | `admin:api-key:read` | Identity |
| `/admin/audits` | `admin-audits` | `admin:audit:read` | Operations |

`/admin/users/:id` takes `schema: { params: z.object({ id: z.uuid() }) }`. Adding it also fixes the
dead "View profile" link the Task 2 review flagged as a known limitation.

Pass `defaultHiddenColumns={["firstName", "lastName", "email"]}` to `admin-users`: this realm is
username-only (`AppSecurityProvider` sets `email: "none"`), so those columns are always blank.

**`$secure` on the layout route replaces the hand-rolled `has("admin:*")` check.** That also
resolves the Important finding against `43ff732d` — a synchronous `has()` gate rendered "not
authorised" to a real admin on first paint, before `ReactAuth.ping()` resolved. Do not reintroduce
a manual guard.

- [ ] **Step 1: Enable the two features**

In `packages/server/src/api/providers/AppSecurityProvider.ts`, add to the existing `$realm({...})`
call, beside `settings` and `identities`:

```ts
    features: {
      audits: true,
      apiKeys: true,
    },
```

This is the whole server change — `audits` and `apiKeys` are `$realm` FEATURE FLAGS, not modules to
register. Read `~/git/alepha/apps/lore/src/api/providers/AppSecurityProvider.ts` for the precedent
and `.vendor/alepha/src/api/users/primitives/$realm.ts` (around line 76) for how `features` merges
with defaults. Extend the class docblock to say what the two flags turn on and that the admin UI
depends on them.

- [ ] **Step 2: Write the migration by hand**

Enabling those features brings new entities, so the database needs new tables. **`npm run
db:generate` is BROKEN repo-wide** (a top-level `await` inside an `if` in `apps/main/src/main.ts`
defeats drizzle-kit's esbuild bundling, and every `alepha db` command boots that entry) — this is
documented in the root `CLAUDE.md`. So hand-write the migration under
`apps/main/migrations/sqlite/`, following the shape of the two most recent existing migration
directories exactly (both a `migration.sql` and a `snapshot.json`).

The gate is `npm run check:migrations -w @lindocara/main`, which is NOT affected by the drizzle-kit
breakage. It must pass. Derive the table shapes from the entities the two features register — read
them under `.vendor/alepha/src/api/`, do not invent columns.

If you cannot make `check:migrations` pass by hand, STOP and report BLOCKED with what you tried.
Do not commit a migration you have not verified against that check.

- [ ] **Step 3: Delete the superseded screen and write the shell**

Delete `AdminScreen.tsx` and `admin-screen.test.tsx`. Write `AdminRouter.tsx` and `AdminShell.tsx`
per the model above, and mount the subtree from `AppRouter.tsx` in place of the single `admin` route.
Read `AppRouter.tsx`'s existing `editor` route and its `children()` array to see how routes are
registered here — lindocara's router is one class, so adapt lore's separate-router shape to whatever
this codebase actually supports rather than forcing lore's file layout.

Update both tsconfigs: remove the two deleted paths, add the new ones to `tsconfig.api.json`'s
`include` and `tsconfig.json`'s `exclude`. Both new files import `alepha`, so both need the split.

- [ ] **Step 4: Test what is testable**

Keep the ruling from before: **negative branch only.** With `$secure` now gating the route, a
session without `admin:ui` should not reach the shell at all. Assert that — a non-admin landing on
`/admin` does not render the sidebar. Mount the real `AppRouter` the way
`packages/client/test/admin-screen.test.tsx` did before you delete it (that harness was reviewed and
found sound — reuse its `/_auth/userinfo` stub pattern rather than inventing another). Do not build a
permission-seeding harness; the admin path is proven in Task 4's browser pass.

- [ ] **Step 5: Verify and commit**

```bash
npm run check:migrations -w @lindocara/main
npm test -w @lindocara/client
npm run typecheck
npm run lint
git add -A
git commit -m "feat(admin): a sidebar admin shell with users, sessions, API keys and audits"
```

---

### Task 3: QUIT logs out, Escape does not

**Files:**
- Modify: `packages/client/src/ui/MainMenu.tsx:115-119` (the QUIT item), `:151` (the hint label),
  and the corner-button block at `:123-132`
- Modify: `packages/engine/src/i18n/en.ts` and `packages/engine/src/i18n/fr.ts` (`menu.admin` only)
- Test: `packages/client/test/main-menu.test.tsx`

**Interfaces:**
- Consumes: `getGameNavigation()` from `packages/client/src/state/navigation.js`, whose
  `GameNavigation` interface already declares `logout(): void`; `useAuth().has(permission)` from
  `alepha/react/auth` for the admin corner button only.
- Produces: nothing other tasks depend on.

**RULING (pre-flight, human-decided): QUIT goes through the NAVIGATION SEAM, not `useAuth()`.**
`AppRouter.tsx:231` already wires `logout: () => alepha.inject(ReactAuth).logout()`, so production
behaviour is identical either way — but the seam is the one CLAUDE.md documents as the thing "a test
installs a plain fake by reassignment" into. That keeps the plan's `No vi.mock` constraint intact
instead of amending it. Do not call `useAuth().logout()` from `MainMenu`.

- [ ] **Step 1: Write the failing test**

Install a plain fake navigation by reassignment — the seam's documented test path. Read
`packages/client/src/state/navigation.ts` for the setter's real name and the full `GameNavigation`
shape, and follow whatever existing test already installs a fake (grep the suite for it) rather than
inventing a second way.

```tsx
it("logs out when QUIT is activated", async () => {
  const logout = vi.fn();
  installFakeNavigation({ logout });
  renderMainMenu();
  await userEvent.click(screen.getByRole("button", { name: /quit/i }));
  expect(logout).toHaveBeenCalledTimes(1);
});

it("does NOT log out when Escape is pressed", async () => {
  // onBack and QUIT are the same harmless action today, and the hints row labels Escape "Quit".
  // Fusing them once QUIT logs out means a stray Escape on the main menu signs the player out.
  const logout = vi.fn();
  installFakeNavigation({ logout });
  renderMainMenu();
  await userEvent.keyboard("{Escape}");
  expect(logout).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w @lindocara/client -- main-menu`
Expected: FAIL — QUIT currently pushes `title` and calls no logout.

- [ ] **Step 3: Make the three edits**

1. The QUIT item's `onActivate` becomes `() => getGameNavigation()?.logout()` (see the ruling
   above — NOT `useAuth().logout()`). Leave the `menu.quit` label and the `⎋` icon alone — the
   button is still called Quit.
2. `<MenuNav onBack={() => void router.push("title")}>` stays **exactly as it is**.
3. The hint at line 151 changes from `{t("menu.quit")}` to `{t("menu.hint.back")}` — it labels the
   Escape/B key, which still goes back to the title screen, so it must stop claiming to quit.
   Both dictionaries already carry that key ("Back" / "Retour"); nothing to add.

- [ ] **Step 4: Add the admin corner button**

Beside the existing `main-menu__editor` button, rendered only when `useAuth().has("admin:*")`, using
the same discreet styling and pushing `router.push("admin")`. Add `menu.admin` to **both**
dictionaries ("Admin" / "Admin") — `packages/engine/test/i18n.test.ts` enforces en/fr parity and
fails on a key present in one only.

Hiding the button is an affordance, not a fence: `/admin` stays reachable by URL and the server
guard is what actually refuses.

- [ ] **Step 5: Run to verify it passes**

```bash
npm test -w @lindocara/client -- main-menu
npm test -w @lindocara/engine -- i18n
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/client packages/engine
git commit -m "fix(menu): QUIT ends the session, Escape still just goes back"
```

---

### Task 4: Verify it for real

- [ ] **Step 1: Full check**

```bash
npm run check
```

- [ ] **Step 2: Drive it in a browser**

Boot with the variable set, then use the `playwright-cli` skill (never the Claude-in-Chrome
extension) against `http://localhost:5273`:

```bash
ADMIN_USERNAMES=<your-username> npm run dev
```

Confirm, with a screenshot each: the ADMIN corner button appears on the menu for that account and
not for a fresh one; `/admin` lists users, sessions and audits; QUIT returns you to a logged-out
title screen; **Escape from the menu goes back to the title with the session intact.**

- [ ] **Step 3: Document the variable**

Add `ADMIN_USERNAMES` to the root `CLAUDE.md`'s Secrets section beside the three existing `$env`
primitives, noting it is inert when unset and authoritative when set.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: record ADMIN_USERNAMES beside the other \$env primitives"
```

---

## Self-review notes

- **Spec coverage:** grant mechanism → Task 1; route + screen + guard + tsconfig split → Task 2;
  QUIT/Escape separation + entry button → Task 3; testing and docs → Task 4. The spec's "no new admin
  API" and "no jobs/files/notifications/payments tabs" are honoured by omission and stated in Task 2.
- **Spec correction applied:** `menu.hint.back` already exists in both dictionaries; only
  `menu.admin` is new.
- **Type consistency:** `AdminRoleProvider.reconcile(): Promise<void>` is used identically in Task
  1's test and implementation. `useAuth().has(permission: string): boolean` and `logout(): void` are
  used identically in Tasks 2 and 3.
- **Known unknowns the implementer must read rather than guess:** the `Logger` import path, the
  `Page` result field on `findUsers`, and whether `packages/client/test/` already has a harness that
  can seed permissions. Each is named at its step.
