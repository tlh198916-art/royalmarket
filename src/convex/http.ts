import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

auth.addHttpRoutes(http);

/**
 * Stripe webhook endpoint: `<CONVEX_SITE_URL>/stripe/webhook`.
 *
 * The raw body is passed unchanged to a Node action, which verifies the
 * Stripe-Signature against STRIPE_WEBHOOK_SECRET (platform events) or
 * STRIPE_CONNECT_WEBHOOK_SECRET (Connect events) before any state is touched.
 * A non-2xx response makes Stripe retry; applied events are idempotent by
 * Stripe event id.
 */
http.route({
  path: "/stripe/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const signature = request.headers.get("stripe-signature");
    if (!signature) {
      return new Response("Missing Stripe-Signature header", { status: 400 });
    }
    const payload = await request.text();
    try {
      const result = await ctx.runAction(internal.stripe.handleWebhook, {
        payload,
        signature,
      });
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Webhook handling failed.";
      console.error("Stripe webhook rejected:", message);
      return new Response(message, { status: 400 });
    }
  }),
});

export default http;
