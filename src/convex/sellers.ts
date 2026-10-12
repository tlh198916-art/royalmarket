import { v } from "convex/values";
import { requireVerifiedUser } from "./lib";
import { mutation, query } from "./_generated/server";

/** Start (or update) a public seller profile. Verified accounts only. */
export const become = mutation({
  args: {
    shopName: v.string(),
    bio: v.optional(v.string()),
    location: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireVerifiedUser(ctx);
    const shopName = args.shopName.trim();
    if (shopName.length < 2)
      throw new Error("Shop name must be at least 2 characters.");
    if (shopName.length > 60)
      throw new Error("Shop name must be 60 characters or fewer.");
    const bio = args.bio?.trim().slice(0, 500) || undefined;
    const location = args.location?.trim().slice(0, 80) || undefined;

    await ctx.db.patch(user._id, {
      isSeller: true,
      shopName,
      sellerBio: bio,
      location,
      name: user.name ?? shopName,
    });
    return true;
  },
});

/** Seller profile edits from the seller dashboard. */
export const updateProfile = mutation({
  args: {
    shopName: v.string(),
    bio: v.optional(v.string()),
    location: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireVerifiedUser(ctx);
    if (!user.isSeller)
      throw new Error("Set up your seller profile first.");
    const shopName = args.shopName.trim();
    if (shopName.length < 2 || shopName.length > 60)
      throw new Error("Shop name must be between 2 and 60 characters.");
    await ctx.db.patch(user._id, {
      shopName,
      sellerBio: args.bio?.trim().slice(0, 500) || undefined,
      location: args.location?.trim().slice(0, 80) || undefined,
    });
    return true;
  },
});

/** Public seller profile with real stats (listings, ratings, tenure). */
export const publicProfile = query({
  args: { sellerId: v.string() },
  handler: async (ctx, args) => {
    const sellerId = ctx.db.normalizeId("users", args.sellerId);
    if (!sellerId) return null;
    const seller = await ctx.db.get(sellerId);
    if (!seller) return null;

    const products = await ctx.db
      .query("products")
      .withIndex("by_seller", (s) => s.eq("sellerId", sellerId))
      .order("desc")
      .take(200);
    const active = products.filter((p) => p.status === "active");

    let ratingSum = 0;
    let ratingCount = 0;
    for (const product of active) {
      const reviews = await ctx.db
        .query("reviews")
        .withIndex("by_product", (s) => s.eq("productId", product._id))
        .take(50);
      for (const review of reviews) {
        ratingSum += review.rating;
        ratingCount += 1;
      }
    }

    return {
      id: sellerId,
      name: seller.name ?? seller.shopName ?? "Seller",
      shopName: seller.shopName,
      bio: seller.sellerBio,
      location: seller.location,
      image: seller.image ?? null,
      joinedAt: seller._creationTime,
      activeListings: active.length,
      totalListings: products.length,
      ratingCount,
      averageRating: ratingCount === 0 ? null : ratingSum / ratingCount,
    };
  },
});
