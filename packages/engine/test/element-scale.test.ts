import {
  decodeElementScaleTransform,
  encodeElementScaleTransform,
  MAX_ELEMENT_SCALE,
  MIN_ELEMENT_SCALE,
} from "@lindocara/engine/element-scale.js";
import { describe, expect, it } from "vitest";

describe("ordinary scenery scale persistence", () => {
  it.each([MIN_ELEMENT_SCALE, 0.5, 1, 1.75, 2.4, MAX_ELEMENT_SCALE])(
    "round-trips scale %s through the compact transform",
    (scale) => {
      const encoded = encodeElementScaleTransform(scale);
      expect(encoded).not.toBeNull();
      expect(decodeElementScaleTransform(encoded)).toBe(scale);
    },
  );

  it("keeps legacy zero-valued scenery at its original size", () => {
    expect(encodeElementScaleTransform(1)).toBe(0);
    expect(decodeElementScaleTransform(0)).toBe(1);
  });

  it.each([-1, 4, 299_999, 300_000, 300_081, 1_000_000])(
    "rejects unrelated transform code %s",
    (code) => {
      expect(decodeElementScaleTransform(code)).toBeNull();
    },
  );
});
