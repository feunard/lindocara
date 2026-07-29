import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The new Alepha-based server API is runtime-neutral (Node, not workerd), unlike the rest of
// this package which runs under the cloudflare pool (see ../vitest.config.ts). It gets its own
// vitest project so `npm test` collects both without either pool's setup leaking into the other.
// `root` is pinned to this directory (not left to default to the invoking cwd) so
// `npx vitest run --config packages/server/test-api/vitest.config.ts` only ever collects this
// project's own tests, never `../test/**` (the workerd suite, which fails outside workerd).
export default defineConfig({
  test: {
    name: "server-api",
    root: fileURLToPath(new URL(".", import.meta.url)),
    environment: "node",
    include: ["**/*.test.ts"],
  },
});
