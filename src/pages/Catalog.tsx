import { EmptyState } from "@/components/marketplace/EmptyState";
import { Layout } from "@/components/marketplace/Layout";
import { ProductCard } from "@/components/marketplace/ProductCard";
import { SearchBar } from "@/components/marketplace/SearchBar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/convex/_generated/api";
import { CATEGORIES } from "@/convex/categories";
import { useMutation, useQuery } from "convex/react";
import { PackageX, SearchX, SlidersHorizontal } from "lucide-react";
import { useEffect } from "react";
import { Link, useSearchParams } from "react-router";

const SORT_OPTIONS = [
  { value: "newest", label: "Newest first" },
  { value: "popular", label: "Most viewed" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
] as const;

export default function Catalog() {
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get("q") ?? "";
  const category = searchParams.get("category") ?? "";
  const sortParam = searchParams.get("sort") ?? "newest";
  const sort = SORT_OPTIONS.some((o) => o.value === sortParam)
    ? sortParam
    : "newest";

  const products = useQuery(api.products.list, {
    q: q || undefined,
    categoryId: category || undefined,
    sortBy: sort as "newest" | "popular" | "price_asc" | "price_desc",
    limit: 60,
  });

  const trackSearch = useMutation(api.analytics.track);

  // Record each distinct search term once per session.
  useEffect(() => {
    const term = q.trim();
    if (!term) return;
    try {
      const key = `royalmarket.searched:${term.toLowerCase()}`;
      if (window.sessionStorage.getItem(key)) return;
      window.sessionStorage.setItem(key, "1");
      void trackSearch({ type: "search", query: term }).catch(() => {});
    } catch {
      // storage unavailable — skip tracking
    }
  }, [q, trackSearch]);

  const updateParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (!value) next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  };

  const activeCategory = CATEGORIES.find((c) => c.id === category);
  const hasFilters = Boolean(q || category);
  const isFilteredOut = products !== undefined && products.length === 0 && hasFilters;

  return (
    <Layout>
      <div className="page-container py-8 sm:py-12">
        <div className="flex flex-col gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              {activeCategory
                ? activeCategory.label
                : q
                  ? `Results for “${q}”`
                  : "Browse products"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {products === undefined
                ? "Loading live listings…"
                : `${products.length} ${products.length === 1 ? "listing" : "listings"} available`}
            </p>
          </div>

          <div className="max-w-xl">
            <SearchBar key={q} initialQuery={q} />
          </div>

          {/* Category pills */}
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
            <button
              type="button"
              onClick={() => updateParam("category", null)}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
                !category
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border/80 bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground"
              }`}
            >
              All categories
            </button>
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => updateParam("category", c.id)}
                className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
                  category === c.id
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border/80 bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground"
                }`}
              >
                <span aria-hidden>{c.emoji}</span> {c.label}
              </button>
            ))}
          </div>

          {/* Sort + clear */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <SlidersHorizontal className="size-3.5" />
              {hasFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 rounded-full px-3 text-xs"
                  onClick={() => setSearchParams({}, { replace: true })}
                >
                  Clear filters
                </Button>
              )}
            </div>
            <Select value={sort} onValueChange={(value) => updateParam("sort", value)}>
              <SelectTrigger className="h-9 w-[190px] text-sm">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Results */}
        <div className="mt-6">
          {products === undefined ? (
            <div className="flex justify-center py-16">
              <div className="size-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : products.length === 0 ? (
            isFilteredOut ? (
              <EmptyState
                icon={SearchX}
                title="No products match those filters"
                description="Try a different search term, clear the category filter, or browse everything currently listed."
                action={
                  <Button onClick={() => setSearchParams({}, { replace: true })}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={PackageX}
                title="No listings yet"
                description="The catalog is empty because no seller has published an item yet. Real inventory only — be the first to list."
                action={
                  <Button asChild>
                    <Link to="/sell">List an item — free</Link>
                  </Button>
                }
                secondaryAction={
                  <Button asChild variant="outline">
                    <Link to="/sell">See how selling works</Link>
                  </Button>
                }
              />
            )
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
                {products.map((product, index) => (
                  <ProductCard key={product._id} product={product} index={index} />
                ))}
              </div>
              {products.length >= 60 && (
                <div className="mt-8 flex justify-center">
                  <Badge variant="secondary" className="px-4 py-2 text-xs">
                    Showing the first 60 matching listings — refine your search
                    to narrow it down.
                  </Badge>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}
