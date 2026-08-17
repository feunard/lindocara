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
         * `adapter: "bay"`, over SSH. The artifact used to go to Lore, which
         * wrote a release row for the machine to pull on its own outbound
         * channel; that route is gone (`refactor(bay): remove the Lore
         * connector — SSH is the only remote surface`), and it had stopped
         * working anyway — Lore refuses an artifact over 10_000_000 bytes and
         * ours packs well past that, 24 MB of it music.
         *
         * `host` is an alias from `~/.ssh/config`, NOT `bay.alepha.dev`. That
         * name resolves to Cloudflare (104.21.x / 172.67.x), which proxies HTTP
         * and not SSH, so using it here fails to connect. The alias points at
         * the machine itself. `$BAY_HOST` overrides it, which is how anything
         * that is not this laptop — CI, a second Bay — supplies its own.
         *
         * `socket` is required here because Bay on this host does not run with
         * the default root. It serves with `--root /opt/bay/data
         * --control-socket /run/bay/control.sock`, and the adapter's guess is
         * `<root>/control.sock` resolved from `$HOME` — a non-interactive SSH
         * shell starts there, so the guess misses every install whose root is
         * not `./bay-data` under the deploy user's home. Absolute path, passed
         * straight through as `--control-socket`.
         *
         * `domain` stays explicit. Bay can compose `<app>.<base-domain>` itself
         * (its `--base-domain` here is `bay.alepha.dev`), but naming it keeps
         * the served host a property of this file rather than of whichever Bay
         * the artifact lands on — and the public name is no longer the one Bay
         * would compose.
         *
         * TWO hosts, comma-separated, canonical first. The adapter splits on
         * commas and passes one `--domain` per host; Bay stores them as a list
         * and serves all of them. `lc.alepha.dev` is the public name;
         * `lindocara.bay.alepha.dev` stays because Bay offers no redirect
         * primitive, so dropping a host 404s every link and bookmark into it
         * rather than forwarding them. It costs one extra certificate.
         *
         * `lc.alepha.dev` MUST be grey-clouded (DNS only) in Cloudflare, like
         * the `*.bay.alepha.dev` wildcard beside it. Bay terminates TLS itself
         * (CertMagic, Let's Encrypt, issued on demand for hosts registered with
         * it), so behind the orange cloud Cloudflare terminates at the edge and
         * then cannot handshake with the origin: the whole host answers 525
         * while DNS, the deploy and `bay status` all look healthy. The record
         * was proxied when it was first created, and 525 is exactly what it
         * served.
         */
        production: {
          adapter: "bay",
          domain: "lc.alepha.dev,lindocara.bay.alepha.dev",
          host: "ovh-bay",
          socket: "/run/bay/control.sock",
        },
      },
    }),
  ],
});
