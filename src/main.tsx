import { Toaster } from "@/components/ui/sonner";
import { RequireAuth } from "@/components/RequireAuth";
import { CartProvider } from "@/lib/cart";
import { VlyToolbar } from "../vly-toolbar-readonly.tsx";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import React, { StrictMode, useEffect, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router";
import "./index.css";

// Lazy load route components for better code splitting
const Landing = lazy(() => import("./pages/Landing.tsx"));
const AuthPage = lazy(() => import("./pages/Auth.tsx"));
const Dashboard = lazy(() => import("./pages/Dashboard.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));
const Catalog = lazy(() => import("./pages/Catalog.tsx"));
const ProductDetail = lazy(() => import("./pages/ProductDetail.tsx"));
const SellerProfile = lazy(() => import("./pages/SellerProfile.tsx"));
const SellLanding = lazy(() => import("./pages/SellLanding.tsx"));
const SellerGuide = lazy(() => import("./pages/SellerGuide.tsx"));
const SellerCategory = lazy(() => import("./pages/SellerCategory.tsx"));
const FoundingSellers = lazy(() => import("./pages/FoundingSellers.tsx"));
const Pricing = lazy(() => import("./pages/Pricing.tsx"));
const SellPlans = lazy(() => import("./pages/SellPlans.tsx"));
const ListingForm = lazy(() => import("./pages/ListingForm.tsx"));
const SellerDashboard = lazy(() => import("./pages/SellerDashboard.tsx"));
const Checkout = lazy(() => import("./pages/Checkout.tsx"));
const Orders = lazy(() => import("./pages/Orders.tsx"));
const Favorites = lazy(() => import("./pages/Favorites.tsx"));
const Admin = lazy(() => import("./pages/Admin.tsx"));
const Support = lazy(() => import("./pages/Support.tsx"));
const Events = lazy(() => import("./pages/Events.tsx"));

// Simple loading fallback for route transitions
function RouteLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-pulse text-muted-foreground">Loading...</div>
    </div>
  );
}

/** Silent error boundary — if VlyToolbar crashes it renders nothing instead of
 *  crashing the whole app (e.g. hook errors in the browser runtime). */
class ToolbarErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err: Error) {
    console.warn("[VlyToolbar] Caught error, toolbar disabled:", err.message);
  }
  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

/** Hard guard so runtime errors never leave the preview as a blank page. */
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string; stack: string }
> {
  state = { hasError: false, message: "", stack: "" };
  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: error.message || "Unknown runtime error",
      stack: error.stack || "",
    };
  }
  componentDidCatch(err: Error) {
    console.error("[Preview] Root crash:", err);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
          <div className="max-w-lg text-center">
            <p className="text-lg font-bold tracking-tight">
              Something went wrong
            </p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              We couldn&apos;t load this page. Reload to try again — your cart
              and account are still safe.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              Reload page
            </button>
            {import.meta.env.DEV && this.state.stack && (
              <details className="mt-5 text-left">
                <summary className="cursor-pointer text-xs text-muted-foreground">
                  Technical details (development only)
                </summary>
                <pre className="mt-2 max-h-40 overflow-auto rounded border border-border/60 p-2 text-[10px] leading-4 text-muted-foreground/80">
                  {this.state.message}\n\n{this.state.stack}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);



function RouteSyncer() {
  const location = useLocation();
  useEffect(() => {
    window.parent.postMessage(
      { type: "iframe-route-change", path: location.pathname },
      "*",
    );
  }, [location.pathname]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "navigate") {
        if (event.data.direction === "back") window.history.back();
        if (event.data.direction === "forward") window.history.forward();
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return null;
}


createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootErrorBoundary>
      <ToolbarErrorBoundary>
        <VlyToolbar />
      </ToolbarErrorBoundary>
      <ConvexAuthProvider client={convex}>
        <BrowserRouter>
          <RouteSyncer />
          <CartProvider>
            <Suspense fallback={<RouteLoading />}>
              <Routes>
                {/* Public storefront */}
                <Route path="/" element={<Landing />} />
                <Route path="/products" element={<Catalog />} />
                <Route path="/products/:id" element={<ProductDetail />} />
                <Route path="/sellers/:userId" element={<SellerProfile />} />
                <Route path="/sell" element={<SellLanding />} />
                <Route path="/sell/guide" element={<SellerGuide />} />
                <Route
                  path="/sell/category/:categoryId"
                  element={<SellerCategory />}
                />
                <Route path="/founding-sellers" element={<FoundingSellers />} />
                <Route path="/pricing" element={<Pricing />} />
                <Route path="/events" element={<Events />} />
                <Route path="/sell/plans" element={<SellPlans />} />
                <Route path="/support" element={<Support />} />
                <Route
                  path="/auth"
                  element={<AuthPage redirectAfterAuth="/dashboard" />}
                />

                {/* Protected — buyer & seller tooling */}
                <Route
                  path="/dashboard"
                  element={
                    <RequireAuth
                      title="Sign in to view your account"
                      description="Your orders, favorites, and preferences live here."
                    >
                      <Dashboard />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/orders"
                  element={
                    <RequireAuth
                      title="Sign in to see your orders"
                      description="Order history is private to your verified account."
                    >
                      <Orders />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/favorites"
                  element={
                    <RequireAuth
                      title="Sign in to view favorites"
                      description="Your saved items are tied to your account."
                    >
                      <Favorites />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/checkout"
                  element={
                    <RequireAuth
                      title="Sign in to check out"
                      description="Checkout requires a verified account so sellers know buyers are real."
                    >
                      <Checkout />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/sell/new"
                  element={
                    <RequireAuth
                      title="Sign in to create a listing"
                      description="Selling requires a verified account — it's free to post."
                    >
                      <ListingForm />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/sell/dashboard"
                  element={
                    <RequireAuth
                      title="Sign in to manage your shop"
                      description="Your listings, orders, and shop profile live in the seller dashboard."
                    >
                      <SellerDashboard />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/admin"
                  element={
                    <RequireAuth
                      title="Sign in to access admin"
                      description="The admin dashboard is limited to administrator accounts."
                    >
                      <Admin />
                    </RequireAuth>
                  }
                />

                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </CartProvider>
        </BrowserRouter>
        <Toaster />
      </ConvexAuthProvider>
    </RootErrorBoundary>
  </StrictMode>,
);
