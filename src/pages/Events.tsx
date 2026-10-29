import { Layout } from "@/components/marketplace/Layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { eventPhase, useCountdown } from "@/hooks/use-countdown";
import { errorMessage, pluralize } from "@/lib/format";
import { buildShareLinks } from "@/lib/socialShare";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { motion } from "framer-motion";
import {
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Copy,
  Crown,
  Facebook,
  Globe,
  Link2,
  Loader2,
  MessageCircle,
  Megaphone,
  Share2,
  Store,
  Ticket,
  UserPlus,
  Users,
  Video,
  X as XIcon,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

/** One row of the public events query (synthetic founding event included). */
type PublicEvent = FunctionReturnType<typeof api.marketEvents.list>[number];

function formatEventDate(startsAt: number, endsAt: number) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  return {
    date: start.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    }),
    time: `${start.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    })} – ${end.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    })}`,
  };
}

/** Live-updating countdown tiles for an upcoming event. */
function CountdownTiles({ startsAt, endsAt }: { startsAt: number; endsAt: number }) {
  const countdown = useCountdown(startsAt, endsAt);
  const phase = eventPhase(startsAt, endsAt, countdown.nowMs);

  if (phase === "live") {
    return (
      <div className="mx-auto flex w-fit items-center gap-2 rounded-2xl border border-emerald-400/40 bg-emerald-400/10 px-5 py-3">
        <span className="relative flex size-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex size-2.5 rounded-full bg-emerald-400" />
        </span>
        <span className="text-sm font-bold text-emerald-300">
          We&apos;re live right now — join below
        </span>
      </div>
    );
  }
  if (countdown.isPast) {
    return (
      <p className="text-sm font-medium text-muted-foreground">
        This session has ended. Browse more events below or start selling today.
      </p>
    );
  }

  const tiles: [string, number][] = [
    ["Days", countdown.days],
    ["Hours", countdown.hours],
    ["Minutes", countdown.minutes],
    ["Seconds", countdown.seconds],
  ];
  return (
    <div className="grid grid-cols-4 gap-2 sm:gap-3">
      {tiles.map(([label, value]) => (
        <div
          key={label}
          className="rounded-2xl border border-border/70 bg-card px-2 py-3 text-center sm:px-4 sm:py-4"
        >
          <div className="text-2xl font-extrabold tabular-nums text-foreground sm:text-3xl">
            {label === "Days" ? value : String(value).padStart(2, "0")}
          </div>
          <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:text-xs">
            {label}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Copy-link + network share intents. Pure URL logic lives in lib/socialShare. */
function ShareRow({ title, dateLabel }: { title: string; dateLabel: string }) {
  const pageUrl = `${window.location.origin}/events`;
  const text = `Join me at Royalmarket's ${title} (${dateLabel}) — a free online kickoff for new sellers.`;
  const links = buildShareLinks(pageUrl, text);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pageUrl);
      toast.success("Event link copied.");
    } catch {
      toast.error("Couldn't copy the link — please copy it from the address bar.");
    }
  };

  const networks: { label: string; href: string; icon: typeof XIcon }[] = [
    { label: "Share on X", href: links.x, icon: XIcon },
    { label: "Share on Facebook", href: links.facebook, icon: Facebook },
    { label: "Share on WhatsApp", href: links.whatsapp, icon: MessageCircle },
  ];

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <span className="mr-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Share2 className="size-3.5" /> Spread the word:
      </span>
      {networks.map(({ label, href, icon: Icon }) => (
        <a
          key={label}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={label}
          className="flex size-9 items-center justify-center rounded-lg border border-border/70 bg-card text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
        >
          <Icon className="size-4" />
        </a>
      ))}
      <button
        type="button"
        onClick={copy}
        aria-label="Copy event link"
        className="flex size-9 items-center justify-center rounded-lg border border-border/70 bg-card text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
      >
        <Copy className="size-4" />
      </button>
    </div>
  );
}

/**
 * Register CTA that adapts to auth state: signed-out visitors go through the
 * existing auth flow (returning to /events), signed-in users register with one
 * click, and registered attendees see a confirmation state.
 */
function RegisterButton({
  slug,
  registered,
  disabled,
  startsAt,
  endsAt,
}: {
  slug: string;
  registered: boolean;
  disabled?: boolean;
  startsAt: number;
  endsAt: number;
}) {
  const { isAuthenticated, isLoading } = useAuth();
  const register = useMutation(api.marketEvents.register);
  const [pending, setPending] = useState(false);
  const { nowMs } = useCountdown(startsAt, endsAt);
  const ended = eventPhase(startsAt, endsAt, nowMs) === "ended";
  const cancelled = disabled === true;
  const blocked = cancelled || ended;

  if (isLoading) {
    return (
      <Button size="lg" disabled className="min-w-52">
        <Loader2 className="mr-2 size-4 animate-spin" /> Loading…
      </Button>
    );
  }
  // Cancellation wins over the signed-in/registered states below, so an
  // attendee never sees a green confirmation next to a cancelled event.
  if (cancelled) {
    return (
      <Button size="lg" variant="outline" disabled className="min-w-52">
        <XCircle className="mr-2 size-4" /> Event cancelled
      </Button>
    );
  }
  if (ended && !registered) {
    return (
      <Button size="lg" disabled className="min-w-52">
        Registration closed
      </Button>
    );
  }
  if (!isAuthenticated) {
    return (
      <Button asChild size="lg" className="min-w-52">
        <Link to="/auth?returnTo=%2Fevents">
          <Ticket className="mr-2 size-4" /> Register for Free
        </Link>
      </Button>
    );
  }
  if (registered) {
    // Not a link: the join panel for this specific event sits beside the
    // button (hero) or behind the card's "Event details" toggle.
    return (
      <span className="flex min-w-52 items-center justify-center gap-2 rounded-lg border border-emerald-400/50 px-4 py-3 text-sm font-semibold text-emerald-300">
        <CheckCircle2 className="size-4" /> You&apos;re registered
      </span>
    );
  }
  return (
    <Button
      size="lg"
      className="min-w-52"
      disabled={blocked || pending}
      onClick={async () => {
        setPending(true);
        try {
          const result = await register({ slug });
          toast.success(
            result.status === "already"
              ? "You're already registered — see you there!"
              : "You're registered! Event details are now unlocked below.",
          );
        } catch (error) {
          toast.error(
            errorMessage(error, "Couldn't register — please try again."),
          );
        } finally {
          setPending(false);
        }
      }}
    >
      {pending ? (
        <>
          <Loader2 className="mr-2 size-4 animate-spin" /> Registering…
        </>
      ) : (
        <>
          <Ticket className="mr-2 size-4" /> Register for Free
        </>
      )}
    </Button>
  );
}

/** Cancels the signed-in viewer's registration for one event. */
function CancelRegistration({ slug }: { slug: string }) {
  const unregister = useMutation(api.marketEvents.unregister);
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        try {
          const removed = await unregister({ slug });
          if (removed) toast.success("Registration cancelled.");
          else toast.message("You weren't registered for this event.");
        } catch (error) {
          toast.error(
            errorMessage(error, "Couldn't cancel — please try again."),
          );
        } finally {
          setPending(false);
        }
      }}
      className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-60"
    >
      {pending ? "Cancelling…" : "Cancel registration"}
    </button>
  );
}

/**
 * How to attend one event, plus the private join link and cancel control for
 * registered attendees. The server strips joinUrl unless the viewer is
 * registered, and every event renders this panel — featured or not — so
 * attendees of secondary events can still get in and unregister.
 */
function JoinPanel({ event }: { event: PublicEvent }) {
  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-muted-foreground">
        {event.joinInstructions}
      </p>
      {event.registered && event.joinUrl && (
        <a
          href={event.joinUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between gap-2 rounded-2xl border border-emerald-400/40 bg-emerald-400/10 p-4 text-sm font-semibold text-emerald-300 transition-colors hover:bg-emerald-400/15"
        >
          <span className="flex items-center gap-2">
            <Link2 className="size-4" /> Your private join link
          </span>
          <ArrowRight className="size-4" />
        </a>
      )}
      {event.registered && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-secondary/40 p-4">
          <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <BadgeCheck className="size-4 text-emerald-400" />
            Registered as an attendee
          </p>
          <CancelRegistration slug={event.slug} />
        </div>
      )}
    </div>
  );
}

/** A non-featured event card with its own expandable attendance details. */
function MoreEventCard({ event }: { event: PublicEvent }) {
  const [open, setOpen] = useState(false);
  const { date, time } = formatEventDate(event.startsAt, event.endsAt);
  const panelId = `event-details-${event.slug}`;

  return (
    <div className="rounded-3xl border border-border/70 bg-card p-6">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-bold leading-6">{event.title}</h3>
        {event.status === "cancelled" && (
          <Badge
            variant="outline"
            className="shrink-0 border-red-400/50 text-red-300"
          >
            Cancelled
          </Badge>
        )}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{event.tagline}</p>
      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <CalendarDays className="size-3.5" /> {date}
        </span>
        <span className="flex items-center gap-1.5">
          <Clock3 className="size-3.5" /> {time}
        </span>
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <RegisterButton
          slug={event.slug}
          registered={event.registered}
          disabled={event.status === "cancelled"}
          startsAt={event.startsAt}
          endsAt={event.endsAt}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
        >
          <ChevronDown
            className={`mr-1.5 size-4 transition-transform ${open ? "rotate-180" : ""}`}
          />
          {open ? "Hide details" : "Event details"}
        </Button>
      </div>
      {open && (
        <div
          id={panelId}
          className="mt-4 space-y-4 border-t border-border/60 pt-4"
        >
          <ul className="space-y-2.5">
            {event.details.map((item, index) => (
              <li
                key={`${index}-${item}`}
                className="flex items-start gap-2.5 text-sm leading-6"
              >
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
                <span className="text-foreground/90">{item}</span>
              </li>
            ))}
          </ul>
          <div>
            <h4 className="flex items-center gap-2 text-sm font-bold">
              <Video className="size-4 text-primary" /> Joining online
            </h4>
            <div className="mt-2">
              <JoinPanel event={event} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const BENEFITS = {
  individual: [
    "No shop or business registration needed — sell as yourself.",
    "$0 to list, $0 per month, 0% platform commission — free forever.",
    "Seller-set pickup, shipping, and local delivery with your own fees.",
    "Verified-account badge builds buyer trust on every listing.",
  ],
  business: [
    "Branded storefront with your logo, banner, and custom URL.",
    "Business contact details and a professional public profile.",
    "Lower commission as you scale: 5% Starter, 3% Growth, 1% Pro.",
    "Advanced inventory, order, and sales analytics tools.",
  ],
} as const;

export default function Events() {
  const { isAuthenticated } = useAuth();
  const eventsQuery = useQuery(api.marketEvents.list);

  const events = eventsQuery ?? [];
  const featured = events[0];
  const moreEvents = events.slice(1);

  const sellerHref = isAuthenticated ? "/sell/new" : "/auth?returnTo=%2Fsell%2Fnew";

  return (
    <Layout>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border/70">
        <div className="hero-glow pointer-events-none absolute inset-0" aria-hidden />
        <div className="page-container relative py-14 sm:py-20">
          {eventsQuery === undefined ? (
            <div className="mx-auto h-64 max-w-3xl animate-pulse rounded-3xl bg-secondary/50" />
          ) : featured === undefined ? (
            <div className="mx-auto max-w-xl text-center">
              <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <CalendarDays className="size-6" />
              </div>
              <h1 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">
                No events scheduled right now
              </h1>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                New seller events are announced here as soon as they&apos;re
                published. In the meantime you can browse the marketplace or set
                up your seller account — individual selling is free.
              </p>
              <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Button asChild size="lg">
                  <Link to={sellerHref}>
                    <Store className="mr-2 size-4" /> Become a Seller
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link to="/products">
                    Browse products <ArrowRight className="ml-2 size-4" />
                  </Link>
                </Button>
              </div>
            </div>
          ) : (() => {
            const { date, time } = formatEventDate(featured.startsAt, featured.endsAt);
            const cancelled = featured.status === "cancelled";
            return (
              <motion.div
                initial={{ opacity: 0, y: 22 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="mx-auto max-w-3xl text-center"
              >
                <Badge
                  variant="secondary"
                  className="mb-5 border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary"
                >
                  <Megaphone className="mr-1.5 size-3.5" /> Founding sellers launch · free · online
                </Badge>
                <h1 className="text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
                  {featured.title}
                </h1>
                <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
                  {featured.tagline}
                </p>

                <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <CalendarDays className="size-4 text-primary" /> {date}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Clock3 className="size-4 text-primary" /> {time} ·{" "}
                    {featured.durationMinutes} min
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Video className="size-4 text-primary" /> Online
                  </span>
                </div>

                <div className="mt-8">
                  {cancelled ? (
                    <Badge
                      variant="outline"
                      className="border-red-400/50 px-4 py-2 text-sm text-red-300"
                    >
                      This event was cancelled
                    </Badge>
                  ) : (
                    <CountdownTiles
                      startsAt={featured.startsAt}
                      endsAt={featured.endsAt}
                    />
                  )}
                </div>

                <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                  <RegisterButton
                    slug={featured.slug}
                    registered={featured.registered}
                    disabled={cancelled}
                    startsAt={featured.startsAt}
                    endsAt={featured.endsAt}
                  />
                  <Button asChild size="lg" variant="outline">
                    <Link to={sellerHref}>
                      <Store className="mr-2 size-4" /> Become a Seller
                    </Link>
                  </Button>
                </div>

                <p className="mt-4 flex flex-wrap items-center justify-center gap-1.5 text-xs text-muted-foreground">
                  <Users className="size-3.5" />
                  {featured.registrations > 0
                    ? `${pluralize(featured.registrations, "seller")} already registered`
                    : "Be the first to register — it takes one click"}
                </p>

                <div className="mt-6">
                  <ShareRow title={featured.title} dateLabel={date} />
                </div>
              </motion.div>
            );
          })()}
        </div>
      </section>

      {/* Event details */}
      {featured && (
        <section id="event-details" className="scroll-mt-24 py-14">
          <div className="page-container grid gap-6 lg:grid-cols-5">
            <div className="rounded-3xl border border-border/70 bg-card p-6 sm:p-8 lg:col-span-3">
              <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight">
                <Ticket className="size-5 text-primary" /> What happens at the event
              </h2>
              <ul className="mt-5 space-y-3.5">
                {featured.details.map((item, index) => (
                  <li
                    key={`${index}-${item}`}
                    className="flex items-start gap-3 text-sm leading-6"
                  >
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
                    <span className="text-foreground/90">{item}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-6 rounded-2xl border border-border/60 bg-secondary/40 p-4 text-xs leading-5 text-muted-foreground">
                Every claim on this page matches what the marketplace does today:
                individuals sell free with 0% commission, and paid Business plans
                add a branded storefront and business tools. See{" "}
                <Link to="/pricing" className="font-medium text-primary hover:underline">
                  Plans &amp; pricing
                </Link>{" "}
                for the full comparison.
              </p>
            </div>

            <div className="rounded-3xl border border-border/70 bg-card p-6 sm:p-8 lg:col-span-2">
              <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight">
                <Video className="size-5 text-primary" /> Joining online
              </h2>
              <div className="mt-4">
                <JoinPanel event={featured} />
              </div>
              <div className="mt-5 space-y-2.5 text-sm text-muted-foreground">
                <p className="flex items-center gap-2">
                  <Globe className="size-4 text-primary" /> Join from anywhere —
                  browser, phone, or tablet
                </p>
                <p className="flex items-center gap-2">
                  <Users className="size-4 text-primary" /> Live Q&amp;A — bring
                  your selling questions
                </p>
                <p className="flex items-center gap-2">
                  <Crown className="size-4 text-primary" /> Meet the team behind
                  Royalmarket
                </p>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Why sell on Royalmarket */}
      <section className="border-t border-border/70 py-14">
        <div className="page-container">
          <div className="mx-auto max-w-2xl text-center">
            <Badge
              variant="secondary"
              className="mb-4 border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary"
            >
              Why become a seller
            </Badge>
            <h2 className="text-3xl font-extrabold tracking-tight">
              Two ways to sell — pick what fits you
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Whether you&apos;re clearing out your garage or running a small
              business, Royalmarket has a place for you.
            </p>
          </div>

          <div className="mt-10 grid gap-6 md:grid-cols-2">
            <div className="rounded-3xl border border-border/70 bg-card p-6 sm:p-8">
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10">
                  <UserPlus className="size-5 text-primary" />
                </span>
                <div>
                  <h3 className="text-lg font-bold">Individuals — free forever</h3>
                  <p className="text-xs text-muted-foreground">
                    No shop required
                  </p>
                </div>
              </div>
              <ul className="mt-5 space-y-3">
                {BENEFITS.individual.map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm leading-6">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <Button asChild className="mt-6 w-full" variant="outline">
                <Link to={sellerHref}>
                  Start selling free <ArrowRight className="ml-2 size-4" />
                </Link>
              </Button>
            </div>

            <div className="relative rounded-3xl border border-primary/40 bg-card p-6 sm:p-8">
              <Badge className="absolute -top-3 left-6 bg-primary text-primary-foreground">
                For small businesses
              </Badge>
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10">
                  <Store className="size-5 text-primary" />
                </span>
                <div>
                  <h3 className="text-lg font-bold">Business plans — from $29/mo</h3>
                  <p className="text-xs text-muted-foreground">
                    Branded storefront &amp; tools
                  </p>
                </div>
              </div>
              <ul className="mt-5 space-y-3">
                {BENEFITS.business.map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm leading-6">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <Button asChild className="mt-6 w-full">
                <Link to="/pricing">
                  Compare business plans <ArrowRight className="ml-2 size-4" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* More events */}
      {moreEvents.length > 0 && (
        <section className="border-t border-border/70 py-14">
          <div className="page-container">
            <h2 className="text-2xl font-extrabold tracking-tight">More events</h2>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {moreEvents.map((event) => (
                <MoreEventCard key={event.slug} event={event} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Final CTA */}
      <section className="border-t border-border/70 py-14">
        <div className="page-container text-center">
          <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
            Ready to join them?
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
            Create your free account, register for the launch event, and list your
            first item — it takes minutes.
          </p>
          <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
            {featured ? (
              <RegisterButton
                slug={featured.slug}
                registered={featured.registered}
                disabled={featured.status === "cancelled"}
                startsAt={featured.startsAt}
                endsAt={featured.endsAt}
              />
            ) : (
              <Button asChild size="lg">
                <Link to="/auth?returnTo=%2Fevents">
                  <Ticket className="mr-2 size-4" /> Register for Free
                </Link>
              </Button>
            )}
            <Button asChild size="lg" variant="outline">
              <Link to={sellerHref}>
                <Store className="mr-2 size-4" /> Become a Seller
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </Layout>
  );
}
