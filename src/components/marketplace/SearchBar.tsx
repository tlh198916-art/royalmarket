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
      className={`relative flex min-w-0 items-center ${className}`}
    >
      <Search
        className={`pointer-events-none absolute left-3.5 text-muted-foreground ${
          large ? "size-5" : "size-4"
        }`}
      />
      <Input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={large ? "Search products…" : "Search…"}
        aria-label="Search products, brands and categories"
        autoFocus={autoFocus}
        className={`w-full min-w-0 rounded-xl border-border/80 bg-card/80 pl-10 backdrop-blur ${
          large
            ? "h-13 py-3 pr-14 text-base shadow-lg shadow-primary/10 sm:pr-28 sm:text-lg"
            : "h-9 pr-24 text-base sm:text-sm"
        }`}
      />
      <Button
        type="submit"
        size={large ? "default" : "sm"}
        aria-label="Search"
        className={`absolute right-1.5 rounded-lg ${
          large ? "h-10 px-3 sm:px-5" : "h-7 px-3"
        }`}
      >
        {large && <Search className="size-4 sm:hidden" aria-hidden="true" />}
        <span className={large ? "hidden sm:inline" : ""}>Search</span>
      </Button>
    </form>
  );
}
