import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { eventSlug, FOUNDING_EVENT } from "./eventDefaults";
import { requireAdmin, requireVerifiedUser } from "./lib";
import type { Doc, Id } from "./_generated/dataModel";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";

/**
 * Seller-attract marketing events (e.g. the Founding Sellers Launch Event).
 *
 * The table is named marketEvents because `events` is the analytics table.
 * The default event lives in code (eventDefaults.ts) so the feature works
 * with zero setup: `list` serves it before a row exists, and `register`
 * persists it on the first sign-up. Admins manage real rows via adminList /
 * adminCreate / adminUpdate (create, edit, publish, cancel).
 */

const eventStatusValidator = v.union(
  v.literal("draft"),
  v.literal("published"),
  v.literal("cancelled"),
);

const MAX_DETAILS = 12;

type EventDoc = Doc<"marketEvents">;
type RegistrationDoc = Doc<"eventRegistrations">;

const eventInputArgs = {
  title: v.string(),
  tagline: v.string(),
  details: v.array(v.string()),
  startsAt: v.number(), // epoch ms (UTC)
  durationMinutes: v.number(),
  joinInstructions: v.string(),
  joinUrl: v.optional(v.string()),
};

function validateEventInput(args: {
  title: string;
  tagline: string;
  details: string[];
  startsAt: number;
  durationMinutes: number;
  joinInstructions: string;
  joinUrl?: string;
}) {
  const title = args.title.trim();
  const tagline = args.tagline.trim();
  const details = args.details.map((d) => d.trim()).filter(Boolean);
  const joinInstructions = args.joinInstructions.trim();
  const joinUrl = args.joinUrl?.trim();

  if (title.length < 3) throw new Error("Title must be at least 3 characters.");
  if (title.length > 120) throw new Error("Title must be 120 characters or fewer.");
  if (tagline.length < 3) throw new Error("Add a short tagline.");
  if (tagline.length > 240) throw new Error("Tagline must be 240 characters or fewer.");
  if (details.length === 0) throw new Error("Add at least one agenda detail.");
  if (details.length > MAX_DETAILS)
    throw new Error(`Keep the agenda to ${MAX_DETAILS} items or fewer.`);
  for (const item of details) {
    if (item.length > 300) throw new Error("Each agenda item must be 300 characters or fewer.");
  }
  if (!Number.isFinite(args.startsAt))
    throw new Error("Pick a valid start date and time.");
  if (!Number.isFinite(args.durationMinutes) || args.durationMinutes < 15 || args.durationMinutes > 480)
    throw new Error("Duration must be between 15 and 480 minutes.");
  if (joinInstructions.length < 10)
    throw new Error("Add online attendance details (10+ characters).");
  if (joinInstructions.length > 1000)
    throw new Error("Attendance details must be 1000 characters or fewer.");
  if (joinUrl && !/^https?:\/\/\S+$/.test(joinUrl))
    throw new Error("Join link must be a valid http(s) URL.");

  return {
    title,
    tagline,
    details,
    startsAt: Math.round(args.startsAt),
    durationMinutes: Math.round(args.durationMinutes),
    joinInstructions,
    joinUrl: joinUrl || undefined,
  };
}

async function uniqueSlug(ctx: MutationCtx, title: string): Promise<string> {
  const base = eventSlug(title);
  let candidate = base;
  for (let i = 2; i < 50; i++) {
    const existing = await ctx.db
      .query("marketEvents")
      .withIndex("by_slug", (s) => s.eq("slug", candidate))
      .first();
    if (!existing) return candidate;
    candidate = `${base}-${i}`;
  }
  return `${base}-${Date.now()}`;
}

async function findBySlug(
  ctx: QueryCtx | MutationCtx,
  slug: string,
): Promise<EventDoc | null> {
  return await ctx.db
    .query("marketEvents")
    .withIndex("by_slug", (s) => s.eq("slug", slug))
    .first();
}

async function findRegistration(
  ctx: QueryCtx | MutationCtx,
  eventId: Id<"marketEvents">,
  userId: Id<"users">,
): Promise<RegistrationDoc | null> {
  return await ctx.db
    .query("eventRegistrations")
    .withIndex("by_event_user", (s) => s.eq("eventId", eventId).eq("userId", userId))
    .first();
}

async function registeredCount(
  ctx: QueryCtx,
  eventId: Id<"marketEvents">,
): Promise<number> {
  // collect() rather than a capped take() so counts never silently truncate
  // (fine at launch scale; revisit with pagination past ~10k rows/event).
  const rows = await ctx.db
    .query("eventRegistrations")
    .withIndex("by_event", (s) => s.eq("eventId", eventId))
    .collect();
  return rows.filter((r) => r.status === "registered").length;
}

/** Shape an event row for the public Events page. */
async function publicShape(
  ctx: QueryCtx,
  row: Pick<
    EventDoc,
    | "slug"
    | "title"
    | "tagline"
    | "details"
    | "startsAt"
    | "durationMinutes"
    | "format"
    | "joinInstructions"
    | "joinUrl"
    | "status"
  > & { id: Id<"marketEvents"> | null },
  userId: Id<"users"> | null,
) {
  let registered = false;
  if (userId && row.id) {
    const reg = await findRegistration(ctx, row.id, userId);
    registered = reg?.status === "registered";
  }
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    tagline: row.tagline,
    details: [...row.details],
    startsAt: row.startsAt,
    endsAt: row.startsAt + row.durationMinutes * 60_000,
    durationMinutes: row.durationMinutes,
    format: row.format,
    joinInstructions: row.joinInstructions,
    // The join link is only revealed to registered attendees.
    joinUrl: registered ? row.joinUrl : undefined,
    status: row.status,
    registrations: row.id ? await registeredCount(ctx, row.id) : 0,
    registered,
  };
}

/**
 * Persist the code-defined founding event if no row with its slug exists.
 * Used lazily by register() so visitors can sign up before any admin setup.
 */
async function ensureFoundingEvent(ctx: MutationCtx): Promise<EventDoc> {
  const existing = await findBySlug(ctx, FOUNDING_EVENT.slug);
  if (existing) return existing;
  const id = await ctx.db.insert("marketEvents", {
    slug: FOUNDING_EVENT.slug,
    title: FOUNDING_EVENT.title,
    tagline: FOUNDING_EVENT.tagline,
    details: [...FOUNDING_EVENT.details],
    startsAt: FOUNDING_EVENT.startsAt,
    durationMinutes: FOUNDING_EVENT.durationMinutes,
    format: "online",
    joinInstructions: FOUNDING_EVENT.joinInstructions,
    status: "published",
    createdAt: Date.now(),
  });
  return (await ctx.db.get(id))!;
}

/** Public: published + cancelled events for the Events page. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    const rows = await ctx.db
      .query("marketEvents")
      .filter((q) => q.neq(q.field("status"), "draft"))
      .take(50);
    // Hero-first ordering: upcoming/live published events, then ended
    // published, then cancelled — so a cancelled or long-past event can never
    // outrank the next real event as the page's featured card.
    const now = Date.now();
    const rank = (row: EventDoc) => {
      if (row.status !== "published") return 2; // cancelled
      const endsAt = row.startsAt + row.durationMinutes * 60_000;
      return endsAt > now ? 0 : 1; // upcoming/live vs ended
    };
    const sorted = [...rows].sort(
      (a, b) => rank(a) - rank(b) || a.startsAt - b.startsAt,
    );
    const events = await Promise.all(
      sorted.map((row) =>
        publicShape(ctx, { ...row, id: row._id }, userId),
      ),
    );
    // Serve the built-in founding event only while NO row with its slug
    // exists — in any status. A draft founding row means an admin unpublished
    // it, so the synthetic default must not re-inject it as published.
    const foundingRow = await findBySlug(ctx, FOUNDING_EVENT.slug);
    if (!foundingRow) {
      events.unshift(
        await publicShape(
          ctx,
          {
            slug: FOUNDING_EVENT.slug,
            title: FOUNDING_EVENT.title,
            tagline: FOUNDING_EVENT.tagline,
            details: [...FOUNDING_EVENT.details],
            startsAt: FOUNDING_EVENT.startsAt,
            durationMinutes: FOUNDING_EVENT.durationMinutes,
            format: FOUNDING_EVENT.format,
            joinInstructions: FOUNDING_EVENT.joinInstructions,
            status: "published" as const,
            id: null,
          },
          userId,
        ),
      );
    }
    return events;
  },
});

/** Signed-in visitor registers interest in an event (idempotent). */
export const register = mutation({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const user = await requireVerifiedUser(ctx);
    let event = await findBySlug(ctx, args.slug);
    if (!event && args.slug === FOUNDING_EVENT.slug) {
      event = await ensureFoundingEvent(ctx);
    }
    if (!event) throw new Error("Event not found.");
    if (event.status === "draft")
      throw new Error("Registration for this event is not open yet.");
    if (event.status === "cancelled")
      throw new Error("This event was cancelled.");
    if (Date.now() > event.startsAt + event.durationMinutes * 60_000)
      throw new Error("This event has already ended — registration is closed.");

    const existing = await findRegistration(ctx, event._id, user._id);
    if (existing?.status === "registered")
      return { status: "already" as const, joinUrl: event.joinUrl };
    if (existing) {
      await ctx.db.patch(existing._id, { status: "registered" });
      return { status: "registered" as const, joinUrl: event.joinUrl };
    }
    await ctx.db.insert("eventRegistrations", {
      eventId: event._id,
      userId: user._id,
      email: user.email ?? "",
      name: user.name,
      status: "registered",
      createdAt: Date.now(),
    });
    return { status: "registered" as const, joinUrl: event.joinUrl };
  },
});

/** Registered attendee cancels their registration (row kept for audit). */
export const unregister = mutation({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const user = await requireVerifiedUser(ctx);
    const event = await findBySlug(ctx, args.slug);
    if (!event) return false;
    const existing = await findRegistration(ctx, event._id, user._id);
    if (!existing || existing.status !== "registered") return false;
    await ctx.db.patch(existing._id, { status: "cancelled" });
    return true;
  },
});

/** Admin: every event with registration + conversion counts. */
export const adminList = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const rows = await ctx.db.query("marketEvents").order("desc").take(100);
    return await Promise.all(
      rows.map(async (row) => {
        const regs = (
          await ctx.db
            .query("eventRegistrations")
            .withIndex("by_event", (s) => s.eq("eventId", row._id))
            .collect()
        ).filter((r) => r.status === "registered");
        const users = await Promise.all(regs.map((r) => ctx.db.get(r.userId)));
        const becameSellers = users.filter((u) => u?.isSeller === true).length;
        return {
          ...row,
          registrations: regs.length,
          becameSellers,
        };
      }),
    );
  },
});

/** Admin: create an event (draft or immediately published). */
export const adminCreate = mutation({
  args: { ...eventInputArgs, publish: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const clean = validateEventInput(args);
    return await ctx.db.insert("marketEvents", {
      ...clean,
      slug: await uniqueSlug(ctx, clean.title),
      format: "online",
      status: args.publish ? "published" : "draft",
      createdBy: admin._id,
      createdAt: Date.now(),
    });
  },
});

/** Admin: edit an event and set its status (publish / unpublish / cancel). */
export const adminUpdate = mutation({
  args: {
    eventId: v.id("marketEvents"),
    ...eventInputArgs,
    status: eventStatusValidator,
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const row = await ctx.db.get(args.eventId);
    if (!row) throw new Error("Event not found.");
    const clean = validateEventInput(args);
    await ctx.db.patch(args.eventId, { ...clean, status: args.status });
    return true;
  },
});

/** Admin: registration totals + how many registrants became sellers. */
export const adminStats = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    // collect() so conversion counts are exact, not silently capped.
    const regs = (await ctx.db.query("eventRegistrations").collect()).filter(
      (r) => r.status === "registered",
    );
    const userIds = [...new Set(regs.map((r) => r.userId))];
    const users = await Promise.all(userIds.map((id) => ctx.db.get(id)));
    const becameSellers = users.filter((u) => u?.isSeller === true).length;
    const events = await ctx.db.query("marketEvents").take(200);
    return {
      totalRegistrations: regs.length,
      uniqueRegistrants: userIds.length,
      becameSellers,
      totalEvents: events.length,
    };
  },
});
