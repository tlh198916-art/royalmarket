import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAuth } from "@/hooks/use-auth";
import { useMutation, useQuery } from "convex/react";
import { Heart } from "lucide-react";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";

/** Heart toggle for saved products; signed-out visitors go to sign-in. */
export function FavoriteButton({
  productId,
  className = "",
  size = "icon",
}: {
  productId: string;
  className?: string;
  size?: "sm" | "icon";
}) {
  const { isAuthenticated, isLoading } = useAuth();
  const favoriteIds = useQuery(api.favorites.ids);
  const toggleFavorite = useMutation(api.favorites.toggle);
  const navigate = useNavigate();
  const location = useLocation();
  const [busy, setBusy] = useState(false);

  const favoriteId = productId as Id<"products">;
  const isFavorite = favoriteIds?.includes(favoriteId) ?? false;

  const handleClick = async (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (isLoading) return;
    if (!isAuthenticated) {
      toast.info("Sign in to save items to your favorites.");
      navigate(
        `/auth?returnTo=${encodeURIComponent(
          `${location.pathname}${location.search}`,
        )}`,
      );
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const result = await toggleFavorite({ productId: favoriteId });
      toast.success(
        result.favorited ? "Saved to favorites" : "Removed from favorites",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update favorites.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      type="button"
      variant="secondary"
      size={size}
      aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
      onClick={handleClick}
      className={`rounded-full border border-border/70 bg-background/80 backdrop-blur transition-colors hover:border-primary/60 hover:bg-background ${
        isFavorite ? "text-primary" : "text-muted-foreground"
      } ${className}`}
    >
      <Heart className={size === "sm" ? "size-3.5" : "size-4"} fill={isFavorite ? "currentColor" : "none"} />
    </Button>
  );
}
