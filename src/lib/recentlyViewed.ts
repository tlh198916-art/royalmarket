const KEY = "royalmarket.recentlyViewed.v1";
const MAX = 12;

export type RecentView = {
  id: string;
  title: string;
  priceCents: number;
  viewedAt: number;
};

function read(): RecentView[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is RecentView =>
        !!item && typeof item.id === "string" && typeof item.title === "string",
    );
  } catch {
    return [];
  }
}

function write(items: RecentView[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items.slice(0, MAX)));
  } catch {
    // storage unavailable (private mode) — silently skip
  }
}

export function recordRecentView(entry: Omit<RecentView, "viewedAt">) {
  const items = read().filter((item) => item.id !== entry.id);
  items.unshift({ ...entry, viewedAt: Date.now() });
  write(items);
}

export function getRecentViews(): RecentView[] {
  return read();
}

export function clearRecentViews() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
