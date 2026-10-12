import { EmptyState } from "@/components/marketplace/EmptyState";
import { Layout } from "@/components/marketplace/Layout";
import { ProductCard } from "@/components/marketplace/ProductCard";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { useQuery } from "convex/react";
import { Heart } from "lucide-react";
import { Link } from "react-router";

export default function Favorites() {
  const favorites = useQuery(api.favorites.list);

  return (
    <Layout>
      <div className="page-container py-8 sm:py-12">
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            Your account
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
            Favorites
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {favorites === undefined
              ? "Loading your saved items…"
              : favorites.length === 0
                ? "Nothing saved yet"
                : `${favorites.length} saved ${favorites.length === 1 ? "item" : "items"}`}
          </p>
        </div>

        <div className="mt-6">
          {favorites === undefined ? (
            <div className="flex justify-center py-16">
              <div className="size-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : favorites.length === 0 ? (
            <EmptyState
              icon={Heart}
              title="No favorites yet"
              description="Tap the heart on any listing to save it here. Favorites stay in sync across your devices."
              action={
                <Button asChild>
                  <Link to="/products">Browse products</Link>
                </Button>
              }
            />
          ) : (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
              {favorites.map((product, index) => (
                <ProductCard key={product._id} product={product} index={index} />
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
