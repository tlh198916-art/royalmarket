import { EmptyState } from "@/components/marketplace/EmptyState";
import { Layout } from "@/components/marketplace/Layout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { api } from "@/convex/_generated/api";
import type { PlanId } from "@/convex/schema";
import { useAuth } from "@/hooks/use-auth";
import { formatPrice } from "@/lib/format";
import { useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Loader2,
  Store,
} from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";

function percent(bps: number): string {
  const p = bps / 100;
  return `${Number.isInteger(p) ? p : p.toFixed(2)}%`;
}

const PLAN_ORDER: PlanId[] = ["starter", "growth", "pro"];

export default function SellPlans() {
  const [searchParams] = useSearchParams();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const plansQuery = useQuery(api.subscriptions.publicPlans);
  const mySub = useQuery(api.subscriptions.mine);
  const subscribe = useMutation(api.subscriptions.subscribe);
  const changePlan = useMutation(api.subscriptions.changePlan);
  const cancelSub = useMutation(api.subscriptions.cancel);

  const requested = searchParams.get("plan");
  const [selected, setSelected] = useState<PlanId | null>(
    PLAN_ORDER.includes(requested as PlanId) ? (requested as PlanId) : null,
  );
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const plans = plansQuery?.plans ?? [];
  const byId = new Map(plans.map((p) => [p.id, p]));
  const chosen = selected ? byId.get(selected) : undefined;

  const hasActiveSub =
    mySub?.status === "active" || mySub?.status === "pending";
  const activePlanId = hasActiveSub ? mySub?.planId : null;

  if (authLoading || plansQuery === undefined) {
    return (
      <Layout>
        <div className="flex justify-center py-24">
          <Loader2 className="size-7 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  if (!isAuthenticated || !user) {
    return (
      <Layout>
        <div className="page-container py-16">
          <EmptyState
            icon={Store}
            title="Sign in to choose a plan"
            description="Business plans require a verified seller account. Your existing products and orders are preserved when you upgrade."
            action={
              <Button asChild>
                <Link to="/auth?returnTo=%2Fsell%2Fplans">Sign in</Link>
              </Button>
            }
          />
        </div>
      </Layout>
    );
  }

  const handleSubscribe = async () => {
    if (!selected || !chosen) return;
    if (!agreed) {
      toast.error("Agree to the seller terms before subscribing.");
      return;
    }
    setSubmitting(true);
    try {
      if (hasActiveSub && activePlanId && activePlanId !== selected) {
        await changePlan({ planId: selected, agreedToTerms: true });
        toast.success(`Plan change requested — ${chosen.name}.`, {
          description:
            "The new rate applies once your payment is confirmed by an administrator.",
        });
      } else {
        await subscribe({ planId: selected, agreedToTerms: true });
        toast.success(`Welcome to ${chosen.name}!`, {
          description:
            "Your subscription is pending payment confirmation. Business features activate once payment is confirmed.",
        });
      }
      // Stay on the page — the status banner now shows the live state.
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not subscribe.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async () => {
    if (!window.confirm("Cancel your subscription? Your listings and orders stay — you'll continue as a free individual seller."))
      return;
    setCancelling(true);
    try {
      await cancelSub({});
      toast.success("Subscription cancelled.", {
        description:
          "You keep your account, listings, orders, and history as a free individual seller.",
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not cancel.",
      );
    } finally {
      setCancelling(false);
    }
  };

  return (
    <Layout>
      <div className="page-container max-w-4xl py-8 sm:py-12">
        <Link
          to="/pricing"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Pricing overview
        </Link>

        <h1 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
          {hasActiveSub ? "Your business plan" : "Choose your business plan"}
        </h1>
        <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
          All amounts in US dollars. Review the monthly fee and commission rate
          before you agree — nothing is charged without your confirmation.
        </p>

        {/* Current subscription status */}
        {mySub && hasActiveSub && (
          <Alert
            className={
              mySub.status === "active"
                ? "mt-6 border-emerald-400/40"
                : "mt-6 border-amber-400/40"
            }
          >
            <AlertTriangle
              className={
                mySub.status === "active"
                  ? "text-emerald-400"
                  : "text-amber-400"
              }
            />
            <AlertTitle>
              {mySub.planName} —{" "}
              {mySub.status === "active" ? "Active" : "Pending payment"}
            </AlertTitle>
            <AlertDescription>
              {formatPrice(mySub.priceCentsMonthly)}/month ·{" "}
              {percent(mySub.commissionBps)} commission.
              {mySub.status === "pending"
                ? " Card payment isn't configured on this marketplace yet — an administrator confirms payment manually, then your plan activates. You owe nothing until then."
                : mySub.renewsAt
                  ? ` Next billing date: ${new Date(mySub.renewsAt).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}. Renewal is confirmed manually until online payments launch.`
                  : ""}
            </AlertDescription>
          </Alert>
        )}
        {mySub?.status === "cancelled" && (
          <Alert className="mt-6">
            <AlertTriangle className="text-amber-400" />
            <AlertTitle>Previous plan cancelled</AlertTitle>
            <AlertDescription>
              You&apos;re currently a free individual seller. Choose a plan
              above to return to a business subscription — your listings,
              orders, and history were preserved.
            </AlertDescription>
          </Alert>
        )}

        {/* Plan picker */}
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {PLAN_ORDER.map((id) => {
            const plan = byId.get(id);
            if (!plan) return null;
            const isSelected = selected === id;
            const isCurrent = activePlanId === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setSelected(id)}
                className={`rounded-2xl border p-5 text-left transition-colors ${
                  isSelected
                    ? "border-primary bg-primary/5"
                    : "border-border/70 bg-card hover:border-primary/50"
                }`}
                aria-pressed={isSelected}
              >
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-bold tracking-tight">{plan.name}</h2>
                  {isCurrent && (
                    <Badge className="bg-emerald-500/15 text-emerald-400">
                      Current
                    </Badge>
                  )}
                </div>
                <p className="mt-2 text-2xl font-extrabold tracking-tight">
                  {formatPrice(plan.priceCentsMonthly)}
                  <span className="text-sm font-normal text-muted-foreground">
                    /month
                  </span>
                </p>
                <p className="mt-1 text-sm font-semibold text-primary">
                  {percent(plan.commissionBps)} commission per sale
                </p>
              </button>
            );
          })}
        </div>

        {/* Terms agreement + summary */}
        {chosen && (
          <div className="mt-8 rounded-2xl border border-border/70 bg-card p-6">
            <h2 className="text-sm font-bold tracking-tight">
              Review &amp; agree
            </h2>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Plan</dt>
                <dd className="font-medium">{chosen.name}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Monthly fee (USD)</dt>
                <dd className="font-medium">
                  {formatPrice(chosen.priceCentsMonthly)}/month
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">
                  Platform commission (per completed sale)
                </dt>
                <dd className="font-medium">{percent(chosen.commissionBps)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">
                  Commission charged on
                </dt>
                <dd className="text-right font-medium">
                  Merchandise subtotal — excludes shipping, cancelled, and
                  refunded items
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Payment processing</dt>
                <dd className="text-right font-medium">
                  Separate provider fees may apply when card payments launch —
                  none today
                </dd>
              </div>
            </dl>

            <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-border/70 bg-background/40 p-4">
              <Checkbox
                checked={agreed}
                onCheckedChange={(v) => setAgreed(v === true)}
                className="mt-0.5"
              />
              <span className="text-xs leading-5 text-muted-foreground">
                I agree to the seller terms: the{" "}
                {formatPrice(chosen.priceCentsMonthly)}/month fee and{" "}
                {percent(chosen.commissionBps)} commission on delivered sales
                for {chosen.name}, billed in USD. I understand commissions
                don&apos;t apply to cancelled or refunded items, that I handle
                my own fulfillment, and that I remain responsible for
                applicable consumer, tax, and safety laws. I can cancel anytime
                and keep my account and listings.
              </span>
            </label>

            {hasActiveSub && activePlanId && activePlanId !== selected && (
              <p className="mt-3 text-xs leading-5 text-amber-400">
                Switching from your current plan replaces it once the new
                subscription is confirmed.
              </p>
            )}

            <Button
              size="lg"
              className="mt-5 w-full"
              disabled={!agreed || submitting || activePlanId === selected}
              onClick={() => void handleSubscribe()}
            >
              {submitting
                ? "Processing…"
                : activePlanId === selected
                  ? "This is your current plan"
                  : hasActiveSub
                    ? `Switch to ${chosen.name}`
                    : `Subscribe to ${chosen.name} · ${formatPrice(chosen.priceCentsMonthly)}/mo`}
            </Button>

            <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
              <Clock3 className="mt-0.5 size-3.5 shrink-0" />
              Online card billing isn&apos;t configured yet. Your subscription
              starts as <strong>pending</strong> and activates when an
              administrator confirms payment — you&apos;ll never be charged a
              fee or commission you haven&apos;t agreed to.
            </p>
          </div>
        )}

        {!selected && (
          <p className="mt-8 flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-primary" /> Select a plan above
            to review its terms.
          </p>
        )}

        {/* Cancel */}
        {hasActiveSub && (
          <div className="mt-10 rounded-2xl border border-border/70 bg-card p-6">
            <h2 className="text-sm font-bold tracking-tight">
              Cancel subscription
            </h2>
            <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
              Your seller account, listings, orders, reviews, and history stay
              intact. Business-only features (storefront branding, advanced
              analytics) switch off and you continue as a free individual
              seller.
            </p>
            <Button
              variant="outline"
              className="mt-4"
              disabled={cancelling}
              onClick={() => void handleCancel()}
            >
              {cancelling ? "Cancelling…" : "Cancel my subscription"}
            </Button>
          </div>
        )}
      </div>
    </Layout>
  );
}
