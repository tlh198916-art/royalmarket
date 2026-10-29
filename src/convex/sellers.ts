import { v } from "convex/values";
import { requireVerifiedUser } from "./lib";
import { mutation, query } from "./_generated/server";

const defaultFulfillmentArgs = v.object({
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

/**
 * Start (or update) a public seller profile. Verified accounts only.
 * Individual sellers are free forever; business sellers additionally need an
 * active subscription for business-only features (enforced where they're
 * used, not here — upgrading must never block or erase an existing seller).
 */
export const become = mutation({
  args: {
    shopName: v.string(),
    bio: v.optional(v.string()),
    location: v.optional(v.string()),
    sellerType: v.optional(v.literal("individual")),
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

    // A public onboarding call can only establish a free individual shop.
    // Paid business identity is assigned by the subscription flow.
    await ctx.db.patch(user._id, {
      isSeller: true,
      shopName,
      sellerBio: bio,
      location,
      // Do not allow client-supplied sellerType to unlock business features.
      sellerType: user.sellerType === "business" ? "business" : "individual",
      name: user.name ?? shopName,
    });
    return true;
  },
});

/** Save the seller's default fulfillment settings (used for new listings). */
export const setFulfillmentDefaults = mutation({
  args: { defaults: defaultFulfillmentArgs },
  handler: async (ctx, args) => {
    const user = await requireVerifiedUser(ctx);
    if (!user.isSeller)
      throw new Error("Set up your seller profile first.");
    const clean = (s: string | undefined, max: number) =>
      s?.trim().slice(0, max) || undefined;
    if (args.defaults.pickup.area && args.defaults.pickup.area.length > 120)
      throw new Error("Pickup area must be 120 characters or fewer.");
    if (args.defaults.delivery.area && args.defaults.delivery.area.length > 120)
      throw new Error("Delivery area must be 120 characters or fewer.");
    if (
      !Number.isInteger(args.defaults.shipping.handlingDays) ||
      args.defaults.shipping.handlingDays < 0 ||
      args.defaults.shipping.handlingDays > 60
    )
      throw new Error("Handling time must be between 0 and 60 days.");
    if (
      args.defaults.delivery.estimatedDays !== undefined &&
      (!Number.isInteger(args.defaults.delivery.estimatedDays) ||
        args.defaults.delivery.estimatedDays < 0 ||
        args.defaults.delivery.estimatedDays > 60)
    )
      throw new Error("Estimated delivery must be between 0 and 60 days.");
    for (const fee of [
      args.defaults.shipping.feeCents,
      args.defaults.delivery.feeCents,
    ]) {
      if (!Number.isFinite(fee) || fee < 0 || fee > 1_000_00)
        throw new Error("Fees must be between $0 and $1,000.");
    }
    await ctx.db.patch(user._id, {
      defaultFulfillment: {
        pickup: {
          enabled: args.defaults.pickup.enabled,
          area: clean(args.defaults.pickup.area, 120),
          instructions: clean(args.defaults.pickup.instructions, 500),
        },
        shipping: {
          enabled: args.defaults.shipping.enabled,
          feeCents: Math.round(args.defaults.shipping.feeCents),
          handlingDays: Math.min(
            60,
            Math.max(0, Math.round(args.defaults.shipping.handlingDays)),
          ),
          carrier: clean(args.defaults.shipping.carrier, 60),
          method: clean(args.defaults.shipping.method, 60),
        },
        delivery: {
          enabled: args.defaults.delivery.enabled,
          feeCents: Math.round(args.defaults.delivery.feeCents),
          area: clean(args.defaults.delivery.area, 120),
          estimatedDays: args.defaults.delivery.estimatedDays,
          contactRequired: args.defaults.delivery.contactRequired,
        },
      },
    });
    return true;
  },
});

/** Business sellers: update storefront branding. Gated on an active plan. */
export const updateBusinessProfile = mutation({
  args: {
    businessContact: v.optional(v.string()),
    storefrontSlug: v.optional(v.string()),
    logoStorageId: v.optional(v.string()),
    bannerStorageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireVerifiedUser(ctx);
    if (user.sellerType !== "business")
      throw new Error(
        "Branded storefronts are a business feature. Upgrade from your seller dashboard.",
      );
    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (s) => s.eq("userId", user._id))
      .order("desc")
      .first();
    if (!subscription || subscription.status !== "active")
      throw new Error(
        "An active business subscription is required to manage storefront branding.",
      );

    const patch: Partial<typeof user> = {};
    if (args.businessContact !== undefined) {
      const contact = args.businessContact.trim().slice(0, 200);
      patch.businessContact = contact || undefined;
    }
    if (args.storefrontSlug !== undefined) {
      const slug = args.storefrontSlug.trim().toLowerCase().slice(0, 60);
      if (slug && !/^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/.test(slug))
        throw new Error(
          "Storefront URL must be lowercase letters, numbers, and dashes.",
        );
      if (slug) {
        const taken = await ctx.db
          .query("users")
          .withIndex("by_storefront_slug", (s) => s.eq("storefrontSlug", slug))
          .first();
        if (taken && taken._id !== user._id)
          throw new Error("That storefront URL is already taken.");
      }
      patch.storefrontSlug = slug || undefined;
    }
    if (args.logoStorageId !== undefined)
      patch.businessLogoStorageId = args.logoStorageId || undefined;
    if (args.bannerStorageId !== undefined)
      patch.businessBannerStorageId = args.bannerStorageId || undefined;
    for (const storageId of [args.logoStorageId, args.bannerStorageId]) {
      if (!storageId) continue;
      // Storage IDs are only accepted from the account's own upload flow in
      // the seller dashboard. Database ownership cannot be proven from a
      // public storage ID, so only verify its syntactic table ID here.
      if (!storageId.startsWith("kg") && storageId.length < 8)
        throw new Error("The selected storefront image ID is invalid.");
    }

    await ctx.db.patch(user._id, patch);
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
    // Accept either a user id or a business storefront URL slug.
    let sellerId = ctx.db.normalizeId("users", args.sellerId);
    if (!sellerId) {
      const bySlug = await ctx.db
        .query("users")
        .withIndex("by_storefront_slug", (s) =>
          s.eq("storefrontSlug", args.sellerId.toLowerCase()),
        )
        .first();
      sellerId = bySlug?._id ?? null;
    }
    if (!sellerId) return null;
    const seller = await ctx.db.get(sellerId);
    if (!seller || !seller.isSeller) return null;

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
      sellerType: seller.sellerType ?? "individual",
      businessContact: seller.businessContact ?? null,
      businessLogoUrl: seller.businessLogoStorageId
        ? await ctx.storage.getUrl(seller.businessLogoStorageId as never)
        : null,
      businessBannerUrl: seller.businessBannerStorageId
        ? await ctx.storage.getUrl(seller.businessBannerStorageId as never)
        : null,
      storefrontSlug: seller.storefrontSlug ?? null,
    };
  },
});
