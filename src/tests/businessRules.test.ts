import { describe, expect, test } from "bun:test";
import type { Id } from "@/convex/_generated/dataModel";
import * as commissions from "@/convex/commissions";
import * as orders from "@/convex/orders";
import * as products from "@/convex/products";
import schema from "@/convex/schema";
import * as sellers from "@/convex/sellers";
import * as subscriptions from "@/convex/subscriptions";
import { defineTestApp } from "convex-test";

/**
 * Business-model rules, exercised against the real Convex functions:
 * individual sellers are free and never billed, business features require an
 * active paid plan, commission accrues only for active business plans, and
 * listing creation requires a seller profile.
 */

const app = defineTestApp({ schema });
const { api, createTest } = app.defineModules({
  commissions,
  orders,
  products,
  sellers,
  subscriptions,
});
type TestT = ReturnType<typeof createTest>;

const as = (t: TestT, userId: Id<"users">) =>
  t.withIdentity({ subject: `${userId}|test-session` });

async function newUser(
  t: TestT,
  options: {
    role?: "admin" | "user";
    seller?: boolean;
    sellerType?: "individual" | "business";
    shopName?: string;
  } = {},
) {
  return await t.run((ctx) =>
    ctx.db.insert("users", {
      email: `${crypto.randomUUID()}@example.com`,
      role: options.role ?? "user",
      isSeller: options.seller ?? false,
      sellerType: options.sellerType,
      shopName: options.shopName,
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
  overrides: { priceCents?: number; quantity?: number } = {},
) {
  return await t.run((ctx) =>
    ctx.db.insert("products", {
      sellerId,
      title: "Handmade ceramic mug",
      description: "A wheel-thrown stoneware mug with a matte glaze.",
      categoryId: "home",
      priceCents: overrides.priceCents ?? 10_000,
      quantity: overrides.quantity ?? 2,
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

/** Place a one-item shipping order and walk it to delivered. */
async function placeAndDeliver(
  t: TestT,
  sellerId: Id<"users">,
  buyerId: Id<"users">,
  productId: Id<"products">,
) {
  const orderId = await as(t, buyerId).mutation(api.orders.place, {
    items: [{ productId, quantity: 1 }],
    fulfillments: [{ sellerId, method: "shipping" }],
    paymentMethod: "cod",
  });
  // The buyer's checkout choice already approved; the seller signs off.
  await as(t, sellerId).mutation(api.orders.approveFulfillment, {
    orderId,
    sellerId,
  });
  const items = await t.run((ctx) =>
    ctx.db
      .query("orderItems")
      .withIndex("by_order", (q) => q.eq("orderId", orderId))
      .collect(),
  );
  const itemId = items[0]._id;
  await as(t, sellerId).mutation(api.orders.updateItemStatus, {
    itemId,
    status: "shipped",
  });
  await as(t, sellerId).mutation(api.orders.updateItemStatus, {
    itemId,
    status: "delivered",
  });
  return { orderId, itemId };
}

const ledgerRows = (t: TestT) =>
  t.run((ctx) => ctx.db.query("commissionLedger").collect());

describe("free individual sellers are never billed", () => {
  test("becoming an individual seller creates no subscription and no fees", async () => {
    const t = createTest();
    const user = await newUser(t);

    await as(t, user).mutation(api.sellers.become, {
      shopName: "Corner Ceramics",
      location: "Central City",
    });

    const seller = await t.run((ctx) => ctx.db.get(user));
    expect(seller?.isSeller).toBe(true);
    expect(seller?.sellerType).toBe("individual");
    expect(await t.run((ctx) => ctx.db.query("subscriptions").collect())).toHaveLength(0);

    const ledger = await as(t, user).query(api.commissions.myLedger, {});
    expect(ledger.rows).toHaveLength(0);
    expect(ledger.totals?.owedCents).toBe(0);
  });

  test("a delivered individual sale accrues no commission", async () => {
    const t = createTest();
    const seller = await newUser(t, { seller: true, sellerType: "individual" });
    const buyer = await newUser(t);
    const product = await insertProduct(t, seller);

    const { orderId } = await placeAndDeliver(t, seller, buyer, product);

    const order = await t.run((ctx) => ctx.db.get(orderId));
    expect(order?.subtotalCents).toBe(10_000);
    expect(order?.totalCents).toBe(10_500); // one seller shipping fee
    expect(await ledgerRows(t)).toHaveLength(0);

    const ledger = await as(t, seller).query(api.commissions.myLedger, {});
    expect(ledger.rows).toHaveLength(0);
  });

  test("business storefront branding is refused to individual sellers", async () => {
    const t = createTest();
    const seller = await newUser(t, { seller: true, sellerType: "individual" });
    await expect(
      as(t, seller).mutation(api.sellers.updateBusinessProfile, {
        businessContact: "hello@example.com",
      }),
    ).rejects.toThrow("business feature");
  });
});

describe("business plans stay paid and backend-enforced", () => {
  test("subscribing records a pending agreement without activating or charging", async () => {
    const t = createTest();
    const user = await newUser(t);

    await expect(
      as(t, user).mutation(api.subscriptions.subscribe, {
        planId: "starter",
        agreedToTerms: false,
      }),
    ).rejects.toThrow("agree to the seller terms");

    const subId = await as(t, user).mutation(api.subscriptions.subscribe, {
      planId: "starter",
      agreedToTerms: true,
    });
    const sub = await t.run((ctx) => ctx.db.get(subId));
    // Terms are snapshotted from platform settings, not from the client.
    expect(sub?.status).toBe("pending");
    expect(sub?.priceCentsMonthly).toBe(2_900);
    expect(sub?.commissionBps).toBe(500);
    expect(sub?.startedAt).toBeUndefined();

    const seller = await t.run((ctx) => ctx.db.get(user));
    expect(seller?.sellerType).toBe("business");

    // Storefront branding requires the plan to be paid and active.
    await expect(
      as(t, user).mutation(api.sellers.updateBusinessProfile, {
        businessContact: "hello@example.com",
      }),
    ).rejects.toThrow("active business subscription");
  });

  test("a pending business seller's delivered sale accrues no commission", async () => {
    const t = createTest();
    const seller = await newUser(t);
    await as(t, seller).mutation(api.subscriptions.subscribe, {
      planId: "growth",
      agreedToTerms: true,
    });
    const buyer = await newUser(t);
    const product = await insertProduct(t, seller);

    await placeAndDeliver(t, seller, buyer, product);
    expect(await ledgerRows(t)).toHaveLength(0);
  });

  test("an active plan accrues commission once, at the agreed rate", async () => {
    const t = createTest();
    const admin = await newUser(t, { role: "admin" });
    const seller = await newUser(t);
    const subId = await as(t, seller).mutation(api.subscriptions.subscribe, {
      planId: "starter",
      agreedToTerms: true,
    });
    await as(t, admin).mutation(api.subscriptions.adminActivate, {
      subscriptionId: subId,
    });
    const buyer = await newUser(t);
    const product = await insertProduct(t, seller, { priceCents: 10_000 });

    await placeAndDeliver(t, seller, buyer, product);

    const rows = await ledgerRows(t);
    expect(rows).toHaveLength(1);
    // 5% of the $100 merchandise subtotal; the shipping fee is not taxed.
    expect(rows[0].amountCents).toBe(500);
    expect(rows[0].baseCents).toBe(10_000);
    expect(rows[0].commissionBps).toBe(500);
    expect(rows[0].status).toBe("pending");

    const ledger = await as(t, seller).query(api.commissions.myLedger, {});
    expect(ledger.totals?.owedCents).toBe(500);

    // Branding is now available with the active plan.
    await as(t, seller).mutation(api.sellers.updateBusinessProfile, {
      businessContact: "hello@cornerceramics.example",
    });
  });

  test("cancelling the plan returns the seller to free and stops commissions", async () => {
    const t = createTest();
    const admin = await newUser(t, { role: "admin" });
    const seller = await newUser(t);
    const subId = await as(t, seller).mutation(api.subscriptions.subscribe, {
      planId: "pro",
      agreedToTerms: true,
    });
    await as(t, admin).mutation(api.subscriptions.adminActivate, {
      subscriptionId: subId,
    });
    await as(t, seller).mutation(api.subscriptions.cancel, {});

    const afterCancel = await t.run((ctx) => ctx.db.get(seller));
    expect(afterCancel?.sellerType).toBe("individual");

    const buyer = await newUser(t);
    const product = await insertProduct(t, seller);
    await placeAndDeliver(t, seller, buyer, product);
    expect(await ledgerRows(t)).toHaveLength(0);
  });
});

describe("seller-only authorization", () => {
  test("a verified account without a seller profile cannot publish a listing", async () => {
    const t = createTest();
    const user = await newUser(t);

    await expect(
      as(t, user).mutation(api.products.create, {
        title: "Hand-carved spoon",
        description: "Carved from olive wood and finished with oil.",
        categoryId: "home",
        priceCents: 2_000,
        quantity: 1,
        condition: "new",
        imageStorageIds: [],
        returns: { accepted: false, days: 0 },
        fulfillment,
        publish: true,
      }),
    ).rejects.toThrow("seller profile");

    await as(t, user).mutation(api.sellers.become, { shopName: "Spoon Shop" });
    const id = await as(t, user).mutation(api.products.create, {
      title: "Hand-carved spoon",
      description: "Carved from olive wood and finished with oil.",
      categoryId: "home",
      priceCents: 2_000,
      quantity: 1,
      condition: "new",
      imageStorageIds: [],
      returns: { accepted: false, days: 0 },
      fulfillment,
      publish: true,
    });
    const created = await t.run((ctx) => ctx.db.get(id));
    expect(created?.status).toBe("active");
    expect(created?.sellerId).toBe(user);
  });
});
