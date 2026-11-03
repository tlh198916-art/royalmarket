import { EmptyState } from "@/components/marketplace/EmptyState";
import { FavoriteButton } from "@/components/marketplace/FavoriteButton";
import { Layout } from "@/components/marketplace/Layout";
import { ProductMedia } from "@/components/marketplace/ProductMedia";
import { StarRating } from "@/components/marketplace/StarRating";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import { CATEGORIES } from "@/convex/categories";
import { REPORT_REASONS } from "@/convex/reportReasons";
import { useAuth } from "@/hooks/use-auth";
import { useCart } from "@/lib/cart";
import { formatDate, formatPrice, initials, pluralize } from "@/lib/format";
import { recordRecentView } from "@/lib/recentlyViewed";
import { productJsonLd, usePageMeta } from "@/lib/seo";
import { useMutation, useQuery } from "convex/react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Flag,
  Handshake,
  MapPin,
  Package,
  RotateCcw,
  ShieldCheck,
  ShoppingCart,
  Star,
  Store,
  Truck,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";

export default function ProductDetail() {
  const { id = "" } = useParams();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const product = useQuery(api.products.get, { id });
  const reviews = useQuery(api.reviews.listForProduct, { productId: id });
  const viewer = useQuery(api.reviews.viewerState, { productId: id });
  const moreFromSeller = useQuery(api.products.list, {
    sellerId: product?.sellerId ?? "",
    limit: 5,
  });
  const sameCategory = useQuery(api.products.list, {
    categoryId: product?.categoryId ?? "",
    limit: 5,
  });

  const trackView = useMutation(api.products.trackView);
  const createReview = useMutation(api.reviews.create);
  const reportListing = useMutation(api.reports.create);
  const { add } = useCart();
  const navigate = useNavigate();

  const [quantity, setQuantity] = useState(1);
  const [imageIndex, setImageIndex] = useState(0);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState<string>("prohibited");
  const [reportDetails, setReportDetails] = useState("");
  const [reporting, setReporting] = useState(false);
  const viewTracked = useRef(false);

  const listingJsonLd = useMemo(
    () =>
      product
        ? productJsonLd({
            title: product.title,
            description: product.description,
            imageUrl: product.imageUrls[0] ?? null,
            priceCents: product.priceCents,
            condition: product.condition,
            available: product.available,
            ratingAverage: product.ratingAverage,
            ratingCount: product.ratingCount,
            sellerShopName: product.seller?.shopName ?? null,
          })
        : null,
    [product],
  );

  usePageMeta({
    title: product ? product.title : "Listing",
    description: product
      ? `${product.description.slice(0, 150)} — ${formatPrice(product.priceCents)} on Royalmarket.`
      : undefined,
    canonicalPath: product ? `/products/${product._id}` : undefined,
    jsonLd: listingJsonLd,
  });

  // Record the product view + recently-viewed entry once per mount.
  useEffect(() => {
    if (viewTracked.current || !product) return;
    if (product.status !== "active") return;
    viewTracked.current = true;
    recordRecentView({
      id: product._id,
      title: product.title,
      priceCents: product.priceCents,
    });
    void trackView({ id: product._id }).catch(() => {});
  }, [product, trackView]);

  if (product === undefined) {
    return (
      <Layout>
        <div className="flex justify-center py-24">
          <div className="size-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      </Layout>
    );
  }

  if (product === null) {
    return (
      <Layout>
        <div className="page-container py-16">
          <EmptyState
            icon={Package}
            title="Listing not found"
            description="This listing doesn't exist or was removed by its seller."
            action={
              <Button asChild>
                <Link to="/products">Browse products</Link>
              </Button>
            }
          />
        </div>
      </Layout>
    );
  }

  const category = CATEGORIES.find((c) => c.id === product.categoryId);
  const hiddenFromViewer =
    (product.status === "draft" || product.status === "removed") &&
    !product.isOwner;

  if (hiddenFromViewer) {
    return (
      <Layout>
        <div className="page-container py-16">
          <EmptyState
            icon={Package}
            title={
              product.status === "removed"
                ? "This listing is no longer available"
                : "Listing not found"
            }
            description={
              product.status === "removed"
                ? "A moderator or the seller took this item down. Browse similar items in the catalog instead."
                : "This listing doesn't exist or was removed."
            }
            action={
              <Button asChild>
                <Link to="/products">Browse products</Link>
              </Button>
            }
          />
        </div>
      </Layout>
    );
  }

  const imageUrls = product.imageUrls ?? [];
  // Clamp derived indexes so switching listings never needs a reset effect.
  const activeIndex = Math.min(
    imageIndex,
    Math.max(imageUrls.length - 1, 0),
  );
  const activeImage = imageUrls[activeIndex] ?? null;
  const purchasable = product.available;
  const ff = product.fulfillment;
  // Legacy listings (no configured options) keep the original wording.
  const fulfillmentOptions: {
    icon: typeof Truck;
    label: string;
    detail: string;
  }[] = ff
    ? [
        ...(ff.pickup.enabled
          ? [
              {
                icon: Handshake,
                label: "Local pickup",
                detail: ff.pickup.area
                  ? `Pickup in ${ff.pickup.area} — details shared after ordering`
                  : "Arrange pickup with the seller",
              },
            ]
          : []),
        ...(ff.shipping.enabled
          ? [
              {
                icon: Truck,
                label: "Shipping",
                detail: `Ships in ~${ff.shipping.handlingDays} day${ff.shipping.handlingDays === 1 ? "" : "s"}${
                  ff.shipping.carrier ? ` via ${ff.shipping.carrier}` : ""
                } · ${
                  ff.shipping.feeCents === 0
                    ? "Free shipping"
                    : `${formatPrice(ff.shipping.feeCents)} (set by seller)`
                }`,
              },
            ]
          : []),
        ...(ff.delivery.enabled
          ? [
              {
                icon: MapPin,
                label: "Local delivery",
                detail: `${ff.delivery.area ?? "Local area"} · ${
                  ff.delivery.feeCents === 0
                    ? "Free delivery"
                    : `${formatPrice(ff.delivery.feeCents)} (set by seller)`
                }${
                  ff.delivery.estimatedDays !== undefined
                    ? ` · ~${ff.delivery.estimatedDays}d`
                    : ""
                }`,
              },
            ]
          : []),
      ]
    : [
        {
          icon: Truck,
          label: "Meet up or shipping",
          detail:
            "Arrange the details and any cost directly with the seller",
        },
      ];
  const fulfillmentHint = fulfillmentOptions
    .map((o) => o.label)
    .join(" · ");
  const maxQty = Math.max(1, Math.min(product.quantity, 20));
  const qty = Math.min(quantity, maxQty);
  const sellerName =
    product.seller?.shopName ?? product.seller?.name ?? "Seller";

  const relatedPool = (moreFromSeller ?? []).filter((p) => p._id !== product._id);
  const relatedFallback = (sameCategory ?? []).filter(
    (p) => p._id !== product._id,
  );
  const related = (relatedPool.length > 0 ? relatedPool : relatedFallback).slice(0, 4);

  const handleAddToCart = (buyNow = false) => {
    if (!purchasable) {
      toast.error("This item is not available.");
      return;
    }
    add(
      {
        productId: product._id,
        title: product.title,
        priceCents: product.priceCents,
        maxQuantity: product.quantity,
        imageUrl: imageUrls[0] ?? null,
        sellerName,
      },
      qty,
    );
    if (buyNow) {
      navigate("/checkout");
      return;
    }
    toast.success(`Added ${pluralize(qty, "item")} to your cart`, {
      action: {
        label: "View cart",
        onClick: () => navigate("/checkout"),
      },
    });
  };

  const handleReportSubmit = async () => {
    setReporting(true);
    try {
      await reportListing({
        productId: product._id,
        reason: reportReason as
          | "prohibited"
          | "misleading"
          | "counterfeit"
          | "spam"
          | "other",
        details: reportDetails.trim() || undefined,
      });
      setReportOpen(false);
      setReportDetails("");
      setReportReason("prohibited");
      toast.success("Report sent — a moderator will review this listing.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not send the report.",
      );
    } finally {
      setReporting(false);
    }
  };

  const handleReviewSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      await createReview({ productId: product._id, rating, comment });
      setComment("");
      toast.success("Review posted — thanks for sharing.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not post review.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Layout>
      <div className="page-container py-6 sm:py-10">
        {/* Breadcrumb */}
        <nav className="mb-5 flex items-center gap-2 text-xs text-muted-foreground">
          <Link to="/" className="transition-colors hover:text-foreground">
            Home
          </Link>
          <span>/</span>
          <Link
            to={`/products?category=${product.categoryId}`}
            className="transition-colors hover:text-foreground"
          >
            {category?.label ?? "Products"}
          </Link>
          <span>/</span>
          <span className="truncate text-foreground">{product.title}</span>
        </nav>

        {product.status === "draft" && product.isOwner && (
          <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm">
            <ShieldCheck className="size-4 text-amber-300" />
            <p className="flex-1">
              This is a draft — only you can see it. Publish it from your
              seller dashboard to make it buyable.
            </p>
            <Button asChild size="sm" variant="outline">
              <Link to="/sell/dashboard">Go to dashboard</Link>
            </Button>
          </div>
        )}

        <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
          {/* Media */}
          <motion.div
            initial={{ opacity: 0, x: -18 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4 }}
          >
            <div className="relative aspect-square overflow-hidden rounded-3xl border border-border/70 bg-card">
              <ProductMedia
                imageUrl={activeImage}
                categoryId={product.categoryId}
                title={product.title}
                fit="contain"
              />
              {!purchasable && (
                <span className="absolute left-4 top-4 rounded-lg bg-background/90 px-3 py-1.5 text-xs font-bold uppercase tracking-wide backdrop-blur">
                  {product.status === "removed" ? "Unavailable" : "Sold out"}
                </span>
              )}
              <FavoriteButton
                productId={product._id}
                className="absolute right-4 top-4"
              />
            </div>

            {imageUrls.length > 1 && (
              <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                {imageUrls.map((url, index) => (
                  <button
                    key={url}
                    type="button"
                    onClick={() => setImageIndex(index)}
                    className={`size-16 shrink-0 overflow-hidden rounded-lg border transition-colors ${
                      index === activeIndex
                        ? "border-primary"
                        : "border-border/70 opacity-70 hover:opacity-100"
                    }`}
                    aria-label={`View photo ${index + 1}`}
                  >
                    <img src={url} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </motion.div>

          {/* Buy box */}
          <motion.div
            initial={{ opacity: 0, x: 18 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4 }}
            className="flex flex-col"
          >
            <div className="flex flex-wrap items-center gap-2">
              {category && (
                <Link to={`/products?category=${category.id}`}>
                  <Badge
                    variant="secondary"
                    className="cursor-pointer hover:border-primary/50"
                  >
                    {category.emoji} {category.label}
                  </Badge>
                </Link>
              )}
              {product.condition && (
                <Badge variant="outline" className="capitalize">
                  {product.condition.replace("_", " ")}
                </Badge>
              )}
            </div>

            <h1 className="mt-3 text-2xl font-bold leading-tight tracking-tight sm:text-3xl">
              {product.title}
            </h1>

            <div className="mt-4 flex flex-wrap items-end gap-3">
              <span className="text-3xl font-extrabold tracking-tight">
                {formatPrice(product.priceCents)}
              </span>
              <span className="pb-1 text-sm text-muted-foreground">
                {fulfillmentHint}
              </span>
            </div>

            <p className="mt-3 text-sm">
              {purchasable ? (
                <span className="inline-flex items-center gap-1.5 font-medium text-emerald-400">
                  <CheckCircle2 className="size-4" />
                  In stock — {product.quantity} available
                </span>
              ) : product.status === "removed" ? (
                <span className="font-medium text-muted-foreground">
                  No longer available
                </span>
              ) : (
                <span className="font-medium text-amber-400">
                  Sold out — {product.soldCount ?? 0} sold
                </span>
              )}
            </p>

            {product.views > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                {product.views} view{product.views === 1 ? "" : "s"} · listed{" "}
                {product._creationTime ? formatDate(product._creationTime) : ""}
              </p>
            )}

            {/* Seller row */}
            {product.seller && (
              <Link
                to={`/sellers/${product.seller.id}`}
                className="mt-5 flex items-center gap-3 rounded-2xl border border-border/70 bg-card p-4 transition-colors hover:border-primary/50"
              >
                <span className="flex size-11 items-center justify-center rounded-full bg-secondary text-sm font-bold">
                  {initials(sellerName)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-sm font-semibold">
                      {sellerName}
                    </span>
                    {product.seller.verifiedSeller && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                        <ShieldCheck className="size-3" /> Verified seller
                      </span>
                    )}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {product.seller.location ?? "Verified seller"}
                    {product.seller.joinedAt
                      ? ` · joined ${formatDate(product.seller.joinedAt)}`
                      : ""}
                  </span>
                </span>
                <Store className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            )}

            {/* Quantity + actions */}
            <div className="mt-5 space-y-3">
              {purchasable && (
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-muted-foreground">
                    Quantity
                  </span>
                  <div className="flex items-center rounded-lg border border-border/80">
                    <button
                      type="button"
                      className="px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                      onClick={() => setQuantity(Math.max(1, qty - 1))}
                      disabled={qty <= 1}
                      aria-label="Decrease quantity"
                    >
                      −
                    </button>
                    <span className="w-8 text-center text-sm font-semibold">
                      {qty}
                    </span>
                    <button
                      type="button"
                      className="px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                      onClick={() => setQuantity(Math.min(maxQty, qty + 1))}
                      disabled={qty >= maxQty}
                      aria-label="Increase quantity"
                    >
                      +
                    </button>
                  </div>
                  {maxQty < 20 && (
                    <span className="text-xs text-muted-foreground">
                      Max {maxQty}
                    </span>
                  )}
                </div>
              )}

              <div className="flex flex-col gap-3 sm:flex-row">
                <Button
                  size="lg"
                  className="flex-1"
                  disabled={!purchasable}
                  onClick={() => handleAddToCart(false)}
                >
                  <ShoppingCart className="mr-2 size-4" />
                  {purchasable ? "Add to cart" : "Unavailable"}
                </Button>
                <Button
                  size="lg"
                  variant="secondary"
                  className="flex-1 border border-border/80"
                  disabled={!purchasable}
                  onClick={() => handleAddToCart(true)}
                >
                  Buy now
                </Button>
              </div>
              {!purchasable && (
                <p className="text-xs text-muted-foreground">
                  This item can&apos;t be purchased right now. Check back later
                  or browse similar listings below.
                </p>
              )}
            </div>

            {/* Policy chips */}
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-border/70 bg-card p-3.5">
                <div className="flex items-start gap-2.5">
                  <Truck className="mt-0.5 size-4 shrink-0 text-primary" />
                  <div className="text-xs leading-5">
                    <p className="font-semibold">
                      {ff ? "Fulfillment options" : "Meet up or shipping"}
                    </p>
                    <ul className="mt-1 space-y-1.5 text-muted-foreground">
                      {fulfillmentOptions.map((option) => (
                        <li key={option.label} className="flex items-start gap-1.5">
                          <option.icon className="mt-0.5 size-3.5 shrink-0" />
                          <span>
                            <span className="font-medium text-foreground">
                              {option.label}
                            </span>{" "}
                            — {option.detail}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1.5 text-muted-foreground">
                      Arranged between you and the seller — both approve
                      before handoff.
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-2.5 rounded-xl border border-border/70 bg-card p-3.5">
                <RotateCcw className="mt-0.5 size-4 shrink-0 text-primary" />
                <div className="text-xs leading-5">
                  <p className="font-semibold">Returns</p>
                  <p className="text-muted-foreground">
                    {product.returns?.accepted
                      ? `Accepted within ${product.returns.days} days of delivery`
                      : "No returns on this item"}
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Description */}
        <section className="mt-12">
          <h2 className="text-lg font-bold tracking-tight">About this item</h2>
          <p className="mt-3 max-w-3xl whitespace-pre-line text-sm leading-7 text-muted-foreground">
            {product.description}
          </p>
        </section>

        {/* Reviews */}
        <section
          id="reviews"
          className="mt-12 scroll-mt-24 border-t border-border/70 pt-10"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold tracking-tight">
              Reviews{" "}
              {reviews && reviews.count > 0 && (
                <span className="text-muted-foreground">
                  ({reviews.count})
                </span>
              )}
            </h2>
            {reviews && reviews.average !== null && (
              <StarRating value={reviews.average} size="md" />
            )}
          </div>

          <div className="mt-5 grid gap-8 lg:grid-cols-[1fr_340px]">
            <div className="space-y-4">
              {reviews === undefined ? (
                <div className="flex justify-center py-8">
                  <div className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                </div>
              ) : reviews.reviews.length === 0 ? (
                <EmptyState
                  icon={Star}
                  title="No reviews yet"
                  description="Reviews only come from real orders — nothing here is padded out. Buyers can review after a purchase, and verified purchases are badged."
                  compact
                />
              ) : (
                reviews.reviews.map((review) => (
                  <div
                    key={review._id}
                    className="rounded-2xl border border-border/70 bg-card p-5"
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex size-9 items-center justify-center rounded-full bg-secondary text-xs font-bold">
                        {initials(review.reviewerName)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                          {review.reviewerName}
                          {review.verifiedPurchase && (
                            <Badge
                              variant="secondary"
                              className="gap-1 text-[10px] font-semibold text-emerald-400"
                            >
                              <ShieldCheck className="size-3" /> Verified
                              purchase
                            </Badge>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(review.createdAt)}
                        </p>
                      </div>
                      <StarRating value={review.rating} />
                    </div>
                    <p className="mt-3 text-sm leading-6 text-muted-foreground">
                      {review.comment}
                    </p>
                  </div>
                ))
              )}
            </div>

            {/* Review form */}
            <div className="h-fit rounded-2xl border border-border/70 bg-card p-5">
              <h3 className="text-sm font-semibold tracking-tight">
                Write a review
              </h3>
              {authLoading ? (
                <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
              ) : !isAuthenticated ? (
                <div className="mt-3">
                  <p className="text-sm leading-6 text-muted-foreground">
                    Sign in with your verified account to share your experience.
                  </p>
                  <Button asChild size="sm" className="mt-3 w-full">
                    <Link
                      to={`/auth?returnTo=${encodeURIComponent(
                        `/products/${id}`,
                      )}`}
                    >
                      Sign in to review
                    </Link>
                  </Button>
                </div>
              ) : viewer?.hasReviewed ? (
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  You&apos;ve already reviewed this listing. Thanks!
                </p>
              ) : (
                <form onSubmit={handleReviewSubmit} className="mt-3 space-y-3">
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setRating(star)}
                        aria-label={`Rate ${star} stars`}
                        className="transition-transform hover:scale-110"
                      >
                        <Star
                          className={`size-5 ${
                            star <= rating
                              ? "fill-amber-400 text-amber-400"
                              : "text-muted-foreground/40"
                          }`}
                        />
                      </button>
                    ))}
                  </div>
                  <Textarea
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                    placeholder="How was the item and the seller?"
                    rows={4}
                    required
                    minLength={3}
                    maxLength={2000}
                  />
                  {viewer?.verifiedBuyer && (
                    <p className="flex items-center gap-1.5 text-xs text-emerald-400">
                      <ShieldCheck className="size-3.5" /> You&apos;ll get a
                      “Verified purchase” badge
                    </p>
                  )}
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={submitting || comment.trim().length < 3}
                  >
                    {submitting ? "Posting…" : "Post review"}
                  </Button>
                </form>
              )}
            </div>
          </div>
        </section>

        {/* Related */}
        {related.length > 0 && (
          <section className="mt-12 border-t border-border/70 pt-10">
            <h2 className="text-lg font-bold tracking-tight">
              {relatedPool.length > 0
                ? `More from ${sellerName}`
                : `More in ${category?.label ?? "this category"}`}
            </h2>
            <div className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-4">
              {related.map((item) => (
                <Link
                  key={item._id}
                  to={`/products/${item._id}`}
                  className="group flex flex-col overflow-hidden rounded-2xl border border-border/70 bg-card transition-colors hover:border-primary/50"
                >
                  <span className="block aspect-[4/3] overflow-hidden bg-secondary/40">
                    <ProductMedia
                      imageUrl={item.imageUrl}
                      categoryId={item.categoryId}
                      title={item.title}
                      className="transition-transform duration-300 group-hover:scale-105"
                    />
                  </span>
                  <span className="flex flex-1 flex-col gap-1 p-3.5">
                    <span className="line-clamp-2 text-sm font-medium leading-5">
                      {item.title}
                    </span>
                    <span className="mt-auto flex items-center justify-between pt-1.5">
                      <span className="text-sm font-bold">
                        {formatPrice(item.priceCents)}
                      </span>
                      {!item.available && (
                        <span className="text-[10px] font-semibold uppercase text-muted-foreground">
                          Sold out
                        </span>
                      )}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Trust footer strip */}
        <div className="mt-12 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 rounded-2xl border border-border/70 bg-card/60 px-6 py-5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="size-3.5 text-primary" /> Verified seller
            account
          </span>
          <span className="inline-flex items-center gap-1.5">
            <CalendarClock className="size-3.5 text-primary" /> Meet-up or
            shipping, agreed together
          </span>
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="size-3.5 text-primary" /> Order tracked in-app
          </span>
          <button
            type="button"
            onClick={() => {
              if (!isAuthenticated) {
                toast.error("Sign in to report a listing.");
                return;
              }
              setReportOpen(true);
            }}
            className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
          >
            <Flag className="size-3.5" /> Report this listing
          </button>
        </div>

        <Dialog open={reportOpen} onOpenChange={setReportOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Report this listing</DialogTitle>
              <DialogDescription>
                Tell us what looks wrong. Reports are private, and moderators
                review every one — a report never removes a listing by itself.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="report-reason">Reason</Label>
                <Select
                  value={reportReason}
                  onValueChange={setReportReason}
                >
                  <SelectTrigger id="report-reason" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REPORT_REASONS.map((reason) => (
                      <SelectItem key={reason.value} value={reason.value}>
                        {reason.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="report-details">Details (optional)</Label>
                <Textarea
                  id="report-details"
                  value={reportDetails}
                  onChange={(event) => setReportDetails(event.target.value)}
                  maxLength={500}
                  rows={3}
                  placeholder="What should the moderator know?"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setReportOpen(false)}
                disabled={reporting}
              >
                Cancel
              </Button>
              <Button onClick={handleReportSubmit} disabled={reporting}>
                {reporting ? "Sending…" : "Submit report"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Link
          to="/products"
          className="mt-8 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back to all products
        </Link>
      </div>
    </Layout>
  );
}
