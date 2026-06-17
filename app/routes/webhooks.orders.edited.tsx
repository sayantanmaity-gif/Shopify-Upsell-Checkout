import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { reprocessOrder } from "../models/analytics.server";

/**
 * An order was edited (lines added/removed/quantities changed) — recompute its
 * recorded upsell figures from current line quantities.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload, admin } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);
  if (!admin) return new Response();

  const p = payload as any;
  const orderId = p?.order_id ?? p?.order_edit?.order_id;
  if (orderId) {
    try {
      await reprocessOrder(admin, shop, `gid://shopify/Order/${orderId}`);
    } catch (e) {
      console.error(`reprocessOrder (edit) failed for ${shop}`, e);
    }
  }
  return new Response();
};
