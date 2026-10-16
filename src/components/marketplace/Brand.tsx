import { Crown } from "lucide-react";
import { Link } from "react-router";

/** Royalmarket wordmark + crown tile. Always links home. */
export function Brand({
  className = "",
  size = "md",
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const tile =
    size === "lg"
      ? "size-12 rounded-2xl"
      : size === "sm"
        ? "size-8 rounded-lg"
        : "size-9 rounded-xl";
  const text =
    size === "lg" ? "text-2xl" : size === "sm" ? "text-base" : "text-lg";
  const icon = size === "lg" ? "size-6" : size === "sm" ? "size-4" : "size-5";

  return (
    <Link
      to="/"
      className={`group flex items-center gap-2.5 ${className}`}
      aria-label="Royalmarket home"
    >
      <span
        className={`flex ${tile} items-center justify-center bg-primary text-primary-foreground transition-transform duration-200 group-hover:-rotate-6 group-hover:scale-105`}
      >
        <Crown className={icon} />
      </span>
      <span className={`${text} font-bold tracking-tight text-foreground`}>
        Royal<span className="text-primary">market</span>
      </span>
    </Link>
  );
}
