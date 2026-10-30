import { v } from "convex/values";
import { requireAdmin, requireVerifiedUser } from "./lib";
import { mutation, query } from "./_generated/server";

const reasonValidator = v.union(
  v.literal("prohibited"),
  v.literal("misleading"),
  v.literal("counterfeit"),
  v.literal("spam"),
  v.literal("other"),
);

/**
 * Any verified shopper can report a listing once. Reports are private: only
 * the reporter and moderators can see them, and they never change a listing
 * automatically — a human decides.
 */
export const create = mutation({
  args: {
    productId: v.id("products"),
    reason: reasonValidator,
    details: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireVerifiedUser(ctx);
    const product = await ctx.db.get(args.productId);
    if (!product) throw new Error("This listing no longer exists.");
    if (product.sellerId === user._id)
      throw new Error("You cannot report your own listing.");
    if (product.status === "removed")
      return { alreadyHandled: true };

    const mine = await ctx.db
      .query("reports")
      .withIndex("by_reporter", (s) => s.eq("reporterId", user._id))
      .take(100);
    if (
      mine.some(
        (report) =>
          report.productId === args.productId && report.status === "open",
      )
    ) {
      throw new Error("You already reported this listing. Our team is reviewing it.");
    }

    const details = args.details?.trim().slice(0, 500) || undefined;
    const reportId = await ctx.db.insert("reports", {
      productId: args.productId,
      reporterId: user._id,
      reason: args.reason,
      details,
      status: "open",
      createdAt: Date.now(),
    });
    return { reportId, alreadyHandled: false };
  },
});

/** Moderator queue, newest first, with listing + reporter context. */
export const adminList = query({
  args: { status: v.optional(v.union(v.literal("open"), v.literal("resolved"), v.literal("dismissed"))) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const status = args.status ?? "open";
    const reports = await ctx.db
      .query("reports")
      .withIndex("by_status", (s) => s.eq("status", status))
      .order("desc")
      .take(100);
    return await Promise.all(
      reports.map(async (report) => {
        const product = await ctx.db.get(report.productId);
        const reporter = await ctx.db.get(report.reporterId);
        const seller = product ? await ctx.db.get(product.sellerId) : null;
        return {
          _id: report._id,
          productId: report.productId,
          productTitle: product?.title ?? "Removed listing",
          productStatus: product?.status ?? "removed",
          sellerName: seller?.shopName ?? seller?.name ?? "Unknown seller",
          reason: report.reason,
          details: report.details ?? null,
          reporterEmail: reporter?.email ?? null,
          createdAt: report.createdAt,
        };
      }),
    );
  },
});

/** Open-report count for the admin nav/badges. */
export const openCount = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireAdmin(ctx).catch(() => null);
    if (!user) return 0;
    const open = await ctx.db
      .query("reports")
      .withIndex("by_status", (s) => s.eq("status", "open"))
      .take(200);
    return open.length;
  },
});

/** Resolve or dismiss a report. Optionally takes the listing down too. */
export const resolve = mutation({
  args: {
    reportId: v.id("reports"),
    outcome: v.union(v.literal("resolved"), v.literal("dismissed")),
    note: v.optional(v.string()),
    removeListing: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const report = await ctx.db.get(args.reportId);
    if (!report) throw new Error("Report not found.");
    if (report.status !== "open")
      throw new Error("This report is already closed.");

    const note = args.note?.trim().slice(0, 300) || undefined;
    await ctx.db.patch(report._id, {
      status: args.outcome,
      resolvedAt: Date.now(),
      resolvedBy: admin._id,
      resolutionNote: note,
    });

    if (args.removeListing && args.outcome === "resolved") {
      const product = await ctx.db.get(report.productId);
      if (product) {
        await ctx.db.patch(product._id, {
          status: "removed",
          moderatorNote: note ?? "Removed after a buyer report.",
        });
      }
    }
    return true;
  },
});
