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
         * `adapter: "lore"`, not `"bay"`. Bay's control API is a unix socket
         * and nothing else, so a CI runner cannot reach it — it used to go
         * through bay-admin, which no longer exists. Instead the artifact goes
         * to Lore, which writes a release row, and the machine hosting this app
         * asks for work on its own outbound channel. Nothing reaches in: no
         * port is opened, no address is known, and `up` still blocks until the
         * release is serving or has failed.
         *
         * `campaignId` is the Lore campaign the release is written into. Not
         * derived from the project name on purpose — campaign ids and project
         * names are separate namespaces, and guessing a mapping would silently
         * deploy into whichever campaign happened to match.
         */
        production: {
          adapter: "lore",
          domain: "lindocara.bay.alepha.dev",
          endpoint: "https://lore.alepha.dev",
          campaignId: 63,
        },
      },
    }),
  ],
});
