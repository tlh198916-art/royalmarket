import { Brand } from "@/components/marketplace/Brand";
import { SearchBar } from "@/components/marketplace/SearchBar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { useCart } from "@/lib/cart";
import { initials } from "@/lib/format";
import { useMutation } from "convex/react";
import {
  Heart,
  LayoutDashboard,
  LogOut,
  Menu,
  PackageCheck,
  ScrollText,
  ShieldCheck,
  ShoppingCart,
  Store,
  User,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router";

const navLinks = [
  { to: "/products", label: "Browse" },
  { to: "/sell", label: "Sell" },
  { to: "/pricing", label: "Pricing" },
  { to: "/support", label: "Support" },
];

export function SiteHeader() {
  const { user, isLoading, isAuthenticated, signOut } = useAuth();
  const { count } = useCart();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const trackSignup = useMutation(api.analytics.trackSignup);
  const signupTracked = useRef(false);

  // Count a verified sign-up exactly once per account (server de-dupes too).
  useEffect(() => {
    if (user?.emailVerificationTime && !signupTracked.current) {
      signupTracked.current = true;
      void trackSignup({}).catch(() => {});
    }
  }, [user, trackSignup]);

  const closeMobileMenu = () => setMobileOpen(false);

  const handleSignOut = async () => {
    try {
      await signOut();
      navigate("/");
    } catch (error) {
      console.error("Sign out error:", error);
    }
  };

  const signInHref = `/auth?returnTo=${encodeURIComponent(
    `${location.pathname}${location.search}`,
  )}`;

  const accountMenu = isLoading ? (
    <div className="size-9 animate-pulse rounded-full bg-muted" />
  ) : !isAuthenticated ? (
    <div className="flex items-center gap-2">
      <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
        <Link to="/sell">Start selling</Link>
      </Button>
      <Button asChild size="sm">
        <Link to={signInHref}>Sign in</Link>
      </Button>
    </div>
  ) : (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className="flex size-9 items-center justify-center rounded-full border border-border/80 bg-secondary text-xs font-bold text-foreground transition-colors hover:border-primary/60"
        >
          {initials(user?.name ?? user?.email)}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>
          <p className="truncate text-sm font-semibold">
            {user?.name ?? user?.shopName ?? "Your account"}
          </p>
          <p className="truncate text-xs font-normal text-muted-foreground">
            {user?.email ?? "Verified account"}
          </p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="cursor-pointer" onClick={() => navigate("/dashboard")}>
          <LayoutDashboard className="mr-2 size-4" /> Account
        </DropdownMenuItem>
        <DropdownMenuItem className="cursor-pointer" onClick={() => navigate("/orders")}>
          <ScrollText className="mr-2 size-4" /> Orders
        </DropdownMenuItem>
        <DropdownMenuItem className="cursor-pointer" onClick={() => navigate("/favorites")}>
          <Heart className="mr-2 size-4" /> Favorites
        </DropdownMenuItem>
        <DropdownMenuItem className="cursor-pointer" onClick={() => navigate("/sell/dashboard")}>
          <Store className="mr-2 size-4" /> Seller dashboard
        </DropdownMenuItem>
        {user?.role === "admin" && (
          <DropdownMenuItem className="cursor-pointer" onClick={() => navigate("/admin")}>
            <ShieldCheck className="mr-2 size-4" /> Admin
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="cursor-pointer text-destructive focus:text-destructive"
          onClick={handleSignOut}
        >
          <LogOut className="mr-2 size-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <header className="sticky top-0 z-50 border-b border-border/70 bg-background/85 backdrop-blur-lg">
      <div className="page-container flex h-16 items-center gap-3">
        <Brand />

        <nav className="ml-4 hidden items-center gap-1 md:flex">
          {navLinks.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                `rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                }`
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>

        <div className="mx-auto hidden w-full max-w-sm md:block">
          <SearchBar />
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Link
            to="/checkout"
            aria-label={`Cart, ${count} item${count === 1 ? "" : "s"}`}
            className="relative hidden size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground sm:flex"
          >
            <ShoppingCart className="size-5" />
            {count > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                {count > 9 ? "9+" : count}
              </span>
            )}
          </Link>
          {accountMenu}
          <button
            type="button"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            onClick={() => setMobileOpen((open) => !open)}
            className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground md:hidden"
          >
            {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="border-t border-border/70 bg-background/95 px-4 pb-4 pt-3 backdrop-blur-lg md:hidden">
          <SearchBar autoFocus onSubmitted={() => setMobileOpen(false)} />
          <nav className="mt-3 grid gap-1">
            {navLinks.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                onClick={closeMobileMenu}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                  }`
                }
              >
                {link.label}
              </NavLink>
            ))}
            <Link
              to="/checkout"
              onClick={closeMobileMenu}
              className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
            >
              <ShoppingCart className="size-4" /> Cart
              {count > 0 && (
                <span className="ml-auto rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground">
                  {count}
                </span>
              )}
            </Link>
          </nav>
          <div className="mt-3 grid gap-2 border-t border-border/70 pt-3">
            {isAuthenticated ? (
              <>
                <Button asChild variant="secondary">
                  <Link to="/dashboard" onClick={closeMobileMenu}>
                    <User className="mr-2 size-4" /> Account
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link to="/orders" onClick={closeMobileMenu}>
                    <ScrollText className="mr-2 size-4" /> Orders
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link to="/favorites" onClick={closeMobileMenu}>
                    <Heart className="mr-2 size-4" /> Favorites
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link to="/sell/dashboard" onClick={closeMobileMenu}>
                    <PackageCheck className="mr-2 size-4" /> Seller dashboard
                  </Link>
                </Button>
                <Button variant="ghost" onClick={handleSignOut}>
                  <LogOut className="mr-2 size-4" /> Sign out
                </Button>
              </>
            ) : (
              <>
                <Button asChild>
                  <Link to={signInHref} onClick={closeMobileMenu}>
                    Sign in or sign up
                  </Link>
                </Button>
                <Button asChild variant="secondary">
                  <Link to="/sell" onClick={closeMobileMenu}>
                    Start selling — free
                  </Link>
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
