import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

type Ctx = QueryCtx | MutationCtx;

/** Current user document, or null when signed out. */
export async function getUser(
  ctx: Ctx,
): Promise<Doc<"users"> | null> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return null;
  return await ctx.db.get(userId);
}

/** Throws when signed out. */
export async function requireUser(ctx: Ctx): Promise<Doc<"users">> {
  const user = await getUser(ctx);
  if (!user) {
    throw new Error("You need to sign in to do that.");
  }
  return user;
}

/**
 * Throws unless the caller has a real, email-verified account.
 * Anonymous sessions are not considered verified — selling, buying and
 * listing all require a verified email.
 */
export async function requireVerifiedUser(ctx: Ctx): Promise<Doc<"users">> {
  const user = await requireUser(ctx);
  if (
    user.isAnonymous ||
    !user.email ||
    !user.emailVerificationTime
  ) {
    throw new Error(
      "Your account needs a verified email address before you can do that. Check your inbox for a code.",
    );
  }
  return user;
}

/** Throws unless the caller is an admin. */
export async function requireAdmin(ctx: Ctx): Promise<Doc<"users">> {
  const user = await requireUser(ctx);
  if (user.role !== "admin") {
    throw new Error("Admin access required.");
  }
  return user;
}

/** A product can be bought only when it is published and in stock. */
export function isPurchasable(
  product: Doc<"products"> | null,
): boolean {
  return !!product && product.status === "active" && product.quantity > 0;
}

/** Basic string validation shared by listing create/update. */
export function validateListingInput(args: {
  title: string;
  description: string;
  priceCents: number;
  quantity: number;
  categoryId: string;
}): string | null {
  const title = args.title.trim();
  const description = args.description.trim();
  if (title.length < 3) return "Title must be at least 3 characters.";
  if (title.length > 100) return "Title must be 100 characters or fewer.";
  if (description.length < 10)
    return "Description must be at least 10 characters.";
  if (description.length > 5000)
    return "Description must be 5000 characters or fewer.";
  if (!Number.isFinite(args.priceCents) || args.priceCents < 50)
    return "Price must be at least $0.50.";
  if (args.priceCents > 10_000_000)
    return "Price must be $100,000 or less.";
  if (!Number.isInteger(args.quantity) || args.quantity < 0)
    return "Inventory must be a whole number of 0 or more.";
  if (args.quantity > 100000) return "Inventory must be 100,000 or fewer.";
  if (!args.categoryId) return "Choose a category.";
  return null;
}

export function normalizeSearchQuery(q: string | undefined): string {
  return (q ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
}
