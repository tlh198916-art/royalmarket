import type { Id } from "@/convex/_generated/dataModel";

/** Public seller info as returned by the enriched product queries. */
export type SellerInfo = {
  id: string;
  name: string;
  shopName?: string | null;
  bio?: string | null;
  location?: string | null;
  isSeller?: boolean;
  joinedAt?: number;
  image?: string | null;
  sellerType?: "individual" | "business";
  verifiedSeller?: boolean;
} | null;

/** Loose structural shape shared by catalog cards, detail views, cart rows. */
export type ProductCardData = {
  _id: Id<"products">;
  title: string;
  description?: string;
  priceCents: number;
  quantity: number;
  status: "draft" | "active" | "removed";
  categoryId: string;
  imageUrl?: string | null;
  imageUrls?: string[];
  available: boolean;
  seller?: SellerInfo;
  sellerName?: string;
  views?: number;
  soldCount?: number;
  condition?: string;
  returns?: { accepted: boolean; days: number };
  _creationTime?: number;
  /** Average product rating (null until the first review). */
  ratingAverage?: number | null;
  ratingCount?: number;
  /** Admin-curated featured placement. */
  featured?: boolean;
};
