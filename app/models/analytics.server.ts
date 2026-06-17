import prisma from "../db.server";

export type UpsellItem = {
  title: string;
  variantTitle: string | null;
  quantity: number;
  price: number;
};

export const ORDER_TAG = "Added Upsell Product";

type AdminGraphql = (
  query: string,
  options?: { variables?: Record<string, unknown> },
) => Promise<Response>;
type Admin = { graphql: AdminGraphql };

/**
 * Scan recent orders for upsell line items (the `_upsell` line-item attribute
 * the checkout block sets), record them, and tag the order. Runs from the
 * admin with the offline session — needs only write_orders, NOT protected
 * customer data access (we read line-item attributes, not customer PII).
 */
// The customer name is a protected PII field, gated behind PCD Level 2.
// We request it, but fall back to the name-less query if access isn't granted
// so the rest of the sync keeps working on Level 1.
function buildOrdersQuery(includeCustomer: boolean, since: string | null) {
  // Incremental: only orders updated since the last scan (high-water mark).
  const filter = since
    ? `, query: ${JSON.stringify(`updated_at:>'${since}'`)}`
    : "";
  return `#graphql
    query RecentOrders {
      orders(first: 100, sortKey: UPDATED_AT, reverse: true${filter}) {
        nodes {
          id
          name
          createdAt
          tags
          currencyCode
          ${includeCustomer ? "customer { displayName }" : ""}
          totalPriceSet { shopMoney { amount } }
          customAttributes { key value }
          lineItems(first: 250) {
            nodes {
              title
              variantTitle
              quantity
              variant { id }
              discountedUnitPriceSet { shopMoney { amount } }
              originalUnitPriceSet { shopMoney { amount } }
            }
          }
        }
      }
    }`;
}

export {
  parseUpsellMap,
  matchUpsellLines,
  type NormalizedLine,
  type NormalizedOrder,
} from "./upsell-match";
import {
  matchUpsellLines,
  parseUpsellMap,
  type NormalizedOrder,
} from "./upsell-match";

async function tagOrderIfNeeded(
  admin: Admin,
  orderId: string,
  tags: string[],
): Promise<string | null> {
  if (tags.includes(ORDER_TAG)) return null;
  try {
    const res = await admin.graphql(
      `#graphql
      mutation AddUpsellTag($id: ID!, $tags: [String!]!) {
        tagsAdd(id: $id, tags: $tags) { userErrors { field message } }
      }`,
      { variables: { id: orderId, tags: [ORDER_TAG] } },
    );
    const json = await res.json();
    const userErrors = json?.data?.tagsAdd?.userErrors ?? [];
    if (json?.errors || userErrors.length) {
      return `tagsAdd ${orderId}: ${JSON.stringify(
        json?.errors ?? userErrors,
      ).slice(0, 200)}`;
    }
    return null;
  } catch (e: any) {
    return `tagsAdd threw: ${String(e?.message ?? e)}`;
  }
}

/**
 * Record + tag a single order from normalized data (shared by the Dashboard
 * scan and the orders/paid webhook). Records net revenue; deletes any stale
 * row when an order no longer has upsell lines. Returns matched count + error.
 */
export async function processUpsellOrder(
  admin: Admin,
  shop: string,
  order: NormalizedOrder,
): Promise<{ matched: number; error: string | null }> {
  const upsellLines = matchUpsellLines(order);

  if (upsellLines.length === 0) {
    await prisma.upsellOrder.deleteMany({
      where: { shop, orderId: order.orderId },
    });
    return { matched: 0, error: null };
  }

  const items: UpsellItem[] = upsellLines.map((l) => ({
    title: l.title,
    variantTitle: l.variantTitle,
    quantity: l.quantity,
    price: l.netUnitPrice,
  }));

  await recordUpsellOrder({
    shop,
    orderId: order.orderId,
    orderName: order.orderName,
    customerName: order.customerName,
    customerEmail: null,
    currencyCode: order.currencyCode,
    orderedAt: order.createdAt ? new Date(order.createdAt) : null,
    orderTotal: order.orderTotal,
    items,
  });

  const error = await tagOrderIfNeeded(admin, order.orderId, order.tags);
  return { matched: upsellLines.length, error };
}

export async function syncUpsellOrders(admin: Admin, shop: string) {
  const debug = {
    scanned: 0,
    found: 0,
    errors: [] as string[],
    sample: [] as {
      order: string;
      upsell: string | null;
      matched: number;
      lineCount: number;
    }[],
    customerNames: false,
    customerError: "",
  };

  // Run a query, returning errors instead of throwing. The customer field
  // needs read_customers + PCD Level 2; if either is missing the request can
  // either return `json.errors` (200) or throw (4xx), so handle both.
  const settings = await prisma.shopSettings.findUnique({ where: { shop } });
  const since = settings?.lastUpsellSyncAt
    ? settings.lastUpsellSyncAt.toISOString()
    : null;
  const startedAt = new Date();

  const runQuery = async (includeCustomer: boolean) => {
    try {
      const res = await admin.graphql(buildOrdersQuery(includeCustomer, since));
      const json = await res.json();
      return { json, error: json.errors ? JSON.stringify(json.errors) : null };
    } catch (e: any) {
      // GraphqlQueryError carries the body on `.body`; fall back to message.
      const body = e?.body ? JSON.stringify(e.body) : String(e?.message ?? e);
      return { json: null as any, error: body };
    }
  };

  // Try with the customer name first; on any access error, retry without it.
  let { json, error } = await runQuery(true);
  if (error) {
    debug.customerError = error.slice(0, 250); // why names are blocked
    ({ json, error } = await runQuery(false));
    if (error) {
      debug.errors.push(error.slice(0, 400));
    }
  } else {
    debug.customerNames = true;
  }
  const orders = json?.data?.orders?.nodes ?? [];
  debug.scanned = orders.length;

  for (const order of orders) {
    const normalized: NormalizedOrder = {
      orderId: order.id,
      orderName: order.name,
      currencyCode: order.currencyCode ?? null,
      customerName: order.customer?.displayName ?? null, // PCD Level 2
      createdAt: order.createdAt ?? null,
      orderTotal: Number(order.totalPriceSet?.shopMoney?.amount) || 0,
      upsellMapRaw:
        (order.customAttributes ?? []).find(
          (a: any) => a.key === "Upsell products",
        )?.value ?? null,
      tags: order.tags ?? [],
      lines: (order.lineItems?.nodes ?? []).map((li: any) => ({
        variantId: li.variant?.id ?? null,
        title: li.title ?? "Product",
        variantTitle: li.variantTitle ?? null,
        quantity: Number(li.quantity) || 0,
        netUnitPrice:
          Number(
            li.discountedUnitPriceSet?.shopMoney?.amount ??
              li.originalUnitPriceSet?.shopMoney?.amount,
          ) || 0,
      })),
    };

    if (debug.sample.length < 5) {
      debug.sample.push({
        order: normalized.orderName,
        upsell: normalized.upsellMapRaw,
        matched: matchUpsellLines(normalized).length,
        lineCount: normalized.lines.length,
      });
    }

    const result = await processUpsellOrder(admin, shop, normalized);
    if (result.matched > 0) debug.found += 1;
    if (result.error) debug.errors.push(result.error);
  }

  // Advance the high-water mark only when the scan itself succeeded.
  if (!error) {
    await prisma.shopSettings
      .update({ where: { shop }, data: { lastUpsellSyncAt: startedAt } })
      .catch(() => {});
  }

  return debug;
}

export async function recordUpsellOrder(input: {
  shop: string;
  orderId: string;
  orderName: string;
  customerName: string | null;
  customerEmail: string | null;
  currencyCode: string | null;
  orderedAt: Date | null;
  orderTotal: number;
  items: UpsellItem[];
}) {
  const upsellTotal = input.items.reduce(
    (sum, i) => sum + i.price * i.quantity,
    0,
  );
  const upsellUnits = input.items.reduce((sum, i) => sum + i.quantity, 0);

  return prisma.upsellOrder.upsert({
    where: { shop_orderId: { shop: input.shop, orderId: input.orderId } },
    update: {
      orderName: input.orderName,
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      currencyCode: input.currencyCode,
      orderedAt: input.orderedAt,
      orderTotal: input.orderTotal,
      upsellTotal,
      upsellUnits,
      itemsJson: JSON.stringify(input.items),
    },
    create: {
      shop: input.shop,
      orderId: input.orderId,
      orderName: input.orderName,
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      currencyCode: input.currencyCode,
      orderedAt: input.orderedAt,
      orderTotal: input.orderTotal,
      upsellTotal,
      upsellUnits,
      itemsJson: JSON.stringify(input.items),
    },
  });
}

// Build a Prisma where clause that filters on the order date (orderedAt),
// falling back to record time for legacy rows that predate orderedAt.
function dateWhere(shop: string, since: Date | null) {
  if (!since) return { shop };
  return {
    shop,
    OR: [{ orderedAt: { gte: since } }, { orderedAt: null, createdAt: { gte: since } }],
  };
}

export async function getUpsellOrders(
  shop: string,
  {
    skip = 0,
    take = 20,
    since = null,
  }: { skip?: number; take?: number; since?: Date | null } = {},
) {
  // Fetch one extra row to cheaply determine whether more pages exist.
  const rows = await prisma.upsellOrder.findMany({
    where: dateWhere(shop, since),
    orderBy: [{ orderedAt: "desc" }, { createdAt: "desc" }],
    skip,
    take: take + 1,
  });
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  return {
    orders: page.map((r) => ({
      ...r,
      items: safeParse(r.itemsJson),
    })),
    hasMore,
  };
}

export async function getUpsellMetrics(shop: string, since: Date | null = null) {
  const agg = await prisma.upsellOrder.aggregate({
    where: dateWhere(shop, since),
    _count: { _all: true },
    _sum: { upsellTotal: true, upsellUnits: true },
  });
  return {
    orders: agg._count._all,
    revenue: agg._sum.upsellTotal ?? 0,
    units: agg._sum.upsellUnits ?? 0,
  };
}

/** Average full order value of upsell orders (since a date). null if none. */
export async function getUpsellAov(
  shop: string,
  since: Date | null = null,
): Promise<number | null> {
  const agg = await prisma.upsellOrder.aggregate({
    where: dateWhere(shop, since),
    _avg: { orderTotal: true },
    _count: { _all: true },
  });
  return agg._count._all > 0 ? (agg._avg.orderTotal ?? 0) : null;
}

/** Upsell revenue grouped by day (YYYY-MM-DD), oldest first, for a sparkline. */
export async function getDailyUpsellRevenue(
  shop: string,
  since: Date | null = null,
): Promise<{ day: string; revenue: number }[]> {
  const rows = await prisma.upsellOrder.findMany({
    where: dateWhere(shop, since),
    select: { upsellTotal: true, orderedAt: true, createdAt: true },
  });
  const byDay = new Map<string, number>();
  for (const r of rows) {
    const d = r.orderedAt ?? r.createdAt;
    const day = d.toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + r.upsellTotal);
  }
  return [...byDay.entries()]
    .map(([day, revenue]) => ({ day, revenue }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * Recompute an order's recorded upsell figures from its CURRENT line quantities
 * (net of refunds/edits). Called by the refunds/create + orders/edited webhooks.
 * Only touches financial fields (preserves customerName, no PCD needed).
 */
export async function reprocessOrder(
  admin: Admin,
  shop: string,
  orderGid: string,
) {
  const res = await admin.graphql(
    `#graphql
    query ReprocessOrder($id: ID!) {
      order(id: $id) {
        id
        currentTotalPriceSet { shopMoney { amount } }
        customAttributes { key value }
        lineItems(first: 250) {
          nodes {
            title
            variantTitle
            currentQuantity
            variant { id }
            discountedUnitPriceSet { shopMoney { amount } }
            originalUnitPriceSet { shopMoney { amount } }
          }
        }
      }
    }`,
    { variables: { id: orderGid } },
  );
  const json = await res.json();
  const order = json?.data?.order;
  if (!order) return;

  const upsellMap = parseUpsellMap(
    (order.customAttributes ?? []).find((a: any) => a.key === "Upsell products")
      ?.value ?? null,
  );
  const lines = (order.lineItems?.nodes ?? []).filter(
    (li: any) =>
      Number(li.currentQuantity) > 0 &&
      li.variant?.id &&
      Object.prototype.hasOwnProperty.call(upsellMap, li.variant.id),
  );

  if (lines.length === 0) {
    await prisma.upsellOrder.deleteMany({ where: { shop, orderId: orderGid } });
    return;
  }

  const items: UpsellItem[] = lines.map((li: any) => ({
    title: li.title ?? "Product",
    variantTitle: li.variantTitle ?? null,
    quantity: Number(li.currentQuantity) || 0,
    price:
      Number(
        li.discountedUnitPriceSet?.shopMoney?.amount ??
          li.originalUnitPriceSet?.shopMoney?.amount,
      ) || 0,
  }));
  const upsellTotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const upsellUnits = items.reduce((s, i) => s + i.quantity, 0);
  const orderTotal =
    Number(order.currentTotalPriceSet?.shopMoney?.amount) || 0;

  // updateMany no-ops if the order was never an upsell order.
  await prisma.upsellOrder.updateMany({
    where: { shop, orderId: orderGid },
    data: { upsellTotal, upsellUnits, orderTotal, itemsJson: JSON.stringify(items) },
  });
}

export type TopProduct = {
  title: string;
  variantTitle: string | null;
  units: number;
  revenue: number;
  orders: number;
};

/**
 * Aggregate per-product upsell performance from recorded orders (no extra
 * tracking needed). Grouped by product title + variant, sorted by revenue.
 */
export async function getTopUpsellProducts(
  shop: string,
  since: Date | null = null,
  limit = 10,
): Promise<TopProduct[]> {
  const rows = await prisma.upsellOrder.findMany({
    where: dateWhere(shop, since),
    select: { itemsJson: true },
  });
  const agg = new Map<string, TopProduct>();
  for (const r of rows) {
    const seen = new Set<string>();
    for (const it of safeParse(r.itemsJson)) {
      const key = `${it.title}__${it.variantTitle ?? ""}`;
      const e =
        agg.get(key) ??
        ({
          title: it.title,
          variantTitle: it.variantTitle,
          units: 0,
          revenue: 0,
          orders: 0,
        } as TopProduct);
      e.units += it.quantity;
      e.revenue += it.price * it.quantity;
      if (!seen.has(key)) {
        e.orders += 1;
        seen.add(key);
      }
      agg.set(key, e);
    }
  }
  return [...agg.values()]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit);
}

/**
 * Total order count for the shop (optionally since a date) via the Admin API,
 * used to compute the upsell attach rate. Returns null if unavailable (e.g. no
 * order access) so the Dashboard can show "—" rather than a wrong number.
 */
export async function getOrderCount(
  admin: Admin,
  since: Date | null = null,
): Promise<number | null> {
  const filter = since
    ? `(query: ${JSON.stringify(`created_at:>'${since.toISOString()}'`)})`
    : "";
  try {
    const res = await admin.graphql(`#graphql
      query OrderCount { ordersCount${filter} { count } }`);
    const json = await res.json();
    if (json.errors) return null;
    return json.data?.ordersCount?.count ?? null;
  } catch {
    return null;
  }
}

function safeParse(json: string): UpsellItem[] {
  try {
    return JSON.parse(json);
  } catch {
    return [];
  }
}
