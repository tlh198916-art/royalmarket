import { describe, expect, test } from "bun:test";
import type { Id } from "@/convex/_generated/dataModel";
import * as admin from "@/convex/admin";
import * as products from "@/convex/products";
import * as referrals from "@/convex/referrals";
import schema from "@/convex/schema";
import * as sellers from "@/convex/sellers";
import { defineTestApp } from "convex-test";

const app = defineTestApp({ schema });
const { api, createTest } = app.defineModules({
  admin,
  products,
  referrals,
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
    email?: string;
    referralCode?: string;
  } = {},
) {
  return await t.run((ctx) =>
    ctx.db.insert("users", {
      email: options.email ?? `${crypto.randomUUID()}@example.com`,
      role: options.role ?? "user",
      isSeller: options.seller ?? false,
      emailVerificationTime: Date.now(),
      sellerType: options.seller ? "individual" : undefined,
      shopName: options.seller ? "Existing seller" : undefined,
      referralCode: options.referralCode,
    }),
  );
}

const fulfillment = {
  pickup: { enabled: true, area: "Central City" },
  shipping: { enabled: true, feeCents: 500, handlingDays: 2 },
  delivery: { enabled: false, feeCents: 0, contactRequired: true },
};

describe("referral links and seller activation", () => {
  test("tracks one visit per session and attributes a real shop setup", async () => {
    const t = createTest();
    const inviter = await newUser(t, {
      seller: true,
      referralCode: "ABC123",
    });
    const invitee = await newUser(t);

    const first = await t.mutation(api.referrals.trackVisit, {
      code: "abc123",
      visitorKey: "visitor-session-123",
      source: "sell-landing",
    });
    expect(first.tracked).toBe(true);

    // The same browser session must not inflate the seller's link visits.
    const duplicate = await t.mutation(api.referrals.trackVisit, {
      code: "ABC123",
      visitorKey: "visitor-session-123",
      source: "sell-landing",
    });
    expect(duplicate.tracked).toBe(false);

    const unknown = await t.mutation(api.referrals.trackVisit, {
      code: "NOPE99",
      visitorKey: "visitor-session-456",
    });
    expect(unknown.tracked).toBe(false);

    const selfVisit = await as(t, inviter).mutation(
      api.referrals.trackVisit,
      {
        code: "ABC123",
        visitorKey: "inviter-session-789",
      },
    );
    expect(selfVisit.tracked).toBe(false);

    const before = await as(t, inviter).query(api.referrals.myReferrals, {});
    expect(before?.visits).toBe(1);
    expect(before?.inviteCount).toBe(0);

    await as(t, invitee).mutation(api.sellers.become, {
      shopName: "Fresh Finds",
      bio: "Household extras from a real person.",
      location: "Portland, OR",
      referralCode: "ABC123",
    });

    const productId = await as(t, invitee).mutation(api.products.create, {
      title: "Ceramic planter",
      description: "A clean, chip-free planter from a smoke-free home.",
      categoryId: "home",
      priceCents: 1_800,
      quantity: 1,
      condition: "good",
      returns: { accepted: false, days: 0 },
      fulfillment,
      publish: true,
    });
    expect(productId).toBeTruthy();

    const after = await as(t, inviter).query(api.referrals.myReferrals, {});
    expect(after?.inviteCount).toBe(1);
    expect(after?.activeInvitees).toBe(1);
    expect(after?.invites[0].shopName).toBe("Fresh Finds");
    expect(after?.invites[0].listings).toBe(1);
    expect(after?.totalListings).toBe(1);
    expect(after?.visits).toBe(1);
  });

  test("requires a verified account before opening a shop", async () => {
    const t = createTest();
    const unverified = await t.run((ctx) =>
      ctx.db.insert("users", {
        email: "unverified@example.com",
        role: "user",
      }),
    );
    await expect(
      as(t, unverified).mutation(api.sellers.become, {
        shopName: "Not verified yet",
      }),
    ).rejects.toThrow(/verified email/i);
  });
});

describe("seller recruitment analytics", () => {
  test("counts real registrations, live shops, listings, and delivered sales", async () => {
    const t = createTest();
    const adminUser = await newUser(t, { role: "admin" });
    const seller = await newUser(t, { seller: true });
    const buyer = await newUser(t);
    const productId = await t.run((ctx) =>
      ctx.db.insert("products", {
        sellerId: seller,
        title: "Working desk lamp",
        description: "A real listing used to verify recruitment analytics.",
        categoryId: "home",
        priceCents: 2_500,
        quantity: 1,
        condition: "good",
        imageStorageIds: [],
        returns: { accepted: false, days: 0 },
        fulfillment,
        status: "active",
        views: 3,
        soldCount: 1,
      }),
    );
    const orderId = await t.run((ctx) =>
      ctx.db.insert("orders", {
        buyerId: buyer,
        items: [
          {
            productId,
            sellerId: seller,
            title: "Working desk lamp",
            priceCents: 2_500,
            quantity: 1,
          },
        ],
        subtotalCents: 2_500,
        totalCents: 2_500,
        status: "delivered",
        paymentMethod: "cod",
      }),
    );
    await t.run((ctx) =>
      ctx.db.insert("orderItems", {
        orderId,
        buyerId: buyer,
        sellerId: seller,
        productId,
        title: "Working desk lamp",
        priceCents: 2_500,
        quantity: 1,
        status: "delivered",
        paymentStatus: "paid",
      }),
    );
    await t.run((ctx) =>
      ctx.db.insert("referralVisits", {
        inviterId: seller,
        code: "ABC123",
        visitorKey: "analytics-visitor",
        source: "founding-sellers",
      }),
    );
    await t.run((ctx) =>
      ctx.db.insert("referrals", {
        inviterId: seller,
        inviteeId: buyer,
        code: "ABC123",
      }),
    );

    await expect(t.query(api.admin.recruitmentOverview, {})).rejects.toThrow(
      /sign in|admin access/i,
    );

    const overview = await as(t, adminUser).query(
      api.admin.recruitmentOverview,
      {},
    );
    expect(overview.registrations).toBe(1);
    expect(overview.activeSellers).toBe(1);
    expect(overview.totalListings).toBe(1);
    expect(overview.activeListings).toBe(1);
    expect(overview.completedSales).toBe(1);
    expect(overview.referralVisits).toBe(1);
    expect(overview.referralShopSetups).toBe(1);
    expect(overview.recentSellers[0].shopName).toBe("Existing seller");
    expect(overview.topCategories[0]).toEqual({
      categoryId: "home",
      count: 1,
    });
  });
});
