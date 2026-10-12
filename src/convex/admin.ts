import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { requireAdmin, requireUser } from "./lib";
import { mutation, query } from "./_generated/server";

const DAY = 24 * 60 * 60 * 1000;

/** Admin bootstrap: first signed-in user can claim the only admin seat. */
export const claimAdmin = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    if (user.isAnonymous || !user.emailVerificationTime)
      throw new Error("Verify your email before claiming admin access.");
    if (user.role === "admin") return true;
    const existing = await ctx.db
      .query("users")
      .withIndex("by_role", (s) => s.eq("role", "admin"))
      .take(1);
    if (existing.length > 0)
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
      .take(1);
    return {
      signedIn: user !== null,
      isAdmin: user?.role === "admin",
      adminExists: admins.length > 0,
      canClaim: !!user && user.role !== "admin" && admins.length === 0,
      userId: user?._id ?? null,
    };
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
