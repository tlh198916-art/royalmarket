import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { isMarketplaceAdmin, requireAdmin, requireUser } from "./lib";
import { reverseCommission } from "./commissions";
import { commissionCents } from "./plans";
import { query, mutation, type MutationCtx, type QueryCtx } from "./_generated/server";

/**
 * Payment ledger for the marketplace.
 *
 * The marketplace is cash-on-delivery only today: there is no Stripe SDK,
 * secret key, Connect account, webhook or card flow anywhere in this codebase.
 * These functions therefore never invent money movement:
 * - Cash is marked collected by the seller (or an admin) after delivery.
 * - Card payments can only be marked paid by a provider-confirmed webhook
 *   once one exists; `recordCodCollected` refuses card orders outright.
 * - A payout only counts as completed when its provider is Stripe and its
 *   status is `paid` — money the platform has not confirmed is never shown
 *   as paid out.
 */

export type PaymentStatus = "unpaid" | "paid" | "refunded" | "failed";

export function itemPaymentStatus(item: Doc<"orderItems">): PaymentStatus {
  return item.paymentStatus ?? "unpaid";
}

/**
 * Pure Stripe readiness assessment, split from the query so it can be unit
 * tested without deployment environment variables. Configuration presence is
 * reported honestly; the checkout/webhook implementation itself is still
 * missing, so card payments are never advertised as available.
 */
export function assessStripeReadiness(env: {
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_CONNECT_CLIENT_ID?: string;
}): {
  keysPresent: boolean;
  missing: string[];
  cardPaymentsAvailable: boolean;
  connectAvailable: boolean;
  blockers: string[];
} {
  const missing: string[] = [];
  if (!env.STRIPE_SECRET_KEY) missing.push("STRIPE_SECRET_KEY");
  if (!env.STRIPE_WEBHOOK_SECRET) missing.push("STRIPE_WEBHOOK_SECRET");
  if (!env.STRIPE_CONNECT_CLIENT_ID)
    missing.push("STRIPE_CONNECT_CLIENT_ID");

  return {
    keysPresent: missing.length === 0,
    missing,
    // Never true until a real checkout + webhook implementation ships.
    cardPaymentsAvailable: false,
    connectAvailable: false,
    blockers: [
      ...missing.map((key) => `${key} is not set`),
      "Card checkout (PaymentIntent/Checkout Session) is not implemented",
      "Stripe Connect onboarding links are not implemented",
      "Webhook event processing is not implemented",
    ],
  };
}

/** Admin/dev visibility into what Stripe configuration is actually present. */
export const readiness = query({
  args: {},
  handler: async () => {
    return assessStripeReadiness({
      STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
      STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
      STRIPE_CONNECT_CLIENT_ID: process.env.STRIPE_CONNECT_CLIENT_ID,
    });
  },
});

type SellerEarnings = {
  currency: "usd";
  pendingCents: number;
  availableCents: number;
  paidOutCents: number;
  inTransitCents: number;
  collectedCashCents: number;
  refundedCents: number;
  grossDeliveredCents: number;
  commissionCents: number;
  deliveredCount: number;
  pendingCount: number;
  connect: {
    status: "not_connected" | "pending" | "restricted" | "enabled";
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
  };
  payouts: {
    _id: Id<"payouts">;
    amountCents: number;
    provider: "stripe" | "manual";
    status: "pending" | "in_transit" | "paid" | "failed";
    /** True only for provider-confirmed Stripe payouts. */
    confirmed: boolean;
    providerTransferId: string | null;
    createdAt: number;
    confirmedAt: number | null;
    note: string | null;
  }[];
  sales: {
    _id: Id<"orderItems">;
    title: string;
    quantity: number;
    grossCents: number;
    feeCents: number;
    commissionCents: number;
    netCents: number;
    paymentStatus: PaymentStatus;
    paymentMethod: "cod" | "card";
    paidAt: number | null;
    orderedAt: number;
  }[];
};

/**
 * Seller earnings computed from real order items, commission ledger rows and
 * payout records. Nothing here is estimated or seeded.
 *
 * Definitions:
 * - pending: delivered items whose payment is not recorded yet.
 * - available: card money the platform holds for the seller, minus payouts
 *   already recorded (cash-on-delivery money is already in the seller's hand).
 * - collectedCash: cash-on-delivery earnings the seller has confirmed.
 * - paidOut: only Stripe-confirmed payouts.
 */
export const sellerEarnings = query({
  args: {},
  handler: async (ctx: QueryCtx): Promise<SellerEarnings | null> => {
    const user = await requireUser(ctx).catch(() => null);
    if (!user) return null;

    const items = await ctx.db
      .query("orderItems")
      .withIndex("by_seller", (s) => s.eq("sellerId", user._id))
      .order("desc")
      .take(500);
    const orderIds = [...new Set(items.map((item) => item.orderId))];
    const orderDocs = await Promise.all(
      orderIds.map((orderId) => ctx.db.get(orderId)),
    );
    const orders = new Map(
      orderDocs
        .filter((order): order is Doc<"orders"> => order !== null)
        .map((order) => [order._id, order]),
    );

    const ledger = await ctx.db
      .query("commissionLedger")
      .withIndex("by_seller", (s) => s.eq("sellerId", user._id))
      .take(500);
    const ledgerByItem = new Map(ledger.map((row) => [row.orderItemId, row]));

    const payoutRows = await ctx.db
      .query("payouts")
      .withIndex("by_seller", (s) => s.eq("sellerId", user._id))
      .order("desc")
      .take(20);
    const account = await ctx.db
      .query("sellerPaymentAccounts")
      .withIndex("by_seller", (s) => s.eq("sellerId", user._id))
      .first();

    let pendingCents = 0;
    let collectedCashCents = 0;
    let cardPaidCents = 0;
    let refundedCents = 0;
    let grossDeliveredCents = 0;
    let commissionTotalCents = 0;
    let deliveredCount = 0;
    let pendingCount = 0;
    const feeCounted = new Set<Id<"orders">>();
    const sales: SellerEarnings["sales"] = [];

    for (const item of items) {
      const order = orders.get(item.orderId);
      if (!order || item.status !== "delivered") continue;
      deliveredCount += 1;

      const grossCents = item.priceCents * item.quantity;
      const commissionRow = ledgerByItem.get(item._id);
      const commissionCentsForItem =
        commissionRow && commissionRow.status !== "reversed"
          ? commissionRow.amountCents
          : 0;
      const paymentStatus = itemPaymentStatus(item);
      // The seller-set fulfillment fee is charged once per seller per order,
      // matching checkout math — never once per line item. A fully refunded
      // order never contributes the fee to earnings.
      let feeCents = 0;
      if (!feeCounted.has(order._id) && paymentStatus !== "refunded") {
        feeCents =
          order.fulfillments?.find((f) => f.sellerId === user._id)?.feeCents ??
          0;
        feeCounted.add(order._id);
      }
      const netCents = Math.max(0, grossCents + feeCents - commissionCentsForItem);

      grossDeliveredCents += grossCents;
      commissionTotalCents += commissionCentsForItem;

      if (paymentStatus === "refunded") {
        refundedCents += grossCents;
      } else if (paymentStatus === "paid") {
        if (order.paymentMethod === "cod") collectedCashCents += netCents;
        else cardPaidCents += netCents;
      } else {
        pendingCents += netCents;
        pendingCount += 1;
      }

      sales.push({
        _id: item._id,
        title: item.title,
        quantity: item.quantity,
        grossCents,
        feeCents,
        commissionCents: commissionCentsForItem,
        netCents,
        paymentStatus,
        paymentMethod: order.paymentMethod,
        paidAt: item.paidAt ?? null,
        orderedAt: item._creationTime,
      });
    }

    const confirmedPayouts = payoutRows.filter(
      (payout) => payout.provider === "stripe" && payout.status === "paid",
    );
    const inFlightPayouts = payoutRows.filter(
      (payout) => payout.status === "pending" || payout.status === "in_transit",
    );
    const paidOutCents = confirmedPayouts.reduce(
      (sum, payout) => sum + payout.amountCents,
      0,
    );
    const inTransitCents = inFlightPayouts.reduce(
      (sum, payout) => sum + payout.amountCents,
      0,
    );
    // Only platform-held (card) money can be paid out; cash is already paid.
    const availableCents = Math.max(
      0,
      cardPaidCents - paidOutCents - inTransitCents,
    );

    return {
      currency: "usd",
      pendingCents,
      availableCents,
      paidOutCents,
      inTransitCents,
      collectedCashCents,
      refundedCents,
      grossDeliveredCents,
      commissionCents: commissionTotalCents,
      deliveredCount,
      pendingCount,
      connect: {
        status: account?.onboardingStatus ?? "not_connected",
        chargesEnabled: account?.chargesEnabled ?? false,
        payoutsEnabled: account?.payoutsEnabled ?? false,
        detailsSubmitted: account?.detailsSubmitted ?? false,
      },
      payouts: payoutRows.map((payout) => ({
        _id: payout._id,
        amountCents: payout.amountCents,
        provider: payout.provider,
        status: payout.status,
        confirmed: payout.provider === "stripe" && payout.status === "paid",
        providerTransferId: payout.providerTransferId ?? null,
        createdAt: payout.createdAt,
        confirmedAt: payout.confirmedAt ?? null,
        note: payout.note ?? null,
      })),
      sales: sales.slice(0, 12),
    };
  },
});

/**
 * Record cash actually collected by the seller at handoff. Idempotent: a
 * second call, a refunded item, or a card order is rejected, so a payment can
 * never be counted twice or confirmed by the wrong party.
 */
export const recordCodCollected = mutation({
  args: {
    itemId: v.id("orderItems"),
    reference: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new Error("That order item no longer exists.");
    if (item.sellerId !== user._id && !isMarketplaceAdmin(user))
      throw new Error("Only the seller on this item can record its payment.");

    const order = await ctx.db.get(item.orderId);
    if (!order) throw new Error("That order no longer exists.");
    if (order.paymentMethod !== "cod")
      throw new Error(
        "Card payments can only be confirmed by the payment provider. This order is not payable in cash.",
      );
    if (item.status !== "delivered")
      throw new Error(
        "Record cash after delivery — handoff is the moment payment is collected.",
      );

    const status = itemPaymentStatus(item);
    if (status === "paid")
      throw new Error("Payment is already recorded for this item.");
    if (status === "refunded")
      throw new Error("This item was refunded and cannot be collected again.");

    const now = Date.now();
    await ctx.db.patch(item._id, {
      paymentStatus: "paid",
      paidAt: now,
      paymentReference:
        args.reference?.trim().slice(0, 120) || "Cash collected on delivery",
      paymentRecordedBy: user._id,
    });
    return { paidAt: now };
  },
});

/**
 * Admin records a refund against a paid item: the payment flips to refunded
 * and the item's commission row is reversed (pending or confirmed), with the
 * admin's note kept as the audit trail. Refunds are recorded, never invented —
 * only a paid item can be refunded and only once.
 */
export const adminRefundItem = mutation({
  args: {
    itemId: v.id("orderItems"),
    note: v.optional(v.string()),
  },
  handler: async (ctx: MutationCtx, args) => {
    await requireAdmin(ctx);
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new Error("That order item no longer exists.");
    const status = itemPaymentStatus(item);
    if (status === "refunded") throw new Error("This item is already refunded.");
    if (status !== "paid")
      throw new Error("Only a paid item can be refunded.");

    await ctx.db.patch(item._id, {
      paymentStatus: "refunded",
      refundedAt: Date.now(),
      refundNote: args.note?.trim().slice(0, 300) || undefined,
    });
    await reverseCommission(ctx, item._id, "Refund recorded by admin.");
    return true;
  },
});

/** Admin: payment status across the marketplace, Connect state, payouts. */
export const adminOverview = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const [orders, items, sellers, payouts, accounts] = await Promise.all([
      ctx.db.query("orders").order("desc").take(1000),
      ctx.db.query("orderItems").order("desc").take(2000),
      ctx.db
        .query("users")
        .withIndex("by_role", (s) => s.eq("role", "user"))
        .take(500),
      ctx.db.query("payouts").order("desc").take(100),
      ctx.db.query("sellerPaymentAccounts").take(200),
    ]);

    const orderById = new Map(orders.map((order) => [order._id, order]));
    let cashCollectedCents = 0;
    let cardCollectedCents = 0;
    let awaitingCents = 0;
    let refundedCents = 0;
    let awaitingCount = 0;
    let paidCount = 0;
    let refundedCount = 0;

    for (const item of items) {
      const gross = item.priceCents * item.quantity;
      const status = itemPaymentStatus(item);
      const order = orderById.get(item.orderId);
      if (status === "paid") {
        paidCount += 1;
        if (order?.paymentMethod === "card") cardCollectedCents += gross;
        else cashCollectedCents += gross;
      } else if (status === "refunded") {
        refundedCount += 1;
        refundedCents += gross;
      } else if (item.status === "delivered") {
        awaitingCount += 1;
        awaitingCents += gross;
      }
    }

    const sellerAccounts = new Map(
      accounts.map((account) => [account.sellerId, account]),
    );
    const sellerRows = await Promise.all(
      sellers
        .filter((seller) => seller.isSeller)
        .slice(0, 200)
        .map(async (seller) => {
          const account = sellerAccounts.get(seller._id);
          return {
            sellerId: seller._id,
            name: seller.shopName ?? seller.name ?? "Seller",
            email: seller.email ?? null,
            sellerType: seller.sellerType ?? "individual",
            connectStatus: account?.onboardingStatus ?? "not_connected",
            chargesEnabled: account?.chargesEnabled ?? false,
            payoutsEnabled: account?.payoutsEnabled ?? false,
            detailsSubmitted: account?.detailsSubmitted ?? false,
          };
        }),
    );

    const payoutRows = await Promise.all(
      payouts.map(async (payout) => {
        const seller = await ctx.db.get(payout.sellerId);
        return {
          _id: payout._id,
          sellerName: seller?.shopName ?? seller?.name ?? "Unknown",
          amountCents: payout.amountCents,
          provider: payout.provider,
          status: payout.status,
          confirmed: payout.provider === "stripe" && payout.status === "paid",
          providerTransferId: payout.providerTransferId ?? null,
          createdAt: payout.createdAt,
          confirmedAt: payout.confirmedAt ?? null,
        };
      }),
    );

    // Recent delivered payments, so admins can see and refund individual
    // items without guessing at order-level totals.
    const recentPaymentItems = await Promise.all(
      items
        .filter((item) => item.status === "delivered")
        .slice(0, 12)
        .map(async (item) => {
          const seller = await ctx.db.get(item.sellerId);
          return {
            _id: item._id,
            title: item.title,
            sellerName: seller?.shopName ?? seller?.name ?? "Seller",
            grossCents: item.priceCents * item.quantity,
            paymentStatus: itemPaymentStatus(item),
            paymentMethod: orderById.get(item.orderId)?.paymentMethod ?? "cod",
            paidAt: item.paidAt ?? null,
          };
        }),
    );

    return {
      totals: {
        orders: orders.length,
        cashCollectedCents,
        cardCollectedCents,
        awaitingCents,
        awaitingCount,
        refundedCents,
        refundedCount,
        paidCount,
      },
      sellers: sellerRows,
      payouts: payoutRows,
      recentPaymentItems,
      readiness: assessStripeReadiness({
        STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
        STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
        STRIPE_CONNECT_CLIENT_ID: process.env.STRIPE_CONNECT_CLIENT_ID,
      }),
    };
  },
});

/**
 * Admin integrity check for commission math. Flags rows whose stored amount no
 * longer matches base × rate, rows attached to cancelled/undelivered items,
 * and delivered business sales with an active plan but no ledger row.
 */
export const commissionIntegrity = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const ledger = await ctx.db.query("commissionLedger").take(500);
    const issues: {
      type: string;
      message: string;
      entryId: Id<"commissionLedger"> | null;
      orderItemId: Id<"orderItems"> | null;
      amountCents: number | null;
    }[] = [];

    for (const row of ledger) {
      const expected = commissionCents(row.baseCents, row.commissionBps);
      if (row.amountCents !== expected) {
        issues.push({
          type: "amount_mismatch",
          message: `Stored ${row.amountCents}¢ does not match ${row.commissionBps} bps of ${row.baseCents}¢ (expected ${expected}¢).`,
          entryId: row._id,
          orderItemId: row.orderItemId,
          amountCents: row.amountCents,
        });
      }
      if (!Number.isFinite(row.commissionBps) || row.commissionBps < 0) {
        issues.push({
          type: "invalid_rate",
          message: `Invalid commission rate stored: ${row.commissionBps} bps.`,
          entryId: row._id,
          orderItemId: row.orderItemId,
          amountCents: row.amountCents,
        });
      }
      const item = await ctx.db.get(row.orderItemId);
      if (!item) {
        issues.push({
          type: "orphan_entry",
          message: "Commission row points at an order item that no longer exists.",
          entryId: row._id,
          orderItemId: null,
          amountCents: row.amountCents,
        });
        continue;
      }
      if (item.status !== "delivered" && row.status !== "reversed") {
        issues.push({
          type: "accrued_early",
          message: `Commission accrued for a "${item.status}" item; commission applies to delivered sales only.`,
          entryId: row._id,
          orderItemId: item._id,
          amountCents: row.amountCents,
        });
      }
      if (row.status === "pending" && item.status === "cancelled") {
        issues.push({
          type: "pending_cancelled",
          message: "Cancelled item still has a pending commission row.",
          entryId: row._id,
          orderItemId: item._id,
          amountCents: row.amountCents,
        });
      }
    }

    // Delivered items that should have accrued commission but have no row.
    const ledgerItems = new Set(ledger.map((row) => row.orderItemId));
    const delivered = await ctx.db
      .query("orderItems")
      .withIndex("by_status", (s) => s.eq("status", "delivered"))
      .order("desc")
      .take(300);
    let missingCount = 0;
    for (const item of delivered) {
      if (ledgerItems.has(item._id)) continue;
      const seller = await ctx.db.get(item.sellerId);
      if (!seller || seller.sellerType !== "business") continue;
      const sub = await ctx.db
        .query("subscriptions")
        .withIndex("by_user", (s) => s.eq("userId", item.sellerId))
        .order("desc")
        .first();
      if (!sub || sub.status !== "active" || sub.commissionBps <= 0) continue;
      missingCount += 1;
      if (issues.length < 50) {
        issues.push({
          type: "missing_accrual",
          message: `Delivered item for ${seller.shopName ?? seller.name ?? "a business seller"} has no commission row.`,
          entryId: null,
          orderItemId: item._id,
          amountCents: null,
        });
      }
    }

    return {
      checkedEntries: ledger.length,
      checkedDeliveredItems: delivered.length,
      missingAccruals: missingCount,
      issues: issues.slice(0, 50),
    };
  },
});
