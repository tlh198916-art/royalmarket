import { EmptyState } from "@/components/marketplace/EmptyState";
import { Layout } from "@/components/marketplace/Layout";
import { ProductCard } from "@/components/marketplace/ProductCard";
import { StarRating } from "@/components/marketplace/StarRating";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { formatDate, initials, pluralize } from "@/lib/format";
import { useQuery } from "convex/react";
import { motion } from "framer-motion";
import { ArrowLeft, MapPin, PackageSearch, Store } from "lucide-react";
import { Link, useParams } from "react-router";

export default function SellerProfile() {
  const { userId = "" } = useParams();
  const profile = useQuery(api.sellers.publicProfile, { sellerId: userId });
  const listings = useQuery(api.products.list, { sellerId: userId, limit: 24 });

  if (profile === undefined) {
    return (
      <Layout>
        <div className="flex justify-center py-24">
          <div className="size-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      </Layout>
    );
  }

  if (profile === null) {
    return (
      <Layout>
        <div className="page-container py-16">
          <EmptyState
            icon={Store}
            title="Seller not found"
            description="This shop doesn't exist or the link is out of date."
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

  const shopName = profile.shopName ?? profile.name;

  return (
    <Layout>
      <div className="page-container py-8 sm:py-12">
        {/* Profile header */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="relative overflow-hidden rounded-3xl border border-border/70 bg-card"
        >
          {profile.businessBannerUrl ? (
            <img
              src={profile.businessBannerUrl}
              alt=""
              className="h-24 w-full object-cover sm:h-32"
            />
          ) : (
            <div
              className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-r from-primary/25 via-primary/10 to-transparent"
              aria-hidden
            />
          )}
          <div className="relative flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:p-8">
            {profile.businessLogoUrl ? (
              <img
                src={profile.businessLogoUrl}
                alt={`${shopName} logo`}
                className="size-20 shrink-0 rounded-3xl border border-border/70 object-cover"
              />
            ) : (
              <span className="flex size-20 shrink-0 items-center justify-center rounded-3xl border border-border/70 bg-secondary text-2xl font-extrabold">
                {initials(shopName)}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight">{shopName}</h1>
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
                  Verified account
                </span>
                {profile.sellerType === "business" && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-[11px] font-semibold">
                    Business storefront
                  </span>
                )}
              </div>
              {profile.bio && (
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                  {profile.bio}
                </p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
                {profile.location && (
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="size-3.5" /> {profile.location}
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5">
                  <Store className="size-3.5" /> Joined{" "}
                  {formatDate(profile.joinedAt)}
                </span>
                {profile.averageRating !== null && (
                  <StarRating value={profile.averageRating} />
                )}
                {profile.businessContact && (
                  <span className="inline-flex items-center gap-1.5">
                    {profile.businessContact}
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 sm:w-auto">
              <div className="rounded-xl border border-border/70 bg-background/50 px-4 py-3 text-center">
                <p className="text-lg font-bold">{profile.activeListings}</p>
                <p className="text-[11px] text-muted-foreground">Live items</p>
              </div>
              <div className="rounded-xl border border-border/70 bg-background/50 px-4 py-3 text-center">
                <p className="text-lg font-bold">{profile.ratingCount}</p>
                <p className="text-[11px] text-muted-foreground">
                  {pluralize(profile.ratingCount, "review")}
                </p>
              </div>
              <div className="rounded-xl border border-border/70 bg-background/50 px-4 py-3 text-center">
                <p className="text-lg font-bold">{profile.totalListings}</p>
                <p className="text-[11px] text-muted-foreground">Total listed</p>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Listings */}
        <div className="mt-10">
          <h2 className="text-lg font-bold tracking-tight">
            {shopName}&apos;s listings
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {listings === undefined
              ? "Loading…"
              : `${listings.length} live ${listings.length === 1 ? "item" : "items"}`}
          </p>

          <div className="mt-5">
            {listings === undefined ? (
              <div className="flex justify-center py-10">
                <div className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) : listings.length === 0 ? (
              <EmptyState
                icon={PackageSearch}
                title="No live listings right now"
                description="This seller hasn't published anything at the moment. Check back soon or browse the rest of the catalog."
                action={
                  <Button asChild>
                    <Link to="/products">Browse products</Link>
                  </Button>
                }
                compact
              />
            ) : (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
                {listings.map((product, index) => (
                  <ProductCard
                    key={product._id}
                    product={product}
                    index={index}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <Link
          to="/products"
          className="mt-10 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back to all products
        </Link>
      </div>
    </Layout>
  );
}
