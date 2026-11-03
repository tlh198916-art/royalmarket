import { EmptyState } from "@/components/marketplace/EmptyState";
import { Layout } from "@/components/marketplace/Layout";
import { ProductCard } from "@/components/marketplace/ProductCard";
import { SellerPlanComparison } from "@/components/marketplace/SellerPlanComparison";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { CATEGORIES, getCategory } from "@/convex/categories";
import { useAuth } from "@/hooks/use-auth";
import { useReferralCapture } from "@/hooks/use-referral-capture";
import { usePageMeta } from "@/lib/seo";
import { useQuery } from "convex/react";
import {
  ArrowRight,
  Camera,
  CheckCircle2,
  CircleDollarSign,
  Crown,
  Handshake,
  PackageSearch,
  Rocket,
  ShieldCheck,
  Sparkles,
  Tag,
} from "lucide-react";
import { Link, useParams } from "react-router";

const CATEGORY_COPY: Record<
  string,
  { headline: string; intro: string; ideas: string[]; pricingTip: string }
> = {
  electronics: {
    headline: "Turn unused tech into cash",
    intro:
      "Phones, laptops, headphones, cameras, and gaming gear are some of the most searched items on a marketplace. Clear model numbers and honest condition notes matter more than perfect photos.",
    ideas: [
      "Previous phone or tablet in working condition",
      "Headphones, speakers, or a spare console controller",
      "Camera gear, cables, docks, or unopened accessories",
    ],
    pricingTip:
      "Search the exact model number and compare sold prices, then price slightly below the nearest equivalent live listing.",
  },
  fashion: {
    headline: "Sell the pieces you no longer wear",
    intro:
      "Clothing, shoes, bags, and accessories sell when the size, fit, material, and flaws are easy to find. Measure flat and photograph labels.",
    ideas: [
      "Jackets, coats, and shoes in good condition",
      "Bags, belts, scarves, and jewelry",
      "Unworn or barely worn pieces from your closet",
    ],
    pricingTip:
      "Price by brand, condition, and size. Include the original retail price only if you can verify it honestly.",
  },
  home: {
    headline: "Clear space and sell home goods",
    intro:
      "Furniture, kitchen tools, decor, and small appliances are natural local-pickup listings. Dimensions and pickup area prevent wasted trips.",
    ideas: [
      "Small furniture and storage pieces",
      "Cookware, bakeware, and small appliances",
      "Lamps, mirrors, planters, and seasonal decor",
    ],
    pricingTip:
      "Bulky items often sell faster with local pickup and a fair, collection-friendly price than with shipping added.",
  },
  collectibles: {
    headline: "Find a home for your collectibles",
    intro:
      "Cards, figures, coins, records, and vintage finds need specific titles and clear close-ups. Serious collectors will ask for provenance and condition details.",
    ideas: [
      "Trading cards, comics, and memorabilia",
      "Vintage toys, figures, and die-cast models",
      "Records, coins, stamps, and limited editions",
    ],
    pricingTip:
      "Check completed sales for the exact item and condition. A rare item is not automatically valuable without a buyer.",
  },
  sports: {
    headline: "Sell sports and outdoor gear",
    intro:
      "Bikes, fitness equipment, camping gear, and seasonal sports equipment move well when size, model, and wear are obvious.",
    ideas: [
      "Bikes, scooters, and skateboards",
      "Camping, hiking, and fishing gear",
      "Dumbbells, racks, and home fitness equipment",
    ],
    pricingTip:
      "For bikes and fitness gear, list the frame or model size and whether collection is needed. Local pickup is often the deciding factor.",
  },
  toys: {
    headline: "Pass on toys and games",
    intro:
      "Building sets, board games, dolls, and outdoor toys sell when buyers know every piece is accounted for. Photograph the complete set and list missing parts.",
    ideas: [
      "Complete building sets and instruction books",
      "Board games, puzzles, and card games",
      "Dolls, figures, and outdoor play equipment",
    ],
    pricingTip:
      "Complete sets command more than loose pieces. Be explicit about missing pieces, and price incomplete sets accordingly.",
  },
  beauty: {
    headline: "Sell beauty and wellness finds",
    intro:
      "Unopened cosmetics, skincare, haircare, and wellness tools are in demand. Hygiene matters: only list sealed or safely sanitizable items.",
    ideas: [
      "Unopened skincare, makeup, and fragrance",
      "Hair tools and grooming devices",
      "Sealed wellness and self-care gifts",
    ],
    pricingTip:
      "Never sell opened or expired cosmetics. For tools, state whether they have been sanitized and include the model.",
  },
  books: {
    headline: "Give books and media a second life",
    intro:
      "Books, records, CDs, and DVDs appeal to buyers hunting specific editions. Include the title, author or artist, format, and condition.",
    ideas: [
      "Novels, textbooks, and cookbooks",
      "Vinyl records, CDs, and cassettes",
      "DVDs, Blu-rays, and box sets",
    ],
    pricingTip:
      "Check the exact edition and format. A common paperback is worth less than a scarce hardcover or sealed record.",
  },
  automotive: {
    headline: "Sell automotive parts and gear",
    intro:
      "Spare parts, tools, accessories, and vehicle gear need part numbers and fitment details. Photograph labels and any damage.",
    ideas: [
      "Unused or gently used car parts",
      "Tools, jacks, and garage equipment",
      "Roof racks, mats, and vehicle accessories",
    ],
    pricingTip:
      "Include the part number, compatible models, and whether it is new or used. Fitment questions are the main reason buyers hesitate.",
  },
  art: {
    headline: "Sell art and handmade work",
    intro:
      "Original art, prints, crafts, and handmade goods stand out with clear dimensions, materials, and provenance. Tell the story without inventing one.",
    ideas: [
      "Original paintings, prints, and photographs",
      "Handmade ceramics, textiles, and jewelry",
      "Craft supplies and unfinished projects",
    ],
    pricingTip:
      "Price by materials, time, size, and comparable work. State whether a frame, hanging hardware, or certificate is included.",
  },
};

export default function SellerCategory() {
  const { categoryId = "" } = useParams();
  const category = getCategory(categoryId);
  const copy = CATEGORY_COPY[categoryId];
  const { user, isAuthenticated } = useAuth();
  const referralCode = useReferralCapture(`category-${categoryId}`);
  const listings = useQuery(
    api.products.list,
    category
      ? {
          categoryId: category.id,
          sortBy: "newest" as const,
          availableOnly: true,
          limit: 24,
        }
      : "skip",
  );

  const listingHref = category
    ? `/sell/new?category=${category.id}`
    : "/sell/new";
  const ctaHref = isAuthenticated
    ? listingHref
    : `/auth?returnTo=${encodeURIComponent(listingHref)}`;

  usePageMeta({
    title: category
      ? `Sell ${category.label} on Royalmarket`
      : "Sell on Royalmarket",
    description: category
      ? `Open a free Royalmarket shop and list ${category.label.toLowerCase()} with $0 listing fees and 0% commission. See category tips and start a listing.`
      : "Open a free Royalmarket seller shop.",
    canonicalPath: `/sell/category/${categoryId}`,
  });

  if (!category || !copy) {
    return (
      <Layout>
        <div className="page-container py-16">
          <EmptyState
            icon={PackageSearch}
            title="Category not found"
            description="That category does not exist. Browse the available categories and choose where your item fits."
            action={
              <Button asChild>
                <Link to="/sell">See all seller categories</Link>
              </Button>
            }
          />
        </div>
      </Layout>
    );
  }

  const liveCount = listings?.length ?? 0;

  return (
    <Layout>
      <section className="relative overflow-hidden border-b border-border/70">
        <div className="hero-glow pointer-events-none absolute inset-0" aria-hidden />
        <div className="page-container relative py-14 sm:py-18">
          <div className="mx-auto max-w-3xl text-center">
            <Badge
              variant="secondary"
              className="border border-primary/30 bg-primary/10 text-primary"
            >
              <span aria-hidden>{category.emoji}</span> {category.label} seller
              recruitment
            </Badge>
            <h1 className="mt-5 text-3xl font-extrabold leading-tight tracking-tight sm:text-5xl">
              {copy.headline}
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
              {copy.intro}
            </p>
            {referralCode && (
              <p className="mx-auto mt-4 inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">
                <Handshake className="size-3.5" /> Invited by a fellow seller —
                code {referralCode}
              </p>
            )}
            <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
              <Button asChild size="lg" className="px-7">
                <Link to={ctaHref}>
                  {user?.isSeller
                    ? `List in ${category.label}`
                    : `Start selling in ${category.label}`}
                  <ArrowRight className="ml-2 size-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="secondary" className="px-7">
                <Link to={`/products?category=${category.id}`}>
                  Browse live {category.label.toLowerCase()}
                </Link>
              </Button>
            </div>
            <div className="mt-6 flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs font-medium text-muted-foreground">
              <span>$0 to join</span>
              <span>·</span>
              <span>$0 per listing</span>
              <span>·</span>
              <span>0% commission</span>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-border/70 bg-card/30 py-14">
        <div className="page-container grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-3xl border border-border/70 bg-card p-6 sm:p-8">
            <h2 className="text-xl font-bold tracking-tight">
              What sells in {category.label}
            </h2>
            <ul className="mt-5 space-y-3">
              {copy.ideas.map((idea) => (
                <li key={idea} className="flex items-start gap-2.5 text-sm">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" />
                  <span className="leading-6">{idea}</span>
                </li>
              ))}
            </ul>
            <div className="mt-6 rounded-xl border border-border/70 bg-background/40 p-4">
              <div className="flex items-start gap-2.5">
                <CircleDollarSign className="mt-0.5 size-4 shrink-0 text-primary" />
                <div>
                  <p className="text-sm font-semibold">Pricing tip</p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {copy.pricingTip}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-3xl border border-primary/30 bg-primary/[0.06] p-6">
              <ShieldCheck className="size-5 text-primary" />
              <h2 className="mt-3 text-lg font-bold tracking-tight">
                Free individual selling
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                $0 to join, $0 per listing, and 0% commission. No card, no
                monthly fee, and no business website required.
              </p>
              <Button asChild className="mt-5 w-full">
                <Link to={ctaHref}>
                  <Tag className="mr-2 size-4" /> List in {category.label}
                </Link>
              </Button>
            </div>
            <div className="rounded-3xl border border-border/70 bg-card p-6">
              <Camera className="size-5 text-primary" />
              <h2 className="mt-3 text-lg font-bold tracking-tight">
                A better first photo
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Use daylight, a clean background, and a straight-on shot of the
                whole item. Add close-ups of labels and any flaws.
              </p>
              <Link
                to="/sell/guide"
                className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
              >
                Open the full listing guide <ArrowRight className="size-3.5" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="section-pad">
        <div className="page-container">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold tracking-tight sm:text-2xl">
                Live in {category.label}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {listings === undefined
                  ? "Loading real listings…"
                  : liveCount === 0
                    ? "No live listings in this category yet — a clear opportunity."
                    : `${liveCount} live listing${liveCount === 1 ? "" : "s"} from verified sellers.`}
              </p>
            </div>
            <Link
              to={`/products?category=${category.id}`}
              className="text-sm font-medium text-primary hover:text-primary/80"
            >
              Browse the category →
            </Link>
          </div>

          {listings === undefined ? (
            <div className="mt-8 flex justify-center py-10">
              <div className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : listings.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-dashed border-primary/30 bg-primary/[0.04] px-6 py-10 text-center">
              <Sparkles className="mx-auto size-6 text-primary" />
              <h3 className="mt-3 text-base font-semibold">
                Be the first {category.label.toLowerCase()} seller
              </h3>
              <p className="mx-auto mt-1.5 max-w-md text-sm leading-6 text-muted-foreground">
                This aisle is waiting for its first real listing. Buyers can
                browse it now, and your item would be the first thing they see.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-3">
                <Button asChild>
                  <Link to={ctaHref}>
                    <Rocket className="mr-2 size-4" /> List the first item
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link to="/sell/guide">Read the listing guide</Link>
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
              {listings.slice(0, 4).map((product, index) => (
                <ProductCard
                  key={product._id}
                  product={product}
                  index={index}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="border-y border-border/70 bg-card/30 py-14">
        <div className="page-container">
          <div className="mx-auto mb-8 max-w-2xl text-center">
            <h2 className="text-2xl font-bold tracking-tight">
              Free individual selling vs. paid business plans
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Start with a free shop. A branded business storefront is optional.
            </p>
          </div>
          <SellerPlanComparison startHref={ctaHref} />
        </div>
      </section>

      <section className="section-pad">
        <div className="page-container">
          <div className="mb-6 text-center">
            <h2 className="text-xl font-bold tracking-tight">
              Explore another category
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Each aisle has its own seller guide and listing tips.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {CATEGORIES.filter((item) => item.id !== category.id).map(
              (item) => (
                <Link
                  key={item.id}
                  to={`/sell/category/${item.id}`}
                  className="group rounded-2xl border border-border/70 bg-card p-4 text-center transition-colors hover:border-primary/50"
                >
                  <span className="text-2xl" aria-hidden>
                    {item.emoji}
                  </span>
                  <span className="mt-2 block text-xs font-semibold transition-colors group-hover:text-primary">
                    {item.label}
                  </span>
                </Link>
              ),
            )}
          </div>
          <div className="mt-8 text-center">
            <Button asChild variant="outline">
              <Link to="/founding-sellers">
                <Crown className="mr-2 size-4" /> Become a Founding Seller
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </Layout>
  );
}

