import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

/**
 * GDPR: erase a buyer's PII. We only hold an optional customer name/email on
 * UpsellOrder rows, so null those for the affected orders (or matching email).
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const p = payload as any;

  const orderIds: string[] = (p?.orders_to_redact ?? []).map(
    (id: any) => `gid://shopify/Order/${id}`,
  );
  const email: string | undefined = p?.customer?.email;

  const conditions: any[] = [];
  if (orderIds.length) conditions.push({ orderId: { in: orderIds } });
  if (email) conditions.push({ customerEmail: email });

  if (conditions.length) {
    await prisma.upsellOrder.updateMany({
      where: { shop, OR: conditions },
      data: { customerName: null, customerEmail: null },
    });
  }

  console.log(`Redacted customer PII for ${shop} (${topic})`);
  return new Response();
};
