import { Brand } from "@/components/marketplace/Brand";
import { Badge } from "@/components/ui/badge";
import { HeartHandshake, Mail, ShieldCheck } from "lucide-react";
import { Link } from "react-router";

const columns = [
  {
    heading: "Marketplace",
    links: [
      { to: "/products", label: "Browse products" },
      { to: "/?view=categories", label: "Categories" },
      { to: "/sell", label: "Start selling" },
      { to: "/sell#fees", label: "Fees & payouts" },
      { to: "/pricing", label: "Plans & pricing" },
    ],
  },
  {
    heading: "Account",
    links: [
      { to: "/auth", label: "Sign in / Sign up" },
      { to: "/orders", label: "Order history" },
      { to: "/favorites", label: "Favorites" },
      { to: "/dashboard", label: "Account settings" },
    ],
  },
  {
    heading: "Support",
    links: [
      { to: "/support", label: "Help center" },
      { to: "/support#contact", label: "Contact us" },
      { to: "/support#returns", label: "Returns policy" },
      { to: "/support#shipping", label: "Shipping" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-border/70 bg-card/40">
      <div className="page-container py-12">
        <div className="grid gap-10 md:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div className="max-w-sm">
            <Brand />
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              A modern multi-vendor marketplace where listing is free, accounts
              are email-verified, and availability is always transparent.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge variant="secondary" className="gap-1.5 font-medium">
                <ShieldCheck className="size-3.5" /> Verified accounts
              </Badge>
              <Badge variant="secondary" className="gap-1.5 font-medium">
                <HeartHandshake className="size-3.5" /> Free to post
              </Badge>
            </div>
          </div>

          {columns.map((column) => (
            <div key={column.heading}>
              <h3 className="text-sm font-semibold tracking-tight">
                {column.heading}
              </h3>
              <ul className="mt-4 space-y-2.5">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      to={link.to}
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-border/70 pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {new Date().getFullYear()} TLHmarketplacepro. List free, sell
            transparently.
          </p>
          <a
            href="mailto:support@tlhmarketplacepro.example"
            className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
          >
            <Mail className="size-3.5" /> Questions? Open a support ticket
          </a>
        </div>
      </div>
    </footer>
  );
}
