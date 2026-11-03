import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { getUser, requireVerifiedUser } from "./lib";
import { mutation, query } from "./_generated/server";
import { ensureReferralCode } from "./sellers";

const MAX_TRACKED_VISITS = 2000;

/**
 * Seller-to-seller referral program.
 *
 * Every seller has a shareable code (`/sell?ref=CODE`). When a new account
 * opens its shop with that code the attribution is stored once. This is a
 * recognition/recruitment program: no cash payouts are calculated here.
 */
export const myReferrals = query({
  args: {},
  handler: async (ctx) => {
    const user = await getUser(ctx);
    if (!user || !user.isSeller) return null;

    const [rows, visits] = await Promise.all([
      ctx.db
        .query("referrals")
        .withIndex("by_inviter", (s) => s.eq("inviterId", user._id))
        .order("desc")
        .take(100),
      ctx.db
        .query("referralVisits")
        .withIndex("by_inviter", (s) => s.eq("inviterId", user._id))
        .order("desc")
        .take(MAX_TRACKED_VISITS),
    ]);

    const invites = await Promise.all(
      rows.map(async (row) => {
        const invitee = await ctx.db.get(row.inviteeId);
        return {
          _id: row._id,
          shopName: invitee?.shopName ?? null,
          name: invitee?.name ?? null,
          joinedAt: row._creationTime,
          stillSelling: !!invitee?.isSeller,
          listings: invitee
            ? (
                await ctx.db
                  .query("products")
                  .withIndex("by_seller", (s) => s.eq("sellerId", row.inviteeId))
                  .take(100)
              ).filter((p) => p.status === "active").length
            : 0,
        };
      }),
    );

    const visitsLast30Days = visits.filter(
      (visit) => visit._creationTime >= Date.now() - 30 * 24 * 60 * 60 * 1000,
    ).length;

    return {
      code: user.referralCode ?? null,
      inviteCount: rows.length,
      activeInvitees: invites.filter((i) => i.stillSelling).length,
      totalListings: invites.reduce((sum, invite) => sum + invite.listings, 0),
      visits: visits.length,
      visitsLast30Days,
      // Shop setups ÷ tracked link visits. Small samples are noisy, so the UI
      // presents this alongside the raw numbers rather than as a promise.
      conversionRate:
        visits.length === 0 ? null : (rows.length / visits.length) * 100,
      invites,
    };
  },
});

/**
 * Records one anonymous visit per browser session and invite code. The
 * visitor key is random and lives in sessionStorage; no IP, email, or user
 * agent is stored. Signed-in invitees visiting their own link are ignored.
 */
export const trackVisit = mutation({
  args: {
    code: v.string(),
    visitorKey: v.string(),
    source: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const code = args.code.trim().toUpperCase().slice(0, 12);
    const visitorKey = args.visitorKey.trim().slice(0, 64);
    if (!code || visitorKey.length < 8) return { tracked: false };

    const inviter = await ctx.db
      .query("users")
      .withIndex("by_referral_code", (s) => s.eq("referralCode", code))
      .first();
    if (!inviter || !inviter.isSeller) return { tracked: false };

    const viewer = await getUser(ctx);
    if (viewer?._id === inviter._id) return { tracked: false };

    const duplicate = await ctx.db
      .query("referralVisits")
      .withIndex("by_code_visitor", (s) =>
        s.eq("code", code).eq("visitorKey", visitorKey),
      )
      .first();
    if (duplicate) return { tracked: false };

    await ctx.db.insert("referralVisits", {
      inviterId: inviter._id,
      code,
      visitorKey,
      source: args.source?.trim().slice(0, 40) || "sell-link",
    });
    return { tracked: true };
  },
});

/**
 * Creates the caller's share code if they don't have one yet. Existing
 * sellers created before the program get theirs the first time they open the
 * referral tab; new sellers get one during shop setup.
 */
export const ensureCode = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireVerifiedUser(ctx);
    if (!user.isSeller)
      throw new Error("Set up your seller profile first.");
    if (user.referralCode) return user.referralCode;
    return await ensureReferralCode(ctx, user._id);
  },
});

/** Public recognition board: sellers with the most verified invites. */
export const leaderboard = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 5, 1), 20);
    const rows = await ctx.db.query("referrals").collect();
    const counts = new Map<string, number>();
    for (const row of rows) {
      counts.set(row.inviterId, (counts.get(row.inviterId) ?? 0) + 1);
    }
    const ranked = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);
    return await Promise.all(
      ranked.map(async ([sellerId, inviteCount]) => {
        const seller = await ctx.db.get(sellerId as Id<"users">);
        return {
          sellerId,
          shopName: seller?.shopName ?? seller?.name ?? "Seller",
          inviteCount,
        };
      }),
    );
  },
});
