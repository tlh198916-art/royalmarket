import { describe, expect, test } from "bun:test";
import type { Id } from "@/convex/_generated/dataModel";
import { FOUNDING_EVENT } from "@/convex/eventDefaults";
import * as marketEvents from "@/convex/marketEvents";
import schema from "@/convex/schema";
import { defineTestApp } from "convex-test";

/**
 * Exercises the real Convex functions in src/convex/marketEvents.ts against an
 * in-memory backend: auth boundaries, draft/ended/cancelled rejection,
 * duplicate registrations, join-link privacy, admin permissions, slug
 * reservation, and seller-conversion counting.
 */

const app = defineTestApp({ schema });
const { api, internal, createTest } = app.defineModules({ marketEvents });
type TestT = ReturnType<typeof createTest>;

/** Sign-in subject format Convex Auth uses: "<userId>|<sessionId>". */
const as = (t: TestT, userId: Id<"users">) =>
  t.withIdentity({ subject: `${userId}|test-session` });

async function newUser(
  t: TestT,
  options: {
    role?: "admin" | "user";
    verified?: boolean;
    seller?: boolean;
    email?: string;
  } = {},
) {
  const { role = "user", verified = true, seller = false } = options;
  return await t.run((ctx) =>
    ctx.db.insert("users", {
      email: options.email ?? `${crypto.randomUUID()}@example.com`,
      role,
      isSeller: seller,
      emailVerificationTime: verified ? Date.now() : undefined,
    }),
  );
}

const eventArgs = (overrides: Record<string, unknown> = {}) => ({
  title: "Spring Seller Meetup",
  tagline: "A short online session for new sellers.",
  details: ["List your first item", "Open Q&A"],
  startsAt: Date.now() + 3_600_000,
  durationMinutes: 60,
  joinInstructions: "Join from the private link on this page after registering.",
  ...overrides,
});

/** Insert an event row directly, for status/slug cases admins can't produce. */
async function insertEvent(
  t: TestT,
  overrides: {
    slug?: string;
    startsAt?: number;
    status?: "draft" | "published" | "cancelled";
    joinUrl?: string;
  } = {},
) {
  return await t.run((ctx) =>
    ctx.db.insert("marketEvents", {
      slug: overrides.slug ?? `event-${crypto.randomUUID()}`,
      title: "Founders Q&A",
      tagline: "Bring your selling questions.",
      details: ["Live walkthrough"],
      startsAt: overrides.startsAt ?? Date.now() + 3_600_000,
      durationMinutes: 60,
      format: "online",
      joinInstructions: "The join link appears here once you register.",
      joinUrl: overrides.joinUrl,
      status: overrides.status ?? "published",
      createdAt: Date.now(),
    }),
  );
}

describe("marketEvents.list", () => {
  test("serves the built-in founding event with no admin setup", async () => {
    const t = createTest();
    const rows = await t.query(api.marketEvents.list, {});

    expect(rows).toHaveLength(1);
    expect(rows[0].slug).toBe(FOUNDING_EVENT.slug);
    expect(rows[0].title).toBe(FOUNDING_EVENT.title);
    expect(rows[0].status).toBe("published");
    expect(rows[0].registered).toBe(false);
    expect(rows[0].registrations).toBe(0);
    expect(rows[0].joinUrl).toBeUndefined();
  });

  test("hides drafts and does not re-inject the default beside a draft founding row", async () => {
    const t = createTest();
    await insertEvent(t, {
      slug: FOUNDING_EVENT.slug,
      status: "draft",
    });

    // This empty result is why the Events page needs a real empty state.
    expect(await t.query(api.marketEvents.list, {})).toHaveLength(0);
  });

  test("ranks upcoming published events above ended and cancelled ones", async () => {
    const t = createTest();
    const admin = await newUser(t, { role: "admin" });
    const adminT = as(t, admin);

    const upcoming = await adminT.mutation(
      api.marketEvents.adminCreate,
      eventArgs({ title: "Upcoming Session", publish: true }),
    );
    const ended = await adminT.mutation(
      api.marketEvents.adminCreate,
      eventArgs({
        title: "Ended Session",
        startsAt: Date.now() - 7_200_000,
        publish: true,
      }),
    );
    const cancelledArgs = eventArgs({ title: "Cancelled Session" });
    const cancelled = await adminT.mutation(
      api.marketEvents.adminCreate,
      { ...cancelledArgs, publish: true },
    );
    await adminT.mutation(api.marketEvents.adminUpdate, {
      eventId: cancelled,
      ...cancelledArgs,
      status: "cancelled",
    });

    const rows = await t.query(api.marketEvents.list, {});
    const at = (id: Id<"marketEvents">) => rows.findIndex((row) => row.id === id);

    expect(at(upcoming)).toBeGreaterThanOrEqual(0);
    expect(at(upcoming)).toBeLessThan(at(ended));
    expect(at(ended)).toBeLessThan(at(cancelled));
    // The built-in founding event keeps the hero slot ahead of real rows.
    expect(rows[0].slug).toBe(FOUNDING_EVENT.slug);
  });

  test("withholds the private join link until the viewer registers", async () => {
    const t = createTest();
    const eventId = await insertEvent(t, {
      joinUrl: "https://meet.example.com/sellers",
    });
    const user = await newUser(t);
    const userT = as(t, user);

    const before = await userT.query(api.marketEvents.list, {});
    const beforeRow = before.find((row) => row.id === eventId);
    expect(beforeRow?.joinUrl).toBeUndefined();
    expect(beforeRow?.registered).toBe(false);

    await userT.mutation(api.marketEvents.register, {
      slug: beforeRow!.slug,
    });

    const after = await userT.query(api.marketEvents.list, {});
    const afterRow = after.find((row) => row.id === eventId);
    expect(afterRow?.joinUrl).toBe("https://meet.example.com/sellers");
    expect(afterRow?.registered).toBe(true);
  });
});

describe("marketEvents.register", () => {
  test("rejects signed-out callers", async () => {
    const t = createTest();
    await expect(
      t.mutation(api.marketEvents.register, { slug: FOUNDING_EVENT.slug }),
    ).rejects.toThrow(/sign in/i);
  });

  test("rejects accounts without a verified email", async () => {
    const t = createTest();
    const user = await newUser(t, { verified: false });
    await expect(
      as(t, user).mutation(api.marketEvents.register, {
        slug: FOUNDING_EVENT.slug,
      }),
    ).rejects.toThrow(/verified email/i);
  });

  test("persists the built-in event on first registration and dedupes repeats", async () => {
    const t = createTest();
    const user = await newUser(t);
    const userT = as(t, user);

    const first = await userT.mutation(api.marketEvents.register, {
      slug: FOUNDING_EVENT.slug,
    });
    expect(first.status).toBe("registered");

    const row = await t.run((ctx) =>
      ctx.db
        .query("marketEvents")
        .withIndex("by_slug", (q) => q.eq("slug", FOUNDING_EVENT.slug))
        .first(),
    );
    expect(row?.status).toBe("published");

    const second = await userT.mutation(api.marketEvents.register, {
      slug: FOUNDING_EVENT.slug,
    });
    expect(second.status).toBe("already");

    const rows = await userT.query(api.marketEvents.list, {});
    expect(rows[0].registrations).toBe(1);
    expect(rows[0].registered).toBe(true);
  });

  test("alignFoundingSchedule moves a stale stored row onto the code default", async () => {
    const t = createTest();
    // The row a live deployment persisted when the launch was Nov 12.
    await insertEvent(t, {
      slug: FOUNDING_EVENT.slug,
      startsAt: Date.UTC(2026, 10, 12, 17, 0),
    });

    const before = await t.query(api.marketEvents.list, {});
    expect(before[0].startsAt).toBe(Date.UTC(2026, 10, 12, 17, 0));

    const result = await t.mutation(
      internal.marketEvents.alignFoundingSchedule,
      {},
    );
    expect(result.status).toBe("updated");

    const row = await t.run((ctx) =>
      ctx.db
        .query("marketEvents")
        .withIndex("by_slug", (q) => q.eq("slug", FOUNDING_EVENT.slug))
        .first(),
    );
    expect(row?.startsAt).toBe(FOUNDING_EVENT.startsAt);
    expect(row?.durationMinutes).toBe(FOUNDING_EVENT.durationMinutes);
    // Copy an admin wrote on the row is preserved; only the schedule moves.
    expect(row?.title).toBe("Founders Q&A");

    const after = await t.query(api.marketEvents.list, {});
    expect(after[0].startsAt).toBe(FOUNDING_EVENT.startsAt);
    expect(after[0].endsAt).toBe(
      FOUNDING_EVENT.startsAt + FOUNDING_EVENT.durationMinutes * 60_000,
    );
  });

  test("alignFoundingSchedule is a no-op without a row and idempotent once aligned", async () => {
    const t = createTest();
    expect(
      (await t.mutation(internal.marketEvents.alignFoundingSchedule, {})).status,
    ).toBe("no-row");

    // Stored row with the right date but the wrong duration.
    await insertEvent(t, {
      slug: FOUNDING_EVENT.slug,
      startsAt: FOUNDING_EVENT.startsAt,
    });
    expect(
      (await t.mutation(internal.marketEvents.alignFoundingSchedule, {})).status,
    ).toBe("updated");
    expect(
      (await t.mutation(internal.marketEvents.alignFoundingSchedule, {})).status,
    ).toBe("unchanged");
  });

  test("closes registration once the event has ended", async () => {
    const t = createTest();
    const admin = await newUser(t, { role: "admin" });
    const ended = await as(t, admin).mutation(
      api.marketEvents.adminCreate,
      eventArgs({
        title: "Yesterday's Session",
        startsAt: Date.now() - 7_200_000,
        publish: true,
      }),
    );
    const listed = await as(t, admin).query(api.marketEvents.adminList, {});
    const slug = listed.find((row) => row._id === ended)!.slug;
    const user = await newUser(t);

    await expect(
      as(t, user).mutation(api.marketEvents.register, { slug }),
    ).rejects.toThrow(/already ended/i);
  });

  test("rejects draft and cancelled events", async () => {
    const t = createTest();
    const draft = await insertEvent(t, { status: "draft" });
    const cancelled = await insertEvent(t, { status: "cancelled" });
    const user = await newUser(t);

    const slugOf = async (id: Id<"marketEvents">) =>
      (await t.run((ctx) => ctx.db.get(id)))!.slug;

    await expect(
      as(t, user).mutation(api.marketEvents.register, {
        slug: await slugOf(draft),
      }),
    ).rejects.toThrow(/not open yet/i);

    await expect(
      as(t, user).mutation(api.marketEvents.register, {
        slug: await slugOf(cancelled),
      }),
    ).rejects.toThrow(/cancelled/i);
  });

  test("unregister cancels the registration without deleting the row", async () => {
    const t = createTest();
    const user = await newUser(t);
    const userT = as(t, user);

    await userT.mutation(api.marketEvents.register, {
      slug: FOUNDING_EVENT.slug,
    });
    expect(
      await userT.mutation(api.marketEvents.unregister, {
        slug: FOUNDING_EVENT.slug,
      }),
    ).toBe(true);

    const rows = await userT.query(api.marketEvents.list, {});
    expect(rows[0].registered).toBe(false);
    expect(rows[0].registrations).toBe(0);

    // Second cancel is a no-op, and re-registering flips the same row back.
    expect(
      await userT.mutation(api.marketEvents.unregister, {
        slug: FOUNDING_EVENT.slug,
      }),
    ).toBe(false);
    expect(
      (
        await userT.mutation(api.marketEvents.register, {
          slug: FOUNDING_EVENT.slug,
        })
      ).status,
    ).toBe("registered");
    expect(
      (await userT.query(api.marketEvents.list, {}))[0].registrations,
    ).toBe(1);
  });
});

describe("event admin permissions and lifecycle", () => {
  test("admin queries reject signed-out callers and non-admins", async () => {
    const t = createTest();
    await expect(t.query(api.marketEvents.adminList, {})).rejects.toThrow(
      /sign in/i,
    );

    const user = await newUser(t);
    await expect(
      as(t, user).query(api.marketEvents.adminList, {}),
    ).rejects.toThrow(/admin access required/i);
    await expect(
      as(t, user).query(api.marketEvents.adminStats, {}),
    ).rejects.toThrow(/admin access required/i);
    await expect(
      as(t, user).mutation(api.marketEvents.adminCreate, eventArgs()),
    ).rejects.toThrow(/admin access required/i);
    await expect(
      as(t, user).mutation(api.marketEvents.adminUpdate, {
        eventId: await insertEvent(t),
        ...eventArgs(),
        status: "published",
      }),
    ).rejects.toThrow(/admin access required/i);
  });

  test("drafts stay private until published, and cancellation is public", async () => {
    const t = createTest();
    const admin = await newUser(t, { role: "admin" });
    const adminT = as(t, admin);
    const args = eventArgs({ title: "New Seller Orientation" });
    const id = await adminT.mutation(api.marketEvents.adminCreate, args);

    expect((await t.query(api.marketEvents.list, {})).some((r) => r.id === id)).toBe(
      false,
    );

    await adminT.mutation(api.marketEvents.adminUpdate, {
      eventId: id,
      ...args,
      status: "published",
    });
    const published = (await t.query(api.marketEvents.list, {})).find(
      (r) => r.id === id,
    );
    expect(published?.status).toBe("published");

    await adminT.mutation(api.marketEvents.adminUpdate, {
      eventId: id,
      ...args,
      status: "cancelled",
    });
    const cancelled = (await t.query(api.marketEvents.list, {})).find(
      (r) => r.id === id,
    );
    expect(cancelled?.status).toBe("cancelled");
  });

  test("never hands out the reserved founding slug", async () => {
    const t = createTest();
    const admin = await newUser(t, { role: "admin" });
    const adminT = as(t, admin);

    const id = await adminT.mutation(
      api.marketEvents.adminCreate,
      eventArgs({ title: "Founding Sellers Launch", publish: true }),
    );
    const rows = await adminT.query(api.marketEvents.adminList, {});
    expect(rows.find((row) => row._id === id)?.slug).toBe(
      `${FOUNDING_EVENT.slug}-2`,
    );

    const publicRows = await t.query(api.marketEvents.list, {});
    expect(publicRows[0].slug).toBe(FOUNDING_EVENT.slug);
  });
});

describe("seller conversion tracking", () => {
  test("counts only registrants who were not already sellers", async () => {
    const t = createTest();
    const admin = await newUser(t, { role: "admin" });
    const buyer = await newUser(t);
    const existingSeller = await newUser(t, { seller: true });

    await as(t, buyer).mutation(api.marketEvents.register, {
      slug: FOUNDING_EVENT.slug,
    });
    await as(t, existingSeller).mutation(api.marketEvents.register, {
      slug: FOUNDING_EVENT.slug,
    });

    const statsBefore = await as(t, admin).query(
      api.marketEvents.adminStats,
      {},
    );
    expect(statsBefore.totalRegistrations).toBe(2);
    expect(statsBefore.uniqueRegistrants).toBe(2);
    expect(statsBefore.becameSellers).toBe(0);

    // The buyer later becomes a seller; the pre-existing seller never counts.
    await t.run((ctx) => ctx.db.patch(buyer, { isSeller: true }));

    const statsAfter = await as(t, admin).query(
      api.marketEvents.adminStats,
      {},
    );
    expect(statsAfter.becameSellers).toBe(1);

    const perEvent = await as(t, admin).query(api.marketEvents.adminList, {});
    expect(perEvent[0].registrations).toBe(2);
    expect(perEvent[0].becameSellers).toBe(1);
  });
});
