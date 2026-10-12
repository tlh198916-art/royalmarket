import { v } from "convex/values";
import { getUser, normalizeSearchQuery } from "./lib";
import { mutation } from "./_generated/server";

/**
 * Records a growth event from the client. Identity is attached when the
 * visitor is signed in. Product views are recorded server-side via
 * products.trackView; this covers searches, add-to-cart, etc.
 */
export const track = mutation({
  args: {
    type: v.union(
      v.literal("search"),
      v.literal("add_to_cart"),
      v.literal("product_view"),
    ),
    query: v.optional(v.string()),
    productId: v.optional(v.id("products")),
  },
  handler: async (ctx, args) => {
    const user = await getUser(ctx);
    let queryText: string | undefined;
    if (args.type === "search") {
      queryText = normalizeSearchQuery(args.query);
      if (!queryText) return; // never record empty searches
    }
    if (args.productId) {
      const product = await ctx.db.get(args.productId);
      if (!product) return;
      if (args.type === "product_view") {
        // views are counted by products.trackView to keep one event per view
        return;
      }
    }
    await ctx.db.insert("events", {
      type: args.type,
      userId: user?._id,
      productId: args.productId,
      query: queryText,
    });
  },
});

/**
 * Records a signup exactly once per account. Called after a verified
 * email sign-in completes.
 */
export const trackSignup = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await getUser(ctx);
    if (!user || user.isAnonymous || !user.emailVerificationTime) {
      return { created: false };
    }
    const existing = await ctx.db
      .query("events")
      .withIndex("by_type", (s) => s.eq("type", "signup"))
      .order("desc")
      .take(1000);
    if (existing.some((e) => e.userId === user._id)) {
      return { created: false };
    }
    await ctx.db.insert("events", { type: "signup", userId: user._id });
    return { created: true };
  },
});
