import { Layout } from "@/components/marketplace/Layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/convex/_generated/api";
import { bpsToPercent, commissionCents } from "@/convex/plans";
import { useAuth } from "@/hooks/use-auth";
import { formatPrice } from "@/lib/format";
import { usePageMeta } from "@/lib/seo";
import { useQuery } from "convex/react";
import {
  ArrowRight,
  CheckCircle2,
  CircleDollarSign,
  Handshake,
  Store,
  Truck,
  XCircle,
} from "lucide-react";
import { Link } from "react-router";

/** Comparison rows: [feature, individual, starter, growth, pro] */
const COMPARISON: [string, string, string, string, string][] = [
  ["Monthly fee (USD)", "Free forever", "$29", "$79", "$199"],
  ["Platform commission", "None", "5%", "3%", "1%"],
  [
    "Listings on the main marketplace",
    "yes",
    "yes",
    "yes",
    "yes",
  ],
  ["Public seller profile", "yes", "yes", "yes", "yes"],
  [
    "Seller-set pickup, shipping & delivery",
    "yes",
    "yes",
    "yes",
    "yes",
  ],
  ["Branded business storefront", "no", "yes", "yes", "yes"],
  ["Business logo & banner", "no", "yes", "yes", "yes"],
  ["Custom storefront URL", "no", "yes", "yes", "yes"],
  ["Business contact information", "no", "yes", "yes", "yes"],
  ["Basic sales reporting", "no", "yes", "yes", "yes"],
  ["Advanced sales analytics", "no", "no", "yes", "yes"],
  ["Product performance reporting", "no", "no", "yes", "yes"],
  ["Advanced inventory & order tools", "no", "no", "yes", "yes"],
  ["Promotional tools", "no", "no", "soon", "soon"],
  ["Priority support", "no", "no", "soon", "yes"],
];

function Cell({ value }: { value: string }) {
  if (value === "yes")
    return <CheckCircle2 className="size-4 text-emerald-400" aria-label="Included" />;
  if (value === "no")
    return <XCircle className="size-4 text-muted-foreground/50" aria-label="Not included" />;
  if (value === "soon")
    return (
      <Badge variant="outline" className="text-[10px] text-amber-400">
        Coming soon
      </Badge>
    );
  return <span className="text-sm font-medium">{value}</span>;
}

export default function Pricing() {
  const { isAuthenticated } = useAuth();
  usePageMeta({
    title: "Seller plans & fees",
    description:
      "Individual sellers list free with 0% commission. Business plans add a branded storefront from $29/month with 5%/3%/1% commission on delivered sales.",
    canonicalPath: "/pricing",
  });
  const plansQuery = useQuery(api.subscriptions.publicPlans);
  const mySub = useQuery(api.subscriptions.mine);

  const plans = plansQuery?.plans ?? [];
  const byId = new Map(plans.map((p) => [p.id, p]));

  const subscribeHref = (planId: string) =>
    isAuthenticated
      ? `/sell/plans?plan=${planId}`
      : `/auth?returnTo=${encodeURIComponent(`/sell/plans?plan=${planId}`)}`;

  const currentPlanId =
    mySub && (mySub.status === "active" || mySub.status === "pending")
      ? mySub.planId
      : null;

  return (
    <Layout>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border/70">
        <div className="hero-glow pointer-events-none absolute inset-0" aria-hidden />
        <div className="page-container relative py-14 text-center sm:py-20">
          <Badge
            variant="secondary"
            className="mb-4 border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary"
          >
            All prices in US dollars (USD)
          </Badge>
          <h1 className="mx-auto max-w-3xl text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
            Start selling for free.{" "}
            <span className="text-royal-gradient">Grow on your terms.</span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
            Individuals list and sell for free — forever, no credit card, no
            business required. Small businesses can add a branded storefront
            and professional tools from $29/month.
          </p>
        </div>
      </section>

      {/* Individual free tier */}
      <section className="page-container py-10">
        <div className="flex flex-col gap-5 rounded-3xl border border-primary/40 bg-primary/5 p-6 sm:flex-row sm:items-center sm:p-8">
          <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <Handshake className="size-7" />
          </div>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold tracking-tight">
                Sell as an Individual
              </h2>
              <Badge className="bg-emerald-500/15 text-emerald-400">
                Free forever
              </Badge>
            </div>
            <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
              Sell your products without owning a business or running your own
              online store. List on the main marketplace, choose local pickup,
              shipping, or local delivery, and set your own fees — no monthly
              subscription, no commission, no credit card.
            </p>
          </div>
          <Button asChild size="lg" className="shrink-0">
            <Link to={isAuthenticated ? "/sell/new" : "/auth?returnTo=%2Fsell%2Fnew"}>
              Start selling free <ArrowRight className="ml-2 size-4" />
            </Link>
          </Button>
        </div>
      </section>

      {/* Business plan cards */}
      <section className="page-container pb-4">
        <div className="flex items-center gap-2.5">
          <Store className="size-5 text-primary" />
          <h2 className="text-2xl font-bold tracking-tight">
            Grow your small business
          </h2>
        </div>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          A branded storefront, business tools, and marketplace exposure for a
          monthly fee plus a small commission on completed sales. Commission is
          charged on the merchandise subtotal only — not on shipping you
          charge, and not on cancelled or refunded items.
        </p>

        <div className="mt-6 grid gap-5 md:grid-cols-3">
          {(["starter", "growth", "pro"] as const).map((id) => {
            const plan = byId.get(id);
            const highlighted = id === "growth";
            return (
              <div
                key={id}
                className={`flex flex-col rounded-3xl border bg-card p-6 ${
                  highlighted
                    ? "border-primary shadow-lg shadow-primary/10"
                    : "border-border/70"
                }`}
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold tracking-tight">
                    {plan?.name ?? "Business plan"}
                  </h3>
                  {highlighted && (
                    <Badge className="bg-primary/15 text-primary">
                      Most popular
                    </Badge>
                  )}
                  {currentPlanId === id && (
                    <Badge className="bg-emerald-500/15 text-emerald-400">
                      Your plan
                    </Badge>
                  )}
                </div>
                <p className="mt-4 flex items-baseline gap-1">
                  <span className="text-4xl font-extrabold tracking-tight">
                    {plan ? formatPrice(plan.priceCentsMonthly) : "—"}
                  </span>
                  <span className="text-sm text-muted-foreground">/month</span>
                </p>
                <p className="mt-1.5 text-sm font-semibold text-primary">
                  {plan ? bpsToPercent(plan.commissionBps) : "—"} commission per
                  completed sale
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Example: a $100 sale generates{" "}
                  {plan
                    ? formatPrice(commissionCents(10_000, plan.commissionBps))
                    : "$—"}{" "}
                  in platform commission.
                </p>

                <ul className="mt-5 flex-1 space-y-2.5">
                  {(plan?.features ?? []).map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-sm">
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" />
                      <span className="leading-5">{feature}</span>
                    </li>
                  ))}
                </ul>

                <Button
                  asChild
                  size="lg"
                  variant={highlighted ? "default" : "outline"}
                  className="mt-6"
                >
                  <Link to={subscribeHref(id)}>
                    {currentPlanId === id
                      ? "Manage your plan"
                      : "Choose this plan"}
                  </Link>
                </Button>
              </div>
            );
          })}
        </div>
        <p className="mt-4 text-xs leading-5 text-muted-foreground">
          Business plans are billed monthly in USD. Card payment processing is
          not yet configured on this marketplace — after you choose a plan,
          your subscription starts as <em>pending</em> and activates once
          payment is confirmed. You&apos;ll review the exact monthly fee and
          commission rate and agree to the terms before anything is owed.
        </p>
      </section>

      {/* Comparison table */}
      <section className="page-container py-12">
        <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
          Compare plans
        </h2>
        <div className="mt-5 overflow-x-auto rounded-2xl border border-border/70">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[220px]">Feature</TableHead>
                <TableHead className="text-center">Individual</TableHead>
                <TableHead className="text-center">Starter</TableHead>
                <TableHead className="text-center">Growth</TableHead>
                <TableHead className="text-center">Pro</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {COMPARISON.map(([feature, ...values]) => (
                <TableRow key={feature}>
                  <TableCell className="font-medium">{feature}</TableCell>
                  {values.map((value, i) => (
                    <TableCell key={i} className="text-center">
                      <span className="flex justify-center">
                        <Cell value={value} />
                      </span>
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      {/* Seller terms & transparency */}
      <section className="border-t border-border/70 bg-card/40">
        <div className="page-container py-12">
          <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
            Seller terms &amp; transparency
          </h2>
          <div className="mt-5 grid gap-6 text-sm leading-6 text-muted-foreground md:grid-cols-2">
            <div className="space-y-3">
              <p>
                <strong className="text-foreground">Individual vs business.</strong>{" "}
                Individual selling is free forever: registration, listings,
                orders, and payout-on-delivery cost nothing. Business plans add
                a branded storefront and professional tools for a monthly fee
                plus commission.
              </p>
              <p>
                <strong className="text-foreground">Billing.</strong> Business
                plans are billed monthly in USD ($29 / $79 / $199). You review
                and agree to the fee and commission rate before subscribing.
                Prices and rates are set by the platform and shown before every
                agreement.
              </p>
              <p>
                <strong className="text-foreground">Commission.</strong> Only
                business sellers pay commission — 5% / 3% / 1% by plan —
                calculated on the merchandise subtotal of delivered sales.
                Shipping charges you collect, cancelled orders, and refunded
                items are excluded. Individual sellers pay 0%.
              </p>
              <p>
                <strong className="text-foreground">Payment processing.</strong>{" "}
                When online card payments launch, provider processing fees
                (e.g. Stripe, PayPal) apply separately from platform
                commissions and are disclosed at that time. Today, payment
                happens on delivery and no processing fee is charged.
              </p>
            </div>
            <div className="space-y-3">
              <p>
                <strong className="text-foreground">Fulfillment is yours.</strong>{" "}
                When you use your own pickup, shipping, or delivery, you are
                responsible for arranging and completing it. The platform
                provides no shipping service and charges no shipping service
                fee. Never promise delivery dates you can&apos;t guarantee.
              </p>
              <p>
                <strong className="text-foreground">Buyer safety.</strong>{" "}
                Exact pickup details are shared only through the order flow —
                never publish a home address publicly.
              </p>
              <p>
                <strong className="text-foreground">Your legal
                responsibilities.</strong> Sellers — on any plan — must comply
                with applicable consumer protection, tax, product safety, and
                other laws that apply to what and where they sell. The free
                plan does not exempt anyone from those obligations.
              </p>
              <p>
                <strong className="text-foreground">Cancelling.</strong> You can
                cancel a business subscription any time. Your seller account,
                listings, orders, and history stay intact — business-only
                features switch off and you continue as a free individual
                seller.
              </p>
              <p className="flex items-center gap-2 text-xs">
                <Truck className="size-3.5 shrink-0" />
                Questions? Open a ticket on the{" "}
                <Link to="/support" className="text-primary hover:underline">
                  support page
                </Link>
                .
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="page-container py-14 text-center">
        <CircleDollarSign className="mx-auto size-10 text-primary" />
        <h2 className="mt-4 text-2xl font-bold tracking-tight">
          Ready to open your shop?
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
          Create a verified seller account in minutes. Listing is free, and you
          can upgrade to a business plan whenever you&apos;re ready.
        </p>
        <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button asChild size="lg">
            <Link to={isAuthenticated ? "/sell/new" : "/auth?returnTo=%2Fsell%2Fnew"}>
              Start selling free
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/sell">How selling works</Link>
          </Button>
        </div>
      </section>
    </Layout>
  );
}
