import { describe, expect, test } from "bun:test";
import type { Id } from "@/convex/_generated/dataModel";
import * as admin from "@/convex/admin";
import {
  ADMIN_EMAIL,
  RETIRED_ADMIN_EMAILS,
  isAdminEmail,
  isRetiredAdminEmail,
  normalizeEmail,
} from "@/convex/adminConfig";
import schema from "@/convex/schema";
import { defineTestApp } from "convex-test";

/**
 * Exercises admin access control against the real Convex functions: the
 * administrative mailbox is the only address that may claim or keep the seat,
 * and the retired owner address is rejected even when its row still says
 * `role: "admin"`.
 */

const app = defineTestApp({ schema });
const { api, internal, createTest } = app.defineModules({ admin });
type TestT = ReturnType<typeof createTest>;

const as = (t: TestT, userId: Id<"users">) =>
  t.withIdentity({ subject: `${userId}|test-session` });

async function newUser(
  t: TestT,
  options: {
    email: string;
    role?: "admin" | "user";
    verified?: boolean;
  },
) {
  const { role = "user", verified = true } = options;
  return await t.run((ctx) =>
    ctx.db.insert("users", {
      email: options.email,
      role,
      isSeller: false,
      emailVerificationTime: verified ? Date.now() : undefined,
    }),
  );
}

const retired = RETIRED_ADMIN_EMAILS[0];

describe("administrative email config", () => {
  test("normalizes addresses before comparing", () => {
    expect(normalizeEmail("  RoyalMarketBusiness@Gmail.com ")).toBe(ADMIN_EMAIL);
    expect(isAdminEmail("ROYALMARKETBUSINESS@gmail.com")).toBe(true);
    expect(isAdminEmail("someone@example.com")).toBe(false);
    expect(isRetiredAdminEmail(" MyRayalMarket@Gmail.com")).toBe(true);
    expect(isRetiredAdminEmail("")).toBe(false);
  });

  test("the retired mailbox is not the administrative mailbox", () => {
    expect(ADMIN_EMAIL).toBe("royalmarketbusiness@gmail.com");
    expect(isAdminEmail(retired)).toBe(false);
  });
});

describe("claimAdmin", () => {
  test("rejects an unrelated verified account", async () => {
    const t = createTest();
    const userId = await newUser(t, { email: "stranger@example.com" });
    await expect(as(t, userId).mutation(api.admin.claimAdmin, {})).rejects.toThrow(
      ADMIN_EMAIL,
    );
    expect((await t.run((ctx) => ctx.db.get(userId)))?.role).toBe("user");
  });

  test("rejects the retired administrative address", async () => {
    const t = createTest();
    const userId = await newUser(t, { email: retired });
    await expect(as(t, userId).mutation(api.admin.claimAdmin, {})).rejects.toThrow(
      "no longer available",
    );
    expect((await t.run((ctx) => ctx.db.get(userId)))?.role).toBe("user");
  });

  test("grants the seat to the administrative mailbox", async () => {
    const t = createTest();
    const userId = await newUser(t, { email: ADMIN_EMAIL });
    expect(await as(t, userId).mutation(api.admin.claimAdmin, {})).toBe(true);
    expect((await t.run((ctx) => ctx.db.get(userId)))?.role).toBe("admin");
  });

  test("a stale retired admin does not block the takeover", async () => {
    const t = createTest();
    await newUser(t, { email: retired, role: "admin" });
    const owner = await newUser(t, { email: ADMIN_EMAIL });
    expect(await as(t, owner).mutation(api.admin.claimAdmin, {})).toBe(true);
    expect((await t.run((ctx) => ctx.db.get(owner)))?.role).toBe("admin");
  });

  test("refuses when an active admin already exists", async () => {
    const t = createTest();
    await newUser(t, { email: "teammate@example.com", role: "admin" });
    const owner = await newUser(t, { email: ADMIN_EMAIL });
    await expect(as(t, owner).mutation(api.admin.claimAdmin, {})).rejects.toThrow(
      "already exists",
    );
  });

  test("still requires a verified email", async () => {
    const t = createTest();
    const userId = await newUser(t, { email: ADMIN_EMAIL, verified: false });
    await expect(as(t, userId).mutation(api.admin.claimAdmin, {})).rejects.toThrow(
      "Verify your email",
    );
  });
});

describe("adminStatus", () => {
  test("offers the claim only to the administrative mailbox", async () => {
    const t = createTest();
    const owner = await newUser(t, { email: ADMIN_EMAIL });
    const stranger = await newUser(t, { email: "stranger@example.com" });

    const ownerStatus = await as(t, owner).query(api.admin.adminStatus, {});
    expect(ownerStatus.isAdminEmail).toBe(true);
    expect(ownerStatus.canClaim).toBe(true);
    expect(ownerStatus.adminEmail).toBe(ADMIN_EMAIL);
    expect(ownerStatus.adminExists).toBe(false);

    const strangerStatus = await as(t, stranger).query(api.admin.adminStatus, {});
    expect(strangerStatus.canClaim).toBe(false);
  });

  test("a retired mailbox holding the role is reported as stale, not admin", async () => {
    const t = createTest();
    const old = await newUser(t, { email: retired, role: "admin" });
    const status = await as(t, old).query(api.admin.adminStatus, {});
    expect(status.isAdmin).toBe(false);
    expect(status.roleIsStale).toBe(true);
    expect(status.adminExists).toBe(false);
  });

  test("treats a regular active admin as the existing admin", async () => {
    const t = createTest();
    await newUser(t, { email: "teammate@example.com", role: "admin" });
    const owner = await newUser(t, { email: ADMIN_EMAIL });
    const status = await as(t, owner).query(api.admin.adminStatus, {});
    expect(status.adminExists).toBe(true);
    expect(status.canClaim).toBe(false);
  });
});

describe("admin queries behind requireAdmin", () => {
  test("a retired mailbox cannot read admin metrics", async () => {
    const t = createTest();
    const old = await newUser(t, { email: retired, role: "admin" });
    await expect(as(t, old).query(api.admin.stats, {})).rejects.toThrow(
      "Admin access required",
    );
  });

  test("a non-admin cannot read admin metrics", async () => {
    const t = createTest();
    const user = await newUser(t, { email: "shopper@example.com" });
    await expect(as(t, user).query(api.admin.stats, {})).rejects.toThrow(
      "Admin access required",
    );
  });

  test("an ordinary admin still has access", async () => {
    const t = createTest();
    const adminUser = await newUser(t, { email: "teammate@example.com", role: "admin" });
    const stats = await as(t, adminUser).query(api.admin.stats, {});
    expect(stats.totals.products).toBe(0);
  });
});

describe("enforceAdminEmail migration", () => {
  test("demotes the retired mailbox and promotes the administrative account", async () => {
    const t = createTest();
    const old = await newUser(t, { email: retired, role: "admin" });
    const owner = await newUser(t, { email: ADMIN_EMAIL });

    const result = await t.mutation(internal.admin.enforceAdminEmail, {});
    expect(result.revoked).toEqual([retired]);
    expect(result.granted).toBe(true);

    expect((await t.run((ctx) => ctx.db.get(old)))?.role).toBe("user");
    expect((await t.run((ctx) => ctx.db.get(owner)))?.role).toBe("admin");
  });

  test("demotes a non-retired mailbox that still holds the seat", async () => {
    const t = createTest();
    const formerOwner = await newUser(t, {
      email: "royalmarket-e2e@mailinator.com",
      role: "admin",
    });
    const owner = await newUser(t, { email: ADMIN_EMAIL });

    const result = await t.mutation(internal.admin.enforceAdminEmail, {});
    expect(result.revoked).toEqual(["royalmarket-e2e@mailinator.com"]);
    expect(result.granted).toBe(true);
    expect((await t.run((ctx) => ctx.db.get(formerOwner)))?.role).toBe("user");
    expect((await t.run((ctx) => ctx.db.get(owner)))?.role).toBe("admin");
  });

  test("does not promote an unverified or missing administrative account", async () => {
    const t = createTest();
    await newUser(t, { email: ADMIN_EMAIL, verified: false });

    const result = await t.mutation(internal.admin.enforceAdminEmail, {});
    expect(result.granted).toBe(false);
    expect(result.note).toContain("not email-verified");

    const empty = createTest();
    const missing = await empty.mutation(internal.admin.enforceAdminEmail, {});
    expect(missing.granted).toBe(false);
    expect(missing.note).toContain("No account exists");
  });

  test("is safe to re-run", async () => {
    const t = createTest();
    await newUser(t, { email: retired, role: "admin" });
    await newUser(t, { email: ADMIN_EMAIL });

    await t.mutation(internal.admin.enforceAdminEmail, {});
    const again = await t.mutation(internal.admin.enforceAdminEmail, {});
    expect(again.revoked).toEqual([]);
    expect(again.granted).toBe(false);
    expect(again.note).toContain("already holds admin access");
  });
});
