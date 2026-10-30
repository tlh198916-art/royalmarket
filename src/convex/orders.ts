import { v } from "convex/values";
import type { OrderStatus } from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import { isMarketplaceAdmin, requireUser, requireVerifiedUser } from "./lib";
import { accrueCommission, reverseCommission } from "./commissions";
import { cardsConfigured } from "./stripeConfig";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";

const methodArg = v.union(
  v.literal("meetup"),
  v.literal("shipping"),
  v.literal("delivery"),
);

/**
 * The fee a seller has configured for one fulfillment method on a product.
 * Pickup is always free; shipping/delivery fees are seller-set.
 */
function feeForMethod(
  product: Doc<"products">,
  method: "meetup" | "shipping" | "delivery",
): number {
  const f = product.fulfillment;
  if (!f) return 0; // legacy listings: negotiated directly, no preset fee
  if (method === "meetup") return f.pickup.enabled ? 0 : -1;
  if (method === "shipping")
    return f.shipping.enabled ? Math.round(f.shipping.feeCents) : -1;
  return f.delivery.enabled ? Math.round(f.delivery.feeCents) : -1;
}

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
    // Per-seller arrangement: each seller's items ship/pick up/deliver as a
    // group with one seller-set fee (never charged twice).
    fulfillments: v.array(
      v.object({
        sellerId: v.id("users"),
        method: methodArg,
        note: v.optional(v.string()),
      }),
    ),
    paymentMethod: v.union(v.literal("cod"), v.literal("card")),
  },
  handler: async (ctx, args) => {
    const buyer = await requireVerifiedUser(ctx);
    if (args.items.length === 0)
      throw new Error("Your cart is empty.");
    if (args.items.length > 30)
      throw new Error("An order can contain at most 30 line items.");
    // Card checkout requires the full Stripe test/production configuration:
    // without a verified webhook, a payment could never be safely confirmed.
    if (args.paymentMethod !== "cod" && !cardsConfigured()) {
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
      const quantity = item.quantity;
      if (!Number.isInteger(quantity) || quantity < 1)
        throw new Error("Cart quantities must be whole numbers of at least 1.");
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

    // Per-seller fulfillment: validate the chosen method against each
    // product's settings and charge that seller's fee once per order group
    // (the max fee among the buyer's lines from that seller — never per item).
    const sellerIds = [...new Set(lines.map((l) => l.product.sellerId))];
    const fulfillmentSellerIds = new Set(args.fulfillments.map((f) => f.sellerId));
    if (
      fulfillmentSellerIds.size !== args.fulfillments.length ||
      fulfillmentSellerIds.size !== sellerIds.length ||
      sellerIds.some((sellerId) => !fulfillmentSellerIds.has(sellerId))
    ) {
      throw new Error(
        "Choose exactly one fulfillment option for every seller in your cart.",
      );
    }
    let shippingFeeCents = 0;
    const fulfillmentEntries: {
      sellerId: Id<"users">;
      method: "meetup" | "shipping" | "delivery";
      note?: string;
      buyerAgreed: boolean;
      sellerAgreed: boolean;
      feeCents: number;
    }[] = [];

    for (const choice of args.fulfillments) {
      if (!sellerIds.includes(choice.sellerId))
        throw new Error("That seller is not part of this order.");
      const sellerLines = lines.filter(
        (l) => l.product.sellerId === choice.sellerId,
      );
      let groupFee = 0;
      for (const line of sellerLines) {
        const fee = feeForMethod(line.product, choice.method);
        if (fee < 0) {
          const seller = await ctx.db.get(choice.sellerId);
          throw new Error(
            `${seller?.shopName ?? "This seller"} doesn't offer ${
              choice.method === "meetup"
                ? "local pickup"
                : choice.method === "shipping"
                  ? "shipping"
                  : "local delivery"
            } for "${line.product.title}".`,
          );
        }
        groupFee = Math.max(groupFee, fee);
      }
      shippingFeeCents += groupFee;
      fulfillmentEntries.push({
        sellerId: choice.sellerId,
        method: choice.method,
        note: choice.note?.trim().slice(0, 500) || undefined,
        // The buyer's checkout choice counts as their approval of the deal;
        // each seller still has to approve (or propose a change) their side.
        buyerAgreed: true,
        sellerAgreed: false,
        feeCents: groupFee,
      });
    }

    // Seller-set fees are the only addition to the merchandise subtotal —
    // charged exactly once per seller group. No platform shipping fee exists.
    const totalCents = subtotalCents + shippingFeeCents;
    const now = Date.now();

    // Decrement stock only after all checks pass.
    for (const line of lines) {
      await ctx.db.patch(line.productId, {
        quantity: line.product.quantity - line.quantity,
        soldCount: line.product.soldCount + line.quantity,
      });
    }

    const orderId = await ctx.db.insert("orders", {
      buyerId: buyer._id,
      items,
      subtotalCents,
      totalCents,
      status: "placed",
      paymentMethod: args.paymentMethod,
      paymentStatus: args.paymentMethod === "card" ? "unpaid" : undefined,
      fulfillments: fulfillmentEntries,
      shippingFeeCents,
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
        paymentStatus: "unpaid",
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
        paymentMethod: order.paymentMethod,
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
    if (item.sellerId !== user._id && !isMarketplaceAdmin(user))
      throw new Error("You can only update orders for your own listings.");

    // Both parties must approve the fulfillment deal before dispatch.
    if (item.status === "placed" && args.status === "shipped") {
      const order = await ctx.db.get(item.orderId);
      const entry = order?.fulfillments?.find(
        (f) => f.sellerId === item.sellerId,
      );
      if (!entry || !entry.buyerAgreed || !entry.sellerAgreed) {
        throw new Error(
          "Both buyer and seller must approve the fulfillment arrangement before dispatch.",
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

    // Accrue platform commission for business sellers once an item is
    // delivered (payment happens on delivery). Idempotent per order item, and
    // never for a line that was already refunded (e.g. a card refund issued
    // before the seller marked it delivered).
    if (args.status === "delivered" && item.paymentStatus !== "refunded") {
      const order = await ctx.db.get(item.orderId);
      const fee = order?.fulfillments?.find(
        (f) => f.sellerId === item.sellerId,
      )?.feeCents;
      await accrueCommission(ctx, {
        orderId: item.orderId,
        orderItemId: item._id,
        sellerId: item.sellerId,
        merchandiseCents: item.priceCents * item.quantity,
        shippingCents: fee ?? 0,
      });
    }
    // Refund/cancellation safety: a pending commission never survives a
    // cancelled item.
    if (args.status === "cancelled") {
      await reverseCommission(ctx, item._id, "Order item cancelled.");
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
    if (order.paymentStatus === "paid")
      throw new Error(
        "This order was already paid by card. Contact support for a refund instead of cancelling.",
      );

    const items = await ctx.db
      .query("orderItems")
      .withIndex("by_order", (s) => s.eq("orderId", args.orderId))
      .collect();

    for (const item of items) {
      if (item.status !== "placed") continue;
      await ctx.db.patch(item._id, { status: "cancelled" });
      // Commission safety net — a cancelled item never keeps a pending row.
      await reverseCommission(ctx, item._id, "Order cancelled by buyer.");
      const product = await ctx.db.get(item.productId);
      if (product) {
        await ctx.db.patch(item.productId, {
          quantity: product.quantity + item.quantity,
          soldCount: Math.max(0, product.soldCount - item.quantity),
        });
      }
    }

    // Cancelled orders owe no fulfillment fees.
    await ctx.db.patch(args.orderId, {
      status: "cancelled",
      shippingFeeCents: 0,
      totalCents: order.subtotalCents,
    });
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
    method: methodArg,
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
    const sellerItems = orderItems.filter(
      (i) => i.sellerId === args.sellerId,
    );
    if (sellerItems.length === 0)
      throw new Error("That seller is not part of this order.");

    // Recompute this seller's fee from their current product settings so a
    // method change can't strand a stale charge (or add a new one silently).
    let feeCents = 0;
    for (const item of sellerItems) {
      const product = await ctx.db.get(item.productId);
      if (!product) continue;
      const fee = feeForMethod(product, args.method);
      if (fee < 0)
        throw new Error(
          `This seller no longer offers that fulfillment option for "${product.title}".`,
        );
      feeCents = Math.max(feeCents, fee);
    }

    const note = args.note?.trim().slice(0, 500) || undefined;
    const fulfillments = [...(order.fulfillments ?? [])];
    const index = fulfillments.findIndex((f) => f.sellerId === args.sellerId);
    const prior = index === -1 ? undefined : fulfillments[index];
    const entry = {
      sellerId: args.sellerId,
      method: args.method,
      note,
      // The editor's own approval stands; the other party re-approves —
      // important when the fee changes with the method.
      buyerAgreed: isBuyer,
      sellerAgreed: isSeller,
      feeCents,
      trackingNumber: prior?.trackingNumber,
    };
    if (index === -1) fulfillments.push(entry);
    else fulfillments[index] = entry;

    // Keep the order total in sync with the recomputed fees — one fee per
    // seller group, never duplicated.
    const shippingFeeCents = fulfillments.reduce(
      (sum, f) => sum + (f.feeCents ?? 0),
      0,
    );
    await ctx.db.patch(args.orderId, {
      fulfillments,
      shippingFeeCents,
      totalCents: order.subtotalCents + shippingFeeCents,
    });
    return true;
  },
});

/** Seller adds or updates a tracking number for their side of an order. */
export const setTracking = mutation({
  args: {
    orderId: v.id("orders"),
    trackingNumber: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireVerifiedUser(ctx);
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found.");
    const fulfillments = order.fulfillments ?? [];
    const index = fulfillments.findIndex((f) => f.sellerId === user._id);
    if (index === -1)
      throw new Error("No fulfillment arrangement on this order yet.");
    if (fulfillments[index].method !== "shipping")
      throw new Error("Tracking numbers apply to shipped orders only.");
    if (order.status === "cancelled")
      throw new Error("This order is cancelled.");

    const trackingNumber = args.trackingNumber.trim().slice(0, 80);
    const next = [...fulfillments];
    next[index] = {
      ...next[index],
      trackingNumber: trackingNumber || undefined,
    };
    await ctx.db.patch(args.orderId, { fulfillments: next });
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

/**
 * True when the viewer is allowed into this order's conversation: the buyer,
 * any seller with an item in the order, or a marketplace admin.
 */
async function orderViewer(
  ctx: QueryCtx,
  orderId: Id<"orders">,
): Promise<{ user: Doc<"users">; order: Doc<"orders">; isBuyer: boolean; isSeller: boolean } | null> {
  const user = await requireUser(ctx).catch(() => null);
  if (!user) return null;
  const order = await ctx.db.get(orderId);
  if (!order) return null;
  const items = await ctx.db
    .query("orderItems")
    .withIndex("by_order", (s) => s.eq("orderId", orderId))
    .collect();
  const isBuyer = order.buyerId === user._id;
  const isSeller = items.some((item) => item.sellerId === user._id);
  if (!isBuyer && !isSeller && !isMarketplaceAdmin(user)) return null;
  return { user, order, isBuyer, isSeller };
}

/** Buyer ↔ seller thread for one order. */
export const messages = query({
  args: { orderId: v.id("orders") },
  handler: async (ctx, args) => {
    const access = await orderViewer(ctx, args.orderId);
    if (!access) return null;
    const rows = await ctx.db
      .query("orderMessages")
      .withIndex("by_order", (s) => s.eq("orderId", args.orderId))
      .take(100);

    const participants = new Map<string, string>();
    const nameFor = async (id: Id<"users">) => {
      const cached = participants.get(id);
      if (cached) return cached;
      const user = await ctx.db.get(id);
      const name = user?.shopName ?? user?.name ?? "Member";
      participants.set(id, name);
      return name;
    };

    return {
      viewerRole: access.isBuyer ? ("buyer" as const) : ("seller" as const),
      messages: await Promise.all(
        rows.map(async (row) => ({
          _id: row._id,
          body: row.body,
          mine: row.senderId === access.user._id,
          senderName: await nameFor(row.senderId),
          createdAt: row._creationTime,
        })),
      ),
    };
  },
});

/** Post a message on an order. Same access rules as reading the thread. */
export const sendMessage = mutation({
  args: { orderId: v.id("orders"), body: v.string() },
  handler: async (ctx, args) => {
    const access = await orderViewer(ctx, args.orderId);
    if (!access) throw new Error("You cannot message on this order.");
    const body = args.body.trim();
    if (body.length < 1) throw new Error("Write a message first.");
    if (body.length > 1000)
      throw new Error("Messages must be 1000 characters or fewer.");
    const id = await ctx.db.insert("orderMessages", {
      orderId: args.orderId,
      senderId: access.user._id,
      body,
    });
    return id;
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
