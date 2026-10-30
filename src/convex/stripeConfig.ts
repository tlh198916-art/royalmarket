/**
 * Stripe configuration + pure money math shared by the Convex runtime and the
 * Node.js Stripe actions. No secret value is ever returned to the client:
 * only presence flags, the publishable key, and derived readiness booleans.
 */

export type StripeEnv = {
  secretKey?: string;
  publishableKey?: string;
  webhookSecret?: string;
  connectWebhookSecret?: string;
  siteUrl?: string;
};

export function readStripeEnv(): StripeEnv {
  return {
    secretKey: process.env.STRIPE_SECRET_KEY,
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    connectWebhookSecret: process.env.STRIPE_CONNECT_WEBHOOK_SECRET,
    siteUrl: process.env.SITE_URL,
  };
}

/**
 * Safety rail for the test-mode-first requirement: a live secret key is
 * refused unless the deployment explicitly opts in. This prevents accidentally
 * charging real cards or moving real money during setup.
 */
export function liveModeBlocked(env: StripeEnv = readStripeEnv()): boolean {
  if (!env.secretKey?.startsWith("sk_live_")) return false;
  return process.env.STRIPE_ALLOW_LIVE_MODE !== "true";
}

/** Card payments need a server key, a public key and a verified webhook. */
export function cardsConfigured(env: StripeEnv = readStripeEnv()): boolean {
  return (
    !!env.secretKey &&
    !!env.publishableKey &&
    !!env.webhookSecret &&
    !liveModeBlocked(env)
  );
}

/** Connect onboarding links need the server key and a trusted return origin. */
export function connectConfigured(env: StripeEnv = readStripeEnv()): boolean {
  return !!env.secretKey && siteBaseUrl(env) !== null && !liveModeBlocked(env);
}

/** A trusted absolute origin for Stripe redirects. HTTPS, or localhost in dev. */
export function siteBaseUrl(env: StripeEnv = readStripeEnv()): string | null {
  const raw = env.siteUrl?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
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

export type StripeReadiness = {
  keysPresent: boolean;
  missing: string[];
  cardPaymentsAvailable: boolean;
  connectAvailable: boolean;
  blockers: string[];
  publishableKey: string | null;
};

/**
 * Honest readiness: every flag is derived from configuration that is actually
 * present. The integration code ships with the app, but Stripe stays "off"
 * until the required test-mode keys and the webhook endpoint exist.
 */
export function assessStripeReadiness(
  env: StripeEnv = readStripeEnv(),
): StripeReadiness {
  const missing: string[] = [];
  if (!env.secretKey) missing.push("STRIPE_SECRET_KEY");
  if (!env.publishableKey) missing.push("STRIPE_PUBLISHABLE_KEY");
  if (!env.webhookSecret) missing.push("STRIPE_WEBHOOK_SECRET");
  if (!env.connectWebhookSecret)
    missing.push("STRIPE_CONNECT_WEBHOOK_SECRET");
  if (!siteBaseUrl(env)) missing.push("SITE_URL");

  const cardPaymentsAvailable = cardsConfigured(env);
  const connectAvailable = connectConfigured(env);

  return {
    keysPresent: missing.length === 0,
    missing,
    cardPaymentsAvailable,
    connectAvailable,
    blockers: [
      ...(liveModeBlocked(env)
        ? [
            "Live Stripe key detected — test mode only until STRIPE_ALLOW_LIVE_MODE=true",
          ]
        : []),
      ...missing.map((key) =>
        key === "SITE_URL"
          ? "SITE_URL is not set to a trusted https origin"
          : `${key} is not set`,
      ),
    ],
    publishableKey: env.publishableKey ?? null,
  };
}

export type TransferLine = {
  priceCents: number;
  quantity: number;
  status: string;
  paymentStatus?: string;
  commissionCents: number;
};

export type TransferAmount = {
  /** Merchandise value of the eligible (delivered + paid) lines. */
  grossCents: number;
  /** Seller-set fulfillment fee, charged once per seller per order. */
  feeCents: number;
  commissionCents: number;
  /** What the seller receives from this transfer. */
  netCents: number;
  itemCount: number;
};

/**
 * Seller transfer math. Only delivered, provider-paid, non-refunded lines
 * count — the same rule the earnings dashboard uses. The commission comes from
 * the existing ledger (which applies the plan rules snapshotted on the
 * subscription), never from a client-supplied number.
 */
export function computeSellerTransfer(
  items: TransferLine[],
  orderFeeCents: number,
): TransferAmount {
  let grossCents = 0;
  let commissionCents = 0;
  let itemCount = 0;
  for (const item of items) {
    if (item.status !== "delivered") continue;
    if ((item.paymentStatus ?? "unpaid") !== "paid") continue;
    grossCents += item.priceCents * item.quantity;
    commissionCents += Math.max(0, Math.round(item.commissionCents));
    itemCount += 1;
  }
  if (itemCount === 0) {
    return {
      grossCents: 0,
      feeCents: 0,
      commissionCents: 0,
      netCents: 0,
      itemCount: 0,
    };
  }
  const feeCents = Math.max(0, Math.round(orderFeeCents));
  return {
    grossCents,
    feeCents,
    commissionCents,
    netCents: Math.max(0, grossCents + feeCents - commissionCents),
    itemCount,
  };
}
