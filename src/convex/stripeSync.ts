import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
} from "./_generated/server";
import { requireAdmin, requireVerifiedUser } from "./lib";
import {
  adjustCommissionForRefund,
  reverseCommission,
} from "./commissions";
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
 * - `transferConfirmed` looks up the payout before recording its event, so an
 *   early webhook is retried rather than permanently acknowledged.
 * - `refundSucceeded` requires a succeeded refund object from Stripe and caps
 *   cumulative refunds at the captured order total.
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
    if (
      order.paymentStatus === "refunded" ||
      order.paymentStatus === "partially_refunded"
    )
      throw new Error("This order has a Stripe refund and cannot be charged again.");
    if (order.status === "cancelled")
      throw new Error("This order was cancelled and cannot be charged.");
    if (
      order.paymentLockedTotalCents !== undefined &&
      order.paymentLockedTotalCents !== order.totalCents
    )
      throw new Error("This order's total changed after payment started.");
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
    if (order.status === "cancelled")
      throw new Error("Cannot attach a payment to a cancelled order.");
    await ctx.db.patch(order._id, {
      stripePaymentIntentId: args.paymentIntentId,
      paymentStatus: "processing",
      paymentAttempts: Math.max(order.paymentAttempts ?? 0, args.attempt),
      paymentLockedAt: order.paymentLockedAt ?? Date.now(),
      paymentLockedTotalCents: order.totalCents,
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
    if (order.paymentStatus === "partially_refunded")
      return { applied: false, reason: "already_refunded" as const };
    if (order.status === "cancelled")
      return { applied: false, reason: "cancelled_order" as const };

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
      if (item.status === "cancelled") continue;
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

/** Buyer/order details needed to cancel a card PaymentIntent safely. */
export const cancelContext = internalQuery({
  args: { orderId: v.string() },
  handler: async (ctx, args) => {
    const user = await requireVerifiedUser(ctx);
    const orderId = ctx.db.normalizeId("orders", args.orderId);
    if (!orderId) throw new Error("Order not found.");
    const order = await ctx.db.get(orderId);
    if (!order) throw new Error("Order not found.");
    if (order.buyerId !== user._id)
      throw new Error("You can only cancel your own orders.");
    if (order.status !== "placed")
      throw new Error("This order is already being fulfilled.");
    if (
      order.paymentStatus === "paid" ||
      order.paymentStatus === "refunded" ||
      order.paymentStatus === "partially_refunded"
    )
      throw new Error("This order has a confirmed payment and cannot be cancelled.");
    return {
      orderId: order._id,
      buyerId: user._id,
      paymentIntentId: order.stripePaymentIntentId ?? null,
    };
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
    if (
      order.paymentStatus === "refunded" ||
      order.paymentStatus === "partially_refunded"
    )
      return { applied: false, reason: "already_refunded" as const };

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
      // the fee was included then and must not be paid again. Refunded fee
      // portions are never transferred.
      const priorTransfer = items.some(
        (item) => item.sellerId === sellerId && item.stripeTransferId,
      );
      const sellerFeeCents =
        order.fulfillments?.find((f) => f.sellerId === sellerId)?.feeCents ?? 0;
      const refundedFeeCents = items
        .filter((item) => item.sellerId === sellerId)
        .reduce((sum, item) => sum + (item.refundedFeeCents ?? 0), 0);
      const feeCents = priorTransfer
        ? 0
        : Math.max(0, sellerFeeCents - refundedFeeCents);

      const itemIds: Id<"orderItems">[] = [];
      const eligibleLines: {
        priceCents: number;
        quantity: number;
        status: string;
        paymentStatus?: string;
        refundedAmountCents?: number;
        refundedFeeCents?: number;
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
          refundedAmountCents: item.refundedAmountCents,
          refundedFeeCents: item.refundedFeeCents,
          commissionCents: commission,
        });
        const refundedMerchandiseCents = Math.max(
          0,
          (item.refundedAmountCents ?? 0) - (item.refundedFeeCents ?? 0),
        );
        if (
          item.status === "delivered" &&
          (item.paymentStatus ?? "unpaid") === "paid" &&
          item.priceCents * item.quantity - refundedMerchandiseCents > 0
        ) {
          itemIds.push(item._id);
        }
      }

      const transfer = computeSellerTransfer(eligibleLines, feeCents);
      const grossCents = transfer.grossCents;
      const commissionCents = transfer.commissionCents;
      const amountCents = transfer.netCents;

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
    let maximumCents = 0;
    for (const itemId of args.itemIds) {
      const item = await ctx.db.get(itemId);
      if (!item || item.sellerId !== args.sellerId) continue;
      if (item.orderId !== order._id) continue;
      if (item.stripeTransferId) continue;
      if (item.status !== "delivered") continue;
      if ((item.paymentStatus ?? "unpaid") !== "paid") continue;
      const refundedMerchandiseCents = Math.max(
        0,
        (item.refundedAmountCents ?? 0) - (item.refundedFeeCents ?? 0),
      );
      const remainingCents = Math.max(
        0,
        item.priceCents * item.quantity - refundedMerchandiseCents,
      );
      if (remainingCents === 0) continue;
      itemIds.push(item._id);
      maximumCents += remainingCents;
    }
    if (itemIds.length === 0) {
      return { payoutId: null, duplicate: true };
    }

    const allSellerItems = await ctx.db
      .query("orderItems")
      .withIndex("by_order", (s) => s.eq("orderId", order._id))
      .collect();
    const priorTransfer = allSellerItems.some(
      (item) =>
        item.sellerId === args.sellerId && item.stripeTransferId !== undefined,
    );
    if (!priorTransfer) {
      const sellerFeeCents =
        order.fulfillments?.find((f) => f.sellerId === args.sellerId)?.feeCents ??
        0;
      const refundedFeeCents = allSellerItems
        .filter((item) => item.sellerId === args.sellerId)
        .reduce((sum, item) => sum + (item.refundedFeeCents ?? 0), 0);
      maximumCents += Math.max(0, sellerFeeCents - refundedFeeCents);
    }
    if (args.amountCents > maximumCents) {
      throw new Error("Transfer amount exceeds the seller's refundable balance.");
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
    /** Stripe's cumulative `amount_reversed`; omitted by older senders. */
    reversedAmountCents: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Look up the payout BEFORE recording the event. An event that arrives
    // before recordTransfer must not leave an acknowledged event row behind,
    // otherwise the retry would be treated as a duplicate and silently lost.
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

    const fresh = await recordEvent(ctx, {
      eventId: args.eventId,
      type: args.type,
      source: "platform",
    });
    if (!fresh) return { applied: false, reason: "duplicate" as const };

    const reportedReversal = Math.max(
      0,
      Math.round(
        args.reversedAmountCents ?? (args.reversed ? args.amountCents : 0),
      ),
    );
    const reversedAmountCents = Math.min(
      payout.amountCents,
      Math.max(payout.reversedAmountCents ?? 0, reportedReversal),
    );
    const fullyReversed = reversedAmountCents >= payout.amountCents;
    const now = Date.now();

    await ctx.db.patch(payout._id, {
      status: fullyReversed ? "reversed" : "paid",
      reversedAmountCents,
      confirmedAt: payout.confirmedAt ?? now,
      note: fullyReversed
        ? "Stripe fully reversed this transfer."
        : reversedAmountCents > 0
          ? `Stripe reversed ${reversedAmountCents}¢ of this transfer.`
          : payout.note,
    });

    if (fullyReversed && payout.orderId) {
      const items = await ctx.db
        .query("orderItems")
        .withIndex("by_order", (s) => s.eq("orderId", payout.orderId!))
        .collect();
      for (const item of items) {
        if (item.sellerId !== payout.sellerId) continue;
        if (item.stripeTransferId !== args.transferId) continue;
        // The money is back with the platform; the line may be released again
        // if it was not itself refunded.
        await ctx.db.patch(item._id, { stripeTransferId: undefined });
      }
    }

    return {
      applied: true,
      status: fullyReversed ? "reversed" : "paid",
      reversedAmountCents,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Refunds                                                                    */
/* -------------------------------------------------------------------------- */

function merchandiseGrossCents(item: Doc<"orderItems">): number {
  return Math.max(0, Math.round(item.priceCents * item.quantity));
}

function refundedMerchandiseCents(item: Doc<"orderItems">): number {
  return Math.max(
    0,
    (item.refundedAmountCents ?? 0) - (item.refundedFeeCents ?? 0),
  );
}

/**
 * Refund policy for seller fulfillment fees: merchandise can be refunded
 * partially or fully at any time. The seller's one-per-order fulfillment fee
 * is refundable only on the refund that fully covers the final unrefunded line
 * for that seller. This prevents refunding the same group fee more than once.
 */
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
    if (order.paymentStatus !== "paid" && order.paymentStatus !== "partially_refunded")
      throw new Error("Stripe has not confirmed this order's payment yet.");
    if (item.paymentStatus !== "paid")
      throw new Error("Only a paid card item can be refunded.");
    if (!order.stripePaymentIntentId)
      throw new Error("This order has no Stripe payment to refund.");
    if ((item.pendingRefundAmountCents ?? 0) > 0)
      throw new Error("A refund for this item is already pending with Stripe.");

    const siblings = await ctx.db
      .query("orderItems")
      .withIndex("by_order", (s) => s.eq("orderId", order._id))
      .collect();
    const sellerItems = siblings.filter((s) => s.sellerId === item.sellerId);
    const merchandiseCents = merchandiseGrossCents(item);
    const alreadyMerchandiseCents = refundedMerchandiseCents(item);
    const merchandiseRemainingCents = Math.max(
      0,
      merchandiseCents - alreadyMerchandiseCents,
    );
    const otherSellerItemsRefunded = sellerItems.every(
      (sibling) =>
        sibling._id === item._id ||
        refundedMerchandiseCents(sibling) >= merchandiseGrossCents(sibling),
    );
    const sellerFeeCents =
      order.fulfillments?.find((f) => f.sellerId === item.sellerId)?.feeCents ??
      0;
    const refundedFeeCents = sellerItems.reduce(
      (sum, sibling) => sum + (sibling.refundedFeeCents ?? 0),
      0,
    );
    const feeRemainingCents = otherSellerItemsRefunded
      ? Math.max(0, sellerFeeCents - refundedFeeCents)
      : 0;
    const itemTotalCents = Math.max(
      0,
      (order.refundedAmountCents ?? 0),
      siblings.reduce((sum, s) => sum + (s.refundedAmountCents ?? 0), 0),
    );
    const pendingOrderCents = siblings.reduce(
      (sum, s) => sum + (s.pendingRefundAmountCents ?? 0),
      0,
    );
    const capturedRemainingCents = Math.max(
      0,
      order.totalCents - itemTotalCents - pendingOrderCents,
    );
    const maximumRefundCents = Math.min(
      merchandiseRemainingCents + feeRemainingCents,
      capturedRemainingCents,
    );
    if (maximumRefundCents <= 0) {
      throw new Error("This item has no refundable balance left.");
    }

    return {
      itemId: item._id,
      orderId: order._id,
      paymentIntentId: order.stripePaymentIntentId,
      amountCents: maximumRefundCents,
      merchandiseCents: merchandiseRemainingCents,
      feeCents: feeRemainingCents,
      refundedCents: item.refundedAmountCents ?? 0,
      capturedRemainingCents,
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
    amountCents: v.number(),
  },
  handler: async (ctx, args) => {
    const itemId = ctx.db.normalizeId("orderItems", args.itemId);
    if (!itemId) return false;
    const item = await ctx.db.get(itemId);
    if (!item) return false;
    if (item.paymentStatus === "refunded") return false;
    if (item.refundStatus === "pending" && item.refundId === args.refundId) {
      return true;
    }
    if ((item.pendingRefundAmountCents ?? 0) > 0) {
      throw new Error("Another refund for this item is already pending.");
    }
    if (!Number.isInteger(args.amountCents) || args.amountCents <= 0)
      throw new Error("Invalid refund amount.");
    const order = await ctx.db.get(item.orderId);
    if (!order) return false;
    const siblings = await ctx.db
      .query("orderItems")
      .withIndex("by_order", (s) => s.eq("orderId", order._id))
      .collect();
    const refundedTotal = Math.max(
      order.refundedAmountCents ?? 0,
      siblings.reduce((sum, s) => sum + (s.refundedAmountCents ?? 0), 0),
    );
    if (refundedTotal + args.amountCents > order.totalCents) {
      throw new Error("Refund amount exceeds the captured order total.");
    }
    await ctx.db.patch(item._id, {
      refundId: args.refundId,
      refundStatus: "pending",
      pendingRefundAmountCents: args.amountCents,
    });
    return true;
  },
});

/**
 * Apply a Stripe-confirmed refund. Cumulative refunds are capped at both the
 * line and the captured order total. A line becomes fully refunded only after
 * its merchandise is covered; fees refund on the final seller line.
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
    if (!Number.isInteger(args.amountCents) || args.amountCents <= 0)
      throw new Error("Invalid refund amount.");
    if (
      (item.pendingRefundAmountCents ?? 0) > 0 &&
      item.refundId !== args.refundId
    )
      throw new Error("Another refund for this item is already pending.");

    const order = await ctx.db.get(item.orderId);
    if (!order) return { applied: false, reason: "unknown_order" as const };
    const siblings = await ctx.db
      .query("orderItems")
      .withIndex("by_order", (s) => s.eq("orderId", order._id))
      .collect();
    const sellerItems = siblings.filter((s) => s.sellerId === item.sellerId);
    const grossCents = merchandiseGrossCents(item);
    const alreadyMerchandiseCents = refundedMerchandiseCents(item);
    const alreadyFeeCents = item.refundedFeeCents ?? 0;
    const merchandiseRemainingCents = Math.max(
      0,
      grossCents - alreadyMerchandiseCents,
    );
    const otherSellerItemsRefunded = sellerItems.every(
      (sibling) =>
        sibling._id === item._id ||
        refundedMerchandiseCents(sibling) >= merchandiseGrossCents(sibling),
    );
    const sellerFeeCents =
      order.fulfillments?.find((f) => f.sellerId === item.sellerId)?.feeCents ??
      0;
    const refundedFeeCents = sellerItems.reduce(
      (sum, sibling) => sum + (sibling.refundedFeeCents ?? 0),
      0,
    );
    const feeRemainingCents =
      otherSellerItemsRefunded && args.amountCents >= merchandiseRemainingCents
        ? Math.max(0, sellerFeeCents - refundedFeeCents)
        : 0;
    const feePortionCents = Math.min(
      feeRemainingCents,
      Math.max(0, args.amountCents - merchandiseRemainingCents),
    );
    const merchandisePortionCents = Math.min(
      merchandiseRemainingCents,
      Math.max(0, args.amountCents - feePortionCents),
    );
    const maximumCents = merchandiseRemainingCents + feeRemainingCents;
    if (args.amountCents > maximumCents) {
      throw new Error("Refund amount exceeds the item's refundable balance.");
    }

    const priorOrderRefundedCents = Math.max(
      order.refundedAmountCents ?? 0,
      siblings.reduce(
        (sum, sibling) =>
          sum +
          (sibling._id === item._id ? 0 : (sibling.refundedAmountCents ?? 0)),
        item.refundedAmountCents ?? 0,
      ),
    );
    if (priorOrderRefundedCents + args.amountCents > order.totalCents) {
      throw new Error("Refund amount exceeds the captured order total.");
    }

    const now = Date.now();
    const newRefundedAmountCents =
      (item.refundedAmountCents ?? 0) + args.amountCents;
    const fullyRefunded = merchandiseRemainingCents <= merchandisePortionCents;
    await ctx.db.patch(item._id, {
      paymentStatus: fullyRefunded ? "refunded" : "paid",
      refundStatus: "succeeded",
      refundId: args.refundId,
      refundedAt: fullyRefunded ? now : item.refundedAt,
      refundedAmountCents: newRefundedAmountCents,
      refundedFeeCents: alreadyFeeCents + feePortionCents,
      pendingRefundAmountCents: undefined,
      refundNote: fullyRefunded
        ? "Refunded through Stripe."
        : "Partial refund through Stripe.",
    });

    if (fullyRefunded) {
      await reverseCommission(ctx, item._id, "Stripe refund.");
    } else if (merchandisePortionCents > 0) {
      await adjustCommissionForRefund(
        ctx,
        item._id,
        merchandisePortionCents,
        "Partial Stripe refund.",
      );
    }

    const updatedSiblings = await ctx.db
      .query("orderItems")
      .withIndex("by_order", (s) => s.eq("orderId", order._id))
      .collect();
    const orderRefundedCents = updatedSiblings.reduce(
      (sum, sibling) => sum + (sibling.refundedAmountCents ?? 0),
      0,
    );
    const allRefunded =
      orderRefundedCents >= order.totalCents &&
      updatedSiblings.every(
        (sibling) => sibling.paymentStatus === "refunded",
      );
    await ctx.db.patch(order._id, {
      refundedAmountCents: orderRefundedCents,
      paymentStatus: allRefunded ? "refunded" : "partially_refunded",
    });

    return {
      applied: true,
      partial: !fullyRefunded,
      merchandiseCents: merchandisePortionCents,
      feeCents: feePortionCents,
      orderRefundedCents,
    };
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
    if (item.refundId && item.refundId !== args.refundId) return false;
    await ctx.db.patch(item._id, {
      refundId: args.refundId,
      refundStatus: "failed",
      pendingRefundAmountCents: undefined,
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
