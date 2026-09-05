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
      // `@alepha/ui` is the shared shadcn/Base-UI component library. It replaces the project's own
      // `packages/ui` copy: same `@base-ui/react` major, maintained upstream, and it carries
      // components that copy never had (`segmented`, `sidebar`, `combobox`, …).
      packages: ["alepha", "@alepha/sigil", "@alepha/ui"],
      remote: "file:///Users/nfo/git/alepha",
    }),
    () => ({
      verify: $command({
        aliases: ["v"],
        description:
          "Clean + lint + typecheck + tests + migrations + content checks + (optionally) the build.",
        flags: z.object({
          fast: z
            .boolean()
            .describe("Skip content checks and builds — tight local loops.")
            .optional(),
        }),
        handler: async ({ run, flags }) => {
          // Start from no build output at all. A stale `dist/` from an older app shape survives a
          // failed build, so `build` can go red while the directory beside it still looks like a
          // shipped artifact — and `alepha platform up` packs what it finds. Cleaning first is what
          // makes the build step's success mean "this ran produced it", not "something once did".
          // Nothing here is incremental (no `tsBuildInfoFile`, `noEmit` everywhere), so this costs
          // no rebuild time. Deliberately NOT repeated at the end: the artifact is worth keeping
          // for inspection, and CI uploads `apps/main/dist` after its own build.
          await run("yarn clean");

          await run("yarn lint");

          // typecheck and the vitest projects share no state — parallel. This is also where
          // i18n parity is verified: `packages/engine/test/i18n.test.ts` asserts en/fr key
          // equality, no empty strings and a template per `EventCode`, so there is no separate
          // i18n check to call — a missing translation fails `yarn test`.
          await run(["yarn typecheck", "yarn test"]);

          // Catches schema drift (an edited entity with no matching migration) before it ships —
          // cheap (boots the app once, no build), so it stays in even under --fast.
          await run("yarn workspace @lindocara/main run check:migrations");

          if (flags.fast) return;

          // Content checks stay sequential: map:check regenerates tracked
          // zone files in place before git-diffing them, so racing another
          // generator against it would produce phantom diffs.
          await run("yarn catalog:check");
          await run("yarn map:check");
          await run("yarn music:check");
          await run("yarn priest:check");

          await run("yarn build");

          // The build proves the app COMPILES. This proves it BOOTS — it starts the artifact the
          // way Bay starts it (production mode, migrations from `apps/main/migrations/`, a
          // throwaway SQLite file) and asserts the API answers, the SPA shell is served, an
          // unadmitted `/ws/world` dial is refused by the room, nothing logged an error on the way
          // up and SIGTERM stops it. Everything a compiler cannot see — an `$action` name
          // colliding with an alepha builtin, a service missing from `LindocaraApi`, an entity
          // whose migration was never generated, a throwing `ready()` hook — fails here instead of
          // in production. Last, because it consumes the build above.
          await run("yarn smoke");
        },
      }),
    }),
  ],
});
