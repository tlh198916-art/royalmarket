import { Layout } from "@/components/marketplace/Layout";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CATEGORIES } from "@/convex/categories";
import { useAuth } from "@/hooks/use-auth";
import { useReferralCapture } from "@/hooks/use-referral-capture";
import { formatPrice } from "@/lib/format";
import { usePageMeta } from "@/lib/seo";
import {
  ArrowRight,
  BadgeDollarSign,
  Camera,
  CheckCircle2,
  Clock3,
  Crown,
  Eye,
  ListChecks,
  HandCoins,
  Handshake,
  PackageCheck,
  Rocket,
  ShieldCheck,
  Store,
  Tag,
} from "lucide-react";
import { motion } from "framer-motion";
import { Link } from "react-router";

const fadeUp = {
  initial: { opacity: 0, y: 22 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-60px" },
  transition: { duration: 0.5, ease: "easeOut" as const },
};

const steps = [
  {
    icon: ShieldCheck,
    title: "Verify your account",
    body: "Sign up with your email and enter the 6-digit code we send. Verification keeps the marketplace free of bots and anonymous sellers.",
  },
  {
    icon: Store,
    title: "Name your shop",
    body: "Pick a shop name, add a short bio and location. Buyers see this on your public seller profile and on every listing.",
  },
  {
    icon: Camera,
    title: "Publish your listing",
    body: "Upload up to 8 photos, set price, inventory and a return window. Save a draft or publish live immediately.",
  },
  {
    icon: PackageCheck,
    title: "Fulfil & get paid",
    body: "Orders land in your dashboard. Agree on meet-up or shipping with the buyer — both approve — then mark items delivered.",
  },
];

const fees = [
  { label: "Listing fee", value: formatPrice(0), note: "Per item, forever free" },
  {
    label: "Individual seller plan",
    value: formatPrice(0),
    note: "No monthly charge, 0% commission",
  },
  {
    label: "Business plans",
    value: "$29+",
    note: "per month — Starter/Growth/Pro with 5%/3%/1% commission",
  },
  { label: "Photo uploads", value: formatPrice(0), note: "Up to 8 photos per listing" },
];

const faqs = [
  {
    q: "Do I need approval before my listing goes live?",
    a: "No approval queue. Listings you publish go live immediately so you can start selling right away. Moderators may take a listing down if it breaks the rules (prohibited items, misleading photos) and the seller dashboard will show the reason. Re-activating a taken-down listing requires support.",
  },
  {
    q: "What does it cost to sell?",
    a: "Individual sellers: nothing. $0 to list, $0 per month, 0% commission — free forever, no credit card required. Want a branded storefront and business tools? Business plans start at $29/month (5% commission), $79/month (3%), or $199/month (1%) — commission applies only to delivered sales of business sellers and never to shipping, cancellations, or refunds. If online card payments are switched on later, provider processing fees would be passed through at cost with advance notice.",
  },
  {
    q: "How do I receive payment?",
    a: "Checkout currently runs on pay-on-delivery: the buyer pays when they receive the item, so you keep 100% of the sale. Card checkout will be enabled once a payment provider is configured — the order history and fulfilment flow already support it.",
  },
  {
    q: "Who pays for shipping?",
    a: "You decide. Enable local pickup (always free), seller-arranged shipping, or local delivery on each listing and set your own fees — or offer everything free. Buyers see your options and any fees before they order, and the fee is added once per order. The platform charges no shipping service fee because it provides no shipping service — you and the buyer approve every arrangement before handoff.",
  },
  {
    q: "Can buyers return an item?",
    a: "You define the return window per listing (0–90 days). If you accept returns, buyers see the window on the product page before ordering. Orders can be cancelled by the buyer while the item hasn't shipped, which restores your inventory automatically.",
  },
  {
    q: "Are accounts really verified?",
    a: "Yes — every account must confirm a 6-digit code sent to its email address before it can list, buy, or review. That is why the marketplace starts empty instead of filled with fake inventory: only verified people can post.",
  },
];

export default function SellLanding() {
  const { user, isAuthenticated, isLoading } = useAuth();
  // Persist the invite through sign-in and record one anonymous link visit.
  const referralCode = useReferralCapture("sell-landing");

  usePageMeta({
    title: "Sell on Royalmarket — free individual seller accounts",
    description:
      "Open a free seller shop, list items with photos and live inventory, and manage orders from one dashboard. Optional business plans from $29/month.",
    canonicalPath: "/sell",
  });

  const ctaHref = isAuthenticated ? "/sell/new" : "/auth?returnTo=%2Fsell%2Fnew";

  return (
    <Layout>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border/70">
        <div className="hero-glow pointer-events-none absolute inset-0" aria-hidden />
        <div className="page-container relative py-16 sm:py-20">
          <motion.div
            initial={{ opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="mx-auto max-w-3xl text-center"
          >
            <Badge
              variant="secondary"
              className="mb-5 border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary"
            >
              $0 to list · 0% commission · publish instantly
            </Badge>
            <h1 className="text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
              Turn your extras into{" "}
              <span className="text-royal-gradient">income</span>
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
              Royalmarket is free to post on. Set up a verified shop in
              minutes, publish listings with photos and live inventory, and
              manage every order from one dashboard.
            </p>
            {referralCode && (
              <p className="mx-auto mt-4 inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">
                <Handshake className="size-3.5" /> Invited by a fellow seller —
                invite code {referralCode}
              </p>
            )}
            <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild size="lg" className="w-full px-7 sm:w-auto">
                <Link to={ctaHref}>
                  {isLoading
                    ? "Loading…"
                    : user?.isSeller
                      ? "Go to seller dashboard"
                      : "Create your free listing"}
                  <ArrowRight className="ml-2 size-4" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="secondary"
                className="w-full border border-border/80 px-7 sm:w-auto"
              >
                <a href="#fees">See the fee breakdown</a>
              </Button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* How do you want to sell? — two seller paths */}
      <section className="border-b border-border/70 bg-card/30 py-14 sm:py-16">
        <div className="page-container">
          <motion.div {...fadeUp} className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              How do you want to sell on Royalmarket?
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Everyone starts free. Upgrade only if you want a branded
              storefront and business tools.
            </p>
          </motion.div>

          <div className="mt-10 grid gap-5 lg:grid-cols-2">
            {/* Individual — free */}
            <motion.div
              {...fadeUp}
              className="flex flex-col rounded-3xl border border-primary/40 bg-card p-6 sm:p-8"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Handshake className="size-6" />
                </div>
                <Badge className="bg-emerald-500/15 text-emerald-400">
                  Free forever
                </Badge>
              </div>
              <h3 className="mt-4 text-xl font-bold tracking-tight">
                Individual Seller
              </h3>
              <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                Sell your products without owning a business or running your
                own online store.
              </p>
              <ul className="mt-4 flex-1 space-y-2 text-sm">
                {[
                  "Free seller account — no credit card",
                  "List products on the main marketplace",
                  "Choose local pickup, shipping, or local delivery",
                  "Set your own shipping and handling charges",
                  "No monthly subscription, 0% commission",
                  "No personal website required",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" />
                    <span className="leading-5">{item}</span>
                  </li>
                ))}
              </ul>
              <Button asChild size="lg" className="mt-6">
                <Link to={ctaHref}>
                  Start selling free <ArrowRight className="ml-2 size-4" />
                </Link>
              </Button>
            </motion.div>

            {/* Business — paid plans */}
            <motion.div
              {...fadeUp}
              className="flex flex-col rounded-3xl border border-border/70 bg-card p-6 sm:p-8"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex size-12 items-center justify-center rounded-2xl bg-secondary text-secondary-foreground">
                  <Rocket className="size-6" />
                </div>
                <Badge variant="outline">From $29/month</Badge>
              </div>
              <h3 className="mt-4 text-xl font-bold tracking-tight">
                Business Seller
              </h3>
              <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                Run your own branded storefront and grow your business with
                professional tools.
              </p>
              <ul className="mt-4 flex-1 space-y-2 text-sm">
                {[
                  "Professional business storefront with logo & banner",
                  "Custom storefront URL and business contact info",
                  "Advanced inventory, order, and analytics tools",
                  "Promotional options (where available)",
                  "Business Starter — $29/mo + 5% commission",
                  "Business Growth — $79/mo + 3% commission",
                  "Business Pro — $199/mo + 1% commission",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
                    <span className="leading-5">{item}</span>
                  </li>
                ))}
              </ul>
              <Button asChild size="lg" variant="outline" className="mt-6">
                <Link to="/pricing">
                  Explore business plans <ArrowRight className="ml-2 size-4" />
                </Link>
              </Button>
            </motion.div>
          </div>

          <p className="mx-auto mt-6 max-w-2xl text-center text-xs leading-5 text-muted-foreground">
            Upgrading from individual to business keeps every product, order,
            review, and bit of account history. All prices in USD.
          </p>
        </div>
      </section>

      {/* How selling works */}
      <section className="section-pad">
        <div className="page-container">
          <motion.div {...fadeUp} className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              How selling works
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
              Four steps, no paperwork, no waiting rooms.
            </p>
          </motion.div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((step, index) => (
              <motion.div
                key={step.title}
                {...fadeUp}
                transition={{ duration: 0.45, delay: index * 0.08, ease: "easeOut" }}
                className="rounded-2xl border border-border/70 bg-card p-6"
              >
                <div className="flex items-center justify-between">
                  <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <step.icon className="size-5" />
                  </div>
                  <span className="text-xs font-bold text-muted-foreground">
                    STEP {index + 1}
                  </span>
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

      {/* Category-specific recruitment */}
      <section className="border-b border-border/70 bg-card/30 py-14 sm:py-16">
        <div className="page-container">
          <motion.div {...fadeUp} className="mx-auto max-w-2xl text-center">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
              <Tag className="size-3.5" /> Find your aisle
            </span>
            <h2 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
              Sell what you already know
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Pick a category for tailored item ideas, pricing tips, and a
              listing form that starts in the right aisle.
            </p>
          </motion.div>
          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {CATEGORIES.map((category) => (
              <Link
                key={category.id}
                to={`/sell/category/${category.id}`}
                className="group rounded-2xl border border-border/70 bg-card p-4 text-center transition-colors hover:border-primary/50"
              >
                <span className="text-2xl" aria-hidden>
                  {category.emoji}
                </span>
                <span className="mt-2 block text-xs font-semibold transition-colors group-hover:text-primary">
                  {category.label}
                </span>
              </Link>
            ))}
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <Link
              to="/sell/guide"
              className="group flex items-start gap-3 rounded-2xl border border-border/70 bg-card p-5 transition-colors hover:border-primary/50"
            >
              <ListChecks className="mt-0.5 size-5 shrink-0 text-primary" />
              <span>
                <span className="block text-sm font-semibold group-hover:text-primary">
                  First-listing guide
                </span>
                <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                  Five practical steps for photos, descriptions, pricing, and
                  publishing your first item.
                </span>
              </span>
            </Link>
            <Link
              to="/founding-sellers"
              className="group flex items-start gap-3 rounded-2xl border border-border/70 bg-card p-5 transition-colors hover:border-primary/50"
            >
              <Crown className="mt-0.5 size-5 shrink-0 text-primary" />
              <span>
                <span className="block text-sm font-semibold group-hover:text-primary">
                  Become a Founding Seller
                </span>
                <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                  Join the early sellers, meet the team at the launch event,
                  and start with a free shop.
                </span>
              </span>
            </Link>
          </div>
        </div>
      </section>

      {/* Fees */}
      <section id="fees" className="scroll-mt-24 border-y border-border/70 bg-card/30 py-14 sm:py-20">
        <div className="page-container">
          <motion.div {...fadeUp} className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <BadgeDollarSign className="size-5 text-primary" />
                <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
                  Fees, in full
                </h2>
              </div>
              <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                Individual selling costs nothing — no listing fee, no monthly
                fee, no commission. Business plans are optional and priced up
                front, and nothing is billed automatically.
              </p>
            </div>
            <Button asChild>
              <Link to={ctaHref}>
                Start listing free <ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
          </motion.div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {fees.map((fee) => (
              <div
                key={fee.label}
                className="rounded-2xl border border-border/70 bg-card p-6"
              >
                <p className="text-sm text-muted-foreground">{fee.label}</p>
                <p className="mt-2 text-3xl font-extrabold tracking-tight text-primary">
                  {fee.value}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{fee.note}</p>
              </div>
            ))}
          </div>

          <div className="mt-6 flex items-start gap-3 rounded-2xl border border-border/70 bg-card p-5 text-sm leading-6 text-muted-foreground">
            <HandCoins className="mt-0.5 size-4 shrink-0 text-primary" />
            <p>
              <span className="font-semibold text-foreground">
                Payouts today:
              </span>{" "}
              orders run on pay-on-delivery, so you collect payment directly
              when you hand over the item. Online card checkout (and card
              processing fees) will be documented here before it is switched
              on — it requires payment-provider keys to be configured first.
            </p>
          </div>
        </div>
      </section>

      {/* Listing standards */}
      <section className="section-pad">
        <div className="page-container grid gap-8 lg:grid-cols-2">
          <motion.div {...fadeUp}>
            <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
              Listing standards &amp; approval
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Publishing is instant — there is no review queue holding your
              listing hostage. In exchange, listings must be honest: real
              photos, accurate condition, real inventory.
            </p>
            <ul className="mt-5 space-y-3">
              {[
                "Listings go live the moment you hit publish",
                "Drafts stay private until you're ready",
                "Moderators can take down listings that break the rules — you'll see the reason in your dashboard",
                "Sold-out items stay visible but clearly marked “Sold out”",
                "Inventory counts decrement automatically at checkout",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span className="leading-6 text-muted-foreground">{item}</span>
                </li>
              ))}
            </ul>
          </motion.div>

          <motion.div {...fadeUp} className="grid gap-4 sm:grid-cols-2">
            {[
              {
                icon: Clock3,
                title: "Live in minutes",
                body: "Photo upload, title, price, stock, returns — one form, one publish button.",
              },
              {
                icon: Eye,
                title: "Real analytics",
                body: "Track views per listing, orders, and fulfilment status from your dashboard.",
              },
              {
                icon: Rocket,
                title: "Fair placement",
                body: "Catalog sorting is by newest, price, or views — never by who paid the most.",
              },
              {
                icon: PackageCheck,
                title: "Order tooling",
                body: "Mark items shipped or delivered, with buyer details and addresses in one place.",
              },
            ].map((card) => (
              <div
                key={card.title}
                className="rounded-2xl border border-border/70 bg-card p-5"
              >
                <card.icon className="size-5 text-primary" />
                <h3 className="mt-3 text-sm font-semibold tracking-tight">
                  {card.title}
                </h3>
                <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                  {card.body}
                </p>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* FAQ */}
      <section className="border-t border-border/70 bg-card/30 py-14">
        <div className="page-container max-w-3xl">
          <h2 className="text-center text-xl font-bold tracking-tight sm:text-2xl">
            Seller FAQ
          </h2>
          <Accordion type="single" collapsible className="mt-6">
            {faqs.map((faq) => (
              <AccordionItem
                key={faq.q}
                value={faq.q}
                className="border-border/70"
              >
                <AccordionTrigger className="text-left text-sm hover:no-underline sm:text-base">
                  {faq.q}
                </AccordionTrigger>
                <AccordionContent className="text-sm leading-6 text-muted-foreground">
                  {faq.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>

          <div className="mt-8 rounded-2xl border border-primary/40 bg-gradient-to-br from-primary/15 to-card p-6 text-center sm:p-8">
            <h3 className="text-lg font-bold tracking-tight">
              Ready to open your shop?
            </h3>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
              Create your verified account and publish your first listing —
              it&apos;s free.
            </p>
            <Button asChild size="lg" className="mt-5">
              <Link to={ctaHref}>
                Start selling <ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </Layout>
  );
}
