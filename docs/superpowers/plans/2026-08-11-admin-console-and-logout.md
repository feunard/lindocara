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

### Task 2: The `/admin` screen and route

**Files:**
- Create: `packages/client/src/ui/admin/AdminScreen.tsx`
- Modify: `packages/client/src/ui/AppRouter.tsx` (a new `admin = $page({...})` beside `editor`)
- Modify: `packages/client/tsconfig.json` (add the file to `exclude`) and
  `packages/client/tsconfig.api.json` (add it to `include`)
- Test: `packages/client/test/admin-screen.test.tsx`

**Interfaces:**
- Consumes: `useAuth()` from `alepha/react/auth`, which returns
  `{ user, logout(), login(), has(permission: string): boolean }`.
- Produces: `export function AdminScreen(): JSX.Element`, and the router route name `"admin"` at
  path `/admin` for `router.push("admin")`.

- [ ] **Step 1: Write the failing test**

```tsx
describe("AdminScreen", () => {
  it("renders the not-authorised panel when the session lacks admin", () => {
    // A courtesy, not a security boundary: the server's $secure guards every route regardless.
    // This exists so a non-admin sees one honest sentence instead of a page of failed requests.
    renderWithAlepha(<AdminScreen />, { permissions: [] });
    expect(screen.getByText(/not authorised/i)).toBeTruthy();
    expect(screen.queryByRole("tab", { name: /users/i })).toBeNull();
  });

  it("renders the three admin tabs for an admin session", () => {
    renderWithAlepha(<AdminScreen />, { permissions: ["admin:*"] });
    expect(screen.getByRole("tab", { name: /users/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /sessions/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /audits/i })).toBeTruthy();
  });
});
```

`renderWithAlepha` is whatever the package's existing jsdom tests use to mount a component inside
the Alepha React providers — find it in `packages/client/test/` and reuse it rather than inventing a
second harness. If none exists that can seed permissions, the honest minimum is the first test only,
driving `has()` through the real provider.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w @lindocara/client -- admin-screen`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the screen**

```tsx
import { AdminAudits } from "@alepha/ui/components/admin/admin-audits";
import { AdminSessions } from "@alepha/ui/components/admin/admin-sessions";
import { AdminUsers } from "@alepha/ui/components/admin/admin-users";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@alepha/ui/components/ui/tabs";
import { useAuth } from "alepha/react/auth";
```

Three tabs — Users, Sessions, Audits — each rendering the matching component. Not jobs, files,
notifications or payments: this app registers none of those alepha subsystems, so they would render
empty or erroring shells.

`AdminUsers` takes `defaultHiddenColumns`; pass `["firstName", "lastName", "email"]` — this realm is
username-only (`AppSecurityProvider` sets `email: "none"`), so those columns are always blank.

Gate the whole thing on `useAuth().has("admin:*")`, rendering a short panel with a link back to the
menu otherwise.

- [ ] **Step 4: Add the route**

In `AppRouter.tsx`, beside `editor`:

```ts
  admin = $page({
    path: "/admin",
    lazy: async () => {
      const module = await import("./admin/AdminScreen.js");
      return { default: module.AdminScreen };
    },
  });
```

Lazy for the same reason `editor` is: the game shell should not carry the admin bundle. Note
`$page`'s `lazy` contract is `() => Promise<{ default: FC }>` and `AdminScreen` is a named export —
the reshaping return is required, not decoration.

- [ ] **Step 5: Fix the tsconfig split**

Add `"src/ui/admin/AdminScreen.tsx"` to `packages/client/tsconfig.json`'s `exclude` and to
`packages/client/tsconfig.api.json`'s `include`, beside the existing `src/ui/MainMenu.tsx` entries.

- [ ] **Step 6: Run to verify it passes**

```bash
npm test -w @lindocara/client -- admin-screen
npm run typecheck:client
```
Expected: PASS, and both client programs typecheck.

- [ ] **Step 7: Commit**

```bash
git add packages/client
git commit -m "feat(admin): an /admin console over alepha's users, sessions and audits"
```

---

### Task 3: QUIT logs out, Escape does not

**Files:**
- Modify: `packages/client/src/ui/MainMenu.tsx:115-119` (the QUIT item), `:151` (the hint label),
  and the corner-button block at `:123-132`
- Modify: `packages/engine/src/i18n/en.ts` and `packages/engine/src/i18n/fr.ts` (`menu.admin` only)
- Test: `packages/client/test/main-menu.test.tsx`

**Interfaces:**
- Consumes: `useAuth()` from Task 2's notes — `logout()` and `has(permission)`.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Write the failing test**

```tsx
it("logs out when QUIT is activated", async () => {
  const logout = vi.fn();
  renderMainMenu({ logout });
  await userEvent.click(screen.getByRole("button", { name: /quit/i }));
  expect(logout).toHaveBeenCalledTimes(1);
});

it("does NOT log out when Escape is pressed", async () => {
  // onBack and QUIT are the same harmless action today, and the hints row labels Escape "Quit".
  // Fusing them once QUIT logs out means a stray Escape on the main menu signs the player out.
  const logout = vi.fn();
  renderMainMenu({ logout });
  await userEvent.keyboard("{Escape}");
  expect(logout).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w @lindocara/client -- main-menu`
Expected: FAIL — QUIT currently pushes `title` and calls no logout.

- [ ] **Step 3: Make the three edits**

1. The QUIT item's `onActivate` becomes `() => logout()` from `useAuth()`. Leave the `menu.quit`
   label and the `⎋` icon alone — the button is still called Quit.
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
