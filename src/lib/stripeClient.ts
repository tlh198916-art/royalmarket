import { loadStripe, type Stripe } from "@stripe/stripe-js";

/**
 * Cached Stripe.js loader. Uses the publishable key returned by the public
 * Convex query — never a secret key.
 */
let cachedPromise: Promise<Stripe | null> | null = null;
let cachedKey: string | null = null;

export function getStripe(publishableKey: string): Promise<Stripe | null> {
  if (cachedPromise && cachedKey === publishableKey) return cachedPromise;
  cachedKey = publishableKey;
  cachedPromise = loadStripe(publishableKey);
  return cachedPromise;
}
