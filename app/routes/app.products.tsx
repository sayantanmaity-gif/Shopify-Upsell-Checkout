import { useEffect, useState, type DragEvent } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import {
  getShopSettings,
  getUpsellProducts,
  planLimits,
  saveUpsellProducts,
  setGift,
  setProductSource,
  type UpsellProductInput,
} from "../models/upsell.server";
import { syncConfigMetafield } from "../models/metafield.server";
import { ensureUpsellDiscount, setDiscountConfig } from "../models/discount.server";

type Row = {
  productId: string;
  variantId: string;
  title: string;
  imageUrl: string | null;
  price: string | null;
  discountType: "none" | "percentage" | "fixed";
  discountValue: string; // kept as string for the input; parsed on save
  volumeMinQty: string; // quantity break: min qty (>=2) to apply volumeValue
  volumeValue: string; // discount value (same type) at volumeMinQty+
  enabled: boolean;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await getShopSettings(session.shop);
  const products = await getUpsellProducts(session.shop);
  const limits = planLimits(settings.plan);
  return {
    plan: settings.plan,
    limits,
    products,
    productSource: settings.productSource,
    gift: {
      productId: settings.giftProductId,
      variantId: settings.giftVariantId,
      title: settings.giftTitle,
      imageUrl: settings.giftImageUrl,
      threshold: settings.giftThreshold,
    },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const rows: Row[] = JSON.parse(String(form.get("payload") ?? "[]"));
  await setProductSource(session.shop, String(form.get("productSource") ?? "manual"));

  const gift = JSON.parse(String(form.get("gift") ?? "null"));
  await setGift(session.shop, {
    giftProductId: gift?.productId ?? null,
    giftVariantId: gift?.variantId ?? null,
    giftTitle: gift?.title ?? null,
    giftImageUrl: gift?.imageUrl ?? null,
    giftThreshold: Number(gift?.threshold) || 0,
  });

  const products: UpsellProductInput[] = rows.map((r, i) => ({
    productId: r.productId,
    variantId: r.variantId,
    title: r.title,
    imageUrl: r.imageUrl,
    price: r.price,
    discountType: r.discountType === "none" ? null : r.discountType,
    discountValue:
      r.discountType === "none" ? null : Number(r.discountValue) || 0,
    volumeMinQty:
      r.discountType === "none" ? null : Math.floor(Number(r.volumeMinQty)) || null,
    volumeValue:
      r.discountType === "none" ? null : Number(r.volumeValue) || null,
    enabled: r.enabled,
    displayOrder: i,
  }));

  await saveUpsellProducts(session.shop, products);
  await syncConfigMetafield(admin, session.shop);

  // Activate the discount function if any product has a discount OR a free gift
  // is configured (the gift is applied as a 100%-off discount).
  const hasDiscount = products.some(
    (p) => p.discountType && (p.discountValue ?? 0) > 0,
  );
  const hasGift = (Number(gift?.threshold) || 0) > 0 && gift?.variantId;
  if (hasDiscount || hasGift) {
    try {
      await ensureUpsellDiscount(admin, session.shop);
    } catch (e) {
      console.error("Failed to activate upsell discount", e);
    }
  }

  // Push the per-product discount map to the discount node metafield (the
  // function reads it). No-ops if no discount node exists.
  try {
    await setDiscountConfig(admin, session.shop);
  } catch (e) {
    console.error("Failed to sync upsell discount config", e);
  }

  return { ok: true };
};

// Validate a row's discount against its type and price. Returns an error
// message or null. Drives both the inline field error and the Save guard.
function discountError(row: Row): string | null {
  if (row.discountType === "none" || row.discountValue === "") return null;
  const v = Number(row.discountValue);
  if (!Number.isFinite(v) || v <= 0) return "Enter a value greater than 0.";
  if (row.discountType === "percentage" && v > 100)
    return "Percentage can't exceed 100.";
  if (row.discountType === "fixed") {
    const price = Number(row.price);
    if (Number.isFinite(price) && v > price)
      return "Amount can't exceed the product price.";
  }
  return null;
}

function toRow(p: {
  productId: string;
  variantId: string;
  title: string;
  imageUrl: string | null;
  price: string | null;
  discountType: string | null;
  discountValue: number | null;
  volumeMinQty: number | null;
  volumeValue: number | null;
  enabled: boolean;
}): Row {
  return {
    productId: p.productId,
    variantId: p.variantId,
    title: p.title,
    imageUrl: p.imageUrl,
    price: p.price,
    discountType: (p.discountType as Row["discountType"]) ?? "none",
    discountValue: p.discountValue != null ? String(p.discountValue) : "",
    volumeMinQty: p.volumeMinQty != null ? String(p.volumeMinQty) : "",
    volumeValue: p.volumeValue != null ? String(p.volumeValue) : "",
    enabled: p.enabled,
  };
}

export default function ProductsPage() {
  const { limits, products, productSource, gift } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [rows, setRows] = useState<Row[]>(products.map(toRow));
  const [source, setSource] = useState(productSource);
  const [giftState, setGiftState] = useState({
    productId: gift.productId ?? "",
    variantId: gift.variantId ?? "",
    title: gift.title ?? "",
    imageUrl: gift.imageUrl ?? "",
    threshold: gift.threshold ? String(gift.threshold) : "",
  });
  const saving = fetcher.state !== "idle";
  const atLimit = rows.length >= limits.maxProducts;

  useEffect(() => {
    if (fetcher.data?.ok) shopify.toast.show("Upsell products saved");
  }, [fetcher.data, shopify]);

  const pickProducts = async () => {
    const selection = await shopify.resourcePicker({
      type: "product",
      multiple: limits.maxProducts,
      action: "select",
    });
    if (!selection) return;

    const existing = new Map(rows.map((r) => [r.productId, r]));
    const next: Row[] = selection
      .slice(0, limits.maxProducts)
      .map((product: any) => {
        const prev = existing.get(product.id);
        if (prev) return prev;
        const variant = product.variants?.[0];
        return {
          productId: product.id,
          variantId: variant?.id ?? product.id,
          title: product.title,
          imageUrl: product.images?.[0]?.originalSrc ?? null,
          price: variant?.price ?? null,
          discountType: "none",
          discountValue: "",
          volumeMinQty: "",
          volumeValue: "",
          enabled: true,
        } as Row;
      });
    setRows(next);
  };

  const update = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const remove = (i: number) =>
    setRows((rs) => rs.filter((_, idx) => idx !== i));

  // Keyboard-accessible reorder (drag is mouse-only).
  const move = (i: number, dir: -1 | 1) =>
    setRows((rs) => {
      const j = i + dir;
      if (j < 0 || j >= rs.length) return rs;
      const next = [...rs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const errors = rows.map(discountError);
  const hasErrors = errors.some(Boolean);

  // Drag-to-reorder: priority runs top (first) to bottom (last).
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const onDragOver = (e: DragEvent, i: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === i) return;
    setRows((rs) => {
      const next = [...rs];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(i, 0, moved);
      return next;
    });
    setDragIndex(i);
  };

  const pickGift = async () => {
    const selection = await shopify.resourcePicker({
      type: "product",
      action: "select",
    });
    if (!selection || selection.length === 0) return;
    const product: any = selection[0];
    const variant = product.variants?.[0];
    setGiftState((g) => ({
      ...g,
      productId: product.id,
      variantId: variant?.id ?? product.id,
      title: product.title,
      imageUrl: product.images?.[0]?.originalSrc ?? "",
    }));
  };
  const clearGift = () =>
    setGiftState({
      productId: "",
      variantId: "",
      title: "",
      imageUrl: "",
      threshold: "",
    });

  const save = () =>
    fetcher.submit(
      {
        payload: JSON.stringify(rows),
        productSource: source,
        gift: JSON.stringify(
          giftState.variantId && Number(giftState.threshold) > 0
            ? giftState
            : null,
        ),
      },
      { method: "POST" },
    );

  return (
    <s-page heading="Upsell products">
      <s-button
        slot="primary-action"
        onClick={save}
        {...(saving ? { loading: true } : {})}
        {...(hasErrors ? { disabled: true } : {})}
      >
        Save
      </s-button>

      <s-section
        heading={`Offered products (${rows.length}/${limits.maxProducts})`}
      >
        <s-stack direction="block" gap="base">
          <s-select
            label="Recommendation source"
            details="“Shopify AI” shows live recommendations based on each buyer's cart. “Both” shows your products first, then fills with AI. Your products below are also the discount catalog — an AI item gets a discount only if its variant is in your list."
            value={source}
            onChange={(e: Event) =>
              setSource((e.currentTarget as any).value)
            }
          >
            <s-option value="manual">My products</s-option>
            <s-option value="ai">Shopify AI recommendations</s-option>
            <s-option value="both">Both</s-option>
          </s-select>

          <s-banner tone="info">
            Select up to {limits.maxProducts} products. Drag to set priority —
            the order here is the order buyers see. Control how many show at
            checkout on the Settings page.
          </s-banner>

          <s-button onClick={pickProducts} {...(atLimit ? {} : {})}>
            {rows.length ? "Change products" : "Select products"}
          </s-button>

          {rows.length === 0 && (
            <s-paragraph>No upsell products selected yet.</s-paragraph>
          )}

          {rows.map((row, i) => (
            <div
              key={row.productId}
              onDragOver={(e) => onDragOver(e, i)}
              onDrop={() => setDragIndex(null)}
              style={{ opacity: dragIndex === i ? 0.4 : 1 }}
            >
              <s-box padding="base" borderWidth="base" borderRadius="base">
                <s-stack direction="block" gap="base">
                  <s-stack
                    direction="inline"
                    gap="small-200"
                    alignItems="center"
                  >
                    <div
                      draggable
                      onDragStart={() => setDragIndex(i)}
                      onDragEnd={() => setDragIndex(null)}
                      style={{ cursor: "grab" }}
                    >
                      <s-text color="subdued">
                        ⠿ Priority {i + 1} — drag to reorder
                      </s-text>
                    </div>
                    <s-button
                      variant="tertiary"
                      accessibilityLabel="Move up"
                      onClick={() => move(i, -1)}
                      {...(i === 0 ? { disabled: true } : {})}
                    >
                      ↑
                    </s-button>
                    <s-button
                      variant="tertiary"
                      accessibilityLabel="Move down"
                      onClick={() => move(i, 1)}
                      {...(i === rows.length - 1 ? { disabled: true } : {})}
                    >
                      ↓
                    </s-button>
                  </s-stack>
                  <s-stack direction="inline" gap="base" alignItems="center">
                    {row.imageUrl && (
                      <s-thumbnail src={row.imageUrl} alt={row.title} />
                    )}
                    <s-stack direction="block" gap="none">
                      <s-text type="strong">{row.title}</s-text>
                      {row.price && (
                        <s-text color="subdued">{row.price}</s-text>
                      )}
                    </s-stack>
                  </s-stack>

                <s-switch
                  label="Enabled"
                  checked={row.enabled}
                  onChange={(e: Event) =>
                    update(i, { enabled: (e.currentTarget as any).checked })
                  }
                />

                <s-stack direction="inline" gap="base">
                  <s-select
                    label="Discount"
                    value={row.discountType}
                    disabled={!limits.discountAllowed}
                    onChange={(e: Event) =>
                      update(i, {
                        discountType: (e.currentTarget as any)
                          .value as Row["discountType"],
                      })
                    }
                  >
                    <s-option value="none">No discount</s-option>
                    <s-option value="percentage">Percentage off</s-option>
                    <s-option value="fixed">Fixed amount off</s-option>
                  </s-select>

                  {limits.discountAllowed &&
                    row.discountType !== "none" && (
                      <s-number-field
                        label={
                          row.discountType === "percentage"
                            ? "Percent (%)"
                            : "Amount"
                        }
                        value={row.discountValue}
                        min={0}
                        {...(errors[i] ? { error: errors[i] as string } : {})}
                        onInput={(e: Event) =>
                          update(i, {
                            discountValue: (e.currentTarget as any).value,
                          })
                        }
                      />
                    )}
                </s-stack>

                {limits.discountAllowed && row.discountType !== "none" && (
                  <s-stack direction="inline" gap="base">
                    <s-number-field
                      label="Volume: min qty"
                      details="Buy this many or more…"
                      value={row.volumeMinQty}
                      min={0}
                      onInput={(e: Event) =>
                        update(i, {
                          volumeMinQty: (e.currentTarget as any).value,
                        })
                      }
                    />
                    <s-number-field
                      label={
                        row.discountType === "percentage"
                          ? "…then percent (%)"
                          : "…then amount"
                      }
                      value={row.volumeValue}
                      min={0}
                      onInput={(e: Event) =>
                        update(i, {
                          volumeValue: (e.currentTarget as any).value,
                        })
                      }
                    />
                  </s-stack>
                )}

                  <s-button
                    variant="tertiary"
                    tone="critical"
                    onClick={() => remove(i)}
                  >
                    Remove
                  </s-button>
                </s-stack>
              </s-box>
            </div>
          ))}
        </s-stack>
      </s-section>

      <s-section heading="Free gift with purchase">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Offer a product for free once the cart subtotal reaches a threshold.
            It's added at 100% off via the discount.
          </s-paragraph>
          {giftState.variantId ? (
            <s-stack direction="inline" gap="base" alignItems="center">
              {giftState.imageUrl && (
                <s-thumbnail src={giftState.imageUrl} alt={giftState.title} />
              )}
              <s-text type="strong">{giftState.title}</s-text>
              <s-button variant="secondary" onClick={pickGift}>
                Change
              </s-button>
              <s-button variant="tertiary" tone="critical" onClick={clearGift}>
                Remove gift
              </s-button>
            </s-stack>
          ) : (
            <s-button onClick={pickGift}>Select gift product</s-button>
          )}
          <s-number-field
            label="Cart subtotal to unlock the gift"
            details="In your store currency. The gift offer appears once the cart reaches this amount."
            value={giftState.threshold}
            min={0}
            onInput={(e: Event) =>
              setGiftState((g) => ({
                ...g,
                threshold: (e.currentTarget as any).value,
              }))
            }
          />
        </s-stack>
      </s-section>
    </s-page>
  );
}
