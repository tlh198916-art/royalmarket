import type { PlanId } from "./schema";

/**
 * Default business subscription plans (all amounts in USD cents).
 * These seed `platformSettings`; the admin can change prices and commission
 * rates later without touching code. Backend code must always read the live
 * values from `platformSettings`, never these constants directly.
 */
export const DEFAULT_PLANS: {
  id: PlanId;
  name: string;
  priceCentsMonthly: number;
  commissionBps: number;
  features: string[];
}[] = [
  {
    id: "starter",
    name: "Business Starter",
    priceCentsMonthly: 2900,
    commissionBps: 500, // 5%
    features: [
      "Branded business storefront",
      "Business logo and banner",
      "Product listings and inventory management",
      "Order management",
      "Seller profile and contact information",
      "Basic sales reporting",
      "Standard marketplace exposure",
      "Seller-configured shipping, pickup, and delivery",
      "Standard platform support",
    ],
  },
  {
    id: "growth",
    name: "Business Growth",
    priceCentsMonthly: 7900,
    commissionBps: 300, // 3%
    features: [
      "Everything in Business Starter",
      "Enhanced storefront branding",
      "Advanced inventory and order tools",
      "Improved sales analytics",
      "Product performance reporting",
      "Promotional tools (coming soon)",
      "Priority support where available",
    ],
  },
  {
    id: "pro",
    name: "Business Pro",
    priceCentsMonthly: 19900,
    commissionBps: 100, // 1%
    features: [
      "Everything in Business Growth",
      "Advanced business analytics",
      "Expanded inventory and reporting tools",
      "Enhanced storefront customization",
      "Advanced promotional capabilities (coming soon)",
      "Priority support where available",
      "Additional high-volume business features (coming soon)",
    ],
  },
];

/** Human-readable plan id list for validators and UI. */
export const PLAN_IDS: PlanId[] = ["starter", "growth", "pro"];

/** Basis points → percent string, e.g. 500 → "5%", 250 → "2.5%". */
export function bpsToPercent(bps: number): string {
  const percent = bps / 100;
  // toFixed(2) keeps at most 2 decimals; Number() drops trailing zeros so
  // 250 bps reads "2.5%", not "2.50%".
  return `${Number.isInteger(percent) ? percent : Number(percent.toFixed(2))}%`;
}

/** Compute a commission amount in cents from a base amount and bps. */
export function commissionCents(baseCents: number, bps: number): number {
  return Math.floor((baseCents * bps) / 10_000);
}
