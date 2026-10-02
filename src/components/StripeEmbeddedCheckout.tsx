import { useMemo } from "react";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { getStripe, getStripeEnvironment } from "@/lib/stripe";
import { useServerFn } from "@tanstack/react-start";
import { createCheckoutSession } from "@/backend/billing.functions";

interface Props {
  priceId: string;
  returnUrl?: string;
}

export function StripeEmbeddedCheckout({ priceId, returnUrl }: Props) {
  const fn = useServerFn(createCheckoutSession);
  const options = useMemo(() => ({
    fetchClientSecret: async (): Promise<string> => {
      const url = returnUrl
        ?? `${window.location.origin}/billing?status=success&session_id={CHECKOUT_SESSION_ID}`;
      const res = await fn({
        data: { priceId, returnUrl: url, environment: getStripeEnvironment() },
      });
      if (!res?.clientSecret) throw new Error("Falha ao iniciar checkout");
      return res.clientSecret;
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [priceId]);

  return (
    <div id="checkout">
      <EmbeddedCheckoutProvider stripe={getStripe()} options={options}>
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  );
}
