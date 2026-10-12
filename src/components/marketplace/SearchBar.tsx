import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";

export function SearchBar({
  initialQuery = "",
  large = false,
  className = "",
  autoFocus = false,
  onSubmitted,
}: {
  initialQuery?: string;
  large?: boolean;
  className?: string;
  autoFocus?: boolean;
  onSubmitted?: () => void;
}) {
  const navigate = useNavigate();
  // Parent pages remount this component with `key={query}` so the input
  // re-initializes when the URL query changes — no sync effect needed.
  const [value, setValue] = useState(initialQuery);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const q = value.trim();
    navigate(q ? `/products?q=${encodeURIComponent(q)}` : "/products");
    onSubmitted?.();
  };

  return (
    <form
      onSubmit={handleSubmit}
      role="search"
      className={`relative flex items-center ${className}`}
    >
      <Search
        className={`pointer-events-none absolute left-3.5 text-muted-foreground ${
          large ? "size-5" : "size-4"
        }`}
      />
      <Input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={large ? "Search products, brands, categories…" : "Search…"}
        aria-label="Search products"
        autoFocus={autoFocus}
        className={`w-full rounded-xl border-border/80 bg-card/80 pl-10 pr-28 backdrop-blur ${
          large
            ? "h-13 py-3 text-base shadow-lg shadow-primary/10 sm:text-lg"
            : "h-9 pr-24 text-sm"
        }`}
      />
      <Button
        type="submit"
        size={large ? "default" : "sm"}
        className={`absolute right-1.5 rounded-lg ${
          large ? "h-10 px-5" : "h-7 px-3"
        }`}
      >
        Search
      </Button>
    </form>
  );
}
