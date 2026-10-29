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
    })
      .index("email", ["email"])
      .index("by_role", ["role"])
      .index("by_storefront_slug", ["storefrontSlug"]),

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
    })
      .index("by_seller", ["sellerId"])
      .index("by_buyer", ["buyerId"])
      .index("by_order", ["orderId"])
      .index("by_product", ["productId"]),

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
      .index("by_orderItem", ["orderItemId"])
      .index("by_status", ["status"]),

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
