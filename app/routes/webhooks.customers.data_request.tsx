import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

/**
 * GDPR: a buyer requested their data. We only store order-level upsell
 * analytics (order id/name, optional customer name, item titles + totals) and
 * expose no automated export, so we acknowledge and log; the merchant fulfils
 * the request from their admin.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const p = payload as any;
  console.log(
    `Received ${topic} for ${shop}`,
    JSON.stringify({
      customer: p?.customer?.id,
      orders: p?.orders_requested,
    }),
  );
  return new Response();
};
