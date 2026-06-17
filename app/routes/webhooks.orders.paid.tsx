import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  processUpsellOrder,
  recordOrderStat,
  type NormalizedOrder,
} from "../models/analytics.server";

/**
 * Record + tag upsell orders the instant they're paid, instead of waiting for
 * the merchant to open the Dashboard. Requires protected customer data access
 * (orders/* webhooks are gated). The Dashboard scan remains as a backfill.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload, admin } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);
  if (!admin) return new Response();

  const order = payload as any;
  const upsellAttr = (order.note_attributes ?? []).find(
    (a: any) => a.name === "Upsell products",
  );
  const customer = order.customer;
  const customerName = customer
    ? [customer.first_name, customer.last_name].filter(Boolean).join(" ") ||
      null
    : null;

  const normalized: NormalizedOrder = {
    orderId: `gid://shopify/Order/${order.id}`,
    orderName: order.name ?? `#${order.order_number ?? order.id}`,
    currencyCode: order.currency ?? null,
    customerName,
    createdAt: order.created_at ?? null,
    orderTotal: Number(order.current_total_price ?? order.total_price) || 0,
    upsellMapRaw: upsellAttr?.value ?? null,
    tags:
      typeof order.tags === "string"
        ? order.tags
            .split(",")
            .map((t: string) => t.trim())
            .filter(Boolean)
        : (order.tags ?? []),
    lines: (order.line_items ?? []).map((li: any) => {
      const qty = Number(li.quantity) || 0;
      const gross = Number(li.price) || 0;
      const totalDiscount = Number(li.total_discount) || 0;
      const netUnit = qty > 0 ? gross - totalDiscount / qty : gross;
      return {
        variantId: li.variant_id
          ? `gid://shopify/ProductVariant/${li.variant_id}`
          : null,
        title: li.title ?? li.name ?? "Product",
        variantTitle: li.variant_title ?? null,
        quantity: qty,
        netUnitPrice: Math.max(0, netUnit),
      };
    }),
  };

  try {
    const result = await processUpsellOrder(admin, shop, normalized);

    // A/B lift: record any order assigned a holdout group.
    const groupAttr = (order.note_attributes ?? []).find(
      (a: any) => a.name === "_upsell_group",
    )?.value;
    if (groupAttr) {
      await recordOrderStat({
        shop,
        orderId: normalized.orderId,
        group: groupAttr,
        total: normalized.orderTotal,
        hadUpsell: result.matched > 0,
        orderedAt: normalized.createdAt ? new Date(normalized.createdAt) : null,
      });
    }
  } catch (e) {
    console.error(`orders/paid processing failed for ${shop}`, e);
  }

  return new Response();
};
