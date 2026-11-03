/**
 * Canonical public app origin.
 *
 * Production builds always use the official RoyalMarket domain, even if the
 * bundle is opened through a preview hostname. Development keeps using the
 * current origin so local links and redirects stay local. A build-time
 * VITE_SITE_URL, when provided, takes precedence after validation.
 */
export const PRODUCTION_SITE_ORIGIN = "https://royalmarket.freebuff.app";

function normalizeOrigin(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  try {
    const url = new URL(raw.trim());
    const local =
      url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function appOrigin(): string {
  const configured = normalizeOrigin(
    import.meta.env.VITE_SITE_URL as string | undefined,
  );
  if (configured) return configured;

  // In development, keep generated URLs on the host being used. This includes
  // the Freebuff development preview without leaking it into production.
  if (typeof window !== "undefined" && import.meta.env.DEV) {
    return window.location.origin;
  }

  return PRODUCTION_SITE_ORIGIN;
}

/** Absolute app URL for a path or query string. */
export function appUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${appOrigin()}${path.startsWith("/") ? path : `/${path}`}`;
}
