import { EmptyState } from "@/components/marketplace/EmptyState";
import { Layout } from "@/components/marketplace/Layout";
import { ProductMedia } from "@/components/marketplace/ProductMedia";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCart } from "@/lib/cart";
import { formatPrice } from "@/lib/format";
import { useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  CreditCard,
  Handshake,
  MapPin,
  ShieldCheck,
  ShoppingCart,
  Truck,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

type Method = "meetup" | "shipping" | "delivery";

type SellerGroup = {
  sellerId: string;
  sellerName: string;
  methods: {
    method: Method;
    feeCents: number;
    label: string;
    detail: string;
  }[];
};

/**
 * Available fulfillment methods for a product, with the seller-set fee for
 * each. Legacy listings without configured options fall back to the
 * original negotiate-directly behavior (pickup or shipping, no preset fee).
 */
function methodsForProduct(
  fulfillment:
    | {
        pickup: { enabled: boolean; area?: string };
        shipping: { enabled: boolean; feeCents: number; handlingDays: number };
        delivery: { enabled: boolean; feeCents: number; area?: string };
      }
    | undefined
    | null,
): { method: Method; feeCents: number }[] {
  if (!fulfillment)
    return [
      { method: "meetup", feeCents: 0 },
      { method: "shipping", feeCents: 0 },
    ];
  const out: { method: Method; feeCents: number }[] = [];
  if (fulfillment.pickup.enabled)
    out.push({ method: "meetup", feeCents: 0 });
  if (fulfillment.shipping.enabled)
    out.push({
      method: "shipping",
      feeCents: Math.round(fulfillment.shipping.feeCents),
    });
  if (fulfillment.delivery.enabled)
    out.push({
      method: "delivery",
      feeCents: Math.round(fulfillment.delivery.feeCents),
    });
  return out;
}

const methodMeta: Record<Method, { icon: typeof Truck; label: string }> = {
  meetup: { icon: Handshake, label: "Local pickup" },
  shipping: { icon: Truck, label: "Shipping" },
  delivery: { icon: MapPin, label: "Local delivery" },
};

export default function Checkout() {
  const { lines, setQuantity, remove, clear } = useCart();
  const liveProducts = useQuery(api.products.getByIds, {
    ids: lines.map((line) => line.productId),
  });
  const placeOrder = useMutation(api.orders.place);
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  // Per-seller method choice: sellerId -> method.
  const [choices, setChoices] = useState<Record<string, Method>>({});

  const liveById = useMemo(() => {
    const map = new Map<string, NonNullable<typeof liveProducts>[number]>();
    for (const product of liveProducts ?? []) map.set(product._id, product);
    return map;
  }, [liveProducts]);

  const rows = lines.map((line) => {
    const live = liveById.get(line.productId);
    if (live === undefined) {
      return {
        line,
        live: null,
        issue:
          liveProducts === undefined
            ? null
            : "This listing was removed by the seller.",
        quantity: line.quantity,
        effectivePriceCents: line.priceCents,
        sellerId: "",
        sellerName: line.sellerName ?? "Seller",
      };
    }
    const quantity = Math.min(line.quantity, live.quantity);
    let issue: string | null = null;
    if (live.status !== "active") issue = "This listing is no longer active.";
    else if (live.quantity === 0) issue = "Sold out — someone beat you to it.";
    else if (quantity < line.quantity)
      issue = `Only ${live.quantity} left — quantity adjusted.`;
    return {
      line,
      live,
      issue,
      quantity,
      effectivePriceCents: live.priceCents,
      sellerId: live.sellerId,
      sellerName:
        live.seller?.shopName ?? live.seller?.name ?? line.sellerName ?? "Seller",
    };
  });

  const blockingIssues = rows.filter(
    (row) => row.issue !== null && (row.quantity === 0 || row.live === null),
  );
  const hasBlockingIssue = blockingIssues.length > 0;

  // Group buyable rows by seller and intersect their method availability
  // (a method must be offered by every listing in the group).
  const sellerGroups: SellerGroup[] = useMemo(() => {
    const groups = new Map<
      string,
      {
        sellerName: string;
        methods: Map<Method, { feeCents: number; label: string; detail: string }>;
        seen: boolean;
      }
    >();
    for (const row of rows) {
      if (!row.live || row.quantity === 0 || !row.sellerId) continue;
      let group = groups.get(row.sellerId);
      if (!group) {
        const methods = new Map<
          Method,
          { feeCents: number; label: string; detail: string }
        >();
        for (const m of methodsForProduct(row.live.fulfillment)) {
          const meta = methodMeta[m.method];
          methods.set(m.method, {
            feeCents: m.feeCents,
            label: meta.label,
            detail:
              m.method === "meetup"
                ? (row.live.fulfillment?.pickup.area
                    ? `Pickup in ${row.live.fulfillment.pickup.area} — details shared after ordering`
                    : "Arrange a meetup directly with the seller")
                : m.method === "shipping"
                  ? (row.live.fulfillment
                      ? `Ships in ~${row.live.fulfillment.shipping.handlingDays}d${
                          row.live.fulfillment.shipping.carrier
                            ? ` via ${row.live.fulfillment.shipping.carrier}`
                            : ""
                        }`
                      : "Cost and carrier arranged with the seller")
                  : (row.live.fulfillment?.delivery.area
                      ? `Delivery in ${row.live.fulfillment.delivery.area}`
                      : "Local delivery arranged with the seller"),
          });
        }
        group = { sellerName: row.sellerName, methods, seen: false };
        groups.set(row.sellerId, group);
      }
      group.seen = true;
      // Intersection: keep only methods this row also offers; the fee is the
      // max across the seller's lines (charged once per seller).
      for (const m of methodsForProduct(row.live.fulfillment)) {
        const current = group.methods.get(m.method);
        if (current) {
          current.feeCents = Math.max(current.feeCents, m.feeCents);
        } else {
          const meta = methodMeta[m.method];
          group.methods.set(m.method, {
            feeCents: m.feeCents,
            label: meta.label,
            detail: "Arranged with the seller",
          });
        }
      }
      // Remove methods not offered by this row.
      for (const key of [...group.methods.keys()]) {
        if (!methodsForProduct(row.live!.fulfillment).some((m) => m.method === key)) {
          group.methods.delete(key);
        }
      }
    }
    return [...groups.entries()].map(([sellerId, group]) => ({
      sellerId,
      sellerName: group.sellerName,
      methods: [...group.methods.entries()].map(([method, info]) => ({
        method,
        feeCents: info.feeCents,
        label: info.label,
        detail: info.detail,
      })),
    }));
  }, [rows]);

  // Effective choices: keep valid picks, default each seller to their first
  // available method. Derived during render — no effect needed.
  const effectiveChoices = useMemo(() => {
    const next: Record<string, Method> = {};
    for (const group of sellerGroups) {
      const current = choices[group.sellerId];
      if (current && group.methods.some((m) => m.method === current)) {
        next[group.sellerId] = current;
      } else if (group.methods[0]) {
        next[group.sellerId] = group.methods[0].method;
      }
    }
    return next;
  }, [sellerGroups, choices]);

  const { itemsSubtotalCents, shippingFeeCents, totalCents } = useMemo(() => {
    let itemsTotal = 0;
    for (const row of rows) {
      if (!row.live || row.quantity === 0) continue;
      itemsTotal += row.effectivePriceCents * row.quantity;
    }
    // One seller-set fee per seller group — never per item, never a platform
    // markup. Pickup is free.
    let feeTotal = 0;
    for (const group of sellerGroups) {
      const chosen = group.methods.find(
        (m) => m.method === effectiveChoices[group.sellerId],
      );
      feeTotal += chosen?.feeCents ?? 0;
    }
    return {
      itemsSubtotalCents: itemsTotal,
      shippingFeeCents: feeTotal,
      totalCents: itemsTotal + feeTotal,
    };
  }, [rows, sellerGroups, effectiveChoices]);

  const missingChoices = sellerGroups.filter(
    (group) => !effectiveChoices[group.sellerId],
  );

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (hasBlockingIssue) {
      toast.error("Resolve the highlighted cart issues first.");
      return;
    }
    if (missingChoices.length > 0) {
      toast.error("Choose a fulfillment option for every seller.");
      return;
    }
    const formData = new FormData(event.currentTarget);
    const note = String(formData.get("fulfillmentNote") ?? "") || undefined;
    setSubmitting(true);
    try {
      const orderId = await placeOrder({
        items: rows
          .filter((row) => row.live && row.quantity > 0)
          .map((row) => ({
            productId: row.line.productId as Id<"products">,
            quantity: row.quantity,
          })),
        fulfillments: sellerGroups.map((group) => ({
          sellerId: group.sellerId as Id<"users">,
          method: effectiveChoices[group.sellerId],
          note,
        })),
        paymentMethod: "cod",
      });
      clear();
      toast.success("Order placed!", {
        description:
          "Your sellers confirm the arrangement from their dashboard — track everything from your orders page.",
      });
      navigate(`/orders?placed=${orderId}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not place the order.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (lines.length === 0) {
    return (
      <Layout>
        <div className="page-container py-16">
          <EmptyState
            icon={ShoppingCart}
            title="Your cart is empty"
            description="Browse the marketplace and add items — availability and pricing are shown live on every listing."
            action={
              <Button asChild>
                <Link to="/products">Browse products</Link>
              </Button>
            }
          />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="page-container py-8 sm:py-12">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Checkout
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {rows.length} {rows.length === 1 ? "item" : "items"} · pay on
          delivery
        </p>

        <form
          onSubmit={handleSubmit}
          className="mt-8 grid gap-8 lg:grid-cols-[1fr_360px]"
        >
          <div className="space-y-8">
            {/* Cart lines */}
            <section className="space-y-3">
              {rows.map((row) => (
                <div
                  key={row.line.productId}
                  className="flex gap-4 rounded-2xl border border-border/70 bg-card p-4"
                >
                  <Link
                    to={`/products/${row.line.productId}`}
                    className="size-20 shrink-0 overflow-hidden rounded-xl border border-border/70 bg-secondary/40"
                  >
                    <ProductMedia
                      imageUrl={row.live?.imageUrl ?? row.line.imageUrl}
                      categoryId={row.live?.categoryId}
                      title={row.line.title}
                    />
                  </Link>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {row.line.title}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatPrice(row.effectivePriceCents)} each · from{" "}
                          {row.sellerName}
                        </p>
                      </div>
                      <p className="text-sm font-bold">
                        {formatPrice(row.effectivePriceCents * row.quantity)}
                      </p>
                    </div>

                    {row.issue && (
                      <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-amber-400">
                        <AlertTriangle className="size-3.5" /> {row.issue}
                      </p>
                    )}

                    <div className="mt-3 flex items-center gap-3">
                      <div className="flex items-center rounded-lg border border-border/80">
                        <button
                          type="button"
                          className="px-2.5 py-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                          onClick={() =>
                            setQuantity(row.line.productId, row.quantity - 1)
                          }
                          disabled={row.quantity <= 1 || row.live === null}
                          aria-label="Decrease quantity"
                        >
                          −
                        </button>
                        <span className="w-7 text-center text-sm font-semibold">
                          {row.quantity}
                        </span>
                        <button
                          type="button"
                          className="px-2.5 py-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                          onClick={() =>
                            setQuantity(row.line.productId, row.quantity + 1)
                          }
                          disabled={
                            row.live === null ||
                            row.quantity >= (row.live?.quantity ?? 1)
                          }
                          aria-label="Increase quantity"
                        >
                          +
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => remove(row.line.productId)}
                        className="text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-destructive hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </section>

            {/* Per-seller fulfillment choices */}
            <section className="space-y-4">
              <div>
                <h2 className="text-sm font-bold tracking-tight">
                  How will you get it?
                </h2>
                <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                  Each seller sets their own options and fees. Fees are added
                  once per seller — never per item — and there is no platform
                  shipping charge.
                </p>
              </div>

              {sellerGroups.map((group) => (
                <div
                  key={group.sellerId}
                  className="rounded-2xl border border-border/70 bg-card p-5"
                >
                  <p className="text-sm font-semibold">
                    From {group.sellerName}
                  </p>
                  <RadioGroup
                    value={effectiveChoices[group.sellerId] ?? ""}
                    onValueChange={(value) =>
                      setChoices((prev) => ({
                        ...prev,
                        [group.sellerId]: value as Method,
                      }))
                    }
                    className="mt-3 space-y-3"
                  >
                    {group.methods.map((option) => {
                      const Icon = methodMeta[option.method].icon;
                      return (
                        <label
                          key={option.method}
                          htmlFor={`method-${group.sellerId}-${option.method}`}
                          className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${
                            effectiveChoices[group.sellerId] === option.method
                              ? "border-primary/50 bg-primary/5"
                              : "border-border/70 hover:border-primary/50"
                          }`}
                        >
                          <RadioGroupItem
                            id={`method-${group.sellerId}-${option.method}`}
                            value={option.method}
                            className="mt-0.5"
                          />
                          <span className="flex-1">
                            <span className="flex items-center justify-between gap-2 text-sm font-semibold">
                              <span className="flex items-center gap-2">
                                <Icon
                                  className={`size-4 ${
                                    effectiveChoices[group.sellerId] ===
                                    option.method
                                      ? "text-primary"
                                      : ""
                                  }`}
                                />
                                {option.label}
                              </span>
                              <span className="font-bold">
                                {option.feeCents === 0
                                  ? "Free"
                                  : formatPrice(option.feeCents)}
                              </span>
                            </span>
                            <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                              {option.detail}
                              {option.feeCents > 0 &&
                                " — seller-set fee, added once for this seller"}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </RadioGroup>
                </div>
              ))}

              <div className="space-y-1.5">
                <Label htmlFor="fulfillmentNote">
                  Note for all sellers (optional)
                </Label>
                <Textarea
                  id="fulfillmentNote"
                  name="fulfillmentNote"
                  rows={3}
                  maxLength={500}
                  placeholder="e.g. Prefer weekend pickup; happy to pay by cash on handoff"
                />
                <p className="text-xs text-muted-foreground">
                  Sellers confirm the arrangement from their dashboard. Both of
                  you approve before handoff.
                </p>
              </div>
            </section>

            {/* Payment */}
            <section className="rounded-2xl border border-border/70 bg-card p-6">
              <h2 className="text-sm font-bold tracking-tight">Payment</h2>
              <RadioGroup defaultValue="cod" className="mt-4 space-y-3">
                <label
                  htmlFor="pay-cod"
                  className="flex cursor-pointer items-start gap-3 rounded-xl border border-primary/50 bg-primary/5 p-4"
                >
                  <RadioGroupItem id="pay-cod" value="cod" className="mt-0.5" />
                  <span className="flex-1">
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      <Truck className="size-4 text-primary" /> Pay on delivery
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                      Hand payment to the seller when you receive the item —
                      including any seller-set fulfillment fee shown above.
                      Nothing is charged online today.
                    </span>
                  </span>
                </label>
                <label
                  htmlFor="pay-card"
                  className="flex cursor-not-allowed items-start gap-3 rounded-xl border border-border/70 p-4 opacity-60"
                >
                  <RadioGroupItem
                    id="pay-card"
                    value="card"
                    disabled
                    className="mt-0.5"
                  />
                  <span className="flex-1">
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      <CreditCard className="size-4" /> Card payment
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                      Coming soon — requires a payment provider to be
                      configured for this marketplace. We&apos;ll announce it
                      on the support page when it&apos;s live.
                    </span>
                  </span>
                </label>
              </RadioGroup>
            </section>
          </div>

          {/* Summary */}
          <aside className="h-fit space-y-4 lg:sticky lg:top-24">
            <div className="rounded-2xl border border-border/70 bg-card p-6">
              <h2 className="text-sm font-bold tracking-tight">Order summary</h2>
              <dl className="mt-4 space-y-2.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Items</dt>
                  <dd className="font-medium">
                    {formatPrice(itemsSubtotalCents)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">
                    Seller fulfillment fees
                  </dt>
                  <dd className="font-medium">
                    {shippingFeeCents === 0
                      ? "Free"
                      : formatPrice(shippingFeeCents)}
                  </dd>
                </div>
                <div className="flex justify-between border-t border-border/70 pt-2.5 text-base">
                  <dt className="font-semibold">Total</dt>
                  <dd className="font-bold">{formatPrice(totalCents)}</dd>
                </div>
              </dl>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                Fees above are set by sellers, not the platform. No payment
                processing fee is charged today because payment happens on
                delivery.
              </p>

              {hasBlockingIssue && (
                <Alert variant="destructive" className="mt-4">
                  <AlertTriangle className="size-4" />
                  <AlertTitle>Cart needs attention</AlertTitle>
                  <AlertDescription>
                    Remove unavailable items to continue.
                  </AlertDescription>
                </Alert>
              )}

              <Button
                type="submit"
                size="lg"
                className="mt-5 w-full"
                disabled={
                  submitting ||
                  hasBlockingIssue ||
                  liveProducts === undefined ||
                  missingChoices.length > 0
                }
              >
                {submitting
                  ? "Placing order…"
                  : `Place order · ${formatPrice(totalCents)}`}
              </Button>

              <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" />
                Every seller and buyer is email-verified. Inventory is reserved
                the moment your order is placed.
              </p>
            </div>

            <div className="rounded-2xl border border-border/70 bg-card p-5 text-xs leading-5 text-muted-foreground">
              <p className="font-semibold text-foreground">Need help?</p>
              <p className="mt-1">
                You can cancel any order while its status is still “awaiting
                dispatch”. For anything else, open a ticket on the{" "}
                <Link to="/support" className="text-primary hover:underline">
                  support page
                </Link>
                .
              </p>
            </div>
          </aside>
        </form>
      </div>
    </Layout>
  );
}
