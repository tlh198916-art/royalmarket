import { Layout } from "@/components/marketplace/Layout";
import { SellerPlanComparison } from "@/components/marketplace/SellerPlanComparison";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CATEGORIES } from "@/convex/categories";
import { FOUNDING_EVENT } from "@/convex/eventDefaults";
import { useAuth } from "@/hooks/use-auth";
import { useReferralCapture } from "@/hooks/use-referral-capture";
import { usePageMeta } from "@/lib/seo";
import {
  ArrowRight,
  CalendarDays,
  Camera,
  Crown,
  Handshake,
  ListChecks,
  Rocket,
  ShieldCheck,
  Sparkles,
  Store,
  Users,
} from "lucide-react";
import { Link } from "react-router";

const steps = [
  {
    icon: Store,
    title: "Open your free shop",
    body: "Sign in with a verified email and choose a shop name. No application, no business documents, and no credit card.",
  },
  {
    icon: Camera,
    title: "List your first real item",
    body: "Add photos, an honest description, price, stock, and the fulfillment options you can support. Publish instantly.",
  },
  {
    icon: ListChecks,
    title: "Follow the first-listing guide",
    body: "A five-step checklist covers photos, descriptions, pricing, inventory, and what happens after you publish.",
  },
  {
    icon: Users,
    title: "Join the launch event",
    body: "Meet other early sellers online, watch a live first-listing walkthrough, and ask the marketplace team questions.",
  },
];

const benefits = [
  {
    icon: ShieldCheck,
    title: "$0 to join, $0 per listing",
    body: "Individual selling is free forever. There is no listing fee, monthly fee, or credit card requirement.",
  },
  {
    icon: Handshake,
    title: "0% marketplace commission",
    body: "Keep the full sale price on individual sales. Business commission calculations are separate and unchanged.",
  },
  {
    icon: Rocket,
    title: "Publish without an approval queue",
    body: "Real listings go live immediately. You can save a private draft first if you want more time.",
  },
  {
    icon: CalendarDays,
    title: "Founding Sellers Launch Event",
    body: "Early sellers can register for the free online launch event, live walkthrough, and open Q&A.",
  },
];

export default function FoundingSellers() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const referralCode = useReferralCapture("founding-sellers");
  const ctaHref = isAuthenticated ? "/sell/new" : "/auth?returnTo=%2Fsell%2Fnew";
  const eventDate = new Date(FOUNDING_EVENT.startsAt).toLocaleDateString(
    undefined,
    { weekday: "long", month: "long", day: "numeric", year: "numeric" },
  );

  usePageMeta({
    title: "Become a Founding Seller",
    description:
      "Join Royalmarket as a founding individual seller. Open a free shop, publish real listings with 0% commission, and join the free Founding Sellers Launch Event.",
    canonicalPath: "/founding-sellers",
  });

  return (
    <Layout>
      <section className="relative overflow-hidden border-b border-border/70">
        <div className="hero-glow pointer-events-none absolute inset-0" aria-hidden />
        <div className="page-container relative py-16 sm:py-20">
          <div className="mx-auto max-w-3xl text-center">
            <Badge
              variant="secondary"
              className="border border-primary/30 bg-primary/10 px-3 py-1.5 text-primary"
            >
              <Crown className="mr-1.5 size-3.5" /> Founding Seller recruitment
            </Badge>
            <h1 className="mt-5 text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">
              Help build the marketplace.{" "}
              <span className="text-royal-gradient">Start selling free.</span>
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
              Founding sellers are the people who open a real shop and list real
              inventory as Royalmarket launches. No application, no fee, no
              credit card — just a verified account and something worth selling.
            </p>
            {referralCode && (
              <p className="mx-auto mt-4 inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">
                <Handshake className="size-3.5" /> Invited by a fellow seller —
                code {referralCode}
              </p>
            )}
            <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
              <Button asChild size="lg" className="px-7">
                <Link to={ctaHref}>
                  {isLoading
                    ? "Loading…"
                    : user?.isSeller
                      ? "Go to seller dashboard"
                      : "Open your free shop"}
                  <ArrowRight className="ml-2 size-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="secondary" className="px-7">
                <Link to="/sell/guide">See the first-listing guide</Link>
              </Button>
            </div>
            <div className="mt-6 flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs font-medium text-muted-foreground">
              <span>$0 to join</span>
              <span>·</span>
              <span>$0 listing fees</span>
              <span>·</span>
              <span>0% commission</span>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-border/70 bg-card/30 py-14 sm:py-16">
        <div className="page-container">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              What founding sellers actually get
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              No invented badges, quotas, or payout promises. These are the
              tools and terms live on Royalmarket today.
            </p>
          </div>
          <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {benefits.map((benefit) => (
              <div
                key={benefit.title}
                className="rounded-2xl border border-border/70 bg-card p-5"
              >
                <benefit.icon className="size-5 text-primary" />
                <h3 className="mt-3 text-sm font-semibold tracking-tight">
                  {benefit.title}
                </h3>
                <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                  {benefit.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section-pad">
        <div className="page-container">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              From sign-up to live in four steps
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Most of the work is choosing what to sell and taking a useful
              photo. The marketplace handles the rest.
            </p>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((step, index) => (
              <div
                key={step.title}
                className="relative rounded-2xl border border-border/70 bg-card p-6"
              >
                <span className="absolute right-5 top-5 text-3xl font-extrabold text-primary/20">
                  {index + 1}
                </span>
                <step.icon className="size-5 text-primary" />
                <h3 className="mt-4 text-base font-semibold tracking-tight">
                  {step.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {step.body}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-7 rounded-2xl border border-primary/30 bg-primary/[0.06] p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <CalendarDays className="mt-0.5 size-5 shrink-0 text-primary" />
                <div>
                  <h3 className="text-sm font-bold">
                    {FOUNDING_EVENT.title}
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {eventDate} · online · free to attend. Registration is open
                    to verified accounts.
                  </p>
                </div>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link to="/events">
                  View event details <ArrowRight className="ml-1.5 size-3.5" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-border/70 bg-card/30 py-14">
        <div className="page-container">
          <div className="mx-auto mb-8 max-w-2xl text-center">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
              <Sparkles className="size-3.5" /> Pick a category
            </span>
            <h2 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
              There is room in every aisle
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              See category-specific guidance and start a listing with the
              category already selected.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
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
        </div>
      </section>

      <section className="section-pad">
        <div className="page-container">
          <div className="mx-auto mb-8 max-w-2xl text-center">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Free individual selling vs. paid business plans
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Founding sellers start on the free individual account. A paid
              business storefront is optional, not a requirement.
            </p>
          </div>
          <SellerPlanComparison startHref={ctaHref} />
          <div className="mt-8 text-center">
            <Button asChild size="lg">
              <Link to={ctaHref}>
                Become a founding seller <ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </Layout>
  );
}
