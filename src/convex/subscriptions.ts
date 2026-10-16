import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { requireAdmin, requireVerifiedUser } from "./lib";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { DEFAULT_PLANS } from "./plans";
import type { PlanId } from "./schema";

const planIdArg = v.union(
  v.literal("starter"),
  v.literal("growth"),
  v.literal("pro"),
);

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Resolve platform plan settings, seeding defaults on first read-in-mutation
 * contexts. Queries fall back to a read-only default view when no doc exists
 * yet, so the pricing page always renders real numbers.
 */
export async function getSettings(ctx: MutationCtx): Promise<
  Doc<"platformSettings">
> {
  const existing = await ctx.db
    .query("platformSettings")
    .order("desc")
    .first();
  if (existing) return existing;
  const seeded = await ctx.db.insert("platformSettings", {
    plans: DEFAULT_PLANS.map((p) => ({
      id: p.id,
      name: p.name,
      priceCentsMonthly: p.priceCentsMonthly,
      commissionBps: p.commissionBps,
      active: true,
      features: p.features,
    })),
    commissionBase: "merchandise_subtotal",
    updatedAt: Date.now(),
    // Seeded lazily; backfilled with the first admin who opens settings.
    // A throwaway placeholder is not allowed by the validator, so we require
    // an admin caller to be present (getSettings is only called from
    // mutations that already required an admin or a verified seller).
    updatedBy: (
      (await ctx.db
        .query("users")
        .withIndex("by_role", (s) => s.eq("role", "admin"))
        .first()) ?? (await firstUser(ctx))
    )._id,
  });
  const doc = await ctx.db.get(seeded);
  if (!doc) throw new Error("Failed to seed platform settings.");
  return doc;
}

async function firstUser(ctx: MutationCtx): Promise<Doc<"users">> {
  const user = await ctx.db.query("users").order("desc").first();
  if (user) return user;
  throw new Error(
    "Platform settings cannot be seeded before the first account exists.",
  );
}

function publicPlanView(settings: Doc<"platformSettings">) {
  return {
    plans: settings.plans
      .filter((p) => p.active)
      .map((p) => ({
        id: p.id,
        name: p.name,
        priceCentsMonthly: p.priceCentsMonthly,
        commissionBps: p.commissionBps,
        features: p.features,
      })),
    commissionBase: settings.commissionBase,
  };
}

/** Public: active business plans for the pricing page (USD). */
export const publicPlans = query({
  args: {},
  handler: async (ctx) => {
    const settings = await ctx.db
      .query("platformSettings")
      .order("desc")
      .first();
    if (!settings) {
      return {
        plans: DEFAULT_PLANS.map((p) => ({
          id: p.id,
          name: p.name,
          priceCentsMonthly: p.priceCentsMonthly,
          commissionBps: p.commissionBps,
          features: p.features,
        })),
        commissionBase: "merchandise_subtotal" as const,
      };
    }
    return publicPlanView(settings);
  },
});

/** Admin: full settings including inactive plans. */
export const adminSettings = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const settings = await ctx.db
      .query("platformSettings")
      .order("desc")
      .first();
    return settings ?? null;
  },
});

/** Admin: update plan prices, commission rates, and commission base (USD). */
export const updateSettings = mutation({
  args: {
    plans: v.array(
      v.object({
        id: planIdArg,
        name: v.string(),
        priceCentsMonthly: v.number(),
        commissionBps: v.number(),
        active: v.boolean(),
        features: v.array(v.string()),
      }),
    ),
    commissionBase: v.union(
      v.literal("merchandise_subtotal"),
      v.literal("merchandise_plus_shipping"),
    ),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    if (args.plans.length !== 3)
      throw new Error("Exactly three plans must be configured.");
    for (const plan of args.plans) {
      const name = plan.name.trim();
      if (name.length < 2 || name.length > 60)
        throw new Error("Plan names must be 2–60 characters.");
      if (
        !Number.isFinite(plan.priceCentsMonthly) ||
        plan.priceCentsMonthly < 0 ||
        plan.priceCentsMonthly > 10_000_00
      )
        throw new Error("Monthly price must be between $0 and $10,000.");
      if (
        !Number.isFinite(plan.commissionBps) ||
        plan.commissionBps < 0 ||
        plan.commissionBps > 5_000
      )
        throw new Error("Commission must be between 0% and 50%.");
      if (plan.features.length > 30)
        throw new Error("Too many feature rows.");
    }
    // Never let every plan be hidden — sellers need somewhere to land.
    if (!args.plans.some((p) => p.active))
      throw new Error("At least one plan must stay active.");

    const settings = await getSettings(ctx);
    await ctx.db.patch(settings._id, {
      plans: args.plans.map((p) => ({
        ...p,
        name: p.name.trim(),
        features: p.features.map((f) => f.trim()).filter(Boolean),
      })),
      commissionBase: args.commissionBase,
      updatedAt: Date.now(),
      updatedBy: admin._id,
    });
    return true;
  },
});

/** The viewer's current subscription (most recent row), if any. */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (s) => s.eq("userId", userId))
      .order("desc")
      .first();
    return sub ?? null;
  },
});

/**
 * Subscribe to a business plan. Prices and commission rates are read from
 * platformSettings on the backend — the client cannot set its own terms.
 * No charge happens here: card payments are not configured yet, so the
 * subscription starts as "pending" until an administrator confirms payment.
 */
export const subscribe = mutation({
  args: {
    planId: planIdArg,
    agreedToTerms: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await requireVerifiedUser(ctx);
    if (!args.agreedToTerms)
      throw new Error(
        "You must agree to the seller terms and fee disclosure before subscribing.",
      );

    const settings = await getSettings(ctx);
    const plan = settings.plans.find((p) => p.id === args.planId && p.active);
    if (!plan)
      throw new Error("That plan is not currently available.");

    const existing = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (s) => s.eq("userId", user._id))
      .order("desc")
      .first();
    if (existing && (existing.status === "active" || existing.status === "pending")) {
      throw new Error(
        "You already have a subscription. Change or cancel your plan from the seller dashboard instead.",
      );
    }

    const subId = await ctx.db.insert("subscriptions", {
      userId: user._id,
      planId: plan.id,
      planName: plan.name,
      // Snapshot the agreed terms — later admin price changes don't rewrite
      // what this seller accepted.
      priceCentsMonthly: plan.priceCentsMonthly,
      commissionBps: plan.commissionBps,
      status: "pending",
      agreedAt: Date.now(),
    });

    // Business identity: keep products, orders, reviews, and history intact.
    await ctx.db.patch(user._id, { sellerType: "business", isSeller: true });
    return subId;
  },
});

/** Seller cancels their subscription. Account, listings, and orders remain. */
export const cancel = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireVerifiedUser(ctx);
    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (s) => s.eq("userId", user._id))
      .order("desc")
      .first();
    if (!sub || sub.status === "cancelled")
      throw new Error("No active subscription to cancel.");
    await ctx.db.patch(sub._id, {
      status: "cancelled",
      cancelledAt: Date.now(),
    });
    // Business-only features switch off; the seller keeps everything as an
    // individual seller (listings, orders, history, reviews).
    await ctx.db.patch(user._id, { sellerType: "individual" });
    return true;
  },
});

/** Seller switches between plans (upgrade or downgrade). */
export const changePlan = mutation({
  args: { planId: planIdArg, agreedToTerms: v.boolean() },
  handler: async (ctx, args) => {
    const user = await requireVerifiedUser(ctx);
    if (!args.agreedToTerms)
      throw new Error("You must agree to the terms for the new plan.");
    const current = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (s) => s.eq("userId", user._id))
      .order("desc")
      .first();
    if (!current || current.status !== "active")
      throw new Error("Only an active subscription can change plans.");
    if (current.planId === args.planId)
      throw new Error("You are already on that plan.");

    const settings = await getSettings(ctx);
    const plan = settings.plans.find((p) => p.id === args.planId && p.active);
    if (!plan) throw new Error("That plan is not currently available.");

    // New agreement row keeps the audit trail of previous terms intact.
    await ctx.db.patch(current._id, {
      status: "cancelled",
      cancelledAt: Date.now(),
      paymentNote: `Switched to ${plan.name}`,
    });
    const subId = await ctx.db.insert("subscriptions", {
      userId: user._id,
      planId: plan.id,
      planName: plan.name,
      priceCentsMonthly: plan.priceCentsMonthly,
      commissionBps: plan.commissionBps,
      status: "pending",
      agreedAt: Date.now(),
    });
    return subId;
  },
});

/** Admin: list all subscriptions with seller info. */
export const adminList = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const subs = await ctx.db.query("subscriptions").order("desc").take(200);
    return await Promise.all(
      subs.map(async (sub) => {
        const seller = await ctx.db.get(sub.userId);
        return {
          ...sub,
          sellerName: seller?.shopName ?? seller?.name ?? "Unknown",
          sellerEmail: seller?.email ?? null,
        };
      }),
    );
  },
});

/**
 * Admin: confirm a seller's payment and activate their subscription.
 * Stand-in for a payment-provider webhook: since card payments are not
 * configured, billing is confirmed manually and the activation is recorded.
 */
export const adminActivate = mutation({
  args: {
    subscriptionId: v.id("subscriptions"),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const sub = await ctx.db.get(args.subscriptionId);
    if (!sub) throw new Error("Subscription not found.");
    if (sub.status !== "pending")
      throw new Error("Only pending subscriptions can be activated.");
    const now = Date.now();
    await ctx.db.patch(sub._id, {
      status: "active",
      startedAt: now,
      renewsAt: now + MONTH_MS,
      activatedBy: admin._id,
      paymentNote: args.note?.trim().slice(0, 300) || undefined,
    });
    await ctx.db.patch(sub.userId, {
      sellerType: "business",
      isSeller: true,
    });
    return true;
  },
});

/** Admin: cancel any seller's subscription. */
export const adminCancel = mutation({
  args: { subscriptionId: v.id("subscriptions") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const sub = await ctx.db.get(args.subscriptionId);
    if (!sub) throw new Error("Subscription not found.");
    if (sub.status === "cancelled") return true;
    await ctx.db.patch(sub._id, {
      status: "cancelled",
      cancelledAt: Date.now(),
    });
    const seller = await ctx.db.get(sub.userId);
    if (seller?.sellerType === "business") {
      await ctx.db.patch(sub.userId, { sellerType: "individual" });
    }
    return true;
  },
});

/** Effective commission rate for a seller (bps), or 0 for individuals. */
export async function sellerCommissionBps(
  ctx: MutationCtx,
  sellerId: Doc<"users">["_id"],
): Promise<{ bps: number; planId: PlanId | null }> {
  const seller = await ctx.db.get(sellerId);
  if (!seller || seller.sellerType !== "business") return { bps: 0, planId: null };
  const sub = await ctx.db
    .query("subscriptions")
    .withIndex("by_user", (s) => s.eq("userId", sellerId))
    .order("desc")
    .first();
  if (!sub || sub.status !== "active") return { bps: 0, planId: null };
  return { bps: sub.commissionBps, planId: sub.planId };
}
