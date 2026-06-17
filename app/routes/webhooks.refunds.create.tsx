import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { reprocessOrder } from "../models/analytics.server";

/**
 * A refund was issued — recompute the order's recorded upsell figures from its
 * current (post-refund) line quantities so dashboard revenue stays accurate.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload, admin } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);
  if (!admin) return new Response();

  const orderId = (payload as any)?.order_id;
  if (orderId) {
    try {
      await reprocessOrder(admin, shop, `gid://shopify/Order/${orderId}`);
    } catch (e) {
      console.error(`reprocessOrder (refund) failed for ${shop}`, e);
    }
  }
  return new Response();
};
