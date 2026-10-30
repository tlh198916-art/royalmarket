import { useEffect } from "react";

const SITE_NAME = "Royalmarket";
const DEFAULT_DESCRIPTION =
  "Royalmarket — a modern multi-vendor marketplace. Browse verified sellers, list items free, and buy with transparent availability.";

function upsertMeta(key: string, content: string, attr: "name" | "property") {
  let tag = document.head.querySelector<HTMLMetaElement>(
    `meta[${attr}="${key}"]`,
  );
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute(attr, key);
    document.head.appendChild(tag);
  }
  tag.setAttribute("content", content);
}

function upsertLink(rel: string, href: string) {
  let tag = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!tag) {
    tag = document.createElement("link");
    tag.setAttribute("rel", rel);
    document.head.appendChild(tag);
  }
  tag.setAttribute("href", href);
}

function absoluteUrl(path: string) {
  if (/^https?:\/\//.test(path)) return path;
  const origin =
    typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}${path.startsWith("/") ? path : `/${path}`}`;
}

export type PageMeta = {
  title: string;
  description?: string;
  /** Path only, e.g. "/products" — converted to an absolute canonical URL. */
  canonicalPath?: string;
  /** schema.org JSON-LD object rendered as a script tag. */
  jsonLd?: Record<string, unknown> | null;
};

/**
 * Client-side SEO for one page: title, description, canonical, Open Graph and
 * optional JSON-LD. The app is a Vite SPA, so this runs in the browser — see
 * the README/report limitation note about non-JS crawlers.
 */
export function usePageMeta({
  title,
  description = DEFAULT_DESCRIPTION,
  canonicalPath,
  jsonLd,
}: PageMeta) {
  useEffect(() => {
    const fullTitle = title.includes(SITE_NAME)
      ? title
      : `${title} · ${SITE_NAME}`;
    document.title = fullTitle;
    upsertMeta("description", description, "name");
    upsertMeta("og:title", fullTitle, "property");
    upsertMeta("og:description", description, "property");
    upsertMeta("og:site_name", SITE_NAME, "property");
    upsertMeta("twitter:title", fullTitle, "name");
    upsertMeta("twitter:description", description, "name");
    if (canonicalPath) {
      const url = absoluteUrl(canonicalPath);
      upsertLink("canonical", url);
      upsertMeta("og:url", url, "property");
    } else {
      // Never leave another route's canonical behind after client navigation.
      document.head.querySelector('link[rel="canonical"]')?.remove();
      document.head.querySelector('meta[property="og:url"]')?.remove();
    }

    let script: HTMLScriptElement | null = null;
    if (jsonLd) {
      script = document.createElement("script");
      script.type = "application/ld+json";
      script.id = "page-jsonld";
      script.textContent = JSON.stringify(jsonLd);
      document.head.appendChild(script);
    }
    return () => {
      script?.remove();
      document.head.querySelector('link[rel="canonical"]')?.remove();
      document.head.querySelector('meta[property="og:url"]')?.remove();
    };
  }, [title, description, canonicalPath, jsonLd]);
}

/** Pure builder so the structured data can be unit tested. */
export function productJsonLd(product: {
  title: string;
  description: string;
  imageUrl?: string | null;
  priceCents: number;
  condition?: string | null;
  available: boolean;
  ratingAverage?: number | null;
  ratingCount?: number | null;
  sellerShopName?: string | null;
}) {
  const conditionMap: Record<string, string> = {
    new: "https://schema.org/NewCondition",
    like_new: "https://schema.org/UsedCondition",
    good: "https://schema.org/UsedCondition",
    fair: "https://schema.org/UsedCondition",
  };
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    description: product.description.slice(0, 500),
    ...(product.imageUrl ? { image: [product.imageUrl] } : {}),
    ...(product.sellerShopName
      ? { brand: { "@type": "Brand", name: product.sellerShopName } }
      : {}),
    offers: {
      "@type": "Offer",
      priceCurrency: "USD",
      price: (product.priceCents / 100).toFixed(2),
      availability: product.available
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
      ...(product.condition
        ? { itemCondition: conditionMap[product.condition] ?? conditionMap.good }
        : {}),
    },
    ...(product.ratingCount && product.ratingAverage
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: product.ratingAverage.toFixed(1),
            reviewCount: product.ratingCount,
          },
        }
      : {}),
  } satisfies Record<string, unknown>;
}
