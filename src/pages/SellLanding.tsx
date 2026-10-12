import { Layout } from "@/components/marketplace/Layout";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { formatPrice } from "@/lib/format";
import {
  ArrowRight,
  BadgeDollarSign,
  Camera,
  CheckCircle2,
  Clock3,
  Eye,
  HandCoins,
  PackageCheck,
  Rocket,
  ShieldCheck,
  Store,
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
    body: "Upload up to 8 photos, set price, inventory, shipping fee and return window. Save a draft or publish live immediately.",
  },
  {
    icon: PackageCheck,
    title: "Fulfil & get paid",
    body: "Orders land in your seller dashboard. Mark items shipped and delivered — buyers pay on delivery until card checkout is configured.",
  },
];

const fees = [
  { label: "Listing fee", value: formatPrice(0), note: "Per item, forever free" },
  { label: "Shop subscription", value: formatPrice(0), note: "No monthly charge" },
  { label: "Commission on sales", value: formatPrice(0), note: "0% at launch" },
  { label: "Photo uploads", value: formatPrice(0), note: "Up to 8 photos per listing" },
];

const faqs = [
  {
    q: "Do I need approval before my listing goes live?",
    a: "No approval queue. Listings you publish go live immediately so you can start selling right away. Moderators may take a listing down if it breaks the rules (prohibited items, misleading photos) and the seller dashboard will show the reason. Re-activating a taken-down listing requires support.",
  },
  {
    q: "What does it cost to sell?",
    a: "Nothing today: $0 to list, $0 to keep your shop open, and 0% commission on sales during launch. If online card payments are switched on later, standard payment-processing fees would be passed through at cost with advance notice — you'd still never pay a Royal Market listing fee.",
  },
  {
    q: "How do I receive payment?",
    a: "Checkout currently runs on pay-on-delivery: the buyer pays when they receive the item, so you keep 100% of the sale plus any flat shipping fee you set. Card checkout will be enabled once a payment provider is configured — the order history and fulfilment flow already support it.",
  },
  {
    q: "Who pays for shipping?",
    a: "You set a flat shipping fee per listing (or $0 for free shipping). The fee is charged once per order per seller at checkout, and buyers see the estimated dispatch time you configure (1–90 days).",
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
              Royal Market is free to post on. Set up a verified shop in
              minutes, publish listings with photos and live inventory, and
              manage every order from one dashboard.
            </p>
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
                Free to post is the whole price list. Everything below is what
                you pay today — no hidden tiers, no surprise invoices.
              </p>
            </div>
            <Button asChild>
              <Link to="/auth?returnTo=%2Fsell%2Fnew">
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
                body: "Photo upload, title, price, stock, shipping — one form, one publish button.",
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
