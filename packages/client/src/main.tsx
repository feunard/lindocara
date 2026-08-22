import { installTinySwordsTheme } from "@lindocara/renderer/tiny-swords-assets.js";

import { currentLocale } from "./i18n.js";

import "./styles/app.css";

document.documentElement.lang = currentLocale();
installTinySwordsTheme();

/**
 * The client's shared pre-mount bootstrap (locale, theme), run by the Alepha browser entry
 * (`apps/main/src/main.browser.ts`, which goes on to mount the `$page` router from
 * `ui/AppRouter.js`). Returns whether the caller should go on to mount its app at all.
 *
 * It no longer creates the `#stage` canvas. That element now belongs to whoever renders into it
 * (`game/stage-canvas.ts`), because a bootstrap cannot know when the last of them is finished —
 * and creating it here meant every page carried a full-viewport GPU surface it never drew into,
 * including the title, sign-in and the admin console.
 *
 * `?preview` takes over the whole page itself (see `dev/preview-route.ts`) and must be the only
 * thing touching `#stage`/`#root` from then on — mounting a real app on top of it would fight it
 * for the canvas. `import.meta.env.DEV` keeps the route out of production builds.
 */
export function bootClient(): boolean {
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has("preview")) {
    void import("./dev/preview-route.js").then((module) => {
      const request = module.previewRequest(window.location.search);
      if (request) return module.startPreviewRoute(request);
      return undefined;
    });
    return false;
  }
  return true;
}
