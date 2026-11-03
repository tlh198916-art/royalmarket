import { api } from "@/convex/_generated/api";
import { useMutation } from "convex/react";
import { useEffect } from "react";
import { useSearchParams } from "react-router";

const CODE_KEY = "royalmarket.ref";
const VISITOR_KEY = "royalmarket.ref.visitor";

function readStorage(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // storage unavailable — the invite simply won't persist
  }
}

/**
 * Reads `?ref=CODE`, keeps it for the sign-in / shop-setup round trip, and
 * records one anonymous visit per session. The code is credited as a shop
 * setup only when `sellers.become` runs.
 */
export function useReferralCapture(source: string) {
  const [searchParams] = useSearchParams();
  const trackVisit = useMutation(api.referrals.trackVisit);
  const code = (searchParams.get("ref") ?? "").trim().toUpperCase().slice(0, 12);

  useEffect(() => {
    if (!code) return;
    writeStorage(CODE_KEY, code);

    const trackedKey = `royalmarket.ref.tracked:${code}`;
    if (readStorage(trackedKey)) return;

    let visitorKey = readStorage(VISITOR_KEY);
    if (!visitorKey) {
      visitorKey =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      writeStorage(VISITOR_KEY, visitorKey);
    }

    // Set the session marker before the request so StrictMode's double effect
    // run cannot create a second visit.
    writeStorage(trackedKey, "1");
    void trackVisit({ code, visitorKey, source }).catch(() => {
      // Analytics must never block the page.
    });
  }, [code, source, trackVisit]);

  return code;
}

/** The invite code saved earlier in this browser session, if any. */
export function savedReferralCode(): string {
  return readStorage(CODE_KEY) ?? "";
}
