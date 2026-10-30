import { describe, expect, test } from "bun:test";
import type { Id } from "@/convex/_generated/dataModel";
import * as admin from "@/convex/admin";
import * as commissions from "@/convex/commissions";
import * as orders from "@/convex/orders";
import * as payments from "@/convex/payments";
import * as products from "@/convex/products";
import * as stripeSync from "@/convex/stripeSync";
import * as subscriptions from "@/convex/subscriptions";
import { computeSellerTransfer } from "@/convex/stripeConfig";
import schema from "@/convex/schema";
import { defineTestApp } from "convex-test";

/**
 * Stripe state-machine tests. No network and no Stripe SDK calls: every test
 * drives the internal mutations that a VERIFIED webhook (or a Stripe API
 * response) would call, and asserts the local ledger never claims more than
 * Stripe confirmed.
 */

const app = defineTestApp({ schema });
const { internal, createTest } = app.defineModules({
  admin,
  commissions,
  orders,
  payments,
  products,
  stripeSync,
  subscriptions,
});
type TestT = ReturnType<typeof createTest>;

const as = (t: TestT, userId: Id<"users">) =>
  t.withIdentity({ subject: `${userId}|test-session` });

async function newUser(
  t: TestT,
  options: { role?: "admin" | "user"; seller?: boolean } = {},
) {
  return await t.run((ctx) =>
    ctx.db.insert("users", {
      email: `${crypto.randomUUID()}@example.com`,
      role: options.role ?? "user",
      isSeller: options.seller ?? false,
      sellerType: options.seller ? ("individual" as const) : undefined,
      emailVerificationTime: Date.now(),
    }),
  );
}

async function insertProduct(t: TestT, sellerId: Id<"users">) {
  return await t.run((ctx) =>
    ctx.db.insert("products", {
      sellerId,
      title: "Stoneware mug",
      description: "A wheel-thrown mug with a matte glaze.",
      categoryId: "home",
      priceCents: 10_000,
      quantity: 10,
      condition: "new" as const,
      imageStorageIds: [],
      returns: { accepted: false, days: 0 },
      status: "active" as const,
      views: 0,
      soldCount: 0,
    }),
  );
}

type CardOrderArgs = {
  sellerId: Id<"users">;
  buyerId: Id<"users">;
  productId: Id<"products">;
  quantity?: number;
  priceCents?: number;
  feeCents?: number;
  paymentStatus?: "unpaid" | "processing" | "paid" | "failed";
  itemStatus?: "placed" | "delivered";
  itemPaymentStatus?: "unpaid" | "paid";
};

/** Insert a card order + one line directly, bypassing checkout. */
async function insertCardOrder(t: TestT, args: CardOrderArgs) {
  const quantity = args.quantity ?? 1;
  const priceCents = args.priceCents ?? 10_000;
  const feeCents = args.feeCents ?? 500;
  return await t.run(async (ctx) => {
    const orderId = await ctx.db.insert("orders", {
      buyerId: args.buyerId,
      items: [
        {
          productId: args.productId,
          sellerId: args.sellerId,
          title: "Stoneware mug",
          priceCents,
          quantity,
        },
      ],
      subtotalCents: priceCents * quantity,
      totalCents: priceCents * quantity + feeCents,
      status: args.itemStatus === "delivered" ? "delivered" : "placed",
      paymentMethod: "card",
      paymentStatus: args.paymentStatus ?? "unpaid",
      fulfillments: [
        {
          sellerId: args.sellerId,
          method: "shipping" as const,
          buyerAgreed: true,
          sellerAgreed: true,
          feeCents,
        },
      ],
      shippingFeeCents: feeCents,
      placedAt: Date.now(),
    });
    const itemId = await ctx.db.insert("orderItems", {
      orderId,
      buyerId: args.buyerId,
      sellerId: args.sellerId,
      productId: args.productId,
      title: "Stoneware mug",
      priceCents,
      quantity,
      status: args.itemStatus ?? "placed",
      paymentStatus: args.itemPaymentStatus ?? "unpaid",
    });
    return { orderId, itemId, totalCents: priceCents * quantity + feeCents };
  });
}

async function enableConnect(t: TestT, sellerId: Id<"users">) {
  return await t.run((ctx) =>
    ctx.db.insert("sellerPaymentAccounts", {
      sellerId,
      provider: "stripe" as const,
      accountId: `acct_test_${crypto.randomUUID().slice(0, 8)}`,
      onboardingStatus: "enabled" as const,
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      updatedAt: Date.now(),
    }),
  );
}

describe("payment intent webhook application", () => {
  test("a matching succeeded event marks the order and items paid once", async () => {
    const t = createTest();
    const seller = await newUser(t, { seller: true });
    const buyer = await newUser(t);
    const product = await insertProduct(t, seller);
    const { orderId, itemId, totalCents } = await insertCardOrder(t, {
      sellerId: seller,
      buyerId: buyer,
      productId: product,
    });

    const result = await t.mutation(internal.stripeSync.paymentSucceeded, {
      eventId: "evt_paid_1",
      orderId,
      paymentIntentId: "pi_test_1",
      chargeId: "ch_test_1",
      amountCents: totalCents,
      currency: "usd",
      cardBrand: "visa",
      cardLast4: "4242",
    });
    expect(result.applied).toBe(true);

    let order = await t.run((ctx) => ctx.db.get(orderId));
    expect(order?.paymentStatus).toBe("paid");
    expect(order?.stripeChargeId).toBe("ch_test_1");
    expect(order?.cardLast4).toBe("4242");
    const item = await t.run((ctx) => ctx.db.get(itemId));
    expect(item?.paymentStatus).toBe("paid");
    expect(item?.paidAt).toBeGreaterThan(0);

    // Same event replayed: recorded but not applied twice.
    const replay = await t.mutation(internal.stripeSync.paymentSucceeded, {
      eventId: "evt_paid_1",
      orderId,
      paymentIntentId: "pi_test_1",
      amountCents: totalCents,
      currency: "usd",
    });
    expect(replay).toMatchObject({ applied: false, reason: "duplicate" });

    // A different event for an already-paid order is also a no-op.
    const second = await t.mutation(internal.stripeSync.paymentSucceeded, {
      eventId: "evt_paid_2",
      orderId,
      paymentIntentId: "pi_test_1",
      amountCents: totalCents,
      currency: "usd",
    });
    expect(second).toMatchObject({ applied: false, reason: "already_paid" });

    order = await t.run((ctx) => ctx.db.get(orderId));
    expect(order?.paidAt).toBeGreaterThan(0);
  });

  test("an amount mismatch is rejected and leaves the order unpaid", async () => {
    const t = createTest();
    const seller = await newUser(t, { seller: true });
    const buyer = await newUser(t);
    const product = await insertProduct(t, seller);
    const { orderId } = await insertCardOrder(t, {
      sellerId: seller,
      buyerId: buyer,
      productId: product,
    });

    await expect(
      t.mutation(internal.stripeSync.paymentSucceeded, {
        eventId: "evt_wrong",
        orderId,
        paymentIntentId: "pi_wrong",
        amountCents: 1,
        currency: "usd",
      }),
    ).rejects.toThrow(/does not match/i);

    const order = await t.run((ctx) => ctx.db.get(orderId));
    expect(order?.paymentStatus).toBe("unpaid");

    // Replaying the corrected event still works: the failed attempt left no
    // event row behind because the mutation rolled back.
    const corrected = await t.mutation(internal.stripeSync.paymentSucceeded, {
      eventId: "evt_wrong",
      orderId,
      paymentIntentId: "pi_wrong",
      amountCents: order?.totalCents ?? 0,
      currency: "usd",
    });
    expect(corrected.applied).toBe(true);
  });

  test("failed payments never overwrite a confirmed payment", async () => {
    const t = createTest();
    const seller = await newUser(t, { seller: true });
    const buyer = await newUser(t);
    const product = await insertProduct(t, seller);
    const { orderId, totalCents } = await insertCardOrder(t, {
      sellerId: seller,
      buyerId: buyer,
      productId: product,
    });

    await t.mutation(internal.stripeSync.paymentSucceeded, {
      eventId: "evt_ok",
      orderId,
      paymentIntentId: "pi_ok",
      amountCents: totalCents,
      currency: "usd",
    });
    const failure = await t.mutation(internal.stripeSync.paymentFailed, {
      eventId: "evt_fail",
      orderId,
      message: "Card declined",
    });
    expect(failure).toMatchObject({ applied: false, reason: "already_paid" });

    const order = await t.run((ctx) => ctx.db.get(orderId));
    expect(order?.paymentStatus).toBe("paid");
    expect(order?.paymentFailureMessage).toBeUndefined();
  });

  test("a failed attempt records the failure without charging anyone", async () => {
    const t = createTest();
    const seller = await newUser(t, { seller: true });
    const buyer = await newUser(t);
    const product = await insertProduct(t, seller);
    const { orderId, itemId } = await insertCardOrder(t, {
      sellerId: seller,
      buyerId: buyer,
      productId: product,
    });

    await t.mutation(internal.stripeSync.paymentFailed, {
      eventId: "evt_declined",
      orderId,
      message: "Your card was declined.",
    });
    const order = await t.run((ctx) => ctx.db.get(orderId));
    expect(order?.paymentStatus).toBe("failed");
    expect(order?.paymentFailureMessage).toContain("declined");
    const item = await t.run((ctx) => ctx.db.get(itemId));
    expect(item?.paymentStatus).toBe("failed");
  });
});

describe("Connect account synchronisation", () => {
  test("account.updated only touches accounts the app created", async () => {
    const t = createTest();
    const seller = await newUser(t, { seller: true });
    await enableConnect(t, seller);

    const unknown = await t.mutation(internal.stripeSync.accountUpdated, {
      eventId: "evt_unknown_account",
      source: "connect",
      accountId: "acct_not_ours",
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      currentlyDue: [],
    });
    expect(unknown).toMatchObject({
      applied: false,
      reason: "unknown_account",
    });

    const accounts = await t.run((ctx) =>
      ctx.db.query("sellerPaymentAccounts").collect(),
    );
    const accountId = accounts[0].accountId!;
    const applied = await t.mutation(internal.stripeSync.accountUpdated, {
      eventId: "evt_account_1",
      source: "connect",
      accountId,
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      currentlyDue: [],
    });
    expect(applied).toMatchObject({ applied: true, status: "enabled" });
    const account = await t.run((ctx) => ctx.db.get(accounts[0]._id));
    expect(account?.payoutsEnabled).toBe(true);

    const restricted = await t.mutation(internal.stripeSync.accountUpdated, {
      eventId: "evt_account_2",
      source: "connect",
      accountId,
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: true,
      currentlyDue: ["external_account"],
      disabledReason: "requirements.past_due",
    });
    expect(restricted).toMatchObject({ applied: true, status: "restricted" });
    const updated = await t.run((ctx) => ctx.db.get(accounts[0]._id));
    expect(updated?.requirementsCurrentlyDue).toEqual(["external_account"]);

    // Replayed event id is ignored.
    const replay = await t.mutation(internal.stripeSync.accountUpdated, {
      eventId: "evt_account_2",
      source: "connect",
      accountId,
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: true,
      currentlyDue: [],
    });
    expect(replay).toMatchObject({ applied: false, reason: "duplicate" });
  });
});

describe("seller transfers and payout confirmation", () => {
  test("transfer math uses delivered, paid lines and the existing commission ledger", async () => {
    const t = createTest();
    const adminUser = await newUser(t, { role: "admin" });
    const seller = await newUser(t, { seller: true });
    const buyer = await newUser(t);
    const product = await insertProduct(t, seller);
    await enableConnect(t, seller);
    const { orderId, itemId } = await insertCardOrder(t, {
      sellerId: seller,
      buyerId: buyer,
      productId: product,
      itemStatus: "delivered",
      itemPaymentStatus: "paid",
      paymentStatus: "paid",
      feeCents: 500,
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("commissionLedger", {
        sellerId: seller,
        orderId,
        orderItemId: itemId,
        planId: "starter",
        baseCents: 10_000,
        commissionBps: 500,
        amountCents: 500,
        status: "pending",
        occurredAt: Date.now(),
      });
    });

    const plan = await as(t, adminUser).query(
      internal.stripeSync.transferContext,
      { orderId },
    );
    expect(plan.sellers).toHaveLength(1);
    expect(plan.sellers[0]).toMatchObject({
      grossCents: 10_000,
      feeCents: 500,
      commissionCents: 500,
      amountCents: 10_000,
      eligible: true,
    });

    // Non-admins cannot read transfer plans.
    await expect(
      as(t, seller).query(internal.stripeSync.transferContext, { orderId }),
    ).rejects.toThrow(/admin access/i);

    const pure = computeSellerTransfer(
      [
        {
          priceCents: 10_000,
          quantity: 1,
          status: "delivered",
          paymentStatus: "paid",
          commissionCents: 500,
        },
        {
          priceCents: 2_000,
          quantity: 1,
          status: "placed",
          paymentStatus: "paid",
          commissionCents: 100,
        },
        {
          priceCents: 3_000,
          quantity: 1,
          status: "delivered",
          paymentStatus: "refunded",
          commissionCents: 0,
        },
      ],
      500,
    );
    expect(pure).toMatchObject({
      grossCents: 10_000,
      feeCents: 500,
      commissionCents: 500,
      netCents: 10_000,
      itemCount: 1,
    });
  });

  test("a transfer stays in transit until Stripe's webhook confirms it", async () => {
    const t = createTest();
    const seller = await newUser(t, { seller: true });
    const buyer = await newUser(t);
    const product = await insertProduct(t, seller);
    await enableConnect(t, seller);
    const { orderId, itemId } = await insertCardOrder(t, {
      sellerId: seller,
      buyerId: buyer,
      productId: product,
      itemStatus: "delivered",
      itemPaymentStatus: "paid",
      paymentStatus: "paid",
    });

    const recorded = await t.mutation(internal.stripeSync.recordTransfer, {
      orderId,
      sellerId: seller,
      transferId: "tr_test_1",
      amountCents: 10_000,
      itemIds: [itemId],
    });
    expect(recorded.duplicate).toBe(false);
    const payout = await t.run((ctx) =>
      ctx.db
        .query("payouts")
        .withIndex("by_transfer", (s) => s.eq("providerTransferId", "tr_test_1"))
        .first(),
    );
    expect(payout?.status).toBe("in_transit");
    expect(payout?.confirmedAt).toBeUndefined();

    // Re-recording the same transfer never creates another payout.
    const again = await t.mutation(internal.stripeSync.recordTransfer, {
      orderId,
      sellerId: seller,
      transferId: "tr_test_1",
      amountCents: 10_000,
      itemIds: [itemId],
    });
    expect(again.duplicate).toBe(true);

    const confirmed = await t.mutation(
      internal.stripeSync.transferConfirmed,
      {
        eventId: "evt_transfer_created",
        type: "transfer.created",
        transferId: "tr_test_1",
        amountCents: 10_000,
        currency: "usd",
        reversed: false,
      },
    );
    expect(confirmed).toMatchObject({ applied: true, status: "paid" });
    const paid = await t.run((ctx) => ctx.db.get(recorded.payoutId!));
    expect(paid?.confirmedAt).toBeGreaterThan(0);

    const reversed = await t.mutation(
      internal.stripeSync.transferConfirmed,
      {
        eventId: "evt_transfer_reversed",
        type: "transfer.reversed",
        transferId: "tr_test_1",
        amountCents: 10_000,
        currency: "usd",
        reversed: true,
      },
    );
    expect(reversed).toMatchObject({ applied: true, status: "reversed" });
  });

  test("an unknown transfer asks Stripe to retry instead of trusting it", async () => {
    const t = createTest();
    const result = await t.mutation(internal.stripeSync.transferConfirmed, {
      eventId: "evt_missing_transfer",
      type: "transfer.created",
      transferId: "tr_missing",
      amountCents: 10_000,
      currency: "usd",
      reversed: false,
    });
    expect(result).toMatchObject({
      applied: false,
      reason: "unknown_transfer",
    });
  });
});

describe("refund reconciliation", () => {
  test("a full refund reverses the commission and marks the order refunded", async () => {
    const t = createTest();
    const seller = await newUser(t, { seller: true });
    const buyer = await newUser(t);
    const product = await insertProduct(t, seller);
    const { orderId, itemId } = await insertCardOrder(t, {
      sellerId: seller,
      buyerId: buyer,
      productId: product,
      paymentStatus: "paid",
      itemPaymentStatus: "paid",
    });
    await t.run((ctx) =>
      ctx.db.insert("commissionLedger", {
        sellerId: seller,
        orderId,
        orderItemId: itemId,
        planId: "starter",
        baseCents: 10_000,
        commissionBps: 500,
        amountCents: 500,
        status: "confirmed",
        occurredAt: Date.now(),
      }),
    );

    const applied = await t.mutation(internal.stripeSync.refundSucceeded, {
      itemId,
      refundId: "re_test_1",
      amountCents: 10_000,
    });
    expect(applied).toMatchObject({ applied: true, partial: false });

    const item = await t.run((ctx) => ctx.db.get(itemId));
    expect(item?.paymentStatus).toBe("refunded");
    expect(item?.refundStatus).toBe("succeeded");
    const order = await t.run((ctx) => ctx.db.get(orderId));
    expect(order?.paymentStatus).toBe("refunded");
    const ledger = await t.run((ctx) =>
      ctx.db
        .query("commissionLedger")
        .withIndex("by_orderItem", (s) => s.eq("orderItemId", itemId))
        .first(),
    );
    expect(ledger?.status).toBe("reversed");

    const replay = await t.mutation(internal.stripeSync.refundSucceeded, {
      itemId,
      refundId: "re_test_1",
      amountCents: 10_000,
    });
    expect(replay).toMatchObject({ applied: false, reason: "duplicate" });
  });

  test("a partial refund is recorded without pretending the line is refunded", async () => {
    const t = createTest();
    const seller = await newUser(t, { seller: true });
    const buyer = await newUser(t);
    const product = await insertProduct(t, seller);
    const { orderId, itemId } = await insertCardOrder(t, {
      sellerId: seller,
      buyerId: buyer,
      productId: product,
      paymentStatus: "paid",
      itemPaymentStatus: "paid",
    });

    const applied = await t.mutation(internal.stripeSync.refundSucceeded, {
      itemId,
      refundId: "re_partial",
      amountCents: 2_500,
    });
    expect(applied).toMatchObject({ applied: true, partial: true });
    const item = await t.run((ctx) => ctx.db.get(itemId));
    expect(item?.paymentStatus).toBe("paid");
    expect(item?.refundedAmountCents).toBe(2_500);
    const order = await t.run((ctx) => ctx.db.get(orderId));
    expect(order?.paymentStatus).toBe("paid");
  });

  test("a failed refund leaves the payment paid", async () => {
    const t = createTest();
    const seller = await newUser(t, { seller: true });
    const buyer = await newUser(t);
    const product = await insertProduct(t, seller);
    const { itemId } = await insertCardOrder(t, {
      sellerId: seller,
      buyerId: buyer,
      productId: product,
      paymentStatus: "paid",
      itemPaymentStatus: "paid",
    });

    await t.mutation(internal.stripeSync.refundFailed, {
      itemId,
      refundId: "re_failed",
    });
    const item = await t.run((ctx) => ctx.db.get(itemId));
    expect(item?.paymentStatus).toBe("paid");
    expect(item?.refundStatus).toBe("failed");
  });
});
