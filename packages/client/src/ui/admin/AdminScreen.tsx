/**
 * The `/admin` console — a thin shell over alepha's own ready-made admin components
 * (`@alepha/ui/components/admin/*`). This is a NON-GAME, creator-tools surface, so it uses
 * `@alepha/ui` exclusively — never `ui/tiny-swords/` (see the repo AGENTS.md's two-component-trees
 * rule).
 *
 * Three tabs only — Users, Sessions, Audits — because those are the only alepha admin subsystems
 * this app registers (`AdminUserController`/`AdminSessionController`/`AdminIdentityController`, see
 * `packages/server/src/api/index.ts`). Jobs, files, notifications and payments are deliberately
 * absent: this app never registers those alepha subsystems, so their admin panels would render
 * empty or erroring shells.
 *
 * `AdminUsers` hides `firstName`/`lastName`/`email` by default — this realm is username-only
 * (`AppSecurityProvider` sets `email: "none"`), so those columns would always read blank.
 *
 * The `has("admin:*")` gate below is a courtesy, not a security boundary: every admin route and
 * action is `$secure`d server-side (`AdminRoleProvider` grants the role from `ADMIN_USERNAMES`)
 * regardless of what this component renders. It exists only so a non-admin sees one honest
 * sentence instead of a page of failed requests.
 */
import { AdminAudits } from "@alepha/ui/components/admin/admin-audits";
import { AdminSessions } from "@alepha/ui/components/admin/admin-sessions";
import { AdminUsers } from "@alepha/ui/components/admin/admin-users";
import { Button } from "@alepha/ui/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@alepha/ui/components/ui/tabs";
import { useAuth } from "alepha/react/auth";
import { useRouter } from "alepha/react/router";
import type { AppRouter } from "../AppRouter.js";

export function AdminScreen() {
  const { has } = useAuth();
  const router = useRouter<AppRouter>();

  if (!has("admin:*")) {
    return (
      <div className="admin-screen admin-screen--forbidden flex min-h-0 flex-1 flex-col items-start gap-3 p-6">
        <p>You are not authorised to view this page.</p>
        <Button type="button" variant="outline" onClick={() => void router.push("menu")}>
          Back to menu
        </Button>
      </div>
    );
  }

  return (
    <Tabs defaultValue="users" className="admin-screen min-h-0 flex-1 p-6">
      <TabsList>
        <TabsTrigger value="users">Users</TabsTrigger>
        <TabsTrigger value="sessions">Sessions</TabsTrigger>
        <TabsTrigger value="audits">Audits</TabsTrigger>
      </TabsList>
      <TabsContent value="users">
        <AdminUsers defaultHiddenColumns={["firstName", "lastName", "email"]} />
      </TabsContent>
      <TabsContent value="sessions">
        <AdminSessions />
      </TabsContent>
      <TabsContent value="audits">
        <AdminAudits />
      </TabsContent>
    </Tabs>
  );
}
