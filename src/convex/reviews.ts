import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { requireVerifiedUser } from "./lib";
import { mutation, query, type QueryCtx } from "./_generated/server";

/**
 * Public reviews for a product, with an average rating summary.
 * `verifiedPurchase` is only ever set true when the reviewer actually
 * bought the product — there are no fabricated ratings.
 */
export const listForProduct = query({
  args: { productId: v.string() },
  handler: async (ctx, args) => {
    const productId = ctx.db.normalizeId("products", args.productId);
    const reviews = productId
      ? await ctx.db
          .query("reviews")
          .withIndex("by_product", (s) => s.eq("productId", productId))
          .order("desc")
          .take(50)
      : [];

    const withReviewers = await Promise.all(
      reviews.map(async (review) => {
        const reviewer = await ctx.db.get(review.reviewerId);
        return {
          _id: review._id,
          rating: review.rating,
          comment: review.comment,
          verifiedPurchase: review.verifiedPurchase,
          createdAt: review._creationTime,
          reviewerName: reviewer?.name ?? reviewer?.shopName ?? "Verified buyer",
          reviewerImage: reviewer?.image ?? null,
        };
      }),
    );

    const count = reviews.length;
    const average =
      count === 0
        ? null
        : reviews.reduce((sum, r) => sum + r.rating, 0) / count;

    return { reviews: withReviewers, count, average };
  },
});

/** Review authorship/eligibility flags for the signed-in viewer. */
export const viewerState = query({
  args: { productId: v.string() },
  handler: async (ctx, args) => {
    const productId = ctx.db.normalizeId("products", args.productId);
    const userId = await getAuthUserId(ctx);
    if (!productId || userId === null) {
      return { canReview: false, hasReviewed: false, verifiedBuyer: false };
    }
    const existing = await ctx.db
      .query("reviews")
      .withIndex("by_reviewer", (s) => s.eq("reviewerId", userId))
      .take(200);
    const hasReviewed = existing.some((r) => r.productId === productId);
    const verifiedBuyer = await hasDeliveredPurchase(ctx, userId, productId);
    return {
      canReview: !hasReviewed && verifiedBuyer,
      hasReviewed,
      verifiedBuyer,
    };
  },
});

async function hasDeliveredPurchase(
  ctx: QueryCtx,
  userId: Doc<"users">["_id"],
  productId: Doc<"products">["_id"],
): Promise<boolean> {
  const items = await ctx.db
    .query("orderItems")
    .withIndex("by_buyer", (s) => s.eq("buyerId", userId))
    .take(300);
  return items.some(
    (item) => item.productId === productId && item.status === "delivered",
  );
}

export const create = mutation({
  args: {
    productId: v.id("products"),
    rating: v.number(),
    comment: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireVerifiedUser(ctx);
    const product = await ctx.db.get(args.productId);
    if (!product) throw new Error("This listing no longer exists.");
    if (product.status === "draft" || product.status === "removed")
      throw new Error("You cannot review an unavailable listing.");

    const rating = Math.round(args.rating);
    if (rating < 1 || rating > 5)
      throw new Error("Rating must be between 1 and 5.");
    const comment = args.comment.trim();
    if (comment.length < 3)
      throw new Error("Write a few words about your experience.");
    if (comment.length > 2000)
      throw new Error("Review must be 2000 characters or fewer.");

    const existing = await ctx.db
      .query("reviews")
      .withIndex("by_reviewer", (s) => s.eq("reviewerId", user._id))
      .take(200);
    if (existing.some((r) => r.productId === args.productId)) {
      throw new Error("You have already reviewed this listing.");
    }

    // Only buyers whose order was actually delivered can rate the listing.
    // This keeps the public rating honest and matches the review link shown
    // on delivered order items.
    const verified = await hasDeliveredPurchase(ctx, user._id, args.productId);
    if (!verified)
      throw new Error(
        "Reviews are open to buyers after delivery. Once your order is marked delivered, you can review it from your orders page.",
      );
    await ctx.db.insert("reviews", {
      productId: args.productId,
      reviewerId: user._id,
      rating,
      comment,
      verifiedPurchase: true,
    });

    // Keep the listing's denormalized aggregates in sync so catalog rating
    // filters and product cards never need to scan every review.
    await ctx.db.patch(product._id, {
      ratingSum: (product.ratingSum ?? 0) + rating,
      ratingCount: (product.ratingCount ?? 0) + 1,
    });
    return true;
  },
});
