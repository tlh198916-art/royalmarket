import { describe, expect, test } from "bun:test";
import type { Id } from "@/convex/_generated/dataModel";
import * as admin from "@/convex/admin";
import * as orders from "@/convex/orders";
import * as products from "@/convex/products";
import * as referrals from "@/convex/referrals";
import * as reports from "@/convex/reports";
import * as reviews from "@/convex/reviews";
import schema from "@/convex/schema";
import * as sellers from "@/convex/sellers";
import { productJsonLd } from "@/lib/seo";
import { defineTestApp } from "convex-test";

const app = defineTestApp({ schema });
const { api, createTest } = app.defineModules({
  admin,
  orders,
  products,
  referrals,
  reports,
  reviews,
  sellers,
});
type TestT = ReturnType<typeof createTest>;

const as = (t: TestT, userId: Id<"users">) =>
  t.withIdentity({ subject: `${userId}|test-session` });

async function newUser(
  t: TestT,
  options: {
    role?: "admin" | "user";
    seller?: boolean;
    verified?: boolean;
  } = {},
) {
  return await t.run((ctx) =>
    ctx.db.insert("users", {
      email: `${crypto.randomUUID()}@example.com`,
      role: options.role ?? "user",
      isSeller: options.seller ?? false,
      emailVerificationTime:
        options.verified === false ? undefined : Date.now(),
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
  overrides: {
    title?: string;
    priceCents?: number;
    condition?: "new" | "like_new" | "good" | "fair";
    categoryId?: string;
  } = {},
) {
  return await t.run((ctx) =>
    ctx.db.insert("products", {
      sellerId,
      title: overrides.title ?? "Handmade ceramic mug",
      description: "A wheel-thrown stoneware mug with a matte glaze.",
      categoryId: overrides.categoryId ?? "home",
      priceCents: overrides.priceCents ?? 5_000,
      quantity: 3,
      condition: overrides.condition ?? "good",
      imageStorageIds: [],
      returns: { accepted: false, days: 0 },
      fulfillment,
      status: "active" as const,
      views: 0,
      soldCount: 0,
    }),
  );
}

/** A delivered order is the only thing that makes a review eligible. */
async function insertDeliveredOrder(
  t: TestT,
  buyerId: Id<"users">,
  sellerId: Id<"users">,
  productId: Id<"products">,
) {
  const now = Date.now();
  return await t.run(async (ctx) => {
    const orderId = await ctx.db.insert("orders", {
      buyerId,
      items: [
        {
          productId,
          sellerId,
          title: "Handmade ceramic mug",
          priceCents: 5_000,
          quantity: 1,
        },
      ],
      subtotalCents: 5_000,
      totalCents: 5_000,
      status: "delivered",
      paymentMethod: "cod",
      placedAt: now,
      deliveredAt: now,
    });
    await ctx.db.insert("orderItems", {
      orderId,
      buyerId,
      sellerId,
      productId,
      title: "Handmade ceramic mug",
      priceCents: 5_000,
      quantity: 1,
      status: "delivered",
      paymentStatus: "paid",
      paidAt: now,
    });
    return orderId;
  });
}

describe("catalog discovery", () => {
  test("filters by price range, condition and minimum rating", async () => {
    const t = createTest();
    const seller = await newUser(t, { seller: true });
    const cheap = await insertProduct(t, seller, { priceCents: 1_000 });
    const mid = await insertProduct(t, seller, {
      priceCents: 5_000,
      condition: "new",
    });
    const rated = await insertProduct(t, seller, {
      priceCents: 20_000,
      condition: "new",
    });
    await t.run((ctx) =>
      ctx.db.patch(rated, { ratingSum: 9, ratingCount: 2 }),
    );

    const byPrice = await t.query(api.products.list, {
      minPriceCents: 4_000,
      maxPriceCents: 25_000,
    });
    expect(byPrice.map((p) => p._id).sort()).toEqual([mid, rated].sort());

    const byCondition = await t.query(api.products.list, {
      condition: "new",
    });
    expect(byCondition.map((p) => p._id).sort()).toEqual(
      [mid, rated].sort(),
    );

    const byRating = await t.query(api.products.list, { minRating: 4 });
    expect(byRating).toHaveLength(1);
    expect(byRating[0]._id).toBe(rated);
    expect(byRating[0].ratingAverage).toBeCloseTo(4.5);

    const emptyRange = await t.query(api.products.list, {
      minPriceCents: 9_000,
      maxPriceCents: 1_000,
    });
    expect(emptyRange).toHaveLength(0);
    expect(cheap).toBeTruthy();
  });

  test("admin-curated featured listings lead the featured sort", async () => {
    const t = createTest();
    const adminUser = await newUser(t, { role: "admin" });
    const seller = await newUser(t, { seller: true });
    const first = await insertProduct(t, seller, { title: "Older mug" });
    const second = await insertProduct(t, seller, { title: "Newer mug" });

    await expect(
      as(t, seller).mutation(api.admin.setFeatured, {
        productId: second,
        featured: true,
      }),
    ).rejects.toThrow(/admin access/i);

    await as(t, adminUser).mutation(api.admin.setFeatured, {
      productId: first,
      featured: true,
    });

    const featured = await t.query(api.products.list, { featuredOnly: true });
    expect(featured.map((p) => p._id)).toEqual([first]);
    expect(featured[0].featured).toBe(true);

    const sorted = await t.query(api.products.list, { sortBy: "featured" });
    expect(sorted[0]._id).toBe(first);
    expect(sorted.map((p) => p._id)).toContain(second);

    const draft = await t.run((ctx) =>
      ctx.db.insert("products", {
        sellerId: seller,
        title: "Secret draft",
        description: "Not live yet.",
        categoryId: "home",
        priceCents: 1_000,
        quantity: 1,
        condition: "good",
        imageStorageIds: [],
        returns: { accepted: false, days: 0 },
        fulfillment,
        status: "draft",
        views: 0,
        soldCount: 0,
      }),
    );
    await expect(
      as(t, adminUser).mutation(api.admin.setFeatured, {
        productId: draft,
        featured: true,
      }),
    ).rejects.toThrow("live listings");

    await as(t, adminUser).mutation(api.admin.setFeatured, {
      productId: first,
      featured: false,
    });
    expect(
      await t.query(api.products.list, { featuredOnly: true }),
    ).toHaveLength(0);
  });
});

describe("ratings and storefront reviews", () => {
  test("a review updates listing aggregates and cannot be duplicated", async () => {
    const t = createTest();
    const seller = await newUser(t, { seller: true });
    const buyer = await newUser(t);
    const product = await insertProduct(t, seller);

    await expect(
      as(t, buyer).mutation(api.reviews.create, {
        productId: product,
        rating: 5,
        comment: "Exactly as described and packed carefully.",
      }),
    ).rejects.toThrow(/after delivery/i);

    await insertDeliveredOrder(t, buyer, seller, product);

    await as(t, buyer).mutation(api.reviews.create, {
      productId: product,
      rating: 5,
      comment: "Exactly as described and packed carefully.",
    });

    const stored = await t.run((ctx) => ctx.db.get(product));
    expect(stored?.ratingSum).toBe(5);
    expect(stored?.ratingCount).toBe(1);

    const [listed] = await t.query(api.products.list, {});
    expect(listed.ratingAverage).toBe(5);
    expect(listed.ratingCount).toBe(1);

    await expect(
      as(t, buyer).mutation(api.reviews.create, {
        productId: product,
        rating: 1,
        comment: "Changed my mind.",
      }),
    ).rejects.toThrow("already reviewed");

    await expect(
      as(t, buyer).mutation(api.reviews.create, {
        productId: product,
        rating: 9,
        comment: "Out of range",
      }),
    ).rejects.toThrow("between 1 and 5");
  });

  test("the public storefront exposes rating breakdown, reviews and trust stats", async () => {
    const t = createTest();
    const seller = await newUser(t, { seller: true });
    const buyer = await newUser(t);
    const product = await insertProduct(t, seller, { title: "Glazed mug" });
    await insertDeliveredOrder(t, buyer, seller, product);
    await as(t, buyer).mutation(api.reviews.create, {
      productId: product,
      rating: 4,
      comment: "Lovely glaze, slightly small handle.",
    });

    const profile = await as(t, buyer).query(api.sellers.publicProfile, {
      sellerId: seller,
    });
    expect(profile?.verifiedSeller).toBe(true);
    expect(profile?.ratingCount).toBe(1);
    expect(profile?.averageRating).toBe(4);
    expect(profile?.ratingBreakdown["4"]).toBe(1);
    expect(profile?.recentReviews).toHaveLength(1);
    expect(profile?.recentReviews[0].comment).toContain("Lovely glaze");
    expect(profile?.recentReviews[0].productTitle).toBe("Glazed mug");
    expect(profile?.completedSales).toBe(1);
  });
});

describe("seller referrals", () => {
  test("new sellers get a code and invites are attributed once", async () => {
    const t = createTest();
    const inviter = await newUser(t);
    await as(t, inviter).mutation(api.sellers.become, {
      shopName: "Inviting Shop",
    });
    const inviterDoc = await t.run((ctx) => ctx.db.get(inviter));
    expect(inviterDoc?.referralCode).toMatch(/^[A-Z0-9]{6}$/);

    const invitee = await newUser(t);
    await as(t, invitee).mutation(api.sellers.become, {
      shopName: "Invited Shop",
      referralCode: inviterDoc!.referralCode!,
    });

    const inviteeDoc = await t.run((ctx) => ctx.db.get(invitee));
    expect(inviteeDoc?.referredBySellerId).toBe(inviter);

    const summary = await as(t, inviter).query(api.referrals.myReferrals, {});
    expect(summary?.inviteCount).toBe(1);
    expect(summary?.invites[0].shopName).toBe("Invited Shop");

    const board = await t.query(api.referrals.leaderboard, {});
    expect(board[0].sellerId).toBe(inviter);
    expect(board[0].inviteCount).toBe(1);

    const adminUser = await newUser(t, { role: "admin" });
    const overview = await as(t, adminUser).query(
      api.admin.referralOverview,
      {},
    );
    expect(overview.total).toBe(1);
    expect(overview.topInviters[0].sellerId).toBe(inviter);
    await expect(
      as(t, inviter).query(api.admin.referralOverview, {}),
    ).rejects.toThrow(/admin access/i);

    // A second onboarding call must not double-count the invite.
    await as(t, invitee).mutation(api.sellers.become, {
      shopName: "Invited Shop",
      referralCode: inviterDoc!.referralCode!,
    });
    expect(
      await as(t, inviter).query(api.referrals.myReferrals, {}),
    ).toMatchObject({ inviteCount: 1 });
  });

  test("self-referral and unknown codes never create an invite", async () => {
    const t = createTest();
    const user = await newUser(t);
    await as(t, user).mutation(api.sellers.become, { shopName: "Solo Shop" });
    const doc = await t.run((ctx) => ctx.db.get(user));

    await as(t, user).mutation(api.sellers.become, {
      shopName: "Solo Shop",
      referralCode: doc!.referralCode!,
    });

    await as(t, user).mutation(api.sellers.become, {
      shopName: "Solo Shop",
      referralCode: "NOPE99",
    });

    const rows = await t.run((ctx) => ctx.db.query("referrals").collect());
    expect(rows).toHaveLength(0);
    expect(
      await as(t, user).query(api.referrals.myReferrals, {}),
    ).toMatchObject({ inviteCount: 0 });
  });
});

describe("listing reports", () => {
  test("verified users can report once and admins resolve it", async () => {
    const t = createTest();
    const adminUser = await newUser(t, { role: "admin" });
    const seller = await newUser(t, { seller: true });
    const reporter = await newUser(t);
    const unverified = await newUser(t, { verified: false });
    const product = await insertProduct(t, seller);

    await expect(
      as(t, unverified).mutation(api.reports.create, {
        productId: product,
        reason: "misleading",
      }),
    ).rejects.toThrow(/verified email/i);

    await expect(
      as(t, seller).mutation(api.reports.create, {
        productId: product,
        reason: "spam",
      }),
    ).rejects.toThrow("your own listing");

    await as(t, reporter).mutation(api.reports.create, {
      productId: product,
      reason: "misleading",
      details: "Photo does not match the item.",
    });
    await expect(
      as(t, reporter).mutation(api.reports.create, {
        productId: product,
        reason: "other",
      }),
    ).rejects.toThrow("already reported");

    await expect(
      as(t, reporter).query(api.reports.adminList, {}),
    ).rejects.toThrow(/admin access/i);

    expect(await as(t, adminUser).query(api.reports.openCount, {})).toBe(1);
    const queue = await as(t, adminUser).query(api.reports.adminList, {});
    expect(queue).toHaveLength(1);
    expect(queue[0].productTitle).toBe("Handmade ceramic mug");
    expect(queue[0].reporterEmail).toBeTruthy();

    await as(t, adminUser).mutation(api.reports.resolve, {
      reportId: queue[0]._id,
      outcome: "resolved",
      removeListing: true,
      note: "Listing removed after report.",
    });

    const after = await t.run((ctx) => ctx.db.get(product));
    expect(after?.status).toBe("removed");
    expect(after?.moderatorNote).toContain("report");
    expect(await as(t, adminUser).query(api.reports.openCount, {})).toBe(0);

    await expect(
      as(t, adminUser).mutation(api.reports.resolve, {
        reportId: queue[0]._id,
        outcome: "dismissed",
      }),
    ).rejects.toThrow("already closed");
  });

  test("reporting a missing listing fails cleanly", async () => {
    const t = createTest();
    const seller = await newUser(t, { seller: true });
    const reporter = await newUser(t);
    const product = await insertProduct(t, seller);
    await t.run((ctx) => ctx.db.delete(product));
    await expect(
      as(t, reporter).mutation(api.reports.create, {
        productId: product,
        reason: "other",
      }),
    ).rejects.toThrow("no longer exists");
  });
});

describe("order messaging", () => {
  test("buyer and seller share a private thread; outsiders are blocked", async () => {
    const t = createTest();
    const seller = await newUser(t, { seller: true });
    const buyer = await newUser(t);
    const outsider = await newUser(t);
    const product = await insertProduct(t, seller);

    const orderId = await as(t, buyer).mutation(api.orders.place, {
      items: [{ productId: product, quantity: 1 }],
      fulfillments: [{ sellerId: seller, method: "shipping" }],
      paymentMethod: "cod",
    });

    await as(t, buyer).mutation(api.orders.sendMessage, {
      orderId,
      body: "Can you ship it by Friday?",
    });

    const buyerView = await as(t, buyer).query(api.orders.messages, {
      orderId,
    });
    expect(buyerView?.viewerRole).toBe("buyer");
    expect(buyerView?.messages).toHaveLength(1);
    expect(buyerView?.messages[0].mine).toBe(true);

    const sellerView = await as(t, seller).query(api.orders.messages, {
      orderId,
    });
    expect(sellerView?.viewerRole).toBe("seller");
    expect(sellerView?.messages[0].mine).toBe(false);

    await as(t, seller).mutation(api.orders.sendMessage, {
      orderId,
      body: "Yes — it goes out tomorrow morning.",
    });
    expect(
      (await as(t, buyer).query(api.orders.messages, { orderId }))?.messages,
    ).toHaveLength(2);

    expect(
      await as(t, outsider).query(api.orders.messages, { orderId }),
    ).toBeNull();
    await expect(
      as(t, outsider).mutation(api.orders.sendMessage, {
        orderId,
        body: "Let me in.",
      }),
    ).rejects.toThrow("cannot message");

    await expect(
      as(t, buyer).mutation(api.orders.sendMessage, {
        orderId,
        body: "   ",
      }),
    ).rejects.toThrow("Write a message");
    await expect(
      as(t, buyer).mutation(api.orders.sendMessage, {
        orderId,
        body: "x".repeat(1001),
      }),
    ).rejects.toThrow("1000 characters");
  });
});

describe("structured data", () => {
  test("product JSON-LD reports price, availability and ratings honestly", () => {
    const base = {
      title: "Glazed mug",
      description: "A handmade mug.",
      imageUrl: "https://example.com/mug.jpg",
      priceCents: 4_250,
      condition: "good",
      available: true,
      sellerShopName: "Corner Ceramics",
    };
    const json = productJsonLd(base) as Record<string, unknown>;
    expect(json["@context"]).toBe("https://schema.org");
    expect(json["@type"]).toBe("Product");
    const offers = json.offers as Record<string, unknown>;
    expect(offers.price).toBe("42.50");
    expect(offers.priceCurrency).toBe("USD");
    expect(offers.availability).toBe("https://schema.org/InStock");
    expect(json.aggregateRating).toBeUndefined();

    const rated = productJsonLd({
      ...base,
      available: false,
      ratingAverage: 4.5,
      ratingCount: 2,
    }) as Record<string, unknown>;
    expect((rated.offers as Record<string, unknown>).availability).toBe(
      "https://schema.org/OutOfStock",
    );
    expect(rated.aggregateRating).toMatchObject({
      ratingValue: "4.5",
      reviewCount: 2,
    });
  });
});
