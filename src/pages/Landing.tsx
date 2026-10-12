import { EmptyState } from "@/components/marketplace/EmptyState";
import { Layout } from "@/components/marketplace/Layout";
import { ProductCard } from "@/components/marketplace/ProductCard";
import { SearchBar } from "@/components/marketplace/SearchBar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { CATEGORIES } from "@/convex/categories";
import { useAuth } from "@/hooks/use-auth";
import { formatPrice } from "@/lib/format";
import { getRecentViews } from "@/lib/recentlyViewed";
import { useQuery } from "convex/react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  BadgeCheck,
  Camera,
  Eye,
  HeartHandshake,
  LayoutGrid,
  MailCheck,
  PackageSearch,
  Sparkles,
  Tag,
  Truck,
} from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router";

const fadeUp = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-60px" },
  transition: { duration: 0.5, ease: "easeOut" as const },
};

const steps = [
  {
    icon: MailCheck,
    title: "Create a verified account",
    body: "Sign up free with your email and confirm the 6-digit code we send you. Every seller and buyer is a real, verified person.",
  },
  {
    icon: Camera,
    title: "List your item in minutes",
    body: "Add photos, a title, price, inventory and shipping details. Listing is free — $0 to post, $0 to keep your shop open.",
  },
  {
    icon: Truck,
    title: "Sell, ship & get paid",
    body: "Buyers order in-app with transparent availability. You mark items shipped and delivered, and collect payment on delivery.",
  },
];

const trustPoints = [
  {
    icon: BadgeCheck,
    title: "Email-verified accounts",
    body: "No anonymous listings — every account confirms a real inbox before selling or buying.",
  },
  {
    icon: Tag,
    title: "Free to post, always",
    body: "No listing fees, no shop subscription, no commission taken from your sales at launch.",
  },
  {
    icon: Eye,
    title: "Honest availability",
    body: "Stock counts are live. Sold items stay visible but clearly marked so nobody wastes a message.",
  },
  {
    icon: HeartHandshake,
    title: "Human support",
    body: "Open a ticket from the support page and admins follow up from the same dashboard.",
  },
];

export default function Landing() {
  const { user, isLoading } = useAuth();
  const featured = useQuery(api.products.list, { sortBy: "popular", limit: 8 });
  const recentlyAdded = useQuery(api.products.list, { sortBy: "newest", limit: 8 });

  const recentIds = useMemo(() => getRecentViews(), []);
  const recentlyViewed = useQuery(api.products.getByIds, {
    ids: recentIds.map((r) => r.id),
  });

  const featuredIds = new Set((featured ?? []).map((p) => p._id));
  const freshPicks = (recentlyAdded ?? []).filter((p) => !featuredIds.has(p._id));

  return (
    <Layout>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border/70">
        <div className="hero-glow pointer-events-none absolute inset-0" aria-hidden />
        <div className="page-container relative py-16 sm:py-24">
          <motion.div
            initial={{ opacity: 0, y: 26 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, ease: "easeOut" }}
            className="mx-auto max-w-3xl text-center"
          >
            <Badge
              variant="secondary"
              className="mb-6 border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary"
            >
              Free to post · Verified accounts · Live availability
            </Badge>
            <h1 className="text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">
              The royal-blue marketplace for{" "}
              <span className="text-royal-gradient">buying &amp; selling</span>
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
              Browse listings from verified sellers, list your own items for
              free, and always see exactly what&apos;s in stock — no fake
              ratings, no fake sales, no hidden listing fees.
            </p>

            <div className="mx-auto mt-8 max-w-2xl">
              <SearchBar large />
            </div>

            <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild size="lg" className="w-full px-7 sm:w-auto">
                <Link to="/products">
                  Browse products <ArrowRight className="ml-2 size-4" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="secondary"
                className="w-full border border-border/80 px-7 sm:w-auto"
              >
                <Link to="/sell">Start selling — it&apos;s free</Link>
              </Button>
            </div>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs font-medium text-muted-foreground">
              <span>0% listing fees</span>
              <span className="hidden sm:inline">·</span>
              <span>Email-verified sellers &amp; buyers</span>
              <span className="hidden sm:inline">·</span>
              <span>Item condition &amp; stock shown upfront</span>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Category navigation */}
      <section id="categories" className="border-b border-border/70 bg-card/30 py-12">
        <div className="page-container">
          <div className="mb-6 flex items-end justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold tracking-tight sm:text-xl">
                Shop by category
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Jump straight to the aisle you care about.
              </p>
            </div>
            <Link
              to="/products"
              className="hidden text-sm font-medium text-primary transition-colors hover:text-primary/80 sm:block"
            >
              View all products →
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
            {CATEGORIES.map((category, index) => (
              <motion.div
                key={category.id}
                initial={{ opacity: 0, scale: 0.96 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.3, delay: Math.min(index * 0.04, 0.32) }}
              >
                <Link
                  to={`/products?category=${category.id}`}
                  className="group flex h-full flex-col items-center gap-2 rounded-2xl border border-border/70 bg-card px-3 py-5 text-center transition-all duration-200 hover:-translate-y-1 hover:border-primary/50"
                >
                  <span className="text-2xl" aria-hidden>
                    {category.emoji}
                  </span>
                  <span className="text-xs font-semibold leading-4 transition-colors group-hover:text-primary sm:text-sm">
                    {category.label}
                  </span>
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Featured products */}
      <section className="section-pad">
        <div className="page-container">
          <motion.div {...fadeUp} className="mb-7 flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-primary" />
                <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
                  Featured products
                </h2>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                The most-viewed live listings on the marketplace.
              </p>
            </div>
            <Link
              to="/products?sort=popular"
              className="text-sm font-medium text-primary transition-colors hover:text-primary/80"
            >
              View all →
            </Link>
          </motion.div>

          {featured === undefined ? (
            <div className="flex justify-center py-10">
              <div className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : featured.length === 0 ? (
            <EmptyState
              icon={Sparkles}
              title="Nothing featured yet"
              description="Featured picks are drawn from real listings. As soon as sellers publish and shoppers browse, the top items show up right here."
              action={
                <Button asChild>
                  <Link to="/sell">
                    <Tag className="mr-2 size-4" /> List the first item
                  </Link>
                </Button>
              }
              secondaryAction={
                <Button asChild variant="outline">
                  <Link to="/products">Browse the catalog</Link>
                </Button>
              }
            />
          ) : (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {featured.map((product, index) => (
                <ProductCard key={product._id} product={product} index={index} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Recently added */}
      <section className="border-y border-border/70 bg-card/30 py-14 sm:py-20">
        <div className="page-container">
          <motion.div {...fadeUp} className="mb-7 flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <PackageSearch className="size-4 text-primary" />
                <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
                  Recently added
                </h2>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Fresh listings from verified sellers, newest first.
              </p>
            </div>
            <Link
              to="/products?sort=newest"
              className="text-sm font-medium text-primary transition-colors hover:text-primary/80"
            >
              View all →
            </Link>
          </motion.div>

          {recentlyAdded === undefined ? (
            <div className="flex justify-center py-10">
              <div className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : recentlyAdded.length === 0 ? (
            <EmptyState
              icon={LayoutGrid}
              title="No listings yet"
              description="This marketplace starts empty on purpose — you're looking at real inventory only. Be the first seller to publish a listing."
              action={
                <Button asChild>
                  <Link to="/sell">Start selling</Link>
                </Button>
              }
            />
          ) : (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {freshPicks.slice(0, 8).map((product, index) => (
                <ProductCard key={product._id} product={product} index={index} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Recently viewed */}
      {recentlyViewed && recentlyViewed.length > 0 && (
        <section className="py-10">
          <div className="page-container">
            <div className="mb-4 flex items-center gap-2">
              <Eye className="size-4 text-muted-foreground" />
              <h2 className="text-base font-semibold tracking-tight">
                Recently viewed
              </h2>
            </div>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {recentlyViewed.slice(0, 4).map((product) => (
                <Link
                  key={product._id}
                  to={`/products/${product._id}`}
                  className="flex items-center gap-3 rounded-xl border border-border/70 bg-card p-3 transition-colors hover:border-primary/50"
                >
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-secondary/50">
                    <img
                      src={product.imageUrl ?? undefined}
                      alt=""
                      className="h-full w-full object-cover"
                      style={{ display: product.imageUrl ? "block" : "none" }}
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {product.title}
                    </p>
                    <p className="text-sm font-bold text-primary">
                      {formatPrice(product.priceCents)}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* How it works */}
      <section className="section-pad">
        <div className="page-container">
          <motion.div {...fadeUp} className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Selling takes three steps
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
              Free to post, transparent all the way through — here&apos;s the
              whole flow.
            </p>
          </motion.div>

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {steps.map((step, index) => (
              <motion.div
                key={step.title}
                {...fadeUp}
                transition={{ duration: 0.5, delay: index * 0.1, ease: "easeOut" }}
                className="relative rounded-2xl border border-border/70 bg-card p-6"
              >
                <span className="absolute right-5 top-5 text-3xl font-extrabold text-primary/20">
                  {index + 1}
                </span>
                <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <step.icon className="size-5" />
                </div>
                <h3 className="mt-4 text-base font-semibold tracking-tight">
                  {step.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {step.body}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Seller CTA */}
      <section className="pb-14 sm:pb-20">
        <div className="page-container">
          <motion.div
            {...fadeUp}
            className="relative overflow-hidden rounded-3xl border border-primary/40 bg-gradient-to-br from-primary/20 via-card to-card p-8 sm:p-12"
          >
            <div className="max-w-2xl">
              <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
                Open your shop — free
              </h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
                Post as many listings as you like for $0. No commission on
                sales at launch, no subscription, and no approval queue:
                listings publish instantly and are only taken down if they
                break the rules.
              </p>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Button asChild size="lg">
                  <Link to="/sell">
                    Start selling <ArrowRight className="ml-2 size-4" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link to="/sell#fees">See how fees work</Link>
                </Button>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Trust */}
      <section className="border-t border-border/70 bg-card/30 py-14">
        <div className="page-container">
          <h2 className="text-center text-xl font-bold tracking-tight sm:text-2xl">
            Built on trust, not fake numbers
          </h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {trustPoints.map((point) => (
              <div
                key={point.title}
                className="rounded-2xl border border-border/70 bg-card p-5"
              >
                <point.icon className="size-5 text-primary" />
                <h3 className="mt-3 text-sm font-semibold tracking-tight">
                  {point.title}
                </h3>
                <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                  {point.body}
                </p>
              </div>
            ))}
          </div>
          {!isLoading && user && (
            <div className="mt-8 text-center">
              <Button asChild variant="secondary">
                <Link to="/dashboard">
                  Go to your account <ArrowRight className="ml-2 size-4" />
                </Link>
              </Button>
            </div>
          )}
        </div>
      </section>
    </Layout>
  );
}
