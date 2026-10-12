import { EmptyState } from "@/components/marketplace/EmptyState";
import { Layout } from "@/components/marketplace/Layout";
import { ProductMedia } from "@/components/marketplace/ProductMedia";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { formatDate, formatPrice, initials } from "@/lib/format";
import { useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
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
import { useMemo, useState } from "react";
import { Link } from "react-router";
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

export default function SellerDashboard() {
  const { user, isLoading: authLoading } = useAuth();
  const listings = useQuery(api.products.myListings);
  const sellerOrders = useQuery(api.orders.sellerOrders);
  const setStatus = useMutation(api.products.setStatus);
  const removeListing = useMutation(api.products.remove);
  const updateItemStatus = useMutation(api.orders.updateItemStatus);
  const updateProfile = useMutation(api.sellers.updateProfile);

  const [filter, setFilter] = useState<StatusFilter>("all");
  const [profileSaving, setProfileSaving] = useState(false);

  const stats = useMemo(() => {
    if (!listings) return null;
    const active = listings.filter((p) => p.status === "active");
    const pendingItems = (sellerOrders ?? []).flatMap((order) =>
      order.items.filter((item) => item.status === "placed"),
    );
    return {
      live: active.length,
      drafts: listings.filter((p) => p.status === "draft").length,
      takenDown: listings.filter((p) => p.status === "removed").length,
      views: listings.reduce((sum, p) => sum + (p.views ?? 0), 0),
      soldUnits: listings.reduce((sum, p) => sum + (p.soldCount ?? 0), 0),
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

        <Tabs defaultValue="listings" className="mt-8">
          <TabsList>
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
          </TabsList>

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
                          {product.moderatorNote && (
                            <Badge
                              variant="outline"
                              className="gap-1 border-amber-400/40 text-[10px] text-amber-400"
                            >
                              <AlertTriangle className="size-3" />
                              {product.moderatorNote}
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
                description="When a buyer orders one of your listings, it appears here with their shipping details so you can dispatch it."
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
                {sellerOrders.map((order) => (
                  <div
                    key={order._id}
                    className="rounded-2xl border border-border/70 bg-card p-5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">{order.buyerName}</p>
                        <p className="text-xs text-muted-foreground">
                          Ordered {formatDate(order.createdAt)} ·{" "}
                          {order.shippingAddress.city},{" "}
                          {order.shippingAddress.country}
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
                              {orderStatusLabel[item.status] ?? item.status}
                            </p>
                          </div>
                          <div className="flex gap-2">
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

                    <div className="mt-3 text-xs leading-5 text-muted-foreground">
                      <p className="font-medium text-foreground">
                        Ship to: {order.shippingAddress.fullName},{" "}
                        {order.shippingAddress.line1}
                        {order.shippingAddress.line2
                          ? `, ${order.shippingAddress.line2}`
                          : ""}
                      </p>
                      <p>
                        {order.shippingAddress.city},{" "}
                        {order.shippingAddress.region}{" "}
                        {order.shippingAddress.postalCode} ·{" "}
                        {order.shippingAddress.phone}
                      </p>
                    </div>
                  </div>
                ))}
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
        </Tabs>
      </div>
    </Layout>
  );
}
