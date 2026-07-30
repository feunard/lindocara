/**
 * `SpaController` — the SPA shell route. `alepha dev`'s request flow is Vite built-ins → Alepha
 * routes, so `GET /` reaching the game's title screen depends on this controller answering with
 * the exact DOM the client requires: `<canvas id="stage">` as a SIBLING of (and before) `#root`
 * — the canvas is NOT React's (see the repo AGENTS.md gotcha), the renderer takes it over
 * directly. Dev mode must also carry Vite's client + the React Fast Refresh preamble (the dev
 * server transforms client modules with `@vitejs/plugin-react`, which throws in the browser when
 * the preamble is missing) and the `src/main.browser.ts` entry; production mode resolves the
 * built entry + css from the embedded client manifest (`alepha.react.ssr.manifest`, written into
 * `dist/index.js` by `BuildServerTask` for every app with a browser entry, React or not).
 */

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createTestApp } from "./helpers.ts";

let alepha: ReturnType<typeof createTestApp>;

afterEach(async () => {
  await alepha.stop();
});

async function fetchShell(path = "/"): Promise<{ status: number; type: string; html: string }> {
  const { ServerProvider } = await import("alepha/server");
  const hostname = alepha.inject(ServerProvider).hostname;
  const response = await fetch(`${hostname}${path}`);
  return {
    status: response.status,
    type: response.headers.get("content-type") ?? "",
    html: await response.text(),
  };
}

describe("dev shell", () => {
  beforeEach(async () => {
    alepha = createTestApp();
    await alepha.start();
    // In real `alepha dev`, `VITE_ALEPHA_DEV` is in `process.env` while the app module loads, so
    // `Alepha.create` captures it into `alepha.env`. Setting it via `process.env` here would ALSO
    // make `ServerProvider.isViteDev()` skip listening (Vite owns the HTTP server in real dev),
    // leaving nothing to fetch against — so the flag is injected after start, which reproduces
    // exactly what the controller reads at request time.
    alepha.store.set("env" as never, { ...alepha.env, VITE_ALEPHA_DEV: "true" } as never);
  });

  test("GET / serves the legacy DOM: #stage canvas as a sibling before #root", async () => {
    const { status, type, html } = await fetchShell();
    expect(status).toBe(200);
    expect(type).toContain("text/html");
    const stage = html.indexOf('<canvas id="stage"></canvas>');
    const root = html.indexOf('<div id="root"></div>');
    expect(stage).toBeGreaterThan(-1);
    expect(root).toBeGreaterThan(stage);
    // Both live in <body>, not <head>.
    expect(html.indexOf("<body>")).toBeLessThan(stage);
  });

  test("dev head carries the Vite client, the React Refresh preamble and the browser entry", async () => {
    const { html } = await fetchShell();
    expect(html).toContain('src="/@vite/client"');
    expect(html).toContain("/@react-refresh");
    expect(html).toContain("__vite_plugin_react_preamble_installed__");
    expect(html).toContain('src="/src/main.browser.ts"');
  });

  test("GET /index.html serves the same shell", async () => {
    const { status, html } = await fetchShell("/index.html");
    expect(status).toBe(200);
    expect(html).toContain('<canvas id="stage"></canvas>');
  });
});

describe("production shell", () => {
  beforeEach(async () => {
    delete process.env.VITE_ALEPHA_DEV;
    alepha = createTestApp();
    // The shape BuildServerTask embeds into dist/index.js for a browser-entry app.
    alepha.store.set(
      "alepha.react.ssr.manifest" as never,
      {
        client: {
          "src/main.browser.ts": {
            file: "entry.abc123.js",
            isEntry: true,
            css: ["asset.def456.css"],
          },
        },
        favicon: "image/svg+xml:/favicon.svg",
      } as never,
    );
    await alepha.start();
  });

  test("GET / serves the built entry + css from the embedded manifest", async () => {
    const { status, type, html } = await fetchShell();
    expect(status).toBe(200);
    expect(type).toContain("text/html");
    expect(html).toContain('<canvas id="stage"></canvas>');
    expect(html).toContain('src="/entry.abc123.js"');
    expect(html).toContain('href="/asset.def456.css"');
    expect(html).not.toContain("/@vite/client");
    expect(html).not.toContain("main.browser.ts");
  });
});
