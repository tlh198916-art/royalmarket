import { ArrowRight, Sparkles } from "lucide-react";
import { Link } from "react-router";

/** Sitewide reminder of the individual-seller offer. */
export function SellerInviteBar() {
  return (
    <div className="border-b border-primary/20 bg-primary/[0.07]">
      <div className="page-container flex flex-wrap items-center justify-center gap-x-3 gap-y-1 py-2 text-center text-[11px] font-medium sm:text-xs">
        <span className="flex items-center gap-1.5 text-primary">
          <Sparkles className="size-3.5 shrink-0" aria-hidden />
          Sell free on Royalmarket
        </span>
        <span className="text-muted-foreground">
          $0 to join · $0 per listing · 0% commission
        </span>
        <Link
          to="/sell"
          className="inline-flex items-center gap-1 font-semibold text-primary underline-offset-4 hover:underline"
        >
          Start selling <ArrowRight className="size-3" aria-hidden />
        </Link>
      </div>
    </div>
  );
}
