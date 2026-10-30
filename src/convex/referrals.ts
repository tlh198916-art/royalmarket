import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { getUser, requireVerifiedUser } from "./lib";
import { mutation, query } from "./_generated/server";
import { ensureReferralCode } from "./sellers";

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

    const rows = await ctx.db
      .query("referrals")
      .withIndex("by_inviter", (s) => s.eq("inviterId", user._id))
      .order("desc")
      .take(100);

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

    return {
      code: user.referralCode ?? null,
      inviteCount: rows.length,
      activeInvitees: invites.filter((i) => i.stillSelling).length,
      invites,
    };
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
