/**
 * Code-defined default marketing event: the Founding Sellers Launch Event.
 *
 * Pure module (no Convex imports) so both the frontend Events page and the
 * Convex backend share one source of truth. The event exists in code until an
 * admin edits it or the first visitor registers (marketEvents.register
 * persists a row lazily), so the feature works with zero setup.
 */

/**
 * URL-safe slug for an event title, e.g.
 * "Founding Sellers Launch Event" → "founding-sellers-launch-event".
 * Falls back to "event" when the title has no usable characters.
 * Pure — unit-tested in src/tests/events.test.ts.
 */
export function eventSlug(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || "event";
}

export const FOUNDING_EVENT = {
  slug: "founding-sellers-launch",
  title: "Founding Sellers Launch Event",
  tagline:
    "Royalmarket's official launch for new sellers — live, online, and free to attend.",
  details: [
    "Live walkthrough: create your first listing in under five minutes.",
    "Individual vs. business: how free individual selling works and when a paid Business plan makes sense.",
    "Open Q&A with the marketplace team about fees, fulfillment options, and how orders work.",
    "Roadmap preview: what's shipping next for sellers on Royalmarket.",
    "Network with other founding sellers before launch week.",
  ],
  // Thu Nov 19, 2026, 9:00 AM PT — Pacific is on PST then, so 9:00 AM =
  // 17:00 UTC. Fixed so the countdown is stable; duration keeps it running to
  // 10:30 AM PT (18:30 UTC).
  startsAt: Date.UTC(2026, 10, 19, 17, 0),
  durationMinutes: 90,
  format: "online",
  joinInstructions:
    "Hosted online. Sign in and register below — the private join link appears right here on this page for registered attendees.",
} as const;
