import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getShopSettings, saveShopSettings } from "../models/upsell.server";
import { syncConfigMetafield } from "../models/metafield.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await getShopSettings(session.shop);
  return { settings };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const payload = JSON.parse(String(form.get("payload") ?? "{}"));

  await saveShopSettings(session.shop, {
    blockTitle: String(payload.blockTitle ?? ""),
    buttonLabel: String(payload.buttonLabel ?? ""),
    showImage: Boolean(payload.showImage),
    showPrice: Boolean(payload.showPrice),
    maxVisible: Math.min(Math.max(Number(payload.maxVisible) || 3, 1), 10),
    minCartSubtotal: Math.max(0, Number(payload.minCartSubtotal) || 0),
    spendGoal: Math.max(0, Number(payload.spendGoal) || 0),
    spendGoalText: String(payload.spendGoalText ?? ""),
    spendGoalDoneText: String(payload.spendGoalDoneText ?? ""),
    lowStockThreshold: Math.max(0, Math.floor(Number(payload.lowStockThreshold) || 0)),
    holdoutPercent: Math.min(50, Math.max(0, Math.floor(Number(payload.holdoutPercent) || 0))),
    audience: ["all", "loggedIn", "guests"].includes(String(payload.audience))
      ? String(payload.audience)
      : "all",
  });

  await syncConfigMetafield(admin, session.shop);
  return { ok: true };
};

export default function SettingsPage() {
  const { settings } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [form, setForm] = useState({
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
    audience: settings.audience,
  });

  // Read the value synchronously — currentTarget is nulled out before a lazy
  // setState updater runs, which would throw "Cannot read properties of null".
  const set = (key: keyof typeof form) => (e: Event) => {
    const el = (e.currentTarget ?? e.target) as any;
    const value = el?.value ?? "";
    setForm((f) => ({ ...f, [key]: value }));
  };
  const setChecked = (key: keyof typeof form) => (e: Event) => {
    const el = (e.currentTarget ?? e.target) as any;
    const checked = Boolean(el?.checked);
    setForm((f) => ({ ...f, [key]: checked }));
  };

  const saving = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.ok) {
      shopify.toast.show("Settings saved");
    }
  }, [fetcher.data, shopify]);

  const save = () =>
    fetcher.submit({ payload: JSON.stringify(form) }, { method: "POST" });

  return (
    <s-page heading="Block settings">
      <s-button
        slot="primary-action"
        onClick={save}
        {...(saving ? { loading: true } : {})}
      >
        Save
      </s-button>

      <s-section heading="Text">
        <s-stack direction="block" gap="base">
          <s-text-field
            label="Block title"
            name="blockTitle"
            value={form.blockTitle}
            onInput={set("blockTitle")}
          />
          <s-text-field
            label="Add button label"
            name="buttonLabel"
            value={form.buttonLabel}
            onInput={set("buttonLabel")}
          />
        </s-stack>
      </s-section>

      <s-section heading="Display">
        <s-stack direction="block" gap="base">
          <s-switch
            label="Show product image"
            checked={form.showImage}
            onChange={setChecked("showImage")}
          />
          <s-switch
            label="Show price"
            checked={form.showPrice}
            onChange={setChecked("showPrice")}
          />
          <s-number-field
            label="Products to show in checkout"
            details="Between 1 and 10. Buyers can see more if you offer more."
            value={String(form.maxVisible)}
            min={1}
            max={10}
            onInput={set("maxVisible")}
          />
        </s-stack>
      </s-section>

      <s-section heading="Incentives">
        <s-stack direction="block" gap="base">
          <s-number-field
            label="Spending goal (progress bar)"
            details="Show a progress bar toward this cart subtotal (e.g. free-shipping threshold). 0 = off."
            value={String(form.spendGoal)}
            min={0}
            onInput={set("spendGoal")}
          />
          <s-text-field
            label="Goal message (use {amount} for the remaining amount)"
            value={form.spendGoalText}
            onInput={set("spendGoalText")}
          />
          <s-text-field
            label="Goal reached message"
            value={form.spendGoalDoneText}
            onInput={set("spendGoalDoneText")}
          />
          <s-number-field
            label="Low-stock urgency threshold"
            details="Show an “Only N left” badge when a product's inventory is at or below this. 0 = off."
            value={String(form.lowStockThreshold)}
            min={0}
            onInput={set("lowStockThreshold")}
          />
        </s-stack>
      </s-section>

      <s-section heading="Targeting">
        <s-stack direction="block" gap="base">
          <s-number-field
            label="Minimum cart subtotal to show upsells"
            details="Only show offers once the cart subtotal reaches this amount (in your store currency). 0 = always show."
            value={String(form.minCartSubtotal)}
            min={0}
            onInput={set("minCartSubtotal")}
          />
          <s-select
            label="Show to"
            value={form.audience}
            onChange={set("audience")}
          >
            <s-option value="all">All shoppers</s-option>
            <s-option value="loggedIn">Logged-in customers only</s-option>
            <s-option value="guests">Guests only</s-option>
          </s-select>
          <s-number-field
            label="A/B holdout (%)"
            details="Hide upsells from this % of buyers (0–50) to measure incremental lift on the Dashboard. 0 = off."
            value={String(form.holdoutPercent)}
            min={0}
            max={50}
            onInput={set("holdoutPercent")}
          />
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="About styling">
        <s-paragraph>
          The block's colors, fonts, and spacing follow your checkout's theme
          automatically — checkout extensions are sandboxed by Shopify, so there
          are no color or layout controls here. You control the content (text,
          image/price visibility, how many offers, and targeting).
        </s-paragraph>
      </s-section>
    </s-page>
  );
}
