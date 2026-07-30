/**
 * Serves the SPA shell — the one HTML document the whole game client boots from.
 *
 * Why this exists: `alepha dev` (and the Node production server) routes every request Vite's
 * built-in middleware doesn't claim into Alepha's router, and an app without `alepha/react`'s
 * `$page` machinery has NOTHING answering `GET /` — Task 10 proved the whole realtime chain at
 * wire level against a 404 landing page. The React-shell refactor ($page router, atoms) is a
 * later tranche; until then this controller is the smallest framework-idiomatic mechanism that
 * serves the client: a plain `$route` returning the same DOM the legacy `apps/main/index.html`
 * served.
 *
 * The body skeleton is load-bearing and must stay byte-compatible with the legacy markup:
 * `<canvas id="stage">` is a SIBLING of `#root`, placed before it — the canvas is NOT React's
 * (see the repo AGENTS.md gotcha "The canvas is not React's"); `@lindocara/renderer` takes it
 * over directly and `#root` mounts the React chrome above it.
 *
 * Two head variants:
 * - Dev (`VITE_ALEPHA_DEV`, set by `ViteDevServerProvider` while the app module loads, read back
 *   through `alepha.env` because the provider restores `process.env` after boot): Vite's client,
 *   the React Fast Refresh preamble (the dev server transforms every client module with
 *   `@vitejs/plugin-react`; without the preamble the browser throws "can't detect preamble" —
 *   this is Vite's documented backend-integration snippet), then the `src/main.browser.ts`
 *   entry. The framework's own `generateDevHead` is React-gated (`hasReact()`), so it cannot be
 *   reused here — noted as an upstream feature request (non-React apps get no shell at all).
 * - Production: the built entry + css resolved from the embedded client manifest
 *   (`alepha.react.ssr.manifest` — misleadingly named but written by `BuildServerTask` for EVERY
 *   app with a browser entry, React or not). The Cloudflare deploy tranche may supersede this
 *   with platform-served static assets; on the Node runtime this route is the answer.
 */

import { $inject, Alepha } from "alepha";
import { $route } from "alepha/server";

/**
 * The subset of the embedded client manifest this controller reads (see `ssrManifestAtom` in
 * `alepha/react` for the full shape — not imported to keep `alepha/react` out of this module).
 */
interface ClientManifestChunk {
  file: string;
  isEntry?: boolean;
  css?: string[];
}

interface EmbeddedManifest {
  client?: Record<string, ClientManifestChunk>;
  favicon?: string;
}

/**
 * Vite's documented backend-integration preamble for `@vitejs/plugin-react`. Inline scripts in a
 * `transformIndexHtml`-processed page get this injected automatically; a hand-served shell must
 * carry it verbatim or every Fast-Refresh-transformed module throws on import.
 */
const REACT_REFRESH_PREAMBLE = `<script type="module">
import RefreshRuntime from "/@react-refresh";
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => (type) => type;
window.__vite_plugin_react_preamble_installed__ = true;
</script>`;

const DEV_HEAD = `<script type="module" src="/@vite/client"></script>
${REACT_REFRESH_PREAMBLE}
<script type="module" src="/src/main.browser.ts"></script>`;

export class SpaController {
  alepha = $inject(Alepha);

  /**
   * `GET /` — the shell. `$route`, not `$action`: the document lives at the origin root, not
   * under the `/api` prefix `$action` imposes.
   */
  shell = $route({
    path: "/",
    handler: async ({ reply }) => {
      reply.headers["content-type"] = "text/html; charset=UTF-8";
      return this.renderShell();
    },
  });

  /**
   * `GET /index.html` — the same document under its file name, matching how the legacy static
   * host answered both.
   */
  shellIndexHtml = $route({
    path: "/index.html",
    handler: async ({ reply }) => {
      reply.headers["content-type"] = "text/html; charset=UTF-8";
      return this.renderShell();
    },
  });

  renderShell(): string {
    return `<!DOCTYPE html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="color-scheme" content="dark" />
    <title>lindocara</title>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
${this.headAssets()}
  </head>
  <body>
    <canvas id="stage"></canvas>
    <div id="root"></div>
  </body>
</html>`;
  }

  headAssets(): string {
    if (this.alepha.env.VITE_ALEPHA_DEV === "true") return DEV_HEAD;

    // `store.get` accepts the raw atom key; the atom itself lives in `alepha/react`, which this
    // server module deliberately does not import.
    const manifest =
      (this.alepha.store.get("alepha.react.ssr.manifest") as EmbeddedManifest | undefined) ?? {};
    const entry = Object.values(manifest.client ?? {}).find((chunk) => chunk.isEntry);
    if (!entry) return "";
    const tags = (entry.css ?? []).map((css) => `<link rel="stylesheet" href="/${css}" />`);
    tags.push(`<script type="module" crossorigin src="/${entry.file}"></script>`);
    return tags.join("\n");
  }
}
