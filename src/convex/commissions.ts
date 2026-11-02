import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { commissionCents } from "./plans";
import { requireAdmin } from "./lib";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { getSettings } from "./subscriptions";

/**
 * Accrue platform commission for one delivered order item, if the seller is
 * on an active business plan. Idempotent via the by_orderItem index — retried
 * payment webhooks or repeated status updates can never double-charge.
 *
 * Base amount defaults to the merchandise subtotal (price × qty) and excludes
 * separately stated shipping charges, per platform policy; admins can switch
 * the base to include shipping via platformSettings.commissionBase.
 *
 * Returns the ledger row id, or null when no commission applies (individual
 * sellers, free plan, or already accrued).
 */
export async function accrueCommission(
  ctx: MutationCtx,
  args: {
    orderId: Id<"orders">;
    orderItemId: Id<"orderItems">;
    sellerId: Id<"users">;
    merchandiseCents: number;
    shippingCents: number;
  },
): Promise<Id<"commissionLedger"> | null> {
  const existing = await ctx.db
    .query("commissionLedger")
    .withIndex("by_orderItem", (s) => s.eq("orderItemId", args.orderItemId))
    .first();
  if (existing) return null; // already accrued — never double-charge

  const seller = await ctx.db.get(args.sellerId);
  if (!seller || seller.sellerType !== "business") return null;
  const sub = await ctx.db
    .query("subscriptions")
    .withIndex("by_user", (s) => s.eq("userId", args.sellerId))
    .order("desc")
    .first();
  // Commission only applies to sales made under an active paid plan.
  if (!sub || sub.status !== "active" || sub.commissionBps <= 0) return null;

  const settings = await getSettings(ctx);
  const baseCents =
    settings.commissionBase === "merchandise_plus_shipping"
      ? args.merchandiseCents + args.shippingCents
      : args.merchandiseCents;
  const amountCents = commissionCents(baseCents, sub.commissionBps);
  if (amountCents <= 0) return null;

  return await ctx.db.insert("commissionLedger", {
    sellerId: args.sellerId,
    orderId: args.orderId,
    orderItemId: args.orderItemId,
    planId: sub.planId,
    baseCents,
    commissionBps: sub.commissionBps,
    amountCents,
    status: "pending",
    occurredAt: Date.now(),
  });
}

/**
 * Reduce a commission row after a partial merchandise refund. The remaining
 * base is recomputed with the same snapshotted rate, so transfer math and the
 * admin integrity check stay consistent. Full refunds still use
 * `reverseCommission` rather than this helper.
 */
export async function adjustCommissionForRefund(
  ctx: MutationCtx,
  orderItemId: Id<"orderItems">,
  refundedMerchandiseCents: number,
  note: string,
): Promise<boolean> {
  if (!Number.isInteger(refundedMerchandiseCents)) return false;
  if (refundedMerchandiseCents <= 0) return false;
  const row = await ctx.db
    .query("commissionLedger")
    .withIndex("by_orderItem", (s) => s.eq("orderItemId", orderItemId))
    .first();
  if (!row || row.status === "reversed") return false;
  const nextBaseCents = Math.max(0, row.baseCents - refundedMerchandiseCents);
  if (nextBaseCents === row.baseCents) return false;
  await ctx.db.patch(row._id, {
    baseCents: nextBaseCents,
    amountCents: commissionCents(nextBaseCents, row.commissionBps),
    note: note.slice(0, 300),
  });
  return true;
}

/**
 * Reverse a pending commission (refund or cancelled-after-delivery). Confirmed
 * rows require an admin reversal with a note, keeping the audit trail.
 */
export async function reverseCommission(
  ctx: MutationCtx,
  orderItemId: Id<"orderItems">,
  note: string,
): Promise<boolean> {
  const row = await ctx.db
    .query("commissionLedger")
    .withIndex("by_orderItem", (s) => s.eq("orderItemId", orderItemId))
    .first();
  if (!row || row.status === "reversed") return false;
  await ctx.db.patch(row._id, {
    status: "reversed",
    note: note.slice(0, 300),
  });
  return true;
}

/** Seller: their commission rows joined with order context. */
export const myLedger = query({
  args: {},
  handler: async (ctx: QueryCtx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { rows: [], totals: null };
    const rows = await ctx.db
      .query("commissionLedger")
      .withIndex("by_seller", (s) => s.eq("sellerId", userId))
      .order("desc")
      .take(200);

    let owedCents = 0;
    let confirmedCents = 0;
    let reversedCents = 0;
    for (const row of rows) {
      if (row.status === "pending") owedCents += row.amountCents;
      else if (row.status === "confirmed") confirmedCents += row.amountCents;
      else reversedCents += row.amountCents;
    }
    return {
      rows,
      totals: { owedCents, confirmedCents, reversedCents },
    };
  },
});

/** Admin: full ledger with seller names. */
export const adminLedger = query({
  args: {},
  handler: async (ctx: QueryCtx) => {
    await requireAdmin(ctx);
    const rows = await ctx.db
      .query("commissionLedger")
      .order("desc")
      .take(200);
    return await Promise.all(
      rows.map(async (row) => {
        const seller = await ctx.db.get(row.sellerId);
        return {
          ...row,
          sellerName: seller?.shopName ?? seller?.name ?? "Unknown",
        };
      }),
    );
  },
});

/** Admin: mark a pending commission as paid/confirmed or reverse with reason. */
export const adminSettle = mutation({
  args: {
    entryId: v.id("commissionLedger"),
    action: v.union(v.literal("confirm"), v.literal("reverse")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const row = await ctx.db.get(args.entryId);
    if (!row) throw new Error("Ledger entry not found.");
    if (row.status !== "pending")
      throw new Error("Only pending entries can be settled.");
    if (args.action === "reverse" && !args.note?.trim())
      throw new Error("A reason is required to reverse a commission.");
    await ctx.db.patch(row._id, {
      status: args.action === "confirm" ? "confirmed" : "reversed",
      note: args.note?.trim().slice(0, 300) || undefined,
    });
    return true;
  },
});
