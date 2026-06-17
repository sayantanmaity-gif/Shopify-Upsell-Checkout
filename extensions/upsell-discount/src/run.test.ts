import { describe, it, expect } from "vitest";
import { run, resolveDiscount } from "./run";

const V1 = "gid://shopify/ProductVariant/111";
const V2 = "gid://shopify/ProductVariant/222";

function input(opts: {
  attr?: string | null;
  config?: string | null;
  variantIds: (string | null)[];
  quantities?: number[];
}): any {
  return {
    cart: {
      attribute: opts.attr ? { value: opts.attr } : null,
      lines: opts.variantIds.map((variantId, i) => ({
        id: `gid://shopify/CartLine/${i}`,
        quantity: opts.quantities?.[i] ?? 1,
        merchandise: variantId
          ? { __typename: "ProductVariant", id: variantId }
          : { __typename: "CustomProduct" },
      })),
    },
    discountNode: { metafield: opts.config ? { value: opts.config } : null },
  };
}

describe("upsell-discount run()", () => {
  it("does nothing when no upsell attribute is present", () => {
    const r = run(input({ attr: null, config: null, variantIds: [V1] }));
    expect(r.discounts).toHaveLength(0);
  });

  it("discounts only the marked upsell line", () => {
    const r = run(
      input({
        attr: JSON.stringify({ [V1]: "Ski Wax" }),
        config: JSON.stringify({ [V1]: "percentage:15" }),
        variantIds: [V1, V2],
      }),
    );
    expect(r.discounts).toHaveLength(1);
    expect(r.discounts[0].targets[0]).toEqual({
      cartLine: { id: "gid://shopify/CartLine/0" },
    });
    expect(r.discounts[0].value).toEqual({ percentage: { value: 15 } });
  });

  it("does NOT discount a configured product the buyer added themselves (not marked)", () => {
    // V1 has a discount configured, but only V2 is marked as an upsell.
    const r = run(
      input({
        attr: JSON.stringify({ [V2]: "Other" }),
        config: JSON.stringify({ [V1]: "percentage:15" }),
        variantIds: [V1],
      }),
    );
    expect(r.discounts).toHaveLength(0);
  });

  it("applies fixed amounts and caps percentages at 100", () => {
    const r = run(
      input({
        attr: JSON.stringify({ [V1]: "A", [V2]: "B" }),
        config: JSON.stringify({ [V1]: "fixed:5", [V2]: "percentage:150" }),
        variantIds: [V1, V2],
      }),
    );
    expect(r.discounts).toHaveLength(2);
    expect(r.discounts[0].value).toEqual({ fixedAmount: { amount: 5 } });
    expect(r.discounts[1].value).toEqual({ percentage: { value: 100 } });
  });

  it("ignores marked lines with no/zero discount config", () => {
    const r = run(
      input({
        attr: JSON.stringify({ [V1]: "A" }),
        config: JSON.stringify({ [V1]: "percentage:0" }),
        variantIds: [V1],
      }),
    );
    expect(r.discounts).toHaveLength(0);
  });

  it("applies the base discount below the volume threshold", () => {
    const r = run(
      input({
        attr: JSON.stringify({ [V1]: "A" }),
        config: JSON.stringify({ [V1]: "percentage:10;3:25" }),
        variantIds: [V1],
        quantities: [2],
      }),
    );
    expect(r.discounts[0].value).toEqual({ percentage: { value: 10 } });
  });

  it("applies the volume tier at or above the threshold quantity", () => {
    const r = run(
      input({
        attr: JSON.stringify({ [V1]: "A" }),
        config: JSON.stringify({ [V1]: "percentage:10;3:25" }),
        variantIds: [V1],
        quantities: [3],
      }),
    );
    expect(r.discounts[0].value).toEqual({ percentage: { value: 25 } });
  });
});

describe("resolveDiscount", () => {
  it("returns the base value with no tier", () => {
    expect(resolveDiscount("percentage:15", 5)).toEqual({
      type: "percentage",
      value: 15,
    });
  });
  it("keeps base below the tier min qty", () => {
    expect(resolveDiscount("fixed:5;3:10", 2)).toEqual({
      type: "fixed",
      value: 5,
    });
  });
  it("upgrades to the tier at the min qty", () => {
    expect(resolveDiscount("fixed:5;3:10", 3)).toEqual({
      type: "fixed",
      value: 10,
    });
  });
  it("rejects an unknown type or non-positive base", () => {
    expect(resolveDiscount("bogus:5", 1)).toBeNull();
    expect(resolveDiscount("percentage:0", 1)).toBeNull();
  });
});
