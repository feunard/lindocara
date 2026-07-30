import { useEffect } from "react";
import { fetchMe } from "../api.js";
import { continueAsGuest } from "../guest.js";
import { useLocale } from "../i18n.js";
import { LocaleToggle } from "./LocaleToggle.js";
import { SettingsMenu } from "./SettingsMenu.js";
import { StatusBar } from "./StatusBar.js";

/**
 * The pre-router screen machine — the rollback-only counterpart to `ui/AppRouter.tsx`'s `$page`
 * tree, mounted by `main.tsx`'s `mountLegacyApp()` on the separate `vite.legacy.config.ts`
 * Cloudflare-Worker deploy (`npm run dev:legacy`/`deploy:legacy`), which does not (and, being a
 * plain pre-Alepha React tree, cannot) install the `state/navigation.ts` seam `AppRouter.tsx`'s
 * layout installs on mount.
 *
 * Formerly `App.tsx`/`export function App()` — Task 5 renamed both the file and the component
 * once the real `App` concept (the thing that owns the whole UI) fully became `AppRouter.tsx`'s
 * `$page` tree.
 *
 * **Task 6 empties this shell's body entirely.** `screen` used to be a zustand field every screen
 * component (`TitleScreen`, `MainMenu`, `CreditsScreen`, …) wrote through the store's `setScreen`;
 * Task 2 turned that into a deprecated shim routed through a navigation seam this mount never
 * installs (a harmless no-op click, same as Task 2/3 already made of the HUD tree and the auth/
 * launch screens respectively — see the prior revisions of this docblock for that trajectory).
 * Task 6 finishes the job: `TitleScreen`/`MainMenu`/`CreditsScreen` now call `useRouter()` directly
 * (the shim is gone, `store.ts` no longer has a `screen` field OR a `setScreen` shim at all), and
 * the editor screen the old `AdventureEditorScreen` `Suspense` branch below used to lazy-load now
 * reads `useStore(adventureEditorSessionAtom)`/`useRouter()` too. `useRouter()`/`useStore()` THROW
 * HARD with no `AlephaContext.Provider` (`useAlepha()`: "must be used within an AlephaContext.
 * Provider" — the same failure mode Task 3's report already documented for `AuthScreen`), not a
 * silent no-op like the old shim. Worse: because a dynamic `import()` still resolves and
 * type-checks its target module for the SAME `tsc` program that contains the importing file
 * (confirmed empirically — `npm run typecheck:client`'s STRICT `tsconfig.json` program, which this
 * file lives in, failed by the hundreds once `@lindocara/editor`'s own source started importing
 * `alepha/react*` transitively, the exact cascade `tsconfig.api.json`'s own docblock predicts for
 * any file that resolves `alepha`'s raw-source `types` export), keeping even the LAZY editor import
 * here would have broken `typecheck:client` outright, not just crashed at runtime. So all four
 * imports/render branches — `TitleScreen`, `MainMenu`, `CreditsScreen` and the lazy
 * `AdventureEditorScreen` — are dropped, not just their usages: this mount renders LocaleToggle/
 * StatusBar/SettingsMenu chrome over a blank body and nothing else. The boot effect below still
 * runs (a harmless plain-`fetch` guest-session bootstrap, unchanged), kept for parity with the
 * live app's own boot behaviour even though nothing here reads its outcome to decide what to show.
 *
 * No test exercises `dev:legacy`, so nothing catches this red automatically if it regresses
 * further — flagging explicitly, same as the Task 2/3 reports already did for this same file's
 * shrinking interactive surface. The full legacy-stack retirement is its own later tranche (see
 * the plan's "Explicitly deferred" section); until then this file's only remaining job is to keep
 * `npm run build:legacy`/`typecheck:client` green.
 */
export function LegacyShell() {
  useLocale();

  useEffect(() => {
    void (async () => {
      const me = await fetchMe();
      if (me) return;
      await continueAsGuest().catch(() => {
        // Nothing in this frozen shell reacts to a failed guest bootstrap — see the docblock.
      });
    })();
  }, []);

  return (
    <>
      <LocaleToggle />
      <StatusBar />
      <SettingsMenu inGame={false} />
    </>
  );
}
