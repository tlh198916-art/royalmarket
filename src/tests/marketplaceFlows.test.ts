import { describe, expect, test } from "bun:test";
import type { Id } from "@/convex/_generated/dataModel";
import * as orders from "@/convex/orders";
import * as products from "@/convex/products";
import * as sellers from "@/convex/sellers";
import schema from "@/convex/schema";
import { defineTestApp } from "convex-test";

const app = defineTestApp({ schema });
const { api, createTest } = app.defineModules({ orders, products, sellers });
type TestT = ReturnType<typeof createTest>;

const as = (t: TestT, userId: Id<"users">) =>
  t.withIdentity({ subject: `${userId}|test-session` });

async function newUser(
  t: TestT,
  options: {
    email?: string;
    role?: "admin" | "user";
    verified?: boolean;
    seller?: boolean;
  } = {},
) {
  return await t.run((ctx) =>
    ctx.db.insert("users", {
      email: options.email ?? `${crypto.randomUUID()}@example.com`,
      role: options.role ?? "user",
      isSeller: options.seller ?? false,
      emailVerificationTime: options.verified === false ? undefined : Date.now(),
    }),
  );
}

const fulfillment = {
  pickup: { enabled: true, area: "Central City" },
  shipping: { enabled: true, feeCents: 500, handlingDays: 2 },
  delivery: { enabled: false, feeCents: 0, contactRequired: true },
};

function listingArgs(
  overrides: {
    title?: string;
    description?: string;
    categoryId?: string;
    priceCents?: number;
    quantity?: number;
    returns?: { accepted: boolean; days: number };
    publish?: boolean;
  } = {},
) {
  return {
    title: overrides.title ?? "Vintage Camera",
    description:
      overrides.description ??
      "A carefully maintained camera in working condition.",
    categoryId: overrides.categoryId ?? "electronics",
    priceCents: overrides.priceCents ?? 12_500,
    quantity: overrides.quantity ?? 3,
    condition: "good" as const,
    imageStorageIds: [] as string[],
    returns: overrides.returns ?? { accepted: false, days: 0 },
    fulfillment,
    publish: overrides.publish ?? true,
  };
}

async function insertProduct(
  t: TestT,
  sellerId: Id<"users">,
  overrides: {
    status?: "draft" | "active" | "removed";
    title?: string;
    priceCents?: number;
    quantity?: number;
    featuredAt?: number;
  } = {},
) {
  return await t.run((ctx) =>
    ctx.db.insert("products", {
      sellerId,
      title: overrides.title ?? "Secret draft camera",
      description: "An internal draft listing description.",
      categoryId: "electronics",
      priceCents: overrides.priceCents ?? 12_500,
      quantity: overrides.quantity ?? 3,
      condition: "good",
      imageStorageIds: [],
      returns: { accepted: false, days: 0 },
      fulfillment,
      status: overrides.status ?? "draft",
      featuredAt: overrides.featuredAt,
      views: 0,
      soldCount: 0,
      moderatorNote: "internal moderation details",
      embedding: Array.from({ length: 768 }, () => 0.1),
    }),
  );
}

describe("listing privacy and permissions", () => {
  test("public product lookup hides another seller's draft/removed listings", async () => {
    const t = createTest();
    const owner = await newUser(t, { seller: true });
    const visitor = await newUser(t);
    const draft = await insertProduct(t, owner);
    const removed = await insertProduct(t, owner, {
      status: "removed",
      title: "Removed camera",
    });

    expect(await t.query(api.products.get, { id: draft })).toBeNull();
    expect(await t.query(api.products.get, { id: removed })).toBeNull();
    expect(await as(t, visitor).query(api.products.get, { id: draft })).toBeNull();

    const ownerDraft = await as(t, owner).query(api.products.get, { id: draft });
    expect(ownerDraft?.status).toBe("draft");
    expect("moderatorNote" in (ownerDraft ?? {})).toBe(false);
    expect("embedding" in (ownerDraft ?? {})).toBe(false);
  });

  test("public listings, product details, and cart fetches omit internal fields", async () => {
    const t = createTest();
    const owner = await newUser(t, { seller: true });
    const id = await insertProduct(t, owner, { status: "active" });

    const catalog = await t.query(api.products.list, {});
    expect(catalog).toHaveLength(1);
    expect("moderatorNote" in catalog[0]).toBe(false);
    expect("embedding" in catalog[0]).toBe(false);

    const detail = await t.query(api.products.get, { id });
    expect("moderatorNote" in (detail ?? {})).toBe(false);
    expect("embedding" in (detail ?? {})).toBe(false);

    const cartFetch = await t.query(api.products.getByIds, { ids: [id] });
    expect("moderatorNote" in cartFetch[0]).toBe(false);
    expect("embedding" in cartFetch[0]).toBe(false);
  });

  test("public feeds hide internal test sellers and test-marked listings", async () => {
    const t = createTest();
    const testSeller = await newUser(t, {
      seller: true,
      email: "royalmarket-e2e@mailinator.com",
    });
    const realSeller = await newUser(t, {
      seller: true,
      email: "owner@royalblue.shop",
    });
    const testSellerProduct = await insertProduct(t, testSeller, {
      status: "active",
      title: "E2E Test Camera — Stripe Test Only",
    });
    const markedProduct = await insertProduct(t, realSeller, {
      status: "active",
      title: "[TEST] internal sample listing",
    });
    const realProduct = await insertProduct(t, realSeller, {
      status: "active",
      title: "Canon film camera",
    });

    const catalog = await t.query(api.products.list, {});
    expect(catalog.map((p) => p._id)).toEqual([realProduct]);
    expect(await t.query(api.products.get, { id: testSellerProduct })).toBeNull();
    expect(await t.query(api.products.get, { id: markedProduct })).toBeNull();
    expect(
      (await t.query(api.products.getByIds, {
        ids: [testSellerProduct, markedProduct, realProduct],
      })).map((p) => p._id),
    ).toEqual([realProduct]);
  });

  test("featured and available-only feeds exclude zero-stock listings", async () => {
    const t = createTest();
    const seller = await newUser(t, {
      seller: true,
      email: "owner@royalblue.shop",
    });
    const liveFeatured = await insertProduct(t, seller, {
      status: "active",
      title: "Live featured camera",
      quantity: 2,
      featuredAt: Date.now(),
    });
    const soldOutFeatured = await insertProduct(t, seller, {
      status: "active",
      title: "Sold out featured camera",
      quantity: 0,
      featuredAt: Date.now(),
    });
    const liveUnfeatured = await insertProduct(t, seller, {
      status: "active",
      title: "Live newest camera",
      quantity: 1,
    });

    const featured = await t.query(api.products.list, { featuredOnly: true });
    expect(featured.map((p) => p._id)).toEqual([liveFeatured]);
    expect(featured.map((p) => p._id)).not.toContain(soldOutFeatured);

    const available = await t.query(api.products.list, { availableOnly: true });
    expect(available.map((p) => p._id)).toEqual(
      expect.arrayContaining([liveFeatured, liveUnfeatured]),
    );
    expect(available.map((p) => p._id)).not.toContain(soldOutFeatured);
  });

  test("another seller cannot edit, publish, or delete a listing", async () => {
    const t = createTest();
    const owner = await newUser(t, { seller: true });
    const intruder = await newUser(t, { seller: true });
    const id = await insertProduct(t, owner);

    await expect(
      as(t, intruder).mutation(api.products.update, {
        id,
        ...(() => {
          const fields = listingArgs({ title: "Stolen listing" });
          delete (fields as Partial<typeof fields>).publish;
          return fields;
        })(),
        status: "active",
      }),
    ).rejects.toThrow("only edit your own");
    await expect(
      as(t, intruder).mutation(api.products.setStatus, { id, status: "active" }),
    ).rejects.toThrow("only change your own");
    await expect(
      as(t, intruder).mutation(api.products.remove, { id }),
    ).rejects.toThrow("only delete your own");
    expect((await t.run((ctx) => ctx.db.get(id)))?.status).toBe("draft");
  });

  test("create and update reject invalid return windows and fractional quantities", async () => {
    const t = createTest();
    const seller = await newUser(t, { seller: true });
    const sellerT = as(t, seller);

    await expect(
      sellerT.mutation(
        api.products.create,
        listingArgs({ returns: { accepted: true, days: 1.5 } }),
      ),
    ).rejects.toThrow("Return window");
    await expect(
      sellerT.mutation(api.products.create, listingArgs({ quantity: 1.5 })),
    ).rejects.toThrow("whole number");

    const id = await sellerT.mutation(
      api.products.create,
      listingArgs({ publish: false }),
    );
    await expect(
      sellerT.mutation(api.products.update, {
        id,
        ...(() => {
          const fields = listingArgs({ returns: { accepted: false, days: 7 } });
          delete (fields as Partial<typeof fields>).publish;
          return fields;
        })(),
        status: "draft",
      }),
    ).rejects.toThrow("Return days should be 0");
  });
});

describe("seller onboarding", () => {
  test("business identity cannot be supplied to the public seller onboarding mutation", async () => {
    const t = createTest();
    const user = await newUser(t);
    await expect(
      as(t, user).mutation(
        api.sellers.become,
        { shopName: "My Shop", sellerType: "business" } as never,
      ),
    ).rejects.toThrow("Expected `individual`, got `business`");
    expect((await t.run((ctx) => ctx.db.get(user)))?.sellerType).toBeUndefined();
  });
});

describe("buyer checkout validation and data boundaries", () => {
  test("rejects fractional quantities instead of silently rounding down", async () => {
    const t = createTest();
    const seller = await newUser(t, { seller: true });
    const buyer = await newUser(t);
    const id = await insertProduct(t, seller, { status: "active" });

    await expect(
      as(t, buyer).mutation(api.orders.place, {
        items: [{ productId: id, quantity: 1.7 }],
        fulfillments: [{ sellerId: seller, method: "meetup" }],
        paymentMethod: "cod",
      }),
    ).rejects.toThrow("whole number");
  });

  test("rejects repeated seller fulfillments before creating an order", async () => {
    const t = createTest();
    const seller = await newUser(t, { seller: true });
    const buyer = await newUser(t);
    const product = await insertProduct(t, seller, { status: "active" });

    await expect(
      as(t, buyer).mutation(api.orders.place, {
        items: [{ productId: product, quantity: 1 }],
        fulfillments: [
          { sellerId: seller, method: "meetup" },
          { sellerId: seller, method: "shipping" },
        ],
        paymentMethod: "cod",
      }),
    ).rejects.toThrow("Choose exactly one fulfillment");
    expect(await t.run((ctx) => ctx.db.query("orders").collect())).toHaveLength(0);
    expect((await t.run((ctx) => ctx.db.get(product)))?.quantity).toBe(3);
  });

  test("a buyer's placed order uses live prices and creates seller-only order rows", async () => {
    const t = createTest();
    const sellerA = await newUser(t, { seller: true });
    const sellerB = await newUser(t, { seller: true });
    const buyer = await newUser(t);
    const outsider = await newUser(t);
    const productA = await insertProduct(t, sellerA, {
      status: "active",
      title: "Camera A",
      priceCents: 10_000,
    });
    const productB = await insertProduct(t, sellerB, {
      status: "active",
      title: "Camera B",
      priceCents: 20_000,
    });

    const orderId = await as(t, buyer).mutation(api.orders.place, {
      items: [
        { productId: productA, quantity: 2 },
        { productId: productB, quantity: 1 },
      ],
      fulfillments: [
        { sellerId: sellerA, method: "shipping" },
        { sellerId: sellerB, method: "meetup" },
      ],
      paymentMethod: "cod",
    });
    const order = await t.run((ctx) => ctx.db.get(orderId));
    expect(order?.subtotalCents).toBe(40_000);
    expect(order?.shippingFeeCents).toBe(500);
    expect(order?.totalCents).toBe(40_500);
    expect(order?.paymentMethod).toBe("cod");
    expect((await t.run((ctx) => ctx.db.get(productA)))?.quantity).toBe(1);

    expect(await as(t, buyer).query(api.orders.myOrders, {})).toHaveLength(1);
    expect(await as(t, outsider).query(api.orders.myOrders, {})).toHaveLength(0);
    expect(await as(t, sellerA).query(api.orders.sellerOrders, {})).toHaveLength(1);
    expect(await as(t, sellerB).query(api.orders.sellerOrders, {})).toHaveLength(1);
    expect(await as(t, outsider).query(api.orders.sellerOrders, {})).toHaveLength(0);
  });

  test("card payment and unavailable stock fail without a partial order", async () => {
    const t = createTest();
    const seller = await newUser(t, { seller: true });
    const buyer = await newUser(t);
    const product = await insertProduct(t, seller, { status: "active" });
    const checkoutArgs = {
      items: [{ productId: product, quantity: 1 }],
      fulfillments: [{ sellerId: seller, method: "meetup" as const }],
    };

    await expect(
      as(t, buyer).mutation(api.orders.place, {
        ...checkoutArgs,
        paymentMethod: "card",
      }),
    ).rejects.toThrow("not configured");
    await expect(
      as(t, buyer).mutation(api.orders.place, {
        ...checkoutArgs,
        items: [{ productId: product, quantity: 4 }],
        paymentMethod: "cod",
      }),
    ).rejects.toThrow("left in stock");
    expect(await t.run((ctx) => ctx.db.query("orders").collect())).toHaveLength(0);
    expect((await t.run((ctx) => ctx.db.get(product)))?.quantity).toBe(3);
  });
});
