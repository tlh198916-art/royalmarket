import { EmptyState } from "@/components/marketplace/EmptyState";
import { Layout } from "@/components/marketplace/Layout";
import { OrderMessages } from "@/components/marketplace/OrderMessages";
import { ProductMedia } from "@/components/marketplace/ProductMedia";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import { formatDate, formatPrice } from "@/lib/format";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  CheckCircle2,
  Handshake,
  Package,
  ScrollText,
  Star,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";

const statusMeta: Record<string, { label: string; className: string }> = {
  placed: { label: "Awaiting dispatch", className: "text-primary border-primary/40" },
  shipped: { label: "Shipped", className: "text-amber-400 border-amber-400/40" },
  delivered: {
    label: "Delivered",
    className: "text-emerald-400 border-emerald-400/40",
  },
  cancelled: {
    label: "Cancelled",
    className: "text-muted-foreground border-border",
  },
};

const timeline = ["placed", "shipped", "delivered"] as const;

export default function Orders() {
  const orders = useQuery(api.orders.myOrders);
  const cancelOrder = useAction(api.stripe.cancelOrder);
  const [searchParams] = useSearchParams();
  const placedId = searchParams.get("placed");

  const handleCancel = async (orderId: string) => {
    if (!window.confirm("Cancel this order? Inventory returns to the seller."))
      return;
    try {
      await cancelOrder({ orderId: orderId as never });
      toast.success("Order cancelled.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not cancel the order.",
      );
    }
  };

  const approveDeal = useMutation(api.orders.approveFulfillment);
  const proposeDeal = useMutation(api.orders.setFulfillment);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editMethod, setEditMethod] = useState<
    "meetup" | "shipping" | "delivery"
  >("meetup");
  const [editNote, setEditNote] = useState("");
  const [savingDeal, setSavingDeal] = useState(false);

  const handleApprove = async (orderId: string, sellerId: string) => {
    try {
      await approveDeal({
        orderId: orderId as never,
        sellerId: sellerId as never,
      });
      toast.success("You approved the arrangement.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not approve.",
      );
    }
  };

  const handlePropose = async (orderId: string, sellerId: string) => {
    if (!editKey) return;
    setSavingDeal(true);
    try {
      await proposeDeal({
        orderId: orderId as never,
        sellerId: sellerId as never,
        method: editMethod,
        note: editNote.trim() || undefined,
      });
      setEditKey(null);
      toast.success(
        "Proposal saved — the other party must approve the new terms.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save the proposal.",
      );
    } finally {
      setSavingDeal(false);
    }
  };

  return (
    <Layout>
      <div className="page-container py-8 sm:py-12">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Your account</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
            Order history
          </h1>
        </div>

        {placedId && (
          <div className="mt-5 flex items-start gap-3 rounded-2xl border border-emerald-400/40 bg-emerald-400/10 px-4 py-3.5">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-400" />
            <div className="text-sm">
              <p className="font-semibold">Order placed successfully</p>
              <p className="text-muted-foreground">
                Pay on delivery — agree on meet-up or shipping with the seller
                below. Both of you approve the deal before handoff.
              </p>
            </div>
          </div>
        )}

        <div className="mt-6">
          {orders === undefined ? (
            <div className="flex justify-center py-16">
              <div className="size-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : orders.length === 0 ? (
            <EmptyState
              icon={ScrollText}
              title="No orders yet"
              description="When you place an order, it shows up here with live fulfilment status — from awaiting dispatch to delivered."
              action={
                <Button asChild>
                  <Link to="/products">Browse products</Link>
                </Button>
              }
            />
          ) : (
            <div className="space-y-5">
              {orders.map((order) => {
                const meta = statusMeta[order.status] ?? statusMeta.placed;
                const currentIndex = timeline.indexOf(
                  order.status as (typeof timeline)[number],
                );
                return (
                  <div
                    key={order._id}
                    className="rounded-2xl border border-border/70 bg-card p-5 sm:p-6"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">
                          Order placed {formatDate(order.placedAt ?? order._creationTime)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {order.items.length}{" "}
                          {order.items.length === 1 ? "item" : "items"} ·{" "}
                          {order.paymentMethod === "cod"
                            ? "Pay on delivery"
                            : order.paymentStatus === "paid"
                              ? "Paid by card via Stripe"
                              : "Card · payment not confirmed yet"}
                          {(order.shippingFeeCents ?? 0) > 0
                            ? ` · items ${formatPrice(order.subtotalCents)} + seller fees ${formatPrice(order.shippingFeeCents ?? 0)}`
                            : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={meta.className}>
                          {meta.label}
                        </Badge>
                        {order.paymentMethod === "card" && (
                          <Badge
                            variant="outline"
                            className={
                              order.paymentStatus === "paid"
                                ? "border-emerald-400/40 text-emerald-400"
                                : order.paymentStatus === "failed"
                                  ? "border-destructive/40 text-destructive"
                                  : order.paymentStatus === "refunded"
                                    ? "text-muted-foreground"
                                    : "border-amber-400/40 text-amber-400"
                            }
                          >
                            {order.paymentStatus === "paid"
                              ? "Paid by card"
                              : order.paymentStatus === "failed"
                                ? "Card payment failed"
                                : order.paymentStatus === "refunded"
                                  ? "Refunded to card"
                                  : order.paymentStatus === "partially_refunded"
                                    ? "Partially refunded"
                                    : order.paymentStatus === "processing"
                                      ? "Confirming with Stripe"
                                      : "Awaiting Stripe confirmation"}
                          </Badge>
                        )}
                        <span className="text-base font-bold">
                          {formatPrice(order.totalCents)}
                        </span>
                      </div>
                    </div>

                    {/* Progress timeline */}
                    {order.status !== "cancelled" && (
                      <div className="mt-5 flex items-center gap-2">
                        {timeline.map((stage, index) => (
                          <div key={stage} className="flex flex-1 items-center gap-2">
                            <span
                              className={`flex size-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold ${
                                index <= currentIndex
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-border text-muted-foreground"
                              }`}
                            >
                              {index < currentIndex ? "✓" : index + 1}
                            </span>
                            <span
                              className={`hidden text-xs capitalize sm:block ${
                                index <= currentIndex
                                  ? "text-foreground"
                                  : "text-muted-foreground"
                              }`}
                            >
                              {stage}
                            </span>
                            {index < timeline.length - 1 && (
                              <span
                                className={`h-px flex-1 ${
                                  index < currentIndex
                                    ? "bg-primary"
                                    : "bg-border"
                                }`}
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="mt-5 space-y-3">
                      {order.items.map((item) => (
                        <div
                          key={item._id}
                          className="flex flex-wrap items-center gap-4 rounded-xl border border-border/70 bg-background/40 p-3.5"
                        >
                          <Link
                            to={`/products/${item.productId}`}
                            className="size-14 shrink-0 overflow-hidden rounded-lg border border-border/70 bg-secondary/40"
                          >
                            <ProductMedia
                              title={item.title}
                              className="text-lg"
                            />
                          </Link>
                          <div className="min-w-0 flex-1">
                            <Link
                              to={`/products/${item.productId}`}
                              className="truncate text-sm font-medium hover:text-primary"
                            >
                              {item.title}
                            </Link>
                            <p className="text-xs text-muted-foreground">
                              {item.quantity} × {formatPrice(item.priceCents)}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              variant="outline"
                              className={
                                statusMeta[item.status]?.className ??
                                "text-muted-foreground"
                              }
                            >
                              {statusMeta[item.status]?.label ?? item.status}
                            </Badge>
                            {item.paymentStatus === "paid" && (
                              <Badge
                                variant="outline"
                                className="border-emerald-400/40 text-emerald-400"
                              >
                                Paid on delivery
                              </Badge>
                            )}
                            {item.paymentStatus === "refunded" && (
                              <Badge variant="outline">Refunded</Badge>
                            )}
                            {item.status === "delivered" &&
                              (item.paymentStatus ?? "unpaid") === "unpaid" && (
                                <Badge
                                  variant="outline"
                                  className="border-amber-400/40 text-amber-400"
                                >
                                  Payment pending
                                </Badge>
                              )}
                            {item.status === "delivered" && (
                              <Button
                                asChild
                                size="sm"
                                variant="outline"
                                title="Leave a review on the product page"
                              >
                                <Link to={`/products/${item.productId}#reviews`}>
                                  <Star className="mr-1.5 size-3.5" /> Review
                                </Link>
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Fulfillment agreement — both parties approve the deal */}
                    <div className="mt-4 space-y-3 border-t border-border/70 pt-4">
                      {(order.fulfillments ?? []).length === 0 && (
                        <p className="text-xs leading-5 text-muted-foreground">
                          No fulfillment arrangement yet — coordinate a
                          meet-up or shipping with the seller; you both
                          approve it here before handoff.
                        </p>
                      )}
                      {(order.fulfillments ?? []).map((entry) => {
                        const dealKey = `${order._id}:${entry.sellerId}`;
                        const bothAgreed =
                          entry.buyerAgreed && entry.sellerAgreed;
                        return (
                          <div
                            key={dealKey}
                            className="rounded-xl border border-border/70 bg-background/40 p-3.5"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="flex items-center gap-1.5 text-sm font-semibold">
                                <Handshake className="size-4 text-primary" />
                                {entry.method === "meetup"
                                  ? "Local pickup"
                                  : entry.method === "delivery"
                                    ? "Local delivery"
                                    : "Shipping"}
                                <span className="font-normal text-muted-foreground">
                                  ·{" "}
                                  {order.sellerNames?.[entry.sellerId] ??
                                    "Seller"}
                                  {(entry.feeCents ?? 0) > 0
                                    ? ` · ${formatPrice(entry.feeCents ?? 0)} (seller-set fee)`
                                    : " · Free"}
                                </span>
                              </p>
                              {bothAgreed ? (
                                <Badge
                                  variant="outline"
                                  className="border-emerald-400/40 text-emerald-400"
                                >
                                  Deal agreed
                                </Badge>
                              ) : (
                                <Badge
                                  variant="outline"
                                  className="text-muted-foreground"
                                >
                                  Awaiting approvals
                                </Badge>
                              )}
                            </div>
                            {entry.note && (
                              <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                                {entry.note}
                              </p>
                            )}
                            {entry.trackingNumber && (
                              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                Tracking: {entry.trackingNumber}
                              </p>
                            )}
                            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                              <span
                                className={
                                  entry.buyerAgreed
                                    ? "font-medium text-emerald-400"
                                    : "text-muted-foreground"
                                }
                              >
                                Buyer{" "}
                                {entry.buyerAgreed
                                  ? "approved ✓"
                                  : "not approved yet"}
                              </span>
                              <span
                                className={
                                  entry.sellerAgreed
                                    ? "font-medium text-emerald-400"
                                    : "text-muted-foreground"
                                }
                              >
                                Seller{" "}
                                {entry.sellerAgreed
                                  ? "approved ✓"
                                  : "not approved yet"}
                              </span>
                            </div>
                            {order.status === "placed" && (
                              <div className="mt-3 flex flex-wrap items-center gap-2">
                                {!entry.buyerAgreed && (
                                  <Button
                                    size="sm"
                                    onClick={() =>
                                      void handleApprove(
                                        order._id,
                                        entry.sellerId,
                                      )
                                    }
                                  >
                                    Approve arrangement
                                  </Button>
                                )}
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    if (editKey === dealKey) {
                                      setEditKey(null);
                                    } else {
                                      setEditKey(dealKey);
                                      setEditMethod(entry.method);
                                      setEditNote(entry.note ?? "");
                                    }
                                  }}
                                >
                                  {editKey === dealKey ? "Close" : "Propose change"}
                                </Button>
                              </div>
                            )}
                            {editKey === dealKey && order.status === "placed" && (
                              <div className="mt-3 space-y-2.5 rounded-xl border border-border/70 bg-card p-3">
                                <div className="flex flex-wrap gap-2">
                                  <Button
                                    size="sm"
                                    variant={
                                      editMethod === "meetup"
                                        ? "default"
                                        : "outline"
                                    }
                                    onClick={() => setEditMethod("meetup")}
                                  >
                                    Local pickup
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant={
                                      editMethod === "shipping"
                                        ? "default"
                                        : "outline"
                                    }
                                    onClick={() => setEditMethod("shipping")}
                                  >
                                    Shipping
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant={
                                      editMethod === "delivery"
                                        ? "default"
                                        : "outline"
                                    }
                                    onClick={() => setEditMethod("delivery")}
                                  >
                                    Local delivery
                                  </Button>
                                </div>
                                <Textarea
                                  rows={2}
                                  maxLength={500}
                                  value={editNote}
                                  onChange={(event) =>
                                    setEditNote(event.target.value)
                                  }
                                  placeholder="Details — meeting spot, or shipping terms you both agree to"
                                />
                                <div className="flex items-center justify-between gap-3">
                                  <p className="text-[11px] leading-4 text-muted-foreground">
                                    Saving resets their approval — you both
                                    approve the new terms.
                                  </p>
                                  <Button
                                    size="sm"
                                    disabled={savingDeal}
                                    onClick={() =>
                                      void handlePropose(
                                        order._id,
                                        entry.sellerId,
                                      )
                                    }
                                  >
                                    {savingDeal ? "Saving…" : "Send proposal"}
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      <div className="flex justify-end">
                        {order.status === "placed" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void handleCancel(order._id)}
                          >
                            <XCircle className="mr-1.5 size-3.5" /> Cancel order
                          </Button>
                        )}
                      </div>

                      <OrderMessages orderId={order._id} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {orders && orders.length > 0 && (
            <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <Package className="size-3.5" /> Orders stay here for your
              records — questions? Open a support ticket.
            </p>
          )}
        </div>
      </div>
    </Layout>
  );
}
