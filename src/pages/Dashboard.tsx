import { Layout } from "@/components/marketplace/Layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { initials } from "@/lib/format";
import { useMutation } from "convex/react";
import {
  ArrowRight,
  Heart,
  LogOut,
  MailCheck,
  Package,
  LifeBuoy,
  ScrollText,
  ShieldCheck,
  Store,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const setPreferences = useMutation(api.account.setPreferences);
  const [savingPreferences, setSavingPreferences] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const handleMarketingToggle = async (checked: boolean) => {
    setSavingPreferences(true);
    try {
      await setPreferences({ marketingOptIn: checked });
      toast.success(
        checked
          ? "Opted in — occasional product news, easy to undo anytime."
          : "Marketing emails turned off.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save preference.",
      );
    } finally {
      setSavingPreferences(false);
    }
  };

  const quickLinks = [
    {
      to: "/orders",
      icon: ScrollText,
      title: "Order history",
      body: "Track every order from dispatch to delivery.",
    },
    {
      to: "/favorites",
      icon: Heart,
      title: "Favorites",
      body: "The items you've saved for later.",
    },
    {
      to: user?.isSeller ? "/sell/dashboard" : "/sell",
      icon: user?.isSeller ? Store : Package,
      title: user?.isSeller ? "Seller dashboard" : "Start selling",
      body: user?.isSeller
        ? "Manage listings, orders, and your shop profile."
        : "Free to post — publish your first listing in minutes.",
    },
    {
      to: "/support",
      icon: LifeBuoy,
      title: "Help & support",
      body: "FAQs plus a real inbox for tickets.",
    },
  ];

  return (
    <Layout>
      <div className="page-container py-8 sm:py-12">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-secondary text-lg font-extrabold">
              {initials(user?.name ?? user?.email)}
            </span>
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Your account
              </p>
              <h1 className="mt-0.5 text-2xl font-bold tracking-tight sm:text-3xl">
                Welcome{user?.name ? `, ${user.name}` : ""}
              </h1>
            </div>
          </div>
          <Button variant="outline" onClick={handleSignOut} className="self-start">
            <LogOut className="mr-2 size-4" /> Sign out
          </Button>
        </header>

        {/* Verification + roles */}
        <div className="mt-6 flex flex-wrap gap-2">
          {user?.emailVerificationTime ? (
            <Badge
              variant="secondary"
              className="gap-1.5 border border-emerald-400/40 px-3 py-1.5 text-emerald-400"
            >
              <MailCheck className="size-3.5" /> Email verified
            </Badge>
          ) : (
            <Badge
              variant="secondary"
              className="gap-1.5 border border-amber-400/40 px-3 py-1.5 text-amber-400"
            >
              Email not verified — check your inbox
            </Badge>
          )}
          {user?.isSeller && (
            <Badge
              variant="secondary"
              className="gap-1.5 border border-primary/40 px-3 py-1.5 text-primary"
            >
              <Store className="size-3.5" /> Seller
              {user.shopName ? ` · ${user.shopName}` : ""}
            </Badge>
          )}
          {user?.role === "admin" && (
            <Badge
              variant="secondary"
              className="gap-1.5 border border-primary/40 px-3 py-1.5 text-primary"
            >
              <ShieldCheck className="size-3.5" /> Administrator
            </Badge>
          )}
          <Badge
            variant="secondary"
            className="gap-1.5 px-3 py-1.5 text-muted-foreground"
          >
            {user?.email}
          </Badge>
        </div>

        {user?.role === "admin" && (
          <div className="mt-5 rounded-2xl border border-primary/40 bg-primary/10 p-4 text-sm">
            <p className="font-semibold">Admin tools are live</p>
            <p className="mt-1 text-muted-foreground">
              Review marketplace activity, conversion metrics, listings, and
              support tickets.
            </p>
            <Button asChild size="sm" className="mt-3">
              <Link to="/admin">
                Open admin dashboard <ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
          </div>
        )}

        {/* Quick links */}
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {quickLinks.map((link) => (
            <Link
              key={link.title}
              to={link.to}
              className="group rounded-2xl border border-border/70 bg-card p-5 transition-colors hover:border-primary/50"
            >
              <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <link.icon className="size-5" />
              </div>
              <h2 className="mt-3.5 text-sm font-semibold tracking-tight group-hover:text-primary">
                {link.title}
              </h2>
              <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                {link.body}
              </p>
            </Link>
          ))}
        </div>

        {/* Preferences */}
        <section className="mt-8 rounded-2xl border border-border/70 bg-card p-6">
          <h2 className="text-base font-bold tracking-tight">
            Communication preferences
          </h2>
          <div className="mt-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">
                Marketing emails (optional)
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Occasional product news and seller tips. This is off by
                default, strictly optional, and you can turn it off any time.
                Transactional emails (order updates, verification codes) are
                always sent.
              </p>
            </div>
            <Switch
              checked={!!user?.marketingOptIn}
              disabled={savingPreferences}
              onCheckedChange={(checked) => void handleMarketingToggle(checked)}
              aria-label="Toggle marketing emails"
            />
          </div>
        </section>

        {/* Account details */}
        <section className="mt-6 rounded-2xl border border-border/70 bg-card p-6">
          <h2 className="text-base font-bold tracking-tight">Account details</h2>
          <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                Email
              </dt>
              <dd className="mt-1 font-medium">{user?.email ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                Display name
              </dt>
              <dd className="mt-1 font-medium">{user?.name ?? "Not set"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                Account status
              </dt>
              <dd className="mt-1 font-medium">
                {user?.emailVerificationTime
                  ? "Verified"
                  : "Awaiting verification"}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                Shop
              </dt>
              <dd className="mt-1 font-medium">
                {user?.isSeller ? (
                  <Link
                    to={`/sellers/${user._id}`}
                    className="text-primary hover:underline"
                  >
                    {user.shopName ?? "Your shop"} →
                  </Link>
                ) : (
                  "Not a seller yet"
                )}
              </dd>
            </div>
          </dl>
        </section>
      </div>
    </Layout>
  );
}
