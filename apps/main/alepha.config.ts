import { defineConfig } from "alepha/cli/config";
import { platform } from "alepha/cli/platform";

export default defineConfig({
  plugins: [
    platform({
      environments: {
        /**
         * Deployed to Alepha Bay — a self-hosted server on a VPS we own.
         *
         * Replaces the Cloudflare Worker that served `lindocara.alepha.dev`.
         * That address was never a production; it is a test platform, and
         * running it on Workers forced the whole app into Cloudflare's shape —
         * Durable Objects for the websocket rooms, D1 for the database — for a
         * resilience it was not collecting.
         *
         * On Bay it is plain Node: the framework's own websocket server and a
         * SQLite file on disk. Same code, one runtime instead of two, and the
         * `build.cloudflare` block that used to live here is gone with it.
         *
         * `endpoint` is bay-admin, not Bay itself. Bay's control API listens on
         * a unix socket and nothing else, so the only way in from a CI runner
         * is through the panel that authenticates over HTTPS. `$BAY_ENDPOINT`
         * overrides it without editing this file.
         */
        production: {
          adapter: "bay",
          domain: "lindocara.bay.alepha.dev",
          endpoint: "https://admin.bay.alepha.dev",
        },
      },
    }),
  ],
});
