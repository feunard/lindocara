import type { AdminRouterOptions } from "@alepha/ui/components/admin/admin-router-options";
import { ButtonLanguage } from "@alepha/ui/components/button-language/button-language";
import { ButtonUser } from "@alepha/ui/components/button-user/button-user";
import { useRouter } from "alepha/react/router";
import { ArrowLeft, LayoutDashboard } from "lucide-react";
import type { AppRouter } from "../AppRouter.js";

/**
 * This app's chrome for the vendored admin shell (`@alepha/ui/components/admin/admin-router`),
 * following lore's `adminChrome.tsx` shape. It replaced the hand-written `AdminShell.tsx` — the
 * shell, sidebar, breadcrumbs, Spotlight and the ⌘K affordance are all upstream's now; what stays
 * here is exactly what is specific to hosting `/admin` inside a game page, expressed through
 * `AdminRouterOptions` instead of a parallel layout.
 *
 * Hook-needing chrome is a component, not inline JSX: `lindocaraAdminOptions` is a plain object
 * built once at module scope, and `router.push` needs a router — the same reason lore's
 * `AdminBrand` is its own component.
 */

/** The sidebar brand: a back-arrow to the main menu beside the "Admin" title. */
const AdminBrand = () => {
  const router = useRouter<AppRouter>();

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:justify-center">
      <button
        type="button"
        onClick={() => void router.push("menu")}
        aria-label="Back to menu"
        className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-7 shrink-0 items-center justify-center rounded-md transition-colors"
      >
        <ArrowLeft className="size-4" />
      </button>
      <LayoutDashboard className="size-4 shrink-0 group-data-[collapsible=icon]:hidden" />
      <span className="text-sm font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
        Admin
      </span>
    </div>
  );
};

/**
 * The topbar cluster. Replacing `topbarActions` costs nothing it shouldn't: the upstream layout
 * keeps the ⌘K search affordance outside the replaceable slot (its Spotlight state is local to the
 * layout), so this cluster only needs the language toggle and the account menu.
 *
 * - No `<ButtonDark />`, deliberately — the console is LIGHT-ONLY, exactly like `.editor-root`.
 *   `.admin-root` re-declares the light shadcn tokens directly on the element (`styles/legacy.css`),
 *   and an element-level declaration beats anything `html.dark` sets on an ancestor, so a dark-mode
 *   toggle here could flip the atom and still repaint nothing. Making it work would take a
 *   `.dark .admin-root` token block; that is a deliberate non-goal, not an oversight.
 * - The vendored default `ButtonUser.LogoutMenuItem`. This used to be a hand-rolled item routed
 *   through the navigation seam, because the default's plain `useAuth().logout()` skipped both
 *   halves of a sign-out contract that mattered then: forgetting the stored guest credential, and
 *   suppressing the automatic guest for one boot. Without those, signing out revoked the named
 *   session and `bootPing` signed the browser straight back in as a guest — a junk account per
 *   press. Guest accounts are gone and the seam's `logout` is now literally `ReactAuth.logout()`,
 *   so the bespoke item guarded nothing and the default is the same call with less code.
 * - No `ButtonUser.AdminMenuItem`: the account menu already lives inside `/admin`, and the
 *   brand's back-arrow above is the way out.
 * - `onSignIn` pushes the route NAME, `login` — the sign-in screen's URL `path` is still `/auth`;
 *   see `AppRouter.tsx`'s `login` field docblock for why the two deliberately differ.
 */
const AdminTopbarActions = () => {
  const router = useRouter<AppRouter>();

  return (
    <>
      <ButtonLanguage />
      <ButtonUser onSignIn={() => void router.push("login")}>
        <ButtonUser.Email />
        <ButtonUser.LogoutMenuItem />
      </ButtonUser>
    </>
  );
};

/**
 * Set on the browser entry (`apps/main/src/main.browser.ts`) via
 * `alepha.set(adminRouterOptionsAtom, lindocaraAdminOptions)`, before start. The server entry does
 * not set it: this app's root layout is `ssr: false`, so the only reader of these options renders
 * in the browser — and the object carries React nodes, which would not survive an SSR payload
 * anyway (the atom's own docblock).
 */
export const lindocaraAdminOptions: AdminRouterOptions = {
  // The same fence `.editor-root` is, and for the same two reasons — see `styles/legacy.css`. It
  // lifts the shell above `body::after` (the game's fixed vignette at z-index 2, which otherwise
  // washes the whole console out), and it re-declares the LIGHT shadcn tokens, because
  // `index.html` sets `<html class="dark">` for the game's own chrome and stock shadcn components
  // would otherwise resolve their semantic tokens dark on a light surface. Without it the console
  // renders the game's parchment `#f4f0df` text on white — verified in a real browser, and
  // invisible to the test suite, which runs with `css: false`.
  className: "admin-root",
  // `<ColorScheme />`'s only job is to mirror the dark-mode atom onto `<html>` — which, since
  // `index.html` hardcodes `<html class="dark">` for the game's own chrome and nothing else
  // manages it, would mean a route-local component silently mutating the whole document's theme
  // class and never restoring it on the way out.
  colorScheme: false,
  brand: <AdminBrand />,
  topbarActions: <AdminTopbarActions />,
  pages: {
    // This realm is username-only (`AppSecurityProvider` sets `email: "none"`), so
    // `firstName`/`lastName`/`email` are always blank — hide them rather than show empty columns.
    users: {
      defaultHiddenColumns: ["firstName", "lastName", "email"],
    },
  },
};
