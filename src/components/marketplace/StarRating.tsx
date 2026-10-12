import { Star } from "lucide-react";

/** Star rating display; renders nothing decorative when there is no data. */
export function StarRating({
  value,
  size = "sm",
  className = "",
}: {
  value: number | null;
  size?: "sm" | "md";
  className?: string;
}) {
  if (value === null) {
    return null;
  }
  const starSize = size === "md" ? "size-5" : "size-3.5";
  return (
    <span
      className={`inline-flex items-center gap-0.5 ${className}`}
      aria-label={`Rated ${value.toFixed(1)} out of 5`}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={`${starSize} ${
            star <= Math.round(value)
              ? "fill-amber-400 text-amber-400"
              : "text-muted-foreground/40"
          }`}
        />
      ))}
      <span className="ml-1 text-xs font-semibold text-muted-foreground">
        {value.toFixed(1)}
      </span>
    </span>
  );
}
