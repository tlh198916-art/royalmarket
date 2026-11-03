import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { ADMIN_EMAIL, isAdminEmail, isRetiredAdminEmail } from "./adminConfig";
import { requireAdmin, requireUser } from "./lib";
import { internalMutation, mutation, query } from "./_generated/server";

const DAY = 24 * 60 * 60 * 1000;

/** True when this user may hold admin authority right now. */
function canAdmin(user: Doc<"users"> | null): boolean {
  return !!user && user.role === "admin" && !isRetiredAdminEmail(user.email);
}

/**
 * Admin bootstrap: the administrative mailbox claims the only admin seat.
 *
 * It used to be "first verified account wins", which left the seat open to any
 * sign-up and to the retired owner address. Only `ADMIN_EMAIL` may claim now.
 */
export const claimAdmin = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    if (user.isAnonymous || !user.emailVerificationTime)
      throw new Error("Verify your email before claiming admin access.");
    if (isRetiredAdminEmail(user.email))
      throw new Error(
        `Admin access is no longer available for this address. Use ${ADMIN_EMAIL}.`,
      );
    if (!isAdminEmail(user.email))
      throw new Error(
        `Admin access is restricted to ${ADMIN_EMAIL}. Sign in with that address to claim it.`,
      );
    if (user.role === "admin") return true;
    const admins = await ctx.db
      .query("users")
      .withIndex("by_role", (s) => s.eq("role", "admin"))
      .collect();
    // Retired seats don't count: the new mailbox can still take over.
    if (admins.some((admin) => !isRetiredAdminEmail(admin.email)))
      throw new Error("An admin already exists. Ask them for access.");
    await ctx.db.patch(user._id, { role: "admin" });
    return true;
  },
});

/** Lets the admin page decide whether to show the claim prompt. */
export const adminStatus = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx).catch(() => null);
    const admins = await ctx.db
      .query("users")
      .withIndex("by_role", (s) => s.eq("role", "admin"))
      .collect();
    const activeAdmins = admins.filter(
      (admin) => !isRetiredAdminEmail(admin.email),
    );
    return {
      signedIn: user !== null,
      isAdmin: canAdmin(user),
      // A retired mailbox that still carries the role is not an admin.
      roleIsStale: !!user && user.role === "admin" && isRetiredAdminEmail(user.email),
      adminEmail: ADMIN_EMAIL,
      isAdminEmail: !!user && isAdminEmail(user.email),
      adminExists: activeAdmins.length > 0,
      canClaim:
        !!user &&
        !isRetiredAdminEmail(user.email) &&
        isAdminEmail(user.email) &&
        user.role !== "admin" &&
        activeAdmins.length === 0,
      userId: user?._id ?? null,
    };
  },
});

/**
 * One-off admin handover, run with `bun convex run admin:enforceAdminEmail`.
 *
 * Admin authority is a single seat owned by `ADMIN_EMAIL`. This demotes every
 * other mailbox that still carries `role: "admin"` and grants the seat to the
 * administrative mailbox if that account already exists and is verified. Safe
 * to re-run.
 */
export const enforceAdminEmail = internalMutation({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();

    const revoked: string[] = [];
    for (const user of users) {
      if (user.role === "admin" && !isAdminEmail(user.email)) {
        await ctx.db.patch(user._id, { role: "user" });
        revoked.push(user.email ?? user._id);
      }
    }

    const owner = users.find((user) => isAdminEmail(user.email));
    let granted = false;
    let note: string;
    if (!owner) {
      note = `No account exists for ${ADMIN_EMAIL} yet. Register with that address, verify it, then run this again.`;
    } else if (owner.isAnonymous || !owner.emailVerificationTime) {
      note = `The ${ADMIN_EMAIL} account exists but is not email-verified yet.`;
    } else if (owner.role === "admin") {
      note = `${ADMIN_EMAIL} already holds admin access.`;
    } else {
      await ctx.db.patch(owner._id, { role: "admin" });
      granted = true;
      note = `${ADMIN_EMAIL} now holds admin access.`;
    }

    return { revoked, granted, note };
  },
});

type EventRow = Doc<"events">;

function bucketEvents(events: EventRow[], days: number) {
  const cutoff = Date.now() - days * DAY;
  const inWindow = events.filter((e) => e._creationTime >= cutoff);
  const counts: Record<string, number> = {};
  for (const event of inWindow) counts[event.type] = (counts[event.type] ?? 0) + 1;
  return { total: inWindow.length, byType: counts };
}

/** Admin-only marketplace metrics. */
export const stats = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const [activeProducts, draftProducts, removedProducts, users, orders, orderItems] =
      await Promise.all([
        ctx.db
          .query("products")
          .withIndex("by_status", (s) => s.eq("status", "active"))
          .collect(),
        ctx.db
          .query("products")
          .withIndex("by_status", (s) => s.eq("status", "draft"))
          .collect(),
        ctx.db
          .query("products")
          .withIndex("by_status", (s) => s.eq("status", "removed"))
          .collect(),
        ctx.db.query("users").collect(),
        ctx.db.query("orders").order("desc").take(1000),
        ctx.db.query("orderItems").order("desc").take(2000),
      ]);

    // Events from the last 90 days, paged until we pass the cutoff.
    const eventCutoff = Date.now() - 90 * DAY;
    const recentEvents: EventRow[] = [];
    let eventCursor: string | null = null;
    let eventsDone = false;
    while (!eventsDone && recentEvents.length < 10000) {
      const page = await ctx.db
        .query("events")
        .order("desc")
        .paginate({ cursor: eventCursor, numItems: 500 });
      recentEvents.push(...page.page);
      const oldest = page.page[page.page.length - 1];
      eventCursor = page.continueCursor;
      eventsDone =
        page.isDone || !oldest || oldest._creationTime < eventCutoff;
    }
    const lifetime: Record<string, number> = {};
    for (const event of recentEvents)
      lifetime[event.type] = (lifetime[event.type] ?? 0) + 1;

    const last7 = bucketEvents(recentEvents, 7);
    const last30 = bucketEvents(recentEvents, 30);

    const validOrders = orders.filter((o) => o.status !== "cancelled");
    const revenueCents = validOrders.reduce((sum, o) => sum + o.totalCents, 0);
    const orderStatusCounts: Record<string, number> = {};
    for (const order of orders)
      orderStatusCounts[order.status] = (orderStatusCounts[order.status] ?? 0) + 1;

    const dayMs = DAY;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const series: { label: string; events: number; checkouts: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const dayStart = start.getTime() - i * dayMs;
      const dayEnd = dayStart + dayMs;
      const inDay = recentEvents.filter(
        (e) => e._creationTime >= dayStart && e._creationTime < dayEnd,
      );
      series.push({
        label: new Date(dayStart).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        }),
        events: inDay.length,
        checkouts: inDay.filter((e) => e.type === "checkout_complete").length,
      });
    }

    const topProducts = [...activeProducts]
      .sort((a, b) => b.views - a.views)
      .slice(0, 5)
      .map((p) => ({
        _id: p._id,
        title: p.title,
        views: p.views,
        soldCount: p.soldCount,
        priceCents: p.priceCents,
      }));

    const recentOrderRows = await Promise.all(
      orders.slice(0, 10).map(async (order) => {
        const buyer = await ctx.db.get(order.buyerId);
        return {
          _id: order._id,
          totalCents: order.totalCents,
          status: order.status,
          itemCount: order.items.length,
          createdAt: order._creationTime,
          buyerEmail: buyer?.email ?? "unknown",
        };
      }),
    );

    const recentEventsList = recentEvents.slice(0, 15).map((event) => ({
      _id: event._id,
      type: event.type,
      createdAt: event._creationTime,
      query: event.query,
    }));

    return {
      totals: {
        products: activeProducts.length + draftProducts.length + removedProducts.length,
        activeProducts: activeProducts.length,
        draftProducts: draftProducts.length,
        removedProducts: removedProducts.length,
        users: users.length,
        sellers: users.filter((u) => u.isSeller).length,
        verifiedUsers: users.filter((u) => !!u.emailVerificationTime).length,
        orders: orders.length,
        revenueCents,
        orderItems: orderItems.length,
        totalViews: activeProducts.reduce((sum, p) => sum + p.views, 0),
      },
      orderStatusCounts,
      lifetime,
      last7,
      last30,
      series,
      topProducts,
      recentOrders: recentOrderRows,
      recentEvents: recentEventsList,
    };
  },
});

export const listProducts = query({
  args: {
    status: v.optional(
      v.union(v.literal("active"), v.literal("draft"), v.literal("removed")),
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const limit = Math.min(args.limit ?? 50, 200);
    const base = args.status
      ? ctx.db
          .query("products")
          .withIndex("by_status", (s) => s.eq("status", args.status!))
      : ctx.db.query("products");
    const products = await base.order("desc").take(limit);
    return await Promise.all(
      products.map(async (product) => {
        const seller = await ctx.db.get(product.sellerId);
        return {
          ...product,
          sellerName: seller?.name ?? seller?.email ?? "Unknown",
          sellerEmail: seller?.email ?? null,
        };
      }),
    );
  },
});

export const setProductStatus = mutation({
  args: {
    productId: v.id("products"),
    status: v.union(
      v.literal("active"),
      v.literal("draft"),
      v.literal("removed"),
    ),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const product = await ctx.db.get(args.productId);
    if (!product) throw new Error("Listing not found.");
    await ctx.db.patch(args.productId, {
      status: args.status,
      moderatorNote: args.note?.trim().slice(0, 300) || undefined,
    });
    if (args.status === "active" && product.status !== "active") {
      await ctx.db.insert("events", {
        type: "listing_created",
        userId: admin._id,
        productId: args.productId,
      });
    }
    return true;
  },
});

export const listUsers = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const limit = Math.min(args.limit ?? 50, 200);
    const users = await ctx.db.query("users").order("desc").take(limit);
    return users.map((u) => ({
      _id: u._id,
      name: u.name ?? null,
      email: u.email ?? null,
      role: u.role ?? null,
      isSeller: !!u.isSeller,
      shopName: u.shopName ?? null,
      verified: !!u.emailVerificationTime && !u.isAnonymous,
      createdAt: u._creationTime,
    }));
  },
});

/** Curate featured listings: homepage picks + "featured first" sorting. */
export const setFeatured = mutation({
  args: { productId: v.id("products"), featured: v.boolean() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const product = await ctx.db.get(args.productId);
    if (!product) throw new Error("Listing not found.");
    if (args.featured && product.status !== "active")
      throw new Error("Only live listings can be featured.");
    await ctx.db.patch(args.productId, {
      featuredAt: args.featured ? Date.now() : undefined,
    });
    return true;
  },
});

/**
 * Seller acquisition funnel: who registered, who activated a shop with live
 * inventory, what they listed, and which sales actually completed. These are
 * counts from real records only — no estimates or seeded activity.
 */
export const recruitmentOverview = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const cutoff = Date.now() - 30 * DAY;
    const [users, products, orderItems, referrals, visits] = await Promise.all([
      ctx.db.query("users").collect(),
      ctx.db.query("products").collect(),
      ctx.db.query("orderItems").take(5000),
      ctx.db.query("referrals").collect(),
      ctx.db.query("referralVisits").take(5000),
    ]);

    const sellers = users.filter((user) => !!user.isSeller);
    const activeProducts = products.filter((p) => p.status === "active");
    const deliveredItems = orderItems.filter((item) => item.status === "delivered");
    const activeSellerIds = new Set(
      activeProducts.map((product) => product.sellerId),
    );
    const sellerIdsWithSales = new Set(
      deliveredItems.map((item) => item.sellerId),
    );
    const referredSellerIds = new Set(referrals.map((row) => row.inviteeId));

    const listingsBySeller = new Map<string, number>();
    for (const product of activeProducts) {
      listingsBySeller.set(
        product.sellerId,
        (listingsBySeller.get(product.sellerId) ?? 0) + 1,
      );
    }
    const salesBySeller = new Map<string, number>();
    for (const item of deliveredItems) {
      salesBySeller.set(
        item.sellerId,
        (salesBySeller.get(item.sellerId) ?? 0) + 1,
      );
    }

    const recentSellers = [...sellers]
      .sort((a, b) => b._creationTime - a._creationTime)
      .slice(0, 6)
      .map((seller) => ({
        _id: seller._id,
        shopName: seller.shopName ?? seller.name ?? "Unnamed shop",
        email: seller.email ?? null,
        sellerType: seller.sellerType ?? "individual",
        joinedAt: seller._creationTime,
        activeListings: listingsBySeller.get(seller._id) ?? 0,
        completedSales: salesBySeller.get(seller._id) ?? 0,
        referred: referredSellerIds.has(seller._id),
      }));

    const categoryCounts = new Map<string, number>();
    for (const product of activeProducts) {
      categoryCounts.set(
        product.categoryId,
        (categoryCounts.get(product.categoryId) ?? 0) + 1,
      );
    }
    const topCategories = [...categoryCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([categoryId, count]) => ({ categoryId, count }));

    return {
      registrations: sellers.length,
      newRegistrations30Days: sellers.filter(
        (seller) => seller._creationTime >= cutoff,
      ).length,
      individualSellers: sellers.filter(
        (seller) => (seller.sellerType ?? "individual") === "individual",
      ).length,
      businessSellers: sellers.filter(
        (seller) => seller.sellerType === "business",
      ).length,
      activeSellers: activeSellerIds.size,
      sellersWithSales: sellerIdsWithSales.size,
      totalListings: products.length,
      activeListings: activeProducts.length,
      listings30Days: products.filter(
        (product) => product._creationTime >= cutoff,
      ).length,
      completedSales: deliveredItems.length,
      completedSales30Days: deliveredItems.filter(
        (item) => item._creationTime >= cutoff,
      ).length,
      referralVisits: visits.length,
      referralShopSetups: referrals.length,
      activeReferredSellers: referrals.filter((row) =>
        activeSellerIds.has(row.inviteeId),
      ).length,
      topCategories,
      recentSellers,
    };
  },
});

/** Referral program overview for the admin dashboard. */
export const referralOverview = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const rows = await ctx.db.query("referrals").collect();
    const counts = new Map<string, number>();
    for (const row of rows) {
      counts.set(row.inviterId, (counts.get(row.inviterId) ?? 0) + 1);
    }
    const topInviters = await Promise.all(
      [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(async ([sellerId, count]) => {
          const seller = await ctx.db.get(sellerId as Id<"users">);
          return {
            sellerId,
            name: seller?.shopName ?? seller?.name ?? "Seller",
            email: seller?.email ?? null,
            count,
          };
        }),
    );
    return {
      total: rows.length,
      inviters: counts.size,
      last30Days: rows.filter(
        (row) => row._creationTime >= Date.now() - 30 * DAY,
      ).length,
      topInviters,
    };
  },
});

export const setUserRole = mutation({
  args: {
    userId: v.id("users"),
    role: v.union(v.literal("admin"), v.literal("user"), v.literal("member")),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    if (admin._id === args.userId && args.role !== "admin")
      throw new Error("You cannot remove your own admin access.");
    const target = await ctx.db.get(args.userId);
    if (!target) throw new Error("User not found.");
    await ctx.db.patch(args.userId, { role: args.role });
    return true;
  },
});
