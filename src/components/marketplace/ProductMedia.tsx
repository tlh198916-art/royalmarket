import { CATEGORIES } from "@/convex/categories";
import { Package } from "lucide-react";

/**
 * Product image with a themed fallback tile when a seller has not uploaded
 * a photo (no fake stock imagery).
 */
export function ProductMedia({
  imageUrl,
  categoryId,
  title,
  className = "",
}: {
  imageUrl?: string | null;
  categoryId?: string;
  title: string;
  className?: string;
}) {
  const category = CATEGORIES.find((c) => c.id === categoryId);

  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={title}
        loading="lazy"
        className={`h-full w-full object-cover ${className}`}
      />
    );
  }

  return (
    <div
      className={`flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-secondary/80 via-secondary/40 to-primary/10 ${className}`}
      aria-label={title}
    >
      <span className="text-3xl" aria-hidden>
        {category?.emoji ?? "📦"}
      </span>
      <Package className="size-4 text-muted-foreground/70" />
    </div>
  );
}
