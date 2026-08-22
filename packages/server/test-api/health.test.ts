import { afterEach, beforeEach, test } from "vitest";

import { HealthController } from "../src/api/controllers/HealthController.ts";
import { createTestApp } from "./helpers.ts";

// `.fetch()` (not a direct `handler({} as never)` call) is the preferred idiom: it goes through
// the same request/response schema validation a real HTTP call would, mirroring how apps/lore's
// controller specs exercise their actions (see .vendor/alepha apps/lore/test/*-api.spec.ts).
let alepha: ReturnType<typeof createTestApp>;

beforeEach(async () => {
  alepha = createTestApp();
  await alepha.start();
});

afterEach(async () => {
  await alepha.stop();
});

test("health responds ok", async ({ expect }) => {
  const health = alepha.inject(HealthController);
  const res = await health.apiHealth.fetch({});
  expect(res.data).toEqual({ ok: true });
});
