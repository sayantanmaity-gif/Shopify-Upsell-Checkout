import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

/**
 * GDPR: 48h after uninstall, erase all data we hold for the shop.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  await prisma.$transaction([
    prisma.upsellOrder.deleteMany({ where: { shop } }),
    prisma.upsellProduct.deleteMany({ where: { shop } }),
    prisma.shopSettings.deleteMany({ where: { shop } }),
    prisma.session.deleteMany({ where: { shop } }),
  ]);

  console.log(`Redacted all data for ${shop} (${topic})`);
  return new Response();
};
