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
  Package,
  ShieldCheck,
  ShoppingCart,
  Truck,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

export default function Checkout() {
  const { lines, setQuantity, remove, clear } = useCart();
  const liveProducts = useQuery(api.products.getByIds, {
    ids: lines.map((line) => line.productId),
  });
  const placeOrder = useMutation(api.orders.place);
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [method, setMethod] = useState<"meetup" | "shipping">("meetup");

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
    };
  });

  const blockingIssues = rows.filter(
    (row) => row.issue !== null && (row.quantity === 0 || row.live === null),
  );
  const hasBlockingIssue = blockingIssues.length > 0;

  const { itemsSubtotalCents, totalCents } = useMemo(() => {
    let itemsTotal = 0;
    for (const row of rows) {
      if (!row.live || row.quantity === 0) continue;
      itemsTotal += row.effectivePriceCents * row.quantity;
    }
    // Shipping is arranged directly between buyer and seller — no platform
    // fees, and no address collected up front.
    return {
      itemsSubtotalCents: itemsTotal,
      totalCents: itemsTotal,
    };
  }, [rows]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (hasBlockingIssue) {
      toast.error("Resolve the highlighted cart issues first.");
      return;
    }
    const formData = new FormData(event.currentTarget);
    setSubmitting(true);
    try {
      const orderId = await placeOrder({
        items: rows
          .filter((row) => row.live && row.quantity > 0)
          .map((row) => ({
            productId: row.line.productId as Id<"products">,
            quantity: row.quantity,
          })),
        method,
        note: String(formData.get("fulfillmentNote") ?? "") || undefined,
        paymentMethod: "cod",
      });
      clear();
      toast.success("Order placed!", {
        description:
          "Agree on meet-up or shipping with your seller — both of you approve the deal from your orders page.",
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
                          {formatPrice(row.effectivePriceCents)} each
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

            {/* Fulfillment arrangement */}
            <section className="rounded-2xl border border-border/70 bg-card p-6">
              <h2 className="text-sm font-bold tracking-tight">
                How will you get it?
              </h2>
              <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                No shipping fees are charged here. You and the seller agree on
                the details yourselves — meet up or arrange shipping — and
                both approve the deal from your orders page before handoff.
              </p>
              <RadioGroup
                value={method}
                onValueChange={(value) =>
                  setMethod(value === "shipping" ? "shipping" : "meetup")
                }
                className="mt-4 space-y-3"
              >
                <label
                  htmlFor="method-meetup"
                  className="flex cursor-pointer items-start gap-3 rounded-xl border border-primary/50 bg-primary/5 p-4"
                >
                  <RadioGroupItem
                    id="method-meetup"
                    value="meetup"
                    className="mt-0.5"
                  />
                  <span className="flex-1">
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      <Handshake className="size-4 text-primary" /> Meet up
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                      Coordinate a public meet-up or local pickup directly with
                      the seller.
                    </span>
                  </span>
                </label>
                <label
                  htmlFor="method-shipping"
                  className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/70 p-4 transition-colors hover:border-primary/50"
                >
                  <RadioGroupItem
                    id="method-shipping"
                    value="shipping"
                    className="mt-0.5"
                  />
                  <span className="flex-1">
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      <Package className="size-4" /> Shipping — arranged
                      directly
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                      You and the seller agree on carrier, cost, and timing
                      between yourselves — the platform adds no shipping
                      charges.
                    </span>
                  </span>
                </label>
              </RadioGroup>
              <div className="mt-4 space-y-1.5">
                <Label htmlFor="fulfillmentNote">
                  Your suggested arrangement (optional)
                </Label>
                <Textarea
                  id="fulfillmentNote"
                  name="fulfillmentNote"
                  rows={3}
                  maxLength={500}
                  placeholder={
                    method === "meetup"
                      ? "e.g. Meet Saturday at the central library, daytime"
                      : "e.g. Happy to ship — we'll confirm courier and cost together"
                  }
                />
                <p className="text-xs text-muted-foreground">
                  The seller can reply with a counter-proposal. Both of you
                  approve the final deal on the order page.
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
                      Hand payment to the seller when you receive the item.
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
                  <dt className="text-muted-foreground">Subtotal</dt>
                  <dd className="font-medium">
                    {formatPrice(itemsSubtotalCents)}
                  </dd>
                </div>
                <div className="flex justify-between border-t border-border/70 pt-2.5 text-base">
                  <dt className="font-semibold">Total</dt>
                  <dd className="font-bold">{formatPrice(totalCents)}</dd>
                </div>
              </dl>

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
                disabled={submitting || hasBlockingIssue || liveProducts === undefined}
              >
                {submitting ? "Placing order…" : `Place order · ${formatPrice(totalCents)}`}
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
