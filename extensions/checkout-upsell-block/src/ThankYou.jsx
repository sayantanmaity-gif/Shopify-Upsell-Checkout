import "@shopify/ui-extensions/preact";
import { render } from "preact";

export default async () => {
  render(<ThankYou />, document.body);
};

// ---------- helpers (self-contained; the order is placed, so no cart APIs) ----------

function readConfig() {
  const entries = shopify.appMetafields.value ?? [];
  const entry = entries.find(
    (m) =>
      m.metafield?.key === "config" &&
      (m.metafield?.namespace === "$app:checkout_upsell" ||
        (m.metafield?.namespace ?? "").includes("checkout_upsell")),
  );
  if (!entry) return null;
  try {
    return JSON.parse(entry.metafield.value);
  } catch {
    return null;
  }
}

// Fixed English UI labels. (Translation was removed.)
const LABELS = {
  crossSellTitle: "You might also like",
  viewProduct: "View product",
};

function t(key) {
  return LABELS[key] ?? key;
}

function money(amount, currencyCode) {
  const n = Number(amount) || 0;
  try {
    return shopify.i18n.formatCurrency(n, { currency: currencyCode || "USD" });
  } catch {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currencyCode || "USD",
      }).format(n);
    } catch {
      return `${currencyCode ?? ""} ${n.toFixed(2)}`.trim();
    }
  }
}

function crossSellTitle(settings) {
  return settings?.blockTitle || t("crossSellTitle");
}

// ---------- root ----------

function ThankYou() {
  const config = readConfig();
  if (!config) return null;

  const settings = config.settings ?? {};
  const currencyCode = config.currencyCode ?? "USD";
  const maxVisible = Number(settings.maxVisible) || 3;

  // Curated manual products only — the cart can't be mutated post-purchase, so
  // these are a cross-sell display that links out to the storefront.
  const products = (config.products ?? [])
    .filter((p) => {
      const variant = (p.variants ?? []).find((v) => v.availableForSale);
      return p.url && variant; // need a storefront URL to link to
    })
    .slice(0, maxVisible);

  if (products.length === 0) return null;

  return (
    <s-stack gap="base">
      <s-heading>{crossSellTitle(settings)}</s-heading>
      {products.map((p) => {
        const variant =
          (p.variants ?? []).find((v) => v.availableForSale) ?? null;
        const image = variant?.image ?? p.image ?? null;
        return (
          <s-box
            key={p.productId}
            padding="base"
            border="base"
            borderRadius="large"
            background="subdued"
          >
            <s-stack direction="inline" gap="base" alignItems="center">
              {settings.showImage && image && (
                <s-box inlineSize="64px">
                  <s-image
                    src={image}
                    alt={p.title}
                    inlineSize="fill"
                    aspectRatio="1"
                    borderRadius="base"
                  />
                </s-box>
              )}
              <s-stack gap="small-200">
                <s-text type="strong">{p.title}</s-text>
                {settings.showPrice && variant?.price != null && (
                  <s-text color="subdued">
                    {money(variant.price, currencyCode)}
                  </s-text>
                )}
              </s-stack>
              <s-link href={p.url} target="_blank">
                {t("viewProduct")}
              </s-link>
            </s-stack>
          </s-box>
        );
      })}
    </s-stack>
  );
}
