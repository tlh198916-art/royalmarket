import { CATEGORIES } from "@/convex/categories";
import { useState } from "react";

/**
 * Product photo with a branded fallback when the seller has not uploaded a
 * photo, or when a stored image URL stops resolving. The fallback is a local
 * asset so it never depends on an external stock-photo service.
 */
export function ProductMedia({
  imageUrl,
  categoryId,
  title,
  className = "",
  fit = "cover",
}: {
  imageUrl?: string | null;
  categoryId?: string;
  title: string;
  className?: string;
  /** Use contain on detail pages so tall phone photos are not cropped. */
  fit?: "cover" | "contain";
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const category = CATEGORIES.find((c) => c.id === categoryId);
  const showPhoto = !!imageUrl && failedUrl !== imageUrl;
  const fitClass = fit === "contain" ? "object-contain" : "object-cover";

  if (showPhoto) {
    return (
      <img
        src={imageUrl}
        alt={title}
        loading="lazy"
        decoding="async"
        onError={() => setFailedUrl(imageUrl)}
        className={`h-full w-full ${fitClass} ${className}`}
      />
    );
  }

  return (
    <div
      className={`relative flex h-full w-full items-center justify-center overflow-hidden bg-secondary/40 ${className}`}
      aria-label={`${title}${category ? ` in ${category.label}` : ""} — no photo provided`}
    >
      <img
        src="/product-placeholder.svg"
        alt=""
        aria-hidden="true"
        loading="lazy"
        decoding="async"
        className="h-full w-full object-cover"
      />
    </div>
  );
}
