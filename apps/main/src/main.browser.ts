// The deployable app's BROWSER entry, on Alepha's `src/main.browser.ts` convention
// (`AppEntryProvider`). The dev server serves this file at `/src/main.browser.ts` and
// `alepha build` bundles it as the client entry; `main.ts` (the server entry) registers the same
// `AppRouter` class so the `$page` tree is also what serves the shell (see its docblock — the
// deleted `SpaController` used to own that).
//
// `bootClient()` is the client's shared pre-mount bootstrap (locale, theme, the `#stage` canvas,
// the `?preview` dev shortcut) — it must run, and the `#stage` canvas in particular must exist,
// BEFORE Alepha mounts the router tree into `#root` (see `main.tsx`'s docblock on why `prepend`
// is safe). `?preview` takes the whole page over itself and returns `false`, so the router never
// mounts on top of it.
import { bootClient } from "@lindocara/client/main.js";
import { AppRouter } from "@lindocara/client/ui/AppRouter.js";
import { Alepha, run } from "alepha";
import { reactBrowserOptions } from "alepha/react/router";

if (bootClient()) {
  const alepha = Alepha.create();
  // A game+editor app has no content anchors to intercept (see the plan's Global Constraints):
  // `interceptAnchorClicks` is a foot-gun so close to the canvas, and the whole app is one
  // full-viewport view with nothing to scroll, so restoration is manual (there is no "top" to
  // snap back to that isn't already there).
  alepha.set(reactBrowserOptions, { scrollRestoration: "manual", interceptAnchorClicks: false });
  alepha.with(AppRouter);
  run(alepha);
}
