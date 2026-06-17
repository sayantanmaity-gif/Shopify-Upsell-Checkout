import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { setPlan } from "../models/upsell.server";
import { syncConfigMetafield } from "../models/metafield.server";

const IS_TEST = process.env.NODE_ENV !== "production";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing, session, admin } = await authenticate.admin(request);

  // With Managed Pricing there are no code-defined plans; check for ANY active
  // subscription to know whether the merchant is on a paid plan.
  const { hasActivePayment } = await billing.check({ isTest: IS_TEST });

  await setPlan(session.shop, hasActivePayment ? "paid" : "free");
  await syncConfigMetafield(admin, session.shop);

  // Look up the app handle to build the Shopify-hosted Managed Pricing URL.
  let appHandle = "";
  try {
    const res = await admin.graphql(`#graphql
      query { currentAppInstallation { app { handle } } }
    `);
    const json = await res.json();
    appHandle = json.data?.currentAppInstallation?.app?.handle ?? "";
  } catch {
    // ignore — the manage button just won't have a target.
  }

  const store = session.shop.replace(".myshopify.com", "");
  const pricingUrl = appHandle
    ? `https://admin.shopify.com/store/${store}/charges/${appHandle}/pricing_plans`
    : null;

  return { isPaid: hasActivePayment, pricingUrl };
};

export default function PricingPage() {
  const { isPaid, pricingUrl } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Pricing">
      <s-section heading="Plans">
        <s-stack direction="inline" gap="large">
          <s-box padding="large" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="base">
              <s-heading>Free</s-heading>
              <s-text type="strong">$0/mo</s-text>
              <s-unordered-list>
                <s-list-item>Up to 4 upsell products</s-list-item>
                <s-list-item>Percentage or fixed discounts</s-list-item>
                <s-list-item>Full block content settings</s-list-item>
              </s-unordered-list>
              {!isPaid && <s-badge tone="success">Current plan</s-badge>}
            </s-stack>
          </s-box>

          <s-box padding="large" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="base">
              <s-heading>Pro</s-heading>
              <s-text type="strong">$9.99/mo</s-text>
              <s-text color="subdued">7-day free trial</s-text>
              <s-unordered-list>
                <s-list-item>Up to 5 upsell products</s-list-item>
                <s-list-item>Everything in Free</s-list-item>
                <s-list-item>Priority support</s-list-item>
              </s-unordered-list>
              {isPaid && <s-badge tone="success">Current plan</s-badge>}
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      <s-section heading="Manage subscription">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Plans are managed by Shopify. Use the button below to choose or
            change your plan.
          </s-paragraph>
          {pricingUrl ? (
            <s-button href={pricingUrl} target="_top" variant="primary">
              {isPaid ? "Manage plan" : "Choose a plan"}
            </s-button>
          ) : (
            <s-banner tone="warning">
              Plan management opens in your Shopify admin under Settings → Apps.
            </s-banner>
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}
