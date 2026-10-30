import { EmptyState } from "@/components/marketplace/EmptyState";
import { Layout } from "@/components/marketplace/Layout";
import { ProductCard } from "@/components/marketplace/ProductCard";
import { SearchBar } from "@/components/marketplace/SearchBar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/convex/_generated/api";
import { CATEGORIES } from "@/convex/categories";
import { usePageMeta } from "@/lib/seo";
import { useAction, useMutation, useQuery } from "convex/react";
import { PackageX, SearchX, SlidersHorizontal, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";

const SORT_OPTIONS = [
  { value: "newest", label: "Newest first" },
  { value: "featured", label: "Featured first" },
  { value: "popular", label: "Most viewed" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
] as const;

const CONDITION_OPTIONS = [
  { value: "new", label: "New" },
  { value: "like_new", label: "Like new" },
  { value: "good", label: "Good" },
  { value: "fair", label: "Fair" },
] as const;

const RATING_OPTIONS = [
  { value: "4", label: "4★ & up" },
  { value: "3", label: "3★ & up" },
  { value: "2", label: "2★ & up" },
] as const;

const FULFILLMENT_OPTIONS = [
  { value: "pickup", label: "🏷️ Local pickup" },
  { value: "shipping", label: "🚚 Shipping" },
  { value: "delivery", label: "📍 Local delivery" },
] as const;

export default function Catalog() {
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get("q") ?? "";
  const category = searchParams.get("category") ?? "";
  const fulfillmentParam = searchParams.get("fulfillment") ?? "";
  const fulfillment = (["pickup", "shipping", "delivery"] as const).includes(
    fulfillmentParam as "pickup" | "shipping" | "delivery",
  )
    ? (fulfillmentParam as "pickup" | "shipping" | "delivery")
    : undefined;
  const sortParam = searchParams.get("sort") ?? "newest";
  const sort = SORT_OPTIONS.some((o) => o.value === sortParam)
    ? sortParam
    : "newest";

  const minParam = searchParams.get("min") ?? "";
  const maxParam = searchParams.get("max") ?? "";
  const ratingParam = searchParams.get("rating") ?? "";
  const conditionParam = searchParams.get("condition") ?? "";
  const toCents = (value: string) => {
    const parsed = Number(value);
    return value.trim() !== "" && Number.isFinite(parsed) && parsed >= 0
      ? Math.round(parsed * 100)
      : undefined;
  };
  const condition = CONDITION_OPTIONS.some((o) => o.value === conditionParam)
    ? (conditionParam as "new" | "like_new" | "good" | "fair")
    : undefined;
  const minRating = RATING_OPTIONS.some((o) => o.value === ratingParam)
    ? Number(ratingParam)
    : undefined;

  const products = useQuery(api.products.list, {
    q: q || undefined,
    categoryId: category || undefined,
    sortBy: sort as
      | "newest"
      | "featured"
      | "popular"
      | "price_asc"
      | "price_desc",
    fulfillment,
    minPriceCents: toCents(minParam),
    maxPriceCents: toCents(maxParam),
    minRating,
    condition,
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

  // AI semantic search: embeds the query and merges vector matches ahead of
  // the keyword results. Debounced; failures fall back to keyword-only.
  const semanticSearch = useAction(api.ai.semanticSearch);
  type SemanticResults = Awaited<ReturnType<typeof semanticSearch>>;
  const [semantic, setSemantic] = useState<{
    term: string;
    results: SemanticResults;
  } | null>(null);
  const [aiFailed, setAiFailed] = useState(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const term = q.trim();
    const categoryId = category || undefined;
    const requestId = ++requestIdRef.current;
    if (term.length < 3) return;
    const timer = window.setTimeout(() => {
      semanticSearch({ q: term, categoryId, limit: 40 })
        .then((results) => {
          if (requestIdRef.current !== requestId) return;
          setSemantic({ term, results });
          setAiFailed(false);
        })
        .catch(() => {
          if (requestIdRef.current !== requestId) return;
          setSemantic(null);
          setAiFailed(true);
        });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [q, category, semanticSearch]);

  // Show AI matches only for the query that produced them, ranked first.
  const visibleSemantic =
    semantic && semantic.term === q.trim() && q.trim().length >= 3
      ? semantic.results
      : null;

  const merged = useMemo(() => {
    if (!visibleSemantic) return products;
    if (!products) return undefined;
    const seen = new Set(visibleSemantic.map((p) => p._id));
    return [
      ...visibleSemantic,
      ...products.filter((p) => !seen.has(p._id)),
    ];
  }, [visibleSemantic, products]);

  const updateParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (!value) next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  };

  const activeCategory = CATEGORIES.find((c) => c.id === category);
  const hasFilters = Boolean(
    q || category || fulfillment || minParam || maxParam || ratingParam || conditionParam,
  );
  usePageMeta({
    title: activeCategory
      ? `${activeCategory.label} listings`
      : q
        ? `Search: ${q}`
        : "Browse marketplace listings",
    description: activeCategory
      ? `Shop ${activeCategory.label} from verified Royalmarket sellers. Filter by price, condition, rating and fulfillment.`
      : "Browse live marketplace listings from verified sellers. Filter by category, price, condition, rating and fulfillment.",
    canonicalPath: "/products",
  });
  const isFilteredOut = merged !== undefined && merged.length === 0 && hasFilters;

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
              {merged === undefined
                ? "Loading live listings…"
                : `${merged.length} ${merged.length === 1 ? "listing" : "listings"} available`}
            </p>
            {(visibleSemantic && visibleSemantic.length > 0) ||
            (aiFailed && q.trim().length >= 3) ? (
              <div className="mt-2.5 flex flex-wrap gap-2">
                {visibleSemantic && visibleSemantic.length > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
                    <Sparkles className="size-3" /> AI matches for “
                    {q.trim()}” shown first
                  </span>
                )}
                {aiFailed && q.trim().length >= 3 && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                    AI search unavailable — keyword matches only
                  </span>
                )}
              </div>
            ) : null}
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

          {/* Fulfillment filters */}
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
            <span className="shrink-0 self-center pr-1 text-xs font-medium text-muted-foreground">
              Fulfillment:
            </span>
            {FULFILLMENT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() =>
                  updateParam(
                    "fulfillment",
                    fulfillment === option.value ? null : option.value,
                  )
                }
                className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
                  fulfillment === option.value
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border/80 bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          {/* Price, rating and condition filters */}
          <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-border/70 bg-card/50 p-3">
            <div className="flex items-end gap-1.5">
              <div>
                <label
                  htmlFor="min-price"
                  className="text-[11px] font-medium text-muted-foreground"
                >
                  Min $
                </label>
                <Input
                  id="min-price"
                  inputMode="decimal"
                  type="number"
                  min={0}
                  placeholder="0"
                  defaultValue={minParam}
                  className="mt-1 h-9 w-24 text-sm"
                  onBlur={(event) => updateParam("min", event.target.value || null)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter")
                      updateParam("min", event.currentTarget.value || null);
                  }}
                />
              </div>
              <span className="pb-2.5 text-xs text-muted-foreground">–</span>
              <div>
                <label
                  htmlFor="max-price"
                  className="text-[11px] font-medium text-muted-foreground"
                >
                  Max $
                </label>
                <Input
                  id="max-price"
                  inputMode="decimal"
                  type="number"
                  min={0}
                  placeholder="Any"
                  defaultValue={maxParam}
                  className="mt-1 h-9 w-24 text-sm"
                  onBlur={(event) => updateParam("max", event.target.value || null)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter")
                      updateParam("max", event.currentTarget.value || null);
                  }}
                />
              </div>
            </div>

            <Select
              value={ratingParam || "any"}
              onValueChange={(value) =>
                updateParam("rating", value === "any" ? null : value)
              }
            >
              <SelectTrigger className="h-9 w-[130px] text-sm">
                <SelectValue placeholder="Rating" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any rating</SelectItem>
                {RATING_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={conditionParam || "any"}
              onValueChange={(value) =>
                updateParam("condition", value === "any" ? null : value)
              }
            >
              <SelectTrigger className="h-9 w-[145px] text-sm">
                <SelectValue placeholder="Condition" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any condition</SelectItem>
                {CONDITION_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
          {merged === undefined ? (
            <div className="flex justify-center py-16">
              <div className="size-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : merged.length === 0 ? (
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
                {merged.map((product, index) => (
                  <ProductCard key={product._id} product={product} index={index} />
                ))}
              </div>
              {merged.length >= 60 && (
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
