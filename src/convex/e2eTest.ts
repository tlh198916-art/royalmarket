"use node";

/**
 * TEMPORARY verification harness for Phase 2. It only uses test-mode Stripe
 * keys and is removed after the end-to-end run.
 */
import Stripe from "stripe";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { readStripeEnv } from "./stripeConfig";

function client(): Stripe {
  const { secretKey } = readStripeEnv();
  if (!secretKey || !secretKey.startsWith("sk_test_")) {
    throw new Error("Test-mode Stripe secret key required.");
  }
  return new Stripe(secretKey, { maxNetworkRetries: 2 });
}

export const stripeProbe = internalAction({
  args: {
    accountId: v.optional(v.string()),
    paymentIntentId: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const stripe = client();
    const platform = await stripe.accounts.retrieve();
    const hooks = await stripe.webhookEndpoints.list({ limit: 20 });
    let account = null;
    if (args.accountId) {
      const a = await stripe.accounts.retrieve(args.accountId);
      account = {
        id: a.id,
        businessType: a.business_type,
        chargesEnabled: a.charges_enabled,
        payoutsEnabled: a.payouts_enabled,
        detailsSubmitted: a.details_submitted,
        currentlyDue: a.requirements?.currently_due ?? [],
        eventuallyDue: a.requirements?.eventually_due ?? [],
        disabledReason: a.requirements?.disabled_reason ?? null,
        externalAccounts:
          a.external_accounts?.data.map((e) => ({
            id: e.id,
            object: e.object,
            last4: "last4" in e ? e.last4 : null,
            bankName: "bank_name" in e ? e.bank_name : null,
          })) ?? [],
      };
    }
    let intent = null;
    if (args.paymentIntentId) {
      const pi = await stripe.paymentIntents.retrieve(args.paymentIntentId, {
        expand: ["latest_charge"],
      });
      const charge =
        typeof pi.latest_charge === "string" ? null : pi.latest_charge;
      intent = {
        id: pi.id,
        status: pi.status,
        amount: pi.amount,
        amountReceived: pi.amount_received,
        currency: pi.currency,
        livemode: pi.livemode,
        paymentMethod: pi.payment_method,
        latestCharge: charge?.id ?? (typeof pi.latest_charge === "string" ? pi.latest_charge : null),
        cardBrand: charge?.payment_method_details?.card?.brand ?? null,
        cardLast4: charge?.payment_method_details?.card?.last4 ?? null,
        metadata: pi.metadata,
        lastPaymentError: pi.last_payment_error?.message ?? null,
      };
    }
    return {
      platform: {
        id: platform.id,
        country: platform.country,
        defaultCurrency: platform.default_currency,
        chargesEnabled: platform.charges_enabled,
        payoutsEnabled: platform.payouts_enabled,
      },
      webhooks: hooks.data.map((h) => ({
        id: h.id,
        url: h.url,
        status: h.status,
        livemode: h.livemode,
        enabledEvents: h.enabled_events,
      })),
      account,
      intent,
    };
  },
});

export const prepareConnectAccount = internalAction({
  args: { accountId: v.string() },
  handler: async (_ctx, args) => {
    const stripe = client();
    const account = await stripe.accounts.update(args.accountId, {
      business_type: "individual",
      business_profile: {
        mcc: "5734",
        product_description: "RoyalMarket test marketplace",
        support_phone: "0000000000",
        url: "https://rich-suits-throw.vly.sh",
      },
      individual: {
        first_name: "Royal",
        last_name: "Market",
        email: "royalmarket-e2e@mailinator.com",
        phone: "0000000000",
        dob: { day: 1, month: 1, year: 1902 },
        ssn_last_4: "0000",
        address: {
          line1: "address_full_match",
          city: "San Francisco",
          state: "CA",
          postal_code: "94105",
          country: "US",
        },
      },
      external_account: {
        object: "bank_account",
        country: "US",
        currency: "usd",
        account_holder_name: "Royal Market",
        account_holder_type: "individual",
        routing_number: "110000000",
        account_number: "000123456789",
      },
      tos_acceptance: {
        date: Math.floor(Date.now() / 1000),
        ip: "127.0.0.1",
      },
    });
    return {
      id: account.id,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      detailsSubmitted: account.details_submitted,
      currentlyDue: account.requirements?.currently_due ?? [],
      disabledReason: account.requirements?.disabled_reason ?? null,
    };
  },
});

export const confirmTestPayment = internalAction({
  args: {
    paymentIntentId: v.string(),
    card: v.union(v.literal("success"), v.literal("declined")),
  },
  handler: async (_ctx, args) => {
    const stripe = client();
    const number =
      args.card === "success" ? "4242424242424242" : "4000000000000002";
    const token = await stripe.tokens.create({
      card: {
        number,
        exp_month: 12,
        exp_year: 2034,
        cvc: "123",
      },
    });
    const method = await stripe.paymentMethods.create({
      type: "card",
      card: { token: token.id },
    });
    try {
      const pi = await stripe.paymentIntents.confirm(args.paymentIntentId, {
        payment_method: method.id,
      });
      return {
        id: pi.id,
        status: pi.status,
        amount: pi.amount,
        amountReceived: pi.amount_received,
        currency: pi.currency,
        latestCharge:
          typeof pi.latest_charge === "string"
            ? pi.latest_charge
            : (pi.latest_charge?.id ?? null),
        paymentMethod: method.id,
        error: null,
      };
    } catch (error) {
      const pi = await stripe.paymentIntents.retrieve(args.paymentIntentId);
      return {
        id: pi.id,
        status: pi.status,
        amount: pi.amount,
        amountReceived: pi.amount_received,
        currency: pi.currency,
        latestCharge:
          typeof pi.latest_charge === "string"
            ? pi.latest_charge
            : (pi.latest_charge?.id ?? null),
        paymentMethod: method.id,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});

export const listEvents = internalAction({
  args: { objectId: v.optional(v.string()), type: v.optional(v.string()) },
  handler: async (_ctx, args) => {
    const stripe = client();
    const events = await stripe.events.list({ limit: 100 });
    return events.data
      .filter((event) => {
        if (args.type && event.type !== args.type) return false;
        if (!args.objectId) return true;
        const object = event.data.object as { id?: string; payment_intent?: string };
        return (
          object.id === args.objectId ||
          object.payment_intent === args.objectId
        );
      })
      .map((event) => ({
        id: event.id,
        type: event.type,
        created: event.created,
        livemode: event.livemode,
        objectId: (event.data.object as { id?: string }).id ?? null,
        objectStatus:
          (event.data.object as { status?: string }).status ?? null,
      }));
  },
});

export const deliverEvent = internalAction({
  args: {
    endpoint: v.string(),
    eventId: v.string(),
    signature: v.union(v.literal("valid"), v.literal("invalid")),
  },
  handler: async (_ctx, args) => {
    const stripe = client();
    const env = readStripeEnv();
    if (!env.webhookSecret) throw new Error("No platform webhook secret.");
    const event = await stripe.events.retrieve(args.eventId);
    const payload = JSON.stringify(event);
    const header =
      args.signature === "valid"
        ? stripe.webhooks.generateTestHeaderString({
            payload,
            secret: env.webhookSecret,
          })
        : `t=${Math.floor(Date.now() / 1000)},v1=${"0".repeat(64)}`;
    const response = await fetch(args.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stripe-signature": header,
      },
      body: payload,
    });
    return {
      eventId: event.id,
      type: event.type,
      status: response.status,
      body: (await response.text()).slice(0, 2000),
    };
  },
});

/**
 * Signed synthetic success event used only to probe a late success arriving
 * after an order was cancelled. The event is explicitly marked e2e-synthetic
 * in its request id and is not represented as a Stripe-generated event.
 */
export const deliverSyntheticLateSuccess = internalAction({
  args: {
    endpoint: v.string(),
    orderId: v.string(),
    paymentIntentId: v.string(),
    amountCents: v.number(),
    currency: v.string(),
  },
  handler: async (_ctx, args) => {
    const stripe = client();
    const env = readStripeEnv();
    if (!env.webhookSecret) throw new Error("No platform webhook secret.");
    const now = Math.floor(Date.now() / 1000);
    const event = {
      id: `evt_e2e_synthetic_${now}`,
      object: "event",
      api_version: "2026-04-22.preview",
      created: now,
      data: {
        object: {
          id: args.paymentIntentId,
          object: "payment_intent",
          amount: args.amountCents,
          amount_received: args.amountCents,
          currency: args.currency,
          latest_charge: null,
          metadata: { orderId: args.orderId },
        },
      },
      livemode: false,
      pending_webhooks: 0,
      request: { id: "req_e2e_synthetic", idempotency_key: null },
      type: "payment_intent.succeeded",
    };
    const payload = JSON.stringify(event);
    const header = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: env.webhookSecret,
    });
    const response = await fetch(args.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stripe-signature": header,
      },
      body: payload,
    });
    return {
      eventId: event.id,
      type: event.type,
      status: response.status,
      body: (await response.text()).slice(0, 2000),
    };
  },
});
