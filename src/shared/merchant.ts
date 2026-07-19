import type { Vec2 } from "./simulation.js";

export interface MerchantDefinition extends Vec2 {
  id: "heartroot_merchant";
}

/**
 * Runtime seam for merchant placement.
 *
 * Merchants must eventually come from an explicitly authored map placement. Until that editor
 * integration exists, returning `null` is deliberate: compiled zones and D1 maps must not invent a
 * merchant beside their spawn. Keep the shop, protocol and animated renderer ready, but do not
 * infer gameplay content from terrain geometry.
 */
export function merchantForRuntimeRoom(): MerchantDefinition | null {
  return null;
}
