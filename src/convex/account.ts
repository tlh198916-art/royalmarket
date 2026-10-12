import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { requireAdmin, requireUser } from "./lib";
import { mutation, query } from "./_generated/server";

/**
 * Public support contact: files a real ticket that admins see on the
 * admin dashboard.
 */
export const createTicket = mutation({
  args: {
    name: v.string(),
    email: v.string(),
    subject: v.string(),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const name = args.name.trim();
    const email = args.email.trim().toLowerCase();
    const subject = args.subject.trim();
    const message = args.message.trim();

    if (name.length < 2) throw new Error("Enter your name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new Error("Enter a valid email address so we can reply.");
    if (subject.length < 3) throw new Error("Add a short subject.");
    if (subject.length > 120) throw new Error("Subject is too long.");
    if (message.length < 10) throw new Error("Tell us a bit more (10+ characters).");
    if (message.length > 4000) throw new Error("Message must be 4000 characters or fewer.");

    const userId = await getAuthUserId(ctx);

    await ctx.db.insert("tickets", {
      name,
      email,
      subject,
      message,
      userId: userId ?? undefined,
      status: "open",
    });
    return true;
  },
});

/** Admin: recent support tickets. */
export const listTickets = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await ctx.db.query("tickets").order("desc").take(50);
  },
});

/** Admin: close a ticket with a response note. */
export const closeTicket = mutation({
  args: { ticketId: v.id("tickets"), responseNote: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const ticket = await ctx.db.get(args.ticketId);
    if (!ticket) throw new Error("Ticket not found.");
    await ctx.db.patch(args.ticketId, {
      status: "closed",
      responseNote: args.responseNote?.trim().slice(0, 1000) || undefined,
    });
    return true;
  },
});

/** Seller/buyer profile preferences (e.g. optional marketing consent). */
export const setPreferences = mutation({
  args: {
    marketingOptIn: v.boolean(),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const patch: { marketingOptIn: boolean; name?: string } = {
      marketingOptIn: args.marketingOptIn,
    };
    if (args.name !== undefined) {
      const name = args.name.trim();
      if (name.length < 2) throw new Error("Enter at least 2 characters.");
      if (name.length > 60) throw new Error("Name must be 60 characters or fewer.");
      patch.name = name;
    }
    await ctx.db.patch(user._id, patch);
    return true;
  },
});
