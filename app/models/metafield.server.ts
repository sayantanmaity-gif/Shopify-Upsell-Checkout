import { getShopSettings, getUpsellProducts, planLimits } from "./upsell.server";

// App-owned metafield the checkout UI extension reads via useAppMetafields.
// "$app" resolves to this app's reserved namespace.
export const CONFIG_NAMESPACE = "$app:checkout_upsell";
export const CONFIG_KEY = "config";

type AdminGraphql = (
  query: string,
  options?: { variables?: Record<string, unknown> },
) => Promise<Response>;

type Admin = { graphql: AdminGraphql };

/**
 * Fetch live product data (variants, price, image, availability) from the
 * Admin API. We embed this in the config metafield so the checkout extension
 * never needs a Storefront query (which is unreliable in the checkout context).
 */
async function fetchProductData(admin: Admin, productIds: string[]) {
  if (productIds.length === 0) return { currencyCode: "USD", map: {} as any };

  const res = await admin.graphql(
    `#graphql
    query UpsellProductData($ids: [ID!]!) {
      shop { currencyCode }
      nodes(ids: $ids) {
        ... on Product {
          id
          title
          onlineStoreUrl
          featuredImage { url }
          variants(first: 25) {
            nodes {
              id
              title
              availableForSale
              inventoryQuantity
              price
              image { url }
            }
          }
        }
      }
    }`,
    { variables: { ids: productIds } },
  );
  const json = await res.json();
  const currencyCode: string = json.data?.shop?.currencyCode ?? "USD";
  const map: Record<string, any> = {};
  (json.data?.nodes ?? []).forEach((n: any) => {
    if (n?.id) map[n.id] = n;
  });
  return { currencyCode, map };
}

function parseCopy(json: string): Record<string, unknown> {
  try {
    const o = JSON.parse(json);
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}

/** Build the JSON config blob consumed by the checkout extension. */
export async function buildConfig(admin: Admin, shop: string) {
  const settings = await getShopSettings(shop);
  const products = await getUpsellProducts(shop);
  const limits = planLimits(settings.plan);

  const enabled = products
    .filter((p) => p.enabled)
    .slice(0, limits.maxProducts);

  // Fetch live data for upsell products + the gift product (if configured).
  const fetchIds = [...enabled.map((p) => p.productId)];
  if (settings.giftThreshold > 0 && settings.giftProductId) {
    fetchIds.push(settings.giftProductId);
  }
  const { currencyCode, map } = await fetchProductData(admin, fetchIds);

  // Resolve the free-gift offer (a normal offer rendered at 100% off).
  let gift = null;
  if (settings.giftThreshold > 0 && settings.giftVariantId) {
    const gd = settings.giftProductId ? map[settings.giftProductId] : null;
    const gv = (gd?.variants?.nodes ?? []).find(
      (v: any) => v.id === settings.giftVariantId,
    );
    gift = {
      threshold: settings.giftThreshold,
      productId: settings.giftProductId,
      variantId: settings.giftVariantId,
      title: gd?.title ?? settings.giftTitle ?? "Free gift",
      image: gd?.featuredImage?.url ?? settings.giftImageUrl ?? null,
      price: gv?.price ?? null,
      availableForSale: gv?.availableForSale ?? true,
    };
  }

  return {
    plan: settings.plan,
    currencyCode,
    settings: {
      blockTitle: settings.blockTitle,
      buttonLabel: settings.buttonLabel,
      showImage: settings.showImage,
      showPrice: settings.showPrice,
      maxVisible: settings.maxVisible,
      minCartSubtotal: settings.minCartSubtotal,
      spendGoal: settings.spendGoal,
      spendGoalText: settings.spendGoalText,
      spendGoalDoneText: settings.spendGoalDoneText,
      lowStockThreshold: settings.lowStockThreshold,
      holdoutPercent: settings.holdoutPercent,
      productSource: settings.productSource,
      audience: settings.audience,
      localizedCopy: parseCopy(settings.localizedCopyJson),
    },
    gift,
    products: enabled.map((p) => {
      const pd = map[p.productId];
      const variants = (pd?.variants?.nodes ?? []).map((v: any) => ({
        id: v.id,
        title: v.title,
        price: v.price, // shop-currency amount string, e.g. "100.00"
        availableForSale: v.availableForSale,
        quantityAvailable: v.inventoryQuantity ?? null,
        image: v.image?.url ?? null,
      }));
      return {
        productId: p.productId,
        title: pd?.title ?? p.title,
        image: pd?.featuredImage?.url ?? p.imageUrl ?? null,
        url: pd?.onlineStoreUrl ?? null,
        discountType: limits.discountAllowed ? p.discountType : null,
        discountValue: limits.discountAllowed ? p.discountValue : null,
        volumeMinQty: limits.discountAllowed ? p.volumeMinQty : null,
        volumeValue: limits.discountAllowed ? p.volumeValue : null,
        variants,
      };
    }),
  };
}

/**
 * Push the current config to the shop-owned app metafield.
 * Call this after every settings/products save.
 */
export async function syncConfigMetafield(admin: Admin, shop: string) {
  const config = await buildConfig(admin, shop);

  const shopRes = await admin.graphql(`#graphql
    query { shop { id } }
  `);
  const shopJson = await shopRes.json();
  const ownerId: string = shopJson.data.shop.id;

  const res = await admin.graphql(
    `#graphql
    mutation SetUpsellConfig($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id namespace key }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        metafields: [
          {
            ownerId,
            namespace: CONFIG_NAMESPACE,
            key: CONFIG_KEY,
            type: "json",
            value: JSON.stringify(config),
          },
        ],
      },
    },
  );

  const json = await res.json();
  const errors = json.data?.metafieldsSet?.userErrors ?? [];
  if (errors.length) {
    throw new Error(`metafieldsSet failed: ${JSON.stringify(errors)}`);
  }
  return config;
}
