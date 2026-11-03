import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight, CheckCircle2, Rocket, ShieldCheck } from "lucide-react";
import { Link } from "react-router";

const individualBenefits = [
  "$0 to join — no credit card required",
  "$0 per listing, with up to 8 photos",
  "0% commission — keep the full sale price",
  "No monthly fee or minimum sales",
  "Local pickup, shipping, or local delivery",
  "No business or personal website required",
];

const businessBenefits = [
  "Everything in the free individual account",
  "Branded storefront with logo, banner, and URL",
  "Business contact details and storefront profile",
  "Advanced inventory, order, and analytics tools",
  "Starter $29/mo + 5% · Growth $79/mo + 3%",
  "Pro $199/mo + 1% — commission on delivered sales only",
];

export function SellerPlanComparison({
  startHref = "/sell/new",
  businessHref = "/pricing",
  className = "",
}: {
  startHref?: string;
  businessHref?: string;
  className?: string;
}) {
  return (
    <div className={`grid gap-5 lg:grid-cols-2 ${className}`}>
      <div className="flex flex-col rounded-3xl border border-primary/40 bg-card p-6 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-bold tracking-tight">
            Free individual seller
          </h3>
          <Badge className="bg-emerald-500/15 text-emerald-400">
            Free forever
          </Badge>
        </div>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          For personal items, decluttering, and occasional selling. Everything
          you need to list and sell on the main marketplace is included.
        </p>
        <ul className="mt-5 flex-1 space-y-2.5 text-sm">
          {individualBenefits.map((benefit) => (
            <li key={benefit} className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-400" />
              <span className="leading-5">{benefit}</span>
            </li>
          ))}
        </ul>
        <Button asChild size="lg" className="mt-6">
          <Link to={startHref}>
            Start free <ArrowRight className="ml-2 size-4" />
          </Link>
        </Button>
      </div>

      <div className="flex flex-col rounded-3xl border border-border/70 bg-card p-6 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-bold tracking-tight">
            Paid business storefront
          </h3>
          <Badge variant="outline">Optional · from $29/month</Badge>
        </div>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          For established businesses that need a branded shop and professional
          selling tools. Upgrading keeps every product, order, and review.
        </p>
        <ul className="mt-5 flex-1 space-y-2.5 text-sm">
          {businessBenefits.map((benefit) => (
            <li key={benefit} className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
              <span className="leading-5">{benefit}</span>
            </li>
          ))}
        </ul>
        <Button asChild size="lg" variant="outline" className="mt-6">
          <Link to={businessHref}>
            <Rocket className="mr-2 size-4" /> Compare business plans
          </Link>
        </Button>
      </div>
    </div>
  );
}
