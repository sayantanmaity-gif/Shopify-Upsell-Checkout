import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  getShopSettings,
  getUpsellProducts,
  planLimits,
} from "../models/upsell.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await getShopSettings(session.shop);
  const products = await getUpsellProducts(session.shop);
  const storeHandle = session.shop.replace(/\.myshopify\.com$/, "");
  // Heuristic "block is live": we've recorded at least one upsell order, which
  // only happens if the block is placed in checkout and a buyer used it.
  const blockActive =
    (await prisma.upsellOrder.count({ where: { shop: session.shop } })) > 0;
  return {
    plan: settings.plan,
    limits: planLimits(settings.plan),
    productCount: products.length,
    enabledCount: products.filter((p) => p.enabled).length,
    hasDiscount: products.some(
      (p) => p.discountType && (p.discountValue ?? 0) > 0,
    ),
    blockActive,
    checkoutUrl: `https://admin.shopify.com/store/${storeHandle}/settings/checkout`,
  };
};

export default function Index() {
  const {
    plan,
    limits,
    productCount,
    enabledCount,
    hasDiscount,
    blockActive,
    checkoutUrl,
  } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Checkout Upsell">
      <s-section heading="Setup checklist">
        <s-stack direction="block" gap="base">
          <ChecklistRow
            done={productCount > 0}
            label="Choose upsell products"
            actionLabel={productCount > 0 ? "Edit" : "Choose products"}
            href="/app/products"
          />
          <ChecklistRow
            done={hasDiscount}
            optional
            label="Set a discount (optional)"
            actionLabel="Configure"
            href="/app/products"
          />
          <ChecklistRow
            done={blockActive}
            label="Add the block to your checkout"
            actionLabel="Open checkout editor"
            href={checkoutUrl}
            external
          />
        </s-stack>
      </s-section>

      <s-section heading="Overview">
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-text type="strong">Plan:</s-text>
            <s-badge tone={plan === "paid" ? "success" : "info"}>
              {plan === "paid" ? "Pro" : "Free"}
            </s-badge>
          </s-stack>
          <s-text>
            {enabledCount} of {productCount} products active (limit{" "}
            {limits.maxProducts}).
          </s-text>
          <s-paragraph>
            Configure which products to upsell, adjust the block settings, then
            add the <s-text type="strong">Checkout Upsell</s-text> block to your
            checkout in the checkout editor.
          </s-paragraph>
        </s-stack>
      </s-section>

      <s-section heading="Get started">
        <s-stack direction="inline" gap="base">
          <s-button href="/app/products">Choose products</s-button>
          <s-button href="/app/settings" variant="secondary">
            Block settings
          </s-button>
          <s-button href="/app/pricing" variant="tertiary">
            View plans
          </s-button>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="How it works">
        <s-ordered-list>
          <s-list-item>Pick up to {limits.maxProducts} products.</s-list-item>
          <s-list-item>Set a discount per product (Pro).</s-list-item>
          <s-list-item>Drag the block into your checkout.</s-list-item>
        </s-ordered-list>
      </s-section>
    </s-page>
  );
}

function ChecklistRow({
  done,
  optional,
  label,
  actionLabel,
  href,
  external,
}: {
  done: boolean;
  optional?: boolean;
  label: string;
  actionLabel: string;
  href: string;
  external?: boolean;
}) {
  return (
    <s-stack direction="inline" gap="base" alignItems="center">
      <s-badge tone={done ? "success" : optional ? "info" : "caution"}>
        {done ? "Done" : optional ? "Optional" : "To do"}
      </s-badge>
      <s-text>{label}</s-text>
      <s-button
        href={href}
        variant="tertiary"
        {...(external ? { target: "_top" } : {})}
      >
        {actionLabel}
      </s-button>
    </s-stack>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
