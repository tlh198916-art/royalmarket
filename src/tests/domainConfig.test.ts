import { describe, expect, test } from "bun:test";
import {
  PRODUCTION_APP_ORIGIN,
  resolveStripeSiteUrl,
  siteBaseUrl,
} from "@/convex/stripeConfig";
import { appUrl, PRODUCTION_SITE_ORIGIN } from "@/lib/site";

describe("official production domain", () => {
  test("uses the exact RoyalMarket production origin", () => {
    expect(PRODUCTION_SITE_ORIGIN).toBe("https://royalmarket.freebuff.app");
    expect(PRODUCTION_APP_ORIGIN).toBe("https://royalmarket.freebuff.app");
    expect(appUrl("/")).toBe("https://royalmarket.freebuff.app/");
  });

  test("builds referral links on the official domain", () => {
    expect(appUrl("/sell?ref=ROYAL123")).toBe(
      "https://royalmarket.freebuff.app/sell?ref=ROYAL123",
    );
  });

  test("preserves auth returnTo and checkout query parameters", () => {
    expect(
      appUrl("/auth?returnTo=%2Fsell%2Fnew%3Fcategory%3Dart"),
    ).toBe(
      "https://royalmarket.freebuff.app/auth?returnTo=%2Fsell%2Fnew%3Fcategory%3Dart",
    );
    expect(appUrl("/orders?placed=order_123")).toBe(
      "https://royalmarket.freebuff.app/orders?placed=order_123",
    );
  });

  test("does not rewrite absolute URLs", () => {
    expect(appUrl("https://example.com/events?ref=ABC")).toBe(
      "https://example.com/events?ref=ABC",
    );
  });

  test("falls back to the official domain when the platform injects a Convex host", () => {
    expect(
      resolveStripeSiteUrl("https://flippant-hound-985.convex.site"),
    ).toBe("https://royalmarket.freebuff.app");
    expect(resolveStripeSiteUrl(undefined)).toBe(
      "https://royalmarket.freebuff.app",
    );
    expect(
      siteBaseUrl({
        siteUrl: resolveStripeSiteUrl(
          "https://flippant-hound-985.convex.site",
        ),
      }),
    ).toBe("https://royalmarket.freebuff.app");
  });

  test("keeps a valid explicitly configured app origin", () => {
    expect(resolveStripeSiteUrl("https://staging.example.com")).toBe(
      "https://staging.example.com",
    );
  });
});
