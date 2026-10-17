import { useEffect, useState } from "react";

export type Countdown = {
  totalMs: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  isPast: boolean;
};

/** Pure breakdown of the time remaining between `nowMs` and `targetMs`. */
export function countdownTo(nowMs: number, targetMs: number): Countdown {
  const totalMs = targetMs - nowMs;
  if (totalMs <= 0) {
    return {
      totalMs: 0,
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      isPast: true,
    };
  }
  return {
    totalMs,
    days: Math.floor(totalMs / 86_400_000),
    hours: Math.floor((totalMs % 86_400_000) / 3_600_000),
    minutes: Math.floor((totalMs % 3_600_000) / 60_000),
    seconds: Math.floor((totalMs % 60_000) / 1000),
    isPast: false,
  };
}

export type EventPhase = "upcoming" | "live" | "ended";

/** Is an event upcoming, currently live, or already over? */
export function eventPhase(
  startsAt: number,
  endsAt: number,
  nowMs: number,
): EventPhase {
  if (nowMs < startsAt) return "upcoming";
  if (nowMs < endsAt) return "live";
  return "ended";
}

/**
 * Re-renders once per second with a fresh countdown to `targetMs`. Also
 * exposes `nowMs` so callers can derive phases without calling Date.now()
 * during render (impure under the react-hooks lint rules).
 */
export function useCountdown(
  targetMs: number,
): Countdown & { nowMs: number } {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return { ...countdownTo(now, targetMs), nowMs: now };
}
