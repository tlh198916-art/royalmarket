export const CATEGORIES = [
  { id: "electronics", label: "Electronics", emoji: "💻" },
  { id: "fashion", label: "Fashion & Apparel", emoji: "🧥" },
  { id: "home", label: "Home & Living", emoji: "🛋️" },
  { id: "collectibles", label: "Collectibles", emoji: "🏺" },
  { id: "sports", label: "Sports & Outdoors", emoji: "⛳" },
  { id: "toys", label: "Toys & Games", emoji: "🎲" },
  { id: "beauty", label: "Beauty & Health", emoji: "🧴" },
  { id: "books", label: "Books, Music & Media", emoji: "📚" },
  { id: "automotive", label: "Automotive", emoji: "🚗" },
  { id: "art", label: "Art & Handmade", emoji: "🎨" },
] as const;

export type Category = (typeof CATEGORIES)[number];

export function getCategory(id: string): Category | undefined {
  return CATEGORIES.find((c) => c.id === id);
}

export function isValidCategoryId(id: string): boolean {
  return CATEGORIES.some((c) => c.id === id);
}
