import { SiteFooter } from "@/components/marketplace/SiteFooter";
import { SiteHeader } from "@/components/marketplace/SiteHeader";
import { SellerInviteBar } from "@/components/marketplace/SellerInviteBar";
import type { ReactNode } from "react";

/** Standard marketplace page shell: offer strip, sticky header, content, footer. */
export function Layout({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <SellerInviteBar />
      <SiteHeader />
      <main className={`flex-1 ${className}`}>{children}</main>
      <SiteFooter />
    </div>
  );
}
