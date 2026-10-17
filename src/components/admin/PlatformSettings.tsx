import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/convex/_generated/api";
import { bpsToPercent } from "@/convex/plans";
import type { PlanId } from "@/convex/schema";
import { formatDate, formatPrice } from "@/lib/format";
import type { Doc } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Banknote, Loader2, Settings2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type PlanDraft = {
  id: PlanId;
  name: string;
  priceDollars: string;
  commissionPercent: string;
  active: boolean;
  features: string[];
};

/**
 * Admin platform settings: business plan prices (USD), commission rates,
 * the commission base, and pending-subscription activation. All values are
 * validated and applied on the backend — the browser is never trusted.
 */
export function PlatformSettings() {
  const settings = useQuery(api.subscriptions.adminSettings);

  if (!settings) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }
  // Remount the form when saved settings change so the draft re-initializes
  // from fresh values (updatedAt changes on every save).
  return <PlatformSettingsForm key={settings.updatedAt} settings={settings} />;
}

function PlatformSettingsForm({
  settings,
}: {
  settings: Doc<"platformSettings">;
}) {
  const subs = useQuery(api.subscriptions.adminList);
  const ledger = useQuery(api.commissions.adminLedger);
  const updateSettings = useMutation(api.subscriptions.updateSettings);
  const activateSub = useMutation(api.subscriptions.adminActivate);
  const cancelSub = useMutation(api.subscriptions.adminCancel);
  const settle = useMutation(api.commissions.adminSettle);

  // Lazy initializers — no effect needed to seed the draft.
  const [drafts, setDrafts] = useState<PlanDraft[]>(() =>
    settings.plans.map((plan) => ({
      id: plan.id,
      name: plan.name,
      priceDollars: (plan.priceCentsMonthly / 100).toFixed(2),
      // Plain number for the input ("5", not "5%") — display uses bpsToPercent.
      commissionPercent: (plan.commissionBps / 100).toString(),
      active: plan.active,
      features: [...plan.features],
    })),
  );
  const [commissionBase, setCommissionBase] = useState<
    "merchandise_subtotal" | "merchandise_plus_shipping"
  >(settings.commissionBase);
  const [saving, setSaving] = useState(false);

  const pendingSubs = (subs ?? []).filter((s) => s.status === "pending");
  const unsettled = (ledger ?? []).filter((l) => l.status === "pending");

  const handleSave = async () => {
    setSaving(true);
    try {
      const parsed = drafts.map((plan) => {
        const price = Number(plan.priceDollars);
        const commission = Number(plan.commissionPercent);
        if (!Number.isFinite(price) || price < 0)
          throw new Error(`Invalid monthly price for ${plan.name}.`);
        if (!Number.isFinite(commission) || commission < 0 || commission > 50)
          throw new Error(
            `Commission for ${plan.name} must be between 0% and 50%.`,
          );
        return {
          id: plan.id,
          name: plan.name,
          priceCentsMonthly: Math.round(price * 100),
          commissionBps: Math.round(commission * 100),
          active: plan.active,
          features: plan.features,
        };
      });
      await updateSettings({ plans: parsed, commissionBase });
      toast.success("Platform settings saved.", {
        description:
          "Existing subscriptions keep the terms they agreed to — changes apply to new agreements.",
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save settings.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Plan configuration */}
      <section className="rounded-2xl border border-border/70 bg-card">
        <div className="flex items-center gap-2 border-b border-border/70 px-5 py-4">
          <Settings2 className="size-4 text-primary" />
          <h2 className="text-sm font-bold tracking-tight">
            Business plans &amp; commissions (USD)
          </h2>
        </div>
        <div className="space-y-5 px-5 py-5">
          {drafts.map((plan, index) => (
            <div
              key={plan.id}
              className="grid gap-3 rounded-xl border border-border/70 bg-background/40 p-4 sm:grid-cols-2 lg:grid-cols-4"
            >
              <div className="space-y-1.5">
                <Label htmlFor={`plan-name-${plan.id}`}>Plan name</Label>
                <Input
                  id={`plan-name-${plan.id}`}
                  value={plan.name}
                  maxLength={60}
                  onChange={(e) =>
                    setDrafts((prev) =>
                      prev
                        ? prev.map((p, i) =>
                            i === index ? { ...p, name: e.target.value } : p,
                          )
                        : prev,
                    )
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`plan-price-${plan.id}`}>
                  Monthly price (USD)
                </Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    $
                  </span>
                  <Input
                    id={`plan-price-${plan.id}`}
                    type="number"
                    min="0"
                    step="0.01"
                    className="pl-7"
                    value={plan.priceDollars}
                    onChange={(e) =>
                      setDrafts((prev) =>
                        prev
                          ? prev.map((p, i) =>
                              i === index
                                ? { ...p, priceDollars: e.target.value }
                                : p,
                            )
                          : prev,
                      )
                    }
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`plan-commission-${plan.id}`}>
                  Commission (%)
                </Label>
                <Input
                  id={`plan-commission-${plan.id}`}
                  type="number"
                  min="0"
                  max="50"
                  step="0.5"
                  value={plan.commissionPercent}
                  onChange={(e) =>
                    setDrafts((prev) =>
                      prev
                        ? prev.map((p, i) =>
                            i === index
                              ? { ...p, commissionPercent: e.target.value }
                              : p,
                          )
                        : prev,
                    )
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Availability</Label>
                <Button
                  type="button"
                  variant={plan.active ? "outline" : "secondary"}
                  className="w-full"
                  onClick={() =>
                    setDrafts((prev) =>
                      prev
                        ? prev.map((p, i) =>
                            i === index ? { ...p, active: !p.active } : p,
                          )
                        : prev,
                    )
                  }
                >
                  {plan.active ? "Active — click to hide" : "Hidden — click to show"}
                </Button>
              </div>
            </div>
          ))}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Commission base</Label>
              <Select
                value={commissionBase}
                onValueChange={(value) =>
                  setCommissionBase(
                    value as "merchandise_subtotal" | "merchandise_plus_shipping",
                  )
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="merchandise_subtotal">
                    Merchandise subtotal only (excludes shipping)
                  </SelectItem>
                  <SelectItem value="merchandise_plus_shipping">
                    Merchandise + seller shipping fees
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Sales tax is never treated as platform revenue. Cancellations
                and refunds never generate commission.
              </p>
            </div>
            <div className="flex items-end">
              <Button
                className="w-full sm:w-auto"
                disabled={saving}
                onClick={() => void handleSave()}
              >
                {saving ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : null}
                {saving ? "Saving…" : "Save platform settings"}
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Subscriptions */}
      <section className="rounded-2xl border border-border/70 bg-card">
        <div className="flex items-center gap-2 border-b border-border/70 px-5 py-4">
          <Banknote className="size-4 text-primary" />
          <h2 className="text-sm font-bold tracking-tight">
            Seller subscriptions
          </h2>
          {pendingSubs.length > 0 && (
            <Badge className="bg-amber-500/15 text-amber-400">
              {pendingSubs.length} pending
            </Badge>
          )}
        </div>
        {subs === undefined ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">Loading…</p>
        ) : subs.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            No subscriptions yet.
          </p>
        ) : (
          <div className="divide-y divide-border/70">
            {subs.map((sub) => (
              <div
                key={sub._id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {sub.sellerName}{" "}
                    <span className="font-normal text-muted-foreground">
                      {sub.sellerEmail ?? ""}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {sub.planName} · {formatPrice(sub.priceCentsMonthly)}/mo ·{" "}                      {bpsToPercent(sub.commissionBps)} · agreed{" "}
                    {formatDate(sub.agreedAt)}
                    {sub.renewsAt ? ` · renews ${formatDate(sub.renewsAt)}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={
                      sub.status === "active"
                        ? "border-emerald-400/40 text-emerald-400"
                        : sub.status === "pending"
                          ? "border-amber-400/40 text-amber-400"
                          : "text-muted-foreground"
                    }
                  >
                    {sub.status}
                  </Badge>
                  {sub.status === "pending" && (
                    <Button
                      size="sm"
                      onClick={() => {
                        void activateSub({ subscriptionId: sub._id })
                          .then(() =>
                            toast.success(
                              `${sub.sellerName}'s subscription activated.`,
                            ),
                          )
                          .catch((error: unknown) =>
                            toast.error(
                              error instanceof Error
                                ? error.message
                                : "Could not activate.",
                            ),
                          );
                      }}
                    >
                      Confirm payment &amp; activate
                    </Button>
                  )}
                  {(sub.status === "active" || sub.status === "pending") && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        void cancelSub({ subscriptionId: sub._id })
                          .then(() => toast.success("Subscription cancelled."))
                          .catch((error: unknown) =>
                            toast.error(
                              error instanceof Error
                                ? error.message
                                : "Could not cancel.",
                            ),
                          );
                      }}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Commission ledger */}
      <section className="rounded-2xl border border-border/70 bg-card">
        <div className="flex items-center gap-2 border-b border-border/70 px-5 py-4">
          <Banknote className="size-4 text-primary" />
          <h2 className="text-sm font-bold tracking-tight">
            Commission ledger
          </h2>
          {unsettled.length > 0 && (
            <Badge className="bg-amber-500/15 text-amber-400">
              {unsettled.length} unsettled
            </Badge>
          )}
        </div>
        {ledger === undefined ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">Loading…</p>
        ) : ledger.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            No commissions recorded. Commission accrues when business-plan
            sellers deliver orders.
          </p>
        ) : (
          <div className="divide-y divide-border/70">
            {ledger.map((row) => (
              <div
                key={row._id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {row.sellerName} · {formatPrice(row.amountCents)}{" "}
                    <span className="text-xs text-muted-foreground">
                      (base {formatPrice(row.baseCents)} at{" "}
                      {bpsToPercent(row.commissionBps)})
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatDate(row.occurredAt)} · {row.planId}
                    {row.note ? ` · ${row.note}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={
                      row.status === "confirmed"
                        ? "border-emerald-400/40 text-emerald-400"
                        : row.status === "reversed"
                          ? "text-muted-foreground"
                          : "border-amber-400/40 text-amber-400"
                    }
                  >
                    {row.status}
                  </Badge>
                  {row.status === "pending" && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          void settle({ entryId: row._id, action: "confirm" })
                            .then(() => toast.success("Commission settled."))
                            .catch((error: unknown) =>
                              toast.error(
                                error instanceof Error
                                  ? error.message
                                  : "Could not settle.",
                              ),
                            );
                        }}
                      >
                        Mark paid
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => {
                          const reason = window.prompt(
                            "Reason for reversing this commission:",
                          );
                          if (!reason?.trim()) return;
                          void settle({
                            entryId: row._id,
                            action: "reverse",
                            note: reason,
                          })
                            .then(() => toast.success("Commission reversed."))
                            .catch((error: unknown) =>
                              toast.error(
                                error instanceof Error
                                  ? error.message
                                  : "Could not reverse.",
                              ),
                            );
                        }}
                      >
                        Reverse
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
