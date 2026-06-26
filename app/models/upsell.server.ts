import prisma from "../db.server";

// Plan limits — single source of truth for freemium gating.
export const PLAN_LIMITS = {
  free: { maxProducts: 10, discountAllowed: true },
  paid: { maxProducts: 10, discountAllowed: true },
} as const;

export type PlanName = keyof typeof PLAN_LIMITS;

export function planLimits(plan: string) {
  return PLAN_LIMITS[(plan as PlanName)] ?? PLAN_LIMITS.free;
}

const DEFAULT_SETTINGS = {
  blockTitle: "You might also like",
  buttonLabel: "Add to order",
  showImage: true,
  showPrice: true,
  maxVisible: 3,
  minCartSubtotal: 0,
  spendGoal: 0,
  spendGoalText: "Spend {amount} more to unlock free shipping!",
  spendGoalDoneText: "You've unlocked free shipping! 🎉",
  lowStockThreshold: 0,
  holdoutPercent: 0,
  giftThreshold: 0,
  productSource: "manual",
  audience: "all",
  plan: "free",
};

/** Get the shop's settings, creating defaults on first access. */
export async function getShopSettings(shop: string) {
  return prisma.shopSettings.upsert({
    where: { shop },
    update: {},
    create: { shop, ...DEFAULT_SETTINGS },
  });
}

export type SettingsInput = {
  blockTitle: string;
  buttonLabel: string;
  showImage: boolean;
  showPrice: boolean;
  maxVisible: number;
  minCartSubtotal: number;
  spendGoal: number;
  spendGoalText: string;
  spendGoalDoneText: string;
  lowStockThreshold: number;
  holdoutPercent: number;
  audience: string;
};

export async function saveShopSettings(shop: string, input: SettingsInput) {
  await getShopSettings(shop); // ensure row exists
  return prisma.shopSettings.update({ where: { shop }, data: input });
}

/** Set where upsell products come from: "manual" | "ai" | "both". */
export async function setProductSource(shop: string, productSource: string) {
  await getShopSettings(shop);
  const valid = ["manual", "ai", "both"].includes(productSource)
    ? productSource
    : "manual";
  return prisma.shopSettings.update({
    where: { shop },
    data: { productSource: valid },
  });
}

export type GiftInput = {
  giftProductId: string | null;
  giftVariantId: string | null;
  giftTitle: string | null;
  giftImageUrl: string | null;
  giftThreshold: number;
};

/** Set the free-gift product + threshold (set from the Products page). */
export async function setGift(shop: string, input: GiftInput) {
  await getShopSettings(shop);
  return prisma.shopSettings.update({
    where: { shop },
    data: {
      giftProductId: input.giftProductId,
      giftVariantId: input.giftVariantId,
      giftTitle: input.giftTitle,
      giftImageUrl: input.giftImageUrl,
      giftThreshold: Math.max(0, input.giftThreshold || 0),
    },
  });
}

/** Reconcile the stored plan with the merchant's billing status. */
export async function setPlan(shop: string, plan: PlanName) {
  await getShopSettings(shop);
  return prisma.shopSettings.update({ where: { shop }, data: { plan } });
}

export async function getUpsellProducts(shop: string) {
  return prisma.upsellProduct.findMany({
    where: { shop },
    orderBy: { displayOrder: "asc" },
  });
}

export type UpsellProductInput = {
  productId: string;
  variantId: string;
  title: string;
  imageUrl?: string | null;
  price?: string | null;
  discountType?: "percentage" | "fixed" | null;
  discountValue?: number | null;
  volumeMinQty?: number | null;
  volumeValue?: number | null;
  enabled: boolean;
  displayOrder: number;
};

/**
 * Replace the shop's upsell product set in one transaction.
 * Enforces plan limits: max product count and whether discounts are allowed.
 */
export async function saveUpsellProducts(
  shop: string,
  products: UpsellProductInput[],
) {
  const settings = await getShopSettings(shop);
  const limits = planLimits(settings.plan);

  const trimmed = products.slice(0, limits.maxProducts).map((p, i) => {
    const allow = limits.discountAllowed;
    // A volume tier is valid only with a base discount, a min qty >= 2, and a value.
    const hasVolume =
      allow &&
      (p.discountType ?? null) != null &&
      (p.volumeMinQty ?? 0) >= 2 &&
      (p.volumeValue ?? 0) > 0;
    return {
      ...p,
      displayOrder: i,
      // Strip discounts on plans that don't allow them.
      discountType: allow ? p.discountType ?? null : null,
      discountValue: allow ? p.discountValue ?? null : null,
      volumeMinQty: hasVolume ? p.volumeMinQty ?? null : null,
      volumeValue: hasVolume ? p.volumeValue ?? null : null,
    };
  });

  await prisma.$transaction([
    prisma.upsellProduct.deleteMany({ where: { shop } }),
    ...(trimmed.length
      ? [
          prisma.upsellProduct.createMany({
            data: trimmed.map((p) => ({ shop, ...p })),
          }),
        ]
      : []),
  ]);

  return getUpsellProducts(shop);
}
