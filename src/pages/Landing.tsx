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
import { usePageMeta } from "@/lib/seo";
import { useQuery } from "convex/react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  BadgeCheck,
  Camera,
  Eye,
  HeartHandshake,
  LayoutGrid,
  LifeBuoy,
  MailCheck,
  PackageSearch,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Tag,
  Truck,
  Wallet,
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
    title: "Create an account",
    body: "Sign up free and confirm the 6-digit code we email you. Every buyer and seller is a real, verified person.",
  },
  {
    icon: Camera,
    title: "Publish a listing",
    body: "Add photos, price, stock and a return window. Free to post, no approval queue — listings go live instantly.",
  },
  {
    icon: Truck,
    title: "Manage orders",
    body: "Track every order from your dashboard, agree on meet-up or shipping with the buyer (you both approve it), and mark items shipped and delivered.",
  },
  {
    icon: Wallet,
    title: "Receive payments",
    body: "Buyers pay on delivery at handoff — you collect directly from the buyer and keep 100% of the sale at launch.",
  },
];

const trustPoints = [
  {
    icon: BadgeCheck,
    title: "Verified accounts",
    body: "Every account confirms a real email address with a 6-digit code — no anonymous buyers or sellers.",
  },
  {
    icon: ShieldCheck,
    title: "You pay on delivery",
    body: "Checkout never asks for card details. You inspect the item and pay the seller when you receive it — nothing is charged online today.",
  },
  {
    icon: RotateCcw,
    title: "Returns & refunds",
    body: "Every listing shows its return window (0–90 days) before you buy, and you can cancel any order while it's still 'placed'. Refunds follow the seller's stated return policy.",
  },
  {
    icon: HeartHandshake,
    title: "Dispute handling",
    body: "Open a support ticket with your order number and photos — admins review it and mediate with the seller toward a replacement or refund.",
  },
  {
    icon: LifeBuoy,
    title: "Contact information",
    body: "Reach the team through the support page. Open a ticket and every reply lands in one thread, answered by marketplace admins.",
  },
];

export default function Landing() {
  const { user, isLoading } = useAuth();
  usePageMeta({
    title: "Buy & sell with verified sellers",
    description:
      "Royalmarket is a multi-vendor marketplace with verified sellers, free individual listings, and transparent pay-on-delivery checkout.",
    canonicalPath: "/",
  });
  // Admin-curated featured picks first; fall back to most-viewed real listings.
  const curated = useQuery(api.products.list, {
    featuredOnly: true,
    availableOnly: true,
    limit: 4,
  });
  const popular = useQuery(api.products.list, {
    sortBy: "popular",
    availableOnly: true,
    limit: 4,
  });
  const featured =
    curated === undefined ? undefined : curated.length > 0 ? curated : popular;
  const recentlyAdded = useQuery(api.products.list, {
    sortBy: "newest",
    availableOnly: true,
    limit: 8,
  });

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
        <div className="page-container relative py-10 sm:py-16 lg:py-20">
          <motion.div
            initial={{ opacity: 0, y: 26 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, ease: "easeOut" }}
            className="mx-auto max-w-3xl text-center"
          >
            <Badge
              variant="secondary"
              className="mb-4 border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary"
            >
              Free to post · Verified accounts · Live availability
            </Badge>
            <h1 className="text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">
              The royal-blue marketplace for{" "}
              <span className="text-royal-gradient">buying &amp; selling</span>
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
              Browse listings from verified sellers, list your own items for
              free, and always see exactly what&apos;s in stock — no fake
              ratings, no fake sales, no hidden listing fees.
            </p>

            <div className="mx-auto mt-6 max-w-2xl">
              <SearchBar large />
            </div>

            <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild size="lg" className="w-full px-7 sm:w-auto">
                <Link to="/products">
                  Shop Now <ArrowRight className="ml-2 size-4" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="secondary"
                className="w-full border border-border/80 px-7 sm:w-auto"
              >
                <Link to="/sell">Become a Free Seller</Link>
              </Button>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs font-medium text-muted-foreground sm:mt-8">
              <span>0% listing fees</span>
              <span className="hidden sm:inline">·</span>
              <span>Email-verified sellers &amp; buyers</span>
              <span className="hidden sm:inline">·</span>
              <span>Item condition &amp; stock shown upfront</span>
            </div>
          </motion.div>
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
              View all products →
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

      {/* Category navigation */}
      <section id="categories" className="border-b border-border/70 bg-card/30 py-10 sm:py-12">
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
              How selling works
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
              Four steps from sign-up to payment — with the fees and payout
              terms stated up front.
            </p>
          </motion.div>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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

          {/* Fees & payouts — stated plainly */}
          <motion.div
            {...fadeUp}
            className="mt-8 rounded-2xl border border-border/70 bg-card p-6 sm:p-7"
          >
            <h3 className="text-sm font-bold tracking-tight">
              Fees &amp; payout terms, in plain numbers
            </h3>
            <dl className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Cost per listing
                </dt>
                <dd className="mt-1 text-sm font-semibold">
                  $0 — list as much as you like
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Monthly fee
                </dt>
                <dd className="mt-1 text-sm font-semibold">
                  $0 for individuals — business plans from $29/mo
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Commission on sales
                </dt>
                <dd className="mt-1 text-sm font-semibold">
                  0% for individual sellers — business plans 5% / 3% / 1%
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Payouts
                </dt>
                <dd className="mt-1 text-sm font-semibold">
                  Collected on delivery, straight from the buyer
                </dd>
              </div>
            </dl>
            <p className="mt-4 text-xs leading-5 text-muted-foreground">
              Checkout is pay-on-delivery today — no card details are ever
              taken online. If card payments are configured later, processing
              fees would be passed through at cost with advance notice.{" "}
              <Link
                to="/sell#fees"
                className="font-medium text-primary hover:underline"
              >
                Full fee breakdown →
              </Link>
            </p>
          </motion.div>
        </div>
      </section>

      {/* Two-tier seller value prop */}
      <section id="become-a-seller" className="scroll-mt-24 pb-14 sm:pb-20">
        <div className="page-container">
          <motion.div {...fadeUp} className="mx-auto max-w-3xl text-center">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Become a Free Seller.{" "}
              <span className="text-royal-gradient">
                Upgrade only when your business needs it.
              </span>
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
              Individual selling is free: $0 to join, $0 per listing and 0%
              commission, with no credit card or website required. It is built
              for personal items and occasional sellers who want marketplace
              reach. Paid business storefronts are a separate, optional upgrade
              for established businesses — from $29/month with branded tools
              and a 5%, 3% or 1% commission plan.
            </p>
          </motion.div>

          <div className="mt-9 grid gap-5 lg:grid-cols-2">
            {/* Sell as an Individual */}
            <motion.div
              {...fadeUp}
              className="flex flex-col rounded-3xl border border-primary/40 bg-card p-6 sm:p-8"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-lg font-bold tracking-tight">
                  Free individual selling
                </h3>
                <Badge className="bg-emerald-500/15 text-emerald-400">
                  Free forever
                </Badge>
              </div>
              <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                For personal items and occasional sellers. No business, storefront
                or monthly commitment required.
              </p>
              <ul className="mt-4 flex-1 space-y-2 text-sm">
                {[
                  "$0 to join and $0 per listing",
                  "0% commission — keep the full sale price",
                  "No monthly fee and no credit card",
                  "List on the main Royalmarket marketplace",
                  "Choose local pickup, shipping, or local delivery",
                  "No business or personal website required",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-400" />
                    <span className="leading-5">{item}</span>
                  </li>
                ))}
              </ul>
              <Button asChild size="lg" className="mt-6">
                <Link to="/sell">
                  Start free — no card needed{" "}
                  <ArrowRight className="ml-2 size-4" />
                </Link>
              </Button>
            </motion.div>

            {/* Grow Your Small Business */}
            <motion.div
              {...fadeUp}
              className="flex flex-col rounded-3xl border border-border/70 bg-card p-6 sm:p-8"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-lg font-bold tracking-tight">
                  Paid business storefront
                </h3>
                <Badge variant="outline">Optional · from $29/mo</Badge>
              </div>
              <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                For established businesses that want a branded shop, advanced
                tools and a professional buying experience.
              </p>
              <ul className="mt-4 flex-1 space-y-2 text-sm">
                {[
                  "Professional business storefront",
                  "Custom branding — logo, banner, storefront URL",
                  "Advanced inventory and analytics",
                  "Business tools and order management",
                  "Flexible subscription tiers — $29, $79, $199/month",
                  "Commission rates based on the selected plan — 5%, 3%, or 1%",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
                    <span className="leading-5">{item}</span>
                  </li>
                ))}
              </ul>
              <Button asChild size="lg" variant="outline" className="mt-6">
                <Link to="/pricing">
                  Compare business plans <ArrowRight className="ml-2 size-4" />
                </Link>
              </Button>
            </motion.div>
          </div>

          <p className="mx-auto mt-5 max-w-2xl text-center text-xs leading-5 text-muted-foreground">
            Most sellers start free and never pay a monthly fee. Business plans
            are optional; all prices are in USD, and upgrading keeps every
            product, order, and review you&apos;ve already built.{" "}
            <Link to="/pricing" className="text-primary hover:underline">
              Compare plans and fees →
            </Link>
          </p>
        </div>
      </section>

      {/* Trust */}
      <section className="border-t border-border/70 bg-card/30 py-14">
        <div className="page-container">
          <h2 className="text-center text-xl font-bold tracking-tight sm:text-2xl">
            Buyer protection, in plain terms
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-center text-sm text-muted-foreground">
            What this platform actually provides — no promises we don&apos;t
            keep.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
          <div className="mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm">
            <Link
              to="/support"
              className="font-medium text-primary transition-colors hover:text-primary/80"
            >
              Support, refunds &amp; disputes →
            </Link>
            <Link
              to="/sell#fees"
              className="font-medium text-primary transition-colors hover:text-primary/80"
            >
              How fees work →
            </Link>
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
