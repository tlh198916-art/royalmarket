import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useMutation } from "convex/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "royalmarket.cart.v1";

export type CartLine = {
  productId: string;
  title: string;
  priceCents: number;
  quantity: number;
  maxQuantity: number;
  imageUrl: string | null;
  sellerName: string | null;
};

type CartContextValue = {
  lines: CartLine[];
  count: number;
  subtotalCents: number;
  add: (line: Omit<CartLine, "quantity">, quantity?: number) => void;
  setQuantity: (productId: string, quantity: number) => void;
  remove: (productId: string) => void;
  clear: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

function readStoredLines(): CartLine[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (line): line is CartLine =>
        !!line &&
        typeof line.productId === "string" &&
        typeof line.title === "string" &&
        typeof line.priceCents === "number" &&
        typeof line.quantity === "number",
    );
  } catch {
    return [];
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(readStoredLines);
  const trackAddToCart = useMutation(api.analytics.track);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    } catch {
      // storage unavailable — cart stays in memory
    }
  }, [lines]);

  const add = useCallback(
    (line: Omit<CartLine, "quantity">, quantity = 1) => {
      setLines((previous) => {
        const existing = previous.find((l) => l.productId === line.productId);
        if (existing) {
          const max = Math.max(line.maxQuantity, 1);
          return previous.map((l) => {
            if (l.productId !== line.productId) return l;
            return {
              ...l,
              ...line,
              quantity: Math.min(l.quantity + quantity, max),
            };
          });
        }
        return [
          ...previous,
          { ...line, quantity: Math.min(quantity, Math.max(line.maxQuantity, 1)) },
        ];
      });
      void trackAddToCart({
        type: "add_to_cart",
        productId: line.productId as Id<"products">,
      }).catch(() => {
        // analytics must never block the shopping flow
      });
    },
    [trackAddToCart],
  );

  const setQuantity = useCallback((productId: string, quantity: number) => {
    setLines((previous) =>
      previous.flatMap((line) => {
        if (line.productId !== productId) return [line];
        if (quantity <= 0) return [];
        return [
          {
            ...line,
            quantity: Math.min(
              Math.max(1, Math.floor(quantity)),
              Math.max(line.maxQuantity, 1),
            ),
          },
        ];
      }),
    );
  }, []);

  const remove = useCallback((productId: string) => {
    setLines((previous) =>
      previous.filter((line) => line.productId !== productId),
    );
  }, []);

  const clear = useCallback(() => setLines([]), []);

  const value = useMemo<CartContextValue>(() => {
    const count = lines.reduce((sum, line) => sum + line.quantity, 0);
    const subtotalCents = lines.reduce(
      (sum, line) => sum + line.priceCents * line.quantity,
      0,
    );
    return { lines, count, subtotalCents, add, setQuantity, remove, clear };
  }, [lines, add, setQuantity, remove, clear]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart must be used inside a CartProvider");
  }
  return context;
}
