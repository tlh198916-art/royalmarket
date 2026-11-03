import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LucideIcon } from "lucide-react";
import { ArrowRight, CheckCircle2, Circle } from "lucide-react";
import { Link } from "react-router";

export type OnboardingItem = {
  id: string;
  title: string;
  description: string;
  complete: boolean;
  icon: LucideIcon;
  to?: string;
  actionLabel?: string;
  onClick?: () => void;
};

/** Seller activation checklist shown at the top of the seller dashboard. */
export function SellerOnboardingChecklist({
  items,
}: {
  items: OnboardingItem[];
}) {
  const completed = items.filter((item) => item.complete).length;
  const percent = Math.round((completed / items.length) * 100);
  const allDone = completed === items.length;

  return (
    <section className="mt-6 rounded-2xl border border-border/70 bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-bold tracking-tight">
              {allDone ? "You're ready to sell" : "Your seller setup"}
            </h2>
            <Badge
              variant="outline"
              className={
                allDone
                  ? "border-emerald-400/40 text-emerald-400"
                  : "text-muted-foreground"
              }
            >
              {completed} of {items.length} complete
            </Badge>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {allDone
              ? "Your shop, listing, and first completed sale are all in place. Keep listings fresh and respond to buyers quickly."
              : "Finish these four steps to turn your shop into a working sales channel."}
          </p>
        </div>
        <Link
          to="/sell/guide"
          className="text-xs font-semibold text-primary hover:underline"
        >
          First-listing guide →
        </Link>
      </div>

      <div
        className="mt-4 h-1.5 overflow-hidden rounded-full bg-secondary"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Seller setup progress"
      >
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <div
            key={item.id}
            className={`flex items-start gap-3 rounded-xl border p-3.5 ${
              item.complete
                ? "border-emerald-400/25 bg-emerald-400/[0.04]"
                : "border-border/70 bg-background/40"
            }`}
          >
            <span
              className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg ${
                item.complete
                  ? "bg-emerald-400/10 text-emerald-400"
                  : "bg-secondary text-muted-foreground"
              }`}
            >
              {item.complete ? (
                <CheckCircle2 className="size-4" />
              ) : (
                <Circle className="size-4" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-sm font-semibold">
                <item.icon className="size-3.5 text-muted-foreground" />
                {item.title}
              </p>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                {item.description}
              </p>
              {!item.complete && item.to && (
                <Button asChild size="sm" variant="link" className="mt-1 h-auto p-0 text-xs">
                  <Link to={item.to}>
                    {item.actionLabel ?? "Continue"}
                    <ArrowRight className="ml-1 size-3" />
                  </Link>
                </Button>
              )}
              {!item.complete && item.onClick && (
                <Button
                  size="sm"
                  variant="link"
                  className="mt-1 h-auto p-0 text-xs"
                  onClick={item.onClick}
                >
                  {item.actionLabel ?? "Continue"}
                  <ArrowRight className="ml-1 size-3" />
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
