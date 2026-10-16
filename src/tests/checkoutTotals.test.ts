import { describe, expect, test } from "bun:test";
import { defaultFulfillment } from "@/components/marketplace/FulfillmentEditor";
import { formatPrice, parsePriceToCents } from "@/lib/format";
import { computeCheckoutTotals } from "@/lib/orderTotals";

const line = (
  quantity: number,
  effectivePriceCents: number,
  live: unknown = { id: "p1" },
) => ({ live, quantity, effectivePriceCents });

describe("computeCheckoutTotals", () => {
  test("sums only live rows with a positive quantity", () => {
    const totals = computeCheckoutTotals({
      lines: [line(2, 1_000), line(1, 500, null), line(0, 2_500)],
      groups: [],
      choices: {},
    });
    expect(totals).toEqual({
      itemsSubtotalCents: 2_000,
      shippingFeeCents: 0,
      totalCents: 2_000,
    });
  });

  test("charges one fee per seller group — never per item", () => {
    const totals = computeCheckoutTotals({
      lines: [line(3, 1_000)],
      groups: [
        {
          sellerId: "s1",
          methods: [
            { method: "meetup", feeCents: 0 },
            { method: "shipping", feeCents: 799 },
          ],
        },
      ],
      choices: { s1: "shipping" },
    });
    expect(totals.shippingFeeCents).toBe(799); // once, not 3×
    expect(totals.totalCents).toBe(3_799);
  });

  test("accumulates fees across multiple sellers", () => {
    const totals = computeCheckoutTotals({
      lines: [line(1, 5_000)],
      groups: [
        {
          sellerId: "a",
          methods: [{ method: "delivery", feeCents: 499 }],
        },
        {
          sellerId: "b",
          methods: [{ method: "shipping", feeCents: 1_200 }],
        },
      ],
      choices: { a: "delivery", b: "shipping" },
    });
    expect(totals.shippingFeeCents).toBe(1_699);
    expect(totals.totalCents).toBe(6_699);
  });

  test("pickup/meetup is free and unknown choices add no fee", () => {
    const group = {
      sellerId: "s1",
      methods: [
        { method: "meetup", feeCents: 0 },
        { method: "shipping", feeCents: 799 },
      ],
    };
    expect(
      computeCheckoutTotals({
        lines: [line(1, 1_000)],
        groups: [group],
        choices: { s1: "meetup" },
      }).shippingFeeCents,
    ).toBe(0);
    expect(
      computeCheckoutTotals({
        lines: [line(1, 1_000)],
        groups: [group],
        choices: {},
      }).shippingFeeCents,
    ).toBe(0);
  });

  test("empty cart totals zero", () => {
    expect(computeCheckoutTotals({ lines: [], groups: [], choices: {} })).toEqual(
      { itemsSubtotalCents: 0, shippingFeeCents: 0, totalCents: 0 },
    );
  });
});

describe("defaultFulfillment", () => {
  test("pickup and shipping enabled by default, delivery off", () => {
    expect(defaultFulfillment.pickup.enabled).toBe(true);
    expect(defaultFulfillment.shipping.enabled).toBe(true);
    expect(defaultFulfillment.shipping.feeCents).toBe(0);
    expect(defaultFulfillment.delivery.enabled).toBe(false);
    expect(defaultFulfillment.delivery.contactRequired).toBe(true);
  });
});

describe("price formatting", () => {
  test("parses seller/admin price inputs to cents", () => {
    expect(parsePriceToCents("29")).toBe(2_900);
    expect(parsePriceToCents("$1,299.00")).toBe(129_900);
    expect(parsePriceToCents("199.99")).toBe(19_999);
    expect(parsePriceToCents("0.05")).toBe(5);
  });

  test("rejects non-numeric input", () => {
    expect(parsePriceToCents("")).toBeNull();
    expect(parsePriceToCents("abc")).toBeNull();
  });

  test("formats cents as USD", () => {
    expect(formatPrice(2_900)).toBe("$29.00");
    expect(formatPrice(0)).toBe("$0.00");
    expect(formatPrice(129_900)).toBe("$1,299.00");
  });
});
