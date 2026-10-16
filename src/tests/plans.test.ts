import { describe, expect, test } from "bun:test";
import {
  DEFAULT_PLANS,
  PLAN_IDS,
  bpsToPercent,
  commissionCents,
} from "@/convex/plans";

/**
 * Targeted tests for the commission/pricing core of the seller-plan feature.
 * The admin validator in convex/subscriptions.ts updateSettings accepts
 * commissionBps only within 0–5000; the seeded catalog must stay inside the
 * same bound.
 */
describe("commissionCents", () => {
  test("applies basis points to the base amount", () => {
    expect(commissionCents(10_000, 500)).toBe(500); // 5%
    expect(commissionCents(10_000, 300)).toBe(300); // 3%
    expect(commissionCents(10_000, 100)).toBe(100); // 1%
    expect(commissionCents(129_900, 500)).toBe(6_495);
  });

  test("rounds down to whole cents", () => {
    expect(commissionCents(999, 500)).toBe(49); // 49.95 -> 49
    expect(commissionCents(1, 500)).toBe(0); // 0.05 -> 0
    expect(commissionCents(333, 333)).toBe(11); // 11.0889 -> 11
  });

  test("zero base or zero rate yields zero", () => {
    expect(commissionCents(0, 500)).toBe(0);
    expect(commissionCents(10_000, 0)).toBe(0);
  });

  test("respects the admin validator's max rate (5000 bps = 50%)", () => {
    expect(commissionCents(10_000, 5_000)).toBe(5_000);
    expect(commissionCents(10_000, 5_001)).toBe(5_001); // math itself is unbounded
  });
});

describe("bpsToPercent", () => {
  test("formats whole and fractional percents", () => {
    expect(bpsToPercent(500)).toBe("5%");
    expect(bpsToPercent(300)).toBe("3%");
    expect(bpsToPercent(100)).toBe("1%");
    expect(bpsToPercent(0)).toBe("0%");
    expect(bpsToPercent(250)).toBe("2.5%");
    expect(bpsToPercent(375)).toBe("3.75%");
  });
});

describe("DEFAULT_PLANS catalog", () => {
  test("ids are unique and match PLAN_IDS", () => {
    const ids = DEFAULT_PLANS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...PLAN_IDS]);
  });

  test("prices are positive and ascend across tiers", () => {
    const [starter, growth, pro] = DEFAULT_PLANS;
    for (const plan of DEFAULT_PLANS) {
      expect(plan.priceCentsMonthly).toBeGreaterThan(0);
      expect(Number.isInteger(plan.priceCentsMonthly)).toBe(true);
    }
    expect(starter.priceCentsMonthly).toBeLessThan(growth.priceCentsMonthly);
    expect(growth.priceCentsMonthly).toBeLessThan(pro.priceCentsMonthly);
  });

  test("commission rates descend across tiers and stay within admin bounds", () => {
    const [starter, growth, pro] = DEFAULT_PLANS;
    expect(starter.commissionBps).toBeGreaterThan(growth.commissionBps);
    expect(growth.commissionBps).toBeGreaterThan(pro.commissionBps);
    for (const plan of DEFAULT_PLANS) {
      expect(plan.commissionBps).toBeGreaterThanOrEqual(0);
      expect(plan.commissionBps).toBeLessThanOrEqual(5_000);
      expect(Number.isInteger(plan.commissionBps)).toBe(true);
    }
  });

  test("every plan has a name and unique non-empty feature copy", () => {
    for (const plan of DEFAULT_PLANS) {
      expect(plan.name.trim().length).toBeGreaterThan(0);
      expect(plan.features.length).toBeGreaterThan(0);
      expect(new Set(plan.features).size).toBe(plan.features.length);
      for (const feature of plan.features) {
        expect(feature.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
