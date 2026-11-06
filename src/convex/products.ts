import { v } from "convex/values";
import { isValidCategoryId } from "./categories";
import type { Doc, Id } from "./_generated/dataModel";
import {
  getUser,
  isMarketplaceAdmin,
  normalizeSearchQuery,
  requireUser,
  requireVerifiedUser,
  validateListingInput,
  validateReturnsInput,
} from "./lib";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";

const sortValidator = v.union(
  v.literal("newest"),
  v.literal("price_asc"),
  v.literal("price_desc"),
  v.literal("popular"),
  v.literal("featured"),
);

// Test accounts used by the Stripe/E2E harness. Their products stay in the
// database for auditability but must never surface in public marketplace feeds.
const INTERNAL_TEST_SELLER_EMAILS = new Set([
  "royalmarket-e2e@mailinator.com",
  "e2e-test-royalmarket@example.com",
]);
const INTERNAL_TEST_TITLE =
  /^(?:\[(?:test|e2e|internal)\]|e2e\b|test product\b|test listing\b|stripe test\b|internal test\b|qa test\b)/i;

function isInternalTestSellerEmail(email: string | null | undefined): boolean {
  const normalized = (email ?? "").trim().toLowerCase();
  return (
    INTERNAL_TEST_SELLER_EMAILS.has(normalized) ||
    normalized.endsWith("@mailinator.com")
  );
}

function isInternalTestListingTitle(title: string): boolean {
  return INTERNAL_TEST_TITLE.test(title.trim());
}

/** Hide internal test inventory from every public product feed. */
export async function excludeInternalTestListings(
  ctx: QueryCtx | MutationCtx,
  candidates: Doc<"products">[],
) {
  if (candidates.length === 0) return candidates;
  const sellerIds = [...new Set(candidates.map((product) => product.sellerId))];
  const sellers = await Promise.all(
    sellerIds.map((sellerId) => ctx.db.get(sellerId)),
  );
  const hiddenSellers = new Set(
    sellerIds.filter((_, index) =>
      isInternalTestSellerEmail(sellers[index]?.email),
    ),
  );
  return candidates.filter(
    (product) =>
      !hiddenSellers.has(product.sellerId) &&
      !isInternalTestListingTitle(product.title),
  );
}

async function isInternalTestListing(
  ctx: QueryCtx,
  product: Doc<"products">,
) {
  if (isInternalTestListingTitle(product.title)) return true;
  const seller = await ctx.db.get(product.sellerId);
  return isInternalTestSellerEmail(seller?.email);
}

const returnsArgs = v.object({
  accepted: v.boolean(),
  days: v.number(),
});

const fulfillmentArgs = v.object({
  pickup: v.object({
    enabled: v.boolean(),
    area: v.optional(v.string()),
    instructions: v.optional(v.string()),
  }),
  shipping: v.object({
    enabled: v.boolean(),
    feeCents: v.number(),
    handlingDays: v.number(),
    carrier: v.optional(v.string()),
    method: v.optional(v.string()),
  }),
  delivery: v.object({
    enabled: v.boolean(),
    feeCents: v.number(),
    area: v.optional(v.string()),
    estimatedDays: v.optional(v.number()),
    contactRequired: v.boolean(),
  }),
});

/** Validate + normalize a seller's per-product fulfillment settings. */
function normalizeFulfillment(input: {
  pickup: { enabled: boolean; area?: string; instructions?: string };
  shipping: {
    enabled: boolean;
    feeCents: number;
    handlingDays: number;
    carrier?: string;
    method?: string;
  };
  delivery: {
    enabled: boolean;
    feeCents: number;
    area?: string;
    estimatedDays?: number;
    contactRequired: boolean;
  };
}) {
  if (!input.pickup.enabled && !input.shipping.enabled && !input.delivery.enabled) {
    throw new Error(
      "Enable at least one fulfillment option: local pickup, shipping, or local delivery.",
    );
  }
  const clean = (s: string | undefined, max: number) =>
    s?.trim().slice(0, max) || undefined;
  for (const fee of [input.shipping.feeCents, input.delivery.feeCents]) {
    if (!Number.isFinite(fee) || fee < 0 || fee > 1_000_00)
      throw new Error("Fulfillment fees must be between $0 and $1,000.");
  }
  if (
    !Number.isInteger(input.shipping.handlingDays) ||
    input.shipping.handlingDays < 0 ||
    input.shipping.handlingDays > 60
  )
    throw new Error("Handling time must be 0–60 days.");
  if (
    input.delivery.estimatedDays !== undefined &&
    (!Number.isInteger(input.delivery.estimatedDays) ||
      input.delivery.estimatedDays < 0 ||
      input.delivery.estimatedDays > 60)
  )
    throw new Error("Estimated delivery must be 0–60 days.");
  if (input.pickup.enabled && !clean(input.pickup.area, 120))
    throw new Error("Add a pickup city or general area (not your address).");
  if (input.delivery.enabled && !clean(input.delivery.area, 120))
    throw new Error("Add the local area you deliver to.");
  if (
    (input.pickup.area?.length ?? 0) > 120 ||
    (input.delivery.area?.length ?? 0) > 120
  )
    throw new Error("Pickup/delivery areas must be 120 characters or fewer.");

  return {
    pickup: {
      enabled: input.pickup.enabled,
      area: clean(input.pickup.area, 120),
      instructions: clean(input.pickup.instructions, 500),
    },
    shipping: {
      enabled: input.shipping.enabled,
      feeCents: Math.round(input.shipping.feeCents),
      handlingDays: input.shipping.handlingDays,
      carrier: clean(input.shipping.carrier, 60),
      method: clean(input.shipping.method, 60),
    },
    delivery: {
      enabled: input.delivery.enabled,
      feeCents: Math.round(input.delivery.feeCents),
      area: clean(input.delivery.area, 120),
      estimatedDays: input.delivery.estimatedDays,
      contactRequired: input.delivery.contactRequired,
    },
  };
}

async function sellerPublicInfo(
  ctx: QueryCtx | MutationCtx,
  sellerId: Id<"users">,
) {
  const seller = await ctx.db.get(sellerId);
  if (!seller?.isSeller) return null;
  return {
    id: sellerId,
    name: seller.name ?? seller.shopName ?? "Seller",
    shopName: seller.shopName,
    bio: seller.sellerBio,
    location: seller.location,
    isSeller: true,
    joinedAt: seller._creationTime,
    image: seller.image,
    sellerType: seller.sellerType ?? "individual",
    // Email-verified sellers get the public trust badge. Unverified sessions
    // can never create listings, so this is true for every real shop.
    verifiedSeller: !!seller.emailVerificationTime && !seller.isAnonymous,
  };
}

export async function enrich(
  ctx: QueryCtx | MutationCtx,
  product: Doc<"products">,
) {
  const seller = await sellerPublicInfo(ctx, product.sellerId);
  const imageUrls = await Promise.all(
    (product.imageStorageIds ?? []).map((storageId) =>
      ctx.storage.getUrl(storageId as Id<"_storage">),
    ),
  );
  const { moderatorNote: _moderatorNote, embedding: _embedding, ...publicProduct } = product;
  void _moderatorNote;
  void _embedding;
  const ratingCount = product.ratingCount ?? 0;
  return {
    ...publicProduct,
    seller,
    imageUrl: imageUrls[0] ?? null,
    imageUrls: imageUrls.filter((url): url is string => url !== null),
    available: product.status === "active" && product.quantity > 0,
    ratingAverage:
      ratingCount > 0 ? (product.ratingSum ?? 0) / ratingCount : null,
    ratingCount,
    featured: !!product.featuredAt,
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
    case "featured":
      return copy.sort((a, b) => {
        const aFeatured = a.featuredAt ?? 0;
        const bFeatured = b.featuredAt ?? 0;
        if (aFeatured !== bFeatured) return bFeatured - aFeatured;
        return b._creationTime - a._creationTime;
      });
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
    // Filter by fulfillment availability. Listings created before the
    // fulfillment feature (no config) count as pickup/shipping-capable.
    fulfillment: v.optional(
      v.union(v.literal("pickup"), v.literal("shipping"), v.literal("delivery")),
    ),
    minPriceCents: v.optional(v.number()),
    maxPriceCents: v.optional(v.number()),
    // Minimum average rating (e.g. 4 shows listings rated 4.0 and up).
    minRating: v.optional(v.number()),
    condition: v.optional(
      v.union(
        v.literal("new"),
        v.literal("like_new"),
        v.literal("good"),
        v.literal("fair"),
      ),
    ),
    featuredOnly: v.optional(v.boolean()),
    // Restrict a feed to listings that can actually be bought right now.
    availableOnly: v.optional(v.boolean()),
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
      // Over-fetch so post-filters (price/rating/condition) still have room.
      const searchLimit = Math.min(limit * 3, 200);
      const [byTitle, byDescription] = await Promise.all([
        ctx.db
          .query("products")
          .withSearchIndex("search_title", (s) =>
            s.search("title", q).eq("status", "active"),
          )
          .take(searchLimit),
        ctx.db
          .query("products")
          .withSearchIndex("search_description", (s) =>
            s.search("description", q).eq("status", "active"),
          )
          .take(searchLimit),
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

    candidates = await excludeInternalTestListings(ctx, candidates);

    if (args.categoryId) {
      candidates = candidates.filter((p) => p.categoryId === args.categoryId);
    }

    if (args.fulfillment) {
      candidates = candidates.filter((p) => {
        if (!p.fulfillment) {
          // Legacy listings: pickup or shipping negotiated directly.
          return args.fulfillment !== "delivery";
        }
        if (args.fulfillment === "pickup") return p.fulfillment.pickup.enabled;
        if (args.fulfillment === "shipping")
          return p.fulfillment.shipping.enabled;
        return p.fulfillment.delivery.enabled;
      });
    }

    if (args.minPriceCents !== undefined || args.maxPriceCents !== undefined) {
      const min = args.minPriceCents ?? 0;
      const max = args.maxPriceCents ?? Number.POSITIVE_INFINITY;
      if (min > max) return [];
      candidates = candidates.filter(
        (p) => p.priceCents >= min && p.priceCents <= max,
      );
    }

    if (args.condition) {
      candidates = candidates.filter((p) => p.condition === args.condition);
    }

    if (args.minRating !== undefined && args.minRating > 0) {
      candidates = candidates.filter((p) => {
        const count = p.ratingCount ?? 0;
        if (count === 0) return false;
        return (p.ratingSum ?? 0) / count >= args.minRating!;
      });
    }

    if (args.featuredOnly) {
      // "Featured" is advertised as a live-listing section, so zero-stock
      // items must not appear there even if an admin featured them earlier.
      candidates = candidates.filter(
        (p) => !!p.featuredAt && p.quantity > 0,
      );
    }

    if (args.availableOnly) {
      candidates = candidates.filter((p) => p.quantity > 0);
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
    const publicProducts = await excludeInternalTestListings(ctx, products);
    // This is a public bulk lookup (cart/recently viewed), so it must obey the
    // same visibility rule as the catalog: drafts, paused and removed listings
    // are never exposed just because a caller knows their id. Active sold-out
    // listings stay visible so checkout can explain the stock issue.
    return await Promise.all(
      publicProducts
        .filter((product) => product.status === "active")
        .map((product) => enrich(ctx, product)),
    );
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
    const isOwner = viewer?._id === product.sellerId;
    const viewerIsAdmin = isMarketplaceAdmin(viewer);
    if (product.status !== "active" && !isOwner && !viewerIsAdmin) {
      return null;
    }
    if (
      !isOwner &&
      !viewerIsAdmin &&
      (await isInternalTestListing(ctx, product))
    ) {
      return null;
    }
    const imageUrls = await Promise.all(
      (product.imageStorageIds ?? []).map((id) =>
        ctx.storage.getUrl(id as Id<"_storage">),
      ),
    );
    const seller = await sellerPublicInfo(ctx, product.sellerId);
    const { moderatorNote: _moderatorNote, embedding: _embedding, ...publicProduct } = product;
    void _moderatorNote;
    void _embedding;
    const ratingCount = product.ratingCount ?? 0;
    return {
      ...publicProduct,
      seller,
      imageUrls: imageUrls.filter((u): u is string => u !== null),
      available: product.status === "active" && product.quantity > 0,
      isOwner,
      ratingAverage:
        ratingCount > 0 ? (product.ratingSum ?? 0) / ratingCount : null,
      ratingCount,
      featured: !!product.featuredAt,
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
    returns: returnsArgs,
    fulfillment: fulfillmentArgs,
    publish: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await requireVerifiedUser(ctx);
    // Publishing requires a seller profile. Without this check a verified
    // account with no shop could create listings, and buyers would land on a
    // seller page that returns null because the account never became a seller.
    if (!user.isSeller)
      throw new Error(
        "Set up your free seller profile before publishing a listing.",
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
    const returnsError = validateReturnsInput(args.returns);
    if (returnsError) throw new Error(returnsError);

    const productId = await ctx.db.insert("products", {
      sellerId: user._id,
      title,
      description,
      categoryId: args.categoryId,
      priceCents: Math.round(args.priceCents),
      quantity: args.quantity,
      condition: args.condition,
      imageStorageIds: args.imageStorageIds?.slice(0, 8) ?? [],
      returns: {
        accepted: args.returns.accepted,
        days: args.returns.accepted ? args.returns.days : 0,
      },
      fulfillment: normalizeFulfillment(args.fulfillment),
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
    returns: returnsArgs,
    fulfillment: fulfillmentArgs,
    status: v.union(v.literal("draft"), v.literal("active")),
  },
  handler: async (ctx, args) => {
    const user = await requireVerifiedUser(ctx);
    const existing = await ctx.db.get(args.id);
    if (!existing) throw new Error("This listing no longer exists.");
    const isAdmin = isMarketplaceAdmin(user);
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
    const returnsError = validateReturnsInput(args.returns);
    if (returnsError) throw new Error(returnsError);

    const wasActive = existing.status === "active";
    await ctx.db.patch(args.id, {
      title,
      description,
      categoryId: args.categoryId,
      priceCents: Math.round(args.priceCents),
      quantity: args.quantity,
      condition: args.condition,
      imageStorageIds: args.imageStorageIds?.slice(0, 8) ?? [],
      returns: {
        accepted: args.returns.accepted,
        days: args.returns.accepted ? args.returns.days : 0,
      },
      fulfillment: normalizeFulfillment(args.fulfillment),
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
    if (existing.sellerId !== user._id && !isMarketplaceAdmin(user))
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
    if (existing.sellerId !== user._id && !isMarketplaceAdmin(user))
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

/** Upload URL for listing photos and storefront branding. */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    // Verified accounts only: an unverified session must not be able to write
    // files into marketplace storage.
    await requireVerifiedUser(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});
