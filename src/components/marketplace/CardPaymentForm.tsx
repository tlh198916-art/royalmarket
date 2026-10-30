import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getStripe } from "@/lib/stripeClient";
import { formatPrice } from "@/lib/format";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { CreditCard, Lock, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";

type Props = {
  publishableKey: string;
  clientSecret: string;
  orderId: string;
  amountCents: number;
};

function PaymentForm({
  orderId,
  amountCents,
}: {
  orderId: string;
  amountCents: number;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handlePay = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setMessage(null);

    // Stripe.js confirms the PaymentIntent directly with Stripe. The order is
    // only marked paid by the verified webhook — never by this page.
    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/orders?placed=${orderId}`,
      },
    });

    if (error) {
      setMessage(
        error.message ??
          "The card could not be confirmed. Try another payment method or pay on delivery.",
      );
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handlePay} className="space-y-4">
      <PaymentElement />
      {message && (
        <Alert variant="destructive">
          <AlertTitle>Payment not completed</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}
      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={!stripe || !elements || submitting}
      >
        <Lock className="size-4" />
        {submitting
          ? "Confirming with Stripe…"
          : `Pay ${formatPrice(amountCents)}`}
      </Button>
      <p className="text-center text-[11px] leading-5 text-muted-foreground">
        Card details go directly to Stripe. RoyalMarket never sees or stores
        them. Your order is only marked paid once Stripe confirms the charge.
      </p>
    </form>
  );
}

export function CardPaymentForm({
  publishableKey,
  clientSecret,
  orderId,
  amountCents,
}: Props) {
  const stripePromise = useMemo(
    () => getStripe(publishableKey),
    [publishableKey],
  );
  const testMode = publishableKey.startsWith("pk_test_");

  return (
    <div className="rounded-2xl border border-border/70 bg-card p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-bold tracking-tight">
          <CreditCard className="size-4 text-primary" /> Card payment
        </h2>
        {testMode && (
          <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
            Stripe test mode
          </span>
        )}
      </div>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        Order total {formatPrice(amountCents)}. Funds are held by the platform
        and released to each seller after delivery.
      </p>
      <div className="mt-4">
        <Elements
          stripe={stripePromise}
          options={{ clientSecret, appearance: { theme: "night" } }}
        >
          <PaymentForm orderId={orderId} amountCents={amountCents} />
        </Elements>
      </div>
      <p className="mt-4 flex items-start gap-2 text-[11px] leading-5 text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" />
        Secured by Stripe. If you leave this page, the order stays unpaid until
        Stripe confirms a payment.
      </p>
    </div>
  );
}
