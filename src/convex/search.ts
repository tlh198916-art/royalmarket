import { v } from "convex/values";
import { isValidCategoryId } from "./categories";
import { enrich, excludeInternalTestListings } from "./products";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";

/** Text + ownership info for one listing (used by the AI actions in ai.ts). */
export const productCopy = internalQuery({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("products", args.id);
    if (!id) return null;
    const product = await ctx.db.get(id);
    if (!product) return null;
    return {
      id: product._id,
      sellerId: product.sellerId,
      title: product.title,
      description: product.description,
      categoryId: product.categoryId,
      condition: product.condition,
    };
  },
});

/** Listings that don't have an embedding yet (for the admin backfill). */
export const unindexedCopy = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    const products = await ctx.db
      .query("products")
      .filter((q) => q.eq(q.field("embedding"), undefined))
      .take(Math.min(Math.max(args.limit, 1), 20));
    return products.map((product) => ({
      id: product._id,
      title: product.title,
      description: product.description,
      categoryId: product.categoryId,
      condition: product.condition,
    }));
  },
});

/** Stores a freshly computed embedding on a listing. */
export const setEmbedding = internalMutation({
  args: { id: v.id("products"), embedding: v.array(v.number()) },
  handler: async (ctx, args) => {
    const product = await ctx.db.get(args.id);
    if (!product) return;
    await ctx.db.patch(args.id, { embedding: args.embedding });
  },
});

/** The enriched product shape the catalog UI renders (see products.enrich). */
export type EnrichedProduct = Awaited<ReturnType<typeof enrich>>;

/**
 * Hydrates ranked vector-match IDs into the same enriched shape the catalog
 * query returns. Order of `ids` (the relevance ranking) is preserved.
 */
export const hydrateProducts = internalQuery({
  args: {
    ids: v.array(v.string()),
    categoryId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.categoryId !== undefined && !isValidCategoryId(args.categoryId))
      return [];
    const ids = args.ids
      .slice(0, 64)
      .map((id) => ctx.db.normalizeId("products", id))
      .filter((id): id is Doc<"products">["_id"] => id !== null);
    const docs = (
      await Promise.all(ids.map((id) => ctx.db.get(id)))
    ).filter((p): p is Doc<"products"> => p !== null && p.status === "active");
    const publicDocs = await excludeInternalTestListings(ctx, docs);
    const filtered = args.categoryId
      ? publicDocs.filter((p) => p.categoryId === args.categoryId)
      : publicDocs;
    return await Promise.all(filtered.map((p) => enrich(ctx, p)));
  },
});
