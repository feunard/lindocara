import { $pageNav } from "@alepha/ui/components/nav-shell/nav-page";
import { z } from "alepha";
import { $page, Redirection } from "alepha/react/router";
import { $secure } from "alepha/security";
import { KeyRound, ShieldAlert, ShieldCheck, UsersIcon } from "lucide-react";

/**
 * The `/admin` route subtree — modelled on `~/git/alepha/apps/lore/src/web/admin/
 * AppAdminRouter.tsx`, adapted to this app's single-`AppRouter`-class shape (lore keeps a
 * separate router class registered as its own `$module`; this app instead injects `AdminRouter`
 * into `AppRouter` and adopts `adminLayout` into the root layout's `children()` — see
 * `PagePrimitiveOptions.children`'s own docblock, which documents exactly this "pages from an
 * injected router in another package" case).
 *
 * Each leaf is `$pageNav` from `@alepha/ui/components/nav-shell/nav-page`, which co-locates the
 * page's permission (wired into both the `$secure` route gate and the nav-entry gate) and its
 * `nav` metadata (label / icon / group / order). **The sidebar and breadcrumbs in `AdminShell` are
 * DERIVED from this tree by `<NavShell root="admin">`** — there is no separate hand-maintained nav
 * list, and none should be added here.
 *
 * This app registers no `alepha.api.jobs`/`files`/`notifications`/`payments` admin surfaces (see
 * `AppSecurityProvider`'s `features`), so — unlike lore, which lists eight pages — only the five
 * this app actually backs are declared: users, the user detail route (routed, not listed — fixes
 * the dead "View profile" link `admin-users` already pushes to), sessions, API keys and audits.
 */
export class AdminRouter {
  adminLayout = $page({
    name: "admin",
    path: "/admin",
    // Replaces the hand-rolled `has("admin:*")` check the superseded `AdminScreen` used — that
    // synchronous check rendered "not authorised" to a real admin on first paint, before
    // `ReactAuth.ping()` resolved. `$secure` is enforced server-side and is the only guard here.
    use: [$secure({ permissions: ["admin:ui"] })],
    // Anchors the shell + first breadcrumb ("Admin"). Not itself a nav entry (the shell root is
    // excluded from its own sidebar).
    nav: { label: "Admin" },
    loader: async ({ url }) => {
      if (url.pathname === "/admin" || url.pathname === "/admin/") {
        throw new Redirection("/admin/users");
      }
      return {};
    },
    lazy: () => import("./AdminShell.js"),
  });

  adminUsers = $pageNav({
    path: "/users",
    head: { title: "Users" },
    permission: "admin:user:read",
    nav: { label: "Users", icon: <UsersIcon />, group: "Identity", order: 1 },
    lazy: () => import("@alepha/ui/components/admin/admin-users"),
    // This realm is username-only (`AppSecurityProvider` sets `email: "none"`), so
    // `firstName`/`lastName`/`email` are always blank — hide them rather than show empty columns.
    props: () => ({
      defaultHiddenColumns: ["firstName", "lastName", "email"] as const,
    }),
    parent: this.adminLayout,
  });

  adminUserDetail = $pageNav({
    path: "/users/:id",
    head: { title: "User" },
    permission: "admin:user:read",
    // No `nav` → secured route, but not a sidebar entry. Breadcrumb label falls back to
    // `head.title`. `admin-users`' own row action already pushes `/admin/users/${id}` by raw path
    // (`AdminUsers.tsx:378,477`), so declaring this route is what makes that link land instead of
    // 404ing.
    schema: {
      params: z.object({
        id: z.uuid(),
      }),
    },
    lazy: () => import("@alepha/ui/components/admin/admin-user-detail"),
    parent: this.adminLayout,
  });

  adminSessions = $pageNav({
    path: "/sessions",
    head: { title: "Sessions" },
    permission: "admin:session:read",
    nav: {
      label: "Sessions",
      icon: <ShieldCheck />,
      group: "Identity",
      order: 2,
    },
    lazy: () => import("@alepha/ui/components/admin/admin-sessions"),
    parent: this.adminLayout,
  });

  adminKeys = $pageNav({
    path: "/keys",
    head: { title: "API keys" },
    permission: "admin:api-key:read",
    nav: {
      label: "API keys",
      icon: <KeyRound />,
      group: "Identity",
      order: 3,
      keywords: ["tokens", "credentials"],
    },
    lazy: () => import("@alepha/ui/components/admin/admin-keys"),
    parent: this.adminLayout,
  });

  adminAudits = $pageNav({
    path: "/audits",
    head: { title: "Audit log" },
    permission: "admin:audit:read",
    nav: {
      label: "Audit log",
      icon: <ShieldAlert />,
      group: "Operations",
      order: 4,
    },
    lazy: () => import("@alepha/ui/components/admin/admin-audits"),
    parent: this.adminLayout,
  });
}
