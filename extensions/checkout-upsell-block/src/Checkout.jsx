import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

export default async () => {
  render(<Extension />, document.body);
};

// ---------- helpers ----------

// Read the app-owned shop metafield the admin app writes our config into.
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

// Fixed English UI labels. (Translation was removed — these are plain strings,
// with {placeholder} interpolation from the optional replacements object.)
const LABELS = {
  percentOff: "{value}% off",
  saveAmount: "Save {amount}",
  was: "was {price}",
  option: "Option",
  addToOrder: "Add to order",
  decreaseQuantity: "Decrease quantity",
  increaseQuantity: "Increase quantity",
  remove: "Remove",
  freeGift: "Free gift",
  free: "Free",
  onlyNLeft: "Only {count} left",
  addAll: "Add all to order",
  volumeSave: "Buy {count}+ and save",
  crossSellTitle: "You might also like",
  viewProduct: "View product",
};

function t(key, replacements) {
  let s = LABELS[key] ?? key;
  if (replacements) {
    for (const [k, v] of Object.entries(replacements)) {
      s = s.replace(`{${k}}`, String(v));
    }
  }
  return s;
}

// Format money in the buyer's checkout locale + the store's currency.
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

function discountedAmount(amount, product) {
  const n = Number(amount);
  if (!product.discountType || !product.discountValue) return null;
  if (product.discountType === "percentage") {
    return Math.max(0, n * (1 - product.discountValue / 100));
  }
  return Math.max(0, n - product.discountValue);
}

function discountBadge(product, currencyCode) {
  if (!product.discountType || !product.discountValue) return null;
  return product.discountType === "percentage"
    ? t("percentOff", { value: product.discountValue })
    : t("saveAmount", { amount: money(product.discountValue, currencyCode) });
}

// Is there an authenticated buyer? Used for audience targeting (no PII read).
function buyerLoggedIn() {
  try {
    const c =
      shopify.authenticatedAccount?.customer?.value ??
      shopify.customer?.value ??
      null;
    return Boolean(c && c.id);
  } catch {
    return false;
  }
}

// Live Shopify recommendations (Storefront Direct Access) seeded by the cart's
// products. Returns raw Storefront product nodes; mapped at render time.
async function fetchRecommendations(seedIds) {
  const query = `query Recs($productId: ID!, $intent: ProductRecommendationIntent) {
    productRecommendations(productId: $productId, intent: $intent) {
      id
      title
      featuredImage { url }
      variants(first: 10) {
        nodes {
          id
          title
          availableForSale
          quantityAvailable
          image { url }
          price { amount currencyCode }
        }
      }
    }
  }`;
  const seen = new Set();
  const out = [];
  for (const productId of seedIds.slice(0, 3)) {
    try {
      const res = await shopify.query(query, {
        variables: { productId, intent: "RELATED" },
      });
      for (const p of res?.data?.productRecommendations ?? []) {
        if (p?.id && !seen.has(p.id)) {
          seen.add(p.id);
          out.push(p);
        }
      }
    } catch {
      /* recommendations are best-effort */
    }
  }
  return out;
}

// Shape a Storefront recommendation like a config product, attaching the
// merchant's per-product discount if this product is in their list.
function mapRecommendation(p, discountByProductId) {
  const d = discountByProductId[p.id] ?? {};
  return {
    productId: p.id,
    title: p.title,
    image: p.featuredImage?.url ?? null,
    discountType: d.discountType ?? null,
    discountValue: d.discountValue ?? null,
    variants: (p.variants?.nodes ?? []).map((v) => ({
      id: v.id,
      title: v.title,
      price: v.price?.amount ?? null,
      availableForSale: v.availableForSale,
      quantityAvailable: v.quantityAvailable ?? null,
      image: v.image?.url ?? null,
    })),
  };
}

// In stock = available for sale and (if inventory is tracked) quantity > 0.
function inStock(v) {
  return (
    v.availableForSale &&
    (v.quantityAvailable == null || v.quantityAvailable > 0)
  );
}

// Source of truth for which products this block added as upsells: a single
// cart-level attribute "Upsell products" holding a JSON map of
// variantGid -> product title, e.g. {"gid://.../123": "Ski Wax"}. Matching
// (discount + analytics) keys off the variant GID so it's exact even when two
// products share a title; the title is kept as the value so the order's
// Additional details stay human-readable. We use a cart attribute (not per-line
// attributes) because Shopify propagates line attributes set via addCartLine to
// every line in the cart, which would mis-tag the buyer's own products.
const UPSELL_KEY = "Upsell products";

function readUpsellMap() {
  const attrs = shopify.attributes.value ?? [];
  const entry = attrs.find((a) => a.key === UPSELL_KEY);
  if (!entry?.value) return {};
  try {
    const parsed = JSON.parse(entry.value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeUpsellMap(map) {
  await shopify.applyAttributeChange({
    type: "updateAttribute",
    key: UPSELL_KEY,
    value: JSON.stringify(map),
  });
}

// Drop entries whose variant is no longer in the cart, so the attribute (and
// the order's Additional details) never accumulates stale upsells from earlier
// checkout sessions.
function pruneMap(map) {
  const inCart = new Set((shopify.lines.value ?? []).map((l) => l.merchandise.id));
  const next = {};
  for (const [variantId, title] of Object.entries(map)) {
    if (inCart.has(variantId)) next[variantId] = title;
  }
  return next;
}

// A/B holdout group, stored in a cart attribute so it's stable across renders
// and carries to the order for the lift report. "control" sees no upsells.
const GROUP_KEY = "_upsell_group";

function readGroup() {
  const attrs = shopify.attributes.value ?? [];
  return attrs.find((a) => a.key === GROUP_KEY)?.value ?? null;
}

async function writeGroup(group) {
  await shopify.applyAttributeChange({
    type: "updateAttribute",
    key: GROUP_KEY,
    value: group,
  });
}

async function markUpsell(variantId, title) {
  const map = pruneMap(readUpsellMap());
  map[variantId] = title; // keep the just-added one even if not yet in lines
  await writeUpsellMap(map);
}

async function unmarkUpsell(variantId) {
  const map = pruneMap(readUpsellMap());
  delete map[variantId];
  await writeUpsellMap(map);
}

// ---------- root ----------

function Extension() {
  const config = readConfig();
  const configProducts = config?.products ?? [];
  const maxVisible = Number(config?.settings?.maxVisible) || 3;
  const currencyCode = config?.currencyCode ?? "USD";
  const productSource = config?.settings?.productSource ?? "manual";

  // Accessing .value subscribes this component to cart + attribute changes.
  const lines = shopify.lines.value ?? [];
  const lineByVariant = new Map();
  lines.forEach((l) => lineByVariant.set(l.merchandise.id, l));
  const upsellMap = readUpsellMap();

  // Seed product ids from the cart, for AI recommendations.
  const seedIds = [
    ...new Set(
      lines.map((l) => l.merchandise?.product?.id).filter(Boolean),
    ),
  ];

  // --- hooks (must run unconditionally, before any early return) ---
  const [aiRecs, setAiRecs] = useState([]);
  useEffect(() => {
    if (productSource === "manual" || seedIds.length === 0) {
      setAiRecs([]);
      return;
    }
    let cancelled = false;
    fetchRecommendations(seedIds).then((recs) => {
      if (!cancelled) setAiRecs(recs);
    });
    return () => {
      cancelled = true;
    };
  }, [productSource, seedIds.join(",")]);

  // A/B holdout: assign this checkout to control/treatment once.
  const holdout = Number(config?.settings?.holdoutPercent) || 0;
  const group = readGroup();
  useEffect(() => {
    if (holdout <= 0 || group) return;
    writeGroup(Math.random() * 100 < holdout ? "control" : "treatment");
  }, [holdout, group]);

  if (!config) return null;

  // Holdout: hide everything for the control group (and until assigned, so the
  // control group never briefly sees an offer).
  if (holdout > 0 && group !== "treatment") return null;

  // Audience targeting (no PII read — presence only).
  const audience = config.settings?.audience ?? "all";
  if (audience !== "all") {
    const loggedIn = buyerLoggedIn();
    if (audience === "loggedIn" && !loggedIn) return null;
    if (audience === "guests" && loggedIn) return null;
  }

  // Cart subtotal (reading .value subscribes us to total changes). Used by the
  // subtotal gate, the spending-goal bar, and the free-gift threshold.
  const cost =
    shopify.cost?.subtotalAmount?.value ?? shopify.cost?.totalAmount?.value;
  const subtotal = Number(cost?.amount);
  const hasSubtotal = Number.isFinite(subtotal);

  const minSubtotal = Number(config.settings?.minCartSubtotal) || 0;
  if (minSubtotal > 0 && hasSubtotal && subtotal < minSubtotal) return null;

  const settings = config.settings ?? {};

  // A product is eligible if it has an in-stock variant the buyer doesn't
  // already have in the cart (lines we added ourselves don't count).
  const eligible = (cp) => {
    const available = (cp.variants ?? []).filter(inStock);
    if (available.length === 0) return null;
    const preExisting = available.some((v) => {
      const line = lineByVariant.get(v.id);
      return line && !(v.id in upsellMap);
    });
    return preExisting ? null : available;
  };

  const visible = [];
  const shown = new Set();

  // Manual products first (skipped in AI-only mode).
  if (productSource !== "ai") {
    for (const cp of configProducts) {
      if (visible.length >= maxVisible) break;
      const available = eligible(cp);
      if (!available) continue;
      visible.push({ config: cp, available });
      shown.add(cp.productId);
    }
  }

  // Fill remaining slots with Shopify AI recommendations (supplement / AI-only).
  if (productSource !== "manual") {
    const discountByProductId = {};
    for (const cp of configProducts) {
      if (cp.discountType && cp.discountValue) {
        discountByProductId[cp.productId] = {
          discountType: cp.discountType,
          discountValue: cp.discountValue,
        };
      }
    }
    for (const raw of aiRecs) {
      if (visible.length >= maxVisible) break;
      if (shown.has(raw.id)) continue;
      const cp = mapRecommendation(raw, discountByProductId);
      const available = eligible(cp);
      if (!available) continue;
      visible.push({ config: cp, available });
      shown.add(raw.id);
    }
  }

  // Free gift: a normal offer card rendered at 100% off, shown once the cart
  // subtotal reaches the threshold. The 100%-off discount is applied by the
  // discount function (the gift variant is in the discount-node metafield).
  const gift = config.gift;
  let giftItem = null;
  if (
    gift &&
    gift.variantId &&
    gift.threshold > 0 &&
    hasSubtotal &&
    subtotal >= gift.threshold
  ) {
    const giftProduct = {
      productId: gift.productId ?? gift.variantId,
      title: gift.title ?? "Free gift",
      image: gift.image ?? null,
      discountType: "percentage",
      discountValue: 100,
      isGift: true,
      variants: [
        {
          id: gift.variantId,
          title: gift.title ?? "Free gift",
          price: gift.price,
          availableForSale: gift.availableForSale ?? true,
          quantityAvailable: null,
        },
      ],
    };
    const giftAvailable = eligible(giftProduct);
    if (giftAvailable) giftItem = { config: giftProduct, available: giftAvailable };
  }

  // Spending-goal progress bar.
  const spendGoal = Number(settings.spendGoal) || 0;
  const showGoal = spendGoal > 0 && hasSubtotal;

  if (visible.length === 0 && !giftItem && !showGoal) return null;

  const lowStockThreshold = Number(settings.lowStockThreshold) || 0;

  // "Add all": add the first available variant of each offer not already in
  // the cart (sequentially, since each change updates the cart).
  const addableAll = visible
    .map((item) => item.available[0])
    .filter((v) => v && !lineByVariant.has(v.id));
  async function addAll() {
    for (const item of visible) {
      const v = item.available[0];
      if (!v || lineByVariant.has(v.id)) continue;
      await shopify.applyCartLinesChange({
        type: "addCartLine",
        merchandiseId: v.id,
        quantity: 1,
      });
      await markUpsell(v.id, item.config.title);
    }
  }

  return (
    <s-stack gap="base">
      {settings.blockTitle && <s-heading>{settings.blockTitle}</s-heading>}

      {showGoal && (
        <SpendGoalBar
          subtotal={subtotal}
          goal={spendGoal}
          currencyCode={currencyCode}
          text={settings.spendGoalText}
          doneText={settings.spendGoalDoneText}
        />
      )}

      {visible.map((item) => (
        <ProductOffer
          key={item.config.productId}
          product={item.config}
          available={item.available}
          settings={settings}
          currencyCode={currencyCode}
          lineByVariant={lineByVariant}
          lowStockThreshold={lowStockThreshold}
        />
      ))}

      {giftItem && (
        <ProductOffer
          key="upsell-gift"
          product={giftItem.config}
          available={giftItem.available}
          settings={settings}
          currencyCode={currencyCode}
          lineByVariant={lineByVariant}
          lowStockThreshold={lowStockThreshold}
        />
      )}

      {addableAll.length > 1 && (
        <s-button variant="primary" onClick={addAll}>
          {t("addAll")}
        </s-button>
      )}
    </s-stack>
  );
}

// ---------- spending-goal progress bar ----------

function SpendGoalBar({ subtotal, goal, currencyCode, text, doneText }) {
  const reached = subtotal >= goal;
  const pct = Math.max(0, Math.min(100, (subtotal / goal) * 100));
  const remaining = Math.max(0, goal - subtotal);
  const label = reached
    ? doneText || ""
    : (text || "").replace("{amount}", money(remaining, currencyCode));
  return (
    <s-stack gap="small-200">
      {label && <s-text>{label}</s-text>}
      <div
        style={{
          height: 8,
          borderRadius: 4,
          background: "rgba(0,0,0,0.10)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: "var(--s-color-text, #1a1a1a)",
            opacity: 0.7,
            transition: "width 200ms ease",
          }}
        />
      </div>
    </s-stack>
  );
}

// ---------- single offer card ----------

function ProductOffer({
  product,
  available,
  settings,
  currencyCode,
  lineByVariant,
  lowStockThreshold = 0,
}) {
  const [selectedId, setSelectedId] = useState(available[0].id);
  const [addQty, setAddQty] = useState(1);
  const variant = available.find((v) => v.id === selectedId) ?? available[0];

  const line = lineByVariant.get(variant.id);
  const qty = line?.quantity ?? 0;

  const isGift = Boolean(product.isGift);
  const image = variant.image ?? product.image ?? null;
  const base = variant.price;
  const discounted = base != null ? discountedAmount(base, product) : null;
  const badge = isGift ? t("freeGift") : discountBadge(product, currencyCode);
  const hasOptions = available.length > 1;

  // Low-stock urgency: show when inventory is tracked and at/under threshold.
  const lowStock =
    lowStockThreshold > 0 &&
    variant.quantityAvailable != null &&
    variant.quantityAvailable > 0 &&
    variant.quantityAvailable <= lowStockThreshold;

  async function add() {
    await shopify.applyCartLinesChange({
      type: "addCartLine",
      merchandiseId: variant.id,
      quantity: addQty,
    });
    await markUpsell(variant.id, product.title);
  }

  async function setQty(next) {
    if (!line) return;
    if (next <= 0) {
      await shopify.applyCartLinesChange({
        type: "removeCartLine",
        id: line.id,
        quantity: line.quantity,
      });
      await unmarkUpsell(variant.id);
    } else {
      await shopify.applyCartLinesChange({
        type: "updateCartLine",
        id: line.id,
        quantity: next,
      });
    }
  }

  return (
    <s-box
      padding="base"
      border="base"
      borderRadius="large"
      background="subdued"
    >
      <s-stack direction="inline" gap="base" alignItems="center">
        {settings.showImage && image && (
          <s-box inlineSize="80px">
            <s-image
              src={image}
              alt={product.title}
              inlineSize="fill"
              aspectRatio="1"
              borderRadius="base"
            />
          </s-box>
        )}

        <s-stack gap="small-200">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-text type="strong">{product.title}</s-text>
            {badge && <s-badge tone="success">{badge}</s-badge>}
            {lowStock && (
              <s-badge tone="warning">
                {t("onlyNLeft", { count: variant.quantityAvailable })}
              </s-badge>
            )}
            {!isGift &&
              product.volumeMinQty >= 2 &&
              product.volumeValue > 0 && (
                <s-badge tone="info">
                  {t("volumeSave", { count: product.volumeMinQty })}{" "}
                  {product.discountType === "percentage"
                    ? `${product.volumeValue}%`
                    : money(product.volumeValue, currencyCode)}
                </s-badge>
              )}
          </s-stack>

          {settings.showPrice && base != null && (
            <s-stack direction="inline" gap="small-200" alignItems="center">
              {isGift ? (
                <>
                  <s-text type="strong">{t("free")}</s-text>
                  <s-text color="subdued">
                    {t("was", { price: money(base, currencyCode) })}
                  </s-text>
                </>
              ) : discounted != null ? (
                <>
                  <s-text type="strong">
                    {money(discounted, currencyCode)}
                  </s-text>
                  <s-text color="subdued">
                    {t("was", { price: money(base, currencyCode) })}
                  </s-text>
                </>
              ) : (
                <s-text type="strong">{money(base, currencyCode)}</s-text>
              )}
            </s-stack>
          )}

          {hasOptions && (
            <s-select
              label={t("option")}
              labelAccessibilityVisibility="exclusive"
              value={selectedId}
              onChange={(e) => setSelectedId(e.currentTarget.value)}
            >
              {available.map((v) => (
                <s-option key={v.id} value={v.id}>
                  {v.title}
                </s-option>
              ))}
            </s-select>
          )}
        </s-stack>

        {qty === 0 ? (
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-button
              variant="secondary"
              accessibilityLabel={t("decreaseQuantity")}
              onClick={() => setAddQty((q) => Math.max(1, q - 1))}
              {...(addQty <= 1 ? { disabled: true } : {})}
            >
              −
            </s-button>
            <s-text type="strong">{addQty}</s-text>
            <s-button
              variant="secondary"
              accessibilityLabel={t("increaseQuantity")}
              onClick={() => setAddQty((q) => q + 1)}
            >
              +
            </s-button>
            <s-button onClick={add}>
              {settings.buttonLabel || t("addToOrder")}
            </s-button>
          </s-stack>
        ) : (
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-button
              variant="secondary"
              accessibilityLabel={t("decreaseQuantity")}
              onClick={() => setQty(qty - 1)}
            >
              −
            </s-button>
            <s-text type="strong">{qty}</s-text>
            <s-button
              variant="secondary"
              accessibilityLabel={t("increaseQuantity")}
              onClick={() => setQty(qty + 1)}
            >
              +
            </s-button>
            <s-button
              variant="secondary"
              tone="critical"
              accessibilityLabel={t("remove")}
              onClick={() => setQty(0)}
            >
              {t("remove")}
            </s-button>
          </s-stack>
        )}
      </s-stack>
    </s-box>
  );
}
