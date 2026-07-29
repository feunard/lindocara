import { z } from "alepha";
import { defineConfig } from "alepha/cli/config";
import { vendor } from "alepha/cli/vendor";
import { $command } from "alepha/command";

export default defineConfig({
  plugins: [
    vendor({
      packages: ["alepha"],
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

          if (flags.fast) return;

          // Content checks stay sequential: map:check regenerates tracked
          // zone files in place before git-diffing them, so racing another
          // generator against it would produce phantom diffs.
          await run("npm run catalog:check");
          await run("npm run map:check");

          // Both stacks must stay buildable during the migration.
          await run("npm run build");
          await run("npm run build:legacy");
          await run.rm("apps/main/dist");
        },
      }),
    }),
  ],
});
