import type { RunInput, FunctionRunResult, Discount } from "../generated/api";
import { DiscountApplicationStrategy } from "../generated/api";

const EMPTY_DISCOUNT: FunctionRunResult = {
  discountApplicationStrategy: DiscountApplicationStrategy.First,
  discounts: [],
};

/**
 * Resolve a discount spec for a given line quantity. Specs look like:
 *   "percentage:15"            base only
 *   "percentage:15;3:25"       base 15%, but 25% once quantity >= 3
 * Returns the effective { type, value } or null if not applicable.
 */
export function resolveDiscount(
  spec: string,
  quantity: number,
): { type: string; value: number } | null {
  const [base, tier] = spec.split(";");
  const [type, baseStr] = base.split(":");
  let value = Number(baseStr);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (tier) {
    const [minQtyStr, tierStr] = tier.split(":");
    const minQty = Number(minQtyStr);
    const tierValue = Number(tierStr);
    if (
      Number.isFinite(minQty) &&
      Number.isFinite(tierValue) &&
      tierValue > 0 &&
      quantity >= minQty
    ) {
      value = tierValue;
    }
  }
  if (type !== "percentage" && type !== "fixed") return null;
  return { type, value };
}

/**
 * Identify upsell lines from the "Upsell products" cart attribute (a JSON map
 * of variantGid -> title the checkout block added), then look up each one's
 * discount in the discount node metafield ({ "<variantGid>": "percentage:15" })
 * and apply it to that line. Matching is by variant GID, so it's exact even
 * when two products share a title.
 */
export function run(input: RunInput): FunctionRunResult {
  // SECURITY NOTE: the "Upsell products" cart attribute is buyer-writable (the
  // storefront cart AJAX API lets shoppers set note attributes). A shopper
  // could therefore mark an arbitrary line as an upsell. The blast radius is
  // bounded: we only discount variants the merchant explicitly configured with
  // a discount (the config metafield), and only by the configured amount — i.e.
  // the same offer the merchant already extends via the block. So the worst
  // case is a shopper self-applying a discount the merchant opted into. If that
  // ever needs locking down, gate it on a server-signed token instead.
  let upsellMap: Record<string, string> = {};
  const upsellRaw = input.cart.attribute?.value;
  if (upsellRaw) {
    try {
      const parsed = JSON.parse(upsellRaw);
      if (parsed && typeof parsed === "object") upsellMap = parsed;
    } catch {
      /* ignore malformed */
    }
  }
  if (Object.keys(upsellMap).length === 0) return EMPTY_DISCOUNT;

  let config: Record<string, string> = {};
  const configRaw = input.discountNode.metafield?.value;
  if (configRaw) {
    try {
      const parsed = JSON.parse(configRaw);
      if (parsed && typeof parsed === "object") config = parsed;
    } catch {
      /* ignore malformed config */
    }
  }

  const discounts: Discount[] = [];

  for (const line of input.cart.lines) {
    const merchandise = line.merchandise;
    if (merchandise.__typename !== "ProductVariant") continue;

    // Only discount lines this block marked as upsells (by variant id).
    if (!(merchandise.id in upsellMap)) continue;

    const spec = config[merchandise.id];
    if (!spec) continue;

    const resolved = resolveDiscount(spec, Number(line.quantity) || 0);
    if (!resolved) continue;
    const { type, value } = resolved;

    if (type === "percentage") {
      discounts.push({
        targets: [{ cartLine: { id: line.id } }],
        value: { percentage: { value: Math.min(value, 100) } },
        message: "Upsell discount",
      });
    } else if (type === "fixed") {
      discounts.push({
        targets: [{ cartLine: { id: line.id } }],
        value: { fixedAmount: { amount: value } },
        message: "Upsell discount",
      });
    }
  }

  if (discounts.length === 0) return EMPTY_DISCOUNT;

  return {
    discountApplicationStrategy: DiscountApplicationStrategy.First,
    discounts,
  };
}
