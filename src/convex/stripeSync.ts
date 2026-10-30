import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
} from "./_generated/server";
import { requireAdmin, requireVerifiedUser } from "./lib";
import { reverseCommission } from "./commissions";
import { computeSellerTransfer } from "./stripeConfig";

/**
 * Server-side Stripe state machine.
 *
 * Every write here is driven by a verified Stripe webhook or by the result of
 * a Stripe API call in `stripe.ts`. Nothing in this file is callable from the
 * client directly (all functions are internal), and a payment/payout is only
 * ever marked successful from provider-confirmed data:
 * - `paymentSucceeded` requires the event to be signature-verified upstream and
 *   the amount/currency to match the order exactly.
 * - `transferConfirmed` requires Stripe to report the transfer exists and is
 *   not reversed.
 * - `refundSucceeded` requires a succeeded refund object from Stripe.
 */

type Source = "platform" | "connect";

/**
 * Insert the provider event id and report whether it is new. Called first in
 * the same transaction as the state change, so a retried webhook is a no-op and
 * a failed handler leaves no partial event row behind.
 */
async function recordEvent(
  ctx: MutationCtx,
  args: {
    eventId: string;
    type: string;
    source: Source;
    accountId?: string;
  },
): Promise<boolean> {
  const existing = await ctx.db
    .query("stripeWebhookEvents")
    .withIndex("by_eventId", (s) => s.eq("eventId", args.eventId))
    .first();
  if (existing) return false;
  await ctx.db.insert("stripeWebhookEvents", {
    eventId: args.eventId,
    type: args.type,
    source: args.source,
    accountId: args.accountId,
    receivedAt: Date.now(),
  });
  return true;
}

/* -------------------------------------------------------------------------- */
/* Card payment                                                               */
/* -------------------------------------------------------------------------- */

/** Buyer/order details the Node action needs before creating a PaymentIntent. */
export const paymentContext = internalQuery({
  args: { orderId: v.string() },
  handler: async (ctx, args) => {
    const user = await requireVerifiedUser(ctx);
    const orderId = ctx.db.normalizeId("orders", args.orderId);
    if (!orderId) throw new Error("Order not found.");
    const order = await ctx.db.get(orderId);
    if (!order) throw new Error("Order not found.");
    if (order.buyerId !== user._id)
      throw new Error("You can only pay for your own orders.");
    if (order.paymentMethod !== "card")
      throw new Error("This order is set to pay on delivery.");
    if (order.paymentStatus === "paid")
      throw new Error("This order is already paid.");
    if (order.paymentStatus === "refunded")
      throw new Error("This order was refunded.");
    if (order.totalCents <= 0) throw new Error("This order has no amount due.");

    return {
      orderId: order._id,
      amountCents: order.totalCents,
      currency: "usd" as const,
      email: user.email ?? null,
      description: `RoyalMarket order ${order._id.slice(-8)} · ${order.items.length} item${
        order.items.length === 1 ? "" : "s"
      }`,
      existingPaymentIntentId: order.stripePaymentIntentId ?? null,
      attempts: order.paymentAttempts ?? 0,
    };
  },
});

/** Store the PaymentIntent created by the Node action (idempotent retry). */
export const attachPaymentIntent = internalMutation({
  args: {
    orderId: v.string(),
    paymentIntentId: v.string(),
    attempt: v.number(),
  },
  handler: async (ctx, args) => {
    const orderId = ctx.db.normalizeId("orders", args.orderId);
    if (!orderId) throw new Error("Order not found.");
    const order = await ctx.db.get(orderId);
    if (!order) throw new Error("Order not found.");
    if (order.paymentStatus === "paid") return false;
    await ctx.db.patch(order._id, {
      stripePaymentIntentId: args.paymentIntentId,
      paymentStatus: "processing",
      paymentAttempts: Math.max(order.paymentAttempts ?? 0, args.attempt),
    });
    return true;
  },
});

/**
 * Apply `payment_intent.succeeded`. Amount and currency are checked against the
 * stored order total; a mismatch throws, so the webhook fails and Stripe
 * retries instead of the app marking a wrong amount as paid.
 */
export const paymentSucceeded = internalMutation({
  args: {
    eventId: v.string(),
    orderId: v.string(),
    paymentIntentId: v.string(),
    chargeId: v.optional(v.string()),
    amountCents: v.number(),
    currency: v.string(),
    cardBrand: v.optional(v.string()),
    cardLast4: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const fresh = await recordEvent(ctx, {
      eventId: args.eventId,
      type: "payment_intent.succeeded",
      source: "platform",
    });
    if (!fresh) return { applied: false, reason: "duplicate" as const };

    const orderId = ctx.db.normalizeId("orders", args.orderId);
    if (!orderId) throw new Error("Webhook references an unknown order.");
    const order = await ctx.db.get(orderId);
    if (!order) throw new Error("Webhook references an unknown order.");
    if (order.paymentMethod !== "card")
      throw new Error("Card payment received for a cash order.");
    if (args.currency !== "usd")
      throw new Error(`Unexpected payment currency: ${args.currency}.`);
    if (args.amountCents !== order.totalCents)
      throw new Error(
        `Payment amount ${args.amountCents}¢ does not match order total ${order.totalCents}¢.`,
      );
    if (order.paymentStatus === "paid")
      return { applied: false, reason: "already_paid" as const };

    const now = Date.now();
    await ctx.db.patch(order._id, {
      paymentStatus: "paid",
      stripePaymentIntentId: args.paymentIntentId,
      stripeChargeId: args.chargeId ?? order.stripeChargeId,
      cardBrand: args.cardBrand ?? order.cardBrand,
      cardLast4: args.cardLast4 ?? order.cardLast4,
      paidAt: now,
      paymentFailureMessage: undefined,
    });

    const items = await ctx.db
      .query("orderItems")
      .withIndex("by_order", (s) => s.eq("orderId", order._id))
      .collect();
    let paidItems = 0;
    for (const item of items) {
      if ((item.paymentStatus ?? "unpaid") === "refunded") continue;
      await ctx.db.patch(item._id, {
        paymentStatus: "paid",
        paidAt: now,
        paymentReference: `Stripe ${args.paymentIntentId}`,
      });
      paidItems += 1;
    }
    return { applied: true, paidItems };
  },
});

/** Apply `payment_intent.payment_failed` / `canceled`. Never touches a paid order. */
export const paymentFailed = internalMutation({
  args: {
    eventId: v.string(),
    orderId: v.string(),
    paymentIntentId: v.optional(v.string()),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const fresh = await recordEvent(ctx, {
      eventId: args.eventId,
      type: "payment_intent.failed",
      source: "platform",
    });
    if (!fresh) return { applied: false, reason: "duplicate" as const };

    const orderId = ctx.db.normalizeId("orders", args.orderId);
    if (!orderId) return { applied: false, reason: "unknown_order" as const };
    const order = await ctx.db.get(orderId);
    if (!order) return { applied: false, reason: "unknown_order" as const };
    if (order.paymentStatus === "paid")
      return { applied: false, reason: "already_paid" as const };

    await ctx.db.patch(order._id, {
      paymentStatus: "failed",
      paymentFailureMessage:
        args.message?.slice(0, 200) ?? "Card payment was not completed.",
      stripePaymentIntentId:
        args.paymentIntentId ?? order.stripePaymentIntentId,
    });
    const items = await ctx.db
      .query("orderItems")
      .withIndex("by_order", (s) => s.eq("orderId", order._id))
      .collect();
    for (const item of items) {
      const status = item.paymentStatus ?? "unpaid";
      if (status === "unpaid" || status === "failed") {
        await ctx.db.patch(item._id, { paymentStatus: "failed" });
      }
    }
    return { applied: true };
  },
});

/* -------------------------------------------------------------------------- */
/* Connect accounts                                                           */
/* -------------------------------------------------------------------------- */

/** Seller details for Express account creation / onboarding links. */
export const connectContext = internalQuery({
  args: {},
  handler: async (ctx) => {
    const user = await requireVerifiedUser(ctx);
    if (!user.isSeller)
      throw new Error("Only sellers can connect a payout account.");
    const account = await ctx.db
      .query("sellerPaymentAccounts")
      .withIndex("by_seller", (s) => s.eq("sellerId", user._id))
      .first();
    return {
      sellerId: user._id,
      sellerType: user.sellerType ?? "individual",
      email: user.email ?? null,
      name: user.shopName ?? user.name ?? null,
      accountId: account?.accountId ?? null,
      onboardingStatus: account?.onboardingStatus ?? ("not_connected" as const),
      detailsSubmitted: account?.detailsSubmitted ?? false,
    };
  },
});

/** Persist the Stripe account id created by the Node action. */
export const saveConnectAccount = internalMutation({
  args: { sellerId: v.id("users"), accountId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("sellerPaymentAccounts")
      .withIndex("by_seller", (s) => s.eq("sellerId", args.sellerId))
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        accountId: args.accountId,
        updatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("sellerPaymentAccounts", {
      sellerId: args.sellerId,
      provider: "stripe",
      accountId: args.accountId,
      onboardingStatus: "pending",
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      updatedAt: now,
    });
  },
});

/**
 * Apply `account.updated` (or a retrieved account) to the seller row. Unknown
 * accounts are ignored: the app only tracks accounts it created.
 */
export const accountUpdated = internalMutation({
  args: {
    eventId: v.string(),
    source: v.union(v.literal("platform"), v.literal("connect")),
    accountId: v.string(),
    chargesEnabled: v.boolean(),
    payoutsEnabled: v.boolean(),
    detailsSubmitted: v.boolean(),
    currentlyDue: v.array(v.string()),
    disabledReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const fresh = await recordEvent(ctx, {
      eventId: args.eventId,
      type: "account.updated",
      source: args.source,
      accountId: args.accountId,
    });
    if (!fresh) return { applied: false, reason: "duplicate" as const };

    const account = await ctx.db
      .query("sellerPaymentAccounts")
      .withIndex("by_account", (s) => s.eq("accountId", args.accountId))
      .first();
    if (!account) return { applied: false, reason: "unknown_account" as const };

    const status =
      args.chargesEnabled && args.payoutsEnabled
        ? ("enabled" as const)
        : args.detailsSubmitted
          ? ("restricted" as const)
          : ("pending" as const);
    const now = Date.now();
    await ctx.db.patch(account._id, {
      onboardingStatus: status,
      chargesEnabled: args.chargesEnabled,
      payoutsEnabled: args.payoutsEnabled,
      detailsSubmitted: args.detailsSubmitted,
      requirementsCurrentlyDue: args.currentlyDue.slice(0, 20),
      disabledReason: args.disabledReason?.slice(0, 300),
      lastSyncedAt: now,
      updatedAt: now,
    });
    return { applied: true, status };
  },
});

/* -------------------------------------------------------------------------- */
/* Transfers                                                                  */
/* -------------------------------------------------------------------------- */

export type SellerTransferPlan = {
  sellerId: Id<"users">;
  sellerName: string;
  accountId: string | null;
  payoutsEnabled: boolean;
  grossCents: number;
  feeCents: number;
  commissionCents: number;
  amountCents: number;
  itemIds: Id<"orderItems">[];
  eligible: boolean;
  reason: string | null;
};

/**
 * Admin-only transfer plan for one paid card order. Only delivered, paid lines
 * that have not been transferred yet are included; commission comes from the
 * existing ledger rows (existing commission rules), never a client value.
 */
export const transferContext = internalQuery({
  args: { orderId: v.string() },
  handler: async (ctx, args): Promise<{
    orderId: Id<"orders">;
    chargeId: string | null;
    sellers: SellerTransferPlan[];
  }> => {
    await requireAdmin(ctx);
    const orderId = ctx.db.normalizeId("orders", args.orderId);
    if (!orderId) throw new Error("Order not found.");
    const order = await ctx.db.get(orderId);
    if (!order) throw new Error("Order not found.");
    if (order.paymentMethod !== "card")
      throw new Error("Cash orders are settled directly with the seller.");
    if (
      order.paymentStatus !== "paid" &&
      order.paymentStatus !== "partially_refunded"
    )
      throw new Error("Stripe has not confirmed this order's payment yet.");

    const items = await ctx.db
      .query("orderItems")
      .withIndex("by_order", (s) => s.eq("orderId", order._id))
      .collect();

    const sellerIds = [...new Set(items.map((item) => item.sellerId))];
    const sellers: SellerTransferPlan[] = [];

    for (const sellerId of sellerIds) {
      const seller = await ctx.db.get(sellerId);
      const account = await ctx.db
        .query("sellerPaymentAccounts")
        .withIndex("by_seller", (s) => s.eq("sellerId", sellerId))
        .first();
      // The seller-set fee is charged once per seller per order, matching
      // checkout. If this seller already received a transfer for this order,
      // the fee was included then and must not be paid again.
      const priorTransfer = items.some(
        (item) => item.sellerId === sellerId && item.stripeTransferId,
      );
      const feeCents = priorTransfer
        ? 0
        : (order.fulfillments?.find((f) => f.sellerId === sellerId)
            ?.feeCents ?? 0);

      let grossCents = 0;
      let commissionCents = 0;
      let amountCents = 0;
      const itemIds: Id<"orderItems">[] = [];
      const eligibleLines: {
        priceCents: number;
        quantity: number;
        status: string;
        paymentStatus?: string;
        commissionCents: number;
      }[] = [];

      for (const item of items) {
        if (item.sellerId !== sellerId) continue;
        if (item.stripeTransferId) continue; // already paid out
        const ledger = await ctx.db
          .query("commissionLedger")
          .withIndex("by_orderItem", (s) => s.eq("orderItemId", item._id))
          .first();
        const commission =
          ledger && ledger.status !== "reversed" ? ledger.amountCents : 0;
        eligibleLines.push({
          priceCents: item.priceCents,
          quantity: item.quantity,
          status: item.status,
          paymentStatus: item.paymentStatus,
          commissionCents: commission,
        });
        grossCents +=
          item.status === "delivered" &&
          (item.paymentStatus ?? "unpaid") === "paid"
            ? item.priceCents * item.quantity
            : 0;
        commissionCents +=
          item.status === "delivered" &&
          (item.paymentStatus ?? "unpaid") === "paid"
            ? commission
            : 0;
        if (
          item.status === "delivered" &&
          (item.paymentStatus ?? "unpaid") === "paid"
        ) {
          itemIds.push(item._id);
        }
      }

      amountCents = computeSellerTransfer(eligibleLines, feeCents).netCents;

      let reason: string | null = null;
      if (itemIds.length === 0)
        reason = "No delivered, paid lines awaiting transfer.";
      else if (amountCents <= 0) reason = "Nothing left to transfer.";
      else if (!account?.accountId)
        reason = "Seller has not started Stripe onboarding.";
      else if (!account.payoutsEnabled)
        reason = "Stripe has not enabled payouts for this seller.";

      sellers.push({
        sellerId,
        sellerName: seller?.shopName ?? seller?.name ?? "Seller",
        accountId: account?.accountId ?? null,
        payoutsEnabled: account?.payoutsEnabled ?? false,
        grossCents,
        feeCents,
        commissionCents,
        amountCents,
        itemIds,
        eligible: reason === null,
        reason,
      });
    }

    return {
      orderId: order._id,
      chargeId: order.stripeChargeId ?? null,
      sellers,
    };
  },
});

/**
 * Record a Stripe transfer that was just created. The payout starts as
 * `in_transit`; only the `transfer.created` webhook promotes it to `paid`.
 */
export const recordTransfer = internalMutation({
  args: {
    orderId: v.string(),
    sellerId: v.id("users"),
    transferId: v.string(),
    amountCents: v.number(),
    itemIds: v.array(v.id("orderItems")),
  },
  handler: async (ctx, args) => {
    const orderId = ctx.db.normalizeId("orders", args.orderId);
    if (!orderId) throw new Error("Order not found.");
    const order = await ctx.db.get(orderId);
    if (!order) throw new Error("Order not found.");
    if (order.paymentMethod !== "card")
      throw new Error("Cash orders do not use Stripe transfers.");
    if (
      order.paymentStatus !== "paid" &&
      order.paymentStatus !== "partially_refunded"
    )
      throw new Error("Stripe has not confirmed this order's payment yet.");
    if (!Number.isInteger(args.amountCents) || args.amountCents <= 0)
      throw new Error("Invalid transfer amount.");

    const existingPayout = await ctx.db
      .query("payouts")
      .withIndex("by_transfer", (s) =>
        s.eq("providerTransferId", args.transferId),
      )
      .first();
    if (existingPayout) return { payoutId: existingPayout._id, duplicate: true };

    // Only record lines that were not already transferred, so a retried action
    // can never pay the same item twice.
    const itemIds: Id<"orderItems">[] = [];
    for (const itemId of args.itemIds) {
      const item = await ctx.db.get(itemId);
      if (!item || item.sellerId !== args.sellerId) continue;
      if (item.orderId !== order._id) continue;
      if (item.stripeTransferId) continue;
      itemIds.push(item._id);
    }
    if (itemIds.length === 0) {
      return { payoutId: null, duplicate: true };
    }

    const now = Date.now();
    const payoutId = await ctx.db.insert("payouts", {
      sellerId: args.sellerId,
      orderId: order._id,
      amountCents: args.amountCents,
      currency: "usd",
      provider: "stripe",
      status: "in_transit",
      providerTransferId: args.transferId,
      createdAt: now,
    });
    for (const itemId of itemIds) {
      await ctx.db.patch(itemId, { stripeTransferId: args.transferId });
    }
    return { payoutId, duplicate: false };
  },
});

/** Apply `transfer.created` / `transfer.updated` / `transfer.reversed`. */
export const transferConfirmed = internalMutation({
  args: {
    eventId: v.string(),
    type: v.string(),
    transferId: v.string(),
    amountCents: v.number(),
    currency: v.string(),
    reversed: v.boolean(),
  },
  handler: async (ctx, args) => {
    const fresh = await recordEvent(ctx, {
      eventId: args.eventId,
      type: args.type,
      source: "platform",
    });
    if (!fresh) return { applied: false, reason: "duplicate" as const };

    const payout = await ctx.db
      .query("payouts")
      .withIndex("by_transfer", (s) =>
        s.eq("providerTransferId", args.transferId),
      )
      .first();
    if (!payout) return { applied: false, reason: "unknown_transfer" as const };
    if (args.currency !== "usd")
      throw new Error(`Unexpected transfer currency: ${args.currency}.`);
    if (args.amountCents !== payout.amountCents)
      throw new Error(
        `Transfer amount ${args.amountCents}¢ does not match recorded payout ${payout.amountCents}¢.`,
      );

    const now = Date.now();
    await ctx.db.patch(payout._id, {
      status: args.reversed ? "reversed" : "paid",
      confirmedAt: args.reversed ? payout.confirmedAt : (payout.confirmedAt ?? now),
      note: args.reversed ? "Stripe reversed this transfer." : payout.note,
    });
    return { applied: true, status: args.reversed ? "reversed" : "paid" };
  },
});

/* -------------------------------------------------------------------------- */
/* Refunds                                                                    */
/* -------------------------------------------------------------------------- */

/** Admin-only refund context for one paid card line. */
export const refundContext = internalQuery({
  args: { itemId: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const itemId = ctx.db.normalizeId("orderItems", args.itemId);
    if (!itemId) throw new Error("Order item not found.");
    const item = await ctx.db.get(itemId);
    if (!item) throw new Error("Order item not found.");
    const order = await ctx.db.get(item.orderId);
    if (!order) throw new Error("Order not found.");
    if (order.paymentMethod !== "card")
      throw new Error("Cash refunds are handled directly with the seller.");
    if (item.paymentStatus !== "paid")
      throw new Error("Only a paid card item can be refunded.");
    if (!order.stripePaymentIntentId)
      throw new Error("This order has no Stripe payment to refund.");

    return {
      itemId: item._id,
      orderId: order._id,
      paymentIntentId: order.stripePaymentIntentId,
      amountCents: item.priceCents * item.quantity,
      title: item.title,
      transferred: !!item.stripeTransferId,
    };
  },
});

/** A refund was accepted by Stripe but has not settled yet. */
export const refundPending = internalMutation({
  args: {
    itemId: v.string(),
    refundId: v.string(),
  },
  handler: async (ctx, args) => {
    const itemId = ctx.db.normalizeId("orderItems", args.itemId);
    if (!itemId) return false;
    const item = await ctx.db.get(itemId);
    if (!item) return false;
    if (item.paymentStatus === "refunded") return false;
    await ctx.db.patch(item._id, {
      refundId: args.refundId,
      refundStatus: "pending",
    });
    return true;
  },
});

/**
 * Apply a Stripe-confirmed refund. Full refunds flip the line to refunded and
 * reverse the commission ledger row; partial refunds are recorded without
 * pretending the whole line was refunded.
 */
export const refundSucceeded = internalMutation({
  args: {
    itemId: v.string(),
    refundId: v.string(),
    amountCents: v.number(),
  },
  handler: async (ctx, args) => {
    const fresh = await recordEvent(ctx, {
      eventId: `refund:${args.refundId}`,
      type: "refund.succeeded",
      source: "platform",
    });
    if (!fresh) return { applied: false, reason: "duplicate" as const };

    const itemId = ctx.db.normalizeId("orderItems", args.itemId);
    if (!itemId) return { applied: false, reason: "unknown_item" as const };
    const item = await ctx.db.get(itemId);
    if (!item) return { applied: false, reason: "unknown_item" as const };
    if (item.paymentStatus === "refunded")
      return { applied: false, reason: "already_refunded" as const };
    if (item.paymentStatus !== "paid")
      throw new Error("Refund received for an item that is not paid.");

    const grossCents = item.priceCents * item.quantity;
    if (!Number.isInteger(args.amountCents) || args.amountCents <= 0)
      throw new Error("Invalid refund amount.");
    if (args.amountCents > grossCents)
      throw new Error("Refund amount exceeds the item total.");

    const now = Date.now();
    if (args.amountCents >= grossCents) {
      await ctx.db.patch(item._id, {
        paymentStatus: "refunded",
        refundStatus: "succeeded",
        refundId: args.refundId,
        refundedAt: now,
        refundedAmountCents: grossCents,
        refundNote: "Refunded through Stripe.",
      });
      await reverseCommission(ctx, item._id, "Stripe refund.");

      const siblings = await ctx.db
        .query("orderItems")
        .withIndex("by_order", (s) => s.eq("orderId", item.orderId))
        .collect();
      const allRefunded = siblings.every(
        (sibling) =>
          sibling._id === item._id || sibling.paymentStatus === "refunded",
      );
      const order = await ctx.db.get(item.orderId);
      if (order) {
        await ctx.db.patch(order._id, {
          paymentStatus: allRefunded ? "refunded" : "partially_refunded",
        });
      }
      return { applied: true, partial: false };
    }

    await ctx.db.patch(item._id, {
      refundStatus: "succeeded",
      refundId: args.refundId,
      refundedAmountCents:
        (item.refundedAmountCents ?? 0) + args.amountCents,
      refundNote: "Partial refund through Stripe.",
    });
    return { applied: true, partial: true };
  },
});

/** A refund attempt failed: the line stays paid and is not marked refunded. */
export const refundFailed = internalMutation({
  args: { itemId: v.string(), refundId: v.string() },
  handler: async (ctx, args) => {
    const itemId = ctx.db.normalizeId("orderItems", args.itemId);
    if (!itemId) return false;
    const item = await ctx.db.get(itemId);
    if (!item || item.paymentStatus === "refunded") return false;
    await ctx.db.patch(item._id, {
      refundId: args.refundId,
      refundStatus: "failed",
    });
    return true;
  },
});

/** Record a refund id on an item (used before Stripe settles it). */
export const attachRefund = internalMutation({
  args: { itemId: v.string(), refundId: v.string(), status: v.string() },
  handler: async (ctx, args) => {
    const itemId = ctx.db.normalizeId("orderItems", args.itemId);
    if (!itemId) return false;
    const item = await ctx.db.get(itemId);
    if (!item) return false;
    await ctx.db.patch(item._id, {
      refundId: args.refundId,
      refundStatus:
        args.status === "succeeded"
          ? "succeeded"
          : args.status === "failed"
            ? "failed"
            : "pending",
    });
    return true;
  },
});

/* -------------------------------------------------------------------------- */
/* Reconciliation                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Admin/support reconciliation snapshot: recent provider events, plus any
 * order whose Stripe state and local state disagree. Read-only.
 */
export const reconciliation = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const events = await ctx.db
      .query("stripeWebhookEvents")
      .order("desc")
      .take(50);
    const orders = await ctx.db.query("orders").order("desc").take(200);
    const issues: {
      orderId: Id<"orders"> | null;
      issue: string;
    }[] = [];
    for (const order of orders) {
      if (order.paymentMethod !== "card") continue;
      if (order.paymentStatus === "paid" && !order.stripeChargeId) {
        issues.push({
          orderId: order._id,
          issue: "Marked paid without a Stripe charge id.",
        });
      }
      if (order.paymentStatus === "unpaid" && order.stripePaymentIntentId) {
        issues.push({
          orderId: order._id,
          issue: "PaymentIntent created but payment never confirmed.",
        });
      }
    }
    const payouts = await ctx.db.query("payouts").order("desc").take(100);
    for (const payout of payouts) {
      if (
        payout.provider === "stripe" &&
        payout.status === "paid" &&
        !payout.providerTransferId
      ) {
        issues.push({
          orderId: payout.orderId ?? null,
          issue: "Payout marked paid without a Stripe transfer id.",
        });
      }
    }
    return {
      events: events.map((event) => ({
        eventId: event.eventId,
        type: event.type,
        source: event.source,
        accountId: event.accountId ?? null,
        receivedAt: event.receivedAt,
      })),
      issues,
    };
  },
});

/** Doc helper used by the action layer for typed reads. */
export type SellerAccountDoc = Doc<"sellerPaymentAccounts">;
