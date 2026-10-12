import { v } from "convex/values";
import { isValidCategoryId } from "./categories";
import type { Doc, Id } from "./_generated/dataModel";
import {
  getUser,
  normalizeSearchQuery,
  requireUser,
  requireVerifiedUser,
  validateListingInput,
} from "./lib";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";

const sortValidator = v.union(
  v.literal("newest"),
  v.literal("price_asc"),
  v.literal("price_desc"),
  v.literal("popular"),
);

const shippingArgs = v.object({
  flatFeeCents: v.number(),
  shipsFrom: v.optional(v.string()),
  estimatedDays: v.number(),
});

const returnsArgs = v.object({
  accepted: v.boolean(),
  days: v.number(),
});

async function sellerPublicInfo(
  ctx: QueryCtx | MutationCtx,
  sellerId: Id<"users">,
) {
  const seller = await ctx.db.get(sellerId);
  if (!seller) return null;
  return {
    id: sellerId,
    name: seller.name ?? seller.shopName ?? "Seller",
    shopName: seller.shopName,
    bio: seller.sellerBio,
    location: seller.location,
    isSeller: !!seller.isSeller,
    joinedAt: seller._creationTime,
    image: seller.image,
  };
}

async function enrich(
  ctx: QueryCtx | MutationCtx,
  product: Doc<"products">,
) {
  const seller = await sellerPublicInfo(ctx, product.sellerId);
  const storageId = product.imageStorageIds?.[0];
  const imageUrl = storageId
    ? await ctx.storage.getUrl(storageId as Id<"_storage">)
    : null;
  return {
    ...product,
    seller,
    imageUrl,
    available: product.status === "active" && product.quantity > 0,
  };
}

function applySort(products: Doc<"products">[], sortBy: string) {
  const copy = [...products];
  switch (sortBy) {
    case "price_asc":
      return copy.sort((a, b) => a.priceCents - b.priceCents);
    case "price_desc":
      return copy.sort((a, b) => b.priceCents - a.priceCents);
    case "popular":
      return copy.sort((a, b) => b.views - a.views);
    default:
      return copy.sort((a, b) => b._creationTime - a._creationTime);
  }
}

/** Public catalog listing: search, category filter, sorting. */
export const list = query({
  args: {
    q: v.optional(v.string()),
    categoryId: v.optional(v.string()),
    sortBy: v.optional(sortValidator),
    sellerId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 48, 1), 200);
    const q = normalizeSearchQuery(args.q);
    // `undefined` means "no filter"; an empty/invalid id means "no matches"
    // (so callers can safely pass values from a still-loading query).
    const sellerFilter =
      args.sellerId === undefined
        ? null
        : ctx.db.normalizeId("users", args.sellerId);
    if (args.sellerId !== undefined && !sellerFilter) return [];
    if (args.categoryId !== undefined && !isValidCategoryId(args.categoryId))
      return [];
    let candidates: Doc<"products">[];

    if (q) {
      const [byTitle, byDescription] = await Promise.all([
        ctx.db
          .query("products")
          .withSearchIndex("search_title", (s) =>
            s.search("title", q).eq("status", "active"),
          )
          .take(limit),
        ctx.db
          .query("products")
          .withSearchIndex("search_description", (s) =>
            s.search("description", q).eq("status", "active"),
          )
          .take(limit),
      ]);
      const seen = new Set<string>();
      candidates = [...byTitle, ...byDescription].filter((p) => {
        if (seen.has(p._id)) return false;
        seen.add(p._id);
        return true;
      });
    } else if (sellerFilter) {
      candidates = await ctx.db
        .query("products")
        .withIndex("by_seller", (s) => s.eq("sellerId", sellerFilter))
        .order("desc")
        .take(500);
      candidates = candidates.filter((p) => p.status === "active");
    } else {
      candidates = await ctx.db
        .query("products")
        .withIndex("by_status", (s) => s.eq("status", "active"))
        .order("desc")
        .take(500);
    }

    if (args.categoryId) {
      candidates = candidates.filter((p) => p.categoryId === args.categoryId);
    }

    const sorted = applySort(candidates, args.sortBy ?? "newest").slice(
      0,
      limit,
    );
    const products = await Promise.all(sorted.map((p) => enrich(ctx, p)));
    return products;
  },
});

/** Lightweight bulk fetch for cart rows and recently-viewed strips. */
export const getByIds = query({
  args: { ids: v.array(v.string()) },
  handler: async (ctx, args) => {
    const ids = args.ids
      .slice(0, 24)
      .map((id) => ctx.db.normalizeId("products", id))
      .filter((id): id is Doc<"products">["_id"] => id !== null);
    const docs = await Promise.all(ids.map((id) => ctx.db.get(id)));
    const products = docs.filter((p): p is Doc<"products"> => p !== null);
    return await Promise.all(products.map((p) => enrich(ctx, p)));
  },
});

/** Public product detail. */
export const get = query({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    const productId = ctx.db.normalizeId("products", args.id);
    if (!productId) return null;
    const product = await ctx.db.get(productId);
    if (!product) return null;
    const viewer = await getUser(ctx);
    const imageUrls = await Promise.all(
      (product.imageStorageIds ?? []).map((id) =>
        ctx.storage.getUrl(id as Id<"_storage">),
      ),
    );
    const seller = await sellerPublicInfo(ctx, product.sellerId);
    return {
      ...product,
      seller,
      imageUrls: imageUrls.filter((u): u is string => u !== null),
      available: product.status === "active" && product.quantity > 0,
      isOwner: viewer?._id === product.sellerId,
    };
  },
});

/** The signed-in seller's own listings, including drafts. */
export const myListings = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx).catch(() => null);
    if (!user) return [];
    const products = await ctx.db
      .query("products")
      .withIndex("by_seller", (s) => s.eq("sellerId", user._id))
      .order("desc")
      .take(200);
    return await Promise.all(products.map((p) => enrich(ctx, p)));
  },
});

export const create = mutation({
  args: {
    title: v.string(),
    description: v.string(),
    categoryId: v.string(),
    priceCents: v.number(),
    quantity: v.number(),
    condition: v.union(
      v.literal("new"),
      v.literal("like_new"),
      v.literal("good"),
      v.literal("fair"),
    ),
    imageStorageIds: v.optional(v.array(v.string())),
    shipping: shippingArgs,
    returns: returnsArgs,
    publish: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await requireVerifiedUser(ctx);
    const title = args.title.trim();
    const description = args.description.trim();
    const error = validateListingInput({
      title,
      description,
      priceCents: args.priceCents,
      quantity: args.quantity,
      categoryId: args.categoryId,
    });
    if (error) throw new Error(error);
    if (!isValidCategoryId(args.categoryId))
      throw new Error("Choose a valid category.");
    if (
      !Number.isInteger(args.shipping.estimatedDays) ||
      args.shipping.estimatedDays < 1 ||
      args.shipping.estimatedDays > 90
    ) {
      throw new Error("Estimated shipping must be between 1 and 90 days.");
    }
    if (
      !Number.isFinite(args.shipping.flatFeeCents) ||
      args.shipping.flatFeeCents < 0 ||
      args.shipping.flatFeeCents > 100_000
    ) {
      throw new Error("Shipping fee must be between $0 and $1,000.");
    }
    if (args.returns.days < 0 || args.returns.days > 90) {
      throw new Error("Return window must be between 0 and 90 days.");
    }
    if (args.returns.days > 0 && !args.returns.accepted) {
      throw new Error("Return days should be 0 when returns are not accepted.");
    }

    const productId = await ctx.db.insert("products", {
      sellerId: user._id,
      title,
      description,
      categoryId: args.categoryId,
      priceCents: Math.round(args.priceCents),
      quantity: args.quantity,
      condition: args.condition,
      imageStorageIds: args.imageStorageIds?.slice(0, 8) ?? [],
      shipping: {
        flatFeeCents: Math.round(args.shipping.flatFeeCents),
        shipsFrom: args.shipping.shipsFrom?.trim().slice(0, 80) || undefined,
        estimatedDays: args.shipping.estimatedDays,
      },
      returns: {
        accepted: args.returns.accepted,
        days: args.returns.accepted ? args.returns.days : 0,
      },
      status: args.publish ? "active" : "draft",
      views: 0,
      soldCount: 0,
    });

    if (args.publish) {
      await ctx.db.insert("events", {
        type: "listing_created",
        userId: user._id,
        productId,
      });
    }
    return productId;
  },
});

export const update = mutation({
  args: {
    id: v.id("products"),
    title: v.string(),
    description: v.string(),
    categoryId: v.string(),
    priceCents: v.number(),
    quantity: v.number(),
    condition: v.union(
      v.literal("new"),
      v.literal("like_new"),
      v.literal("good"),
      v.literal("fair"),
    ),
    imageStorageIds: v.optional(v.array(v.string())),
    shipping: shippingArgs,
    returns: returnsArgs,
    status: v.union(v.literal("draft"), v.literal("active")),
  },
  handler: async (ctx, args) => {
    const user = await requireVerifiedUser(ctx);
    const existing = await ctx.db.get(args.id);
    if (!existing) throw new Error("This listing no longer exists.");
    const isAdmin = user.role === "admin";
    if (existing.sellerId !== user._id && !isAdmin)
      throw new Error("You can only edit your own listings.");
    if (existing.status === "removed" && !isAdmin)
      throw new Error(
        "This listing was taken down by a moderator. Contact support to resolve it.",
      );

    const title = args.title.trim();
    const description = args.description.trim();
    const error = validateListingInput({
      title,
      description,
      priceCents: args.priceCents,
      quantity: args.quantity,
      categoryId: args.categoryId,
    });
    if (error) throw new Error(error);
    if (!isValidCategoryId(args.categoryId))
      throw new Error("Choose a valid category.");

    const wasActive = existing.status === "active";
    await ctx.db.patch(args.id, {
      title,
      description,
      categoryId: args.categoryId,
      priceCents: Math.round(args.priceCents),
      quantity: args.quantity,
      condition: args.condition,
      imageStorageIds: args.imageStorageIds?.slice(0, 8) ?? [],
      shipping: {
        flatFeeCents: Math.round(args.shipping.flatFeeCents),
        shipsFrom: args.shipping.shipsFrom?.trim().slice(0, 80) || undefined,
        estimatedDays: args.shipping.estimatedDays,
      },
      returns: {
        accepted: args.returns.accepted,
        days: args.returns.accepted ? args.returns.days : 0,
      },
      status: args.status,
    });

    if (args.status === "active" && !wasActive) {
      await ctx.db.insert("events", {
        type: "listing_created",
        userId: user._id,
        productId: args.id,
      });
    }
    return args.id;
  },
});

/** Quick publish / unpublish from the seller dashboard. */
export const setStatus = mutation({
  args: {
    id: v.id("products"),
    status: v.union(v.literal("draft"), v.literal("active")),
  },
  handler: async (ctx, args) => {
    const user = await requireVerifiedUser(ctx);
    const existing = await ctx.db.get(args.id);
    if (!existing) throw new Error("This listing no longer exists.");
    if (existing.sellerId !== user._id && user.role !== "admin")
      throw new Error("You can only change your own listings.");
    if (existing.status === "removed")
      throw new Error(
        "This listing was taken down by a moderator. Contact support to resolve it.",
      );
    if (existing.status === args.status) return args.id;

    await ctx.db.patch(args.id, { status: args.status });
    if (args.status === "active") {
      await ctx.db.insert("events", {
        type: "listing_created",
        userId: user._id,
        productId: args.id,
      });
    }
    return args.id;
  },
});

/** Seller-initiated delete (admin can delete anything). */
export const remove = mutation({
  args: { id: v.id("products") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const existing = await ctx.db.get(args.id);
    if (!existing) return;
    if (existing.sellerId !== user._id && user.role !== "admin")
      throw new Error("You can only delete your own listings.");
    const orderItems = await ctx.db
      .query("orderItems")
      .withIndex("by_product", (s) => s.eq("productId", args.id))
      .take(1);
    if (orderItems.length > 0) {
      throw new Error(
        "This listing has order history and cannot be deleted. Set it to draft instead.",
      );
    }
    await ctx.db.delete(args.id);
  },
});

/** Counts a product view and records the analytics event. */
export const trackView = mutation({
  args: { id: v.id("products") },
  handler: async (ctx, args) => {
    const product = await ctx.db.get(args.id);
    if (!product || product.status !== "active") return;
    const user = await getUser(ctx);
    await ctx.db.patch(args.id, { views: product.views + 1 });
    await ctx.db.insert("events", {
      type: "product_view",
      userId: user?._id,
      productId: args.id,
    });
  },
});

/** Authenticated upload URL for listing photos. */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});
