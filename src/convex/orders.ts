import { v } from "convex/values";
import type { OrderStatus } from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import { requireUser, requireVerifiedUser } from "./lib";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";

/** Derive the order status from its line items. */
async function recomputeOrderStatus(
  ctx: MutationCtx,
  orderId: Id<"orders">,
): Promise<OrderStatus> {
  const items = await ctx.db
    .query("orderItems")
    .withIndex("by_order", (s) => s.eq("orderId", orderId))
    .collect();
  const order = await ctx.db.get(orderId);
  if (!order || items.length === 0) return order?.status ?? "placed";

  let next: OrderStatus;
  if (items.every((i) => i.status === "cancelled")) {
    next = "cancelled";
  } else if (items.every((i) => i.status === "delivered")) {
    next = "delivered";
  } else if (items.some((i) => i.status === "shipped" || i.status === "delivered")) {
    next = "shipped";
  } else {
    next = "placed";
  }

  await ctx.db.patch(orderId, {
    status: next,
    deliveredAt: next === "delivered" ? Date.now() : order.deliveredAt,
  });
  return next;
}

/**
 * Place an order. Validates live inventory, decrements stock, snapshots
 * prices, and records checkout + repeat-purchase analytics.
 */
export const place = mutation({
  args: {
    items: v.array(
      v.object({
        productId: v.id("products"),
        quantity: v.number(),
      }),
    ),
    method: v.union(v.literal("meetup"), v.literal("shipping")),
    note: v.optional(v.string()),
    paymentMethod: v.union(v.literal("cod"), v.literal("card")),
  },
  handler: async (ctx, args) => {
    const buyer = await requireVerifiedUser(ctx);
    if (args.items.length === 0)
      throw new Error("Your cart is empty.");
    if (args.items.length > 30)
      throw new Error("An order can contain at most 30 line items.");
    if (args.paymentMethod !== "cod") {
      throw new Error(
        "Card payments are not configured yet. Choose pay on delivery to complete your order.",
      );
    }

    // Validate every line against live inventory before touching anything.
    const lines: {
      product: Doc<"products">;
      productId: Id<"products">;
      quantity: number;
    }[] = [];
    for (const item of args.items) {
      const quantity = Math.floor(item.quantity);
      if (!Number.isFinite(quantity) || quantity < 1)
        throw new Error("Cart quantities must be at least 1.");
      const product = await ctx.db.get(item.productId);
      if (!product) throw new Error("A cart item no longer exists.");
      if (product.status !== "active")
        throw new Error(`"${product.title}" is no longer available.`);
      if (product.sellerId === buyer._id)
        throw new Error(`You cannot buy your own listing "${product.title}".`);
      if (product.quantity < quantity)
        throw new Error(
          `Only ${product.quantity} of "${product.title}" left in stock.`,
        );
      if (lines.some((l) => l.productId === item.productId))
        throw new Error("Duplicate cart items — update quantities instead.");
      lines.push({ product, productId: item.productId, quantity });
    }

    let subtotalCents = 0;
    const items: {
      productId: Id<"products">;
      sellerId: Id<"users">;
      title: string;
      priceCents: number;
      quantity: number;
    }[] = [];

    for (const line of lines) {
      subtotalCents += line.product.priceCents * line.quantity;
      items.push({
        productId: line.productId,
        sellerId: line.product.sellerId,
        title: line.product.title,
        priceCents: line.product.priceCents,
        quantity: line.quantity,
      });
    }
    // No platform shipping fees — buyers and sellers agree on shipping or a
    // meet-up directly, and both approve the arrangement before handoff.
    const totalCents = subtotalCents;
    const fulfillmentNote = args.note?.trim().slice(0, 500) || undefined;
    const sellerIds = [...new Set(lines.map((l) => l.product.sellerId))];

    // Decrement stock only after all checks pass.
    for (const line of lines) {
      await ctx.db.patch(line.productId, {
        quantity: line.product.quantity - line.quantity,
        soldCount: line.product.soldCount + line.quantity,
      });
    }

    const now = Date.now();
    const orderId = await ctx.db.insert("orders", {
      buyerId: buyer._id,
      items,
      subtotalCents,
      totalCents,
      status: "placed",
      paymentMethod: "cod",
      // The buyer's checkout choice counts as their approval of the deal;
      // each seller still has to approve (or propose a change) their side.
      fulfillments: sellerIds.map((sellerId) => ({
        sellerId,
        method: args.method,
        note: fulfillmentNote,
        buyerAgreed: true,
        sellerAgreed: false,
      })),
      placedAt: now,
    });

    for (const line of lines) {
      await ctx.db.insert("orderItems", {
        orderId,
        buyerId: buyer._id,
        sellerId: line.product.sellerId,
        productId: line.productId,
        title: line.product.title,
        priceCents: line.product.priceCents,
        quantity: line.quantity,
        status: "placed",
      });
    }

    await ctx.db.insert("events", {
      type: "checkout_complete",
      userId: buyer._id,
      productId: items[0]?.productId,
    });

    const priorOrders = await ctx.db
      .query("orders")
      .withIndex("by_buyer", (s) => s.eq("buyerId", buyer._id))
      .order("desc")
      .take(2);
    if (priorOrders.some((o) => o._id !== orderId)) {
      await ctx.db.insert("events", {
        type: "repeat_purchase",
        userId: buyer._id,
      });
    }

    return orderId;
  },
});

/** Buyer order history with line items. */
export const myOrders = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx).catch(() => null);
    if (!user) return [];
    const orders = await ctx.db
      .query("orders")
      .withIndex("by_buyer", (s) => s.eq("buyerId", user._id))
      .order("desc")
      .take(100);
    const items = await ctx.db
      .query("orderItems")
      .withIndex("by_buyer", (s) => s.eq("buyerId", user._id))
      .take(300);
    const sellerIds = [...new Set(items.map((i) => i.sellerId))];
    const sellers = await Promise.all(sellerIds.map((id) => ctx.db.get(id)));
    const sellerNames: Record<string, string> = {};
    for (const seller of sellers) {
      if (seller) {
        sellerNames[seller._id] = seller.shopName ?? seller.name ?? "Seller";
      }
    }
    return orders.map((order) => ({
      ...order,
      items: items.filter((i) => i.orderId === order._id),
      sellerNames,
    }));
  },
});

/** Seller view: line items to fulfil, with buyer + shipping details. */
export const sellerOrders = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx).catch(() => null);
    if (!user) return [];
    const items = await ctx.db
      .query("orderItems")
      .withIndex("by_seller", (s) => s.eq("sellerId", user._id))
      .order("desc")
      .take(200);

    const orderIds = [...new Set(items.map((i) => i.orderId))];
    const orders = (
      await Promise.all(orderIds.map((id) => ctx.db.get(id)))
    ).filter((o): o is Doc<"orders"> => o !== null);
    const buyerIds = [...new Set(orders.map((o) => o.buyerId))];
    const buyers = await Promise.all(buyerIds.map((id) => ctx.db.get(id)));
    const buyerName = new Map(
      buyers
        .filter((b): b is Doc<"users"> => b !== null)
        .map((b) => [b._id, b.name ?? b.email ?? "Buyer"]),
    );

    const grouped = orders
      .sort((a, b) => b._creationTime - a._creationTime)
      .map((order) => ({
        _id: order._id,
        status: order.status,
        totalCents: order.totalCents,
        createdAt: order._creationTime,
        buyerName: buyerName.get(order.buyerId) ?? "Buyer",
        fulfillments: order.fulfillments,
        items: items.filter(
          (i) =>
            i.orderId === order._id && i.sellerId === user._id,
        ),
      }))
      .filter((g) => g.items.length > 0);

    return grouped;
  },
});

/** Seller or admin updates a line item's fulfilment status. */
export const updateItemStatus = mutation({
  args: {
    itemId: v.id("orderItems"),
    status: v.union(
      v.literal("shipped"),
      v.literal("delivered"),
      v.literal("cancelled"),
    ),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new Error("That order item no longer exists.");
    if (item.sellerId !== user._id && user.role !== "admin")
      throw new Error("You can only update orders for your own listings.");

    // Both parties must approve the fulfillment deal (shipping or meet-up)
    // before the seller can dispatch.
    if (item.status === "placed" && args.status === "shipped") {
      const order = await ctx.db.get(item.orderId);
      const entry = order?.fulfillments?.find(
        (f) => f.sellerId === item.sellerId,
      );
      if (!entry || !entry.buyerAgreed || !entry.sellerAgreed) {
        throw new Error(
          "Both buyer and seller must approve the fulfillment arrangement (shipping or meet-up) before dispatch.",
        );
      }
    }

    const allowed: Record<string, OrderStatus[]> = {
      placed: ["shipped", "cancelled"],
      shipped: ["delivered", "cancelled"],
      delivered: [],
      cancelled: [],
    };
    if (!allowed[item.status]?.includes(args.status)) {
      throw new Error(
        `Cannot move this item from "${item.status}" to "${args.status}".`,
      );
    }

    await ctx.db.patch(args.itemId, { status: args.status });

    if (args.status === "cancelled" && item.status === "placed") {
      const product = await ctx.db.get(item.productId);
      if (product) {
        await ctx.db.patch(item.productId, {
          quantity: product.quantity + item.quantity,
          soldCount: Math.max(0, product.soldCount - item.quantity),
        });
      }
    }

    return await recomputeOrderStatus(ctx, item.orderId);
  },
});

/** Buyer cancels an order that no seller has started shipping. */
export const cancel = mutation({
  args: { orderId: v.id("orders") },
  handler: async (ctx, args) => {
    const user = await requireVerifiedUser(ctx);
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found.");
    if (order.buyerId !== user._id)
      throw new Error("You can only cancel your own orders.");
    if (order.status !== "placed")
      throw new Error("This order is already being fulfilled.");

    const items = await ctx.db
      .query("orderItems")
      .withIndex("by_order", (s) => s.eq("orderId", args.orderId))
      .collect();

    for (const item of items) {
      if (item.status !== "placed") continue;
      await ctx.db.patch(item._id, { status: "cancelled" });
      const product = await ctx.db.get(item.productId);
      if (product) {
        await ctx.db.patch(item.productId, {
          quantity: product.quantity + item.quantity,
          soldCount: Math.max(0, product.soldCount - item.quantity),
        });
      }
    }

    await ctx.db.patch(args.orderId, { status: "cancelled" });
    return true;
  },
});

/**
 * Buyer or seller proposes / updates the fulfillment deal for one seller on
 * an order (meet up, or shipping arranged directly). Editing resets the other
 * party's approval so both must approve the final terms.
 */
export const setFulfillment = mutation({
  args: {
    orderId: v.id("orders"),
    sellerId: v.id("users"),
    method: v.union(v.literal("meetup"), v.literal("shipping")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireVerifiedUser(ctx);
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found.");
    const isBuyer = order.buyerId === user._id;
    const isSeller = args.sellerId === user._id;
    if (!isBuyer && !isSeller)
      throw new Error("Only the buyer or seller can arrange fulfillment.");
    if (order.status !== "placed")
      throw new Error(
        "This order is already in progress — the arrangement is locked.",
      );
    const orderItems = await ctx.db
      .query("orderItems")
      .withIndex("by_order", (s) => s.eq("orderId", args.orderId))
      .collect();
    if (!orderItems.some((i) => i.sellerId === args.sellerId))
      throw new Error("That seller is not part of this order.");

    const note = args.note?.trim().slice(0, 500) || undefined;
    const fulfillments = [...(order.fulfillments ?? [])];
    const entry = {
      sellerId: args.sellerId,
      method: args.method,
      note,
      // The editor's own approval stands; the other party re-approves.
      buyerAgreed: isBuyer,
      sellerAgreed: isSeller,
    };
    const index = fulfillments.findIndex((f) => f.sellerId === args.sellerId);
    if (index === -1) fulfillments.push(entry);
    else fulfillments[index] = entry;
    await ctx.db.patch(args.orderId, { fulfillments });
    return true;
  },
});

/** Buyer or seller signs off on the other party's proposed arrangement. */
export const approveFulfillment = mutation({
  args: { orderId: v.id("orders"), sellerId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await requireVerifiedUser(ctx);
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found.");
    const isBuyer = order.buyerId === user._id;
    const isSeller = args.sellerId === user._id;
    if (!isBuyer && !isSeller)
      throw new Error("Only the buyer or seller can approve fulfillment.");
    if (order.status !== "placed")
      throw new Error(
        "This order is already in progress — the arrangement is locked.",
      );
    const fulfillments = [...(order.fulfillments ?? [])];
    const index = fulfillments.findIndex((f) => f.sellerId === args.sellerId);
    if (index === -1)
      throw new Error(
        "No arrangement yet — propose shipping or a meet-up first.",
      );
    const entry = { ...fulfillments[index] };
    if (isBuyer) entry.buyerAgreed = true;
    if (isSeller) entry.sellerAgreed = true;
    fulfillments[index] = entry;
    await ctx.db.patch(args.orderId, { fulfillments });
    return true;
  },
});

/** Whether the signed-in user has purchased this product (for review UI). */
export const purchasedByViewer = query({
  args: { productId: v.string() },
  handler: async (ctx: QueryCtx, args) => {
    const productId = ctx.db.normalizeId("products", args.productId);
    if (!productId) return false;
    const user = await requireUser(ctx).catch(() => null);
    if (!user) return false;
    const items = await ctx.db
      .query("orderItems")
      .withIndex("by_buyer", (s) => s.eq("buyerId", user._id))
      .take(300);
    return items.some(
      (i) => i.productId === productId && i.status !== "cancelled",
    );
  },
});
