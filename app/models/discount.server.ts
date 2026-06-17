import prisma from "../db.server";
import { getShopSettings, getUpsellProducts } from "./upsell.server";

const CONFIG_NAMESPACE = "upsell";
const CONFIG_KEY = "config";

type AdminGraphql = (
  query: string,
  options?: { variables?: Record<string, unknown> },
) => Promise<Response>;

const DISCOUNT_TITLE = "Checkout Upsell discounts";

/** Find the deployed product-discount function id for this app. */
async function findFunctionId(admin: { graphql: AdminGraphql }) {
  const res = await admin.graphql(`#graphql
    query {
      shopifyFunctions(first: 50) {
        nodes { id title apiType }
      }
    }`);
  const json = await res.json();
  const nodes = json.data?.shopifyFunctions?.nodes ?? [];
  const fn =
    nodes.find((n: any) => n.apiType === "product_discounts") ??
    nodes.find((n: any) => n.title?.includes("upsell-discount"));
  return fn?.id ?? null;
}

async function discountExists(
  admin: { graphql: AdminGraphql },
  id: string,
): Promise<boolean> {
  const res = await admin.graphql(
    `#graphql
    query DiscountNode($id: ID!) {
      discountNode(id: $id) { id }
    }`,
    { variables: { id } },
  );
  const json = await res.json();
  return Boolean(json.data?.discountNode?.id);
}

/**
 * Ensure exactly one active automatic discount activates our function.
 * Idempotent: stores the created discount id on the shop settings.
 * Safe to call before the function is deployed — it just no-ops then.
 */
export async function ensureUpsellDiscount(
  admin: { graphql: AdminGraphql },
  shop: string,
) {
  const settings = await getShopSettings(shop);

  if (settings.discountId && (await discountExists(admin, settings.discountId))) {
    return settings.discountId;
  }

  const functionId = await findFunctionId(admin);
  if (!functionId) return null; // function not deployed yet

  const res = await admin.graphql(
    `#graphql
    mutation CreateUpsellDiscount($discount: DiscountAutomaticAppInput!) {
      discountAutomaticAppCreate(automaticAppDiscount: $discount) {
        automaticAppDiscount { discountId }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        discount: {
          title: DISCOUNT_TITLE,
          functionId,
          startsAt: new Date().toISOString(),
          combinesWith: {
            orderDiscounts: true,
            productDiscounts: true,
            shippingDiscounts: true,
          },
        },
      },
    },
  );

  const json = await res.json();
  const errors = json.data?.discountAutomaticAppCreate?.userErrors ?? [];
  if (errors.length) {
    throw new Error(`discountAutomaticAppCreate: ${JSON.stringify(errors)}`);
  }

  const discountId =
    json.data?.discountAutomaticAppCreate?.automaticAppDiscount?.discountId ??
    null;
  if (discountId) {
    await prisma.shopSettings.update({
      where: { shop },
      data: { discountId },
    });
  }
  return discountId;
}

/**
 * Write the per-product discount map to the discount node's metafield, keyed by
 * variant GID: { "gid://shopify/ProductVariant/123": "percentage:15" }. The
 * discount function reads this to know how much to discount each upsell line.
 * Keyed by variant id (not title) so it's exact even when products share a
 * title. No-ops if no discount node exists yet. Safe to call on every save.
 */
export async function setDiscountConfig(
  admin: { graphql: AdminGraphql },
  shop: string,
) {
  const settings = await getShopSettings(shop);
  if (!settings.discountId) return;

  const products = await getUpsellProducts(shop);
  const config: Record<string, string> = {};
  for (const p of products) {
    if (p.variantId && p.discountType && (p.discountValue ?? 0) > 0) {
      // "type:base" or, with a quantity break, "type:base;minQty:tierValue".
      let spec = `${p.discountType}:${p.discountValue}`;
      if ((p.volumeMinQty ?? 0) >= 2 && (p.volumeValue ?? 0) > 0) {
        spec += `;${p.volumeMinQty}:${p.volumeValue}`;
      }
      config[p.variantId] = spec;
    }
  }
  // The free-gift variant is discounted 100% (overrides any product entry).
  if (settings.giftThreshold > 0 && settings.giftVariantId) {
    config[settings.giftVariantId] = "percentage:100";
  }

  await admin.graphql(
    `#graphql
    mutation SetUpsellDiscountConfig($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors { field message }
      }
    }`,
    {
      variables: {
        metafields: [
          {
            ownerId: settings.discountId,
            namespace: CONFIG_NAMESPACE,
            key: CONFIG_KEY,
            type: "json",
            value: JSON.stringify(config),
          },
        ],
      },
    },
  );
}
