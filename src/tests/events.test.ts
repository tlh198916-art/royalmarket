import { describe, expect, test } from "bun:test";
import { FOUNDING_EVENT } from "@/convex/eventDefaults";
import { countdownTo, eventPhase } from "@/hooks/use-countdown";
import { buildShareLinks } from "@/lib/socialShare";

describe("countdownTo", () => {
  const now = Date.UTC(2026, 10, 1, 0, 0, 0);

  test("breaks remaining time into d/h/m/s", () => {
    const target = now + 2 * 86_400_000 + 3 * 3_600_000 + 4 * 60_000 + 5_000;
    expect(countdownTo(now, target)).toEqual({
      totalMs: 2 * 86_400_000 + 3 * 3_600_000 + 4 * 60_000 + 5_000,
      days: 2,
      hours: 3,
      minutes: 4,
      seconds: 5,
      isPast: false,
    });
  });

  test("clamps to zero once the target has passed", () => {
    const result = countdownTo(now, now - 1_000);
    expect(result.isPast).toBe(true);
    expect(result.totalMs).toBe(0);
    expect(result.days + result.hours + result.minutes + result.seconds).toBe(0);
  });

  test("zero distance is treated as past", () => {
    expect(countdownTo(now, now).isPast).toBe(true);
  });
});

describe("eventPhase", () => {
  const start = 1_000_000;
  const end = start + 3_600_000;

  test("upcoming before start", () => {
    expect(eventPhase(start, end, start - 1)).toBe("upcoming");
  });
  test("live between start and end", () => {
    expect(eventPhase(start, end, start)).toBe("live");
    expect(eventPhase(start, end, end - 1)).toBe("live");
  });
  test("ended after end", () => {
    expect(eventPhase(start, end, end)).toBe("ended");
  });
});

describe("buildShareLinks", () => {
  test("builds encoded share intents", () => {
    const links = buildShareLinks("https://example.com/events", "Join me & fun");
    expect(links.x).toBe(
      "https://twitter.com/intent/tweet?url=https%3A%2F%2Fexample.com%2Fevents&text=Join%20me%20%26%20fun",
    );
    expect(links.facebook).toBe(
      "https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fexample.com%2Fevents",
    );
    expect(links.whatsapp).toContain("https://wa.me/?text=");
    expect(links.whatsapp).toContain(encodeURIComponent("Join me & fun https://example.com/events"));
  });
});

describe("FOUNDING_EVENT defaults", () => {
  test("has a stable slug, title, and online format", () => {
    expect(FOUNDING_EVENT.slug).toBe("founding-sellers-launch");
    expect(FOUNDING_EVENT.title.length).toBeGreaterThan(3);
    expect(FOUNDING_EVENT.format).toBe("online");
  });

  test("is scheduled for Nov 12, 2026 17:00 UTC for 90 minutes", () => {
    expect(FOUNDING_EVENT.startsAt).toBe(Date.UTC(2026, 10, 12, 17, 0));
    expect(FOUNDING_EVENT.durationMinutes).toBe(90);
  });

  test("lists non-empty agenda and attendance details", () => {
    expect(FOUNDING_EVENT.details.length).toBeGreaterThan(0);
    for (const item of FOUNDING_EVENT.details) {
      expect(item.trim().length).toBeGreaterThan(0);
    }
    expect(FOUNDING_EVENT.joinInstructions.length).toBeGreaterThan(10);
  });
});
