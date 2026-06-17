// Pure upsell-matching logic, deliberately free of Prisma / I/O imports so it
// can be unit-tested in isolation. Shared by the Dashboard scan and the
// orders/paid webhook (see analytics.server.ts).

export type NormalizedLine = {
  variantId: string | null; // gid://shopify/ProductVariant/...
  title: string;
  variantTitle: string | null;
  quantity: number;
  netUnitPrice: number; // after discounts (actual revenue)
};

export type NormalizedOrder = {
  orderId: string; // gid://shopify/Order/...
  orderName: string;
  currencyCode: string | null;
  customerName: string | null;
  createdAt: string | null; // ISO timestamp the order was placed
  orderTotal: number; // full order value (for AOV)
  upsellMapRaw: string | null; // the "Upsell products" attribute value
  tags: string[];
  lines: NormalizedLine[];
};

/** Parse the "Upsell products" cart attribute: { variantGid: title }. */
export function parseUpsellMap(
  raw: string | null | undefined,
): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** Pure: the line items the checkout block added, matched by variant id. */
export function matchUpsellLines(order: NormalizedOrder): NormalizedLine[] {
  const map = parseUpsellMap(order.upsellMapRaw);
  return order.lines.filter(
    (l) =>
      l.variantId && Object.prototype.hasOwnProperty.call(map, l.variantId),
  );
}
