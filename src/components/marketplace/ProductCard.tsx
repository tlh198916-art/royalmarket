import { FavoriteButton } from "@/components/marketplace/FavoriteButton";
import { ProductMedia } from "@/components/marketplace/ProductMedia";
import { Badge } from "@/components/ui/badge";
import { CATEGORIES } from "@/convex/categories";
import { formatPrice } from "@/lib/format";
import type { ProductCardData } from "@/lib/types";
import { motion } from "framer-motion";
import { Link } from "react-router";

// Snapshot of load time so the "Just listed" badge doesn't call impure
// Date.now() on every render.
const LOADED_AT = Date.now();
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Catalog card: photo (or themed placeholder), availability badge, price,
 * fulfillment hint, and seller link. Availability is always visible so buyers
 * never mistake a sold item for an active one.
 */
export function ProductCard({
  product,
  index = 0,
}: {
  product: ProductCardData;
  index?: number;
}) {
  const category = CATEGORIES.find((c) => c.id === product.categoryId);
  const sellerName =
    product.seller?.shopName ?? product.seller?.name ?? product.sellerName;
  const isNew =
    product._creationTime &&
    LOADED_AT - product._creationTime < THREE_DAYS_MS;

  return (
    <motion.article
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.35, delay: Math.min(index * 0.05, 0.3) }}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-border/70 bg-card transition-colors duration-200 hover:border-primary/50"
    >
      <Link
        to={`/products/${product._id}`}
        className="relative block aspect-[4/3] overflow-hidden bg-secondary/40"
        aria-label={product.title}
      >
        <ProductMedia
          imageUrl={product.imageUrl}
          categoryId={product.categoryId}
          title={product.title}
          className="transition-transform duration-300 group-hover:scale-105"
        />
        {!product.available && (
          <span className="absolute left-3 top-3 rounded-lg bg-background/90 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-muted-foreground backdrop-blur">
            {product.status === "removed" ? "Unavailable" : "Sold out"}
          </span>
        )}
        {product.available && isNew && (
          <span className="absolute left-3 top-3 rounded-lg bg-primary px-2.5 py-1 text-xs font-bold text-primary-foreground">
            Just listed
          </span>
        )}
      </Link>

      <FavoriteButton
        productId={product._id}
        className="absolute right-3 top-3"
      />

      <div className="flex flex-1 flex-col gap-1.5 p-4">
        {category && (
          <p className="text-xs font-medium text-muted-foreground">
            {category.emoji} {category.label}
          </p>
        )}
        <Link
          to={`/products/${product._id}`}
          className="line-clamp-2 text-sm font-semibold leading-5 tracking-tight transition-colors hover:text-primary"
        >
          {product.title}
        </Link>

        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <div>
            <p className="text-lg font-bold tracking-tight">
              {formatPrice(product.priceCents)}
            </p>
            <p className="text-xs text-muted-foreground">
              Meet up or ship directly
            </p>
          </div>
          {product.seller?.id && sellerName && (
            <Link
              to={`/sellers/${product.seller.id}`}
              className="max-w-[45%] truncate text-xs text-muted-foreground transition-colors hover:text-primary"
            >
              {sellerName}
            </Link>
          )}
        </div>

        {!product.available && (
          <Badge
            variant="secondary"
            className="mt-2 w-fit justify-center text-[11px]"
          >
            {product.status === "removed" ? "Not available" : "Sold out"}
          </Badge>
        )}
      </div>
    </motion.article>
  );
}
