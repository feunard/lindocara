import { defineConfig } from "vitest/config";

// Node, not jsdom: jsdom has no WebAudio either, so it would buy nothing. What these tests need is
// a context they can ASSERT against — how many sources were started, at what rate, at what gain —
// and that is a hand-rolled fake (`test/fake-context.ts`), not a browser.
export default defineConfig({
  test: {
    name: "audio",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
