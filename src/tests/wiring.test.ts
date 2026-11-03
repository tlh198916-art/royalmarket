import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Read a source file relative to src/ so wiring can't silently regress. */
const read = (relativeToSrc: string) =>
  readFileSync(join(import.meta.dir, "..", relativeToSrc), "utf8");

describe("seller recruitment wiring", () => {
  test("seller guide, founding seller, and category pages are routed", () => {
    const src = read("main.tsx");
    expect(src).toContain(
      'const FoundingSellers = lazy(() => import("./pages/FoundingSellers.tsx"));',
    );
    expect(src).toContain(
      'path="/founding-sellers" element={<FoundingSellers />}',
    );
    expect(src).toContain('path="/sell/guide" element={<SellerGuide />}');
    expect(src).toContain(
      'path="/sell/category/:categoryId"',
    );
  });

  test("every page carries the free-seller offer strip", () => {
    expect(read("components/marketplace/Layout.tsx")).toContain(
      "<SellerInviteBar />",
    );
  });

  test("the listing form accepts a category prefill", () => {
    const src = read("pages/ListingForm.tsx");
    expect(src).toContain('searchParams.get("category")');
    expect(src).toContain("categoryId: initialCategory");
  });
});

describe("events wiring", () => {
  test("main.tsx lazily routes /events to the Events page", () => {
    const src = read("main.tsx");
    expect(src).toContain('const Events = lazy(() => import("./pages/Events.tsx"));');
    expect(src).toContain('path="/events" element={<Events />}');
  });

  test("header navigation includes the Events link", () => {
    expect(read("components/marketplace/SiteHeader.tsx")).toContain(
      '{ to: "/events", label: "Events" }',
    );
  });

  test("footer links to the seller events page", () => {
    expect(read("components/marketplace/SiteFooter.tsx")).toContain(
      '{ to: "/events", label: "Seller events" }',
    );
  });
});
