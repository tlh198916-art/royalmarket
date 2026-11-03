import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

export const productStatusValidator = v.union(
  v.literal("draft"),
  v.literal("active"),
  v.literal("removed"),
);
export type ProductStatus = Infer<typeof productStatusValidator>;

export const conditionValidator = v.union(
  v.literal("new"),
  v.literal("like_new"),
  v.literal("good"),
  v.literal("fair"),
);
export type Condition = Infer<typeof conditionValidator>;

export const orderStatusValidator = v.union(
  v.literal("placed"),
  v.literal("shipped"),
  v.literal("delivered"),
  v.literal("cancelled"),
);
export type OrderStatus = Infer<typeof orderStatusValidator>;

export const fulfillmentMethodValidator = v.union(
  v.literal("meetup"), // local pickup / meet-up (legacy name kept for old orders)
  v.literal("shipping"), // seller-arranged shipping
  v.literal("delivery"), // seller-arranged local delivery
);
export type FulfillmentMethod = Infer<typeof fulfillmentMethodValidator>;

export const sellerTypeValidator = v.union(
  v.literal("individual"),
  v.literal("business"),
);
export type SellerType = Infer<typeof sellerTypeValidator>;

/** Per-product fulfillment options configured by the seller. */
export const productFulfillmentValidator = v.object({
  pickup: v.object({
    enabled: v.boolean(),
    area: v.optional(v.string()), // city / general pickup area (never a home address)
    instructions: v.optional(v.string()),
  }),
  shipping: v.object({
    enabled: v.boolean(),
    feeCents: v.number(), // 0 = free shipping
    handlingDays: v.number(),
    carrier: v.optional(v.string()),
    method: v.optional(v.string()),
  }),
  delivery: v.object({
    enabled: v.boolean(),
    feeCents: v.number(),
    area: v.optional(v.string()),
    estimatedDays: v.optional(v.number()),
    contactRequired: v.boolean(),
  }),
});
export type ProductFulfillment = Infer<typeof productFulfillmentValidator>;

export const subscriptionStatusValidator = v.union(
  v.literal("pending"), // agreed, awaiting payment confirmation
  v.literal("active"),
  v.literal("cancelled"),
  v.literal("expired"),
);
export type SubscriptionStatus = Infer<typeof subscriptionStatusValidator>;

export const planIdValidator = v.union(
  v.literal("starter"),
  v.literal("growth"),
  v.literal("pro"),
);
export type PlanId = Infer<typeof planIdValidator>;

/** What the platform charges commission on. Admin-configurable. */
export const commissionBaseValidator = v.union(
  v.literal("merchandise_subtotal"),
  v.literal("merchandise_plus_shipping"),
);
export type CommissionBase = Infer<typeof commissionBaseValidator>;

export const analyticsEventTypeValidator = v.union(
  v.literal("product_view"),
  v.literal("search"),
  v.literal("signup"),
  v.literal("listing_created"),
  v.literal("add_to_cart"),
  v.literal("checkout_complete"),
  v.literal("repeat_purchase"),
);
export type AnalyticsEventType = Infer<typeof analyticsEventTypeValidator>;

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // role of the user. do not remove

      // marketplace fields
      isSeller: v.optional(v.boolean()),
      shopName: v.optional(v.string()),
      sellerBio: v.optional(v.string()),
      location: v.optional(v.string()),
      marketingOptIn: v.optional(v.boolean()),

      // Two-tier seller system: individual (free) vs business (paid plan).
      sellerType: v.optional(sellerTypeValidator),
      // Business storefront branding (Business plans only).
      businessContact: v.optional(v.string()),
      businessLogoStorageId: v.optional(v.string()),
      businessBannerStorageId: v.optional(v.string()),
      storefrontSlug: v.optional(v.string()),
      // Seller-level fulfillment defaults, prefilled into new listings.
      defaultFulfillment: v.optional(productFulfillmentValidator),
      // Seller-to-seller referral program. Every seller gets a shareable code;
      // attribution is recorded once, when a referred account opens its shop.
      referralCode: v.optional(v.string()),
      referredBySellerId: v.optional(v.id("users")),
    })
      .index("email", ["email"])
      .index("by_role", ["role"])
      .index("by_storefront_slug", ["storefrontSlug"])
      .index("by_referral_code", ["referralCode"]),

    products: defineTable({
      sellerId: v.id("users"),
      title: v.string(),
      description: v.string(),
      categoryId: v.string(),
      priceCents: v.number(),
      quantity: v.number(),
      condition: conditionValidator,
      imageStorageIds: v.optional(v.array(v.string())),
      returns: v.object({
        accepted: v.boolean(),
        days: v.number(),
      }),
      status: productStatusValidator,
      views: v.number(),
      soldCount: v.number(),
      moderatorNote: v.optional(v.string()),
      // Admin-curated featured placement (homepage + "featured first" sort).
      featuredAt: v.optional(v.number()),
      // Denormalized review aggregates, maintained on review creation so the
      // catalog can rate-filter and sort without per-product review scans.
      ratingSum: v.optional(v.number()),
      ratingCount: v.optional(v.number()),
      // AI semantic-search embedding (768-dim Gemini); optional until indexed.
      embedding: v.optional(v.array(v.float64())),
      // Seller-configured fulfillment: pickup, seller shipping, local delivery.
      // Optional: listings created before this feature behave as before
      // (pickup or shipping negotiated directly, no preset fees).
      fulfillment: v.optional(productFulfillmentValidator),
    })
      .index("by_status", ["status"])
      .index("by_seller", ["sellerId"])
      .index("by_category", ["categoryId"])
      .vectorIndex("embedding", {
        vectorField: "embedding",
        dimensions: 768,
        filterFields: ["status"],
      })
      .searchIndex("search_title", {
        searchField: "title",
        filterFields: ["status"],
      })
      .searchIndex("search_description", {
        searchField: "description",
        filterFields: ["status"],
      }),

    reviews: defineTable({
      productId: v.id("products"),
      reviewerId: v.id("users"),
      rating: v.number(),
      comment: v.string(),
      verifiedPurchase: v.boolean(),
    })
      .index("by_product", ["productId"])
      .index("by_reviewer", ["reviewerId"]),

    favorites: defineTable({
      userId: v.id("users"),
      productId: v.id("products"),
    })
      .index("by_user", ["userId"])
      .index("by_user_product", ["userId", "productId"]),

    /**
     * Seller-to-seller referrals: one row per referred account. Purely
     * attribution/recognition — no payouts are computed from this table.
     */
    referrals: defineTable({
      inviterId: v.id("users"),
      inviteeId: v.id("users"),
      code: v.string(),
    })
      .index("by_inviter", ["inviterId"])
      .index("by_invitee", ["inviteeId"]),

    /**
     * Anonymous referral-link visits. One row per browser session and code,
     * so sellers can see link activity without collecting visitor PII.
     */
    referralVisits: defineTable({
      inviterId: v.id("users"),
      code: v.string(),
      visitorKey: v.string(),
      source: v.optional(v.string()),
    })
      .index("by_inviter", ["inviterId"])
      .index("by_code_visitor", ["code", "visitorKey"]),

    /** Buyer reports on listings, reviewed by moderators. */
    reports: defineTable({
      productId: v.id("products"),
      reporterId: v.id("users"),
      reason: v.union(
        v.literal("prohibited"),
        v.literal("misleading"),
        v.literal("counterfeit"),
        v.literal("spam"),
        v.literal("other"),
      ),
      details: v.optional(v.string()),
      status: v.union(
        v.literal("open"),
        v.literal("resolved"),
        v.literal("dismissed"),
      ),
      createdAt: v.number(),
      resolvedAt: v.optional(v.number()),
      resolvedBy: v.optional(v.id("users")),
      resolutionNote: v.optional(v.string()),
    })
      .index("by_product", ["productId"])
      .index("by_status", ["status"])
      .index("by_reporter", ["reporterId"]),

    /** Buyer ↔ seller messages scoped to one order. */
    orderMessages: defineTable({
      orderId: v.id("orders"),
      senderId: v.id("users"),
      body: v.string(),
    }).index("by_order", ["orderId"]),

    orders: defineTable({
      buyerId: v.id("users"),
      items: v.array(
        v.object({
          productId: v.id("products"),
          sellerId: v.id("users"),
          title: v.string(),
          priceCents: v.number(),
          quantity: v.number(),
        }),
      ),
      subtotalCents: v.number(),
      totalCents: v.number(),
      status: orderStatusValidator,
      paymentMethod: v.union(v.literal("cod"), v.literal("card")),
      // Per-seller fulfillment deal: meet up or shipping arranged directly.
      // Both parties must approve before handoff; editing resets the other
      // party's approval.
      fulfillments: v.optional(
        v.array(
          v.object({
            sellerId: v.id("users"),
            method: fulfillmentMethodValidator,
            note: v.optional(v.string()),
            buyerAgreed: v.boolean(),
            sellerAgreed: v.boolean(),
            // Seller-set charge for this arrangement, snapshotted at checkout
            // (0 for pickup / free options). Recomputed if the method changes.
            feeCents: v.optional(v.number()),
            trackingNumber: v.optional(v.string()),
          }),
        ),
      ),
      // Sum of per-seller fulfillment fees. Kept separate from subtotal so
      // seller-set charges are never double-counted or confused with
      // platform fees (there are none on fulfillment).
      shippingFeeCents: v.optional(v.number()),
      placedAt: v.optional(v.number()),
      deliveredAt: v.optional(v.number()),
      // Card payment state. `paid` is only ever written from a verified Stripe
      // webhook whose amount matches `totalCents`; COD orders leave this
      // undefined and are tracked per item instead.
      paymentStatus: v.optional(
        v.union(
          v.literal("unpaid"),
          v.literal("processing"),
          v.literal("paid"),
          v.literal("partially_refunded"),
          v.literal("refunded"),
          v.literal("failed"),
        ),
      ),
      stripePaymentIntentId: v.optional(v.string()),
      stripeChargeId: v.optional(v.string()),
      cardBrand: v.optional(v.string()),
      cardLast4: v.optional(v.string()),
      paidAt: v.optional(v.number()),
      paymentFailureMessage: v.optional(v.string()),
      paymentAttempts: v.optional(v.number()),
      // Snapshot taken when the PaymentIntent is attached. Order terms must not
      // change after this point, because Stripe has been authorized for this
      // exact amount. Kept optional for legacy orders.
      paymentLockedAt: v.optional(v.number()),
      paymentLockedTotalCents: v.optional(v.number()),
      // Total provider-confirmed refunds for the whole order, including any
      // seller fulfillment fees. Never allowed to exceed totalCents.
      refundedAmountCents: v.optional(v.number()),
    }).index("by_buyer", ["buyerId"]),

    orderItems: defineTable({
      orderId: v.id("orders"),
      buyerId: v.id("users"),
      sellerId: v.id("users"),
      productId: v.id("products"),
      title: v.string(),
      priceCents: v.number(),
      quantity: v.number(),
      status: orderStatusValidator,
      // Per-item money state. Cash-on-delivery is collected by the seller at
      // handoff and recorded here; card payments may only be marked paid by a
      // verified provider webhook once one is configured. Missing on legacy
      // rows and read as "unpaid".
      paymentStatus: v.optional(
        v.union(
          v.literal("unpaid"),
          v.literal("paid"),
          v.literal("refunded"),
          v.literal("failed"),
        ),
      ),
      paidAt: v.optional(v.number()),
      paymentReference: v.optional(v.string()),
      paymentRecordedBy: v.optional(v.id("users")),
      refundedAt: v.optional(v.number()),
      refundNote: v.optional(v.string()),
      // Provider-backed refund state. `refundStatus` stays "pending" until
      // Stripe reports success; paymentStatus only flips to refunded then.
      refundId: v.optional(v.string()),
      refundStatus: v.optional(
        v.union(
          v.literal("pending"),
          v.literal("succeeded"),
          v.literal("failed"),
        ),
      ),
      refundedAmountCents: v.optional(v.number()),
      // Portion of refundedAmountCents that was a seller fulfillment fee. Fees
      // are only refunded once every line for that seller on the order is
      // refunded, so they are tracked separately from merchandise.
      refundedFeeCents: v.optional(v.number()),
      // A refund accepted by Stripe but not settled yet. Reserving it prevents
      // concurrent admin actions from refunding the same money twice.
      pendingRefundAmountCents: v.optional(v.number()),
      // Set once Stripe confirms a transfer of this line's seller proceeds.
      stripeTransferId: v.optional(v.string()),
    })
      .index("by_seller", ["sellerId"])
      .index("by_buyer", ["buyerId"])
      .index("by_order", ["orderId"])
      .index("by_product", ["productId"])
      .index("by_status", ["status"]),

    /**
     * Platform subscription plans + commission settings (singleton doc with
     * _id "platform"). Admin-editable; all USD. Never trust client-sent
     * prices — subscription and commission code reads plans from here.
     */
    platformSettings: defineTable({
      plans: v.array(
        v.object({
          id: planIdValidator,
          name: v.string(),
          priceCentsMonthly: v.number(),
          commissionBps: v.number(), // basis points, e.g. 500 = 5%
          active: v.boolean(),
          features: v.array(v.string()),
        }),
      ),
      commissionBase: commissionBaseValidator,
      updatedAt: v.number(),
      updatedBy: v.id("users"),
    }),

    /**
     * Business seller subscriptions. Prices and commission rates are
     * snapshotted from platformSettings at agreement time so later admin
     * price changes never rewrite terms a seller already accepted.
     */
    subscriptions: defineTable({
      userId: v.id("users"),
      planId: planIdValidator,
      planName: v.string(),
      priceCentsMonthly: v.number(),
      commissionBps: v.number(),
      status: subscriptionStatusValidator,
      agreedAt: v.number(),
      startedAt: v.optional(v.number()),
      renewsAt: v.optional(v.number()),
      cancelledAt: v.optional(v.number()),
      activatedBy: v.optional(v.id("users")), // admin who confirmed payment
      paymentNote: v.optional(v.string()),
    })
      .index("by_user", ["userId"])
      .index("by_status", ["status"]),

    /**
     * Commission ledger: one row per delivered order item for business
     * sellers. The by_orderItem index makes accrual idempotent — retried
     * webhooks or repeated status updates can never double-charge.
     */
    commissionLedger: defineTable({
      sellerId: v.id("users"),
      orderId: v.id("orders"),
      orderItemId: v.id("orderItems"),
      planId: v.string(),
      baseCents: v.number(), // eligible transaction amount
      commissionBps: v.number(),
      amountCents: v.number(),
      status: v.union(
        v.literal("pending"), // accrued at delivery, awaiting settlement
        v.literal("confirmed"), // admin marked paid
        v.literal("reversed"), // refund / cancellation reversal
      ),
      occurredAt: v.number(),
      note: v.optional(v.string()),
    })
      .index("by_seller", ["sellerId"])
      .index("by_order", ["orderId"])
      .index("by_orderItem", ["orderItemId"])
      .index("by_status", ["status"]),

    /**
     * Stripe Connect state per seller. Rows exist only after a real Stripe
     * account is created and synced; a missing row means "not connected" and
     * never implies payouts are possible.
     */
    sellerPaymentAccounts: defineTable({
      sellerId: v.id("users"),
      provider: v.literal("stripe"),
      accountId: v.optional(v.string()),
      onboardingStatus: v.union(
        v.literal("not_connected"),
        v.literal("pending"),
        v.literal("restricted"),
        v.literal("enabled"),
      ),
      chargesEnabled: v.boolean(),
      payoutsEnabled: v.boolean(),
      detailsSubmitted: v.boolean(),
      requirementsCurrentlyDue: v.optional(v.array(v.string())),
      disabledReason: v.optional(v.string()),
      lastSyncedAt: v.optional(v.number()),
      updatedAt: v.number(),
    })
      .index("by_seller", ["sellerId"])
      .index("by_account", ["accountId"]),

    /**
     * Seller payouts for platform-processed (card) orders. A row is written
     * by the payment provider integration, never by the app asserting money
     * moved: `status: "paid"` is only set from a provider-confirmed event,
     * and the UI refuses to show a payout as completed without it.
     */
    payouts: defineTable({
      sellerId: v.id("users"),
      orderId: v.optional(v.id("orders")),
      amountCents: v.number(),
      currency: v.literal("usd"),
      provider: v.union(v.literal("stripe"), v.literal("manual")),
      status: v.union(
        v.literal("pending"),
        v.literal("in_transit"),
        v.literal("paid"),
        // A Stripe transfer was reversed (refund/reconciliation).
        v.literal("reversed"),
        v.literal("failed"),
      ),
      providerTransferId: v.optional(v.string()),
      // Cumulative amount Stripe reports as reversed. A partial reversal keeps
      // the payout paid for the remainder; a full reversal marks it reversed.
      reversedAmountCents: v.optional(v.number()),
      note: v.optional(v.string()),
      createdAt: v.number(),
      confirmedAt: v.optional(v.number()),
    })
      .index("by_seller", ["sellerId"])
      .index("by_status", ["status"])
      .index("by_transfer", ["providerTransferId"]),

    /**
     * Verified Stripe webhook events, keyed by the provider event id. The
     * event row is written in the same transaction as the state change, so a
     * retried delivery can never apply the same event twice.
     */
    stripeWebhookEvents: defineTable({
      eventId: v.string(),
      type: v.string(),
      source: v.union(v.literal("platform"), v.literal("connect")),
      accountId: v.optional(v.string()),
      receivedAt: v.number(),
    })
      .index("by_eventId", ["eventId"])
      .index("by_type", ["type"]),

    tickets: defineTable({
      name: v.string(),
      email: v.string(),
      subject: v.string(),
      message: v.string(),
      userId: v.optional(v.id("users")),
      status: v.union(v.literal("open"), v.literal("closed")),
      responseNote: v.optional(v.string()),
    }),

    events: defineTable({
      type: analyticsEventTypeValidator,
      userId: v.optional(v.id("users")),
      productId: v.optional(v.id("products")),
      query: v.optional(v.string()),
    }).index("by_type", ["type"]),

    /**
     * Seller-attract marketing events (e.g. the Founding Sellers Launch
     * Event). Named marketEvents because `events` is the analytics table.
     */
    marketEvents: defineTable({
      slug: v.string(),
      title: v.string(),
      tagline: v.string(),
      details: v.array(v.string()), // agenda / description bullets
      startsAt: v.number(), // epoch ms (UTC)
      durationMinutes: v.number(),
      format: v.union(v.literal("online")), // all events are online for now
      joinInstructions: v.string(), // how registered attendees join
      joinUrl: v.optional(v.string()), // shown only to registered attendees
      status: v.union(
        v.literal("draft"),
        v.literal("published"),
        v.literal("cancelled"),
      ),
      createdBy: v.optional(v.id("users")),
      createdAt: v.number(),
    })
      .index("by_slug", ["slug"])
      .index("by_status", ["status"]),

    /** One row per (event, user); unique via by_event_user. */
    eventRegistrations: defineTable({
      eventId: v.id("marketEvents"),
      userId: v.id("users"),
      email: v.string(),
      name: v.optional(v.string()),
      status: v.union(v.literal("registered"), v.literal("cancelled")),
      createdAt: v.number(),
      // Seller status captured at registration time. Conversion (registrant
      // who later becomes a seller) is derived by comparing this with the
      // user's current isSeller, so attendees who already sold aren't counted
      // as conversions. Undefined on rows created before this was tracked.
      wasSellerAtRegistration: v.optional(v.boolean()),
    })
      .index("by_event", ["eventId"])
      .index("by_event_user", ["eventId", "userId"])
      .index("by_user", ["userId"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
