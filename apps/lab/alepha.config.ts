import { defineConfig } from "alepha/cli/config";
import { platform } from "alepha/cli/platform";

export default defineConfig({
  /**
   * The lab is a site, not a service.
   *
   * `target: "static"` builds no server: the artifact is `dist/public/` plus
   * the manifest, and Bay hosts it with no process behind it. `static.source`
   * is what makes that possible here — the target can otherwise only ship what
   * Alepha rendered (its own client build, or a `$page` at `/`), and the lab's
   * page is a hand-written `index.html` with its own HUD markup and 220 lines
   * of inline CSS, built by plain Vite.
   *
   * `dist-client`, deliberately outside `dist/`: the build cleans `dist/`
   * before any task runs, so a client written there would be deleted before it
   * could be adopted. `npm run build -w @lindocara/lab` fills it first.
   */
  build: {
    target: "static",
    // `domain` is only the contents of the generated `CNAME` file, which Bay does not read — it
    // routes on the manifest's `environments.production.domain` below. Set anyway so the artifact
    // does not carry a second, contradictory domain: left unset it is filled with a generated
    // `lindocara-lab-<hash>.surge.sh`, which names a host this site is not served from.
    static: { source: "dist-client", domain: "lab.bay.alepha.dev" },
  },
  plugins: [
    platform({
      environments: {
        /**
         * Same machine as the game, second app on it.
         *
         * `adapter: "lore"` for the same reason `apps/main` uses it: Bay's
         * control API is a unix socket, so nothing can dial it — the artifact
         * goes to Lore, a release row is written, and the machine asks for work
         * on its own outbound channel.
         *
         * `projectId` is the Lore project the release is written into, and it
         * is the same 63 the game deploys to: a project holds many apps, keyed
         * by name and environment, so `lindocara-lab/production` and
         * `lindocara-main/production` coexist without touching each other.
         */
        production: {
          adapter: "lore",
          domain: "lab.bay.alepha.dev",
          endpoint: "https://lore.alepha.dev",
          projectId: 63,
        },
      },
    }),
  ],
});
