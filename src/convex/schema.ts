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

export const shippingAddressValidator = v.object({
  fullName: v.string(),
  line1: v.string(),
  line2: v.optional(v.string()),
  city: v.string(),
  region: v.string(),
  postalCode: v.string(),
  country: v.string(),
  phone: v.string(),
});

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
    })
      .index("email", ["email"])
      .index("by_role", ["role"]),

    products: defineTable({
      sellerId: v.id("users"),
      title: v.string(),
      description: v.string(),
      categoryId: v.string(),
      priceCents: v.number(),
      quantity: v.number(),
      condition: conditionValidator,
      imageStorageIds: v.optional(v.array(v.string())),
      shipping: v.object({
        flatFeeCents: v.number(),
        shipsFrom: v.optional(v.string()),
        estimatedDays: v.number(),
      }),
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
      shippingCents: v.number(),
      totalCents: v.number(),
      status: orderStatusValidator,
      paymentMethod: v.union(v.literal("cod"), v.literal("card")),
      shippingAddress: shippingAddressValidator,
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
  },
  {
    schemaValidation: false,
  },
);

export default schema;
