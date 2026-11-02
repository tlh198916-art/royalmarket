"use node";

import Stripe from "stripe";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import {
  cardsConfigured,
  connectConfigured,
  liveModeBlocked,
  readStripeEnv,
  siteBaseUrl,
} from "./stripeConfig";

/**
 * Stripe Node actions.
 *
 * Secret keys are read from Convex environment variables only and never leave
 * this file. Every mutation of local payment state happens through
 * `stripeSync` internal mutations, driven by a verified webhook or by the
 * result of a Stripe API call — never by client input.
 */

let cached: Stripe | null = null;
let cachedKey: string | null = null;

function stripeClient(): Stripe {
  const env = readStripeEnv();
  const { secretKey } = env;
  if (!secretKey) {
    throw new Error(
      "Stripe is not configured: add STRIPE_SECRET_KEY in the project's Keys tab.",
    );
  }
  if (liveModeBlocked(env)) {
    throw new Error(
      "Live Stripe keys are blocked in this deployment. Use test-mode keys, or set STRIPE_ALLOW_LIVE_MODE=true after test-mode verification.",
    );
  }
  if (cached && cachedKey === secretKey) return cached;
  cached = new Stripe(secretKey, { maxNetworkRetries: 2 });
  cachedKey = secretKey;
  return cached;
}

function stripeMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "Stripe request failed.";
}

function requireSiteBase(): string {
  const base = siteBaseUrl();
  if (!base) {
    throw new Error(
      "Stripe onboarding needs SITE_URL set to your public app https origin (for example https://your-market.example), not a Convex backend host.",
    );
  }
  return base;
}

async function callerIsAdmin(ctx: ActionCtx): Promise<void> {
  const user = await ctx.runQuery(api.users.currentUser, {});
  if (!user || user.role !== "admin") {
    throw new Error("Admin access required.");
  }
}

/* -------------------------------------------------------------------------- */
/* Connect Express onboarding                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Create (once) the seller's Express account and return a fresh onboarding
 * link. The account id is stored server-side; the client only receives the
 * short-lived Stripe-hosted URL.
 */
export const createConnectLink = action({
  args: {},
  handler: async (ctx): Promise<{ url: string }> => {
    if (!connectConfigured()) {
      throw new Error(
        "Stripe onboarding is not configured. Add STRIPE_SECRET_KEY and SITE_URL first.",
      );
    }
    const context = await ctx.runQuery(internal.stripeSync.connectContext, {});
    const base = requireSiteBase();
    const stripe = stripeClient();

    let accountId = context.accountId;
    if (!accountId) {
      const country = process.env.STRIPE_CONNECT_COUNTRY ?? "US";
      const account = await stripe.accounts.create(
        {
          type: "express",
          country,
          email: context.email ?? undefined,
          business_type:
            context.sellerType === "business" ? "company" : "individual",
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
          },
          metadata: { sellerId: context.sellerId },
        },
        { idempotencyKey: `connect-account-${context.sellerId}` },
      );
      accountId = account.id;
      await ctx.runMutation(internal.stripeSync.saveConnectAccount, {
        sellerId: context.sellerId,
        accountId,
      });
    }

    const link = await stripe.accountLinks.create({
      account: accountId,
      type: context.detailsSubmitted ? "account_update" : "account_onboarding",
      refresh_url: `${base}/sell/dashboard?stripe=refresh`,
      return_url: `${base}/sell/dashboard?stripe=return`,
    });
    return { url: link.url };
  },
});

/** Pull the latest account state from Stripe (onboarding return / refresh). */
export const syncConnectAccount = action({
  args: {},
  handler: async (ctx) => {
    const context = await ctx.runQuery(internal.stripeSync.connectContext, {});
    if (!context.accountId) {
      throw new Error("This shop has no Stripe account yet.");
    }
    const account = await stripeClient().accounts.retrieve(
      context.accountId,
    );
    await ctx.runMutation(internal.stripeSync.accountUpdated, {
      eventId: `account-sync:${account.id}:${Date.now()}`,
      source: "connect",
      accountId: account.id,
      chargesEnabled: !!account.charges_enabled,
      payoutsEnabled: !!account.payouts_enabled,
      detailsSubmitted: !!account.details_submitted,
      currentlyDue: account.requirements?.currently_due ?? [],
      disabledReason: account.requirements?.disabled_reason ?? undefined,
    });
    return {
      chargesEnabled: !!account.charges_enabled,
      payoutsEnabled: !!account.payouts_enabled,
      detailsSubmitted: !!account.details_submitted,
      currentlyDue: account.requirements?.currently_due ?? [],
      disabledReason: account.requirements?.disabled_reason ?? null,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Card checkout                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Create or reuse the PaymentIntent for one card order. The amount always comes
 * from the stored order (never the client), and the idempotency key prevents a
 * double-click from creating two intents.
 */
export const createPaymentIntent = action({
  args: { orderId: v.string() },
  handler: async (ctx, args): Promise<{ clientSecret: string }> => {
    if (!cardsConfigured()) {
      throw new Error(
        "Card payments are not configured. Add the Stripe test keys and webhook secret first, or pay on delivery.",
      );
    }
    const context = await ctx.runQuery(internal.stripeSync.paymentContext, {
      orderId: args.orderId,
    });
    const stripe = stripeClient();

    if (context.existingPaymentIntentId) {
      const existing = await stripe.paymentIntents.retrieve(
        context.existingPaymentIntentId,
      );
      if (existing.status === "succeeded") {
        throw new Error("Stripe already confirmed this payment.");
      }
      if (
        existing.client_secret &&
        existing.status !== "canceled"
      ) {
        return { clientSecret: existing.client_secret };
      }
    }

    const attempt = context.attempts + 1;
    const intent = await stripe.paymentIntents.create(
      {
        amount: context.amountCents,
        currency: context.currency,
        description: context.description,
        receipt_email: context.email ?? undefined,
        automatic_payment_methods: { enabled: true },
        metadata: {
          orderId: context.orderId,
          integration: "royalmarket",
        },
        transfer_group: `order_${context.orderId}`,
      },
      { idempotencyKey: `order-${context.orderId}-attempt-${attempt}` },
    );
    if (!intent.client_secret) {
      throw new Error("Stripe did not return a client secret.");
    }

    await ctx.runMutation(internal.stripeSync.attachPaymentIntent, {
      orderId: context.orderId,
      paymentIntentId: intent.id,
      attempt,
    });
    return { clientSecret: intent.client_secret };
  },
});

/* -------------------------------------------------------------------------- */
/* Transfers                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Admin releases seller funds for one paid card order. Only delivered, paid
 * lines are transferred; commission is read from the existing ledger. A Stripe
 * transfer is created per seller and recorded as `in_transit` — it only becomes
 * `paid` when Stripe's transfer webhook confirms it.
 */
export const releaseOrderFunds = action({
  args: { orderId: v.string() },
  handler: async (ctx, args) => {
    await callerIsAdmin(ctx);
    const plan = await ctx.runQuery(internal.stripeSync.transferContext, {
      orderId: args.orderId,
    });
    const stripe = stripeClient();
    const results: {
      sellerId: string;
      sellerName: string;
      amountCents: number;
      status: "transferred" | "skipped" | "failed";
      message: string;
    }[] = [];

    for (const seller of plan.sellers) {
      if (!seller.eligible || !seller.accountId || seller.amountCents <= 0) {
        results.push({
          sellerId: seller.sellerId,
          sellerName: seller.sellerName,
          amountCents: seller.amountCents,
          status: "skipped",
          message: seller.reason ?? "Nothing to transfer.",
        });
        continue;
      }
      try {
        const key = `transfer-${plan.orderId}-${seller.sellerId}-${[
          ...seller.itemIds,
        ]
          .sort()
          .join("_")}`;
        const transfer = await stripe.transfers.create(
          {
            amount: seller.amountCents,
            currency: "usd",
            destination: seller.accountId,
            transfer_group: `order_${plan.orderId}`,
            source_transaction: plan.chargeId ?? undefined,
            description: `RoyalMarket order ${plan.orderId.slice(-8)}`,
            metadata: {
              orderId: plan.orderId,
              sellerId: seller.sellerId,
            },
          },
          { idempotencyKey: key },
        );
        await ctx.runMutation(internal.stripeSync.recordTransfer, {
          orderId: plan.orderId,
          sellerId: seller.sellerId,
          transferId: transfer.id,
          amountCents: transfer.amount,
          itemIds: seller.itemIds,
        });
        results.push({
          sellerId: seller.sellerId,
          sellerName: seller.sellerName,
          amountCents: seller.amountCents,
          status: "transferred",
          message: "Stripe confirmed the transfer; awaiting transfer webhook.",
        });
      } catch (error) {
        results.push({
          sellerId: seller.sellerId,
          sellerName: seller.sellerName,
          amountCents: seller.amountCents,
          status: "failed",
          message: stripeMessage(error),
        });
      }
    }
    return results;
  },
});

/* -------------------------------------------------------------------------- */
/* Refunds                                                                    */
/* -------------------------------------------------------------------------- */

/** Admin issues a provider-backed refund for one paid card line. */
export const refundItem = action({
  args: { itemId: v.string(), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await callerIsAdmin(ctx);
    const context = await ctx.runQuery(internal.stripeSync.refundContext, {
      itemId: args.itemId,
    });
    const stripe = stripeClient();

    const refund = await stripe.refunds.create(
      {
        payment_intent: context.paymentIntentId,
        amount: context.amountCents,
        metadata: {
          orderItemId: context.itemId,
          orderId: context.orderId,
          note: args.note?.slice(0, 200) ?? "",
        },
        reverse_transfer: context.transferred,
      },
      { idempotencyKey: `refund-${context.itemId}` },
    );

    if (refund.status === "failed" || refund.status === "canceled") {
      await ctx.runMutation(internal.stripeSync.refundFailed, {
        itemId: context.itemId,
        refundId: refund.id,
      });
      throw new Error("Stripe rejected the refund.");
    }
    if (refund.status === "succeeded") {
      await ctx.runMutation(internal.stripeSync.refundSucceeded, {
        itemId: context.itemId,
        refundId: refund.id,
        amountCents: refund.amount,
      });
      return { status: "succeeded" as const, refundId: refund.id };
    }
    await ctx.runMutation(internal.stripeSync.refundPending, {
      itemId: context.itemId,
      refundId: refund.id,
    });
    return { status: "pending" as const, refundId: refund.id };
  },
});

/* -------------------------------------------------------------------------- */
/* Webhook                                                                    */
/* -------------------------------------------------------------------------- */

function verifyEvent(
  payload: string,
  signature: string,
): { event: Stripe.Event; source: "platform" | "connect" } {
  const env = readStripeEnv();
  const stripe = stripeClient();
  const candidates: { secret: string | undefined; source: "platform" | "connect" }[] =
    [
      { secret: env.webhookSecret, source: "platform" },
      { secret: env.connectWebhookSecret, source: "connect" },
    ];
  let lastError: unknown = null;
  for (const candidate of candidates) {
    if (!candidate.secret) continue;
    try {
      return {
        event: stripe.webhooks.constructEvent(
          payload,
          signature,
          candidate.secret,
        ),
        source: candidate.source,
      };
    } catch (error) {
      lastError = error;
    }
  }
  if (!env.webhookSecret && !env.connectWebhookSecret) {
    throw new Error(
      "Stripe webhooks are not configured: add STRIPE_WEBHOOK_SECRET (and STRIPE_CONNECT_WEBHOOK_SECRET) in the Keys tab.",
    );
  }
  throw new Error(
    `Invalid Stripe signature: ${stripeMessage(lastError)}`,
  );
}

function cardFromCharge(
  charge: Stripe.Charge | null | undefined,
): { brand?: string; last4?: string } {
  const card = charge?.payment_method_details?.card;
  return { brand: card?.brand ?? undefined, last4: card?.last4 ?? undefined };
}

/**
 * Verify the signature against the raw body, then apply the event through an
 * idempotent internal mutation. Throwing makes the HTTP endpoint return a
 * non-2xx so Stripe retries instead of silently dropping money state.
 */
export const handleWebhook = internalAction({
  args: { payload: v.string(), signature: v.string() },
  handler: async (ctx, args) => {
    const { event, source } = verifyEvent(args.payload, args.signature);
    const stripe = stripeClient();

    switch (event.type) {
      case "payment_intent.succeeded": {
        const intent = event.data.object as Stripe.PaymentIntent;
        const orderId = intent.metadata?.orderId;
        if (!orderId) return { received: true, ignored: "no order metadata" };
        let charge: Stripe.Charge | null = null;
        if (typeof intent.latest_charge === "string") {
          charge = await stripe.charges.retrieve(intent.latest_charge);
        } else {
          charge = intent.latest_charge ?? null;
        }
        await ctx.runMutation(internal.stripeSync.paymentSucceeded, {
          eventId: event.id,
          orderId,
          paymentIntentId: intent.id,
          chargeId:
            typeof intent.latest_charge === "string"
              ? intent.latest_charge
              : (intent.latest_charge?.id ?? undefined),
          amountCents: intent.amount_received || intent.amount,
          currency: intent.currency,
          cardBrand: cardFromCharge(charge).brand,
          cardLast4: cardFromCharge(charge).last4,
        });
        return { received: true };
      }
      case "payment_intent.payment_failed":
      case "payment_intent.canceled": {
        const intent = event.data.object as Stripe.PaymentIntent;
        const orderId = intent.metadata?.orderId;
        if (!orderId) return { received: true, ignored: "no order metadata" };
        await ctx.runMutation(internal.stripeSync.paymentFailed, {
          eventId: event.id,
          orderId,
          paymentIntentId: intent.id,
          message:
            intent.last_payment_error?.message ??
            (event.type === "payment_intent.canceled"
              ? "Payment was canceled."
              : "Card payment was declined."),
        });
        return { received: true };
      }
      case "account.updated": {
        const account = event.data.object as Stripe.Account;
        if (!event.account) return { received: true, ignored: "no account" };
        await ctx.runMutation(internal.stripeSync.accountUpdated, {
          eventId: event.id,
          source,
          accountId: event.account,
          chargesEnabled: !!account.charges_enabled,
          payoutsEnabled: !!account.payouts_enabled,
          detailsSubmitted: !!account.details_submitted,
          currentlyDue: account.requirements?.currently_due ?? [],
          disabledReason:
            account.requirements?.disabled_reason ?? undefined,
        });
        return { received: true };
      }
      case "transfer.created":
      case "transfer.updated":
      case "transfer.reversed": {
        const transfer = event.data.object as Stripe.Transfer;
        const result = await ctx.runMutation(
          internal.stripeSync.transferConfirmed,
          {
            eventId: event.id,
            type: event.type,
            transferId: transfer.id,
            amountCents: transfer.amount,
            currency: transfer.currency,
            reversed: !!transfer.reversed,
          },
        );
        if (result.reason === "unknown_transfer") {
          // The API call may not have recorded the payout yet; ask Stripe to
          // retry rather than acknowledging an event we could not apply.
          throw new Error(`Unknown transfer ${transfer.id}.`);
        }
        return { received: true };
      }
      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        // `refunds.data` is normally expanded on webhook charges; fall back to
        // listing the payment's refunds so a refund is never missed.
        let refunds = charge.refunds?.data ?? [];
        if (refunds.length === 0 && charge.payment_intent) {
          const paymentIntentId =
            typeof charge.payment_intent === "string"
              ? charge.payment_intent
              : charge.payment_intent.id;
          const listed = await stripe.refunds.list({
            payment_intent: paymentIntentId,
            limit: 20,
          });
          refunds = listed.data;
        }
        for (const refund of refunds) {
          const itemId = refund.metadata?.orderItemId;
          if (!itemId) continue;
          if (refund.status === "succeeded") {
            await ctx.runMutation(internal.stripeSync.refundSucceeded, {
              itemId,
              refundId: refund.id,
              amountCents: refund.amount,
            });
          } else if (refund.status === "failed" || refund.status === "canceled") {
            await ctx.runMutation(internal.stripeSync.refundFailed, {
              itemId,
              refundId: refund.id,
            });
          } else {
            await ctx.runMutation(internal.stripeSync.refundPending, {
              itemId,
              refundId: refund.id,
            });
          }
        }
        return { received: true };
      }
      case "refund.updated": {
        const refund = event.data.object as Stripe.Refund;
        const itemId = refund.metadata?.orderItemId;
        if (!itemId) return { received: true, ignored: "no item metadata" };
        if (refund.status === "succeeded") {
          await ctx.runMutation(internal.stripeSync.refundSucceeded, {
            itemId,
            refundId: refund.id,
            amountCents: refund.amount,
          });
        } else if (refund.status === "failed" || refund.status === "canceled") {
          await ctx.runMutation(internal.stripeSync.refundFailed, {
            itemId,
            refundId: refund.id,
          });
        } else {
          await ctx.runMutation(internal.stripeSync.refundPending, {
            itemId,
            refundId: refund.id,
          });
        }
        return { received: true };
      }
      default:
        return { received: true, ignored: event.type };
    }
  },
});
