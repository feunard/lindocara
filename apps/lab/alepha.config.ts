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
    // `domain` is only the contents of the generated `CNAME` file — a static-host convention Bay
    // does not read. Set to the host Bay actually serves this on, so the artifact does not carry a
    // contradictory one: left unset it is filled with a generated `lindocara-lab-<hash>.surge.sh`.
    static: { source: "dist-client", domain: "lindocara-lab.bay.alepha.dev" },
  },
  plugins: [
    platform({
      environments: {
        /**
         * Same machine as the game, second app on it.
         *
         * `adapter: "bay"` over SSH, for the same reason `apps/main` moved:
         * Lore's connector is gone, and the lab's own upload had already
         * started failing separately — 404, `Storage 'releases' not found`.
         * `host` and `socket` carry the same values and the same reasoning as
         * the game's config; read that one for why the alias is not
         * `bay.alepha.dev` and why the socket path has to be spelled out.
         *
         * `domain` NAMES the host, it does not choose it. Bay composes the host
         * from the app name — `<name>[-<env>].<base>`, bare name in production —
         * and that is deliberate on its side: the name is a property of the
         * artifact, not a deployment choice. Unlike the retired `lore` path, the
         * `bay` adapter DOES have a channel to override it when it registers the
         * app, so this value is now load-bearing rather than merely descriptive.
         * It said `lab.bay.alepha.dev` once, and the result was a deploy that
         * reported success against a host that 404'd with no certificate.
         */
        production: {
          adapter: "bay",
          domain: "lindocara-lab.bay.alepha.dev",
          host: "ovh-bay",
          socket: "/run/bay/control.sock",
        },
      },
    }),
  ],
});
