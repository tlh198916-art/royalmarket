"use node";

import { v } from "convex/values";
import { CATEGORIES } from "./categories";
import { api, internal } from "./_generated/api";
import { action } from "./_generated/server";
import type { EnrichedProduct } from "./search";

const EMBED_MODEL = "gemini-embedding-001";
const EMBED_DIMS = 768;
// Primary per current Gemini docs; older flash model as a fallback.
const GEN_MODELS = ["gemini-3.8-flash", "gemini-2.5-flash"];

function geminiKey(): string {
  const key = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!key) {
    throw new Error(
      "AI features need an API key — add GEMINI_API_KEY in the project's Keys tab.",
    );
  }
  return key;
}

function l2Normalize(values: number[]): number[] {
  const norm = Math.sqrt(values.reduce((sum, x) => sum + x * x, 0));
  if (!Number.isFinite(norm) || norm === 0) return values;
  return values.map((x) => x / norm);
}

async function embed(
  text: string,
  taskType: "RETRIEVAL_QUERY" | "RETRIEVAL_DOCUMENT",
): Promise<number[]> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": geminiKey(),
      },
      body: JSON.stringify({
        model: `models/${EMBED_MODEL}`,
        content: { parts: [{ text }] },
        embedContentConfig: {
          outputDimensionality: EMBED_DIMS,
          taskType,
        },
      }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Embedding failed (${response.status}): ${(await response.text()).slice(0, 200)}`,
    );
  }
  const data = (await response.json()) as {
    embedding?: { values?: number[] };
  };
  const values = data.embedding?.values;
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("The embedding service returned an empty vector.");
  }
  return l2Normalize(values);
}

async function generateText(prompt: string): Promise<string> {
  let lastStatus = 0;
  for (const model of GEN_MODELS) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": geminiKey(),
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.8,
            responseMimeType: "application/json",
          },
        }),
      },
    );
    // Model unavailable on this key → try the next one.
    if (response.status === 404 || response.status === 400) {
      lastStatus = response.status;
      continue;
    }
    if (!response.ok) {
      throw new Error(
        `AI draft failed (${response.status}): ${(await response.text()).slice(0, 200)}`,
      );
    }
    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text =
      data.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? "")
        .join("") ?? "";
    if (!text) throw new Error("The AI model returned an empty draft.");
    return text;
  }
  throw new Error(
    `No Gemini model is available on this key (HTTP ${lastStatus}). Check GEMINI_API_KEY.`,
  );
}

function embedText(product: {
  title: string;
  description: string;
  categoryId: string;
  condition: string;
}): string {
  const category = CATEGORIES.find((c) => c.id === product.categoryId);
  const condition = product.condition.replace("_", " ");
  const parts = [
    product.title,
    category ? `${category.emoji} ${category.label}` : "",
    `Condition: ${condition}`,
    product.description,
  ].filter(Boolean);
  // Stayel well under the model's token limit.
  return parts.join(". ").slice(0, 6000);
}

/**
 * Drafts a marketplace listing title + description from whatever the seller
 * has filled in so far. Returns the copy for the seller to review and apply —
 * nothing is written to the database here.
 */
export const draftListing = action({
  args: {
    title: v.optional(v.string()),
    details: v.optional(v.string()),
    categoryId: v.optional(v.string()),
    condition: v.optional(v.string()),
    priceCents: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.runQuery(api.users.currentUser);
    if (!user) throw new Error("Sign in to use the AI listing assistant.");

    const category = CATEGORIES.find((c) => c.id === args.categoryId);
    const condition = (args.condition ?? "good").replace("_", " ");
    const prompt = [
      "You are the listing copy assistant for TLHmarketplacepro, a secondhand marketplace.",
      "Write an honest, appealing draft from the seller's inputs.",
      "",
      `Working title (may be empty): ${args.title?.trim().slice(0, 120) || "(none)"}`,
      `Category: ${category ? category.label : "not chosen yet"}`,
      `Condition: ${condition}`,
      `Price: ${args.priceCents !== undefined ? `$${(args.priceCents / 100).toFixed(2)}` : "not set"}`,
      `Seller's key details: ${args.details?.trim().slice(0, 1500) || "(none provided)"}`,
      "",
      "Rules:",
      "- Never invent brand, model, size, material, authenticity, warranty, or flaws that were not given.",
      "- If details are missing, stay general and invite buyers to ask — do not fabricate specifics.",
      "- title: at most 90 characters, specific and clear, no emoji, no ALL-CAPS words.",
      "- description: 150-900 characters. Lead with what it is and why it's worth buying,",
      "  use short factual lines, mention the condition honestly, and end inviting questions.",
      "- Write like a real seller, not an ad.",
      "",
      'Return ONLY JSON: {"title": "...", "description": "..."}',
    ].join("\n");

    const raw = await generateText(prompt);
    let parsed: unknown;
    try {
      parsed = JSON.parse(
        raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, ""),
      );
    } catch {
      throw new Error("The AI returned an unreadable draft — try again.");
    }
    const obj = parsed as { title?: unknown; description?: unknown };
    const title =
      typeof obj.title === "string" ? obj.title.trim().slice(0, 100) : "";
    const description =
      typeof obj.description === "string"
        ? obj.description.trim().slice(0, 5000)
        : "";
    if (title.length < 3 || description.length < 10) {
      throw new Error("The AI draft was incomplete — try again.");
    }
    return { title, description };
  },
});

/**
 * Embeds the search text and runs the internal vector search. Returns active
 * listings ranked by semantic similarity (same shape as the catalog query).
 */
export const semanticSearch = action({
  args: {
    q: v.string(),
    categoryId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<EnrichedProduct[]> => {
    const q = args.q.trim().slice(0, 300);
    if (q.length < 2) return [];
    const vector = await embed(q, "RETRIEVAL_QUERY");
    const matches = await ctx.vectorSearch("products", "embedding", {
      vector,
      limit: Math.min(Math.max(args.limit ?? 30, 1), 64),
      filter: (entry) => entry.eq("status", "active"),
    });
    if (matches.length === 0) return [];
    return await ctx.runQuery(internal.search.hydrateProducts, {
      ids: matches.map((match) => match._id),
      categoryId: args.categoryId,
    });
  },
});

/** Re-embeds one listing after the seller creates or edits it. */
export const reindex = action({
  args: { productId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.runQuery(api.users.currentUser);
    if (!user) throw new Error("Sign in first.");
    const product = await ctx.runQuery(internal.search.productCopy, {
      id: args.productId,
    });
    if (!product) return { indexed: 0 };
    if (product.sellerId !== user._id && user.role !== "admin") {
      throw new Error("You can only index your own listings.");
    }
    const vector = await embed(embedText(product), "RETRIEVAL_DOCUMENT");
    await ctx.runMutation(internal.search.setEmbedding, {
      id: product.id,
      embedding: vector,
    });
    return { indexed: 1 };
  },
});

/** Admin: embeds a batch of listings that are missing embeddings. */
export const backfillEmbeddings = action({
  args: { batchSize: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await ctx.runQuery(api.users.currentUser);
    if (!user || user.role !== "admin") {
      throw new Error("Only admins can rebuild the search index.");
    }
    geminiKey(); // fail fast with a clear message when no key is configured
    const batch = await ctx.runQuery(internal.search.unindexedCopy, {
      limit: args.batchSize ?? 8,
    });
    let indexed = 0;
    for (const product of batch) {
      try {
        const vector = await embed(embedText(product), "RETRIEVAL_DOCUMENT");
        await ctx.runMutation(internal.search.setEmbedding, {
          id: product.id,
          embedding: vector,
        });
        indexed += 1;
      } catch (error) {
        // Likely a rate limit or bad key — stop instead of hammering.
        console.error("Embedding failed for", product.id, error);
        break;
      }
    }
    return { indexed };
  },
});
