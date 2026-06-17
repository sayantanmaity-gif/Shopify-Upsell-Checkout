import { describe, it, expect } from "vitest";
import {
  parseUpsellMap,
  matchUpsellLines,
  type NormalizedOrder,
  type NormalizedLine,
} from "./upsell-match";

const V1 = "gid://shopify/ProductVariant/111";
const V2 = "gid://shopify/ProductVariant/222";

const line = (variantId: string | null, title: string): NormalizedLine => ({
  variantId,
  title,
  variantTitle: null,
  quantity: 1,
  netUnitPrice: 10,
});

function order(partial: Partial<NormalizedOrder>): NormalizedOrder {
  return {
    orderId: "gid://shopify/Order/1",
    orderName: "#1",
    currencyCode: "USD",
    customerName: null,
    createdAt: null,
    orderTotal: 0,
    upsellMapRaw: null,
    tags: [],
    lines: [],
    ...partial,
  };
}

describe("parseUpsellMap", () => {
  it("returns {} for null, empty, or malformed input", () => {
    expect(parseUpsellMap(null)).toEqual({});
    expect(parseUpsellMap("")).toEqual({});
    expect(parseUpsellMap("not json")).toEqual({});
  });

  it("parses a valid variant->title map", () => {
    expect(parseUpsellMap(JSON.stringify({ [V1]: "Ski Wax" }))).toEqual({
      [V1]: "Ski Wax",
    });
  });
});

describe("matchUpsellLines", () => {
  it("matches only lines whose variant id is in the map", () => {
    const o = order({
      upsellMapRaw: JSON.stringify({ [V1]: "A" }),
      lines: [line(V1, "A"), line(V2, "B")],
    });
    const matched = matchUpsellLines(o);
    expect(matched).toHaveLength(1);
    expect(matched[0].variantId).toBe(V1);
  });

  it("does NOT match a different product that shares a title (the variant-id fix)", () => {
    // Both lines have the same title, but only V2 was the actual upsell.
    const o = order({
      upsellMapRaw: JSON.stringify({ [V2]: "Ski Wax" }),
      lines: [line(V1, "Ski Wax"), line(V2, "Ski Wax")],
    });
    const matched = matchUpsellLines(o);
    expect(matched).toHaveLength(1);
    expect(matched[0].variantId).toBe(V2);
  });

  it("returns [] when there is no upsell map", () => {
    const o = order({ lines: [line(V1, "A")] });
    expect(matchUpsellLines(o)).toEqual([]);
  });

  it("ignores lines with a null variant id", () => {
    const o = order({
      upsellMapRaw: JSON.stringify({ [V1]: "A" }),
      lines: [line(null, "A")],
    });
    expect(matchUpsellLines(o)).toEqual([]);
  });
});
