import { EventsManager } from "@/components/admin/EventsManager";
import { PlatformSettings } from "@/components/admin/PlatformSettings";
import { EmptyState } from "@/components/marketplace/EmptyState";
import { Layout } from "@/components/marketplace/Layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/convex/_generated/api";
import { REPORT_REASONS } from "@/convex/reportReasons";
import { formatDateTime, formatPrice, timeAgo } from "@/lib/format";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  Activity,
  BadgeCheck,
  Banknote,
  Eye,
  Flag,
  Gift,
  Loader2,
  PackageCheck,
  Pencil,
  Repeat,
  Search,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Store,
  Tag,
  Ticket,
  TrendingUp,
  UserPlus,
  Users,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

const EVENT_ROWS: { type: string; label: string; icon: typeof Eye }[] = [
  { type: "product_view", label: "Product views", icon: Eye },
  { type: "search", label: "Searches", icon: Search },
  { type: "signup", label: "Sign-ups", icon: UserPlus },
  { type: "listing_created", label: "Completed listings", icon: Tag },
  { type: "add_to_cart", label: "Add to cart", icon: ShoppingCart },
  { type: "checkout_complete", label: "Checkout completed", icon: PackageCheck },
  { type: "repeat_purchase", label: "Repeat purchases", icon: Repeat },
];

const labelFor: Record<string, string> = {
  placed: "Placed",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
  active: "Live",
  draft: "Draft",
  removed: "Taken down",
};

const connectLabel: Record<string, string> = {
  not_connected: "Not connected",
  pending: "Onboarding pending",
  restricted: "Restricted",
  enabled: "Enabled",
};

const paymentLabel: Record<string, string> = {
  unpaid: "Payment pending",
  paid: "Paid",
  refunded: "Refunded",
  failed: "Failed",
};

const payoutLabel: Record<string, string> = {
  pending: "Pending",
  in_transit: "In transit",
  paid: "Paid",
  reversed: "Reversed",
  failed: "Failed",
};

export default function Admin() {
  const status = useQuery(api.admin.adminStatus);
  const stats = useQuery(api.admin.stats, status?.isAdmin ? {} : "skip");
  const [claiming, setClaiming] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const backfillEmbeddings = useAction(api.ai.backfillEmbeddings);

  const handleReindex = async () => {
    setReindexing(true);
    try {
      const { indexed } = await backfillEmbeddings({ batchSize: 8 });
      if (indexed > 0) {
        toast.success(
          `Embedded ${indexed} listing${indexed === 1 ? "" : "s"} for AI search.`,
        );
      } else {
        toast.message("Every listing is already indexed for AI search.");
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Reindex failed — check GEMINI_API_KEY.",
      );
    } finally {
      setReindexing(false);
    }
  };
  const claimAdmin = useMutation(api.admin.claimAdmin);
  const setProductStatus = useMutation(api.admin.setProductStatus);
  const setUserRole = useMutation(api.admin.setUserRole);
  const setFeatured = useMutation(api.admin.setFeatured);
  const resolveReport = useMutation(api.reports.resolve);
  const closeTicket = useMutation(api.account.closeTicket);

  const isAdmin = status?.isAdmin ?? false;

  const products = useQuery(
    api.admin.listProducts,
    isAdmin ? { limit: 50 } : "skip",
  );
  const users = useQuery(
    api.admin.listUsers,
    isAdmin ? { limit: 50 } : "skip",
  );
  const tickets = useQuery(api.account.listTickets, isAdmin ? {} : "skip");
  const reports = useQuery(api.reports.adminList, isAdmin ? {} : "skip");
  const referrals = useQuery(
    api.admin.referralOverview,
    isAdmin ? {} : "skip",
  );
  const paymentOverview = useQuery(
    api.payments.adminOverview,
    isAdmin ? {} : "skip",
  );
  const commissionIntegrity = useQuery(
    api.payments.commissionIntegrity,
    isAdmin ? {} : "skip",
  );
  const stripeReconciliation = useQuery(
    api.stripeSync.reconciliation,
    isAdmin ? {} : "skip",
  );
  const refundPayment = useMutation(api.payments.adminRefundItem);
  const refundStripeItem = useAction(api.stripe.refundItem);
  const releaseOrderFunds = useAction(api.stripe.releaseOrderFunds);
  const [releasingOrderId, setReleasingOrderId] = useState<string | null>(null);

  const handleRefund = async (
    itemId: string,
    title: string,
    method: "cod" | "card",
  ) => {
    const prompt =
      method === "card"
        ? `Refund "${title}" through Stripe? The buyer gets the money back on their card and the commission is reversed.`
        : `Record a cash refund for "${title}"? Any pending commission on it is reversed.`;
    if (!window.confirm(prompt)) return;
    try {
      if (method === "card") {
        const result = await refundStripeItem({ itemId });
        toast.success(
          result.status === "succeeded"
            ? "Stripe confirmed the refund and the commission was reversed."
            : "Stripe accepted the refund; it is still settling.",
        );
      } else {
        await refundPayment({ itemId: itemId as never });
        toast.success("Cash refund recorded and pending commission reversed.");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not record refund.",
      );
    }
  };

  const handleReleaseFunds = async (orderId: string) => {
    setReleasingOrderId(orderId);
    try {
      const results = await releaseOrderFunds({ orderId });
      const transferred = results.filter((r) => r.status === "transferred");
      const failed = results.filter((r) => r.status === "failed");
      if (failed.length > 0) {
        toast.error(
          `${failed.length} transfer${failed.length === 1 ? "" : "s"} failed: ${failed[0].message}`,
        );
      } else if (transferred.length > 0) {
        toast.success(
          `${transferred.length} Stripe transfer${transferred.length === 1 ? "" : "s"} created. They show as in transit until Stripe's webhook confirms them.`,
        );
      } else {
        toast.info(results[0]?.message ?? "Nothing to release for this order.");
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not release seller funds.",
      );
    } finally {
      setReleasingOrderId(null);
    }
  };

  const handleFeature = async (productId: string, featured: boolean) => {
    try {
      await setFeatured({ productId: productId as never, featured });
      toast.success(
        featured
          ? "Featured on the homepage and in featured sorting."
          : "Removed from featured placement.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update featured.",
      );
    }
  };

  const handleResolveReport = async (
    reportId: string,
    outcome: "resolved" | "dismissed",
  ) => {
    try {
      await resolveReport({
        reportId: reportId as never,
        outcome,
        removeListing: outcome === "resolved",
      });
      toast.success(
        outcome === "resolved"
          ? "Report resolved and listing taken down."
          : "Report dismissed.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update the report.",
      );
    }
  };

  const handleClaim = async () => {
    setClaiming(true);
    try {
      await claimAdmin({});
      toast.success("You now have admin access.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not claim admin.",
      );
    } finally {
      setClaiming(false);
    }
  };

  const handleModerate = async (
    productId: string,
    next: "active" | "draft" | "removed",
  ) => {
    let note: string | undefined;
    if (next === "removed") {
      const reason = window.prompt(
        "Reason for taking this listing down (shown to the seller):",
        "",
      );
      if (reason === null) return;
      note = reason.trim() || undefined;
    }
    try {
      await setProductStatus({
        productId: productId as never,
        status: next,
        note,
      });
      toast.success(`Listing marked ${labelFor[next]?.toLowerCase()}.`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update listing.",
      );
    }
  };

  const handleRole = async (userId: string, role: "admin" | "user" | "member") => {
    try {
      await setUserRole({ userId: userId as never, role });
      toast.success("Role updated.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update role.",
      );
    }
  };

  if (status === undefined) {
    return (
      <Layout>
        <div className="flex justify-center py-24">
          <div className="size-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      </Layout>
    );
  }

  if (!status.isAdmin) {
    return (
      <Layout>
        <div className="page-container py-16">
          {status.canClaim ? (
            <div className="mx-auto max-w-lg rounded-2xl border border-primary/40 bg-card p-8 text-center">
              <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <ShieldCheck className="size-6" />
              </div>
              <h1 className="mt-4 text-xl font-bold tracking-tight">
                Claim admin access
              </h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Administration is held by one mailbox: {" "}
                <span className="font-medium text-foreground">
                  {status.adminEmail}
                </span>
                . No admin is active right now, so this verified account can
                claim the seat to access metrics, moderation, and support
                tickets.
              </p>
              <Button
                className="mt-5"
                onClick={() => void handleClaim()}
                disabled={claiming}
              >
                {claiming ? "Claiming…" : "Claim admin access"}
              </Button>
            </div>
          ) : status.roleIsStale ? (
            <EmptyState
              icon={ShieldCheck}
              title="Admin access moved"
              description={`The administrative account is now ${status.adminEmail}. This account no longer has admin permissions.`}
              action={
                <Button asChild>
                  <Link to="/dashboard">Back to account</Link>
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={ShieldCheck}
              title="Admin access required"
              description={`This dashboard is restricted to the marketplace administrator (${status.adminEmail}). If you believe you should have access, ask an existing admin to grant it.`}
              action={
                <Button asChild>
                  <Link to="/dashboard">Back to account</Link>
                </Button>
              }
            />
          )}
        </div>
      </Layout>
    );
  }

  if (stats === undefined) {
    return (
      <Layout>
        <div className="flex justify-center py-24">
          <div className="size-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      </Layout>
    );
  }

  const maxDaily = Math.max(...stats.series.map((d) => d.events), 1);

  return (
    <Layout>
      <div className="page-container py-8 sm:py-12">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-muted-foreground">
              Administration
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
              Marketplace dashboard
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleReindex()}
              disabled={reindexing}
            >
              {reindexing ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 size-4" />
              )}
              {reindexing ? "Indexing…" : "Rebuild AI search"}
            </Button>
            <Badge
              variant="secondary"
              className="gap-1.5 border border-primary/40 px-3 py-1.5 text-primary"
            >
              <ShieldCheck className="size-3.5" /> Admin session
            </Badge>
          </div>
        </div>

        {/* Headline metrics */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: "Gross sales", value: formatPrice(stats.totals.revenueCents), icon: Banknote },
            { label: "Orders", value: stats.totals.orders, icon: ShoppingCart },
            { label: "Accounts", value: stats.totals.users, icon: Users },
            { label: "Sellers", value: stats.totals.sellers, icon: Store },
            {
              label: "Live listings",
              value: stats.totals.activeProducts,
              icon: Tag,
            },
            { label: "Listing views", value: stats.totals.totalViews, icon: Eye },
          ].map((metric) => (
            <div
              key={metric.label}
              className="rounded-2xl border border-border/70 bg-card p-4"
            >
              <metric.icon className="size-4 text-primary" />
              <p className="mt-2 truncate text-lg font-bold tracking-tight">
                {metric.value}
              </p>
              <p className="text-[11px] text-muted-foreground">{metric.label}</p>
            </div>
          ))}
        </div>

        {/* Conversion metrics */}
        <section className="mt-8 rounded-2xl border border-border/70 bg-card">
          <div className="flex items-center gap-2 border-b border-border/70 px-5 py-4">
            <TrendingUp className="size-4 text-primary" />
            <h2 className="text-sm font-bold tracking-tight">
              Growth &amp; conversion
            </h2>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead className="text-right">Last 7 days</TableHead>
                <TableHead className="text-right">Last 30 days</TableHead>
                <TableHead className="text-right">All time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {EVENT_ROWS.map((row) => (
                <TableRow key={row.type}>
                  <TableCell>
                    <span className="flex items-center gap-2 text-sm">
                      <row.icon className="size-3.5 text-muted-foreground" />
                      {row.label}
                    </span>
                  </TableCell>
                  <TableCell className="text-right text-sm font-medium">
                    {stats.last7.byType[row.type] ?? 0}
                  </TableCell>
                  <TableCell className="text-right text-sm font-medium">
                    {stats.last30.byType[row.type] ?? 0}
                  </TableCell>
                  <TableCell className="text-right text-sm font-bold">
                    {stats.lifetime[row.type] ?? 0}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>

        {/* Activity chart */}
        <section className="mt-6 rounded-2xl border border-border/70 bg-card p-5">
          <div className="flex items-center gap-2">
            <Activity className="size-4 text-primary" />
            <h2 className="text-sm font-bold tracking-tight">
              Marketplace activity — last 14 days
            </h2>
          </div>
          <div className="mt-5 flex h-40 items-end gap-1.5 sm:gap-2">
            {stats.series.map((day) => {
              const height = Math.max(
                (day.events / maxDaily) * 100,
                day.events > 0 ? 8 : 2,
              );
              return (
                <div
                  key={day.label}
                  className="group flex flex-1 flex-col items-center gap-1.5"
                  title={`${day.label}: ${day.events} events, ${day.checkouts} checkouts`}
                >
                  <span className="text-[10px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                    {day.events}
                  </span>
                  <div
                    className="w-full rounded-t-md bg-gradient-to-t from-primary/40 to-primary transition-all"
                    style={{ height: `${height}%` }}
                  />
                  <span className="w-full truncate text-center text-[9px] text-muted-foreground">
                    {day.label.split(" ")[1] ?? day.label}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-primary" /> All events
            </span>
            <span>
              Peak day: {Math.max(...stats.series.map((d) => d.events))} events
            </span>
            <span>
              {stats.series.reduce((sum, d) => sum + d.checkouts, 0)} checkouts
              in period
            </span>
          </div>
        </section>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          {/* Top products */}
          <section className="rounded-2xl border border-border/70 bg-card">
            <div className="flex items-center gap-2 border-b border-border/70 px-5 py-4">
              <Eye className="size-4 text-primary" />
              <h2 className="text-sm font-bold tracking-tight">
                Most viewed listings
              </h2>
            </div>
            {stats.topProducts.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted-foreground">
                No listings yet — this fills in as sellers publish.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Listing</TableHead>
                    <TableHead className="text-right">Views</TableHead>
                    <TableHead className="text-right">Sold</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats.topProducts.map((product) => (
                    <TableRow key={product._id}>
                      <TableCell>
                        <Link
                          to={`/products/${product._id}`}
                          className="line-clamp-1 text-sm hover:text-primary"
                        >
                          {product.title}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {product.views}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {product.soldCount}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>

          {/* Recent orders */}
          <section className="rounded-2xl border border-border/70 bg-card">
            <div className="flex items-center gap-2 border-b border-border/70 px-5 py-4">
              <ShoppingCart className="size-4 text-primary" />
              <h2 className="text-sm font-bold tracking-tight">Recent orders</h2>
            </div>
            {stats.recentOrders.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted-foreground">
                No orders yet — checkouts land here the moment they happen.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Buyer</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats.recentOrders.map((order) => (
                    <TableRow key={order._id}>
                      <TableCell>
                        <p className="line-clamp-1 text-sm">{order.buyerEmail}</p>
                        <p className="text-xs text-muted-foreground">
                          {timeAgo(order.createdAt)} · {order.itemCount} items
                        </p>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            order.status === "cancelled"
                              ? "text-muted-foreground"
                              : order.status === "delivered"
                                ? "border-emerald-400/40 text-emerald-400"
                                : "border-primary/40 text-primary"
                          }
                        >
                          {labelFor[order.status] ?? order.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-sm font-semibold">
                        {formatPrice(order.totalCents)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>
        </div>

        {/* Moderation */}
        <section className="mt-6 rounded-2xl border border-border/70 bg-card">
          <div className="flex items-center gap-2 border-b border-border/70 px-5 py-4">
            <Pencil className="size-4 text-primary" />
            <h2 className="text-sm font-bold tracking-tight">
              Listing moderation
            </h2>
            <span className="ml-auto text-xs text-muted-foreground">
              {products?.length ?? 0} listed
            </span>
          </div>
          {products === undefined ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">Loading…</p>
          ) : products.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">
              No listings to moderate yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Listing</TableHead>
                  <TableHead>Seller</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((product) => (
                  <TableRow key={product._id}>
                    <TableCell>
                      <Link
                        to={`/products/${product._id}`}
                        className="line-clamp-1 text-sm hover:text-primary"
                      >
                        {product.title}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {formatPrice(product.priceCents)} · {product.views} views
                      </p>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {product.sellerName}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          product.status === "active"
                            ? "border-emerald-400/40 text-emerald-400"
                            : product.status === "removed"
                              ? "border-destructive/40 text-destructive"
                              : "text-muted-foreground"
                        }
                      >
                        {labelFor[product.status] ?? product.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {product.quantity}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {product.status === "active" && (
                          <Button
                            size="sm"
                            variant={product.featuredAt ? "default" : "outline"}
                            onClick={() =>
                              void handleFeature(
                                product._id,
                                !product.featuredAt,
                              )
                            }
                          >
                            <Sparkles className="size-3.5" />
                            {product.featuredAt ? "Featured" : "Feature"}
                          </Button>
                        )}
                        {product.status !== "active" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              void handleModerate(product._id, "active")
                            }
                          >
                            <BadgeCheck className="size-3.5" /> Approve
                          </Button>
                        )}
                        {product.status === "active" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              void handleModerate(product._id, "removed")
                            }
                          >
                            Take down
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>

        {/* Buyer reports */}
        <section className="mt-6 rounded-2xl border border-border/70 bg-card">
          <div className="flex items-center gap-2 border-b border-border/70 px-5 py-4">
            <Flag className="size-4 text-primary" />
            <h2 className="text-sm font-bold tracking-tight">
              Reported listings
            </h2>
            <span className="ml-auto text-xs text-muted-foreground">
              {reports?.length ?? 0} open
            </span>
          </div>
          {reports === undefined ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">Loading…</p>
          ) : reports.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">
              No open reports. Buyer reports land here for review.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Listing</TableHead>
                  <TableHead>Seller</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Reported</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.map((report) => (
                  <TableRow key={report._id}>
                    <TableCell className="max-w-[220px]">
                      <Link
                        to={`/products/${report.productId}`}
                        className="line-clamp-1 text-sm hover:text-primary"
                      >
                        {report.productTitle}
                      </Link>
                      {report.details && (
                        <p className="line-clamp-2 text-xs text-muted-foreground">
                          “{report.details}”
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {report.sellerName}
                    </TableCell>
                    <TableCell className="text-sm">
                      {REPORT_REASONS.find(
                        (reason) => reason.value === report.reason,
                      )?.label ?? report.reason}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {timeAgo(report.createdAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            void handleResolveReport(report._id, "dismissed")
                          }
                        >
                          Dismiss
                        </Button>
                        <Button
                          size="sm"
                          onClick={() =>
                            void handleResolveReport(report._id, "resolved")
                          }
                        >
                          Resolve &amp; remove
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>

        {/* Referral program */}
        <section className="mt-6 rounded-2xl border border-border/70 bg-card">
          <div className="flex items-center gap-2 border-b border-border/70 px-5 py-4">
            <Gift className="size-4 text-primary" />
            <h2 className="text-sm font-bold tracking-tight">
              Seller referrals
            </h2>
          </div>
          {referrals === undefined ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="p-5">
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  { label: "Total referrals", value: referrals.total },
                  { label: "Inviting sellers", value: referrals.inviters },
                  { label: "Last 30 days", value: referrals.last30Days },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className="rounded-xl border border-border/70 bg-background/40 px-4 py-3"
                  >
                    <p className="text-lg font-bold">{stat.value}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {stat.label}
                    </p>
                  </div>
                ))}
              </div>
              {referrals.topInviters.length > 0 ? (
                <ul className="mt-4 divide-y divide-border/70 text-sm">
                  {referrals.topInviters.map((inviter) => (
                    <li
                      key={inviter.sellerId}
                      className="flex items-center justify-between gap-3 py-2.5"
                    >
                      <span className="min-w-0 truncate">
                        {inviter.name}
                        {inviter.email && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {inviter.email}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-xs font-semibold">
                        {inviter.count} invited
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-sm text-muted-foreground">
                  No referrals recorded yet. Sellers share links from their
                  dashboard's "Refer sellers" tab.
                </p>
              )}
            </div>
          )}
        </section>

        {/* Payments & payouts */}
        <section className="mt-6 rounded-2xl border border-border/70 bg-card">
          <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-5 py-4">
            <Banknote className="size-4 text-primary" />
            <h2 className="text-sm font-bold tracking-tight">
              Payments &amp; payouts
            </h2>
            <Badge
              variant="outline"
              className={
                paymentOverview?.readiness.cardPaymentsAvailable
                  ? "ml-auto border-emerald-400/40 text-[10px] text-emerald-400"
                  : "ml-auto text-[10px] text-muted-foreground"
              }
            >
              {paymentOverview?.readiness.cardPaymentsAvailable
                ? "Card payments on"
                : "Card payments off"}
            </Badge>
          </div>

          {paymentOverview === undefined ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="space-y-5 p-5">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {[
                  {
                    label: "Cash collected",
                    value: formatPrice(paymentOverview.totals.cashCollectedCents),
                    note: "Seller-confirmed on delivery",
                  },
                  {
                    label: "Awaiting payment",
                    value: formatPrice(paymentOverview.totals.awaitingCents),
                    note: `${paymentOverview.totals.awaitingCount} delivered item${
                      paymentOverview.totals.awaitingCount === 1 ? "" : "s"
                    }`,
                  },
                  {
                    label: "Card collected",
                    value: formatPrice(paymentOverview.totals.cardCollectedCents),
                    note: "Requires Stripe — none recorded",
                  },
                  {
                    label: "Refunded",
                    value: formatPrice(paymentOverview.totals.refundedCents),
                    note: `${paymentOverview.totals.refundedCount} item${
                      paymentOverview.totals.refundedCount === 1 ? "" : "s"
                    }`,
                  },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className="rounded-xl border border-border/70 bg-background/40 px-4 py-3"
                  >
                    <p className="text-lg font-bold">{stat.value}</p>
                    <p className="text-[11px] font-medium">{stat.label}</p>
                    <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
                      {stat.note}
                    </p>
                  </div>
                ))}
              </div>

              <div
                className={`rounded-xl border p-4 text-xs leading-5 ${
                  paymentOverview.readiness.cardPaymentsAvailable
                    ? "border-emerald-400/30 bg-emerald-400/5"
                    : "border-amber-400/30 bg-amber-400/5"
                }`}
              >
                <p className="font-semibold">
                  Stripe:{" "}
                  {paymentOverview.readiness.keysPresent
                    ? "configured"
                    : "not fully configured"}
                </p>
                <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-muted-foreground">
                  {paymentOverview.readiness.blockers.length === 0 ? (
                    <li>
                      Card checkout, Connect onboarding, transfers and webhooks
                      are configured. Confirmation still comes only from
                      Stripe.
                    </li>
                  ) : (
                    paymentOverview.readiness.blockers.map((blocker) => (
                      <li key={blocker}>{blocker}</li>
                    ))
                  )}
                </ul>
                <p className="mt-1.5 text-[10px] text-muted-foreground">
                  Webhook endpoint: <code>/stripe/webhook</code> on this
                  deployment&apos;s Convex site URL. Use test-mode keys until a
                  real test payment has been verified.
                </p>
              </div>

              <div>
                <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  Recent delivered payments
                </h3>
                {paymentOverview.recentPaymentItems.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    No delivered payments yet. Payment status is recorded per
                    order item after delivery.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead>Seller</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paymentOverview.recentPaymentItems.map((item) => (
                        <TableRow key={item._id}>
                          <TableCell className="max-w-[220px]">
                            <span className="line-clamp-1 text-sm">
                              {item.title}
                            </span>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {item.sellerName}
                          </TableCell>
                          <TableCell className="text-sm">
                            {formatPrice(item.grossCents)}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={
                                item.paymentStatus === "paid"
                                  ? "border-emerald-400/40 text-emerald-400"
                                  : item.paymentStatus === "refunded"
                                    ? "text-muted-foreground"
                                    : "border-amber-400/40 text-amber-400"
                              }
                            >
                              {paymentLabel[item.paymentStatus] ??
                                item.paymentStatus}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-2">
                              {item.paymentStatus === "paid" ? (
                                <>
                                  {item.paymentMethod === "card" && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      disabled={
                                        releasingOrderId === item.orderId
                                      }
                                      onClick={() =>
                                        void handleReleaseFunds(item.orderId)
                                      }
                                    >
                                      {releasingOrderId === item.orderId
                                        ? "Releasing…"
                                        : item.transferId
                                          ? "Transferred"
                                          : "Release funds"}
                                    </Button>
                                  )}
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={item.refundStatus === "pending"}
                                    onClick={() =>
                                      void handleRefund(
                                        item._id,
                                        item.title,
                                        item.paymentMethod,
                                      )
                                    }
                                  >
                                    {item.paymentMethod === "card"
                                      ? "Refund via Stripe"
                                      : "Refund"}
                                  </Button>
                                </>
                              ) : item.refundStatus === "pending" ? (
                                <span className="text-xs text-amber-400">
                                  Refund pending
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  —
                                </span>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>

              <div>
                <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  Seller payout accounts
                </h3>
                {paymentOverview.sellers.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    No sellers yet.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Seller</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Stripe Connect</TableHead>
                        <TableHead>Charges</TableHead>
                        <TableHead>Payouts</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paymentOverview.sellers.map((seller) => (
                        <TableRow key={seller.sellerId}>
                          <TableCell className="text-sm">
                            {seller.name}
                          </TableCell>
                          <TableCell className="text-xs capitalize text-muted-foreground">
                            {seller.sellerType}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={
                                seller.connectStatus === "enabled"
                                  ? "border-emerald-400/40 text-emerald-400"
                                  : "text-muted-foreground"
                              }
                            >
                              {connectLabel[seller.connectStatus] ??
                                seller.connectStatus}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {seller.chargesEnabled ? "Enabled" : "No"}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {seller.payoutsEnabled ? "Enabled" : "No"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>

              <div>
                <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  Payouts
                </h3>
                {paymentOverview.payouts.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    No payouts recorded. A payout is only marked paid when
                    Stripe confirms the transfer — nothing is simulated here.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Seller</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Provider</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paymentOverview.payouts.map((payout) => (
                        <TableRow key={payout._id}>
                          <TableCell className="text-sm">
                            {payout.sellerName}
                          </TableCell>
                          <TableCell className="text-sm">
                            {formatPrice(payout.amountCents)}
                          </TableCell>
                          <TableCell className="text-xs capitalize text-muted-foreground">
                            {payout.provider}
                          </TableCell>
                          <TableCell>
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
                                : `${payoutLabel[payout.status] ?? payout.status} — not Stripe-confirmed`}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>

              <div>
                <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  Commission integrity
                </h3>
                {commissionIntegrity === undefined ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Checking…
                  </p>
                ) : commissionIntegrity.issues.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Commission math checks out across{" "}
                    {commissionIntegrity.checkedEntries} ledger entr
                    {commissionIntegrity.checkedEntries === 1 ? "y" : "ies"}.
                  </p>
                ) : (
                  <div className="mt-2 space-y-2">
                    <p className="text-xs font-medium text-amber-400">
                      {commissionIntegrity.issues.length} issue
                      {commissionIntegrity.issues.length === 1 ? "" : "s"}{" "}
                      found
                      {commissionIntegrity.missingAccruals > 0
                        ? ` · ${commissionIntegrity.missingAccruals} missing accrual${
                            commissionIntegrity.missingAccruals === 1
                              ? ""
                              : "s"
                          }`
                        : ""}
                    </p>
                    <ul className="space-y-1.5">
                      {commissionIntegrity.issues.map((issue, index) => (
                        <li
                          key={`${issue.type}-${issue.entryId ?? issue.orderItemId ?? index}`}
                          className="rounded-lg border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-xs leading-5"
                        >
                          {issue.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  Stripe reconciliation
                </h3>
                {stripeReconciliation === undefined ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Checking…
                  </p>
                ) : (
                  <div className="mt-2 space-y-2 text-xs leading-5">
                    <p className="text-muted-foreground">
                      {stripeReconciliation.events.length} verified webhook
                      event
                      {stripeReconciliation.events.length === 1 ? "" : "s"}{" "}
                      recorded · state is only written from verified events.
                    </p>
                    {stripeReconciliation.issues.length === 0 ? (
                      <p className="text-muted-foreground">
                        No local/provider state mismatches in recent orders and
                        payouts.
                      </p>
                    ) : (
                      <ul className="space-y-1.5">
                        {stripeReconciliation.issues.map((issue, index) => (
                          <li
                            key={`${issue.orderId ?? "payout"}-${index}`}
                            className="rounded-lg border border-amber-400/30 bg-amber-400/5 px-3 py-2"
                          >
                            {issue.issue}
                          </li>
                        ))}
                      </ul>
                    )}
                    {stripeReconciliation.events.length > 0 && (
                      <p className="text-muted-foreground">
                        Latest:{" "}
                        {stripeReconciliation.events
                          .slice(0, 3)
                          .map((event) => event.type)
                          .join(" · ")}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        {/* Users */}
        <section className="mt-6 rounded-2xl border border-border/70 bg-card">
          <div className="flex items-center gap-2 border-b border-border/70 px-5 py-4">
            <Users className="size-4 text-primary" />
            <h2 className="text-sm font-bold tracking-tight">Accounts</h2>
          </div>
          {users === undefined ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">Loading…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Verified</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((account) => (
                  <TableRow key={account._id}>
                    <TableCell>
                      <p className="text-sm font-medium">
                        {account.name ?? account.shopName ?? "Unnamed"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {account.email ?? "no email"} · joined{" "}
                        {formatDateTime(account.createdAt)}
                      </p>
                    </TableCell>
                    <TableCell>
                      {account.verified ? (
                        <Badge
                          variant="outline"
                          className="border-emerald-400/40 text-emerald-400"
                        >
                          Verified
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          Unverified
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={account.role === "admin" ? "default" : "secondary"}
                        className="capitalize"
                      >
                        {account.role ?? "user"}
                      </Badge>
                      {account.isSeller && (
                        <Badge
                          variant="outline"
                          className="ml-1.5 border-primary/40 text-primary"
                        >
                          seller
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1.5">
                        {account.role === "admin" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void handleRole(account._id, "user")}
                          >
                            Revoke admin
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void handleRole(account._id, "admin")}
                          >
                            Make admin
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>

        {/* Support tickets */}
        <section className="mt-6 rounded-2xl border border-border/70 bg-card">
          <div className="flex items-center gap-2 border-b border-border/70 px-5 py-4">
            <Ticket className="size-4 text-primary" />
            <h2 className="text-sm font-bold tracking-tight">Support tickets</h2>
          </div>
          {tickets === undefined ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">Loading…</p>
          ) : tickets.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">
              No tickets — the support inbox is clear.
            </p>
          ) : (
            <div className="divide-y divide-border/70">
              {tickets.map((ticket) => (
                <div key={ticket._id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{ticket.subject}</p>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={
                          ticket.status === "open"
                            ? "border-primary/40 text-primary"
                            : "text-muted-foreground"
                        }
                      >
                        {ticket.status}
                      </Badge>
                      {ticket.status === "open" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            void closeTicket({
                              ticketId: ticket._id,
                            })
                              .then(() => toast.success("Ticket closed."))
                              .catch((error: unknown) =>
                                toast.error(
                                  error instanceof Error
                                    ? error.message
                                    : "Could not close ticket.",
                                ),
                              );
                          }}
                        >
                          Close
                        </Button>
                      )}
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {ticket.name} · {ticket.email} ·{" "}
                    {formatDateTime(ticket._creationTime)}
                  </p>
                  <p className="mt-2 whitespace-pre-line text-sm leading-6 text-muted-foreground">
                    {ticket.message}
                  </p>
                  {ticket.responseNote && (
                    <p className="mt-2 rounded-lg bg-secondary/60 px-3 py-2 text-xs leading-5">
                      Response sent: {ticket.responseNote}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Platform settings: plans, commissions, subscriptions */}
        <section className="mt-6">
          <PlatformSettings />
        </section>

        <section className="mt-6">
          <EventsManager />
        </section>
      </div>
    </Layout>
  );
}
