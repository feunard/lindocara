import { z } from "alepha";
import { defineConfig } from "alepha/cli/config";
import { vendor } from "alepha/cli/vendor";
import { $command } from "alepha/command";

export default defineConfig({
  plugins: [
    vendor({
      // `@alepha/sigil` alongside `alepha`: it is a workspace package in that
      // repo, not something published, so it travels the same way. It was
      // `@alepha/pulse-client` until the package was renamed upstream — the old
      // name no longer resolves, so vendoring it fails outright rather than
      // quietly shipping a stale copy.
      packages: ["alepha", "@alepha/sigil"],
      remote: "file:///Users/nfo/git/alepha",
    }),
    () => ({
      verify: $command({
        aliases: ["v"],
        description: "Lint + typecheck + tests + content checks + (optionally) both builds.",
        flags: z.object({
          fast: z
            .boolean()
            .describe("Skip content checks and builds — tight local loops.")
            .optional(),
        }),
        handler: async ({ run, flags }) => {
          await run("npm run lint");

          // typecheck and the vitest projects share no state — parallel.
          await run(["npm run typecheck", "npm test"]);

          // Catches schema drift (an edited entity with no matching migration) before it ships —
          // cheap (boots the app once, no build), so it stays in even under --fast.
          await run("npm run check:migrations -w @lindocara/main");

          if (flags.fast) return;

          // Content checks stay sequential: map:check regenerates tracked
          // zone files in place before git-diffing them, so racing another
          // generator against it would produce phantom diffs.
          await run("npm run catalog:check");
          await run("npm run map:check");

          await run("npm run build");
        },
      }),
    }),
  ],
});
