import { EmptyState } from "@/components/marketplace/EmptyState";
import {
  FulfillmentEditor,
  type FulfillmentSettings,
} from "@/components/marketplace/FulfillmentEditor";
import { Layout } from "@/components/marketplace/Layout";
import { OrderMessages } from "@/components/marketplace/OrderMessages";
import { ProductMedia } from "@/components/marketplace/ProductMedia";
import { SellerOnboardingChecklist } from "@/components/marketplace/SellerOnboardingChecklist";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import { bpsToPercent } from "@/convex/plans";
import { useAuth } from "@/hooks/use-auth";
import { formatDate, formatPrice, initials } from "@/lib/format";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  BadgeCheck,
  Banknote,
  CheckCircle2,
  Copy,
  Eye,
  Gift,
  Handshake,
  Package,
  PackageCheck,
  Pencil,
  Plus,
  Rocket,
  Store,
  Tag,
  Truck,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";

type StatusFilter = "all" | "active" | "draft" | "sold" | "removed";

const statusBadge: Record<string, { label: string; className: string }> = {
  active: { label: "Live", className: "text-emerald-400 border-emerald-400/40" },
  draft: { label: "Draft", className: "text-muted-foreground" },
  removed: {
    label: "Taken down",
    className: "text-destructive border-destructive/40",
  },
  sold: {
    label: "Sold out",
    className: "text-amber-400 border-amber-400/40",
  },
};

const orderStatusLabel: Record<string, string> = {
  placed: "Awaiting dispatch",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

const paymentStatusLabel: Record<string, string> = {
  unpaid: "Payment pending",
  paid: "Paid",
  refunded: "Refunded",
  failed: "Payment failed",
};

const connectLabel: Record<string, string> = {
  not_connected: "Not connected",
  pending: "Onboarding incomplete",
  restricted: "Restricted",
  enabled: "Payouts enabled",
};

const payoutStatusLabel: Record<string, string> = {
  pending: "Pending",
  in_transit: "In transit",
  paid: "Paid",
  reversed: "Reversed",
  failed: "Failed",
};

export default function SellerDashboard() {
  const { user, isLoading: authLoading } = useAuth();
  const listings = useQuery(api.products.myListings);
  const sellerOrders = useQuery(api.orders.sellerOrders);
  const setStatus = useMutation(api.products.setStatus);
  const removeListing = useMutation(api.products.remove);
  const updateItemStatus = useMutation(api.orders.updateItemStatus);
  const updateProfile = useMutation(api.sellers.updateProfile);

  const [filter, setFilter] = useState<StatusFilter>("all");
  const [activeTab, setActiveTab] = useState("listings");
  const [profileSaving, setProfileSaving] = useState(false);

  const stats = useMemo(() => {
    if (!listings) return null;
    const active = listings.filter((p) => p.status === "active");
    const pendingItems = (sellerOrders ?? []).flatMap((order) =>
      order.items.filter((item) => item.status === "placed"),
    );
    const deliveredUnits = (sellerOrders ?? []).reduce(
      (sum, order) =>
        sum +
        order.items.filter((item) => item.status === "delivered").length,
      0,
    );
    return {
      live: active.length,
      drafts: listings.filter((p) => p.status === "draft").length,
      takenDown: listings.filter((p) => p.status === "removed").length,
      views: listings.reduce((sum, p) => sum + (p.views ?? 0), 0),
      soldUnits: listings.reduce((sum, p) => sum + (p.soldCount ?? 0), 0),
      deliveredUnits,
      openOrders: (sellerOrders ?? []).filter(
        (o) => o.status === "placed" || o.status === "shipped",
      ).length,
      pendingOrders: pendingItems.length,
    };
  }, [listings, sellerOrders]);

  const filteredListings = (listings ?? []).filter((product) => {
    if (filter === "all") return true;
    if (filter === "sold")
      return product.status === "active" && product.quantity === 0;
    return product.status === filter;
  });

  const handleToggleStatus = async (id: string, next: "draft" | "active") => {
    try {
      await setStatus({ id: id as never, status: next });
      toast.success(next === "active" ? "Listing is live." : "Listing paused.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update listing.",
      );
    }
  };

  const handleDelete = async (id: string, title: string) => {
    if (!window.confirm(`Delete "${title}"? This cannot be undone.`)) return;
    try {
      await removeListing({ id: id as never });
      toast.success("Listing deleted.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not delete listing.",
      );
    }
  };

  const handleCollectPayment = async (itemId: string) => {
    try {
      await recordPayment({ itemId: itemId as never });
      toast.success("Cash payment recorded for this item.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not record the payment.",
      );
    }
  };

  const handleItemAction = async (
    itemId: string,
    status: "shipped" | "delivered" | "cancelled",
  ) => {
    try {
      await updateItemStatus({ itemId: itemId as never, status });
      toast.success(`Order item marked ${status}.`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update order.",
      );
    }
  };

  const mySub = useQuery(api.subscriptions.mine);
  const myLedger = useQuery(api.commissions.myLedger);
  const earnings = useQuery(api.payments.sellerEarnings);
  const recordPayment = useMutation(api.payments.recordCodCollected);
  const createConnectLink = useAction(api.stripe.createConnectLink);
  const syncConnectAccount = useAction(api.stripe.syncConnectAccount);
  const [searchParams, setSearchParams] = useSearchParams();
  const [connectBusy, setConnectBusy] = useState(false);
  const stripeParam = searchParams.get("stripe");

  // Stripe sends the seller back here after Express onboarding. Refresh the
  // account state from Stripe, then remove the one-time query parameter.
  useEffect(() => {
    if (stripeParam !== "return" && stripeParam !== "refresh") return;
    let active = true;
    const refresh = async () => {
      setConnectBusy(true);
      try {
        const account = await syncConnectAccount();
        if (!active) return;
        if (account.payoutsEnabled) {
          toast.success("Stripe payouts are enabled for your shop.");
        } else if (account.currentlyDue.length > 0) {
          toast.info("Stripe needs a little more information to enable payouts.");
        } else {
          toast.info("Stripe is still reviewing your account.");
        }
      } catch (error) {
        if (!active) return;
        toast.error(
          error instanceof Error
            ? error.message
            : "Could not refresh your Stripe account.",
        );
      } finally {
        if (active) {
          setConnectBusy(false);
          // Drop the one-time parameter only after the sync completes, so the
          // effect is not torn down while its promise is still in flight.
          const next = new URLSearchParams(window.location.search);
          next.delete("stripe");
          setSearchParams(next, { replace: true });
        }
      }
    };
    void refresh();
    return () => {
      active = false;
    };
  }, [stripeParam, setSearchParams, syncConnectAccount]);

  const handleConnectStripe = async () => {
    setConnectBusy(true);
    try {
      const { url } = await createConnectLink();
      window.location.assign(url);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not start Stripe onboarding.",
      );
      setConnectBusy(false);
    }
  };
  const myReferrals = useQuery(api.referrals.myReferrals);
  const ensureReferralCode = useMutation(api.referrals.ensureCode);
  const [creatingCode, setCreatingCode] = useState(false);
  const saveFulfillmentDefaults = useMutation(api.sellers.setFulfillmentDefaults);
  const [fulfillmentDefaults, setFulfillmentDefaults] =
    useState<FulfillmentSettings | null>(null);
  const [savingDefaults, setSavingDefaults] = useState(false);

  const approveDeal = useMutation(api.orders.approveFulfillment);
  const proposeDeal = useMutation(api.orders.setFulfillment);
  const [dealEditOrderId, setDealEditOrderId] = useState<string | null>(null);
  const [dealEditMethod, setDealEditMethod] = useState<
    "meetup" | "shipping" | "delivery"
  >(
    "meetup",
  );
  const [dealEditNote, setDealEditNote] = useState("");
  const [savingDeal, setSavingDeal] = useState(false);

  const handleApproveDeal = async (orderId: string) => {
    if (!user) return;
    try {
      await approveDeal({ orderId: orderId as never, sellerId: user._id });
      toast.success("You approved the arrangement.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not approve.",
      );
    }
  };

  const handleProposeDeal = async (orderId: string) => {
    if (!user) return;
    setSavingDeal(true);
    try {
      await proposeDeal({
        orderId: orderId as never,
        sellerId: user._id,
        method: dealEditMethod,
        note: dealEditNote.trim() || undefined,
      });
      setDealEditOrderId(null);
      toast.success("Proposal saved — the buyer must approve the new terms.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save the proposal.",
      );
    } finally {
      setSavingDeal(false);
    }
  };

  const setTracking = useMutation(api.orders.setTracking);
  const handleTracking = async (orderId: string, trackingNumber: string) => {
    try {
      await setTracking({ orderId: orderId as never, trackingNumber });
      toast.success(
        trackingNumber.trim()
          ? "Tracking number saved."
          : "Tracking number removed.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save tracking.",
      );
    }
  };

  const handleDefaultsSave = async () => {
    if (!fulfillmentDefaults) return;
    setSavingDefaults(true);
    try {
      await saveFulfillmentDefaults({ defaults: fulfillmentDefaults });
      toast.success(
        "Fulfillment defaults saved — new listings start with these options.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not save fulfillment settings.",
      );
    } finally {
      setSavingDefaults(false);
    }
  };

  const handleProfileSave = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setProfileSaving(true);
    try {
      await updateProfile({
        shopName: String(formData.get("shopName") ?? ""),
        bio: String(formData.get("bio") ?? ""),
        location: String(formData.get("location") ?? ""),
      });
      toast.success("Shop profile updated.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save profile.",
      );
    } finally {
      setProfileSaving(false);
    }
  };

  const handleCreateCode = async () => {
    setCreatingCode(true);
    try {
      await ensureReferralCode({});
      toast.success("Your invite code is ready to share.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not create a code.",
      );
    } finally {
      setCreatingCode(false);
    }
  };

  const referralLink =
    myReferrals?.code && typeof window !== "undefined"
      ? `${window.location.origin}/sell?ref=${myReferrals.code}`
      : null;

  const handleCopyReferral = async () => {
    if (!referralLink) return;
    try {
      await navigator.clipboard.writeText(referralLink);
      toast.success("Invite link copied.");
    } catch {
      toast.error("Copy failed — select the link and copy it manually.");
    }
  };

  if (authLoading || listings === undefined) {
    return (
      <Layout>
        <div className="flex justify-center py-24">
          <div className="size-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      </Layout>
    );
  }

  if (!user?.isSeller) {
    return (
      <Layout>
        <div className="page-container py-16">
          <EmptyState
            icon={Store}
            title="Set up your seller profile"
            description="Name your shop first — then you can publish listings, track orders, and appear on public seller pages."
            action={
              <Button asChild>
                <Link to="/sell/new">
                  <Rocket className="mr-2 size-4" /> Set up &amp; list
                </Link>
              </Button>
            }
            secondaryAction={
              <Button asChild variant="outline">
                <Link to="/sell">See how selling works</Link>
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
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-muted-foreground">
              Seller dashboard
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
              {user.shopName ?? "Your shop"}
            </h1>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link to={`/sellers/${user._id}`}>
                <Eye className="mr-2 size-4" /> View public shop
              </Link>
            </Button>
            <Button asChild>
              <Link to="/sell/new">
                <Plus className="mr-2 size-4" /> New listing
              </Link>
            </Button>
          </div>
        </div>

        {stats && (
          <SellerOnboardingChecklist
            items={[
              {
                id: "registered",
                title: "Seller account created",
                description: `Free individual account for ${user.email ?? "your verified email"}.`,
                complete: !!user.isSeller && !!user.emailVerificationTime,
                icon: BadgeCheck,
                to: "/dashboard",
                actionLabel: "Check account verification",
              },
              {
                id: "profile",
                title: "Complete your shop profile",
                description:
                  "Add a bio and location so buyers know who they are buying from.",
                complete: !!user.shopName && !!user.sellerBio && !!user.location,
                icon: Store,
                onClick: () => setActiveTab("profile"),
                actionLabel: "Edit shop profile",
              },
              {
                id: "listing",
                title: "Create your first listing",
                description:
                  stats.drafts > 0 && stats.live === 0
                    ? "You have a draft ready. Publish it when the details are right."
                    : "Add photos, a clear description, price, and stock.",
                complete: stats.live > 0 || stats.drafts > 0,
                icon: Tag,
                to: "/sell/new",
                actionLabel: "Create a listing",
              },
              {
                id: "sale",
                title: "Complete your first sale",
                description:
                  stats.deliveredUnits > 0
                    ? `${stats.deliveredUnits} delivered item${stats.deliveredUnits === 1 ? "" : "s"} recorded.`
                    : "Share your public shop, respond to buyers, and mark orders delivered.",
                complete: stats.deliveredUnits > 0,
                icon: PackageCheck,
                to: `/sellers/${user._id}`,
                actionLabel: "View and share your shop",
              },
            ]}
          />
        )}

        {stats && (
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              { label: "Live listings", value: stats.live, icon: Tag },
              { label: "Drafts", value: stats.drafts, icon: Pencil },
              { label: "Listing views", value: stats.views, icon: Eye },
              { label: "Units sold", value: stats.soldUnits, icon: PackageCheck },
              { label: "Open orders", value: stats.openOrders, icon: Truck },
              { label: "Taken down", value: stats.takenDown, icon: AlertTriangle },
            ].map((stat) => (
              <div
                key={stat.label}
                className="rounded-2xl border border-border/70 bg-card p-4"
              >
                <stat.icon className="size-4 text-primary" />
                <p className="mt-2 text-xl font-bold tracking-tight">
                  {stat.value}
                </p>
                <p className="text-[11px] text-muted-foreground">{stat.label}</p>
              </div>
            ))}
          </div>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-8">
          {/* Six tabs overflow a phone-width screen, so the strip scrolls
              horizontally there instead of pushing the page wide. */}
          <div className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
            <TabsList className="w-max">
              <TabsTrigger value="listings">Listings</TabsTrigger>
              <TabsTrigger value="orders">
                Orders
                {stats && stats.openOrders > 0 && (
                  <span className="ml-1.5 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">
                    {stats.openOrders}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="profile">Shop profile</TabsTrigger>
              <TabsTrigger value="fulfillment">Fulfillment</TabsTrigger>
              <TabsTrigger value="plan">
                Plan &amp; earnings
                {mySub?.status === "pending" && (
                  <span className="ml-1.5 size-1.5 rounded-full bg-amber-400" />
                )}
              </TabsTrigger>
              <TabsTrigger value="referrals">Refer sellers</TabsTrigger>
            </TabsList>
          </div>

          {/* Listings */}
          <TabsContent value="listings" className="mt-5">
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
              {(
                [
                  ["all", "All"],
                  ["active", "Live"],
                  ["draft", "Drafts"],
                  ["sold", "Sold out"],
                  ["removed", "Taken down"],
                ] as [StatusFilter, string][]
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
                    filter === value
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border/80 bg-card text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="mt-5 space-y-3">
              {filteredListings.length === 0 ? (
                <EmptyState
                  icon={Package}
                  title={
                    filter === "all"
                      ? "You haven't listed anything yet"
                      : "No listings in this state"
                  }
                  description={
                    filter === "all"
                      ? "Create your first listing — it's free and publishes instantly."
                      : "Switch filters to see your other listings."
                  }
                  action={
                    filter === "all" ? (
                      <Button asChild>
                        <Link to="/sell/new">
                          <Plus className="mr-2 size-4" /> Create listing
                        </Link>
                      </Button>
                    ) : undefined
                  }
                  compact
                />
              ) : (
                filteredListings.map((product) => {
                  const state =
                    product.status === "active" && product.quantity === 0
                      ? "sold"
                      : product.status;
                  const badge = statusBadge[state] ?? statusBadge.draft;
                  return (
                    <div
                      key={product._id}
                      className="flex flex-col gap-4 rounded-2xl border border-border/70 bg-card p-4 sm:flex-row sm:items-center"
                    >
                      <Link
                        to={`/products/${product._id}`}
                        className="size-20 shrink-0 overflow-hidden rounded-xl border border-border/70 bg-secondary/40"
                      >
                        <ProductMedia
                          imageUrl={product.imageUrl}
                          categoryId={product.categoryId}
                          title={product.title}
                        />
                      </Link>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            to={`/products/${product._id}`}
                            className="truncate text-sm font-semibold hover:text-primary"
                          >
                            {product.title}
                          </Link>
                          <Badge
                            variant="outline"
                            className={`text-[10px] font-semibold ${badge.className}`}
                          >
                            {badge.label}
                          </Badge>
                          {product.status === "removed" && (
                            <Badge
                              variant="outline"
                              className="gap-1 border-amber-400/40 text-[10px] text-amber-400"
                            >
                              <AlertTriangle className="size-3" />
                              Moderator review — contact support for details
                            </Badge>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatPrice(product.priceCents)} · {product.quantity}{" "}
                          in stock · {product.views ?? 0} views ·{" "}
                          {product.soldCount ?? 0} sold
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button asChild size="sm" variant="outline">
                          <Link to={`/sell/new?edit=${product._id}`}>
                            <Pencil className="mr-1.5 size-3.5" /> Edit
                          </Link>
                        </Button>
                        {product.status !== "removed" && (
                          <Button
                            size="sm"
                            variant={
                              product.status === "active" ? "ghost" : "secondary"
                            }
                            onClick={() =>
                              void handleToggleStatus(
                                product._id,
                                product.status === "active" ? "draft" : "active",
                              )
                            }
                          >
                            {product.status === "active" ? "Unpublish" : "Publish"}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() =>
                            void handleDelete(product._id, product.title)
                          }
                        >
                          <XCircle className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </TabsContent>

          {/* Orders */}
          <TabsContent value="orders" className="mt-5">
            {sellerOrders === undefined ? (
              <div className="flex justify-center py-10">
                <div className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) : sellerOrders.length === 0 ? (
              <EmptyState
                icon={Truck}
                title="No orders yet"
                description="When a buyer orders one of your listings, it appears here so you can agree on meet-up or shipping with them, then dispatch it."
                action={
                  <Button asChild variant="outline">
                    <Link to={`/sellers/${user._id}`}>
                      View your public shop
                    </Link>
                  </Button>
                }
                compact
              />
            ) : (
              <div className="space-y-4">
                {sellerOrders.map((order) => {
                  const deal = order.fulfillments?.find(
                    (f) => f.sellerId === user?._id,
                  );
                  return (
                  <div
                    key={order._id}
                    className="rounded-2xl border border-border/70 bg-card p-5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">{order.buyerName}</p>
                        <p className="text-xs text-muted-foreground">
                          Ordered {formatDate(order.createdAt)} ·{" "}
                          {deal
                            ? deal.method === "meetup"
                              ? "Meet up"
                              : "Shipping — arranged directly"
                            : "No arrangement yet"}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={
                          order.status === "cancelled"
                            ? "border-destructive/40 text-destructive"
                            : order.status === "delivered"
                              ? "border-emerald-400/40 text-emerald-400"
                              : "border-primary/40 text-primary"
                        }
                      >
                        {orderStatusLabel[order.status] ?? order.status}
                      </Badge>
                    </div>

                    <div className="mt-4 space-y-3">
                      {order.items.map((item) => (
                        <div
                          key={item._id}
                          className="flex flex-wrap items-center gap-3 rounded-xl border border-border/70 bg-background/40 p-3.5"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">
                              {item.title}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {item.quantity} × {formatPrice(item.priceCents)} ·{" "}
                              {orderStatusLabel[item.status] ?? item.status} ·{" "}
                              {paymentStatusLabel[item.paymentStatus ?? "unpaid"]}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            {item.status === "delivered" &&
                              (item.paymentStatus ?? "unpaid") === "unpaid" &&
                              order.paymentMethod === "cod" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    void handleCollectPayment(item._id)
                                  }
                                >
                                  <Banknote className="mr-1.5 size-3.5" /> Cash
                                  collected
                                </Button>
                              )}
                            {item.paymentStatus === "paid" && (
                              <Badge
                                variant="outline"
                                className="border-emerald-400/40 text-emerald-400"
                              >
                                Paid
                              </Badge>
                            )}
                            {item.paymentStatus === "refunded" && (
                              <Badge variant="outline">Refunded</Badge>
                            )}
                            {item.status === "placed" && (
                              <>
                                <Button
                                  size="sm"
                                  onClick={() =>
                                    void handleItemAction(item._id, "shipped")
                                  }
                                >
                                  <Truck className="mr-1.5 size-3.5" /> Mark
                                  shipped
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    void handleItemAction(item._id, "cancelled")
                                  }
                                >
                                  Cancel
                                </Button>
                              </>
                            )}
                            {item.status === "shipped" && (
                              <>
                                <Button
                                  size="sm"
                                  onClick={() =>
                                    void handleItemAction(item._id, "delivered")
                                  }
                                >
                                  <CheckCircle2 className="mr-1.5 size-3.5" /> Mark
                                  delivered
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    void handleItemAction(item._id, "cancelled")
                                  }
                                >
                                  Cancel
                                </Button>
                              </>
                            )}
                            {(item.status === "delivered" ||
                              item.status === "cancelled") && (
                              <Badge variant="secondary" className="text-xs">
                                {item.status === "delivered"
                                  ? "Completed"
                                  : "Cancelled"}
                              </Badge>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-4 rounded-xl border border-border/70 bg-background/40 p-3.5 text-xs leading-5">
                      {deal ? (
                        <>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="flex items-center gap-1.5 text-sm font-semibold">
                              <Handshake className="size-4 text-primary" />
                              {deal.method === "meetup"
                                ? "Local pickup"
                                : deal.method === "delivery"
                                  ? "Local delivery"
                                  : "Shipping"}
                              <span className="font-normal text-muted-foreground">
                                ·{" "}
                                {(deal.feeCents ?? 0) > 0
                                  ? `${formatPrice(deal.feeCents ?? 0)} (your fee)`
                                  : "Free"}
                              </span>
                            </p>
                            {deal.buyerAgreed && deal.sellerAgreed ? (
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
                          {deal.note && (
                            <p className="mt-1.5 text-muted-foreground">
                              {deal.note}
                            </p>
                          )}
                          {deal.trackingNumber && (
                            <p className="mt-1 text-muted-foreground">
                              Tracking: {deal.trackingNumber}
                            </p>
                          )}
                          {deal.method === "shipping" &&
                            order.status !== "cancelled" && (
                              <form
                                className="mt-2 flex flex-wrap items-center gap-2"
                                onSubmit={(event) => {
                                  event.preventDefault();
                                  const input = new FormData(
                                    event.currentTarget,
                                  ).get("tracking");
                                  void handleTracking(
                                    order._id,
                                    String(input ?? ""),
                                  );
                                }}
                              >
                                <Input
                                  name="tracking"
                                  defaultValue={deal.trackingNumber ?? ""}
                                  maxLength={80}
                                  placeholder="Tracking number (optional)"
                                  className="h-8 max-w-[240px] text-xs"
                                />
                                <Button size="sm" variant="outline">
                                  Save tracking
                                </Button>
                              </form>
                            )}
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                            <span
                              className={
                                deal.buyerAgreed
                                  ? "font-medium text-emerald-400"
                                  : "text-muted-foreground"
                              }
                            >
                              Buyer{" "}
                              {deal.buyerAgreed
                                ? "approved ✓"
                                : "not approved yet"}
                            </span>
                            <span
                              className={
                                deal.sellerAgreed
                                  ? "font-medium text-emerald-400"
                                  : "text-muted-foreground"
                              }
                            >
                              You{" "}
                              {deal.sellerAgreed
                                ? "approved ✓"
                                : "not approved yet"}
                            </span>
                          </div>
                        </>
                      ) : (
                        <p className="text-muted-foreground">
                          No arrangement yet — propose a meet-up or shipping
                          terms for the buyer to approve.
                        </p>
                      )}
                      {order.status === "placed" && (
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          {deal && !deal.sellerAgreed && (
                            <Button
                              size="sm"
                              onClick={() => void handleApproveDeal(order._id)}
                            >
                              Approve arrangement
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              if (dealEditOrderId === order._id) {
                                setDealEditOrderId(null);
                              } else {
                                setDealEditOrderId(order._id);
                                setDealEditMethod(deal?.method ?? "meetup");
                                setDealEditNote(deal?.note ?? "");
                              }
                            }}
                          >
                            {dealEditOrderId === order._id
                              ? "Close"
                              : deal
                                ? "Propose change"
                                : "Propose arrangement"}
                          </Button>
                        </div>
                      )}
                      {dealEditOrderId === order._id &&
                        order.status === "placed" && (
                          <div className="mt-3 space-y-2.5 rounded-xl border border-border/70 bg-card p-3">                              <div className="flex flex-wrap gap-2">
                                <Button
                                  size="sm"
                                  variant={
                                    dealEditMethod === "meetup"
                                      ? "default"
                                      : "outline"
                                  }
                                  onClick={() => setDealEditMethod("meetup")}
                                >
                                  Local pickup
                                </Button>
                                <Button
                                  size="sm"
                                  variant={
                                    dealEditMethod === "shipping"
                                      ? "default"
                                      : "outline"
                                  }
                                  onClick={() => setDealEditMethod("shipping")}
                                >
                                  Shipping
                                </Button>
                                <Button
                                  size="sm"
                                  variant={
                                    dealEditMethod === "delivery"
                                      ? "default"
                                      : "outline"
                                  }
                                  onClick={() => setDealEditMethod("delivery")}
                                >
                                  Local delivery
                                </Button>
                              </div>
                            <Textarea
                              rows={2}
                              maxLength={500}
                              value={dealEditNote}
                              onChange={(event) =>
                                setDealEditNote(event.target.value)
                              }
                              placeholder="Meeting spot, or shipping terms you both agree to"
                            />
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-[11px] text-muted-foreground">
                                Saving resets the buyer&apos;s approval — you
                                both approve the new terms.
                              </p>
                              <Button
                                size="sm"
                                disabled={savingDeal}
                                onClick={() =>
                                  void handleProposeDeal(order._id)
                                }
                              >
                                {savingDeal ? "Saving…" : "Send proposal"}
                              </Button>
                            </div>
                          </div>
                        )}
                    </div>
                    <OrderMessages orderId={order._id} />
                  </div>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* Profile */}
          <TabsContent value="profile" className="mt-5">
            <form
              onSubmit={handleProfileSave}
              className="max-w-xl space-y-4 rounded-2xl border border-border/70 bg-card p-6"
            >
              <div className="flex items-center gap-3">
                <span className="flex size-12 items-center justify-center rounded-2xl bg-secondary text-sm font-bold">
                  {initials(user.shopName ?? user.name)}
                </span>
                <div>
                  <p className="text-sm font-semibold">
                    {user.shopName ?? "Your shop"}
                  </p>
                  <p className="text-xs text-muted-foreground">{user.email}</p>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="shopName">Shop name</Label>
                <Input
                  id="shopName"
                  name="shopName"
                  required
                  minLength={2}
                  maxLength={60}
                  defaultValue={user.shopName ?? ""}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bio">Bio</Label>
                <Textarea
                  id="bio"
                  name="bio"
                  rows={4}
                  maxLength={500}
                  defaultValue={user.sellerBio ?? ""}
                  placeholder="What does your shop sell?"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="location">Location</Label>
                <Input
                  id="location"
                  name="location"
                  maxLength={80}
                  defaultValue={user.location ?? ""}
                  placeholder="City, Country"
                />
              </div>
              <Button type="submit" disabled={profileSaving}>
                {profileSaving ? "Saving…" : "Save profile"}
              </Button>
            </form>
          </TabsContent>

          {/* Fulfillment defaults */}
          <TabsContent value="fulfillment" className="mt-5">
            <div className="max-w-2xl space-y-4 rounded-2xl border border-border/70 bg-card p-6">
              <div>
                <h2 className="text-sm font-bold tracking-tight">
                  Shipping &amp; fulfillment settings
                </h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Your defaults for new listings — pickup area, shipping fee
                  and handling time, local delivery area and fee. You can
                  override them per listing. You&apos;re always free to arrange
                  details directly with the buyer.
                </p>
              </div>
              <FulfillmentEditor
                value={
                  fulfillmentDefaults ??
                  (user.defaultFulfillment
                    ? (JSON.parse(
                        JSON.stringify(user.defaultFulfillment),
                      ) as FulfillmentSettings)
                    : {
                        pickup: { enabled: true, area: user.location ?? "" },
                        shipping: {
                          enabled: true,
                          feeCents: 0,
                          handlingDays: 3,
                        },
                        delivery: {
                          enabled: false,
                          feeCents: 0,
                          contactRequired: true,
                        },
                      })
                }
                onChange={setFulfillmentDefaults}
                idPrefix="defaults-ff"
              />
              <Button
                disabled={!fulfillmentDefaults || savingDefaults}
                onClick={() => void handleDefaultsSave()}
              >
                {savingDefaults ? "Saving…" : "Save fulfillment defaults"}
              </Button>
            </div>
          </TabsContent>

          {/* Plan & earnings */}
          <TabsContent value="plan" className="mt-5">
            <div className="max-w-2xl space-y-5">
              {/* Subscription status */}
              <div className="rounded-2xl border border-border/70 bg-card p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-sm font-bold tracking-tight">
                    Subscription plan
                  </h2>
                  {mySub?.status === "active" ? (
                    <Badge className="bg-emerald-500/15 text-emerald-400">
                      Active
                    </Badge>
                  ) : mySub?.status === "pending" ? (
                    <Badge className="bg-amber-500/15 text-amber-400">
                      Pending payment
                    </Badge>
                  ) : (
                    <Badge variant="outline">Individual — free</Badge>
                  )}
                </div>

                {mySub &&
                (mySub.status === "active" || mySub.status === "pending") ? (
                  <div className="mt-4 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Plan</span>
                      <span className="font-medium">{mySub.planName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        Monthly price (USD)
                      </span>
                      <span className="font-medium">
                        {formatPrice(mySub.priceCentsMonthly)}/month
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        Commission rate
                      </span>
                      <span className="font-medium">
                        {bpsToPercent(mySub.commissionBps)} per delivered sale
                      </span>
                    </div>
                    {mySub.renewsAt && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          Next billing date
                        </span>
                        <span className="font-medium">
                          {formatDate(mySub.renewsAt)}
                        </span>
                      </div>
                    )}
                    {mySub.status === "pending" && (
                      <p className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs leading-5 text-amber-300">
                        Pending payment confirmation — online card billing
                        isn&apos;t configured yet, so an administrator
                        activates your plan manually. No fee or commission is
                        owed until then.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="mt-4 space-y-3 text-sm leading-6 text-muted-foreground">
                    <p>
                      You&apos;re on the free Individual plan: $0/month, 0%
                      commission, every selling feature for individuals.
                    </p>
                    <p>
                      Want a branded storefront, custom URL, and sales
                      analytics? Business plans start at $29/month (5%
                      commission), $79/month (3%), or $199/month (1%).
                    </p>
                  </div>
                )}

                <div className="mt-5 flex flex-wrap gap-3">
                  <Button asChild>
                    <Link to="/sell/plans">
                      {mySub?.status === "active"
                        ? "Change or cancel plan"
                        : mySub?.status === "pending"
                          ? "View subscription"
                          : "Upgrade to a business plan"}
                    </Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link to="/pricing">Compare plans</Link>
                  </Button>
                </div>
              </div>

              {/* Earnings & payouts */}
              <div className="rounded-2xl border border-border/70 bg-card p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-sm font-bold tracking-tight">
                    Earnings &amp; payouts
                  </h2>
                  <Badge
                    variant="outline"
                    className={
                      earnings?.connect.status === "enabled"
                        ? "border-emerald-400/40 text-emerald-400"
                        : "text-muted-foreground"
                    }
                  >
                    {earnings?.connect.status === "enabled"
                      ? "Stripe connected"
                      : "Stripe not connected"}
                  </Badge>
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Calculated only from delivered order items, commission
                  entries and payout records. Nothing is estimated or seeded.
                </p>
                {earnings === undefined ? (
                  <p className="mt-4 text-sm text-muted-foreground">
                    Loading earnings…
                  </p>
                ) : earnings === null ? (
                  <p className="mt-4 text-sm text-muted-foreground">
                    Sign in as a seller to see earnings.
                  </p>
                ) : (
                  <>
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <div className="rounded-xl border border-border/70 bg-background/40 p-4">
                        <p className="text-xl font-bold tracking-tight">
                          {formatPrice(earnings.pendingCents)}
                        </p>
                        <p className="mt-0.5 text-[11px] font-medium">
                          Pending
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {earnings.pendingCount} delivered item
                          {earnings.pendingCount === 1 ? "" : "s"} with payment
                          not recorded
                        </p>
                      </div>
                      <div className="rounded-xl border border-border/70 bg-background/40 p-4">
                        <p className="text-xl font-bold tracking-tight">
                          {formatPrice(earnings.availableCents)}
                        </p>
                        <p className="mt-0.5 text-[11px] font-medium">
                          Available
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          Card balance the platform holds for you
                        </p>
                      </div>
                      <div className="rounded-xl border border-border/70 bg-background/40 p-4">
                        <p className="text-xl font-bold tracking-tight">
                          {formatPrice(earnings.paidOutCents)}
                        </p>
                        <p className="mt-0.5 text-[11px] font-medium">
                          Paid out
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          Stripe-confirmed transfers only
                        </p>
                      </div>
                      <div className="rounded-xl border border-border/70 bg-background/40 p-4">
                        <p className="text-xl font-bold tracking-tight">
                          {formatPrice(earnings.collectedCashCents)}
                        </p>
                        <p className="mt-0.5 text-[11px] font-medium">
                          Collected by you
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          Cash on delivery, already in your hand
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        Gross delivered{" "}
                        <strong className="font-semibold text-foreground">
                          {formatPrice(earnings.grossDeliveredCents)}
                        </strong>
                      </span>
                      <span>
                        Commission{" "}
                        <strong className="font-semibold text-foreground">
                          {formatPrice(earnings.commissionCents)}
                        </strong>
                      </span>
                      <span>
                        Refunded{" "}
                        <strong className="font-semibold text-foreground">
                          {formatPrice(earnings.refundedCents)}
                        </strong>
                      </span>
                    </div>

                    <div className="mt-4 rounded-xl border border-border/70 bg-background/40 p-4 text-xs leading-5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold">Stripe payout account</p>
                        <Badge
                          variant="outline"
                          className={
                            earnings.connect.status === "enabled"
                              ? "border-emerald-400/40 text-emerald-400"
                              : "text-muted-foreground"
                          }
                        >
                          {connectLabel[earnings.connect.status] ??
                            earnings.connect.status}
                        </Badge>
                      </div>
                      <p className="mt-1 text-muted-foreground">
                        {earnings.connect.status === "enabled"
                          ? "Your Express account is verified and payouts are enabled. Card orders are transferred to this account after delivery."
                          : earnings.connect.status === "not_connected"
                            ? "Connect an Express account to receive card payments. Cash on delivery keeps working either way — you collect that directly."
                            : "Stripe still needs information (or is reviewing your account) before it can enable payouts. Cash on delivery keeps working in the meantime."}
                      </p>
                      {earnings.connect.disabledReason && (
                        <p className="mt-1 text-muted-foreground">
                          Stripe: {earnings.connect.disabledReason}
                        </p>
                      )}
                      {earnings.connect.currentlyDue.length > 0 && (
                        <ul className="mt-2 list-disc space-y-0.5 pl-4 text-muted-foreground">
                          {earnings.connect.currentlyDue.slice(0, 5).map((item) => (
                            <li key={item}>{item.replace(/\./g, " ")}</li>
                          ))}
                        </ul>
                      )}
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          variant={
                            earnings.connect.status === "enabled"
                              ? "outline"
                              : "default"
                          }
                          onClick={() => void handleConnectStripe()}
                          disabled={connectBusy}
                        >
                          {connectBusy
                            ? "Opening Stripe…"
                            : earnings.connect.status === "enabled"
                              ? "Manage Stripe account"
                              : earnings.connect.status === "not_connected"
                                ? "Set up Stripe payouts"
                                : "Continue Stripe onboarding"}
                        </Button>
                        {earnings.connect.status !== "not_connected" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={connectBusy}
                            onClick={async () => {
                              setConnectBusy(true);
                              try {
                                const account = await syncConnectAccount();
                                toast.success(
                                  account.payoutsEnabled
                                    ? "Payouts enabled."
                                    : "Account refreshed.",
                                );
                              } catch (error) {
                                toast.error(
                                  error instanceof Error
                                    ? error.message
                                    : "Could not refresh the account.",
                                );
                              } finally {
                                setConnectBusy(false);
                              }
                            }}
                          >
                            Refresh status
                          </Button>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 rounded-xl border border-border/70 bg-background/40 p-4 text-xs leading-5">
                      <p className="font-semibold">Payout history</p>
                      {earnings.payouts.length === 0 ? (
                        <p className="mt-1 text-muted-foreground">
                          No payouts recorded. A payout only appears as paid
                          when Stripe confirms the transfer.
                        </p>
                      ) : (
                        <ul className="mt-2 space-y-1.5">
                          {earnings.payouts.map((payout) => (
                            <li
                              key={payout._id}
                              className="flex items-center justify-between gap-3"
                            >
                              <span className="text-muted-foreground">
                                {formatDate(payout.createdAt)}
                              </span>
                              <span className="flex items-center gap-2">
                                <span className="font-semibold">
                                  {formatPrice(payout.amountCents)}
                                </span>
                                <Badge
                                  variant="outline"
                                  className={
                                    payout.confirmed
                                      ? "border-emerald-400/40 text-emerald-400"
                                      : "text-muted-foreground"
                                  }
                                >
                                  {payout.confirmed
                                    ? "Stripe-confirmed transfer"
                                    : `${payoutStatusLabel[payout.status]} — not Stripe-confirmed`}
                                </Badge>
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* Earnings & commissions */}
              <div className="rounded-2xl border border-border/70 bg-card p-6">
                <h2 className="text-sm font-bold tracking-tight">
                  Sales &amp; commission report
                </h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Payment happens on delivery — you collect directly from the
                  buyer. Platform commission (business plans only) accrues per
                  delivered item and is listed below with a full breakdown.
                </p>
                {myLedger?.totals ? (
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-border/70 bg-background/40 p-4">
                      <p className="text-xl font-bold tracking-tight">
                        {formatPrice(myLedger.totals.owedCents)}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Commission owed (pending)
                      </p>
                    </div>
                    <div className="rounded-xl border border-border/70 bg-background/40 p-4">
                      <p className="text-xl font-bold tracking-tight">
                        {formatPrice(myLedger.totals.confirmedCents)}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Commission settled
                      </p>
                    </div>
                    <div className="rounded-xl border border-border/70 bg-background/40 p-4">
                      <p className="text-xl font-bold tracking-tight">
                        {formatPrice(myLedger.totals.reversedCents)}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Reversed (refunds/cancellations)
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        Platform commission
                      </span>
                      <span className="font-medium">
                        {user.sellerType === "business"
                          ? "Per your plan rate"
                          : "None — free plan"}
                      </span>
                    </div>
                    <p className="text-xs leading-5 text-muted-foreground">
                      Your gross sales, fees, refunds, and net proceeds are
                      listed per order in the Orders tab. Subscriptions and
                      commissions are billed in USD.
                    </p>
                  </div>
                )}
                {myLedger && myLedger.rows.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {myLedger.rows.slice(0, 10).map((row) => (
                      <div
                        key={row._id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/70 bg-background/40 px-3.5 py-2.5 text-xs"
                      >
                        <span className="text-muted-foreground">
                          {formatDate(row.occurredAt)} · base{" "}
                          {formatPrice(row.baseCents)} at{' '}
                          {bpsToPercent(row.commissionBps)}
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="font-bold">
                            {formatPrice(row.amountCents)}
                          </span>
                          <Badge
                            variant="outline"
                            className={
                              row.status === "confirmed"
                                ? "border-emerald-400/40 text-emerald-400"
                                : row.status === "reversed"
                                  ? "text-muted-foreground"
                                  : "text-amber-400"
                            }
                          >
                            {row.status}
                          </Badge>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          {/* Referral program */}
          <TabsContent value="referrals" className="mt-5">
            <div className="max-w-3xl space-y-5">
              <div className="rounded-2xl border border-border/70 bg-card p-6">
                <div className="flex items-center gap-2">
                  <Gift className="size-5 text-primary" />
                  <h2 className="text-base font-bold tracking-tight">
                    Invite another seller
                  </h2>
                </div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Share your link with someone ready to open a shop. Their
                  account is credited to you when they finish shop setup, and
                  your invite count appears here. This is a recognition
                  program — no cash payouts are promised or calculated.
                </p>

                {myReferrals === undefined ? (
                  <div className="mt-5 h-10 w-56 animate-pulse rounded-lg bg-secondary/60" />
                ) : myReferrals?.code ? (
                  <div className="mt-5 space-y-3">
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input
                        readOnly
                        value={referralLink ?? ""}
                        aria-label="Your seller invite link"
                        className="font-mono text-xs"
                        onFocus={(event) => event.currentTarget.select()}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void handleCopyReferral()}
                      >
                        <Copy className="mr-1.5 size-4" /> Copy link
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Your unique code:{" "}
                      <span className="font-mono font-semibold text-foreground">
                        {myReferrals.code}
                      </span>
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { label: "Link visits", value: myReferrals.visits },
                        { label: "Shop setups", value: myReferrals.inviteCount },
                        {
                          label: "Still selling",
                          value: myReferrals.activeInvitees,
                        },
                      ].map((stat) => (
                        <div
                          key={stat.label}
                          className="rounded-xl border border-border/70 bg-background/40 px-3 py-2.5"
                        >
                          <p className="text-lg font-bold">{stat.value}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {stat.label}
                          </p>
                        </div>
                      ))}
                    </div>
                    <p className="text-[11px] leading-5 text-muted-foreground">
                      {myReferrals.visitsLast30Days} visit
                      {myReferrals.visitsLast30Days === 1 ? "" : "s"} in the
                      last 30 days
                      {myReferrals.conversionRate !== null &&
                        ` · ${myReferrals.conversionRate.toFixed(1)}% of visits became shop setups`}
                      . Visits are anonymous and counted once per browser
                      session.
                    </p>
                  </div>
                ) : (
                  <Button
                    className="mt-5"
                    onClick={() => void handleCreateCode()}
                    disabled={creatingCode}
                  >
                    {creatingCode ? "Creating…" : "Create my invite code"}
                  </Button>
                )}
              </div>

              <div className="rounded-2xl border border-border/70 bg-card p-6">
                <h2 className="text-base font-bold tracking-tight">
                  Your invites
                </h2>
                {myReferrals && myReferrals.invites.length > 0 ? (
                  <ul className="mt-4 divide-y divide-border/70">
                    {myReferrals.invites.map((invite) => (
                      <li
                        key={invite._id}
                        className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">
                            {invite.shopName ?? invite.name ?? "New seller"}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            Joined {formatDate(invite.joinedAt)} ·{" "}
                            {invite.listings} live listing
                            {invite.listings === 1 ? "" : "s"}
                          </span>
                        </span>
                        <Badge
                          variant="outline"
                          className={
                            invite.stillSelling
                              ? "border-emerald-400/40 text-emerald-400"
                              : "text-muted-foreground"
                          }
                        >
                          {invite.stillSelling ? "Selling" : "Inactive"}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">
                    No invites yet. When someone opens a shop with your link,
                    they show up here.
                  </p>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
