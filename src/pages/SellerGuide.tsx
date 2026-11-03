import { Layout } from "@/components/marketplace/Layout";
import { SellerPlanComparison } from "@/components/marketplace/SellerPlanComparison";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { usePageMeta } from "@/lib/seo";
import {
  ArrowRight,
  Camera,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  ImagePlus,
  PackageCheck,
  Rocket,
  ShieldCheck,
  Tag,
} from "lucide-react";
import { Link } from "react-router";

const steps = [
  {
    icon: Tag,
    title: "Pick one item to sell",
    body: "Start with something you already own and no longer need. One clear, honest listing beats a rushed batch of five.",
    checklist: [
      "Choose something you have the right to sell",
      "Confirm you have it in hand and can hand it over",
      "Note the condition and any flaws",
    ],
  },
  {
    icon: Camera,
    title: "Take useful photos",
    body: "Natural light and a clean background help buyers decide faster. You can add up to 8 photos per listing.",
    checklist: [
      "Show the whole item as the first photo",
      "Include labels, close-ups, and any damage",
      "Use your own photos — never stock images",
    ],
  },
  {
    icon: ClipboardList,
    title: "Write a clear description",
    body: "State what it is, the size or model, what is included, and the honest condition. Buyers can see the return window before ordering.",
    checklist: [
      "Use a specific title buyers would search for",
      "Mention measurements, model numbers, and flaws",
      "Set a return window you can actually honor",
    ],
  },
  {
    icon: CircleDollarSign,
    title: "Set price, stock, and fulfillment",
    body: "Price competitively, enter the real quantity, and choose pickup, shipping, delivery, or a combination. You control the fees.",
    checklist: [
      "Check similar live listings before pricing",
      "Enter accurate inventory so checkout cannot oversell",
      "Enable only the handoff options you can support",
    ],
  },
  {
    icon: Rocket,
    title: "Publish — then respond quickly",
    body: "Free listings publish immediately. Watch your dashboard for views, buyer messages, and orders, and mark items shipped or delivered promptly.",
    checklist: [
      "Click Publish (or save a private draft first)",
      "Reply to buyer questions and order messages",
      "Mark the item delivered once it changes hands",
    ],
  },
];

export default function SellerGuide() {
  const { user, isAuthenticated } = useAuth();
  const ctaHref = isAuthenticated ? "/sell/new" : "/auth?returnTo=%2Fsell%2Fnew";

  usePageMeta({
    title: "First product listing guide",
    description:
      "A practical step-by-step guide to publishing your first free Royalmarket listing: photos, description, price, inventory, fulfillment, and orders.",
    canonicalPath: "/sell/guide",
  });

  return (
    <Layout>
      <section className="relative overflow-hidden border-b border-border/70">
        <div className="hero-glow pointer-events-none absolute inset-0" aria-hidden />
        <div className="page-container relative py-14 sm:py-18">
          <div className="mx-auto max-w-3xl text-center">
            <Badge
              variant="secondary"
              className="border border-primary/30 bg-primary/10 text-primary"
            >
              Free first listing · no approval queue
            </Badge>
            <h1 className="mt-5 text-3xl font-extrabold leading-tight tracking-tight sm:text-5xl">
              Your first listing, step by step
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
              Five practical steps from “I have something to sell” to a live
              listing. Individual selling costs $0 to join, $0 per listing, and
              0% commission.
            </p>
            <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link to={ctaHref}>
                  {user?.isSeller ? "Create another listing" : "Start your first listing"}
                  <ArrowRight className="ml-2 size-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/sell">See how selling works</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="section-pad">
        <div className="page-container max-w-4xl">
          <ol className="space-y-5">
            {steps.map((step, index) => (
              <li
                key={step.title}
                className="rounded-2xl border border-border/70 bg-card p-5 sm:p-7"
              >
                <div className="flex flex-wrap items-start gap-4">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <step.icon className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold uppercase tracking-wide text-primary">
                      Step {index + 1}
                    </p>
                    <h2 className="mt-1 text-lg font-bold tracking-tight">
                      {step.title}
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {step.body}
                    </p>
                    <ul className="mt-4 grid gap-2 sm:grid-cols-3">
                      {step.checklist.map((item) => (
                        <li
                          key={item}
                          className="flex items-start gap-2 rounded-lg bg-background/40 px-3 py-2 text-xs leading-5"
                        >
                          <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-400" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-6 rounded-2xl border border-primary/30 bg-primary/[0.06] p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <ImagePlus className="mt-0.5 size-5 shrink-0 text-primary" />
              <div>
                <h2 className="text-sm font-bold tracking-tight">
                  Before you publish
                </h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  Use at least one real photo if you can, confirm the quantity,
                  and double-check the return window. You can save a draft and
                  finish later — drafts stay private until you publish.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border/70 bg-card p-5">
            <div className="flex items-start gap-3">
              <PackageCheck className="mt-0.5 size-5 shrink-0 text-primary" />
              <div>
                <p className="text-sm font-semibold">Need a second opinion?</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Read the seller FAQ for fulfillment, returns, and order
                  handling, or open a support ticket.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button asChild variant="outline" size="sm">
                <Link to="/sell#fees">Seller FAQ</Link>
              </Button>
              <Button asChild size="sm">
                <Link to={ctaHref}>List an item</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-border/70 bg-card/30 py-14">
        <div className="page-container">
          <div className="mx-auto mb-8 max-w-2xl text-center">
            <h2 className="text-2xl font-bold tracking-tight">
              Free individual selling vs. paid business plans
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Start free. Upgrade only if your business needs a branded
              storefront and advanced tools.
            </p>
          </div>
          <SellerPlanComparison startHref={ctaHref} />
          <p className="mx-auto mt-5 max-w-2xl text-center text-xs leading-5 text-muted-foreground">
            <ShieldCheck className="mr-1 inline size-3.5 align-[-2px]" />
            No card is required for an individual seller account. Business
            plans keep the existing subscription and commission terms.
          </p>
        </div>
      </section>
    </Layout>
  );
}
