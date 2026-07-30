import { CONSUMABLE_IDS, type ConsumableId, isConsumableId } from "./consumables.js";

/** A finite authored stock is generous while remaining bounded on every JSON boundary. */
export const SHOP_STOCK_MAX = 9_999;

export interface ShopOfferDefinition {
  readonly item: ConsumableId;
  /** `null` means the article never runs out for this shop. */
  readonly stock: number | null;
}

export interface MerchantOffer {
  readonly item: ConsumableId;
  /** Remaining party-wide stock; `null` means unlimited. */
  readonly remaining: number | null;
}

export interface ShopStockReservation {
  readonly reserved: boolean;
  readonly remaining: number | null;
}

/** Compatibility assortment for compiled merchants and maps saved before configurable shops. */
export const DEFAULT_SHOP_OFFERS: readonly ShopOfferDefinition[] = CONSUMABLE_IDS.map((item) => ({
  item,
  stock: null,
}));

export function parseShopOffers(
  value: unknown,
  legacyDefault = false,
): readonly ShopOfferDefinition[] | null {
  if (value === undefined && legacyDefault)
    return DEFAULT_SHOP_OFFERS.map((offer) => ({ ...offer }));
  if (!Array.isArray(value) || value.length > CONSUMABLE_IDS.length) return null;
  const seen = new Set<ConsumableId>();
  const offers: ShopOfferDefinition[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
    const record = raw as Record<string, unknown>;
    if (!isConsumableId(record.item) || seen.has(record.item)) return null;
    if (
      record.stock !== null &&
      (!Number.isSafeInteger(record.stock) ||
        (record.stock as number) < 1 ||
        (record.stock as number) > SHOP_STOCK_MAX)
    ) {
      return null;
    }
    seen.add(record.item);
    offers.push({ item: record.item, stock: record.stock as number | null });
  }
  return offers;
}

export function parseMerchantOffers(value: unknown): readonly MerchantOffer[] | null {
  if (!Array.isArray(value) || value.length > CONSUMABLE_IDS.length) return null;
  const seen = new Set<ConsumableId>();
  const offers: MerchantOffer[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
    const record = raw as Record<string, unknown>;
    if (!isConsumableId(record.item) || seen.has(record.item)) return null;
    if (
      record.remaining !== null &&
      (!Number.isSafeInteger(record.remaining) ||
        (record.remaining as number) < 0 ||
        (record.remaining as number) > SHOP_STOCK_MAX)
    ) {
      return null;
    }
    seen.add(record.item);
    offers.push({ item: record.item, remaining: record.remaining as number | null });
  }
  return offers;
}

export function remainingShopOffers(
  offers: readonly ShopOfferDefinition[],
  purchased: Readonly<Record<string, number>> = {},
): readonly MerchantOffer[] {
  return offers.map((offer) => ({
    item: offer.item,
    remaining:
      offer.stock === null
        ? null
        : Math.max(0, offer.stock - Math.max(0, purchased[offer.item] ?? 0)),
  }));
}
