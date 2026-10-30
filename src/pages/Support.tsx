import { EmptyState } from "@/components/marketplace/EmptyState";
import { Layout } from "@/components/marketplace/Layout";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePageMeta } from "@/lib/seo";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { useMutation } from "convex/react";
import {
  CheckCircle2,
  LifeBuoy,
  Mail,
  MessageSquareText,
  PackageX,
  RotateCcw,
  ShieldCheck,
  Truck,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

const groups = [
  {
    id: "shipping",
    title: "Meet-ups & delivery",
    icon: Truck,
    items: [
      {
        q: "How do I get the item?",
        a: "At checkout you choose meet-up or shipping. Buyer and seller then confirm the details directly — meeting spot, or carrier, cost, and timing — and both approve the deal on the orders page before handoff.",
      },
      {
        q: "Who arranges shipping?",
        a: "You do — there are no platform shipping fees. Propose the terms from your orders page (or reply to the other party's proposal); the deal moves forward once both of you approve it.",
      },
      {
        q: "Can I get an order delivered internationally?",
        a: "It depends on the seller — agree the details directly with them when you arrange shipping from your orders page, before either of you approves the deal.",
      },
    ],
  },
  {
    id: "returns",
    title: "Returns & refunds",
    icon: RotateCcw,
    items: [
      {
        q: "What is the return policy?",
        a: "Each seller sets their own return window (0–90 days) per listing. The product page states clearly whether returns are accepted and for how long, before you buy.",
      },
      {
        q: "Can I cancel an order?",
        a: "Yes — while the order status is still 'placed' (no seller has shipped it), you can cancel from your orders page. Inventory is automatically returned to the seller's stock.",
      },
      {
        q: "The item arrived wrong or damaged",
        a: "Open a support ticket with your order number and photos. We'll mediate with the seller and work toward a replacement or refund.",
      },
    ],
  },
  {
    id: "account",
    title: "Accounts & verification",
    icon: ShieldCheck,
    items: [
      {
        q: "Why do I need to verify my account?",
        a: "Every account confirms a 6-digit code sent to its email address. Verification keeps listings attributable to real people — no bots, no anonymous sellers — and it's free.",
      },
      {
        q: "I didn't receive my verification code",
        a: "Check spam/junk first, then request a new code from the sign-in screen. Codes expire after 15 minutes for your security.",
      },
      {
        q: "Can I change my marketing preferences?",
        a: "Yes. Optional marketing communications (new features, seller tips) are strictly opt-in and can be toggled any time in Account settings.",
      },
    ],
  },
  {
    id: "orders",
    title: "Orders & availability",
    icon: PackageX,
    items: [
      {
        q: "An item I wanted says 'Sold out'",
        a: "Stock is live — when the last unit sells, the listing stays visible but clearly marked so you don't waste a message. Inventory can return if the seller restocks or an order is cancelled.",
      },
      {
        q: "How do I pay?",
        a: "Checkout currently uses pay-on-delivery: you pay when you receive the item. Online card payment will be announced on this page once a payment provider is configured.",
      },
      {
        q: "Where can I see my orders?",
        a: "Sign in and open Order history from the account menu — every order shows its items, the agreed meet-up or shipping arrangement, and live fulfilment status.",
      },
    ],
  },
];

export default function Support() {
  const { user } = useAuth();
  usePageMeta({
    title: "Support",
    description:
      "Get help with orders, listings, seller plans or account verification. Open a support ticket and our team replies in one thread.",
    canonicalPath: "/support",
  });
  const createTicket = useMutation(api.account.createTicket);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setSubmitting(true);
    try {
      await createTicket({
        name: (formData.get("name") as string) ?? "",
        email: (formData.get("email") as string) ?? "",
        subject: (formData.get("subject") as string) ?? "",
        message: (formData.get("message") as string) ?? "",
      });
      setSubmitted(true);
      toast.success("Ticket received — we'll reply by email.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not send your message.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Layout>
      <section className="border-b border-border/70 bg-card/30">
        <div className="page-container py-12 text-center sm:py-16">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <LifeBuoy className="size-7" />
          </div>
          <h1 className="mt-5 text-3xl font-bold tracking-tight sm:text-4xl">
            How can we help?
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
            Answers to the questions buyers and sellers ask most — and a
            real inbox below if yours isn&apos;t listed.
          </p>
        </div>
      </section>

      <section className="page-container grid gap-10 py-12 lg:grid-cols-[1fr_400px] lg:gap-14">
        {/* FAQ groups */}
        <div className="space-y-10">
          {groups.map((group) => (
            <div key={group.id} id={group.id} className="scroll-mt-24">
              <div className="flex items-center gap-2.5">
                <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <group.icon className="size-4" />
                </div>
                <h2 className="text-base font-bold tracking-tight sm:text-lg">
                  {group.title}
                </h2>
              </div>
              <Accordion type="single" collapsible className="mt-3">
                {group.items.map((item) => (
                  <AccordionItem
                    key={item.q}
                    value={item.q}
                    className="border-border/70"
                  >
                    <AccordionTrigger className="py-4 text-left text-sm hover:no-underline sm:text-base">
                      {item.q}
                    </AccordionTrigger>
                    <AccordionContent className="text-sm leading-6 text-muted-foreground">
                      {item.a}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          ))}

          <div className="rounded-2xl border border-border/70 bg-card p-5">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" />
              <div className="text-sm leading-6 text-muted-foreground">
                <p className="font-semibold text-foreground">
                  Our support promise
                </p>
                <p>
                  Every ticket lands in our admin dashboard and is answered by
                  a human — usually within one business day. Include your order
                  number for the fastest resolution.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Contact form */}
        <div id="contact" className="scroll-mt-24 h-fit">
          <div className="rounded-2xl border border-border/70 bg-card p-6">
            <div className="flex items-center gap-2.5">
              <MessageSquareText className="size-5 text-primary" />
              <h2 className="text-base font-bold tracking-tight">
                Open a support ticket
              </h2>
            </div>

            {submitted ? (
              <div className="mt-5">
                <EmptyState
                  icon={CheckCircle2}
                  title="Ticket received"
                  description="Your message is in our support queue. We'll reply to the email you provided."
                  compact
                  action={
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSubmitted(false)}
                    >
                      Send another message
                    </Button>
                  }
                />
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="mt-5 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="support-name">Name</Label>
                    <Input
                      id="support-name"
                      name="name"
                      required
                      minLength={2}
                      defaultValue={user?.name ?? ""}
                      placeholder="Your name"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="support-email">Email</Label>
                    <Input
                      id="support-email"
                      name="email"
                      type="email"
                      required
                      defaultValue={user?.email ?? ""}
                      placeholder="you@example.com"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="support-subject">Subject</Label>
                  <Input
                    id="support-subject"
                    name="subject"
                    required
                    minLength={3}
                    maxLength={120}
                    placeholder="Order #1234 — damaged item"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="support-message">Message</Label>
                  <Textarea
                    id="support-message"
                    name="message"
                    required
                    minLength={10}
                    maxLength={4000}
                    rows={6}
                    placeholder="Tell us what happened, including your order number if you have one."
                  />
                </div>
                <Button type="submit" className="w-full" disabled={submitting}>
                  <Mail className="mr-2 size-4" />
                  {submitting ? "Sending…" : "Send message"}
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  We only use your email to reply to this ticket.
                </p>
              </form>
            )}
          </div>

          <div className="mt-4 rounded-2xl border border-border/70 bg-card p-5 text-sm text-muted-foreground">
            <p className="font-semibold text-foreground">Quick links</p>
            <div className="mt-2.5 flex flex-col gap-1.5">
              <Link to="/products" className="transition-colors hover:text-foreground">
                Browse the catalog →
              </Link>
              <Link to="/sell" className="transition-colors hover:text-foreground">
                How selling works →
              </Link>
              <Link to="/orders" className="transition-colors hover:text-foreground">
                Track your orders →
              </Link>
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}
