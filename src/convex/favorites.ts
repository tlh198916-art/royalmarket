import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requireUser } from "./lib";
import { mutation, query, type QueryCtx } from "./_generated/server";

async function enrichFavorite(ctx: QueryCtx, product: Doc<"products">) {
  const seller = await ctx.db.get(product.sellerId);
  const storageId = product.imageStorageIds?.[0];
  const imageUrl = storageId
    ? await ctx.storage.getUrl(storageId as Id<"_storage">)
    : null;
  return {
    ...product,
    imageUrl,
    seller: seller
      ? {
          id: seller._id,
          name: seller.name ?? seller.shopName ?? "Seller",
          shopName: seller.shopName,
          isSeller: !!seller.isSeller,
          joinedAt: seller._creationTime,
        }
      : null,
    available: product.status === "active" && product.quantity > 0,
  };
}

/** The signed-in user's saved products. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx).catch(() => null);
    if (!user) return [];
    const favorites = await ctx.db
      .query("favorites")
      .withIndex("by_user", (s) => s.eq("userId", user._id))
      .order("desc")
      .take(100);
    const products = (
      await Promise.all(favorites.map((f) => ctx.db.get(f.productId)))
    ).filter((p): p is Doc<"products"> => p !== null);
    const enriched = await Promise.all(products.map((p) => enrichFavorite(ctx, p)));
    return enriched;
  },
});

/** Ids only — cheap for card-level heart state. */
export const ids = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx).catch(() => null);
    if (!user) return [];
    const favorites = await ctx.db
      .query("favorites")
      .withIndex("by_user", (s) => s.eq("userId", user._id))
      .take(500);
    return favorites.map((f) => f.productId);
  },
});

export const toggle = mutation({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const product = await ctx.db.get(args.productId);
    if (!product) throw new Error("This listing no longer exists.");

    const existing = await ctx.db
      .query("favorites")
      .withIndex("by_user_product", (s) =>
        s.eq("userId", user._id).eq("productId", args.productId),
      )
      .unique();

    if (existing) {
      await ctx.db.delete(existing._id);
      return { favorited: false };
    }
    await ctx.db.insert("favorites", {
      userId: user._id,
      productId: args.productId,
    });
    return { favorited: true };
  },
});
