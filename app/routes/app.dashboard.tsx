import { useEffect, useRef, useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import { authenticate } from "../shopify.server";
import {
  getAbTestResults,
  getDailyUpsellRevenue,
  getOrderCount,
  getTopUpsellProducts,
  getUpsellAov,
  getUpsellMetrics,
  getUpsellOrders,
  syncUpsellOrders,
} from "../models/analytics.server";

const PAGE_SIZE = 20;

const RANGES: Record<string, number | null> = {
  "7": 7,
  "30": 30,
  "90": 90,
  all: null,
};

function sinceFor(range: string): Date | null {
  const days = RANGES[range];
  if (days == null) return null;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const range = RANGES[url.searchParams.get("range") ?? ""] !== undefined
    ? (url.searchParams.get("range") as string)
    : "30";
  const skip = Number(url.searchParams.get("skip")) || 0;
  const since = sinceFor(range);

  // Only sync + count + tag on the first page load, not on each "load more"
  // (the scan hits the Admin API and is expensive). Webhooks keep data fresh;
  // this is a backfill.
  let syncError: string | null = null;
  if (skip === 0) {
    try {
      const debug = await syncUpsellOrders(admin, session.shop);
      if (debug.errors?.length) syncError = debug.errors.join(" | ").slice(0, 400);
    } catch (e: any) {
      syncError = String(e?.message ?? e);
      console.error("syncUpsellOrders failed", e);
    }
  }

  const [metrics, page, orderCount, topProducts, aov, dailyRevenue, abTest] =
    await Promise.all([
      getUpsellMetrics(session.shop, since),
      getUpsellOrders(session.shop, { skip, take: PAGE_SIZE, since }),
      skip === 0 ? getOrderCount(admin, since) : Promise.resolve(null),
      skip === 0
        ? getTopUpsellProducts(session.shop, since)
        : Promise.resolve([]),
      skip === 0 ? getUpsellAov(session.shop, since) : Promise.resolve(null),
      skip === 0
        ? getDailyUpsellRevenue(session.shop, since)
        : Promise.resolve([]),
      skip === 0 ? getAbTestResults(session.shop, since) : Promise.resolve(null),
    ]);
  const storeHandle = session.shop.replace(/\.myshopify\.com$/, "");
  return {
    metrics,
    orders: page.orders,
    hasMore: page.hasMore,
    storeHandle,
    range,
    orderCount,
    topProducts,
    aov,
    dailyRevenue,
    abTest,
    syncError,
  };
};

type LoaderData = Awaited<ReturnType<typeof loader>>;
type Order = LoaderData["orders"][number];

function orderUrl(storeHandle: string, orderId: string) {
  const numericId = orderId.split("/").pop();
  return `https://admin.shopify.com/store/${storeHandle}/orders/${numericId}`;
}

function taggedOrdersUrl(storeHandle: string) {
  const query = encodeURIComponent(`tag:'Added Upsell Product'`);
  return `https://admin.shopify.com/store/${storeHandle}/orders?query=${query}`;
}

function money(amount: number, currencyCode: string | null) {
  const n = Number(amount) || 0;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currencyCode || "USD",
    }).format(n);
  } catch {
    return `${currencyCode ?? ""} ${n.toFixed(2)}`.trim();
  }
}

function orderDate(o: Order) {
  const d = o.orderedAt ?? o.createdAt;
  return d ? new Date(d).toLocaleDateString() : "—";
}

function itemsLabel(
  items: { title: string; variantTitle: string | null; quantity: number }[],
) {
  return items
    .map((i) => {
      const v =
        i.variantTitle && i.variantTitle !== "Default Title"
          ? ` (${i.variantTitle})`
          : "";
      return `${i.title}${v} ×${i.quantity}`;
    })
    .join(", ");
}

function csvCell(v: string) {
  return `"${String(v).replace(/"/g, '""')}"`;
}

function downloadCsv(orders: Order[]) {
  const header = [
    "Order",
    "Customer",
    "Upsell products",
    "Upsell value",
    "Currency",
    "Date",
  ];
  const rows = orders.map((o) => [
    o.orderName,
    o.customerName ?? "",
    itemsLabel(o.items),
    o.upsellTotal.toFixed(2),
    o.currencyCode ?? "",
    orderDate(o),
  ]);
  const csv = [header, ...rows]
    .map((r) => r.map(csvCell).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "upsell-orders.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function Dashboard() {
  const initial = useLoaderData<typeof loader>();
  const {
    metrics,
    storeHandle,
    orderCount,
    syncError,
    range,
    topProducts,
    aov,
    dailyRevenue,
    abTest,
  } = initial;
  const [, setSearchParams] = useSearchParams();

  const [orders, setOrders] = useState<Order[]>(initial.orders);
  const [hasMore, setHasMore] = useState(initial.hasMore);
  const fetcher = useFetcher<LoaderData>();
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Reset the list whenever the route loader re-runs (range change, fresh sync).
  useEffect(() => {
    setOrders(initial.orders);
    setHasMore(initial.hasMore);
  }, [initial.orders, initial.hasMore]);

  // Append each fetched page, de-duping by id.
  useEffect(() => {
    if (!fetcher.data?.orders) return;
    setOrders((prev) => {
      const seen = new Set(prev.map((o) => o.id));
      return [...prev, ...fetcher.data!.orders.filter((o) => !seen.has(o.id))];
    });
    setHasMore(fetcher.data.hasMore);
  }, [fetcher.data]);

  // Fetch the next page (used by both the button and the scroll sentinel).
  const loadMore = () => {
    if (!hasMore || fetcher.state !== "idle") return;
    fetcher.load(`?skip=${orders.length}&range=${range}`);
  };

  // Auto-load when the sentinel scrolls into view (best-effort; in the embedded
  // admin the iframe is content-sized and may never scroll, so the button above
  // is the reliable path).
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) loadMore();
    });
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, orders.length, fetcher.state, range]);

  const currency = orders[0]?.currencyCode ?? null;
  const attachRate =
    orderCount && orderCount > 0
      ? `${((metrics.orders / orderCount) * 100).toFixed(1)}%`
      : "—";

  return (
    <s-page heading="Dashboard">
      {syncError && (
        <s-banner tone="critical" heading="Couldn't sync some orders">
          {syncError}
        </s-banner>
      )}

      <s-section heading="Upsell performance">
        <s-stack direction="block" gap="large">
        <s-stack direction="inline" gap="base" alignItems="end">
          <s-select
            label="Date range"
            value={range}
            onChange={(e: any) =>
              setSearchParams((p) => {
                p.set("range", e.currentTarget.value);
                p.delete("skip");
                return p;
              })
            }
          >
            <s-option value="7">Last 7 days</s-option>
            <s-option value="30">Last 30 days</s-option>
            <s-option value="90">Last 90 days</s-option>
            <s-option value="all">All time</s-option>
          </s-select>
        </s-stack>

        <s-stack direction="inline" gap="large">
          <Stat label="Orders with upsells" value={String(metrics.orders)} />
          <Stat label="Attach rate" value={attachRate} />
          <Stat
            label="Upsell revenue (net)"
            value={money(metrics.revenue, currency)}
          />
          <Stat label="Upsell units sold" value={String(metrics.units)} />
          <Stat
            label="Avg upsell order value"
            value={aov != null ? money(aov, currency) : "—"}
          />
        </s-stack>

        <RevenueSparkline data={dailyRevenue} currency={currency} />
        <s-paragraph>
          Only orders that included a product added from the checkout upsell
          block are counted here. These orders are tagged{" "}
          <s-link href={taggedOrdersUrl(storeHandle)} target="_blank">
            Added Upsell Product
          </s-link>{" "}
          in your admin. Attach rate = upsell orders ÷ total orders in range.
        </s-paragraph>
        </s-stack>
      </s-section>

      {abTest && (
        <s-section heading="A/B holdout — incremental lift">
          <s-stack direction="block" gap="base">
            <s-table>
              <s-table-header-row>
                <s-table-header>Group</s-table-header>
                <s-table-header>Orders</s-table-header>
                <s-table-header>Attach rate</s-table-header>
                <s-table-header>Avg order value</s-table-header>
              </s-table-header-row>
              <s-table-body>
                <s-table-row>
                  <s-table-cell>Treatment (sees upsells)</s-table-cell>
                  <s-table-cell>{String(abTest.treatment.orders)}</s-table-cell>
                  <s-table-cell>
                    {(abTest.treatment.attachRate * 100).toFixed(1)}%
                  </s-table-cell>
                  <s-table-cell>
                    {money(abTest.treatment.aov, currency)}
                  </s-table-cell>
                </s-table-row>
                <s-table-row>
                  <s-table-cell>Control (no upsells)</s-table-cell>
                  <s-table-cell>{String(abTest.control.orders)}</s-table-cell>
                  <s-table-cell>—</s-table-cell>
                  <s-table-cell>
                    {money(abTest.control.aov, currency)}
                  </s-table-cell>
                </s-table-row>
              </s-table-body>
            </s-table>
            <s-paragraph>
              {abTest.aovLift != null ? (
                <>
                  AOV lift from upsells:{" "}
                  <s-badge tone={abTest.aovLift >= 0 ? "success" : "critical"}>
                    {abTest.aovLift >= 0 ? "+" : ""}
                    {(abTest.aovLift * 100).toFixed(1)}%
                  </s-badge>{" "}
                  vs. the control group.
                </>
              ) : (
                "Collecting data — lift appears once both groups have orders."
              )}
            </s-paragraph>
          </s-stack>
        </s-section>
      )}

      {topProducts.length > 0 && (
        <s-section heading="Top upsell products">
          <s-table>
            <s-table-header-row>
              <s-table-header>Product</s-table-header>
              <s-table-header>Orders</s-table-header>
              <s-table-header>Units</s-table-header>
              <s-table-header>Revenue</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {topProducts.map((p, i) => (
                <s-table-row key={`${p.title}-${p.variantTitle ?? ""}-${i}`}>
                  <s-table-cell>
                    {p.title}
                    {p.variantTitle && p.variantTitle !== "Default Title"
                      ? ` (${p.variantTitle})`
                      : ""}
                  </s-table-cell>
                  <s-table-cell>{String(p.orders)}</s-table-cell>
                  <s-table-cell>{String(p.units)}</s-table-cell>
                  <s-table-cell>{money(p.revenue, currency)}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      )}

      <s-section heading="Orders with upsell products">
        <s-stack direction="block" gap="base">
        {orders.length === 0 ? (
          <s-paragraph>
            No upsell orders in this range. When a buyer adds a product from the
            checkout block and completes the order, it will appear here.
          </s-paragraph>
        ) : (
          <>
            <s-stack direction="inline" gap="base">
              <s-button
                variant="secondary"
                onClick={() => downloadCsv(orders)}
              >
                Export CSV ({orders.length})
              </s-button>
            </s-stack>
            <s-table>
              <s-table-header-row>
                <s-table-header>Order</s-table-header>
                <s-table-header>Customer</s-table-header>
                <s-table-header>Upsell products</s-table-header>
                <s-table-header>Upsell value</s-table-header>
                <s-table-header>Date</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {orders.map((o) => (
                  <s-table-row key={o.id}>
                    <s-table-cell>
                      <s-link
                        href={orderUrl(storeHandle, o.orderId)}
                        target="_blank"
                      >
                        {o.orderName}
                      </s-link>
                    </s-table-cell>
                    <s-table-cell>{o.customerName ?? "—"}</s-table-cell>
                    <s-table-cell>{itemsLabel(o.items)}</s-table-cell>
                    <s-table-cell>
                      {money(o.upsellTotal, o.currencyCode)}
                    </s-table-cell>
                    <s-table-cell>{orderDate(o)}</s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </>
        )}

        {/* Explicit "Load more" button (reliable in the embedded admin iframe,
            where the auto-load sentinel below may never scroll into view) plus
            an IntersectionObserver sentinel for auto-load when scrolling works. */}
        {hasMore && (
          <s-stack
            direction="block"
            gap="small-200"
            alignItems="center"
          >
            <s-button
              variant="secondary"
              onClick={loadMore}
              {...(fetcher.state !== "idle" ? { loading: true } : {})}
            >
              {fetcher.state !== "idle" ? "Loading…" : "Load more orders"}
            </s-button>
            <div ref={sentinelRef} style={{ height: 1, width: "100%" }} />
          </s-stack>
        )}
        </s-stack>
      </s-section>
    </s-page>
  );
}

function RevenueSparkline({
  data,
  currency,
}: {
  data: { day: string; revenue: number }[];
  currency: string | null;
}) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data.map((d) => d.revenue), 1);
  return (
    <s-stack direction="block" gap="small-200">
      <s-text color="subdued">Daily upsell revenue</s-text>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 3,
          height: 48,
        }}
      >
        {data.map((d) => (
          <div
            key={d.day}
            title={`${d.day}: ${money(d.revenue, currency)}`}
            style={{
              flex: 1,
              minWidth: 2,
              height: `${Math.max(2, (d.revenue / max) * 100)}%`,
              background: "var(--s-color-text, #1a1a1a)",
              opacity: 0.65,
              borderRadius: 2,
            }}
          />
        ))}
      </div>
    </s-stack>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <s-box padding="base" borderWidth="base" borderRadius="base">
      <s-stack direction="block" gap="none">
        <s-text color="subdued">{label}</s-text>
        <s-heading>{value}</s-heading>
      </s-stack>
    </s-box>
  );
}
