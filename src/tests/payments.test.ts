import { describe, expect, test } from "bun:test";
import type { Id } from "@/convex/_generated/dataModel";
import * as admin from "@/convex/admin";
import * as commissions from "@/convex/commissions";
import * as orders from "@/convex/orders";
import * as payments from "@/convex/payments";
import * as products from "@/convex/products";
import schema from "@/convex/schema";
import * as subscriptions from "@/convex/subscriptions";
import { defineTestApp } from "convex-test";

/**
 * Payment and payout ledger tests. Everything runs against the real Convex
 * functions with an in-memory database: no Stripe calls, no real money, and no
 * seeded balances. Cash-on-delivery is the only payment path that can be
 * recorded, and a payout only counts as paid when Stripe confirmed it.
 */

const app = defineTestApp({ schema });
const { api, createTest } = app.defineModules({
  admin,
  commissions,
  orders,
  payments,
  products,
  subscriptions,
});
type TestT = ReturnType<typeof createTest>;

const as = (t: TestT, userId: Id<"users">) =>
  t.withIdentity({ subject: `${userId}|test-session` });

async function newUser(
  t: TestT,
  options: { role?: "admin" | "user"; seller?: boolean } = {},
) {
  return await t.run((ctx) =>
    ctx.db.insert("users", {
      email: `${crypto.randomUUID()}@example.com`,
      role: options.role ?? "user",
      isSeller: options.seller ?? false,
      sellerType: options.seller ? ("individual" as const) : undefined,
      emailVerificationTime: Date.now(),
    }),
  );
}

const fulfillment = {
  pickup: { enabled: true, area: "Central City" },
  shipping: { enabled: true, feeCents: 500, handlingDays: 2 },
  delivery: { enabled: false, feeCents: 0, contactRequired: true },
};

async function insertProduct(
  t: TestT,
  sellerId: Id<"users">,
  overrides: { title?: string; priceCents?: number } = {},
) {
  return await t.run((ctx) =>
    ctx.db.insert("products", {
      sellerId,
      title: overrides.title ?? "Hand-thrown mug",
      description: "A stoneware mug with a matte glaze.",
      categoryId: "home",
      priceCents: overrides.priceCents ?? 10_000,
      quantity: 5,
      condition: "new" as const,
      imageStorageIds: [],
      returns: { accepted: false, days: 0 },
      fulfillment,
      status: "active" as const,
      views: 0,
      soldCount: 0,
    }),
  );
}

async function itemIds(t: TestT, orderId: Id<"orders">) {
  return await t.run((ctx) =>
    ctx.db
      .query("orderItems")
      .withIndex("by_order", (q) => q.eq("orderId", orderId))
      .collect(),
  );
}

/** Place a cash-on-delivery order and deliver the given seller's items. */
async function placeAndDeliver(
  t: TestT,
  sellerId: Id<"users">,
  buyerId: Id<"users">,
  productIds: Id<"products">[],
) {
  const orderId = await as(t, buyerId).mutation(api.orders.place, {
    items: productIds.map((productId) => ({ productId, quantity: 1 })),
    fulfillments: [{ sellerId, method: "shipping" }],
    paymentMethod: "cod",
  });
  await as(t, sellerId).mutation(api.orders.approveFulfillment, {
    orderId,
    sellerId,
  });
  const items = await itemIds(t, orderId);
  for (const item of items) {
    await as(t, sellerId).mutation(api.orders.updateItemStatus, {
      itemId: item._id,
      status: "shipped",
    });
    await as(t, sellerId).mutation(api.orders.updateItemStatus, {
      itemId: item._id,
      status: "delivered",
    });
  }
  return { orderId, items };
}

async function activateBusinessPlan(
  t: TestT,
  sellerId: Id<"users">,
  adminId: Id<"users">,
) {
  const subId = await as(t, sellerId).mutation(api.subscriptions.subscribe, {
    planId: "starter",
    agreedToTerms: true,
  });
  await as(t, adminId).mutation(api.subscriptions.adminActivate, {
    subscriptionId: subId,
  });
}

describe("cash-on-delivery payment recording", () => {
  test("only the seller can record cash, only after delivery, only once", async () => {
    const t = createTest();
    const seller = await newUser(t, { seller: true });
    const buyer = await newUser(t);
    const stranger = await newUser(t);
    const product = await insertProduct(t, seller);

    const orderId = await as(t, buyer).mutation(api.orders.place, {
      items: [{ productId: product, quantity: 1 }],
      fulfillments: [{ sellerId: seller, method: "shipping" }],
      paymentMethod: "cod",
    });
    await as(t, seller).mutation(api.orders.approveFulfillment, {
      orderId,
      sellerId: seller,
    });
    const [item] = await itemIds(t, orderId);

    // Not delivered yet.
    await expect(
      as(t, seller).mutation(api.payments.recordCodCollected, {
        itemId: item._id,
      }),
    ).rejects.toThrow("after delivery");

    await as(t, seller).mutation(api.orders.updateItemStatus, {
      itemId: item._id,
      status: "shipped",
    });
    await as(t, seller).mutation(api.orders.updateItemStatus, {
      itemId: item._id,
      status: "delivered",
    });

    // Buyer and unrelated accounts cannot confirm the payment.
    await expect(
      as(t, buyer).mutation(api.payments.recordCodCollected, {
        itemId: item._id,
      }),
    ).rejects.toThrow("Only the seller");
    await expect(
      as(t, stranger).mutation(api.payments.recordCodCollected, {
        itemId: item._id,
      }),
    ).rejects.toThrow("Only the seller");

    const result = await as(t, seller).mutation(
      api.payments.recordCodCollected,
      { itemId: item._id, reference: "Cash at handoff" },
    );
    expect(result.paidAt).toBeGreaterThan(0);

    const paid = await t.run((ctx) => ctx.db.get(item._id));
    expect(paid?.paymentStatus).toBe("paid");
    expect(paid?.paymentReference).toBe("Cash at handoff");
    expect(paid?.paymentRecordedBy).toBe(seller);

    // Duplicate confirmation is refused, so nothing is counted twice.
    await expect(
      as(t, seller).mutation(api.payments.recordCodCollected, {
        itemId: item._id,
      }),
    ).rejects.toThrow("already recorded");
  });

  test("an admin can record cash on a seller's behalf", async () => {
    const t = createTest();
    const adminUser = await newUser(t, { role: "admin" });
    const seller = await newUser(t, { seller: true });
    const buyer = await newUser(t);
    const product = await insertProduct(t, seller);
    const { items } = await placeAndDeliver(t, seller, buyer, [product]);

    await as(t, adminUser).mutation(api.payments.recordCodCollected, {
      itemId: items[0]._id,
    });
    const paid = await t.run((ctx) => ctx.db.get(items[0]._id));
    expect(paid?.paymentStatus).toBe("paid");
    expect(paid?.paymentRecordedBy).toBe(adminUser);
  });
});

describe("seller earnings from real transactions", () => {
  test("pending, collected cash, commission and the per-seller fee add up", async () => {
    const t = createTest();
    const adminUser = await newUser(t, { role: "admin" });
    const seller = await newUser(t);
    await activateBusinessPlan(t, seller, adminUser);
    const buyer = await newUser(t);
    const mug = await insertProduct(t, seller, { priceCents: 10_000 });
    const plate = await insertProduct(t, seller, {
      title: "Dinner plate",
      priceCents: 6_000,
    });

    const { orderId, items } = await placeAndDeliver(t, seller, buyer, [
      mug,
      plate,
    ]);
    const order = await t.run((ctx) => ctx.db.get(orderId));
    expect(order?.subtotalCents).toBe(16_000);
    // One seller-set shipping fee for the group, not per item.
    expect(order?.shippingFeeCents).toBe(500);

    // 5% commission on each delivered item (shipping is excluded).
    const ledger = await t.run((ctx) =>
      ctx.db.query("commissionLedger").collect(),
    );
    expect(ledger).toHaveLength(2);
    expect(
      ledger.reduce((sum, row) => sum + row.amountCents, 0),
    ).toBe(800);

    // One line is paid in cash, the other is still awaiting payment.
    const paidItem = items[0];
    await as(t, seller).mutation(api.payments.recordCodCollected, {
      itemId: paidItem._id,
    });

    const earnings = await as(t, seller).query(
      api.payments.sellerEarnings,
      {},
    );
    expect(earnings).not.toBeNull();
    expect(earnings?.grossDeliveredCents).toBe(16_000);
    expect(earnings?.commissionCents).toBe(800);
    // Gross + the single fee − commission is split between pending/collected.
    expect(
      (earnings?.pendingCents ?? 0) + (earnings?.collectedCashCents ?? 0),
    ).toBe(16_500 - 800);
    expect(earnings?.pendingCount).toBe(1);
    expect(earnings?.availableCents).toBe(0);
    expect(earnings?.paidOutCents).toBe(0);
    expect(earnings?.connect.status).toBe("not_connected");
    expect(earnings?.sales).toHaveLength(2);
  });

  test("earnings exclude other sellers, undelivered and cancelled items", async () => {
    const t = createTest();
    const seller = await newUser(t, { seller: true });
    const otherSeller = await newUser(t, { seller: true });
    const buyer = await newUser(t);
    const product = await insertProduct(t, seller);
    const otherProduct = await insertProduct(t, otherSeller);

    // A delivered sale for the first seller.
    await placeAndDeliver(t, seller, buyer, [product]);

    // Another order placed but cancelled before delivery.
    const cancelledOrderId = await as(t, buyer).mutation(api.orders.place, {
      items: [{ productId: otherProduct, quantity: 1 }],
      fulfillments: [{ sellerId: otherSeller, method: "shipping" }],
      paymentMethod: "cod",
    });
    await as(t, buyer).mutation(api.orders.cancel, {
      orderId: cancelledOrderId,
    });

    const mine = await as(t, seller).query(api.payments.sellerEarnings, {});
    expect(mine?.deliveredCount).toBe(1);
    expect(mine?.grossDeliveredCents).toBe(10_000);

    const theirs = await as(t, otherSeller).query(
      api.payments.sellerEarnings,
      {},
    );
    expect(theirs?.deliveredCount).toBe(0);
    expect(theirs?.grossDeliveredCents).toBe(0);
    expect(theirs?.pendingCents).toBe(0);
    expect(theirs?.collectedCashCents).toBe(0);
  });
});

describe("refunds and failed-payment safety", () => {
  test("an admin refund reverses pending commission and blocks re-collection", async () => {
    const t = createTest();
    const adminUser = await newUser(t, { role: "admin" });
    const seller = await newUser(t);
    await activateBusinessPlan(t, seller, adminUser);
    const buyer = await newUser(t);
    const product = await insertProduct(t, seller);
    const { items } = await placeAndDeliver(t, seller, buyer, [product]);
    const itemId = items[0]._id;

    await as(t, seller).mutation(api.payments.recordCodCollected, {
      itemId,
    });

    // Non-admins cannot refund.
    await expect(
      as(t, seller).mutation(api.payments.adminRefundItem, { itemId }),
    ).rejects.toThrow(/admin access/i);

    await as(t, adminUser).mutation(api.payments.adminRefundItem, {
      itemId,
      note: "Item arrived damaged.",
    });

    const refunded = await t.run((ctx) => ctx.db.get(itemId));
    expect(refunded?.paymentStatus).toBe("refunded");
    expect(refunded?.refundNote).toBe("Item arrived damaged.");

    const ledger = await t.run((ctx) =>
      ctx.db.query("commissionLedger").collect(),
    );
    expect(ledger[0].status).toBe("reversed");

    const earnings = await as(t, seller).query(
      api.payments.sellerEarnings,
      {},
    );
    expect(earnings?.refundedCents).toBe(10_000);
    expect(earnings?.collectedCashCents).toBe(0);
    expect(earnings?.commissionCents).toBe(0);

    await expect(
      as(t, adminUser).mutation(api.payments.adminRefundItem, { itemId }),
    ).rejects.toThrow("already refunded");
    await expect(
      as(t, seller).mutation(api.payments.recordCodCollected, { itemId }),
    ).rejects.toThrow("refunded");
  });

  test("only paid items can be refunded", async () => {
    const t = createTest();
    const adminUser = await newUser(t, { role: "admin" });
    const seller = await newUser(t, { seller: true });
    const buyer = await newUser(t);
    const product = await insertProduct(t, seller);
    const { items } = await placeAndDeliver(t, seller, buyer, [product]);

    await expect(
      as(t, adminUser).mutation(api.payments.adminRefundItem, {
        itemId: items[0]._id,
      }),
    ).rejects.toThrow("Only a paid item");
  });
});

describe("payout honesty and Stripe readiness", () => {
  test("payouts are only shown as paid when Stripe confirmed them", async () => {
    const t = createTest();
    const seller = await newUser(t, { seller: true });
    const now = Date.now();
    await t.run((ctx) =>
      ctx.db.insert("payouts", {
        sellerId: seller,
        amountCents: 9_999,
        currency: "usd",
        provider: "manual",
        status: "paid",
        note: "Typed in by hand",
        createdAt: now,
      }),
    );
    await t.run((ctx) =>
      ctx.db.insert("payouts", {
        sellerId: seller,
        amountCents: 2_500,
        currency: "usd",
        provider: "stripe",
        status: "paid",
        providerTransferId: "tr_test_123",
        createdAt: now,
        confirmedAt: now,
      }),
    );

    const earnings = await as(t, seller).query(
      api.payments.sellerEarnings,
      {},
    );
    expect(earnings?.paidOutCents).toBe(2_500);
    const manual = earnings?.payouts.find((p) => p.provider === "manual");
    expect(manual?.confirmed).toBe(false);
    const stripe = earnings?.payouts.find((p) => p.provider === "stripe");
    expect(stripe?.confirmed).toBe(true);

    const adminUser = await newUser(t, { role: "admin" });
    const overview = await as(t, adminUser).query(
      api.payments.adminOverview,
      {},
    );
    expect(
      overview.payouts.find((p) => p.provider === "manual")?.confirmed,
    ).toBe(false);
    expect(
      overview.payouts.find((p) => p.provider === "stripe")?.confirmed,
    ).toBe(true);
  });

  test("Stripe readiness never claims card payments are available", () => {
    const empty = payments.assessStripeReadiness({});
    expect(empty.keysPresent).toBe(false);
    expect(empty.cardPaymentsAvailable).toBe(false);
    expect(empty.missing).toContain("STRIPE_SECRET_KEY");
    expect(empty.missing).toContain("STRIPE_WEBHOOK_SECRET");
    expect(empty.missing).toContain("STRIPE_CONNECT_CLIENT_ID");

    const configured = payments.assessStripeReadiness({
      STRIPE_SECRET_KEY: "sk_test_placeholder",
      STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
      STRIPE_CONNECT_CLIENT_ID: "ca_placeholder",
    });
    expect(configured.keysPresent).toBe(true);
    expect(configured.missing).toHaveLength(0);
    // Keys alone do not make checkout or payouts real.
    expect(configured.cardPaymentsAvailable).toBe(false);
    expect(configured.connectAvailable).toBe(false);
    expect(configured.blockers.length).toBeGreaterThan(0);
  });
});

describe("admin payment visibility and commission integrity", () => {
  test("admin overview totals reflect recorded and awaiting payments", async () => {
    const t = createTest();
    const adminUser = await newUser(t, { role: "admin" });
    const seller = await newUser(t, { seller: true });
    const buyer = await newUser(t);
    const mug = await insertProduct(t, seller, { priceCents: 8_000 });
    const bowl = await insertProduct(t, seller, {
      title: "Soup bowl",
      priceCents: 4_000,
    });
    const { items } = await placeAndDeliver(t, seller, buyer, [mug, bowl]);
    await as(t, seller).mutation(api.payments.recordCodCollected, {
      itemId: items[0]._id,
    });

    const overview = await as(t, adminUser).query(
      api.payments.adminOverview,
      {},
    );
    expect(overview.totals.cashCollectedCents).toBe(8_000);
    expect(overview.totals.awaitingCents).toBe(4_000);
    expect(overview.totals.awaitingCount).toBe(1);
    expect(overview.totals.cardCollectedCents).toBe(0);
    expect(overview.sellers[0].connectStatus).toBe("not_connected");
    expect(overview.readiness.cardPaymentsAvailable).toBe(false);

    await expect(
      as(t, seller).query(api.payments.adminOverview, {}),
    ).rejects.toThrow(/admin access/i);
  });

  test("tampered commission math is flagged for admins", async () => {
    const t = createTest();
    const adminUser = await newUser(t, { role: "admin" });
    const seller = await newUser(t);
    await activateBusinessPlan(t, seller, adminUser);
    const buyer = await newUser(t);
    const product = await insertProduct(t, seller);
    await placeAndDeliver(t, seller, buyer, [product]);

    const clean = await as(t, adminUser).query(
      api.payments.commissionIntegrity,
      {},
    );
    expect(clean.issues).toHaveLength(0);
    expect(clean.checkedEntries).toBe(1);

    const [row] = await t.run((ctx) =>
      ctx.db.query("commissionLedger").collect(),
    );
    await t.run((ctx) =>
      ctx.db.patch(row._id, { amountCents: row.amountCents - 100 }),
    );

    const broken = await as(t, adminUser).query(
      api.payments.commissionIntegrity,
      {},
    );
    expect(broken.issues.map((issue) => issue.type)).toContain(
      "amount_mismatch",
    );

    await expect(
      as(t, seller).query(api.payments.commissionIntegrity, {}),
    ).rejects.toThrow(/admin access/i);
  });
});
