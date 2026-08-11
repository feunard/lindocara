import { ButtonDark } from "@alepha/ui/components/button-dark/button-dark";
import { ButtonLanguage } from "@alepha/ui/components/button-language/button-language";
import { ButtonUser } from "@alepha/ui/components/button-user/button-user";
import { NavShell } from "@alepha/ui/components/nav-shell/nav-shell";
import { Spotlight } from "@alepha/ui/components/nav-shell/spotlight";
import { useRouter } from "alepha/react/router";
import { ColorScheme } from "alepha/react/ui";
import { ArrowLeft, LayoutDashboard, Search } from "lucide-react";
import { useState } from "react";
import type { AppRouter } from "../AppRouter.js";

/**
 * The `/admin` shell — modelled on `~/git/alepha/apps/lore/src/web/admin/AppAdminLayout.tsx`. The
 * sidebar nav and breadcrumb trail are derived from the admin route subtree (anchored at the
 * `admin` layout page, `AdminRouter.adminLayout`) by `<NavShell>` — each page carries its own
 * `nav` metadata in `AdminRouter.tsx`, so there is no hand-synced nav list here. This component
 * only supplies the chrome: brand, language / dark-mode toggles and the account menu.
 *
 * This is a NON-GAME, creator-tools surface, so it uses `@alepha/ui` exclusively — never
 * `ui/tiny-swords/` (see the repo CLAUDE.md's two-component-trees rule).
 */
export function AdminShell() {
  const router = useRouter<AppRouter>();
  const [spotlightOpen, setSpotlightOpen] = useState(false);

  return (
    // `h-svh` bounds the shell at the viewport. Combined with `fill` on NavShell/AppShell
    // (switches SidebarProvider from `min-h-svh` to `h-full`), this lets the table body scroll
    // inside the main area instead of pushing the whole page taller.
    // `admin-root` is the same fence `.editor-root` is, and for the same two reasons — see
    // `styles/legacy.css`. It lifts the shell above `body::after` (the game's fixed vignette at
    // z-index 2, which otherwise washes the whole console out), and it re-declares the LIGHT shadcn
    // tokens, because `index.html` sets `<html class="dark">` for the game's own chrome and stock
    // shadcn components would otherwise resolve their semantic tokens dark on a light surface.
    // Without it the console renders the game's parchment `#f4f0df` text on white — verified in a
    // real browser, and invisible to the test suite, which runs with `css: false`.
    <div className="admin-root flex h-svh flex-col">
      {/* `/admin` is not under the game's own chrome effects, so nothing else applies the
        dark/light class to <html> — without this, the dark-mode toggle below would flip the atom
        but no subscriber would ever paint it. */}
      <ColorScheme />
      <NavShell
        root="admin"
        fill
        brand={
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
        }
        topbarActions={
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setSpotlightOpen(true)}
              className="text-muted-foreground hover:bg-accent hover:text-foreground hidden h-8 items-center gap-2 rounded-md border px-2 text-sm transition-colors sm:flex"
            >
              <Search className="size-4 shrink-0" />
              <span>Search…</span>
              <kbd className="bg-muted text-muted-foreground pointer-events-none ml-2 hidden rounded px-1.5 font-mono text-[10px] md:inline">
                ⌘K
              </kbd>
            </button>
            <div aria-hidden="true" className="bg-border mx-1 h-5 w-px shrink-0" />
            <ButtonLanguage />
            <ButtonDark />
            {/* No `onAdminClick`: unlike the game menu's corner button (which enters `/admin`),
              this button is already inside `/admin` — there is nowhere useful for it to send the
              user, so the default menu's "Admin Panel" item stays hidden and only Logout shows. */}
            {/* Pushes the route NAME, `login` (Task 2 fix round 3) — the sign-in screen's URL
              `path` is still `/auth`; see `AppRouter.tsx`'s `login` field docblock for why the two
              deliberately differ. */}
            <ButtonUser onSignIn={() => void router.push("login")} />
          </div>
        }
      />
      <Spotlight root="admin" open={spotlightOpen} onOpenChange={setSpotlightOpen} />
    </div>
  );
}

export default AdminShell;
