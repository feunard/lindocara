import { defineConfig } from "vitest/config";

// Pure logic. No workerd, no DOM — engine tests run in plain Node.
export default defineConfig({
  test: {
    name: "engine",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
