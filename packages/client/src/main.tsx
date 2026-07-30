import { applyTinySwordsTheme } from "@lindocara/renderer/tiny-swords-assets.js";
import { currentLocale } from "./i18n.js";
import "./styles/app.css";

document.documentElement.lang = currentLocale();
applyTinySwordsTheme();

/**
 * The canvas is not React's (see the repo AGENTS.md gotcha) — a `position: fixed` sibling of
 * `#root`, and it must stay BEFORE `#root` in DOM order so `#root`'s chrome paints on top of it.
 * It used to arrive pre-built in the served HTML shell (the server's now-deleted `SpaController`);
 * the `$page` router's own shell only emits `#root` (Alepha's `ViteUtils.generateIndexHtml`), so
 * the client bootstrap creates it here, before anything mounts. `prepend` is safe precisely
 * because `#root` is ALREADY in the served HTML by the time this module runs — nothing needs to
 * reorder around it, the canvas just needs to land before it.
 */
function ensureStage(): void {
  if (document.querySelector("#stage")) return;
  const canvas = document.createElement("canvas");
  canvas.id = "stage";
  document.body.prepend(canvas);
}

/**
 * The client's shared pre-mount bootstrap (locale, theme, the canvas), run by the Alepha browser
 * entry (`apps/main/src/main.browser.ts`, which goes on to mount the `$page` router from
 * `ui/AppRouter.js`). Returns whether the caller should go on to mount its app at all.
 *
 * `?preview` takes over the whole page itself (see `dev/preview-route.ts`) and must be the only
 * thing touching `#stage`/`#root` from then on — mounting a real app on top of it would fight it
 * for the canvas. `import.meta.env.DEV` keeps the route out of production builds.
 */
export function bootClient(): boolean {
  ensureStage();
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
